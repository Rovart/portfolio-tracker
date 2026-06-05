import { yahooApiCall } from '@/utils/yahooHelper';
import { shouldUseFallback } from '@/utils/defeatbetaFallback';
import { NextResponse } from 'next/server';

function isPenceCurrency(currency) {
    const raw = String(currency || '').trim();
    return raw === 'GBp' || raw.toUpperCase() === 'GBX';
}

function normalizeCurrency(currency) {
    return isPenceCurrency(currency) ? 'GBP' : currency;
}

function scalePrice(value, currency) {
    if (value === null || value === undefined) return value;
    return isPenceCurrency(currency) ? value * 0.01 : value;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbols = searchParams.get('symbols');

    if (!symbols) {
        return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
    }

    const symbolList = symbols.split(',');

    try {
        // Use yahoo helper with rate-limit evasion - fetch all symbols at once
        const quotes = await yahooApiCall(
            (instance) => instance.quote(symbolList),
            [],
            { maxRetries: 3 }
        );

        // Normalize response
        const data = (Array.isArray(quotes) ? quotes : [quotes]).map(q => {
            const rawCurrency = q.currency;

            return {
                symbol: q.symbol,
                price: scalePrice(q.regularMarketPrice, rawCurrency),
                change: scalePrice(q.regularMarketChange, rawCurrency),
                changePercent: q.regularMarketChangePercent,
                name: q.shortName || q.symbol,
                currency: normalizeCurrency(q.currency),
                quoteType: q.quoteType,
                typeDisp: q.typeDisp,
                // Extended hours data
                preMarketPrice: q.preMarketPrice != null ? scalePrice(q.preMarketPrice, rawCurrency) : null,
                preMarketChangePercent: q.preMarketChangePercent || null,
                postMarketPrice: q.postMarketPrice != null ? scalePrice(q.postMarketPrice, rawCurrency) : null,
                postMarketChangePercent: q.postMarketChangePercent || null,
                marketState: q.marketState || null // PRE, REGULAR, POST, CLOSED
            };
        });

        // Cache control: Short cache (60s) for quotes
        const response = NextResponse.json({ data, source: 'yahoo-finance2' });
        response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

        return response;
    } catch (error) {
        console.error('Quote error:', error);

        // Return more descriptive error for rate limiting
        if (shouldUseFallback(error)) {
            return NextResponse.json({
                error: 'Rate limited by Yahoo Finance. Please try again in a few minutes.',
                retryAfter: 60
            }, { status: 429 });
        }

        return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
    }
}
