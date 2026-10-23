import { inferTransactionCostCurrency } from './portfolio-logic.js';

// Keep the ends and each bucket's extrema without rendering the full history.
// keepIndices are always retained so transaction markers stay on real segments.
export function downsampleChartData(data, maxPoints = 300, keepIndices = []) {
    if (!data || data.length <= maxPoints) return data || [];
    const bucketCount = Math.floor((maxPoints - 2) / 2);
    const indices = new Set([0, data.length - 1]);
    const bucketSize = (data.length - 2) / bucketCount;

    for (let bucket = 0; bucket < bucketCount; bucket++) {
        const start = 1 + Math.floor(bucket * bucketSize);
        const end = 1 + Math.floor((bucket + 1) * bucketSize);
        let minIndex = start;
        let maxIndex = start;
        for (let i = start + 1; i < end; i++) {
            if (data[i].value < data[minIndex].value) minIndex = i;
            if (data[i].value > data[maxIndex].value) maxIndex = i;
        }
        indices.add(minIndex);
        indices.add(maxIndex);
    }

    for (const index of keepIndices) {
        if (Number.isInteger(index) && index >= 0 && index < data.length) indices.add(index);
    }

    return [...indices].sort((a, b) => a - b).map(index => data[index]);
}

export function getTransactionExecutionPrice(tx, baseCurrency, resolveRate) {
    const units = Math.abs(parseFloat(tx.baseAmount));
    const total = Math.abs(parseFloat(tx.quoteAmount));
    if (!Number.isFinite(units) || !Number.isFinite(total) || units === 0 || total === 0) return null;

    const currency = inferTransactionCostCurrency(tx, baseCurrency);
    const rate = currency === baseCurrency ? 1 : resolveRate(currency, String(tx.date).split('T')[0]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const price = (total / units) * rate;
    return Number.isFinite(price) && price > 0 ? price : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// An execution that the plotted closes never reach on its own date is searched
// for in the preceding month only; beyond that the date wins over the price.
export const MARKER_LOOKBACK_DAYS = 31;
// INCOME (interest, dividends) has no unit price, so it is always placed by date.
const MARKER_TYPES = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW', 'INCOME'];

function toTime(date) {
    const time = Date.parse(date);
    return Number.isFinite(time) ? time : null;
}

function dayKey(date) {
    const time = toTime(date);
    return time === null ? null : new Date(time).toISOString().slice(0, 10);
}

// First index whose key is >= target (or > target when strict).
function searchKeys(keys, target, strict = false) {
    let low = 0;
    let high = keys.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (strict ? keys[mid] <= target : keys[mid] < target) low = mid + 1;
        else high = mid;
    }
    return low;
}

function valueAt(points, x) {
    const left = Math.floor(x);
    const right = Math.min(points.length - 1, Math.ceil(x));
    if (left === right) return points[left].value;
    return points[left].value + (points[right].value - points[left].value) * (x - left);
}

function timeAt(times, x) {
    const left = Math.floor(x);
    const right = Math.min(times.length - 1, Math.ceil(x));
    if (left === right) return times[left];
    return times[left] + (times[right] - times[left]) * (x - left);
}

// Crossing of `price` on the segment that starts at index i (the end point
// is excluded so adjacent segments never report the same position twice).
function segmentCrossing(points, i, price) {
    const value = points[i].value;
    if (value === price) return i;
    if (i + 1 >= points.length) return null;
    const next = points[i + 1].value;
    if (price > Math.min(value, next) && price < Math.max(value, next)) {
        return i + (price - value) / (next - value);
    }
    return null;
}

// The operation's date decides where its marker goes:
// 1. On the operation's day (the segment from the previous close through that
//    day's last point) the marker sits where the curve crosses the execution price.
// 2. Only when that day never reaches the price, the curve is followed backwards
//    from the date (up to MARKER_LOOKBACK_DAYS) to the latest crossing.
// 3. Otherwise the marker stays on the curve at the operation's date.
export function findTransactionPosition(points, tx, index = buildMarkerIndex(points), { matchPrice = true } = {}) {
    if (points.length === 0) return null;
    const txTime = toTime(tx.date);
    const txDay = dayKey(tx.date);
    if (txTime === null || txDay === null) return null;

    const { keys, times } = index;
    const first = searchKeys(keys, txDay);
    const after = searchKeys(keys, txDay, true);
    const sameDay = after > first;
    const windowStart = Math.max(0, first - 1);
    const windowEnd = sameDay ? after - 1 : Math.min(points.length - 1, first);

    const price = tx.executionPrice;
    if (matchPrice && Number.isFinite(price) && price > 0) {
        let best = null;
        let bestDistance = Infinity;
        for (let i = windowStart; i <= windowEnd; i++) {
            const x = i === windowEnd ? (points[i].value === price ? i : null) : segmentCrossing(points, i, price);
            if (x === null) continue;
            const distance = Math.abs(timeAt(times, x) - txTime);
            if (distance < bestDistance) {
                best = x;
                bestDistance = distance;
            }
        }
        if (best !== null) return { x: best, y: price, match: 'date' };

        const earliest = times[windowStart] - MARKER_LOOKBACK_DAYS * DAY_MS;
        for (let i = windowStart - 1; i >= 0 && times[i + 1] >= earliest; i--) {
            const x = segmentCrossing(points, i, price);
            if (x !== null && timeAt(times, x) >= earliest) return { x, y: price, match: 'lookback' };
        }
    }

    let x;
    if (sameDay) {
        x = first;
        for (let i = first + 1; i < after; i++) {
            if (Math.abs(times[i] - txTime) < Math.abs(times[x] - txTime)) x = i;
        }
    } else if (windowEnd > windowStart && times[windowEnd] > times[windowStart]) {
        const ratio = (txTime - times[windowStart]) / (times[windowEnd] - times[windowStart]);
        x = windowStart + Math.max(0, Math.min(1, ratio));
    } else {
        x = windowEnd;
    }
    return { x, y: valueAt(points, x), match: 'nearest' };
}

export function buildMarkerIndex(points) {
    return {
        keys: points.map(point => dayKey(point.date)),
        times: points.map(point => toTime(point.date))
    };
}

export function buildTransactionMarkers(points, transactions, { matchPrice = true } = {}) {
    if (points.length === 0 || !transactions?.length) return [];
    const index = buildMarkerIndex(points);
    const firstDate = index.keys[0];
    const lastDate = index.keys[index.keys.length - 1];
    const markers = [];

    for (const tx of transactions) {
        if (!tx.date || !MARKER_TYPES.includes(tx.type)) continue;
        const txDate = dayKey(tx.date);
        // An older operation must not reappear merely because a visible price matches.
        if (txDate === null || txDate < firstDate || txDate > lastDate) continue;

        const hasPrice = tx.type !== 'INCOME' && Number.isFinite(tx.executionPrice) && tx.executionPrice > 0;
        if (matchPrice && !hasPrice && ['BUY', 'SELL'].includes(tx.type)) continue;
        const position = findTransactionPosition(points, tx, index, { matchPrice: matchPrice && hasPrice });
        if (!position) continue;

        markers.push({
            id: tx.id,
            x: position.x,
            y: position.y,
            match: position.match,
            executionPrice: hasPrice ? tx.executionPrice : null,
            date: tx.date,
            type: tx.type,
            amount: tx.baseAmount,
            isBuy: ['BUY', 'DEPOSIT', 'INCOME'].includes(tx.type),
            hasPrice
        });
    }

    return markers;
}

// Markers are located on the full-resolution curve; downsampling keeps the two
// points around each marker, so the marker maps onto the same drawn segment.
export function getMarkerKeepIndices(markers) {
    return markers.flatMap(marker => [Math.floor(marker.x), Math.ceil(marker.x)]);
}

export function mapMarkersToSampled(markers, sampled) {
    if (!markers.length) return markers;
    const positions = new Map(sampled.map((point, index) => [point.rawIndex, index]));
    return markers.flatMap(marker => {
        const left = Math.floor(marker.x);
        const sampledLeft = positions.get(left);
        if (sampledLeft === undefined) return [];
        return [{ ...marker, x: sampledLeft + (marker.x - left) }];
    });
}
