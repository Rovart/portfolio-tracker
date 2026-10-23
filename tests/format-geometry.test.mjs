import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoney, formatPercent, formatPrice, splitMoney } from '../src/utils/format.js';
import { buildAreaPath, buildLinePath, createScales, getValueDomain } from '../src/utils/chart-geometry.js';

test('money always shows two decimals, a currency symbol and an explicit sign when asked', () => {
    assert.equal(formatMoney(10810.3, 'EUR', { locale: 'en-US' }), '€10,810.30');
    assert.equal(formatMoney(10810.3, 'EUR', { locale: 'es-ES' }), '10.810,30\u00a0€');
    assert.equal(formatMoney(12.5, 'USD', { signed: true, locale: 'en-US' }), '+$12.50');
    assert.equal(formatMoney(0, 'USD', { signed: true, locale: 'en-US' }), '$0.00');
    assert.equal(formatMoney(5, 'USDT', { locale: 'en-US' }), '5.00 USDT');
    assert.equal(formatMoney(NaN, 'USD'), '—');
});

test('four-digit amounts are grouped like larger ones in every locale', () => {
    assert.equal(formatMoney(3643.82, 'EUR', { locale: 'es-ES' }), '3.643,82 €');
    assert.equal(formatMoney(3643.82, 'EUR', { locale: 'en-US' }), '€3,643.82');
});

test('low unit prices keep significant digits', () => {
    assert.equal(formatPrice(0.00123, 'USD', { locale: 'en-US' }), '$0.001230');
    assert.equal(formatPrice(222.055, 'USD', { locale: 'en-US' }), '$222.06');
});

test('the integer part is split from the receding decimals and symbol', () => {
    assert.deepEqual(splitMoney(10810.3, 'EUR', { locale: 'es-ES' }), { major: '10.810', minor: ',30 €' });
    assert.deepEqual(splitMoney(-5, 'USD', { locale: 'en-US' }), { major: '-$5', minor: '.00' });
});

test('percentages are signed and locale aware', () => {
    assert.equal(formatPercent(8.1, { locale: 'en-US' }), '+8.10%');
    assert.equal(formatPercent(-0.15, { locale: 'en-US' }), '-0.15%');
    assert.equal(formatPercent(10.5, { signed: false, minDecimals: 0, locale: 'en-US' }), '10.5%');
});

test('chart scales map the first and last points to the plot edges', () => {
    const points = [{ value: 10 }, { value: 20 }, { value: 15 }];
    const domain = getValueDomain(points.map(p => p.value), 0);
    assert.deepEqual(domain, [10, 20]);
    const scales = createScales({ count: 3, width: 112, height: 120, domain, padX: 6, padTop: 10, padBottom: 10 });
    assert.equal(scales.x(0), 6);
    assert.equal(scales.x(2), 106);
    assert.equal(scales.y(20), 10);
    assert.equal(scales.y(10), 110);
    assert.equal(scales.indexAt(-50), 0);
    assert.equal(scales.indexAt(60), 1);
    assert.equal(scales.indexAt(500), 2);
    assert.equal(buildLinePath(points, scales), 'M6 110L56 10L106 60');
    assert.equal(buildAreaPath(points, scales), 'M6 110L56 10L106 60L106 110L6 110Z');
    assert.equal(buildLinePath(points.slice(1), scales, 1), 'M56 10L106 60');
});

test('a flat series still gets a visible domain', () => {
    const [min, max] = getValueDomain([5, 5, 5]);
    assert.ok(min < 5 && max > 5);
    assert.deepEqual(getValueDomain([]), [0, 1]);
});
