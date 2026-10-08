import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateHoldings, getCurrentAssetRate } from '../src/utils/portfolio-logic.js';
import { startMarketActivity } from '../src/utils/market-lifecycle.js';

const ledger = [{ date: '2026-10-08', type: 'BUY', baseCurrency: 'AAPL', baseAmount: 1,
    quoteAmount: 100, quoteCurrency: 'USD', affectsQuoteBalance: false }];

test('missing quotes never fabricate a zero valuation or a loss of the entire cost basis', () => {
    const holding = calculateHoldings(ledger, {})[0];
    assert.equal(holding.valuationUnavailable, true);
    assert.equal(holding.value, null);
    assert.equal(holding.price, null);
    assert.equal(holding.unrealizedProfit, null);
    assert.equal(holding.totalProfit, null);
    assert.equal(holding.costBasis, 100);
    assert.equal(getCurrentAssetRate({}, 'AAPL', 'USD'), null);
});

test('missing FX rates cannot label unconverted values as the selected currency', () => {
    const missing = calculateHoldings(ledger, { AAPL: { price: 150, currency: 'USD' } }, 'EUR')[0];
    assert.equal(missing.fxMissing, true);
    assert.equal(missing.value, null);
    const known = calculateHoldings(ledger, { AAPL: { price: 150, currency: 'USD', fetchedAt: 1234, isStale: true }, 'EURUSD=X': { price: 1.25 } }, 'EUR')[0];
    assert.equal(known.value, 120);
    assert.equal(known.isStale, true);
    assert.equal(known.fetchedAt, 1234);
});

test('visibility and Android activity pause updates; resuming and reconnecting invalidate freshness', async () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    documentTarget.hidden = false;
    let callback;
    let removed = 0;
    const nativeApp = { getState: async () => ({ isActive: true }), addListener: async (_event, listener) => {
        callback = listener; return { remove: () => { removed++; } };
    } };
    const changes = [];
    let refreshes = 0;
    const cleanup = startMarketActivity((active, resumed) => changes.push({ active, resumed }), {
        windowTarget, documentTarget, nativeApp, onResume: () => refreshes++
    });
    await Promise.resolve();
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    assert.equal(changes.at(-1).active, false);
    windowTarget.dispatchEvent(new Event('online'));
    assert.equal(refreshes, 0);
    callback({ isActive: false });
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    assert.equal(changes.at(-1).active, false);
    callback({ isActive: true });
    assert.equal(refreshes, 1);
    assert.equal(changes.at(-1).resumed, true);
    windowTarget.dispatchEvent(new Event('online'));
    assert.equal(refreshes, 2);
    cleanup();
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    assert.equal(changes.at(-1).active, true);
    assert.equal(removed, 1);
});

test('an Android listener that resolves after unmount is removed without updating the UI', async () => {
    let resolveHandle;
    let removed = 0;
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    documentTarget.hidden = false;
    const cleanup = startMarketActivity(() => {}, { windowTarget, documentTarget, onResume: () => {}, nativeApp: {
        getState: async () => ({ isActive: true }),
        addListener: () => new Promise(resolve => { resolveHandle = resolve; })
    } });
    cleanup();
    resolveHandle({ remove: () => removed++ });
    await Promise.resolve();
    assert.equal(removed, 1);
});
