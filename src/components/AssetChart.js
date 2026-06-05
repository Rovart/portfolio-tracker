'use client';

import { memo, useEffect, useId, useState, useMemo, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis, ReferenceArea, ReferenceLine, ReferenceDot } from 'recharts';
import { getCachedFxHistory, getCachedAssetHistory } from '@/utils/fxCache';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

function downsamplePreserveEdges(data, maxPoints = 300) {
    if (!data || data.length <= maxPoints) return data || [];
    const step = Math.ceil(data.length / maxPoints);
    const sampled = data.filter((_, i) => i % step === 0);
    const last = data[data.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
}

function findClosestPoint(sortedPoints, targetTime, maxDiff) {
    let low = 0;
    let high = sortedPoints.length - 1;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (sortedPoints[mid].time < targetTime) low = mid + 1;
        else high = mid;
    }

    const candidates = [sortedPoints[low], sortedPoints[low - 1]].filter(Boolean);
    let closest = null;
    let closestDiff = Infinity;

    candidates.forEach(candidate => {
        const diff = Math.abs(candidate.time - targetTime);
        if (diff < closestDiff && diff <= maxDiff) {
            closest = candidate.point;
            closestDiff = diff;
        }
    });

    return closest;
}

function AssetChart({ symbol, chartSymbol, baseCurrency = 'USD', fxRate = 1, parentLoading = false, assetCurrency, onRangePerformance, transactions = [] }) {
    const [rawData, setRawData] = useState([]);
    const [fxHistory, setFxHistory] = useState({});
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('asset_chart_timeframe') || '1Y';
        }
        return '1Y';
    });

    // Range selection state
    const [selectionStart, setSelectionStart] = useState(null);
    const [selectionEnd, setSelectionEnd] = useState(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const containerRef = useRef(null);
    const chartId = useId().replace(/:/g, '');
    const splitColorId = `splitColorAsset-${chartId}`;
    const splitFillId = `splitFillAsset-${chartId}`;

    const handleRangeChange = (newRange) => {
        setRange(newRange);
        localStorage.setItem('asset_chart_timeframe', newRange);
        clearSelection();
    };

    const clearSelection = useCallback(() => {
        setSelectionStart(null);
        setSelectionEnd(null);
        setIsSelecting(false);
    }, []);

    const needsFxConversion = assetCurrency && assetCurrency !== baseCurrency;

    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const targetSym = chartSymbol || symbol;
                const pricePromise = getCachedAssetHistory(targetSym, range);
                let fxPromise = Promise.resolve({});
                if (needsFxConversion && assetCurrency) {
                    fxPromise = getCachedFxHistory(assetCurrency, baseCurrency, range);
                }
                const [priceData, fxData] = await Promise.all([pricePromise, fxPromise]);
                if (priceData && priceData.length > 0) {
                    setRawData(priceData.map(p => ({ date: p.date, rawPrice: p.price })));
                } else {
                    setRawData([]);
                }
                setFxHistory(fxData || {});
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        if (symbol || chartSymbol) load();
    }, [symbol, range, needsFxConversion, assetCurrency, baseCurrency, chartSymbol]);

    const fxLookup = useMemo(() => {
        if (!needsFxConversion || Object.keys(fxHistory).length === 0) return null;

        return Object.entries(fxHistory)
            .map(([date, rate]) => ({ date, rate }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [fxHistory, needsFxConversion]);

    const { chartData, offset, startPrice, yDomain, rangeChange, rangeChangePercent } = useMemo(() => {
        if (!rawData || rawData.length === 0) return { chartData: [], offset: 0, startPrice: 0, yDomain: [0, 100], rangeChange: 0, rangeChangePercent: 0 };
        const processedData = downsamplePreserveEdges(rawData);
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
        const convertedData = processedData.map(d => {
            let rate = fxRate;
            if (fxLookup && fxLookup.length > 0) {
                const dateKey = d.date.split('T')[0];
                while (fxIndex < fxLookup.length && fxLookup[fxIndex].date <= dateKey) {
                    lastFxRate = fxLookup[fxIndex].rate;
                    fxIndex++;
                }
                rate = lastFxRate;
            }
            return { date: d.date, value: d.rawPrice * rate };
        });
        const start = rawData[0].rawPrice * firstRate;
        const prices = convertedData.map(d => d.value);
        const max = Math.max(...prices);
        const min = Math.min(...prices);

        // Calculate fixed Y domain with padding
        const padding = (max - min) * 0.05 || max * 0.05;
        const fixedYDomain = [min - padding, max + padding];

        let off = 0;
        if (max === min) off = 0.5;
        else {
            off = (max - start) / (max - min);
            if (isNaN(off) || !isFinite(off)) off = 0;
            off = Math.max(0, Math.min(1, off));
        }
        // Calculate range performance
        const endPrice = convertedData.length > 0 ? convertedData[convertedData.length - 1].value : 0;
        const rangeChange = endPrice - start;
        const rangeChangePercent = start !== 0 ? (rangeChange / start) * 100 : 0;

        return { chartData: convertedData, offset: off, startPrice: start, yDomain: fixedYDomain, rangeChange, rangeChangePercent };
    }, [rawData, fxRate, fxLookup]);

    // Report range performance to parent when it changes
    useEffect(() => {
        if (onRangePerformance && chartData.length > 0 && !loading) {
            onRangePerformance({
                range,
                change: rangeChange,
                changePercent: rangeChangePercent
            });
        }
    }, [chartData, range, rangeChange, rangeChangePercent, loading, onRangePerformance]);

    // Selection metrics
    const selectionMetrics = useMemo(() => {
        if (selectionStart === null || selectionEnd === null || chartData.length === 0) return null;
        const startIdx = Math.min(selectionStart, selectionEnd);
        const endIdx = Math.max(selectionStart, selectionEnd);
        if (startIdx < 0 || endIdx >= chartData.length || startIdx === endIdx) return null;
        const startVal = chartData[startIdx].value;
        const endVal = chartData[endIdx].value;
        const change = endVal - startVal;
        const changePercent = startVal !== 0 ? (change / startVal) * 100 : 0;
        return { startIdx, endIdx, startVal, endVal, change, changePercent };
    }, [selectionStart, selectionEnd, chartData]);

    // Pre-compute selection highlight data (avoids expensive function accessor)
    const selectionChartData = useMemo(() => {
        if (!selectionMetrics) return null;
        return chartData.map((d, idx) => ({
            date: d.date,
            value: idx >= selectionMetrics.startIdx && idx <= selectionMetrics.endIdx ? d.value : null
        }));
    }, [selectionMetrics, chartData]);

    // Transaction dots - map transactions to chart points using pre-built date index
    const transactionDots = useMemo(() => {
        if (chartData.length === 0) return [];

        const indexMap = new Map();
        const sortedPoints = [];
        chartData.forEach((point, idx) => {
            const dateKey = point.date.split('T')[0];
            if (!indexMap.has(dateKey)) {
                indexMap.set(dateKey, { point, idx });
                sortedPoints.push({ time: new Date(dateKey).getTime(), point });
            }
        });

        if (!transactions || transactions.length === 0) {
            return [];
        }

        const dots = [];
        const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

        transactions.forEach(tx => {
            if (!tx.date || !['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'].includes(tx.type)) return;

            const txDate = tx.date.split('T')[0];

            // Try exact match first (O(1))
            const exactPoint = indexMap.get(txDate);
            if (exactPoint) {
                dots.push({
                    x: exactPoint.point.date,
                    y: exactPoint.point.value,
                    type: tx.type,
                    amount: tx.baseAmount,
                    isBuy: ['BUY', 'DEPOSIT'].includes(tx.type)
                });
                return;
            }

            // For non-exact matches, use binary search to find closest within 2 days
            const txTime = new Date(txDate).getTime();
            const closestPoint = findClosestPoint(sortedPoints, txTime, twoDaysMs);

            if (closestPoint) {
                dots.push({
                    x: closestPoint.date,
                    y: closestPoint.value,
                    type: tx.type,
                    amount: tx.baseAmount,
                    isBuy: ['BUY', 'DEPOSIT'].includes(tx.type)
                });
            }
        });

        return dots;
    }, [transactions, chartData]);

    // Throttle ref for touch/mouse moves
    const lastMoveTimeRef = useRef(0);
    const rectCacheRef = useRef(null);
    const THROTTLE_MS = 16; // ~60fps

    const handleMouseDown = useCallback((e) => {
        if (e && e.activeTooltipIndex !== undefined) {
            setSelectionStart(e.activeTooltipIndex);
            setSelectionEnd(e.activeTooltipIndex);
            setIsSelecting(true);
        }
    }, []);

    const handleMouseMove = useCallback((e) => {
        if (!isSelecting || !e || e.activeTooltipIndex === undefined) return;

        const now = Date.now();
        if (now - lastMoveTimeRef.current < THROTTLE_MS) return;
        lastMoveTimeRef.current = now;

        setSelectionEnd(e.activeTooltipIndex);
    }, [isSelecting]);

    const handleMouseUp = useCallback(() => {
        setIsSelecting(false);
    }, []);

    const handleTouchStart = useCallback((e) => {
        if (e.touches.length === 2 && containerRef.current) {
            // Cache the rect to avoid layout thrashing
            rectCacheRef.current = containerRef.current.getBoundingClientRect();
            const rect = rectCacheRef.current;
            const count = chartData.length;
            if (count === 0) return;

            const t1 = e.touches[0].clientX - rect.left;
            const t2 = e.touches[1].clientX - rect.left;

            const idx1 = Math.max(0, Math.min(count - 1, Math.floor((t1 / rect.width) * count)));
            const idx2 = Math.max(0, Math.min(count - 1, Math.floor((t2 / rect.width) * count)));

            setSelectionStart(idx1);
            setSelectionEnd(idx2);
            setIsSelecting(true);
        }
    }, [chartData.length]);

    const handleTouchMove = useCallback((e) => {
        if (e.touches.length !== 2) return;

        // Throttle updates
        const now = Date.now();
        if (now - lastMoveTimeRef.current < THROTTLE_MS) return;
        lastMoveTimeRef.current = now;

        // Prevent scrolling when using two fingers for selection
        if (e.cancelable) e.preventDefault();

        // Use cached rect
        const rect = rectCacheRef.current || containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const count = chartData.length;
        if (count === 0) return;

        const t1 = e.touches[0].clientX - rect.left;
        const t2 = e.touches[1].clientX - rect.left;

        const idx1 = Math.max(0, Math.min(count - 1, Math.floor((t1 / rect.width) * count)));
        const idx2 = Math.max(0, Math.min(count - 1, Math.floor((t2 / rect.width) * count)));

        setSelectionStart(idx1);
        setSelectionEnd(idx2);
    }, [chartData.length]);

    const handleTouchEnd = useCallback((e) => {
        if (e.touches.length < 2) {
            setIsSelecting(false);
            rectCacheRef.current = null; // Clear cache
        }
    }, []);

    if (loading || parentLoading) return <LoadingChart />;
    if (rawData.length === 0) return <div className="h-40 flex items-center justify-center text-muted">No chart data</div>;

    const green = "#22c55e";
    const red = "#ef4444";
    const hasSelection = selectionMetrics !== null;

    return (
        <div
            className="flex flex-col gap-4 no-select"
            style={{
                cursor: 'default',
                touchAction: isSelecting ? 'none' : 'pan-y',
                userSelect: 'none',
                WebkitUserSelect: 'none'
            }}
        >
            <div
                ref={containerRef}
                style={{ height: '240px', width: '100%', position: 'relative' }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Selection metrics overlay on chart */}
                {selectionMetrics && (
                    <div
                        className="absolute top-2 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer"
                        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
                        onClick={clearSelection}
                    >
                        <span className="text-[10px] text-white/60">
                            {new Date(chartData[selectionMetrics.startIdx].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            {' → '}
                            {new Date(chartData[selectionMetrics.endIdx].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-xs text-white/80 font-medium">
                            {selectionMetrics.change >= 0 ? '+' : ''}{selectionMetrics.change.toLocaleString(undefined, { maximumFractionDigits: 2 })} {baseCurrency}
                        </span>
                        <span className={`text-xs font-bold ${selectionMetrics.change >= 0 ? 'text-success' : 'text-danger'}`}>
                            ({selectionMetrics.change >= 0 ? '+' : ''}{selectionMetrics.changePercent.toFixed(2)}%)
                        </span>
                    </div>
                )}

                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <AreaChart
                        data={chartData}
                        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    >
                        <defs>
                            <linearGradient id={splitColorId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={1} />
                                <stop offset={offset} stopColor={red} stopOpacity={1} />
                            </linearGradient>
                            <linearGradient id={splitFillId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={0.2} />
                                <stop offset={offset} stopColor={red} stopOpacity={0.2} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <YAxis domain={yDomain} hide />

                        {/* Gray overlay for areas OUTSIDE selection */}
                        {selectionMetrics && (
                            <>
                                {/* Left gray zone */}
                                {selectionMetrics.startIdx > 0 && (
                                    <ReferenceArea
                                        x1={chartData[0].date}
                                        x2={chartData[selectionMetrics.startIdx].date}
                                        fill="rgba(0,0,0,0.6)"
                                        fillOpacity={1}
                                    />
                                )}
                                {/* Right gray zone */}
                                {selectionMetrics.endIdx < chartData.length - 1 && (
                                    <ReferenceArea
                                        x1={chartData[selectionMetrics.endIdx].date}
                                        x2={chartData[chartData.length - 1].date}
                                        fill="rgba(0,0,0,0.6)"
                                        fillOpacity={1}
                                    />
                                )}
                                {/* Vertical lines at selection boundaries */}
                                <ReferenceLine
                                    x={chartData[selectionMetrics.startIdx].date}
                                    stroke="rgba(255,255,255,0.5)"
                                    strokeWidth={1}
                                    strokeDasharray="3 3"
                                />
                                <ReferenceLine
                                    x={chartData[selectionMetrics.endIdx].date}
                                    stroke="rgba(255,255,255,0.5)"
                                    strokeWidth={1}
                                    strokeDasharray="3 3"
                                />
                            </>
                        )}

                        {/* Hide tooltip when selecting */}
                        {!isSelecting && !hasSelection && (
                            <Tooltip
                                contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', padding: '8px 12px' }}
                                formatter={(val) => [
                                    <span key="price" style={{ color: val >= startPrice ? green : red }}>
                                        {val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                    </span>,
                                    'Price'
                                ]}
                                labelFormatter={(label) => new Date(label).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                labelStyle={{ color: '#a1a1aa', fontSize: '0.75rem', marginBottom: '4px' }}
                                cursor={{ stroke: '#525252', strokeWidth: 1 }}
                                isAnimationActive={false}
                            />
                        )}

                        {/* Main chart line - always visible with original colors */}
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={`url(#${splitColorId})`}
                            fill={`url(#${splitFillId})`}
                            strokeWidth={2}
                            baseValue={startPrice}
                            isAnimationActive={false}
                        />

                        {/* White highlight line for selected portion only */}
                        {selectionMetrics && selectionChartData && (
                            <Area
                                data={selectionChartData}
                                type="monotone"
                                dataKey="value"
                                stroke="#ffffff"
                                fill="none"
                                strokeWidth={2.5}
                                connectNulls={false}
                                isAnimationActive={false}
                            />
                        )}

                        {/* Transaction dots - Buy (green) and Sell (red) */}
                        {!isSelecting && !hasSelection && transactionDots.map((dot, i) => (
                            <ReferenceDot
                                key={`tx-${i}`}
                                x={dot.x}
                                y={dot.y}
                                r={4}
                                fill={dot.isBuy ? green : red}
                                stroke="#fff"
                                strokeWidth={1.5}
                                fillOpacity={1}
                                isFront={true}
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Timeframe Selector */}
            <div className="flex justify-between overflow-x-auto gap-2 no-scrollbar">
                {RANGES.map(r => (
                    <button
                        key={r}
                        onClick={() => handleRangeChange(r)}
                        className={`btn ${range === r ? 'bg-white text-black' : 'btn-ghost'}`}
                        style={{
                            background: range === r ? 'var(--foreground)' : 'transparent',
                            color: range === r ? 'var(--background)' : 'var(--muted)',
                            fontSize: '0.75rem',
                            padding: '4px 12px'
                        }}
                    >
                        {r}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default memo(AssetChart);

function LoadingChart() {
    return (
        <div style={{ height: '240px', width: '100%', opacity: 0.35, cursor: 'default', position: 'relative', overflow: 'hidden' }} className="animate-pulse no-select">
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 48, height: 2, background: '#525252', transform: 'skewY(-5deg)', transformOrigin: 'left center' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 105, background: 'linear-gradient(180deg, rgba(82,82,82,0.22), rgba(82,82,82,0))', clipPath: 'polygon(0 52%, 16% 45%, 32% 50%, 48% 34%, 64% 42%, 82% 24%, 100% 18%, 100% 100%, 0 100%)' }} />
        </div>
    );
}
