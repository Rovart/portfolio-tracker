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
            (item.quoteType === 'EQUITY' || item.quoteType === 'CRYPTOCURRENCY' || item.quoteType === 'ETF' || item.quoteType === 'MUTUALFUND' || item.quoteType === 'CURRENCY')
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

        // Special handling for exact currency code matches like "USD", "EUR", "GBP"
        const upperQ = q.toUpperCase().trim();
        const commonCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'THB'];

        if (commonCurrencies.includes(upperQ)) {
            // Check if we already have this currency in results
            const hasCurrency = filtered.some(r => r.symbol === `${upperQ}=X` || r.displaySymbol === upperQ);
            if (!hasCurrency) {
                // Add the currency at the top
                filtered.unshift({
                    symbol: `${upperQ}=X`,
                    displaySymbol: upperQ,
                    shortname: `${upperQ} - US Dollar Exchange Rate`,
                    type: 'CURRENCY',
                    exchange: 'CCY',
                    currency: 'USD'
                });
            }
        }

        return NextResponse.json({ results: filtered });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
    }
}
