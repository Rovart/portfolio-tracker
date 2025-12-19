import { normalizeAsset } from './portfolio-logic';

export function calculatePortfolioHistory(transactions, historicalPrices, baseCurrency = 'USD', externalQuoteMap = {}) {
    if (!transactions || transactions.length === 0) return [];

    // 1. Identify all unique assets and quote mappings
    // 2. Identify all unique timestamps across all history entries
    const allHistoryEntries = Object.values(historicalPrices).flat();
    const sortedTimestamps = [...new Set(allHistoryEntries.map(h => h.date))].sort();

    const quoteMap = {};
    const priceSymbolMap = {};

    transactions.forEach(tx => {
        const base = normalizeAsset(tx.baseCurrency);
        const quote = normalizeAsset(tx.quoteCurrency);
        if (base && !quoteMap[base]) {
            if (tx.quoteCurrency) quoteMap[base] = tx.quoteCurrency;
            else {
                const parts = tx.baseCurrency.split(/[-/]/);
                if (parts.length > 1) quoteMap[base] = parts[parts.length - 1].toUpperCase();
            }
        }
        if (base && !priceSymbolMap[base]) priceSymbolMap[base] = tx.baseCurrency;
        if (quote && !quoteMap[quote]) quoteMap[quote] = 'USD';
    });

    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const dailyData = [];
    const currentBalances = {};
    let txIndex = 0;

    // Use price cache for each asset for efficient forward-filling
    const lastKnownPrices = {};

    for (const timestamp of sortedTimestamps) {
        // Process all transactions that occurred at or before this timestamp
        while (txIndex < sortedTx.length) {
            const tx = sortedTx[txIndex];
            // Compare ISO strings or Date objects
            if (tx.date > timestamp) break;

            const { type, baseAmount, baseCurrency: rawBase, quoteAmount, quoteCurrency: rawQuote, fee, feeCurrency: rawFee } = tx;
            const base = normalizeAsset(rawBase);
            const quote = normalizeAsset(rawQuote);
            const feeCurr = normalizeAsset(rawFee);

            const bAmt = parseFloat(baseAmount) || 0;
            const qAmt = parseFloat(quoteAmount) || 0;
            const fAmt = parseFloat(fee) || 0;

            if (base && !currentBalances[base]) currentBalances[base] = 0;
            if (quote && !currentBalances[quote]) currentBalances[quote] = 0;

            if (type === 'BUY') {
                currentBalances[base] += bAmt;
                if (quote) currentBalances[quote] -= qAmt;
            } else if (type === 'SELL') {
                currentBalances[base] -= bAmt;
                if (quote) currentBalances[quote] += qAmt;
            } else if (type === 'DEPOSIT') {
                currentBalances[base] += bAmt;
            } else if (type === 'WITHDRAW') {
                currentBalances[base] -= bAmt;
            }

            if (fAmt && feeCurr) {
                if (!currentBalances[feeCurr]) currentBalances[feeCurr] = 0;
                currentBalances[feeCurr] -= fAmt;
            }

            txIndex++;
        }

        // Calculate Portfolio Value at this timestamp
        let totalValue = 0;
        for (const [asset, amount] of Object.entries(currentBalances)) {
            if (!amount || isNaN(amount) || Math.abs(amount) < 0.000001) continue;

            const quoteCurr = externalQuoteMap[asset] || quoteMap[asset] || 'USD';
            const priceSym = priceSymbolMap[asset] || asset;

            // 1. Get local price of asset
            let localPrice = 0;
            if (asset === quoteCurr) {
                localPrice = 1;
            } else {
                const history = historicalPrices[priceSym];
                if (history && history.length > 0) {
                    // Optimized lookup: since timestamps are sorted, we can be smart, 
                    // but for simplicity, we find the entry or use last known.
                    const exactEntry = history.find(p => p.date === timestamp);
                    if (exactEntry) {
                        localPrice = parseFloat(exactEntry.price) || 0;
                        lastKnownPrices[priceSym] = localPrice;
                    } else {
                        localPrice = lastKnownPrices[priceSym] || 0;
                    }
                }
            }

            // 2. Get FX rate
            let fxRate = 1;
            if (quoteCurr !== baseCurrency) {
                const fxSym = `${quoteCurr}${baseCurrency}=X`;
                const fxHistory = historicalPrices[fxSym] || historicalPrices[quoteCurr];
                if (fxHistory) {
                    const exactFx = fxHistory.find(p => p.date === timestamp);
                    if (exactFx) {
                        fxRate = parseFloat(exactFx.price) || 1;
                        lastKnownPrices[fxSym] = fxRate;
                    } else {
                        fxRate = lastKnownPrices[fxSym] || lastKnownPrices[quoteCurr] || 1;
                    }
                }
            }

            totalValue += (amount * localPrice * fxRate);
        }

        if (!isNaN(totalValue)) {
            dailyData.push({ date: timestamp, value: totalValue });
        }
    }

    return dailyData;
}
