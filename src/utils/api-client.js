import { readMarketResponse, saveMarketResponse } from './market-cache.js';

let nativeApi;
const pendingResponses = new Map();

async function marketRequest(endpoint, options) {
    if (process.env.NEXT_PUBLIC_BUNDLED_APP !== 'true') return fetch(apiUrl(endpoint), options);
    nativeApi ||= import('./native-market.js').then(({ createNativeMarketApi }) => createNativeMarketApi());
    const request = (await nativeApi)(endpoint, options);
    if (!options.signal) return request;
    return new Promise((resolve, reject) => {
        const aborted = () => reject(options.signal.reason || new DOMException('Request aborted', 'AbortError'));
        if (options.signal.aborted) { aborted(); return; }
        options.signal.addEventListener('abort', aborted, { once: true });
        request.then(resolve, reject).finally(() => options.signal.removeEventListener('abort', aborted));
    });
}

export function apiUrl(endpoint, baseUrl = '') {
    if (!endpoint.startsWith('/api/')) throw new Error('Expected an /api/ endpoint.');
    return `${baseUrl.replace(/\/$/, '')}${endpoint}`;
}

function reportMarketStatus(url, saved) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('monetra:market-status', { detail: { url, saved } }));
}

function cachedResponse(entry) {
    reportMarketStatus(entry.url, true);
    const headers = new Headers(entry.headers);
    headers.set('X-Monetra-Cache', 'offline');
    headers.set('X-Monetra-Cached-At', String(entry.timestamp));
    return new Response(entry.body, { status: 200, headers });
}

// The bundled app runs its market API locally, using explicit native HTTP calls.
// GET responses are retained locally so cached prices/history survive an offline restart.
export async function apiFetch(endpoint, options = {}) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Request aborted', 'AbortError');
    apiUrl(endpoint); // Validate local API paths for both transports.
    const url = process.env.NEXT_PUBLIC_BUNDLED_APP === 'true' ? `native:${endpoint}` : apiUrl(endpoint);
    const canCache = typeof indexedDB !== 'undefined' && (!options.method || options.method.toUpperCase() === 'GET');
    const saved = canCache ? await readMarketResponse(url) : null;
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Request aborted', 'AbortError');
    if (saved && typeof navigator !== 'undefined' && navigator.onLine === false) return cachedResponse(saved);

    const token = {};
    pendingResponses.set(url, token);
    try {
        const response = await marketRequest(endpoint, options);
        if (response.ok && canCache) {
            const copy = response.clone();
            const body = await copy.text();
            // Empty results must not replace a useful cached history after an upstream failure.
            let useful = true;
            try {
                const json = JSON.parse(body);
                if (Array.isArray(json.history) && json.history.length === 0) useful = false;
                if (Array.isArray(json.data) && json.data.length === 0) useful = false;
            } catch { useful = false; }
            if (useful) {
                if (pendingResponses.get(url) === token && !options.signal?.aborted) {
                    await saveMarketResponse(url, body, Object.fromEntries(copy.headers));
                    reportMarketStatus(url, false);
                }
            }
            else if (saved) return cachedResponse(saved);
        } else if (!response.ok && saved) {
            return cachedResponse(saved);
        }
        if (response.ok) {
            const headers = new Headers(response.headers);
            headers.set('X-Monetra-Fetched-At', String(Date.now()));
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }
        return response;
    } catch (error) {
        if (saved && !options.signal?.aborted) return cachedResponse(saved);
        throw error;
    } finally {
        if (pendingResponses.get(url) === token) pendingResponses.delete(url);
    }
}
