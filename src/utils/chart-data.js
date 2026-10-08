import { inferTransactionCostCurrency } from './portfolio-logic.js';

// Keep the ends and each bucket's extrema without rendering the full history.
export function downsampleChartData(data, maxPoints = 300) {
    if (!data || data.length <= maxPoints) return data || [];
    const bucketCount = Math.floor((maxPoints - 2) / 2);
    const sampled = [data[0]];
    const bucketSize = (data.length - 2) / bucketCount;

    for (let bucket = 0; bucket < bucketCount; bucket++) {
        const start = 1 + Math.floor(bucket * bucketSize);
        const end = 1 + Math.floor((bucket + 1) * bucketSize);
        let minIndex = start;
        let maxIndex = start;
        for (let i = start + 1; i < end; i++) {
            if (data[i].value < data[minIndex].value) minIndex = i;
            if (data[i].value > data[maxIndex].value) maxIndex = i;
        }
        sampled.push(data[Math.min(minIndex, maxIndex)]);
        if (minIndex !== maxIndex) sampled.push(data[Math.max(minIndex, maxIndex)]);
    }

    sampled.push(data[data.length - 1]);
    return sampled;
}

export function getTransactionExecutionPrice(tx, baseCurrency, resolveRate) {
    const units = Math.abs(parseFloat(tx.baseAmount));
    const total = Math.abs(parseFloat(tx.quoteAmount));
    if (!Number.isFinite(units) || !Number.isFinite(total) || units === 0 || total === 0) return null;

    const currency = inferTransactionCostCurrency(tx, baseCurrency);
    const rate = currency === baseCurrency ? 1 : resolveRate(currency, String(tx.date).split('T')[0]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const price = (total / units) * rate;
    return Number.isFinite(price) && price > 0 ? price : null;
}

// x is a fractional chart index, allowing a marker between two plotted prices.
export function findLatestPricePosition(points, price) {
    let closestIndex = points.length - 1;
    let closestDifference = Infinity;

    for (let i = points.length - 1; i >= 0; i--) {
        const value = points[i].value;
        const difference = Math.abs(value - price);
        if (difference === 0) return i;
        if (difference < closestDifference) {
            closestDifference = difference;
            closestIndex = i;
        }

        if (i > 0) {
            const previous = points[i - 1].value;
            if (price > Math.min(previous, value) && price < Math.max(previous, value)) {
                return i - 1 + (price - previous) / (value - previous);
            }
        }
    }

    return points.length > 0 ? closestIndex : null;
}

function findDatePosition(points, date) {
    const time = new Date(date).getTime();
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (new Date(points[mid].date).getTime() < time) low = mid + 1;
        else high = mid;
    }
    if (low > 0 && time - new Date(points[low - 1].date).getTime() < new Date(points[low].date).getTime() - time) {
        return low - 1;
    }
    return low;
}

export function buildTransactionMarkers(points, transactions) {
    if (points.length === 0 || !transactions?.length) return [];
    const firstDate = points[0].date.split('T')[0];
    const lastDate = points[points.length - 1].date.split('T')[0];
    const pricePositions = new Map();
    const markers = [];

    for (const tx of transactions) {
        if (!tx.date || !['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'].includes(tx.type)) continue;
        const txDate = tx.date.split('T')[0];
        // An older operation must not reappear merely because today's price matches.
        if (txDate < firstDate || txDate > lastDate || !Number.isFinite(Date.parse(tx.date))) continue;

        const hasPrice = Number.isFinite(tx.executionPrice) && tx.executionPrice > 0;
        if (!hasPrice && ['BUY', 'SELL'].includes(tx.type)) continue;
        let x;
        if (hasPrice) {
            if (!pricePositions.has(tx.executionPrice)) {
                pricePositions.set(tx.executionPrice, findLatestPricePosition(points, tx.executionPrice));
            }
            x = pricePositions.get(tx.executionPrice);
        } else {
            // Transfers without a cost basis still use their actual date.
            x = findDatePosition(points, tx.date);
        }

        markers.push({
            id: tx.id,
            x,
            // Crossings keep the execution price. If the curve never reaches it,
            // snap to the nearest plotted price rather than drawing off the curve.
            y: hasPrice && !Number.isInteger(x) ? tx.executionPrice : points[x].value,
            executionPrice: hasPrice ? tx.executionPrice : null,
            date: tx.date,
            type: tx.type,
            amount: tx.baseAmount,
            isBuy: ['BUY', 'DEPOSIT'].includes(tx.type),
            hasPrice
        });
    }

    return markers;
}
