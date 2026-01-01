/**
 * Defeatbeta API Fallback Provider
 * 
 * Uses the Hugging Face dataset from defeatbeta-api as a fallback
 * when Yahoo Finance rate-limits requests.
 * 
 * Note: This provides historical data (updated weekly) - not real-time.
 * Perfect for charts and historical analysis.
 * 
 * Dataset: https://huggingface.co/datasets/bwzheng2010/yahoo-finance-data
 */

import { getRandomUserAgent } from './yahooHelper';

const HF_DATASET_BASE = 'https://huggingface.co/datasets/bwzheng2010/yahoo-finance-data/resolve/main';

// Cache for parquet file data (in-memory, per-request lifecycle in serverless)
const responseCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

/**
 * Fetch price history from Hugging Face dataset (Defeatbeta-compatible)
 * Returns: { history: [{ date, price }] } or null on failure
 */
export async function fetchDefeatbetaHistory(symbol, options = {}) {
    const { startDate, endDate } = options;

    // Clean symbol (remove special chars like =X, -USD suffix)
    const cleanSymbol = symbol.toUpperCase().replace(/[=.-].*$/, '');

    // Try multiple known parquet paths
    const possiblePaths = [
        // Main price data
        `${HF_DATASET_BASE}/data/price/${cleanSymbol}.parquet`,
        // Alternative paths that might exist
        `${HF_DATASET_BASE}/price/${cleanSymbol}.parquet`,
    ];

    // Check cache first
    const cacheKey = `history_${cleanSymbol}_${startDate || 'all'}_${endDate || 'now'}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    for (const url of possiblePaths) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/octet-stream',
                },
                // Cache for 24 hours on the edge
                next: { revalidate: 86400 }
            });

            if (!response.ok) continue;

            // For now, we can't parse Parquet directly in JS without extra libs
            // Return null to indicate fallback didn't work
            // TODO: Consider using @duckdb/duckdb-wasm or parquet-wasm for full parsing
            console.log(`Defeatbeta parquet found for ${cleanSymbol}, but parsing not implemented`);
            return null;

        } catch (error) {
            console.warn(`Defeatbeta fallback error for ${cleanSymbol}:`, error.message);
            continue;
        }
    }

    return null;
}

/**
 * Alternative: Fetch from JSON API endpoints if available
 * Some community mirrors provide JSON endpoints
 */
export async function fetchAlternativeHistory(symbol, range = '1M') {
    const cleanSymbol = symbol.toUpperCase();

    // Try community API mirrors (these may or may not be available)
    const alternativeAPIs = [
        // Yahoo Finance community proxies/mirrors
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    ];

    // Calculate period based on range
    const now = new Date();
    let period1 = new Date();
    let interval = '1d';

    switch (range) {
        case '1D':
            period1.setDate(now.getDate() - 1);
            interval = '5m';
            break;
        case '1W':
            period1.setDate(now.getDate() - 7);
            interval = '1h';
            break;
        case '1M':
            period1.setMonth(now.getMonth() - 1);
            interval = '1d';
            break;
        case '3M':
            period1.setMonth(now.getMonth() - 3);
            interval = '1d';
            break;
        case '1Y':
            period1.setFullYear(now.getFullYear() - 1);
            interval = '1d';
            break;
        case 'YTD':
            period1 = new Date(now.getFullYear(), 0, 1);
            interval = '1d';
            break;
        case 'ALL':
            period1.setFullYear(now.getFullYear() - 10);
            interval = '1wk';
            break;
        default:
            period1.setMonth(now.getMonth() - 1);
    }

    const period1Unix = Math.floor(period1.getTime() / 1000);
    const period2Unix = Math.floor(now.getTime() / 1000);

    for (const baseUrl of alternativeAPIs) {
        try {
            const url = `${baseUrl}?period1=${period1Unix}&period2=${period2Unix}&interval=${interval}`;

            const response = await fetch(url, {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://finance.yahoo.com/',
                    'Origin': 'https://finance.yahoo.com'
                }
            });

            if (!response.ok) continue;

            const data = await response.json();

            if (data.chart?.result?.[0]) {
                const result = data.chart.result[0];
                const timestamps = result.timestamp || [];
                const closes = result.indicators?.quote?.[0]?.close || [];

                const history = timestamps.map((ts, i) => ({
                    date: new Date(ts * 1000),
                    price: closes[i]
                })).filter(h => h.price !== null && h.price !== undefined && h.price > 0);

                return { history, source: 'yahoo-direct' };
            }
        } catch (error) {
            console.warn(`Alternative API error:`, error.message);
            continue;
        }
    }

    return null;
}

/**
 * Check if defeatbeta fallback should be used
 * Call this after a Yahoo rate limit error
 */
export function shouldUseFallback(error) {
    if (!error) return false;

    const message = error.message?.toLowerCase() || '';
    return (
        message.includes('429') ||
        message.includes('rate') ||
        message.includes('too many') ||
        message.includes('throttle') ||
        error.code === 'ECONNRESET'
    );
}

export default {
    fetchDefeatbetaHistory,
    fetchAlternativeHistory,
    shouldUseFallback
};
