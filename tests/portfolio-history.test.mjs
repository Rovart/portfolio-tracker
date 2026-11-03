import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePortfolioHistory, getPeriodReturn, toReturnSeries } from '../src/utils/portfolio-history.js';

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
        [buy(day(1), 1), buy(day(3), 1, { quoteAmount: 110 })],
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

test('a trade outside the tracked cash counts what was actually paid and received', () => {
    const trade = (type, date, price, overrides = {}) => ({
        id: `${type}-${date}`, type, date: `${date}T00:00:00.000Z`, baseCurrency: 'AAPL',
        baseAmount: 10, quoteAmount: 10 * price, quoteCurrency: 'USD', affectsQuoteBalance: false, ...overrides
    });
    const gain = transactions => {
        const history = calculatePortfolioHistory(transactions, {
            AAPL: prices([120, 120, 120, 120]), MSFT: prices([100, 100, 100, 100])
        }, 'USD', { AAPL: 'USD', MSFT: 'USD' }).map(point => ({ ...point, value: point.rawValue }));
        return getPeriodReturn(history).diff;
    };
    const other = { ...trade('BUY', day(1), 100), id: 'other', baseCurrency: 'MSFT' };

    // Bought below the market, still held.
    close(gain([other, trade('BUY', day(2), 100)]), 200);
    // The fee was paid outside the portfolio too.
    close(gain([other, trade('BUY', day(2), 100, { fee: 5, feeCurrency: 'USD' })]), 195);
    // Closed on the same day: the whole gain left with the proceeds.
    close(gain([other, trade('BUY', day(2), 100), trade('SELL', day(2), 110)]), 100);
    // Without a recorded price there is nothing to compare with the market.
    close(gain([other, trade('BUY', day(2), 100, { quoteAmount: 0, quoteCurrency: null })]), 0);
});

test('the whole history counts the gain since the first purchase', () => {
    // Paid 100, worth 120 by that day's close, 130 at the end.
    const history = calculatePortfolioHistory(
        [buy(day(1), 1)],
        { AAPL: prices([120, 125, 130]) },
        'USD',
        { AAPL: 'USD' }
    ).map(point => ({ ...point, value: point.rawValue }));
    close(getPeriodReturn(history).diff, 30);
    close(getPeriodReturn(history).percent, 30);
    // A position with no price yet at its date has no paid amount to compare with.
    const unpriced = calculatePortfolioHistory(
        [buy('2026-02-01', 1)],
        { AAPL: prices([120, 125, 130]) },
        'USD',
        { AAPL: 'USD' }
    ).map(point => ({ ...point, value: point.rawValue }));
    close(getPeriodReturn(unpriced).diff, 10);
});

test('selling everything and buying again is not a loss of the whole amount', () => {
    const trade = (type, date) => buy(date, 2, { id: `${type}-${date}`, type, quoteAmount: 200 });
    const history = calculatePortfolioHistory(
        [trade('BUY', day(1)), trade('SELL', day(2)), trade('BUY', day(3))],
        { AAPL: prices([100, 100, 100, 95]) },
        'USD',
        { AAPL: 'USD' }
    ).map(point => ({ ...point, value: point.rawValue }));
    close(getPeriodReturn(history).diff, -10);
});

test('the return line ignores deposits and ends at the gain of the range', () => {
    const points = [
        { date: '2026-01-01T00:00:00Z', value: 1000, netFlow: 1000 },
        { date: '2026-01-02T00:00:00Z', value: 980, netFlow: 1000 },
        // A large deposit lifts the total while the investments keep falling.
        { date: '2026-01-03T00:00:00Z', value: 5960, netFlow: 6000 },
        // A withdrawal lowers it while they recover.
        { date: '2026-01-04T00:00:00Z', value: 3990, netFlow: 4000 }
    ];
    const series = toReturnSeries(points);
    assert.deepEqual(series.map(point => point.value), [0, -20, -40, -10]);
    assert.deepEqual(series.map(point => point.total), [1000, 980, 5960, 3990]);
    series.forEach((point, index) => close(point.value, getPeriodReturn(points, 0, index).diff));
    assert.deepEqual(toReturnSeries([]), []);
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
