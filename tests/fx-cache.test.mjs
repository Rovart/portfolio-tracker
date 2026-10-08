import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import 'fake-indexeddb/auto';
import { clearFxCache, getCachedAssetHistory, getCachedFxHistory, invalidateAssetCache } from '../src/utils/fxCache.js';
import { clearMarketCache } from '../src/utils/market-cache.js';

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
