import { normalizeFinancials } from '@/utils/market-data';
import { yahooApiCall } from '@/utils/yahooHelper';
import { shouldUseFallback } from '@/utils/defeatbetaFallback';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
        return NextResponse.json({ error: 'No symbol provided' }, { status: 400 });
    }

    try {
        // Fetch comprehensive financial data with rate-limit evasion
        let quoteSummary;
        try {
            quoteSummary = await yahooApiCall(
                (instance) => instance.quoteSummary(symbol, {
                    modules: [
                        'summaryDetail',
                        'defaultKeyStatistics',
                        'financialData',
                        'calendarEvents',
                        'earnings',
                        'earningsHistory',
                        'earningsTrend',
                        'incomeStatementHistory',
                        'balanceSheetHistory',
                        'cashflowStatementHistory'
                    ]
                }),
                [],
                { maxRetries: 3 }
            );
        } catch (e) {
            quoteSummary = null;
        }

        if (!quoteSummary) {
            return NextResponse.json({ error: 'No financial data available' }, { status: 404 });
        }

        const data = normalizeFinancials(quoteSummary);

        // Cache control: Long cache (24h) for financial statements
        const response = NextResponse.json({ data, source: 'yahoo-finance2' });
        response.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

        return response;
    } catch (error) {
        console.error('Financial data error:', error);

        // Return more descriptive error for rate limiting
        if (shouldUseFallback(error)) {
            return NextResponse.json({
                error: 'Rate limited by Yahoo Finance. Please try again in a few minutes.',
                retryAfter: 60
            }, { status: 429 });
        }

        return NextResponse.json({ error: 'Failed to fetch financial data' }, { status: 500 });
    }
}
