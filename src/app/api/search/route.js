import { yahooApiCall } from '@/utils/yahooHelper';
import { shouldUseFallback } from '@/utils/defeatbetaFallback';
import { NextResponse } from 'next/server';

// Futures/Commodities searchable by name
const FUTURES_BY_NAME = {
    'GOLD': { symbol: 'GC=F', displaySymbol: 'GC', shortname: 'Gold', type: 'FUTURE' },
    'SILVER': { symbol: 'SI=F', displaySymbol: 'SI', shortname: 'Silver', type: 'FUTURE' },
    'COPPER': { symbol: 'HG=F', displaySymbol: 'HG', shortname: 'Copper', type: 'FUTURE' },
    'PLATINUM': { symbol: 'PL=F', displaySymbol: 'PL', shortname: 'Platinum', type: 'FUTURE' },
    'PALLADIUM': { symbol: 'PA=F', displaySymbol: 'PA', shortname: 'Palladium', type: 'FUTURE' },
    'CRUDE': { symbol: 'CL=F', displaySymbol: 'CL', shortname: 'Crude Oil', type: 'FUTURE' },
    'OIL': { symbol: 'CL=F', displaySymbol: 'CL', shortname: 'Crude Oil', type: 'FUTURE' },
    'WTI': { symbol: 'CL=F', displaySymbol: 'CL', shortname: 'WTI Crude Oil', type: 'FUTURE' },
    'BRENT': { symbol: 'BZ=F', displaySymbol: 'BZ', shortname: 'Brent Oil', type: 'FUTURE' },
    'NATURAL GAS': { symbol: 'NG=F', displaySymbol: 'NG', shortname: 'Natural Gas', type: 'FUTURE' },
    'GAS': { symbol: 'NG=F', displaySymbol: 'NG', shortname: 'Natural Gas', type: 'FUTURE' },
    'WHEAT': { symbol: 'ZW=F', displaySymbol: 'ZW', shortname: 'Wheat', type: 'FUTURE' },
    'CORN': { symbol: 'ZC=F', displaySymbol: 'ZC', shortname: 'Corn', type: 'FUTURE' },
    'SOYBEANS': { symbol: 'ZS=F', displaySymbol: 'ZS', shortname: 'Soybeans', type: 'FUTURE' },
    'SOY': { symbol: 'ZS=F', displaySymbol: 'ZS', shortname: 'Soybeans', type: 'FUTURE' },
    'COFFEE': { symbol: 'KC=F', displaySymbol: 'KC', shortname: 'Coffee', type: 'FUTURE' },
    'COTTON': { symbol: 'CT=F', displaySymbol: 'CT', shortname: 'Cotton', type: 'FUTURE' },
    'SUGAR': { symbol: 'SB=F', displaySymbol: 'SB', shortname: 'Sugar', type: 'FUTURE' },
    'COCOA': { symbol: 'CC=F', displaySymbol: 'CC', shortname: 'Cocoa', type: 'FUTURE' },
    'RUSSELL': { symbol: 'RTY=F', displaySymbol: 'RTY', shortname: 'Russell 2000', type: 'FUTURE' },
    'RUSSELL 2000': { symbol: 'RTY=F', displaySymbol: 'RTY', shortname: 'Russell 2000', type: 'FUTURE' },
    'RTY': { symbol: 'RTY=F', displaySymbol: 'RTY', shortname: 'Russell 2000', type: 'FUTURE' },
    'SP500': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'S&P': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'S&P 500': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'ES': { symbol: 'ES=F', displaySymbol: 'ES', shortname: 'S&P 500', type: 'FUTURE' },
    'NASDAQ': { symbol: 'NQ=F', displaySymbol: 'NQ', shortname: 'NASDAQ 100', type: 'FUTURE' },
    'NASDAQ 100': { symbol: 'NQ=F', displaySymbol: 'NQ', shortname: 'NASDAQ 100', type: 'FUTURE' },
    'NQ': { symbol: 'NQ=F', displaySymbol: 'NQ', shortname: 'NASDAQ 100', type: 'FUTURE' },
    'DOW': { symbol: 'YM=F', displaySymbol: 'YM', shortname: 'Dow Jones', type: 'FUTURE' },
    'DOW JONES': { symbol: 'YM=F', displaySymbol: 'YM', shortname: 'Dow Jones', type: 'FUTURE' },
    'YM': { symbol: 'YM=F', displaySymbol: 'YM', shortname: 'Dow Jones', type: 'FUTURE' },
    'VIX': { symbol: 'VX=F', displaySymbol: 'VX', shortname: 'VIX', type: 'FUTURE' }
};

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

        // Special handling for futures/commodities by name (e.g., "russell" -> RTY=F)
        const futuresMatch = FUTURES_BY_NAME[upperQ];
        if (futuresMatch) {
            // Check if already in results
            const exists = filtered.some(r => r.symbol === futuresMatch.symbol);
            if (!exists) {
                filtered.unshift({
                    symbol: futuresMatch.symbol,
                    displaySymbol: futuresMatch.displaySymbol,
                    shortname: futuresMatch.shortname,
                    longname: futuresMatch.shortname,
                    type: futuresMatch.type,
                    exchange: 'CME',
                    currency: 'USD'
                });
            }
        }

        // Special handling for crypto pairs without dash (e.g., ETHAUD -> ETH-AUD)
        // Check if query looks like a crypto pair (6+ chars, all letters, no dash)
        if (upperQ.length >= 6 && /^[A-Z]+$/.test(upperQ) && !upperQ.includes('-')) {
            // Try to split into base and quote (e.g., ETHAUD -> ETH + AUD)
            // Common crypto bases: BTC, ETH, SOL, ADA, DOT, etc. (3-4 chars)
            // Common quote currencies: USD, USDT, USDC, EUR, GBP, etc.
            const possibleBases = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE', 'CRV', 'SUSHI', 'COMP', 'MKR', 'YFI', 'SNX', 'BAL', 'LRC', 'MATIC', 'AVAX', 'FTM', 'NEAR', 'ALGO', 'VET', 'FIL', 'XTZ', 'ATOM', 'LTC', 'BCH', 'XLM', 'XRP', 'DOGE', 'SHIB'];
            const possibleQuotes = ['USD', 'USDT', 'USDC', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'THB', 'IDR', 'BTC', 'ETH'];
            
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
