import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTransactionMarkers,
    downsampleChartData,
    findLatestPricePosition,
    getTransactionExecutionPrice
} from '../src/utils/chart-data.js';

const points = values => values.map((value, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    value
}));
const trade = overrides => ({
    id: 'sale', type: 'SELL', date: '2026-10-02T16:00:00Z',
    baseCurrency: 'AAPL', baseAmount: 2, quoteCurrency: 'USD', quoteAmount: 220,
    executionPrice: 110, ...overrides
});

test('finds the newest price crossing, even when an older point is an exact match', () => {
    assert.equal(findLatestPricePosition(points([110, 120, 100, 120]), 110), 2.5);
    assert.equal(findLatestPricePosition(points([100, 120, 100, 110]), 110), 3);
});

test('interpolates both rising and falling segments and uses the newest point on a plateau', () => {
    assert.equal(findLatestPricePosition(points([100, 120]), 105), 0.25);
    assert.equal(findLatestPricePosition(points([120, 100]), 105), 0.75);
    assert.equal(findLatestPricePosition(points([110, 110, 110]), 110), 2);
    assert.equal(findLatestPricePosition([], 110), null);
});

test('a sale on an earlier date is drawn at its execution price at the latest crossing', () => {
    const markers = buildTransactionMarkers(points([100, 130, 100, 120]), [trade()]);
    assert.equal(markers[0].x, 2.5);
    assert.equal(markers[0].y, 110);
    assert.equal(markers[0].date, '2026-10-02T16:00:00Z');
    assert.equal(markers[0].isBuy, false);
});

test('unreachable executions stay on the curve at the nearest price, with newest ties', () => {
    const markers = buildTransactionMarkers(points([100, 120, 120]), [trade({ executionPrice: 150 })]);
    assert.equal(markers[0].x, 2);
    assert.equal(markers[0].y, 120);
    assert.equal(markers[0].executionPrice, 150);
    const lower = buildTransactionMarkers(points([100, 120, 100]), [trade({ executionPrice: 80 })]);
    assert.equal(lower[0].x, 2);
    assert.equal(lower[0].y, 100);
    assert.equal(lower[0].executionPrice, 80);
});

test('every buy/sell marker lies on its displayed segment, including unreachable prices', () => {
    const curve = points([100, 130, 100, 120]);
    const prices = [70, 100, 105, 110, 120, 125, 130, 150];
    const markers = buildTransactionMarkers(curve, prices.map((price, i) => trade({ id: i, executionPrice: price })));
    for (const marker of markers) {
        const left = Math.floor(marker.x);
        const right = Math.ceil(marker.x);
        const curvePrice = curve[left].value + (curve[right].value - curve[left].value) * (marker.x - left);
        assert.ok(Math.abs(marker.y - curvePrice) < 1e-10);
    }
});

test('only visible valid operations appear, and unpriced trades do not claim a market price', () => {
    const markers = buildTransactionMarkers(points([100, 120, 110]), [
        trade({ id: 'old', date: '2026-09-30', executionPrice: 110 }),
        trade({ id: 'future', date: '2026-10-04', executionPrice: 110 }),
        trade({ id: 'invalid', date: 'bad-date' }),
        trade({ id: 'missing', executionPrice: null }),
        trade({ id: 'buy', type: 'BUY' }),
        trade({ id: 'deposit', type: 'DEPOSIT', executionPrice: null })
    ]);
    assert.deepEqual(markers.map(marker => marker.id), ['buy', 'deposit']);
    assert.equal(markers[0].isBuy, true);
    assert.equal(markers[1].x, 1);
    assert.equal(markers[1].y, 120);
});

test('intraday price matching considers every point instead of just the first point of the day', () => {
    const intraday = [100, 120, 100, 120].map((value, index) => ({
        date: `2026-10-02T${12 + index}:00:00Z`, value
    }));
    assert.equal(buildTransactionMarkers(intraday, [trade()])[0].x, 2.5);
});

test('execution prices exclude fees and convert quote currency at the transaction date', () => {
    assert.equal(getTransactionExecutionPrice(trade({ fee: 10 }), 'USD', () => { throw new Error('Unneeded conversion'); }), 110);
    const price = getTransactionExecutionPrice(trade({ quoteCurrency: 'EUR', quoteAmount: 200 }), 'USD', (currency, date) => {
        assert.equal(currency, 'EUR');
        assert.equal(date, '2026-10-02');
        return 1.2;
    });
    assert.equal(price, 120);
    assert.equal(getTransactionExecutionPrice(trade({ quoteCurrency: 'ETH', quoteAmount: 0.1 }), 'USD', () => 2000), 100);
});

test('missing rates or amounts cannot fabricate execution prices; pair quotes are inferred', () => {
    assert.equal(getTransactionExecutionPrice(trade({ baseAmount: 0 }), 'USD', () => 1), null);
    assert.equal(getTransactionExecutionPrice(trade({ quoteAmount: null }), 'USD', () => 1), null);
    assert.equal(getTransactionExecutionPrice(trade({ quoteCurrency: 'EUR' }), 'USD', () => null), null);
    assert.equal(getTransactionExecutionPrice(trade({ baseCurrency: 'BTC-EUR', quoteCurrency: null }), 'USD', currency => {
        assert.equal(currency, 'EUR');
        return 2;
    }), 220);
});

test('sampling stays bounded and preserves first/last points, peaks, troughs and ordering', () => {
    const history = Array.from({ length: 10000 }, (_, index) => ({ date: index, value: 100 }));
    history[1111].value = 1;
    history[8888].value = 1000;
    const sampled = downsampleChartData(history);
    assert.ok(sampled.length <= 300);
    assert.equal(sampled[0], history[0]);
    assert.equal(sampled.at(-1), history.at(-1));
    assert.ok(sampled.includes(history[1111]));
    assert.ok(sampled.includes(history[8888]));
    assert.ok(sampled.every((point, index) => index === 0 || point.date > sampled[index - 1].date));
    assert.equal(downsampleChartData(sampled), sampled);
    assert.deepEqual(downsampleChartData(null), []);
});
