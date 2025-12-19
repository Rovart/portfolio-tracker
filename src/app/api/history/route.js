import YahooFinance from 'yahoo-finance2';
import { NextResponse } from 'next/server';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const range = searchParams.get('range') || '1mo'; // 1d, 5d, 1mo, 1y, ytd, max

    // Calculate period1 based on range
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
            period1.setFullYear(now.getFullYear() - 10); // Max 10 years for now
            break;
        default:
            period1.setMonth(now.getMonth() - 1);
    }

    // Interval selection
    let interval = '1d';
    if (range === '1D') interval = '15m'; // Granular for 1 day
    if (range === '1W') interval = '1h';

    if (!symbol) {
        return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
    }

    try {
        const queryOptions = { period1: period1.toISOString().split('T')[0], interval };
        const result = await yahooFinance.chart(symbol, queryOptions);

        // Extract timestamp and close
        const history = result.quotes.map(q => ({
            date: q.date, // serialized date
            price: q.close
        })).filter(q => q.price !== null && q.price !== undefined);

        return NextResponse.json({ history });
    } catch (error) {
        console.error('History error:', error);
        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
}
