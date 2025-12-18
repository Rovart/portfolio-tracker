export function calculatePortfolioHistory(transactions, historicalPrices) {
    // transactions: Array of { date, type, baseAmount, baseCurrency, quoteAmount, quoteCurrency ... }
    // historicalPrices: Map of symbol -> Array of { date: 'YYYY-MM-DD', price: number }

    if (!transactions || transactions.length === 0) return [];

    // 1. Identify timeline
    // Start from the first transaction date
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sortedTx.length === 0) return [];

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

            if (txDate > dayStr) break; // Future transaction relative to 'd'

            // Apply Transaction
            const { type, baseAmount, baseCurrency, quoteAmount, quoteCurrency, fee, feeCurrency } = tx;
            const bAmt = parseFloat(baseAmount) || 0;
            const qAmt = parseFloat(quoteAmount) || 0;
            const fAmt = parseFloat(fee) || 0;

            if (!currentBalances[baseCurrency]) currentBalances[baseCurrency] = 0;
            if (quoteCurrency && !currentBalances[quoteCurrency]) currentBalances[quoteCurrency] = 0;
            if (feeCurrency && !currentBalances[feeCurrency]) currentBalances[feeCurrency] = 0;

            if (type === 'BUY') {
                currentBalances[baseCurrency] += bAmt;
                currentBalances[quoteCurrency] -= qAmt;
            } else if (type === 'SELL') {
                currentBalances[baseCurrency] -= bAmt;
                currentBalances[quoteCurrency] += qAmt;
            } else if (type === 'DEPOSIT') {
                currentBalances[baseCurrency] += bAmt;
            } else if (type === 'WITHDRAW') {
                currentBalances[baseCurrency] -= bAmt;
            }

            // Deduct fees? (Fees usually reduce the balance of the fee currency)
            if (fAmt && feeCurrency) {
                currentBalances[feeCurrency] -= fAmt;
            }

            txIndex++;
        }

        // Calculate Portfolio Value for this day
        let totalValue = 0;
        for (const [asset, amount] of Object.entries(currentBalances)) {
            if (!amount || isNaN(amount) || Math.abs(amount) < 0.000001) continue;

            // Find price for 'asset' on 'dayStr'
            let price = 0;

            if (asset === 'USD') {
                price = 1;
            } else {
                const history = historicalPrices[asset];
                if (history && history.length > 0) {
                    const dayPrice = history.find(p => p.date === dayStr);
                    if (dayPrice) {
                        price = parseFloat(dayPrice.price) || 0;
                    } else {
                        // Fallback to last known price before this date
                        const prev = history.filter(p => p.date <= dayStr).pop();
                        price = prev ? (parseFloat(prev.price) || 0) : 0;
                    }
                }
            }

            const contribution = amount * price;
            if (!isNaN(contribution)) {
                totalValue += contribution;
            }
        }

        dailyData.push({ date: dayStr, value: totalValue });
    }

    return dailyData;
}
