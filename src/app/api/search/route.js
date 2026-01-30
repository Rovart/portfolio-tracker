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
            (instance) => instance.search(q),
            [],
            { maxRetries: 3 }
        );

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

        // Special handling for crypto pairs without dash (e.g., ETHAUD -> ETH-AUD)
        // Check if query looks like a crypto pair (6+ chars, all letters, no dash)
        if (upperQ.length >= 6 && /^[A-Z]+$/.test(upperQ) && !upperQ.includes('-')) {
            // Try to split into base and quote (e.g., ETHAUD -> ETH + AUD)
            // Common crypto bases: BTC, ETH, SOL, ADA, DOT, etc. (3-4 chars)
            // Common quote currencies: USD, USDT, USDC, EUR, GBP, etc.
            const possibleBases = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE', 'CRV', 'SUSHI', 'COMP', 'MKR', 'YFI', 'SNX', 'BAL', 'LRC', 'MATIC', 'AVAX', 'FTM', 'NEAR', 'ALGO', 'VET', 'FIL', 'XTZ', 'ATOM', 'LTC', 'BCH', 'XLM', 'XRP', 'DOGE', 'SHIB'];
            const possibleQuotes = ['USD', 'USDT', 'USDC', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'BTC', 'ETH'];
            
            for (const base of possibleBases) {
                if (upperQ.startsWith(base)) {
                    const quote = upperQ.substring(base.length);
                    if (possibleQuotes.includes(quote)) {
                        const pairSymbol = `${base}-${quote}`;
                        // Check if this pair already exists in results
                        const exists = filtered.some(r => 
                            r.symbol === pairSymbol || 
                            r.symbol === `${base}${quote}=X` ||
                            r.symbol === `${base}-${quote}`
                        );
                        
                        if (!exists) {
                            // Add the crypto pair at the top
                            filtered.unshift({
                                symbol: pairSymbol,
                                displaySymbol: pairSymbol,
                                shortname: `${base} ${quote}`,
                                longname: `${base} to ${quote}`,
                                type: 'CRYPTOCURRENCY',
                                exchange: 'CCC',
                                currency: quote
                            });
                        }
                        break;
                    }
                }
            }
        }

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
