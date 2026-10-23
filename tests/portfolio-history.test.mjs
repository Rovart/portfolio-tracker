import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePortfolioHistory, getPeriodReturn } from '../src/utils/portfolio-history.js';

const day = n => `2026-03-${String(n).padStart(2, '0')}`;
const prices = values => values.map((price, i) => ({ date: `${day(i + 1)}T00:00:00.000Z`, price }));
const buy = (date, amount, overrides = {}) => ({
    id: `${date}-${amount}`, type: 'BUY', date: `${date}T00:00:00.000Z`, baseCurrency: 'AAPL',
    baseAmount: amount, quoteAmount: amount * 100, quoteCurrency: 'USD', affectsQuoteBalance: false, ...overrides
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('a purchase paid outside the tracked cash is a contribution, not a gain', () => {
    // Flat price: buying more raises the value but must not show as return.
    const history = calculatePortfolioHistory(
        [buy(day(1), 1), buy(day(3), 4)],
        { AAPL: prices([100, 100, 100, 100]) },
        'USD',
        { AAPL: 'USD' }
    );
    const first = history[0];
    const last = history[history.length - 1];
    close(last.rawValue, 500);
    close(last.value / first.value, 1);
    close(last.netFlow - first.netFlow, 400);
    close((last.rawValue - first.rawValue) - (last.netFlow - first.netFlow), 0);
});

test('returns are time-weighted across contributions', () => {
    // +10% before the second purchase, then flat.
    const history = calculatePortfolioHistory(
        [buy(day(1), 1), buy(day(3), 1)],
        { AAPL: prices([100, 110, 110, 110]) },
        'USD',
        { AAPL: 'USD' }
    );
    const first = history[0];
    const last = history[history.length - 1];
    close(last.value / first.value, 1.1);
    close((last.rawValue - first.rawValue) - (last.netFlow - first.netFlow), 10);
});

test('a purchase settled from tracked cash is neither a flow nor a gain', () => {
    const history = calculatePortfolioHistory(
        [
            { id: 'cash', type: 'DEPOSIT', date: `${day(1)}T00:00:00.000Z`, baseCurrency: 'USD', baseAmount: 500 },
            buy(day(2), 2, { affectsQuoteBalance: true })
        ],
        { AAPL: prices([100, 100, 100]) },
        'USD',
        { AAPL: 'USD' }
    );
    const first = history[0];
    const last = history[history.length - 1];
    close(last.rawValue, 500);
    close(last.netFlow - first.netFlow, 0);
    close(last.value / first.value, 1);
});

test('period return weights contributions by the time they were invested', () => {
    const points = [
        { date: '2026-01-01T00:00:00Z', value: 1000, netFlow: 0 },
        { date: '2026-01-11T00:00:00Z', value: 3000, netFlow: 2000 },
        { date: '2026-01-21T00:00:00Z', value: 3150, netFlow: 2000 }
    ];
    const result = getPeriodReturn(points);
    close(result.diff, 150);
    // Average capital: 1000 for the whole period + 2000 for half of it.
    close(result.percent, 7.5);
    // A partial span only counts the flows inside it.
    close(getPeriodReturn(points, 1, 2).percent, 5);
    assert.deepEqual(getPeriodReturn([], 0, 0), { diff: 0, percent: 0 });
});

test('a gain never shows a negative return after a large contribution', () => {
    const points = [
        { date: '2026-01-01T00:00:00Z', value: 1000, netFlow: 0 },
        { date: '2026-01-02T00:00:00Z', value: 800, netFlow: 0 },
        { date: '2026-01-03T00:00:00Z', value: 10800, netFlow: 10000 },
        { date: '2026-01-31T00:00:00Z', value: 11300, netFlow: 10000 }
    ];
    const result = getPeriodReturn(points);
    close(result.diff, 300);
    assert.ok(result.percent > 0);
});

test('intraday points value each asset at its latest known price, never the day close', () => {
    // AAPL trades in :30 candles and BTC in :00 candles. The daily series also
    // carries the day's close (AAPL 120). At BTC-only instants AAPL must keep
    // its last intraday price instead of jumping to that close.
    const tx = [
        buy('2026-03-01', 1),
        { id: 'btc', type: 'BUY', date: '2026-03-01T00:00:00.000Z', baseCurrency: 'BTC-USD', baseAmount: 1, quoteAmount: 50, quoteCurrency: 'USD', affectsQuoteBalance: false }
    ];
    const history = calculatePortfolioHistory(tx, {
        AAPL: [
            { date: '2026-03-01', price: 100 },
            { date: '2026-03-02T14:30:00.000Z', price: 101 },
            { date: '2026-03-02T15:30:00.000Z', price: 102 },
            { date: '2026-03-02', price: 120 }
        ],
        'BTC-USD': [
            { date: '2026-03-01', price: 50 },
            { date: '2026-03-02T15:00:00.000Z', price: 50 },
            { date: '2026-03-02T16:00:00.000Z', price: 50 }
        ]
    }, 'USD', { AAPL: 'USD', 'BTC-USD': 'USD' });

    const at = date => history.find(point => point.date === date)?.rawValue;
    close(at('2026-03-02T14:30:00.000Z'), 151);
    close(at('2026-03-02T15:00:00.000Z'), 151);
    close(at('2026-03-02T15:30:00.000Z'), 152);
    close(at('2026-03-02T16:00:00.000Z'), 152);
    // The bare date is the close, valued at the end of that day.
    close(at('2026-03-02'), 170);
});
