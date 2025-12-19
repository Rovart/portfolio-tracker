import YahooFinance from 'yahoo-finance2';
import { NextResponse } from 'next/server';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// IQR-based outlier smoothing helper
function smoothOutliers(data) {
    if (!data || data.length < 10) return data;

    const prices = data.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length < 10) return data;

    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - (1.5 * iqr);
    const upper = q3 + (1.5 * iqr);

    return data.map((point, i, arr) => {
        if (point.price < lower || point.price > upper) {
            // Replace with median of 5 neighbors
            const start = Math.max(0, i - 2);
            const end = Math.min(arr.length, i + 3);
            const neighborPrices = arr.slice(start, end).map(p => p.price).filter(p => p > 0).sort((a, b) => a - b);
            if (neighborPrices.length > 0) {
                const median = neighborPrices[Math.floor(neighborPrices.length / 2)];
                return { ...point, price: median };
            }
        }
        return point;
    });
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const range = searchParams.get('range') || '1mo';

    const now = new Date();
    let period1 = new Date();

    switch (range) {
        case '1D':
            period1.setDate(now.getDate() - 1);
            break;
        case '1W':
            period1.setDate(now.getDate() - 7);
            break;
        case '1M':
            period1.setMonth(now.getMonth() - 1);
            break;
        case '1Y':
            period1.setFullYear(now.getFullYear() - 1);
            break;
        case 'YTD':
            period1 = new Date(now.getFullYear(), 0, 1);
            break;
        case 'ALL':
            period1.setFullYear(now.getFullYear() - 10);
            break;
        default:
            period1.setMonth(now.getMonth() - 1);
    }

    let interval = '1d';
    if (range === '1D') interval = '15m';
    if (range === '1W') interval = '1h';

    if (!symbol) {
        return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
    }

    try {
        const queryOptions = { period1: period1.toISOString().split('T')[0], interval };
        const result = await yahooFinance.chart(symbol, queryOptions);

        // Extract and filter
        let history = result.quotes.map(q => ({
            date: q.date,
            price: q.close
        })).filter(q => q.price !== null && q.price !== undefined && q.price > 0);

        // Apply IQR smoothing to remove outliers (dividend spikes, splits, API errors)
        history = smoothOutliers(history);

        return NextResponse.json({ history });
    } catch (error) {
        console.error('History error:', error);
        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
}
