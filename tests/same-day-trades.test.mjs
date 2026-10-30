import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAssetAccounting } from '../src/utils/portfolio-logic.js';

// Manual entries: midnight dates, random string ids, newest first as the app holds them.
const trade = (type, price, overrides = {}) => ({
    id: `${type.toLowerCase()}x9k2`, date: '2026-10-30T00:00:00.000Z', type, baseCurrency: 'AMZN',
    baseAmount: 25, quoteAmount: 25 * price, quoteCurrency: 'EUR', affectsQuoteBalance: false, ...overrides
});

test('a same-day sell closes the buy it follows instead of running ahead of it', () => {
    const ledger = [
        trade('SELL', 214.95, { createdAt: '2026-10-30T15:00:00.000Z' }),
        trade('BUY', 204, { createdAt: '2026-10-30T14:00:00.000Z' })
    ];
    const accounting = calculateAssetAccounting(ledger, 'AMZN', 'EUR');
    assert.equal(accounting.currentBalance, 0);
    assert.equal(accounting.oversoldQuantity, 0);
    assert.equal(accounting.remainingCostBasis, 0);
    assert.ok(Math.abs(accounting.realizedPnl - 273.75) < 1e-9);
});

test('same-day trades without an entry time still put the buy before the sell', () => {
    const accounting = calculateAssetAccounting([trade('SELL', 214.95), trade('BUY', 204)], 'AMZN', 'EUR');
    assert.equal(accounting.remainingCostBasis, 0);
    assert.ok(Math.abs(accounting.realizedPnl - 273.75) < 1e-9);
});

