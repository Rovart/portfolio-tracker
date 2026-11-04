import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateHoldings, getCurrentAssetRate } from '../src/utils/portfolio-logic.js';
import { calculatePortfolioHistory } from '../src/utils/portfolio-history.js';
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

test('a crypto position quoted only in EUR stays in the history and matches the live total', () => {
    const transactions = [
        { id: 1, date: '2026-03-01', type: 'DEPOSIT', baseCurrency: 'EUR', baseAmount: 1000 },
        { id: 2, date: '2026-03-02', type: 'BUY', baseCurrency: 'XTZ-EUR', baseAmount: 2000,
            quoteCurrency: 'EUR', quoteAmount: 500, affectsQuoteBalance: true }
    ];
    const quotes = { 'XTZ-EUR': { price: 0.25, currency: 'EUR', quoteType: 'CRYPTOCURRENCY' } };
    const holdings = calculateHoldings(transactions, quotes, 'EUR');
    const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
    const history = calculatePortfolioHistory(transactions, {
        'XTZ-EUR': ['2026-03-01', '2026-03-02', '2026-03-03'].map(date => ({ date, price: 0.25 }))
    }, 'EUR', { 'XTZ-EUR': 'EUR' }, asset => getCurrentAssetRate(quotes, asset, 'EUR'));

    assert.equal(total, 1000);
    assert.equal(getCurrentAssetRate(quotes, 'XTZ', 'EUR'), 0.25);
    assert.ok(history.length >= 3);
    assert.ok(history.every(point => point.rawValue === total), 'no position disappears before the live point');
});

test('a non-USD crypto pair uses its own currency and keeps USD pricing preferred when available', () => {
    const quotes = {
        'BTC-AUD': { price: 100000, currency: 'AUD' },
        'AUDUSD=X': { price: 0.65 },
        'EURUSD=X': { price: 1.25 }
    };
    assert.equal(getCurrentAssetRate(quotes, 'BTC', 'EUR'), 52000);
    assert.equal(getCurrentAssetRate({ 'BTC-AUD': quotes['BTC-AUD'] }, 'BTC', 'EUR'), null);
    quotes['BTC-USD'] = { price: 66000, currency: 'USD' };
    assert.equal(getCurrentAssetRate(quotes, 'BTC', 'EUR'), 52800);
});

test('holdings can use another quoted pair when their original crypto pair is unavailable', () => {
    const transactions = [{ ...ledger[0], baseCurrency: 'XTZ-USD', baseAmount: 10 }];
    const quotes = { 'XTZ-EUR': { price: 0.25, currency: 'EUR' }, 'EURUSD=X': { price: 1.25 } };
    const holding = calculateHoldings(transactions, quotes, 'EUR')[0];
    assert.equal(holding.value, 2.5);
    assert.equal(holding.valuationUnavailable, false);
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
