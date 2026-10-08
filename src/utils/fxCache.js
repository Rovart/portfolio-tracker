'use client';

import { apiFetch } from './api-client.js';
import { readMarketQuotes, saveMarketQuotes } from './market-cache.js';

// Global cache for FX data and asset history to avoid redundant API calls
const fxCache = {
    current: {},       // { 'EUR-USD': { data: {...}, timestamp: Date.now() } }
    history: {},       // { 'EUR-USD-ALL': { data: {...}, timestamp: Date.now() } }
    assetHistory: {},  // { 'AAPL-1Y': { data: [...], timestamp: Date.now() } }
    quotes: {}         // { 'AAPL': { data: {...}, timestamp: Date.now() } }
};

const inFlightQuoteRequests = new Map();
const quoteRequestTokens = new Map();
const inFlightAssetHistoryRequests = new Map();
const inFlightFxHistoryRequests = new Map();
const QUOTE_CACHE_DURATION = 20 * 1000;

// Cache durations based on timeframe
// Short timeframes need more frequent updates, long timeframes can cache longer
const CACHE_DURATIONS = {
    current: 60 * 60 * 1000,    // 1 hour for current prices
    '1D': 15 * 60 * 1000,        // 15 min for 1D (intraday data changes rapidly)
    '1W': 30 * 60 * 1000,       // 30 min for 1W (resampled to hourly anyway)
    '1M': 30 * 60 * 1000,       // 30 min for 1M
    'YTD': 30 * 60 * 1000,      // 30 min for YTD (can be hourly)
    '3M': 60 * 60 * 1000,       // 1 hour for 3M
    '1Y': 60 * 60 * 1000,       // 1 hour for 1Y
    'ALL': 60 * 60 * 1000,      // 1 hour for ALL
    'default': 60 * 60 * 1000   // 1 hour default
};

/**
 * Get cache duration based on timeframe
 */
function getCacheDuration(range) {
    return CACHE_DURATIONS[range] || CACHE_DURATIONS.default;
}

/**
 * Get the cache key for an FX pair
 */
function getCacheKey(fromCurrency, toCurrency) {
    return `${fromCurrency.toUpperCase()}-${toCurrency.toUpperCase()}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(entry, duration) {
    if (!entry || !entry.timestamp) return false;
    return Date.now() - entry.timestamp < duration;
}

function normalizeQuoteSymbol(symbol) {
    return String(symbol || '').trim().toUpperCase();
}

export async function getCachedQuotes(symbols, maxAge = QUOTE_CACHE_DURATION) {
    const uniqueSymbols = [...new Set((symbols || []).map(normalizeQuoteSymbol).filter(Boolean))];
    if (!uniqueSymbols.length) return [];
    const missingSymbols = uniqueSymbols.filter(symbol =>
        !isCacheValid(fxCache.quotes[symbol], maxAge) || fxCache.quotes[symbol].data.isStale
    ).sort();
    if (!missingSymbols.length) return uniqueSymbols.map(symbol => fxCache.quotes[symbol].data);

    const requestKey = missingSymbols.join(',');
    let request = inFlightQuoteRequests.get(requestKey);
    if (!request) {
        const token = {};
        missingSymbols.forEach(symbol => quoteRequestTokens.set(symbol, token));
        request = (async () => {
            const received = [];
            // Keep every native request within its 200-symbol limit.
            for (let offset = 0; offset < missingSymbols.length; offset += 200) {
                const batch = missingSymbols.slice(offset, offset + 200);
                try {
                    const res = await apiFetch(`/api/quote?symbols=${encodeURIComponent(batch.join(','))}`, { cache: 'no-store' });
                    if (!res.ok) continue;
                    const json = await res.json();
                    const fetchedAt = Number(res.headers.get('X-Monetra-Cached-At') || res.headers.get('X-Monetra-Fetched-At')) || Date.now();
                    const isStale = res.headers.get('X-Monetra-Cache') === 'offline';
                    const saved = isStale ? new Map((await readMarketQuotes(batch)).map(quote => [quote.symbol, quote])) : new Map();
                    for (const quote of Array.isArray(json.data) ? json.data : []) {
                        const symbol = normalizeQuoteSymbol(quote?.symbol);
                        if (!batch.includes(symbol) || !Number.isFinite(quote.price) || quote.price <= 0) continue;
                        let data = { ...quote, symbol, fetchedAt, isStale };
                        const previous = [fxCache.quotes[symbol]?.data, saved.get(symbol)].filter(Boolean)
                            .sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
                        if (isStale && previous?.fetchedAt > fetchedAt) data = { ...previous, isStale: true };
                        if (quoteRequestTokens.get(symbol) === token) {
                            fxCache.quotes[symbol] = { data, timestamp: data.fetchedAt };
                            received.push(data);
                        } else if (fxCache.quotes[symbol]) {
                            received.push(fxCache.quotes[symbol].data);
                        }
                    }
                } catch (error) { console.warn('Quote request failed:', error.message); }
            }
            await saveMarketQuotes(received.filter(quote => quoteRequestTokens.get(quote.symbol) === token));
            return received;
        })().finally(() => {
            if (inFlightQuoteRequests.get(requestKey) === request) inFlightQuoteRequests.delete(requestKey);
        });
        inFlightQuoteRequests.set(requestKey, request);
    }
    const received = new Map((await request).map(quote => [quote.symbol, quote]));
    const saved = new Map((await readMarketQuotes(uniqueSymbols.filter(symbol =>
        !received.has(symbol) && !fxCache.quotes[symbol]
    ))).map(quote => [quote.symbol, quote]));
    return uniqueSymbols.flatMap(symbol => {
        const fresh = received.get(symbol);
        if (fresh) return [fresh];
        const entry = fxCache.quotes[symbol];
        const fallback = entry?.data || saved.get(symbol);
        if (!fallback) return [];
        return [{ ...fallback, isStale: !isCacheValid(entry, maxAge) || !!fallback.isStale }];
    });
}

/**
 * Get current FX rate with caching
 * @param {string} fromCurrency - Source currency (e.g., 'EUR')
 * @param {string} toCurrency - Target currency (e.g., 'USD')
 * @returns {Promise<{rate: number, changePercent: number}>}
 */
export async function getCachedFxRate(fromCurrency, toCurrency) {
    const from = normalizeQuoteSymbol(fromCurrency);
    const to = normalizeQuoteSymbol(toCurrency);
    if (from === to) return { rate: 1, changePercent: 0 };
    const quote = (await getCachedQuotes([`${from}${to}=X`]))[0];
    return { rate: quote?.price ?? null, changePercent: quote?.changePercent ?? null, isStale: !!quote?.isStale };
}

/**
 * Get historical FX rates with caching
 * @param {string} fromCurrency - Source currency (e.g., 'EUR')
 * @param {string} toCurrency - Target currency (e.g., 'USD')
 * @param {string} range - Time range (e.g., 'ALL', '1Y')
 * @returns {Promise<Object>} - Map of date -> rate
 */
export async function getCachedFxHistory(fromCurrency, toCurrency, range = 'ALL') {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    // Same currency = no conversion needed
    if (from === to) {
        return {};
    }

    const key = `${getCacheKey(from, to)}-${range}`;
    const cacheDuration = getCacheDuration(range);

    // Check cache - duration varies by timeframe
    if (isCacheValid(fxCache.history[key], cacheDuration)) {
        return fxCache.history[key].data;
    }

    if (inFlightFxHistoryRequests.has(key)) return inFlightFxHistoryRequests.get(key);

    const request = (async () => {
        try {
            const finalData = {};
            // FX and asset charts share the same underlying history requests.
            if (to === 'USD' || from === 'USD') {
                let history = await getCachedAssetHistory(`${from}${to}=X`, range);
                let inverse = false;
                if (history.length === 0 && from === 'USD') {
                    history = await getCachedAssetHistory(`${to}USD=X`, range);
                    inverse = true;
                }
                for (const point of history) {
                    finalData[point.date.split('T')[0]] = inverse ? 1 / point.price : point.price;
                }
            } else {
                // Cross rates continue to pivot through USD.
                const [toUsdMap, fromUsdMap] = await Promise.all([
                    getCachedFxHistory(from, 'USD', range),
                    getCachedFxHistory('USD', to, range)
                ]);
                for (const date of Object.keys(toUsdMap)) {
                    if (fromUsdMap[date]) finalData[date] = toUsdMap[date] * fromUsdMap[date];
                }
            }

            if (Object.keys(finalData).length > 0 && inFlightFxHistoryRequests.get(key) === request) {
                fxCache.history[key] = { data: finalData, timestamp: Date.now() };
            }
            return finalData;
        } catch (e) {
            console.error(`Failed to fetch FX history via pivot ${from}→${to}:`, e);
            return {};
        }
    })().finally(() => {
        if (inFlightFxHistoryRequests.get(key) === request) inFlightFxHistoryRequests.delete(key);
    });
    inFlightFxHistoryRequests.set(key, request);
    return request;
}

/**
 * Clear all cached data
 */
export function clearFxCache({ keepQuotes = false } = {}) {
    fxCache.current = {};
    fxCache.history = {};
    fxCache.assetHistory = {};
    if (keepQuotes) Object.values(fxCache.quotes).forEach(entry => { entry.timestamp = 0; });
    else fxCache.quotes = {};
    quoteRequestTokens.clear();
    inFlightQuoteRequests.clear();
    inFlightAssetHistoryRequests.clear();
    inFlightFxHistoryRequests.clear();
}

/**
 * Get all cached FX history (for sharing between components)
 */
export function getAllCachedFxHistory() {
    return fxCache.history;
}

/**
 * Pre-populate cache with FX history data
 */
export function setCachedFxHistory(fromCurrency, toCurrency, range, data) {
    const key = `${getCacheKey(fromCurrency, toCurrency)}-${range}`;
    fxCache.history[key] = {
        data,
        timestamp: Date.now()
    };
}

/**
 * Get cached asset history with timeframe-aware caching
 * @param {string} symbol - Asset symbol (e.g., 'AAPL', 'BTC-USD')
 * @param {string} range - Time range (e.g., 'ALL', '1Y', '1D')
 * @returns {Promise<Array>} - Array of { date, price } objects
 */
export async function getCachedAssetHistory(symbol, range = 'ALL') {
    const normalizedSymbol = normalizeQuoteSymbol(symbol);
    if (!normalizedSymbol) return [];
    const key = `${normalizedSymbol}-${range}`;
    const cacheDuration = getCacheDuration(range);

    // Check cache
    if (isCacheValid(fxCache.assetHistory[key], cacheDuration)) {
        return fxCache.assetHistory[key].data;
    }

    if (inFlightAssetHistoryRequests.has(key)) return inFlightAssetHistoryRequests.get(key);

    const request = (async () => {
        try {
            const res = await apiFetch(`/api/history?symbol=${encodeURIComponent(normalizedSymbol)}&range=${encodeURIComponent(range)}`);
            if (!res.ok) {
                console.warn(`Asset history fetch failed ${res.status}: ${res.statusText}`);
                return [];
            }

            const text = await res.text();
            if (!text) return [];
            const json = JSON.parse(text);
            if (!Array.isArray(json.history)) return [];

            const data = json.history
                .filter(d => Number.isFinite(d.price) && d.price > 0 && Number.isFinite(Date.parse(d.date)))
                .map(d => ({ date: d.date, price: d.price }));
            if (data.length > 0 && inFlightAssetHistoryRequests.get(key) === request) {
                fxCache.assetHistory[key] = { data, timestamp: Date.now() };
            }
            return data;
        } catch (e) {
            console.error(`Failed to fetch asset history for ${normalizedSymbol}:`, e);
            return [];
        }
    })().finally(() => {
        if (inFlightAssetHistoryRequests.get(key) === request) inFlightAssetHistoryRequests.delete(key);
    });
    inFlightAssetHistoryRequests.set(key, request);
    return request;
}

/**
 * Set cached asset history (useful for pre-populating from Dashboard)
 */
export function setCachedAssetHistory(symbol, range, data) {
    const key = `${symbol.toUpperCase()}-${range}`;
    fxCache.assetHistory[key] = {
        data,
        timestamp: Date.now()
    };
}

/**
 * Invalidate cache for a specific asset (call when adding/editing transactions)
 * @param {string} symbol - Asset symbol to invalidate
 */
export function invalidateAssetCache(symbol) {
    if (!symbol) return;

    const upper = symbol.toUpperCase();

    // Remove all timeframe entries for this asset
    Object.keys(fxCache.assetHistory).forEach(key => {
        if (key.startsWith(upper + '-')) {
            delete fxCache.assetHistory[key];
        }
    });
    for (const key of inFlightAssetHistoryRequests.keys()) {
        if (key.startsWith(upper + '-')) inFlightAssetHistoryRequests.delete(key);
    }

    // Also check for bare currency variants (EUR from EURUSD=X)
    if (upper.endsWith('=X')) {
        const base = upper.replace('=X', '');
        // For EURUSD=X, also invalidate EUR entries
        if (base.length > 4) {
            const bareCurr = base.substring(0, 3);
            Object.keys(fxCache.assetHistory).forEach(key => {
                if (key.startsWith(bareCurr + '-')) {
                    delete fxCache.assetHistory[key];
                }
            });
        }
    }
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats() {
    return {
        currentFxEntries: Object.keys(fxCache.current).length,
        historyFxEntries: Object.keys(fxCache.history).length,
        assetHistoryEntries: Object.keys(fxCache.assetHistory).length,
        quoteEntries: Object.keys(fxCache.quotes).length
    };
}
