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

    // 3. Pre-populate lastKnownPrices with the EARLIEST available price for each asset
    // This prevents the portfolio value from dropping to 0 at the start of an asset's history
    const lastKnownPrices = {};
    Object.entries(historicalPrices).forEach(([sym, history]) => {
        if (history && history.length > 0) {
            // Find the point with the earliest date
            const earliest = [...history].sort((a, b) => a.date.localeCompare(b.date))[0];
            lastKnownPrices[sym] = parseFloat(earliest.price) || 0;
        }
    });

    for (const timestamp of sortedTimestamps) {
        // Process all transactions that occurred at or before this timestamp
        while (txIndex < sortedTx.length) {
            const tx = sortedTx[txIndex];
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
                    const exactEntry = history.find(p => p.date === timestamp);
                    if (exactEntry) {
                        localPrice = parseFloat(exactEntry.price) || 0;
                        lastKnownPrices[priceSym] = localPrice;
                    } else {
                        localPrice = lastKnownPrices[priceSym] || 0;
                    }
                } else {
                    localPrice = lastKnownPrices[priceSym] || 0;
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
                } else {
                    fxRate = lastKnownPrices[fxSym] || lastKnownPrices[quoteCurr] || 1;
                }
            }

            totalValue += (amount * localPrice * fxRate);
        }

        if (!isNaN(totalValue)) {
            dailyData.push({ date: timestamp, value: totalValue });
        }
    }

    // SMOOTHING PASS: Filter out abrupt data outliers (dips/spikes) from bad Yahoo response bars
    // We target "V" or "inverted V" shapes that represent more than 25% instantaneous change
    if (dailyData.length > 5) {
        return dailyData.map((point, i, arr) => {
            if (i === 0 || i === arr.length - 1) return point;
            const prev = arr[i - 1].value;
            const curr = point.value;
            const next = arr[i + 1].value;

            if (prev === 0 || next === 0) return point; // Don't smooth the very start

            // Detect single-point extreme outliers (more than 25% deviation from both neighbors)
            const diffPrev = Math.abs(curr - prev) / prev;
            const diffNext = Math.abs(curr - next) / next;

            const isSpike = diffPrev > 0.25 && diffNext > 0.25;

            // Special case: if curr is 0 but neighbors aren't, it's almost certainly a bad point
            const isZeroDip = curr === 0 && prev > 0 && next > 0;

            if (isSpike || isZeroDip) {
                return { ...point, value: (prev + next) / 2 };
            }
            return point;
        });
    }

    return dailyData;
}
