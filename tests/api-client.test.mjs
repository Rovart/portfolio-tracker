import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import Dexie from 'dexie';
import { apiFetch, apiUrl } from '../src/utils/api-client.js';
import { clearMarketCache, readMarketResponse, saveMarketResponse } from '../src/utils/market-cache.js';

const endpoint = '/api/history?symbol=AAPL&range=1Y';
const payload = { history: [{ date: '2026-10-01T12:00:00Z', price: 100 }] };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => clearMarketCache());
afterEach(() => mock.restoreAll());

test('API URLs stay relative by default and reject paths outside the local API', () => {
    assert.equal(apiUrl(endpoint, ''), endpoint);
    assert.equal(apiUrl(endpoint, 'https://example.com/'), `https://example.com${endpoint}`);
    assert.throws(() => apiUrl('https://other.example/api/history'), /endpoint/);
});

test('market responses survive a new database connection and a network outage', async () => {
    mock.method(globalThis, 'fetch', async () => response(payload));
    assert.deepEqual(await (await apiFetch(endpoint)).json(), payload);
    const reopened = new Dexie('MonetraMarketCache');
    reopened.version(1).stores({ responses: 'url, timestamp' });
    assert.equal(JSON.parse((await reopened.table('responses').get(endpoint)).body).history[0].price, 100);
    reopened.close();
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network unavailable'); });
    const offline = await apiFetch(endpoint);
    assert.equal(offline.headers.get('X-Monetra-Cache'), 'offline');
    assert.ok(Number(offline.headers.get('X-Monetra-Cached-At')) > 0);
    assert.deepEqual(await offline.json(), payload);
});

test('an empty history or upstream error retains saved prices; fresh data replaces them', async () => {
    await saveMarketResponse(endpoint, JSON.stringify(payload), { 'Content-Type': 'application/json' });
    for (const result of [response({ history: [] }), new Response('Failed', { status: 502 })]) {
        mock.method(globalThis, 'fetch', async () => result);
        assert.deepEqual(await (await apiFetch(endpoint)).json(), payload);
        mock.restoreAll();
    }
    const fresh = { history: [{ date: '2026-10-02T12:00:00Z', price: 200 }] };
    mock.method(globalThis, 'fetch', async () => response(fresh));
    assert.equal((await apiFetch(endpoint)).headers.get('X-Monetra-Cache'), null);
    assert.deepEqual(JSON.parse((await readMarketResponse(endpoint)).body), fresh);
});

test('an older slow response cannot overwrite the persistent cache after a newer refresh', async () => {
    let releaseOld;
    let oldStarted;
    const started = new Promise(resolve => { oldStarted = resolve; });
    const oldResponse = new Promise(resolve => { releaseOld = resolve; });
    let requests = 0;
    const fresh = { history: [{ date: '2026-10-02T12:00:00Z', price: 200 }] };
    mock.method(globalThis, 'fetch', async () => {
        if (++requests === 1) { oldStarted(); return oldResponse; }
        return response(fresh);
    });
    const old = apiFetch(endpoint);
    await started;
    await apiFetch(endpoint);
    releaseOld(response(payload));
    await old;
    assert.deepEqual(JSON.parse((await readMarketResponse(endpoint)).body), fresh);
});

test('offline restart avoids network requests and cancellation is respected', async t => {
    await saveMarketResponse(endpoint, JSON.stringify(payload), {});
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => false });
    t.after(() => { delete globalThis.navigator.onLine; });
    const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
    assert.deepEqual(await (await apiFetch(endpoint)).json(), payload);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(apiFetch(endpoint, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(fetchMock.mock.callCount(), 0);
});

test('POST requests and failures without saved data do not become cached successes', async () => {
    mock.method(globalThis, 'fetch', async () => response(payload));
    await apiFetch(endpoint, { method: 'POST', body: 'private-data' });
    assert.equal(await readMarketResponse(endpoint), null);
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network unavailable'); });
    await assert.rejects(apiFetch(endpoint), /Network unavailable/);
});

test('market cache bounds disk usage and evicts the oldest responses', async () => {
    let time = 1000;
    mock.method(Date, 'now', () => ++time);
    for (let i = 0; i < 101; i++) await saveMarketResponse(`/api/quote?symbols=${i}`, '{}', {});
    assert.equal(await readMarketResponse('/api/quote?symbols=0'), null);
    assert.ok(await readMarketResponse('/api/quote?symbols=100'));
    await saveMarketResponse('/api/history?symbol=oversized', 'x'.repeat(2 * 1024 * 1024 + 1), {});
    assert.equal(await readMarketResponse('/api/history?symbol=oversized'), null);
});
