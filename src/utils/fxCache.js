'use client';

// Global cache for FX data to avoid redundant API calls
const fxCache = {
    current: {}, // { 'EUR-USD': { rate: 1.04, timestamp: Date.now() } }
    history: {}  // { 'EUR-USD': { data: {...}, timestamp: Date.now() } }
};

const CURRENT_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const HISTORY_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

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
    if (isCacheValid(fxCache.current[key], CURRENT_CACHE_DURATION)) {
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

    // Check cache
    if (isCacheValid(fxCache.history[key], HISTORY_CACHE_DURATION)) {
        return fxCache.history[key].data;
    }

    // Fetch fresh data
    try {
        const symbol = `${from}${to}=X`;
        const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`);
        const json = await res.json();

        if (json.history && json.history.length > 0) {
            const data = {};
            json.history.forEach(d => {
                data[d.date.split('T')[0]] = d.price;
            });

            // Update cache
            fxCache.history[key] = {
                data,
                timestamp: Date.now()
            };

            return data;
        }
    } catch (e) {
        console.error(`Failed to fetch FX history ${from}→${to}:`, e);
    }

    return {};
}

/**
 * Clear all cached FX data
 */
export function clearFxCache() {
    fxCache.current = {};
    fxCache.history = {};
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
