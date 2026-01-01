/**
 * Yahoo Finance Helper with Rate-Limit Evasion
 * 
 * Implements:
 * - Rotating User-Agents to mimic different browsers
 * - Random delays between requests
 * - Exponential backoff retry logic
 * - Cookie/session rotation
 */

import YahooFinance from 'yahoo-finance2';

// Pool of realistic User-Agent strings (updated for 2025/2026)
// Pool of realistic User-Agent strings (updated for 2025/2026)
const USER_AGENTS = [
    // Standard Chrome 120 User-Agent (Widely used, less likely to be profiled as bot or future-fake)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    /*
    // Modern macOS User Agents
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',

    // Modern Windows User Agents
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',

    // Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    */
];

// Get a random User-Agent
export function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

// Create a new Yahoo Finance instance with rotating headers
let instanceCounter = 0;
const instances = new Map();

export function createYahooInstance() {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    const config = {
        suppressNotices: ['yahooSurvey'],
        fetchOptions: {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            }
        }
    };

    const instance = new YahooFinance(config);

    // Track instance for potential cleanup
    instanceCounter++;
    const id = instanceCounter;
    instances.set(id, { instance, userAgent, createdAt: Date.now() });

    // Clean up old instances (keep only last 10)
    if (instances.size > 10) {
        const oldestKey = instances.keys().next().value;
        instances.delete(oldestKey);
    }

    return { instance, userAgent, id };
}

// Get or create a fresh instance (rotates every 10 requests)
let requestCount = 0;
let currentInstance = null;

export function getYahooInstance() {
    // Use a persistent instance (Singleton) to minimize 'get crumb' handshakes
    // Only verify we have one, never auto-rotate on count
    if (!currentInstance) {
        currentInstance = createYahooInstance();
    }

    return currentInstance;
}

// Wrapper for Yahoo Finance API calls with retry logic
export async function yahooApiCall(apiMethod, args, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const initialDelay = options.initialDelay !== false;

    // Add initial random delay to avoid burst patterns
    if (initialDelay) {
        await randomDelay();
    }

    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const { instance } = getYahooInstance();

            // Make the API call
            const result = await apiMethod(instance, ...args);

            return result;
        } catch (error) {
            lastError = error;

            // Check if it's a rate limit error
            const isRateLimit =
                error.message?.includes('429') ||
                error.message?.toLowerCase().includes('rate') ||
                error.message?.toLowerCase().includes('too many') ||
                error.message?.toLowerCase().includes('throttle') ||
                error.code === 'ECONNRESET';

            if (isRateLimit && attempt < maxRetries - 1) {
                console.warn(`Yahoo API rate limited (attempt ${attempt + 1}/${maxRetries}), retrying...`);

                // Force new instance on rate limit
                currentInstance = createYahooInstance();

                // Exponential backoff
                await retryDelay(attempt);
                continue;
            }

            // For other errors or last retry, throw
            throw error;
        }
    }

    throw lastError;
}

// Cached instance for backward compatibility
let defaultInstance = null;

export function getDefaultYahooInstance() {
    if (!defaultInstance) {
        defaultInstance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    }
    return defaultInstance;
}

// Export default singleton for simpler usage (with rate limit awareness)
export default {
    getRandomUserAgent,
    randomDelay,
    retryDelay,
    createYahooInstance,
    getYahooInstance,
    yahooApiCall,
    getDefaultYahooInstance,
    USER_AGENTS
};
