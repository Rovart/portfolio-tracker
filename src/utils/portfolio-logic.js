export function calculateHoldings(transactions, priceMap) {
    const balances = {};
    const cashFlow = {}; // To calculate total amount made

    // Sort ascending for calculation
    const sortedTx = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTx.forEach(tx => {
        const { type, baseAmount, baseCurrency, quoteAmount, quoteCurrency, fee, feeCurrency } = tx;

        // Initialize if needed
        if (baseCurrency && !balances[baseCurrency]) balances[baseCurrency] = 0;
        if (baseCurrency && !cashFlow[baseCurrency]) cashFlow[baseCurrency] = 0;
        if (quoteCurrency && !balances[quoteCurrency]) balances[quoteCurrency] = 0;

        const bAmt = parseFloat(baseAmount) || 0;
        const qAmt = parseFloat(quoteAmount) || 0;
        const fAmt = parseFloat(fee) || 0;

        if (type === 'BUY') {
            balances[baseCurrency] += bAmt;
            balances[quoteCurrency] -= qAmt;
            cashFlow[baseCurrency] += qAmt; // Spent money
        } else if (type === 'SELL') {
            balances[baseCurrency] -= bAmt;
            balances[quoteCurrency] += qAmt;
            cashFlow[baseCurrency] -= qAmt; // Recovered money
        } else if (type === 'DEPOSIT') {
            balances[baseCurrency] += bAmt;
        } else if (type === 'WITHDRAW') {
            balances[baseCurrency] -= bAmt;
        }

        // Handle fee in cashFlow too? Usually yes, it's cost.
        if (fAmt && feeCurrency === 'USD') {
            cashFlow[baseCurrency] += fAmt;
        }
    });

    // Filter and format
    return Object.entries(balances)
        .filter(([_, amount]) => Math.abs(amount) > 0.00001)
        .map(([asset, amount]) => {
            const quote = priceMap[asset] || { price: 0, changePercent: 0 };
            const price = parseFloat(quote.price) || 0;
            const changePercent = parseFloat(quote.changePercent) || 0;
            const value = amount * price;

            // Total amount made = Current Value - (Net cash flow spent)
            // If cashFlow is positive, we spent more than we sold.
            const totalProfit = value - (cashFlow[asset] || 0);

            // Daily Nominal Change
            const changeFactor = 1 + (changePercent / 100);
            const prevValue = value / (Math.abs(changeFactor) < 0.0001 ? 1 : changeFactor);
            const dailyPnl = value - prevValue;

            return {
                asset,
                name: asset,
                amount,
                price,
                value,
                change24h: changePercent,
                totalProfit,
                dailyPnl
            };
        })
        .sort((a, b) => b.value - a.value);
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
