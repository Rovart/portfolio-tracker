import YahooFinance from 'yahoo-finance2';
import { NextResponse } from 'next/server';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbols = searchParams.get('symbols');

    if (!symbols) {
        return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
    }

    const symbolList = symbols.split(',');

    try {
        // yahooFinance.quote can accept an array
        const quotes = await yahooFinance.quote(symbolList);

        // Normalize response
        const data = (Array.isArray(quotes) ? quotes : [quotes]).map(q => ({
            symbol: q.symbol,
            price: q.regularMarketPrice,
            changePercent: q.regularMarketChangePercent,
            name: q.shortName || q.symbol,
            currency: q.currency,
            quoteType: q.quoteType,
            typeDisp: q.typeDisp,
            // Extended hours data
            preMarketPrice: q.preMarketPrice || null,
            preMarketChangePercent: q.preMarketChangePercent || null,
            postMarketPrice: q.postMarketPrice || null,
            postMarketChangePercent: q.postMarketChangePercent || null,
            marketState: q.marketState || null // PRE, REGULAR, POST, CLOSED
        }));

        return NextResponse.json({ data });
    } catch (error) {
        console.error('Quote error:', error);
        return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
    }
}
