import { normalizeAsset } from './portfolio-logic';

export function calculatePortfolioHistory(transactions, historicalPrices, baseCurrency = 'USD', externalQuoteMap = {}) {
    if (!transactions || transactions.length === 0) return [];

    // 1. Identify all unique timestamps across all history entries
    // Also include the dates of all transactions to ensure they show up on the chart immediately
    const historicalEntries = Object.values(historicalPrices).flat();
    const transactionDates = transactions.map(t => t.date.split('T')[0]);
    const nowStr = new Date().toISOString().split('T')[0];

    const sortedTimestamps = [...new Set([
        ...historicalEntries.map(h => h.date.split('T')[0]),
        ...transactionDates,
        nowStr
    ])].sort();

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

    // Simple forward-fill: only value assets once we have seen a price for them
    const lastKnownPrices = {};

    for (const timestamp of sortedTimestamps) {
        // Process all transactions that occurred at or before this timestamp
        while (txIndex < sortedTx.length) {
            const tx = sortedTx[txIndex];
            const txDateOnly = tx.date.split('T')[0];

            // If tx is definitively in the future compared to this timestamp
            if (txDateOnly > timestamp) break;

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
                // Only affect quote balance if affectsFiatBalance is true
                if (quote && tx.affectsFiatBalance !== false) currentBalances[quote] -= qAmt;
            } else if (type === 'SELL') {
                currentBalances[base] -= bAmt;
                // Only affect quote balance if affectsFiatBalance is true
                if (quote && tx.affectsFiatBalance !== false) currentBalances[quote] += qAmt;
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
                    const exactEntry = history.find(p => p.date === timestamp || p.date.startsWith(timestamp));
                    if (exactEntry) {
                        localPrice = parseFloat(exactEntry.price) || 0;
                        lastKnownPrices[priceSym] = localPrice;
                    } else {
                        // Only use last known if we've actually seen a price
                        localPrice = lastKnownPrices[priceSym] || 0;
                    }
                }
            }

            // Skip this asset if we have no price (don't use 0, just skip contribution)
            if (localPrice === 0 && asset !== quoteCurr) continue;

            // 2. Get FX rate
            let fxRate = 1;
            if (quoteCurr !== baseCurrency) {
                const fxSym = `${quoteCurr}${baseCurrency}=X`;
                const fxHistory = historicalPrices[fxSym] || historicalPrices[quoteCurr];
                if (fxHistory) {
                    const exactFx = fxHistory.find(p => p.date === timestamp || p.date.startsWith(timestamp));
                    if (exactFx) {
                        fxRate = parseFloat(exactFx.price) || 1;
                        lastKnownPrices[fxSym] = fxRate;
                    } else {
                        fxRate = lastKnownPrices[fxSym] || 1;
                    }
                }
            }

            totalValue += (amount * localPrice * fxRate);
        }

        if (!isNaN(totalValue) && totalValue > 0) {
            dailyData.push({ date: timestamp, value: totalValue });
        }
    }

    // STATISTICAL OUTLIER DETECTION using IQR (Interquartile Range)
    // This catches both single-point spikes and sustained anomalies
    if (dailyData.length > 10) {
        const values = dailyData.map(d => d.value).sort((a, b) => a - b);
        const q1Index = Math.floor(values.length * 0.25);
        const q3Index = Math.floor(values.length * 0.75);
        const q1 = values[q1Index];
        const q3 = values[q3Index];
        const iqr = q3 - q1;

        // Tighter bounds: 1.5x IQR (more aggressive outlier detection)
        const lowerBound = q1 - (1.5 * iqr);
        const upperBound = q3 + (1.5 * iqr);

        // Replace outliers with rolling median of 5 neighbors
        let smoothed = dailyData.map((point, i, arr) => {
            if (point.value < lowerBound || point.value > upperBound) {
                const start = Math.max(0, i - 2);
                const end = Math.min(arr.length, i + 3);
                const neighbors = arr.slice(start, end).map(p => p.value).filter(v => v > 0).sort((a, b) => a - b);
                if (neighbors.length > 0) {
                    const median = neighbors[Math.floor(neighbors.length / 2)];
                    return { ...point, value: median };
                }
            }
            return point;
        });

        // MULTIPLE PASSES: Catch remaining V-shape spikes
        for (let pass = 0; pass < 4; pass++) {
            for (let i = 1; i < smoothed.length - 1; i++) {
                const prev = smoothed[i - 1].value;
                const curr = smoothed[i].value;
                const next = smoothed[i + 1].value;

                if (prev === 0 || next === 0) continue;

                const diffPrev = Math.abs(curr - prev) / prev;
                const diffNext = Math.abs(curr - next) / next;

                // Catch spikes: >20% deviation from BOTH neighbors
                if (diffPrev > 0.2 && diffNext > 0.2) {
                    smoothed[i] = { ...smoothed[i], value: (prev + next) / 2 };
                }
            }
        }

        return smoothed;
    }

    return dailyData;
}
