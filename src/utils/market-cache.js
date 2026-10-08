import Dexie from 'dexie';

const cache = new Dexie('MonetraMarketCache');
cache.version(1).stores({ responses: 'url, timestamp' });
cache.version(2).stores({ responses: 'url, timestamp', quotes: 'symbol, timestamp' });
const MAX_ENTRIES = 100;
const MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;

export async function readMarketResponse(url) {
    if (typeof indexedDB === 'undefined') return null;
    try {
        return await cache.responses.get(url) || null;
    } catch {
        return null;
    }
}

export async function saveMarketResponse(url, body, headers) {
    if (typeof indexedDB === 'undefined' || body.length > MAX_RESPONSE_LENGTH) return;
    try {
        await cache.transaction('rw', cache.responses, async () => {
            await cache.responses.put({ url, body, headers, timestamp: Date.now() });
            const excess = await cache.responses.count() - MAX_ENTRIES;
            if (excess > 0) {
                const oldest = await cache.responses.orderBy('timestamp').limit(excess).primaryKeys();
                await cache.responses.bulkDelete(oldest);
            }
        });
    } catch {
        // Cache storage failure must not prevent displaying fresh market data.
    }
}

export async function clearMarketCache() {
    if (typeof indexedDB !== 'undefined') await cache.transaction('rw', cache.responses, cache.quotes, async () => {
        await cache.responses.clear();
        await cache.quotes.clear();
    });
}

export async function readMarketQuotes(symbols) {
    if (typeof indexedDB === 'undefined') return [];
    try {
        return (await cache.quotes.bulkGet(symbols)).filter(Boolean).map(row => row.data);
    } catch { return []; }
}

export async function saveMarketQuotes(quotes) {
    if (typeof indexedDB === 'undefined' || !quotes.length) return;
    try {
        await cache.transaction('rw', cache.quotes, async () => {
            for (const quote of quotes) {
                const previous = await cache.quotes.get(quote.symbol);
                if (!previous || previous.timestamp <= quote.fetchedAt) {
                    await cache.quotes.put({ symbol: quote.symbol, data: quote, timestamp: quote.fetchedAt });
                }
            }
            const excess = await cache.quotes.count() - 1000;
            if (excess > 0) await cache.quotes.bulkDelete(await cache.quotes.orderBy('timestamp').limit(excess).primaryKeys());
        });
    } catch { /* Quote persistence must not prevent displaying market data. */ }
}
