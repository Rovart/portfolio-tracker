export function normalizeAsset(asset) {
    if (!asset) return asset;
    const s = asset.toUpperCase();

    // Yahoo Currency: EUR=X or EURUSD=X
    if (s.endsWith('=X')) {
        const base = s.replace('=X', '');
        // For EURUSD=X, we want EUR. For EUR=X, we want EUR.
        return base.length > 3 ? base.substring(0, 3) : base;
    }

    // Crypto/Pairs: BTC-USD or BTC/EUR
    // Be careful with stocks like BRK-B or RDS-A. 
    // Usually crypto pairs have a 3+ letter quote currency.
    if (s.includes('-') || s.includes('/')) {
        const parts = s.split(/[-/]/);
        const lastPart = parts[parts.length - 1];
        const commonQuotes = ['USD', 'EUR', 'GBP', 'BTC', 'ETH', 'USDT', 'USDC', 'BNB'];
        if (parts.length > 1 && (commonQuotes.includes(lastPart) || lastPart.length >= 3)) {
            // It's likely a pair, return the base asset
            return parts[0];
        }
    }

    return s;
}

export function calculateHoldings(transactions, priceMap, baseCurrency = 'USD') {
    const balances = {};
    const cashFlow = {}; // To calculate total amount made (in local quote currency)
    const quoteMap = {}; // Map normalizedAsset -> quoteCurrency
    const priceSymbolMap = {}; // Map normalizedAsset -> actual symbol for price lookup

    // Sort ascending for calculation
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTx.forEach(tx => {
        const { type, baseCurrency: rawBase, baseAmount, quoteCurrency: rawQuote, quoteAmount, fee, feeCurrency: rawFee } = tx;

        const base = normalizeAsset(rawBase);
        const quote = normalizeAsset(rawQuote);
        const feeCurr = normalizeAsset(rawFee);

        if (base && !balances[base]) balances[base] = 0;
        if (base && !cashFlow[base]) cashFlow[base] = 0;

        // Track which symbol to use for fetching prices (prefer the one with most info)
        if (base && !priceSymbolMap[base]) {
            priceSymbolMap[base] = rawBase;
        }

        if (base && !quoteMap[base]) {
            if (rawQuote) {
                quoteMap[base] = rawQuote;
            } else if (rawBase.includes('-') || rawBase.includes('/')) {
                const parts = rawBase.split(/[-/]/);
                quoteMap[base] = parts[parts.length - 1].toUpperCase();
            }
        }

        // Also initialize quote currency balance if it exists
        if (quote && !balances[quote]) balances[quote] = 0;
        if (quote && !quoteMap[quote]) quoteMap[quote] = 'USD';
        if (quote && !priceSymbolMap[quote]) priceSymbolMap[quote] = rawQuote || quote;

        const bAmt = parseFloat(baseAmount) || 0;
        const qAmt = parseFloat(quoteAmount) || 0;
        const fAmt = parseFloat(fee) || 0;

        if (type === 'BUY') {
            balances[base] += bAmt;
            cashFlow[base] += qAmt;
            if (quote) balances[quote] -= qAmt;
        } else if (type === 'SELL') {
            balances[base] -= bAmt;
            cashFlow[base] -= qAmt;
            if (quote) balances[quote] += qAmt;
        } else if (type === 'DEPOSIT') {
            balances[base] += bAmt;
        } else if (type === 'WITHDRAW') {
            balances[base] -= bAmt;
        }

        if (fAmt && feeCurr) {
            if (!balances[feeCurr]) balances[feeCurr] = 0;
            balances[feeCurr] -= fAmt;
            // For profit calculation we also track fees in the base asset's local flow if they match
            if (feeCurr === quote) {
                cashFlow[base] += fAmt;
            }
        }
    });

    // Filter and format
    return Object.entries(balances)
        .filter(([_, amount]) => Math.abs(amount) > 0.00001)
        .map(([asset, amount]) => {
            const priceSym = priceSymbolMap[asset] || asset;
            const quote = priceMap[priceSym] || { price: 0, changePercent: 0 };
            const changePercent = parseFloat(quote.changePercent) || 0;

            // Priority: Transaction stored quote -> Price data from Yahoo -> Symbol parsing -> USD
            let quoteCurr = (quoteMap[asset] || quote.currency || 'USD').toUpperCase();

            // If the asset IS its own quote currency (e.g. USD holding when quote is USD)
            // then the local price is 1. We then multiply by the FX rate to base.
            let localPrice = parseFloat(quote.price) || 0;
            if (asset.toUpperCase() === quoteCurr) {
                localPrice = 1;
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
            const combinedChangePercent = ((1 + assetChangePercent / 100) * (1 + fxChangePercent / 100) - 1) * 100;

            // Daily PnL in base currency based on combined change
            const combinedChangeFactor = 1 + (combinedChangePercent / 100);
            const prevValueBase = value / (Math.abs(combinedChangeFactor) < 0.0001 ? 1 : combinedChangeFactor);
            const dailyPnl = value - prevValueBase;

            // Total profit since inception (current base value vs historical spent)
            const localProfit = localValue - (cashFlow[asset] || 0);
            const totalProfit = localProfit * fxRate;

            // Categorization
            let category = 'Shares'; // Default fallback
            const qt = (quote.quoteType || '').toUpperCase();
            const td = (quote.typeDisp || '').toUpperCase();

            const isFiat = asset.length <= 4 && (priceSym.endsWith('=X') || asset === quoteCurr || asset === baseCurrency || qt === 'CURRENCY' || td.includes('CURRENCY'));

            if (isFiat) {
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
                asset,
                originalAsset: priceSym,
                name: quote.name || asset,
                amount,
                localPrice,
                price: localPrice * fxRate, // Price in base currency
                value,
                change24h: combinedChangePercent,
                totalProfit,
                dailyPnl,
                quoteCurrency: quoteCurr,
                isFiat,
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
