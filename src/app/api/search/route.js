import { normalizeSearch } from '@/utils/market-data';
import { yahooApiCall } from '@/utils/yahooHelper';
import { shouldUseFallback } from '@/utils/defeatbetaFallback';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ results: [] });
    }

    try {
        // Use yahoo helper with rate-limit evasion
        const results = await yahooApiCall(
            (instance) => instance.search(q, undefined, { validateResult: false }),
            [],
            { maxRetries: 3 }
        );

        const filtered = normalizeSearch(results, q);

        return NextResponse.json({ results: filtered, source: 'yahoo-finance2' });
    } catch (error) {
        console.error('Search error:', error);

        // Return more descriptive error for rate limiting
        if (shouldUseFallback(error)) {
            return NextResponse.json({
                error: 'Rate limited by Yahoo Finance. Please try again in a few minutes.',
                retryAfter: 60
            }, { status: 429 });
        }

        return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
    }
}
