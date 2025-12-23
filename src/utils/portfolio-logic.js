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
            // Only affect quote balance if affectsFiatBalance is true (checkbox was checked)
            if (quote && tx.affectsFiatBalance !== false) balances[quote] -= qAmt;
        } else if (type === 'SELL') {
            balances[base] -= bAmt;
            cashFlow[base] -= qAmt;
            // Only affect quote balance if affectsFiatBalance is true (checkbox was checked)
            if (quote && tx.affectsFiatBalance !== false) balances[quote] += qAmt;
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
            let priceSym = priceSymbolMap[asset] || asset;
            let quote = priceMap[priceSym];

            // If we don't have a quote for the bare symbol (e.g. 'AUD')
            // Try to find the constructed FX pair. 
            // We favor the USD pair (AUDUSD=X) as it is our pricing anchor.
            if (!quote && asset.length === 3) {
                const usdPair = `${asset}USD=X`;
                const basePair = baseCurrency ? `${asset}${baseCurrency}=X` : null;

                if (priceMap[usdPair]) {
                    priceSym = usdPair;
                    quote = priceMap[usdPair];
                } else if (basePair && priceMap[basePair]) {
                    priceSym = basePair;
                    quote = priceMap[basePair];
                }
            }

            quote = quote || { price: 0, changePercent: 0 };
            const changePercent = parseFloat(quote.changePercent) || 0;

            // Detect if this is a bare currency (e.g., EUR from EUR=X)
            // If the priceSymbol ends with =X and has no pair component, it's a bare currency
            // Detect if this is a bare currency
            // 1. Literal bare currency from Yahoo (EUR=X)
            // 2. Upgraded FX pair where the asset matches the base of the pair (AUD -> AUDUSD=X)
            const isBareCurrency = (priceSym && priceSym.endsWith('=X') && priceSym.replace('=X', '').length <= 4) ||
                (asset.length === 3 && (priceSym === `${asset}${baseCurrency}=X` || priceSym === `${asset}USD=X`));

            // Priority: Transaction stored quote -> Price data from Yahoo -> For bare currencies use asset itself -> USD
            let quoteCurr;
            if (quoteMap[asset]) {
                quoteCurr = quoteMap[asset].toUpperCase();
            } else if (isBareCurrency) {
                // For bare currencies: 
                // If we are using a pair like AUDUSD=X, the quote currency is actually USD (the price is 0.65 USD).
                // If we are using a literal AUD=X (rare), then it is AUD.
                if (priceSym && priceSym.endsWith('USD=X') && priceSym.length === asset.length + 5) {
                    quoteCurr = 'USD';
                } else {
                    quoteCurr = asset.toUpperCase();
                }
            } else if (quote.currency) {
                quoteCurr = quote.currency.toUpperCase();
            } else {
                quoteCurr = 'USD';
            }

            // If the asset IS its own quote currency (e.g. EUR holding from EUR=X, or USD)
            // then the local price is 1. We then multiply by the FX rate to base.
            // Use best available price: extended hours price when market is in that state
            let basePrice = parseFloat(quote.price) || 0;
            if (quote.marketState === 'PRE' && quote.preMarketPrice) {
                basePrice = quote.preMarketPrice;
            } else if ((quote.marketState === 'POST' || quote.marketState === 'POSTPOST') && quote.postMarketPrice) {
                basePrice = quote.postMarketPrice;
            }

            let localPrice = basePrice;
            if (asset.toUpperCase() === quoteCurr) {
                localPrice = 1;
                quoteCurr = asset.toUpperCase(); // Ensure it's set for FX lookup
            }

            // FX Rate: How many baseCurrency is 1 quoteCurrency?
            let fxRate = 1;
            if (quoteCurr !== baseCurrency) {
                // 1. Try direct pair (e.g. HKDEUR=X) - usually doesn't exist
                let directFx = priceMap[`${quoteCurr}${baseCurrency}=X`];

                // 2. Fallback to priceMap[quoteCurr] ONLY if base is USD
                // (priceMap['HKD'] contains HKD/USD rate, not HKD/EUR!)
                if (!directFx && baseCurrency === 'USD') {
                    directFx = priceMap[quoteCurr] || priceMap[`${quoteCurr}=X`];
                }

                if (directFx && directFx.price) {
                    fxRate = parseFloat(directFx.price);
                } else {
                    // 2. Pivot via USD (All prices get converted from USD, always)
                    // Goal: Convert 1 quoteCurr -> X baseCurrency
                    // Path: quoteCurr -> USD -> baseCurrency

                    // Step 1: quoteCurr -> USD
                    // If quoteCurr is USD, rate is 1
                    // Otherwise, XXXUSD=X gives us "1 XXX = Y USD", so toUsdRate = Y
                    let toUsdRate = 1;
                    if (quoteCurr !== 'USD') {
                        const pair = priceMap[`${quoteCurr}USD=X`];
                        if (pair && pair.price) {
                            toUsdRate = parseFloat(pair.price);
                        }
                    }

                    // Step 2: USD -> baseCurrency
                    // We want "1 USD = Z baseCurrency"
                    // XXXUSD=X gives us "1 XXX = Y USD", so USD/XXX = 1/Y
                    // Therefore, if base is EUR: EURUSD=X = 1.04, so USD/EUR = 1/1.04 = 0.96
                    let fromUsdRate = 1;
                    if (baseCurrency !== 'USD') {
                        const pair = priceMap[`${baseCurrency}USD=X`];
                        if (pair && pair.price) {
                            // This is base/USD, we need USD/base = 1 / (base/USD)
                            fromUsdRate = 1 / parseFloat(pair.price);
                        } else {
                            // Fallback: try EUR=X style (rare but possible)
                            const altPair = priceMap[`${baseCurrency}=X`];
                            if (altPair && altPair.price) {
                                fromUsdRate = 1 / parseFloat(altPair.price);
                            }
                        }
                    }

                    fxRate = toUsdRate * fromUsdRate;
                }
            }

            const localValue = amount * localPrice;
            const value = localValue * fxRate;

            // Daily Performance Calculation (incorporating FX volatility)
            const assetChangePercent = parseFloat(quote.changePercent) || 0;

            // FX Performance Discovery
            let fxChangePercent = 0;
            if (quoteCurr !== baseCurrency) {
                // 1. Try direct
                const fxQuote = priceMap[`${quoteCurr}${baseCurrency}=X`] ||
                    (quoteCurr === 'USD' ? null : priceMap[quoteCurr]) ||
                    (quoteCurr === 'USD' ? null : priceMap[`${quoteCurr}=X`]);

                if (fxQuote && fxQuote.changePercent !== undefined) {
                    fxChangePercent = parseFloat(fxQuote.changePercent) || 0;
                } else {
                    // 2. Pivot Change (Composite)
                    const toUsdChange = (quoteCurr === 'USD') ? 0 :
                        (parseFloat(priceMap[`${quoteCurr}USD=X`]?.changePercent) || 0);
                    const fromUsdChange = (baseCurrency === 'USD') ? 0 :
                        (parseFloat(priceMap[`USD${baseCurrency}=X`]?.changePercent) || 0);

                    // Combined change: (1+a)*(1+b)-1
                    fxChangePercent = ((1 + toUsdChange / 100) * (1 + fromUsdChange / 100) - 1) * 100;
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

            // Use quote metadata to detect fiat currencies
            const isFiat = asset.length <= 4 && (qt === 'CURRENCY' || td.includes('CURRENCY') || isBareCurrency || asset === baseCurrency || (priceSym && priceSym.endsWith('=X')));

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
                category,
                // For TransactionModal to detect bare currencies
                isBareCurrencyOrigin: isBareCurrency,
                originalType: qt || (isFiat ? 'CURRENCY' : undefined),
                // Extended hours data
                preMarketPrice: quote.preMarketPrice,
                preMarketChangePercent: quote.preMarketChangePercent,
                postMarketPrice: quote.postMarketPrice,
                postMarketChangePercent: quote.postMarketChangePercent,
                marketState: quote.marketState
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
