import assert from 'node:assert/strict';
import test from 'node:test';
import { getLatestEarningsResult } from '../src/utils/market-data.js';

const HISTORY = [
    { date: '2025-09-30T00:00:00.000Z', epsActual: 1.85, epsEstimate: 1.76993, surprisePercent: 0.0452 },
    { date: '2025-12-31T00:00:00.000Z', epsActual: 2.84, epsEstimate: 2.6708, surprisePercent: 0.0634 },
    { date: '2026-03-31T00:00:00.000Z', epsActual: 2.01, epsEstimate: 1.94275, surprisePercent: 0.0346 },
    { date: '2026-06-30T00:00:00.000Z', epsActual: 2.02, epsEstimate: 1.89243, surprisePercent: 0.0674 }
];

test('the latest quarter is the most recent date, not the first entry', () => {
    const latest = getLatestEarningsResult(HISTORY);
    assert.equal(latest.date, '2026-06-30T00:00:00.000Z');
    assert.equal(latest.epsActual, 2.02);
});

test('the surprise is a percentage computed from actual and estimate', () => {
    const latest = getLatestEarningsResult(HISTORY);
    assert.ok(Math.abs(latest.surprisePercent - 6.741) < 0.01);
    const miss = getLatestEarningsResult([{ date: '2026-06-30', epsActual: -0.5, epsEstimate: -0.4 }]);
    assert.ok(miss.surprisePercent < 0);
});

test('quarters without both figures are ignored', () => {
    assert.equal(getLatestEarningsResult([{ date: '2026-06-30', epsActual: null, epsEstimate: 1 }]), null);
    assert.equal(getLatestEarningsResult(undefined), null);
});
