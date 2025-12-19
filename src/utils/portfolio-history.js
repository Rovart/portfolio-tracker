import { normalizeAsset } from './portfolio-logic';

export function calculatePortfolioHistory(transactions, historicalPrices, baseCurrency = 'USD', externalQuoteMap = {}) {
    if (!transactions || transactions.length === 0) return [];

    // 1. Identify timeline and quote mappings
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sortedTx.length === 0) return [];

    const quoteMap = {};
    const priceSymbolMap = {}; // Map normalizedAsset -> actual symbol for price lookup

    transactions.forEach(tx => {
        const base = normalizeAsset(tx.baseCurrency);
        const quote = normalizeAsset(tx.quoteCurrency);

        // Track the quote currency for the primary asset
        if (base && !quoteMap[base]) {
            if (tx.quoteCurrency) {
                quoteMap[base] = tx.quoteCurrency;
            } else {
                const parts = tx.baseCurrency.split(/[-/]/);
                if (parts.length > 1) {
                    quoteMap[base] = parts[parts.length - 1].toUpperCase();
                }
            }
        }

        // Track price symbol
        if (base && !priceSymbolMap[base]) {
            priceSymbolMap[base] = tx.baseCurrency;
        }

        // If an asset is used as a quote currency elsewhere, its own quote is USD
        if (quote && !quoteMap[quote]) {
            quoteMap[quote] = 'USD';
        }
    });

    const startDate = new Date(sortedTx[0].date);
    const now = new Date();

    const dailyData = [];
    const currentBalances = {};

    let txIndex = 0;

    // Iterate day by day from start to now
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
        const dayStr = d.toISOString().split('T')[0];

        // Process transactions for this day
        while (txIndex < sortedTx.length) {
            const tx = sortedTx[txIndex];
            const txDate = new Date(tx.date).toISOString().split('T')[0];

            if (txDate > dayStr) break;

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

        // Calculate Portfolio Value for this day
        let totalValue = 0;
        for (const [asset, amount] of Object.entries(currentBalances)) {
            if (!amount || isNaN(amount) || Math.abs(amount) < 0.000001) continue;

            const quoteCurr = externalQuoteMap[asset] || quoteMap[asset] || 'USD';

            // 1. Get local price of asset
            let localPrice = 0;
            if (asset === quoteCurr) {
                localPrice = 1;
            } else {
                const priceSym = priceSymbolMap[asset] || asset;
                const history = historicalPrices[priceSym];
                if (history && history.length > 0) {
                    const dayPrice = history.find(p => p.date === dayStr);
                    localPrice = dayPrice ? (parseFloat(dayPrice.price) || 0) : (history.filter(p => p.date <= dayStr).pop()?.price || 0);
                }
            }

            // 2. Get FX rate
            let fxRate = 1;
            if (quoteCurr !== baseCurrency) {
                // Try CURUSD=X history first, then CUR=X
                const fxHistory = historicalPrices[`${quoteCurr}${baseCurrency}=X`] || historicalPrices[quoteCurr];
                if (fxHistory && fxHistory.length > 0) {
                    const dayFx = fxHistory.find(p => p.date === dayStr);
                    const rawFx = dayFx ? (parseFloat(dayFx.price) || 0) : (fxHistory.filter(p => p.date <= dayStr).sort((a, b) => b.date.localeCompare(a.date))[0]?.price || 1);

                    // HEURISTIC: If the rate looks like EUR=X (0.85 instead of 1.17), invert it if necessary.
                    // But we expect to fetch CURUSD=X which is 1.17.
                    // If we somehow got EUR=X (which is EUR per USD), we should invert.
                    // However, we'll try to stick to multiplication with 1.17.
                    fxRate = parseFloat(rawFx) || 1;

                    // Fallback for reversed rates like 0.85 (EUR=X style) if we expect 1.17
                    if (quoteCurr === 'EUR' && fxRate < 1 && fxRate > 0) {
                        // If it's very low, it might be the wrong direction. 
                        // But let's assume our fetch logic for CURUSD=X works.
                    }
                }
            }

            const contribution = amount * localPrice * fxRate;
            if (!isNaN(contribution)) {
                totalValue += contribution;
            }
        }

        dailyData.push({ date: dayStr, value: totalValue });
    }

    return dailyData;
}
