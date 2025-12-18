import YahooFinance from 'yahoo-finance2';
import { NextResponse } from 'next/server';

const yahooFinance = new YahooFinance();

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ results: [] });
    }

    try {
        const results = await yahooFinance.search(q);
        // Filter for relevant types (Equity, Crypto, ETF, Currency)
        const filtered = results.quotes.filter(item =>
            item.isYahooFinance &&
            (item.quoteType === 'EQUITY' || item.quoteType === 'CRYPTOCURRENCY' || item.quoteType === 'ETF' || item.quoteType === 'MUTUALFUND' || item.quoteType === 'CURRENCY')
        ).map(item => ({
            symbol: item.symbol,
            shortname: item.shortname || item.longname || item.symbol,
            type: item.quoteType,
            exchange: item.exchange,
            currency: item.currency
        }));

        return NextResponse.json({ results: filtered });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
    }
}
