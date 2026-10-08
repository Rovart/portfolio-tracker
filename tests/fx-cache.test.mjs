import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import 'fake-indexeddb/auto';
import { clearFxCache, getCachedAssetHistory, getCachedFxHistory, getCachedQuotes, invalidateAssetCache } from '../src/utils/fxCache.js';
import { clearMarketCache, saveMarketResponse } from '../src/utils/market-cache.js';

const history = price => [{ date: '2026-10-01T12:00:00Z', price }];
const response = data => new Response(JSON.stringify({ history: data }), { headers: { 'Content-Type': 'application/json' } });
beforeEach(async () => { clearFxCache(); await clearMarketCache(); });
afterEach(() => { mock.restoreAll(); clearFxCache(); });

test('concurrent asset readers share one request and then reuse its cached history', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => response(history(100)));
    const results = await Promise.all(Array.from({ length: 10 }, () => getCachedAssetHistory('aapl', '1Y')));
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.ok(results.every(result => result === results[0]));
    assert.equal(await getCachedAssetHistory('AAPL', '1Y'), results[0]);
    assert.equal(fetchMock.mock.callCount(), 1);
});

test('FX and asset readers share the same history request', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => response(history(1.2)));
    const [fx, asset, anotherFx] = await Promise.all([
        getCachedFxHistory('EUR', 'USD', '1Y'),
        getCachedAssetHistory('EURUSD=X', '1Y'),
        getCachedFxHistory('EUR', 'USD', '1Y')
    ]);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(fx, { '2026-10-01': 1.2 });
    assert.equal(fx, anotherFx);
    assert.equal(asset[0].price, 1.2);
});

test('cross rates pivot through USD and retain inverse-pair fallback', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async url => {
        const symbol = new URL(url, 'http://localhost').searchParams.get('symbol');
        if (symbol === 'USDGBP=X') return response([]);
        return response(history(symbol === 'EURUSD=X' ? 1.2 : 1.5));
    });
    const [fx, eur] = await Promise.all([getCachedFxHistory('EUR', 'GBP', 'ALL'), getCachedFxHistory('EUR', 'USD', 'ALL')]);
    assert.ok(Math.abs(fx['2026-10-01'] - 0.8) < 1e-12);
    assert.equal(eur['2026-10-01'], 1.2);
    assert.equal(fetchMock.mock.callCount(), 3);
});

test('clearing or invalidating a pending history prevents stale data replacing a fresh result', async () => {
    for (const invalidate of [clearFxCache, () => invalidateAssetCache('AAPL')]) {
        clearFxCache();
        let releaseOld;
        let calls = 0;
        const pendingResponse = new Promise(resolve => { releaseOld = resolve; });
        const fetchMock = mock.method(globalThis, 'fetch', () => ++calls === 1 ? pendingResponse : Promise.resolve(response(history(200))));
        const oldRequest = getCachedAssetHistory('AAPL', '1Y');
        invalidate();
        assert.deepEqual(await getCachedAssetHistory('AAPL', '1Y'), history(200));
        releaseOld(response(history(100)));
        assert.deepEqual(await oldRequest, history(100));
        assert.deepEqual(await getCachedAssetHistory('AAPL', '1Y'), history(200));
        assert.equal(fetchMock.mock.callCount(), 2);
        mock.restoreAll();
    }
});

test('failed requests can be retried and malformed price data is discarded', async () => {
    let calls = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => ++calls === 1
        ? response([])
        : response([...history(100), { date: 'bad', price: 200 }, ...history(-1)]));
    assert.deepEqual(await getCachedAssetHistory('AAPL', '1Y'), []);
    assert.deepEqual(await getCachedAssetHistory('AAPL', '1Y'), history(100));
    assert.equal(fetchMock.mock.callCount(), 2);
});

test('a manual refresh invalidates histories immediately instead of waiting for their TTL', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => response(history(++calls * 100)));
    assert.equal((await getCachedAssetHistory('AAPL', 'ALL'))[0].price, 100);
    clearFxCache({ keepQuotes: true });
    assert.equal((await getCachedAssetHistory('AAPL', 'ALL'))[0].price, 200);
    assert.equal(calls, 2);
});

const quoteResponse = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
test('old quote responses cannot overwrite fresh quotes after invalidation or across overlapping symbol batches', async () => {
    for (const clear of [true, false]) {
        clearFxCache();
        await clearMarketCache();
        let releaseOld;
        let oldStarted;
        const started = new Promise(resolve => { oldStarted = resolve; });
        const delayed = new Promise(resolve => { releaseOld = resolve; });
        let calls = 0;
        mock.method(globalThis, 'fetch', async () => {
            if (++calls === 1) { oldStarted(); return delayed; }
            return quoteResponse([{ symbol: 'AAPL', price: 200 }]);
        });
        const old = getCachedQuotes(clear ? ['AAPL'] : ['AAPL', 'MSFT']);
        await started;
        if (clear) clearFxCache();
        assert.equal((await getCachedQuotes(['AAPL']))[0].price, 200);
        releaseOld(quoteResponse([{ symbol: 'AAPL', price: 100 }, { symbol: 'MSFT', price: 50 }]));
        await old;
        assert.equal((await getCachedQuotes(['AAPL']))[0].price, 200);
        assert.equal(calls, 2);
        mock.restoreAll();
    }
});

test('saved quotes survive changed portfolio batches and preserve their actual retrieval time', async () => {
    mock.method(globalThis, 'fetch', async () => quoteResponse([{ symbol: 'AAPL', price: 100 }]));
    const quote = (await getCachedQuotes(['AAPL']))[0];
    assert.equal(quote.isStale, false);
    assert.ok(quote.fetchedAt > 0);
    clearFxCache();
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
    const saved = await getCachedQuotes(['MSFT', 'AAPL']);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].price, 100);
    assert.equal(saved[0].isStale, true);
    assert.equal(saved[0].fetchedAt, quote.fetchedAt);
});

test('large portfolios are batched and malformed quote prices cannot replace usable prices', async () => {
    const batches = [];
    mock.method(globalThis, 'fetch', async url => {
        const symbols = new URL(url, 'http://localhost').searchParams.get('symbols').split(',');
        batches.push(symbols);
        return quoteResponse(symbols.map(symbol => ({ symbol, price: symbol === 'BAD' ? -1 : 100 })));
    });
    const quotes = await getCachedQuotes([...Array.from({ length: 401 }, (_, i) => `ASSET${i}`), 'BAD']);
    assert.equal(quotes.length, 401);
    assert.ok(batches.every(batch => batch.length <= 200));
    assert.equal(batches.length, 3);
});

test('an older saved batch cannot regress a newer per-symbol price during an outage', async () => {
    mock.method(Date, 'now', () => 1000);
    await saveMarketResponse('/api/quote?symbols=AAPL%2CMSFT', JSON.stringify({ data: [{ symbol: 'AAPL', price: 100 }] }), {});
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => quoteResponse([{ symbol: 'AAPL', price: 200 }]));
    const current = (await getCachedQuotes(['AAPL']))[0];
    clearFxCache({ keepQuotes: true });
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
    const saved = (await getCachedQuotes(['AAPL', 'MSFT']))[0];
    assert.equal(saved.price, 200);
    assert.equal(saved.fetchedAt, current.fetchedAt);
    assert.equal(saved.isStale, true);
});
