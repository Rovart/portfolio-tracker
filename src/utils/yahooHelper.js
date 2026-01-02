/**
 * Yahoo Finance Helper with Rate-Limit Evasion
 * 
 * yahoo-finance2 v3.11.1+ has built-in UA fix, so we trust library defaults.
 * Custom UA is only applied as a fallback when rate-limiting is detected.
 */

import YahooFinance from 'yahoo-finance2';

// Fallback User-Agent strings (used only on retry after rate limit)
const FALLBACK_USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; PortfolioTracker/1.0)',
];

// Get a random fallback User-Agent
export function getRandomUserAgent() {
    return FALLBACK_USER_AGENTS[Math.floor(Math.random() * FALLBACK_USER_AGENTS.length)];
}

// Random delay to avoid detection (100ms - 500ms)
export function randomDelay() {
    const delay = 100 + Math.random() * 400;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// Longer random delay for retries (1s - 3s)
export function retryDelay(attempt) {
    const baseDelay = 1000 * Math.pow(2, attempt); // Exponential backoff
    const jitter = Math.random() * 1000; // Add some randomness
    return new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
}

// Default instance - trusts library's built-in UA (v3.11.1+)
let defaultInstance = null;

function getDefaultInstance() {
    if (!defaultInstance) {
        defaultInstance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    }
    return defaultInstance;
}

// Create a fallback instance with custom UA (used after rate limit failure)
function createFallbackInstance() {
    const userAgent = getRandomUserAgent();

    const customFetch = async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        headers.set('User-Agent', userAgent);
        return fetch(url, { ...options, headers });
    };

    return new YahooFinance({
        suppressNotices: ['yahooSurvey'],
        fetch: customFetch,
        fetchOptions: {
            headers: { 'User-Agent': userAgent }
        }
    });
}

// Track if we've had to switch to fallback mode
let useFallbackMode = false;
let fallbackInstance = null;

// Get the appropriate instance
export function getYahooInstance() {
    if (useFallbackMode) {
        if (!fallbackInstance) {
            fallbackInstance = createFallbackInstance();
        }
        return { instance: fallbackInstance };
    }
    return { instance: getDefaultInstance() };
}

// Wrapper for Yahoo Finance API calls with retry logic
export async function yahooApiCall(apiMethod, args, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const initialDelay = options.initialDelay !== false;

    if (initialDelay) {
        await randomDelay();
    }

    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const { instance } = getYahooInstance();
            const result = await apiMethod(instance, ...args);
            return result;
        } catch (error) {
            lastError = error;

            const isRateLimit =
                error.message?.includes('429') ||
                error.message?.toLowerCase().includes('rate') ||
                error.message?.toLowerCase().includes('too many') ||
                error.message?.toLowerCase().includes('throttle') ||
                error.code === 'ECONNRESET';

            if (isRateLimit && attempt < maxRetries - 1) {
                console.warn(`Yahoo API rate limited (attempt ${attempt + 1}/${maxRetries}), retrying...`);

                // Switch to fallback mode with custom UA
                if (!useFallbackMode) {
                    console.warn('Switching to fallback UA mode');
                    useFallbackMode = true;
                    fallbackInstance = createFallbackInstance();
                } else {
                    // Rotate fallback instance
                    fallbackInstance = createFallbackInstance();
                }

                await retryDelay(attempt);
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

// For backward compatibility
export function getDefaultYahooInstance() {
    return getDefaultInstance();
}

// Reset fallback mode (for testing or manual reset)
export function resetFallbackMode() {
    useFallbackMode = false;
    fallbackInstance = null;
}

export default {
    getRandomUserAgent,
    randomDelay,
    retryDelay,
    getYahooInstance,
    yahooApiCall,
    getDefaultYahooInstance,
    resetFallbackMode,
    FALLBACK_USER_AGENTS
};
