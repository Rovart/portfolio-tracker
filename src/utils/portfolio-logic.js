export function calculateHoldings(transactions, priceMap, baseCurrency = 'USD') {
    const balances = {};
    const cashFlow = {}; // To calculate total amount made (in local quote currency)
    const quoteMap = {}; // Map asset -> quoteCurrency

    // Sort ascending for calculation
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTx.forEach(tx => {
        const { type, baseAmount, baseCurrency: sym, quoteAmount, quoteCurrency, fee, feeCurrency } = tx;

        if (sym && !balances[sym]) balances[sym] = 0;
        if (sym && !cashFlow[sym]) cashFlow[sym] = 0;

        if (sym && !quoteMap[sym]) {
            if (quoteCurrency) {
                quoteMap[sym] = quoteCurrency;
            } else if (sym.includes('-') || sym.includes('/')) {
                const parts = sym.split(/[-/]/);
                quoteMap[sym] = parts[parts.length - 1].toUpperCase();
            }
        }

        // Also initialize quote currency balance if it exists
        if (quoteCurrency && !balances[quoteCurrency]) balances[quoteCurrency] = 0;
        if (quoteCurrency && !quoteMap[quoteCurrency]) quoteMap[quoteCurrency] = 'USD';

        const bAmt = parseFloat(baseAmount) || 0;
        const qAmt = parseFloat(quoteAmount) || 0;
        const fAmt = parseFloat(fee) || 0;

        if (type === 'BUY') {
            balances[sym] += bAmt;
            cashFlow[sym] += qAmt;
            if (quoteCurrency) balances[quoteCurrency] -= qAmt;
        } else if (type === 'SELL') {
            balances[sym] -= bAmt;
            cashFlow[sym] -= qAmt;
            if (quoteCurrency) balances[quoteCurrency] += qAmt;
        } else if (type === 'DEPOSIT') {
            balances[sym] += bAmt;
        } else if (type === 'WITHDRAW') {
            balances[sym] -= bAmt;
        }

        if (fAmt && feeCurrency) {
            if (!balances[feeCurrency]) balances[feeCurrency] = 0;
            balances[feeCurrency] -= fAmt;
            // For profit calculation we also track fees in the base asset's local flow if they match
            if (feeCurrency === (quoteCurrency || 'USD')) {
                cashFlow[sym] += fAmt;
            }
        }
    });

    // Filter and format
    return Object.entries(balances)
        .filter(([_, amount]) => Math.abs(amount) > 0.00001)
        .map(([asset, amount]) => {
            const quote = priceMap[asset] || { price: 0, changePercent: 0 };
            const changePercent = parseFloat(quote.changePercent) || 0;

            // Priority: Transaction stored quote -> Price data from Yahoo -> Symbol parsing -> USD
            let quoteCurr = (quoteMap[asset] || quote.currency || 'USD').toUpperCase();

            // If the asset IS its own quote currency (e.g. USD holding when quote is USD)
            // then the local price is 1. We then multiply by the FX rate to base.
            let localPrice = parseFloat(quote.price) || 0;
            if (asset.toUpperCase() === quoteCurr) {
                localPrice = 1;
            }

            // Special case: if Yahoo returned something like 'CCY', normalize it
            if (quoteCurr === 'HKD' && !quoteMap[asset]) {
                console.log(`[FX Discovery] Detected HKD for ${asset} from live data`);
            }
            // FX Rate: How many baseCurrency (USD) is 1 quoteCurrency?
            let fxRate = 1;
            if (quoteCurr !== baseCurrency) {
                // EXPLICIT PRIORITY: CURUSD=X is the most reliable format for USD-per-Base
                const fxQuote = priceMap[`${quoteCurr}${baseCurrency}=X`] ||
                    priceMap[quoteCurr] ||
                    priceMap[`${quoteCurr}=X`] ||
                    { price: 1 };
                fxRate = parseFloat(fxQuote.price) || 1;

                // Debug log for multi-currency assets
                if (quoteCurr !== 'USD') {
                    console.log(`[Holdings FX] ${asset}: Local=${localPrice}, Rate=${fxRate}, USD Total=${localPrice * fxRate}`);
                }
            }

            const localValue = amount * localPrice;
            const value = localValue * fxRate;

            // Daily Performance Calculation (incorporating FX volatility)
            const assetChangePercent = parseFloat(quote.changePercent) || 0;

            // FX Performance Discovery
            let fxChangePercent = 0;
            if (quoteCurr !== baseCurrency) {
                const fxQuote = priceMap[`${quoteCurr}${baseCurrency}=X`] ||
                    priceMap[quoteCurr] ||
                    priceMap[`${quoteCurr}=X`];
                if (fxQuote) {
                    fxChangePercent = parseFloat(fxQuote.changePercent) || 0;
                }
            }

            // Calculate total combined change percent (forex + asset)
            // Combined Change Factor = (1 + assetChange) * (1 + fxChange)
            const combinedChangePercent = ((1 + assetChangePercent / 100) * (1 + fxChangePercent / 100) - 1) * 100;

            // Daily PnL in base currency based on combined change
            const combinedChangeFactor = 1 + (combinedChangePercent / 100);
            const prevValueBase = value / (Math.abs(combinedChangeFactor) < 0.0001 ? 1 : combinedChangeFactor);
            const dailyPnl = value - prevValueBase;

            // Total profit since inception (current base value vs historical spent)
            const localProfit = localValue - (cashFlow[asset] || 0);
            const totalProfit = localProfit * fxRate;

            // Branding: Simplified label for forex-based cash
            let displayAsset = asset;
            if (asset.endsWith(`${baseCurrency}=X`)) {
                displayAsset = asset.replace(`${baseCurrency}=X`, '');
            } else if (asset.endsWith('=X')) {
                displayAsset = asset.split('=')[0];
                if (displayAsset.length > 3) displayAsset = displayAsset.substring(0, 3);
            }

            // Categorization
            let category = 'Shares'; // Default fallback
            const qt = (quote.quoteType || '').toUpperCase();
            const td = (quote.typeDisp || '').toUpperCase();

            if (asset.endsWith('=X') || asset === quoteCurr || asset === baseCurrency || qt === 'CURRENCY' || td.includes('CURRENCY')) {
                category = 'Currencies';
            } else if (qt === 'ETF' || td.includes('ETF')) {
                category = 'ETFs';
            } else if (qt === 'CRYPTOCURRENCY' || td.includes('CRYPTO')) {
                category = 'Crypto';
            } else if (qt === 'EQUITY' || td.includes('EQUITY') || td.includes('STOCK') || td.includes('SHARE')) {
                category = 'Shares';
            } else if (qt === 'MUTUALFUND' || td.includes('FUND')) {
                category = 'Funds';
            }

            return {
                asset: displayAsset,
                originalAsset: asset,
                name: quote.name || displayAsset,
                amount,
                localPrice,
                price: localPrice * fxRate, // Price in base currency
                value,
                change24h: combinedChangePercent,
                totalProfit,
                dailyPnl,
                quoteCurrency: quoteCurr,
                isFiat: asset.endsWith('=X') || asset === quoteCurr || asset === baseCurrency,
                category
            };
        })
        .sort((a, b) => {
            // Currencies at bottom
            if (a.isFiat && !b.isFiat) return 1;
            if (!a.isFiat && b.isFiat) return -1;
            return b.value - a.value;
        });
}

// Simple chart generation based on CURRENT holdings and HISTORICAL prices
// This is NOT accurate for portfolio history (churn) but fits "How is my CURRENT portfolio doing?"
export async function fetchPortfolioHistory(holdings, range) {
    // This needs to be async now because we fetch history
    // However, for client-side simplicity, we might just fetch history for top assets

    // Actually, easy MVP:
    // 1. Get history for top 5 assets by value.
    // 2. Sum their (amount * history_price) at each timestamp.

    // We will let the Component handle the fetching loop to avoid async complexity here if possible
    // But let's provide a helper
    return [];
}
