import YahooFinance from 'yahoo-finance2';
import { NextResponse } from 'next/server';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ results: [] });
    }

    try {
        const results = await yahooFinance.search(q);

        // Filter for relevant types (Equity, Crypto, ETF, Currency)
        let filtered = results.quotes.filter(item =>
            item.isYahooFinance &&
            (item.quoteType === 'EQUITY' || item.quoteType === 'CRYPTOCURRENCY' || item.quoteType === 'ETF' || item.quoteType === 'MUTUALFUND' || item.quoteType === 'CURRENCY' || item.quoteType === 'COMMODITY' || item.quoteType === 'FUTURE')
        ).map(item => {
            // Clean up symbol for display - remove =X suffix
            let displaySymbol = item.symbol;
            if (displaySymbol.endsWith('=X')) {
                displaySymbol = displaySymbol.replace('=X', '');
            }

            return {
                symbol: item.symbol, // Keep original symbol for API calls
                displaySymbol: displaySymbol, // Clean symbol for display
                shortname: item.shortname || item.longname || displaySymbol,
                type: item.quoteType,
                exchange: item.exchange,
                currency: item.currency
            };
        });

        // Special handling for 3-letter currency codes - always add at top
        const upperQ = q.toUpperCase().trim();
        const commonCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'THB'];

        if (commonCurrencies.includes(upperQ)) {
            // Remove any existing matching currency to avoid duplicates
            filtered = filtered.filter(r => r.symbol !== `${upperQ}=X`);

            // Always add the currency at the top
            filtered.unshift({
                symbol: `${upperQ}=X`,
                displaySymbol: upperQ,
                shortname: `${upperQ} Currency`,
                type: 'CURRENCY',
                exchange: 'CCY',
                currency: 'USD'
            });
        }

        return NextResponse.json({ results: filtered });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
    }
}
