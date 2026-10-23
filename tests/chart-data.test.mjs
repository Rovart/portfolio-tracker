import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTransactionMarkers,
    downsampleChartData,
    getMarkerKeepIndices,
    getTransactionExecutionPrice,
    mapMarkersToSampled,
    MARKER_LOOKBACK_DAYS
} from '../src/utils/chart-data.js';

const points = values => values.map((value, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    value
}));
const dailyPoints = (values, start = '2026-01-01') => values.map((value, index) => ({
    date: new Date(Date.parse(`${start}T14:30:00Z`) + index * 86400000).toISOString(),
    value
}));
const trade = overrides => ({
    id: 'sale', type: 'SELL', date: '2026-10-02T16:00:00Z',
    baseCurrency: 'AAPL', baseAmount: 2, quoteCurrency: 'USD', quoteAmount: 220,
    executionPrice: 110, ...overrides
});
const curveAt = (curve, x) => {
    const left = Math.floor(x);
    const right = Math.ceil(x);
    return curve[left].value + (curve[right].value - curve[left].value) * (x - left);
};

test('the operation date wins over later points with the same price', () => {
    // 110 is crossed on its own day (100 -> 130) and again on later days.
    const markers = buildTransactionMarkers(points([100, 130, 100, 120]), [trade()]);
    assert.ok(Math.abs(markers[0].x - 1 / 3) < 1e-12);
    assert.equal(markers[0].y, 110);
    assert.equal(markers[0].match, 'date');
    assert.equal(markers[0].date, '2026-10-02T16:00:00Z');
    assert.equal(markers[0].isBuy, false);
});

test('an exact close on the operation date is used as is', () => {
    const markers = buildTransactionMarkers(points([100, 110, 110, 110]), [trade()]);
    assert.equal(markers[0].x, 1);
    assert.equal(markers[0].y, 110);
});

test('a price not reached on its date is searched backwards from that date', () => {
    // Day 5 moves 130 -> 135; 110 was last crossed between day 2 and day 3.
    const curve = dailyPoints([100, 105, 115, 125, 130, 135, 108]);
    const [marker] = buildTransactionMarkers(curve, [trade({ date: '2026-01-06', executionPrice: 110 })]);
    assert.equal(marker.match, 'lookback');
    assert.equal(marker.x, 1.5);
    assert.equal(marker.y, 110);
    // The later crossing (day 6 -> 7) is never chosen.
    assert.ok(marker.x < 5);
});

test('the backwards search is limited, after which the marker stays on its date', () => {
    const values = Array.from({ length: 80 }, (_, i) => i < 5 ? 100 : 200 + i);
    const curve = dailyPoints(values);
    const date = curve[70].date.slice(0, 10);
    const [marker] = buildTransactionMarkers(curve, [trade({ date, executionPrice: 150 })]);
    assert.ok(70 - 5 > MARKER_LOOKBACK_DAYS);
    assert.equal(marker.match, 'nearest');
    assert.equal(marker.x, 70);
    assert.equal(marker.y, curve[70].value);
    assert.equal(marker.executionPrice, 150);
});

test('unreachable executions stay on the curve at their own date', () => {
    const markers = buildTransactionMarkers(points([100, 120, 120]), [trade({ executionPrice: 150 })]);
    assert.equal(markers[0].x, 1);
    assert.equal(markers[0].y, 120);
    assert.equal(markers[0].executionPrice, 150);
    const lower = buildTransactionMarkers(points([100, 120, 100]), [trade({ executionPrice: 80 })]);
    assert.equal(lower[0].x, 1);
    assert.equal(lower[0].y, 120);
    assert.equal(lower[0].executionPrice, 80);
});

test('a date between plotted points uses the segment that spans it', () => {
    const weekly = [
        { date: '2026-01-05T00:00:00Z', value: 100 },
        { date: '2026-01-12T00:00:00Z', value: 140 },
        { date: '2026-01-19T00:00:00Z', value: 105 }
    ];
    const [matched] = buildTransactionMarkers(weekly, [trade({ date: '2026-01-08', executionPrice: 120 })]);
    assert.equal(matched.x, 0.5);
    assert.equal(matched.y, 120);
    const [byDate] = buildTransactionMarkers(weekly, [trade({ type: 'DEPOSIT', date: '2026-01-15T12:00:00Z', executionPrice: null })]);
    assert.ok(Math.abs(byDate.x - (1 + 3.5 / 7)) < 1e-12);
    assert.ok(Math.abs(byDate.y - curveAt(weekly, byDate.x)) < 1e-10);
});

test('every buy/sell marker lies on its displayed segment, including unreachable prices', () => {
    const curve = points([100, 130, 100, 120]);
    const prices = [70, 100, 105, 110, 120, 125, 130, 150];
    const markers = buildTransactionMarkers(curve, prices.map((price, i) => trade({ id: i, executionPrice: price })));
    for (const marker of markers) {
        assert.ok(Math.abs(marker.y - curveAt(curve, marker.x)) < 1e-10);
        assert.ok(marker.x <= 1, 'markers never move after their date');
    }
});

test('only visible valid operations appear, and unpriced trades do not claim a market price', () => {
    const markers = buildTransactionMarkers(points([100, 120, 110]), [
        trade({ id: 'old', date: '2026-09-30', executionPrice: 110 }),
        trade({ id: 'future', date: '2026-10-04', executionPrice: 110 }),
        trade({ id: 'invalid', date: 'bad-date' }),
        trade({ id: 'missing', executionPrice: null }),
        trade({ id: 'buy', type: 'BUY' }),
        trade({ id: 'deposit', type: 'DEPOSIT', executionPrice: null }),
        trade({ id: 'interest', type: 'INCOME' }),
        trade({ id: 'split', type: 'SPLIT' })
    ]);
    assert.deepEqual(markers.map(marker => marker.id), ['buy', 'deposit', 'interest']);
    assert.equal(markers[0].isBuy, true);
    assert.equal(markers[1].x, 1);
    assert.equal(markers[1].y, 120);
    // Income has no unit price: it sits on the curve at its date.
    assert.equal(markers[2].x, 1);
    assert.equal(markers[2].executionPrice, null);
    assert.equal(markers[2].isBuy, true);
});

test('intraday price matching picks the crossing closest to the operation time', () => {
    const intraday = [100, 120, 100, 120].map((value, index) => ({
        date: `2026-10-02T${12 + index}:00:00Z`, value
    }));
    assert.equal(buildTransactionMarkers(intraday, [trade()])[0].x, 2.5);
    assert.equal(buildTransactionMarkers(intraday, [trade({ date: '2026-10-02T12:10:00Z' })])[0].x, 0.5);
});

test('date-only placement ignores prices, as used for loans', () => {
    const curve = points([1, 1.01, 1.02]);
    const [marker] = buildTransactionMarkers(curve, [trade({ type: 'BUY', executionPrice: 1 })], { matchPrice: false });
    assert.equal(marker.x, 1);
    assert.equal(marker.y, 1.01);
});

test('markers keep their segment through downsampling', () => {
    const history = Array.from({ length: 5000 }, (_, index) => ({
        date: new Date(Date.parse('2010-01-01T00:00:00Z') + index * 86400000).toISOString(),
        value: 100 + Math.sin(index / 7) * 20 + index / 100,
        rawIndex: index
    }));
    const tx = trade({ type: 'BUY', date: history[3210].date, executionPrice: (history[3209].value + history[3210].value) / 2 });
    const markers = buildTransactionMarkers(history, [tx]);
    const sampled = downsampleChartData(history, 300, getMarkerKeepIndices(markers));
    const [mapped] = mapMarkersToSampled(markers, sampled);
    assert.ok(sampled.length <= 302);
    assert.ok(Math.abs(curveAt(sampled, mapped.x) - mapped.y) < 1e-9);
    assert.equal(sampled[Math.floor(mapped.x)].rawIndex, 3209);
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
