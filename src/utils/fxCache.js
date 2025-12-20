'use client';

// Global cache for FX data and asset history to avoid redundant API calls
const fxCache = {
    current: {},       // { 'EUR-USD': { data: {...}, timestamp: Date.now() } }
    history: {},       // { 'EUR-USD-ALL': { data: {...}, timestamp: Date.now() } }
    assetHistory: {}   // { 'AAPL-1Y': { data: [...], timestamp: Date.now() } }
};

// Cache durations based on timeframe
// Short timeframes need more frequent updates, long timeframes can cache longer
const CACHE_DURATIONS = {
    current: 60 * 60 * 1000,    // 1 hour for current prices
    '1D': 5 * 60 * 1000,        // 5 min for 1D (intraday data changes rapidly)
    '1W': 15 * 60 * 1000,       // 15 min for 1W
    '1M': 30 * 60 * 1000,       // 30 min for 1M
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

/**
 * Get current FX rate with caching
 * @param {string} fromCurrency - Source currency (e.g., 'EUR')
 * @param {string} toCurrency - Target currency (e.g., 'USD')
 * @returns {Promise<{rate: number, changePercent: number}>}
 */
export async function getCachedFxRate(fromCurrency, toCurrency) {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    // Same currency = no conversion
    if (from === to) {
        return { rate: 1, changePercent: 0 };
    }

    const key = getCacheKey(from, to);

    // Check cache
    if (isCacheValid(fxCache.current[key], CACHE_DURATIONS.current)) {
        return fxCache.current[key].data;
    }

    // Fetch fresh data
    try {
        const symbol = `${from}${to}=X`;
        const res = await fetch(`/api/quote?symbols=${symbol}`);
        const json = await res.json();

        if (json.data && json.data[0]) {
            const data = {
                rate: json.data[0].price || 1,
                changePercent: json.data[0].changePercent || 0
            };

            // Update cache
            fxCache.current[key] = {
                data,
                timestamp: Date.now()
            };

            return data;
        }
    } catch (e) {
        console.error(`Failed to fetch FX rate ${from}→${to}:`, e);
    }

    return { rate: 1, changePercent: 0 };
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

    // Fetch fresh data
    // Implement STRICT USD Pivot Logic:
    // If not converting to/from USD, we MUST pivot via USD.
    // e.g. EUR -> GBP becomes (EUR -> USD) * (USD -> GBP)

    try {
        let finalData = {};

        // Case 1: Direct to/from USD
        if (to === 'USD') {
            // EUR -> USD (Fetch EURUSD=X)
            const symbol = `${from}USD=X`;
            const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`);
            const json = await res.json();
            if (json.history) {
                json.history.forEach(d => { finalData[d.date.split('T')[0]] = d.price; });
            }
        } else if (from === 'USD') {
            // USD -> EUR (Fetch USDEUR=X, or 1/EURUSD=X)
            // Ideally fetch USDEUR=X directly
            const symbol = `USD${to}=X`;
            const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`);
            const json = await res.json();
            if (json.history) {
                json.history.forEach(d => { finalData[d.date.split('T')[0]] = d.price; });
            } else {
                // Fallback: Fetch EURUSD=X and inverse
                const invSymbol = `${to}USD=X`;
                const invRes = await fetch(`/api/history?symbol=${invSymbol}&range=${range}`);
                const invJson = await invRes.json();
                if (invJson.history) {
                    invJson.history.forEach(d => {
                        if (d.price) finalData[d.date.split('T')[0]] = 1 / d.price;
                    });
                }
            }
        } else {
            // Case 2: Cross Rate (EUR -> GBP)
            // Pivot: (EUR -> USD) * (USD -> GBP)
            const [toUsdMap, fromUsdMap] = await Promise.all([
                getCachedFxHistory(from, 'USD', range),
                getCachedFxHistory('USD', to, range)
            ]);

            // Combine histories
            // Iterate over dates present in BOTH maps
            Object.keys(toUsdMap).forEach(date => {
                if (fromUsdMap[date]) {
                    finalData[date] = toUsdMap[date] * fromUsdMap[date];
                }
            });
        }

        if (Object.keys(finalData).length > 0) {
            fxCache.history[key] = { data: finalData, timestamp: Date.now() };
            return finalData;
        }

    } catch (e) {
        console.error(`Failed to fetch FX history via pivot ${from}→${to}:`, e);
    }

    return {};
}

/**
 * Clear all cached data
 */
export function clearFxCache() {
    fxCache.current = {};
    fxCache.history = {};
    fxCache.assetHistory = {};
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
    const key = `${symbol.toUpperCase()}-${range}`;
    const cacheDuration = getCacheDuration(range);

    // Check cache
    if (isCacheValid(fxCache.assetHistory[key], cacheDuration)) {
        return fxCache.assetHistory[key].data;
    }

    // Fetch fresh data
    try {
        const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`);
        const json = await res.json();

        if (json.history && json.history.length > 0) {
            const data = json.history
                .filter(d => d.price !== null && d.price !== undefined && d.price > 0)
                .map(d => ({
                    date: d.date,
                    price: d.price
                }));

            // Update cache
            fxCache.assetHistory[key] = {
                data,
                timestamp: Date.now()
            };

            return data;
        }
    } catch (e) {
        console.error(`Failed to fetch asset history for ${symbol}:`, e);
    }

    return [];
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
        assetHistoryEntries: Object.keys(fxCache.assetHistory).length
    };
}
