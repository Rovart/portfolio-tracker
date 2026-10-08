import { scalePrice } from '@/utils/market-data';
import { yahooApiCall, randomDelay } from '@/utils/yahooHelper';
import { fetchAlternativeHistory, shouldUseFallback } from '@/utils/defeatbetaFallback';
import { NextResponse } from 'next/server';

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
        case '3M':
            period1.setMonth(now.getMonth() - 3);
            break;
        case '1Y':
            period1.setFullYear(now.getFullYear() - 1);
            break;
        case 'YTD':
            period1 = new Date(now.getFullYear(), 0, 1);
            break;
        case 'ALL':
            period1 = new Date(1970, 0, 1);
            break;
        default:
            period1.setMonth(now.getMonth() - 1);
    }

    let interval = '1d';
    if (range === '1D') interval = '1h';
    if (range === '1W') interval = '1h';
    if (range === '1M') interval = '1h';
    // For YTD, if we're less than 2 months into the year, use hourly data for more granularity
    if (range === 'YTD') {
        const daysSinceYearStart = Math.floor((now - period1) / (1000 * 60 * 60 * 24));
        if (daysSinceYearStart < 60) {
            interval = '1h';
        }
    }

    if (!symbol) {
        return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
    }

    try {
        // Use yahoo helper with rate-limit evasion
        const queryOptions = { period1: period1.toISOString().split('T')[0], interval };

        let result;
        let usedFallback = false;

        try {
            // Primary: Yahoo Finance with retry logic
            result = await yahooApiCall(
                (instance) => instance.chart(symbol, queryOptions),
                [],
                { maxRetries: 3 }
            );
        } catch (yahooError) {
            // Check if we should try fallback
            if (shouldUseFallback(yahooError)) {
                console.log(`Yahoo rate limited for ${symbol}, trying fallback...`);

                // Try alternative direct Yahoo endpoints
                const fallbackResult = await fetchAlternativeHistory(symbol, range);

                if (fallbackResult?.history?.length > 0) {
                    usedFallback = true;
                    const history = fallbackResult.history.filter(point => Number.isFinite(point.price) && point.price > 0);
                    return NextResponse.json({
                        history,
                        source: fallbackResult.source,
                        fallback: true
                    });
                }
            }

            // Re-throw if fallback didn't work
            throw yahooError;
        }

        // Extract and filter
        const quoteCurrency = result?.meta?.currency;
        let history = result.quotes.map(q => ({
            date: q.date,
            price: scalePrice(q.close, quoteCurrency)
        })).filter(q => q.price !== null && q.price !== undefined && q.price > 0);

        // For 1D range, if no data (non-trading day), look back up to 5 days to find last trading day
        if (range === '1D' && history.length === 0) {
            let lookbackDays = 2;
            while (history.length === 0 && lookbackDays <= 5) {
                const extendedPeriod = new Date();
                extendedPeriod.setDate(now.getDate() - lookbackDays);
                const extendedOptions = { period1: extendedPeriod.toISOString().split('T')[0], interval: '1h' };

                // Add small delay between retries
                await randomDelay();

                result = await yahooApiCall(
                    (instance) => instance.chart(symbol, extendedOptions),
                    [],
                    { maxRetries: 2, initialDelay: false }
                );

                const extendedQuoteCurrency = result?.meta?.currency;
                history = result.quotes.map(q => ({
                    date: q.date,
                    price: scalePrice(q.close, extendedQuoteCurrency)
                })).filter(q => q.price !== null && q.price !== undefined && q.price > 0);

                // If we found data, only keep the most recent trading day
                if (history.length > 0) {
                    const lastDate = new Date(history[history.length - 1].date).toDateString();
                    history = history.filter(h => new Date(h.date).toDateString() === lastDate);
                }
                lookbackDays++;
            }
        }


        return NextResponse.json({ history, source: 'yahoo-finance2' });
    } catch (error) {
        console.error('History error:', error);

        // Return more descriptive error for rate limiting
        if (shouldUseFallback(error)) {
            return NextResponse.json({
                error: 'Rate limited by Yahoo Finance. Please try again in a few minutes.',
                retryAfter: 60
            }, { status: 429 });
        }

        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
}
