'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import LineChart, { ChartPlaceholder } from './LineChart';
import { Segmented } from './ui';
import { getCachedFxHistory, getCachedAssetHistory } from '@/utils/fxCache';
import { downsampleChartData, buildTransactionMarkers, getMarkerKeepIndices, mapMarkersToSampled } from '@/utils/chart-data';
import { formatDate, formatPrice } from '@/utils/format';

const DEFAULT_RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];
const EMPTY_TRANSACTIONS = [];
const HEIGHT = 240;

function getRangeStart(range, now = new Date()) {
    const start = new Date(now);
    if (range === '1D') start.setDate(start.getDate() - 1);
    else if (range === '1W') start.setDate(start.getDate() - 7);
    else if (range === '1M') start.setMonth(start.getMonth() - 1);
    else if (range === '3M') start.setMonth(start.getMonth() - 3);
    else if (range === '1Y') start.setFullYear(start.getFullYear() - 1);
    else return null;
    return start.getTime();
}

function readStoredRange() {
    try {
        return localStorage.getItem('asset_chart_timeframe') || '1Y';
    } catch {
        return '1Y';
    }
}

function formatMarkerTitle(dot, chartData, baseCurrency, labels) {
    const type = labels?.[dot.type] || dot.type;
    // Date-placed markers (e.g. loans) describe the curve value, not a unit price.
    if (labels) return [type, formatDate(dot.date), formatPrice(dot.y, baseCurrency)].join(' · ');
    const parts = [type, formatDate(dot.date), formatPrice(dot.executionPrice ?? dot.y, baseCurrency)];
    if (dot.match === 'lookback') {
        const pointDate = chartData[Math.round(dot.x)]?.date;
        if (pointDate) parts.push(`price last reached ${formatDate(pointDate)}`);
    } else if (dot.executionPrice !== null && dot.executionPrice !== dot.y) {
        parts.push(`chart ${formatPrice(dot.y, baseCurrency)}`);
    }
    return parts.join(' · ');
}

// Warm the cache for the neighbouring ranges once the browser is idle, so
// switching range usually renders from memory.
function prefetchNeighbours(symbol, range, ranges, fx) {
    const index = ranges.indexOf(range);
    const neighbours = [ranges[index - 1], ranges[index + 1]].filter(Boolean);
    const run = () => neighbours.forEach(next => {
        getCachedAssetHistory(symbol, next);
        if (fx) getCachedFxHistory(fx.from, fx.to, next);
    });
    if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(run, { timeout: 2000 });
        return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 400);
    return () => clearTimeout(id);
}

// localHistory: [{ date, price }] supplied by the caller (e.g. accrued loan value)
// instead of market history. matchMarkerPrices=false places markers by date only.
function AssetChart({
    symbol,
    chartSymbol,
    baseCurrency = 'USD',
    fxRate = 1,
    parentLoading = false,
    assetCurrency,
    onRangePerformance,
    transactions = EMPTY_TRANSACTIONS,
    localHistory = null,
    ranges = DEFAULT_RANGES,
    matchMarkerPrices = true,
    markerLabels = null,
    onScrub,
    onRangeSelect
}) {
    // The loaded series remembers its range: a new range keeps showing the old
    // curve (dimmed) until its data arrives.
    const [loaded, setLoaded] = useState({ key: null, raw: [], fx: {} });
    const [storedRange, setRange] = useState(readStoredRange);
    const range = ranges.includes(storedRange) ? storedRange : ranges[ranges.length - 1];
    const targetSymbol = chartSymbol || symbol;
    const needsFxConversion = !!assetCurrency && assetCurrency !== baseCurrency;
    const requestKey = `${targetSymbol}|${range}|${needsFxConversion ? `${assetCurrency}>${baseCurrency}` : ''}|${localHistory ? 'local' : 'market'}`;
    const loading = loaded.key !== requestKey;

    const handleRangeChange = (nextRange) => {
        onScrub?.(null);
        onRangeSelect?.(null);
        setRange(nextRange);
        try {
            localStorage.setItem('asset_chart_timeframe', nextRange);
        } catch {
            // Preference only.
        }
    };

    useEffect(() => {
        if (!targetSymbol) return;
        let cancelled = false;
        const rangeStart = getRangeStart(range);
        const fxPair = needsFxConversion ? { from: assetCurrency, to: baseCurrency } : null;
        (async () => {
            try {
                const [priceData, fxData] = await Promise.all([
                    localHistory
                        ? localHistory.filter(point => rangeStart === null || Date.parse(point.date) >= rangeStart)
                        : getCachedAssetHistory(targetSymbol, range),
                    // FX history only exists for market ranges; local daily data uses the full map.
                    fxPair ? getCachedFxHistory(fxPair.from, fxPair.to, localHistory ? 'ALL' : range) : {}
                ]);
                if (cancelled) return;
                setLoaded({
                    key: requestKey,
                    raw: (priceData || []).map(point => ({ date: point.date, rawPrice: point.price })),
                    fx: fxData || {}
                });
            } catch (error) {
                console.error(error);
                if (!cancelled) setLoaded({ key: requestKey, raw: [], fx: {} });
            }
        })();
        const cancelPrefetch = localHistory ? null : prefetchNeighbours(targetSymbol, range, ranges, fxPair);
        return () => {
            cancelled = true;
            cancelPrefetch?.();
        };
    }, [requestKey, targetSymbol, range, ranges, needsFxConversion, assetCurrency, baseCurrency, localHistory]);

    const fxLookup = useMemo(() => {
        if (!needsFxConversion || Object.keys(loaded.fx).length === 0) return null;
        return Object.entries(loaded.fx)
            .map(([date, rate]) => ({ date, rate }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [loaded.fx, needsFxConversion]);

    const { chartData, transactionDots, startPrice, rangeChange, rangeChangePercent } = useMemo(() => {
        const rawData = loaded.raw;
        if (!rawData.length) return { chartData: [], transactionDots: [], startPrice: 0, rangeChange: 0, rangeChangePercent: 0 };
        const startDateKey = rawData[0].date.split('T')[0];
        let fxIndex = 0;
        let firstRate = fxRate;

        if (fxLookup && fxLookup.length > 0) {
            while (fxIndex < fxLookup.length && fxLookup[fxIndex].date <= startDateKey) {
                firstRate = fxLookup[fxIndex].rate;
                fxIndex++;
            }
        }

        let lastFxRate = firstRate;
        const convertedData = rawData.map((d, rawIndex) => {
            let rate = fxRate;
            if (fxLookup && fxLookup.length > 0) {
                const dateKey = d.date.split('T')[0];
                while (fxIndex < fxLookup.length && fxLookup[fxIndex].date <= dateKey) {
                    lastFxRate = fxLookup[fxIndex].rate;
                    fxIndex++;
                }
                rate = lastFxRate;
            }
            return { date: d.date, value: d.rawPrice * rate, rawIndex };
        });
        const start = rawData[0].rawPrice * firstRate;
        const endPrice = convertedData[convertedData.length - 1].value;
        const change = endPrice - start;

        // Markers are placed on the full-resolution curve, then mapped onto the
        // sampled one, which always keeps the two points around each marker.
        const markers = buildTransactionMarkers(convertedData, transactions, { matchPrice: matchMarkerPrices });
        const sampledData = downsampleChartData(convertedData, 300, getMarkerKeepIndices(markers));
        return {
            chartData: sampledData,
            transactionDots: mapMarkersToSampled(markers, sampledData),
            startPrice: start,
            rangeChange: change,
            rangeChangePercent: start !== 0 ? (change / start) * 100 : 0
        };
    }, [loaded.raw, fxRate, fxLookup, transactions, matchMarkerPrices]);

    const chartMarkers = useMemo(() => transactionDots.map(dot => ({
        ...dot,
        title: formatMarkerTitle(dot, chartData, baseCurrency, markerLabels)
    })), [transactionDots, chartData, baseCurrency, markerLabels]);

    useEffect(() => {
        if (onRangePerformance && chartData.length > 0 && !loading) {
            onRangePerformance({ range, change: rangeChange, changePercent: rangeChangePercent, startPrice });
        }
    }, [chartData, range, rangeChange, rangeChangePercent, startPrice, loading, onRangePerformance]);

    const hasData = chartData.length > 0;
    const end = hasData ? chartData[chartData.length - 1].value : 0;

    return (
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
            {!hasData ? (
                <ChartPlaceholder height={HEIGHT} message={loading || parentLoading ? null : 'No chart data'} />
            ) : (
                <LineChart
                    data={chartData}
                    height={HEIGHT}
                    color={end >= startPrice ? 'var(--success)' : 'var(--danger)'}
                    baseline={startPrice}
                    markers={chartMarkers}
                    stale={loading}
                    // The series fades in when its data arrives, not when the range is clicked.
                    transitionKey={loaded.key}
                    ariaLabel={`${symbol} price, ${range}`}
                    onScrub={onScrub}
                    onRangeSelect={onRangeSelect}
                />
            )}
            <Segmented
                ariaLabel="Chart range"
                options={ranges.map(id => ({ id, label: id }))}
                value={range}
                onChange={handleRangeChange}
            />
        </div>
    );
}

export default memo(AssetChart);
