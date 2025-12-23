import YahooFinance from 'yahoo-finance2';
import { NextResponse } from 'next/server';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// IQR-based outlier smoothing + percentage-based V-shape detection
function smoothOutliers(data) {
    if (!data || data.length < 10) return data;

    const prices = data.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
    if (prices.length < 10) return data;

    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - (1.5 * iqr);
    const upper = q3 + (1.5 * iqr);

    // Pass 1: IQR outliers
    let smoothed = data.map((point, i, arr) => {
        if (point.price < lower || point.price > upper) {
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

    // Pass 2-4: Percentage-based V-shape detection (catches 25%+ single-point deviations)
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < smoothed.length - 1; i++) {
            const prev = smoothed[i - 1].price;
            const curr = smoothed[i].price;
            const next = smoothed[i + 1].price;

            if (prev > 0 && next > 0) {
                const diffPrev = Math.abs(curr - prev) / prev;
                const diffNext = Math.abs(curr - next) / next;
                // Catch spikes: >25% deviation from BOTH neighbors
                if (diffPrev > 0.25 && diffNext > 0.25) {
                    smoothed[i] = { ...smoothed[i], price: (prev + next) / 2 };
                }
            }
        }
    }

    return smoothed;
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
    if (range === '1D') interval = '1h';
    if (range === '1W') interval = '1h';

    if (!symbol) {
        return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
    }

    try {
        const queryOptions = { period1: period1.toISOString().split('T')[0], interval };
        let result = await yahooFinance.chart(symbol, queryOptions);

        // Extract and filter
        let history = result.quotes.map(q => ({
            date: q.date,
            price: q.close
        })).filter(q => q.price !== null && q.price !== undefined && q.price > 0);

        // For 1D range, if no data (non-trading day), look back up to 5 days to find last trading day
        if (range === '1D' && history.length === 0) {
            let lookbackDays = 2;
            while (history.length === 0 && lookbackDays <= 5) {
                const extendedPeriod = new Date();
                extendedPeriod.setDate(now.getDate() - lookbackDays);
                const extendedOptions = { period1: extendedPeriod.toISOString().split('T')[0], interval: '1h' };
                result = await yahooFinance.chart(symbol, extendedOptions);
                history = result.quotes.map(q => ({
                    date: q.date,
                    price: q.close
                })).filter(q => q.price !== null && q.price !== undefined && q.price > 0);

                // If we found data, only keep the most recent trading day
                if (history.length > 0) {
                    const lastDate = new Date(history[history.length - 1].date).toDateString();
                    history = history.filter(h => new Date(h.date).toDateString() === lastDate);
                }
                lookbackDays++;
            }
        }

        // Apply IQR smoothing to remove outliers (dividend spikes, splits, API errors)
        history = smoothOutliers(history);

        return NextResponse.json({ history });
    } catch (error) {
        console.error('History error:', error);
        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
}
