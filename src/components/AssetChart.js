'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis, ReferenceArea, ReferenceLine } from 'recharts';
import { getCachedFxHistory, getCachedAssetHistory } from '@/utils/fxCache';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

export default function AssetChart({ symbol, chartSymbol, baseCurrency = 'USD', fxRate = 1, parentLoading = false, assetCurrency }) {
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

    const { chartData, offset, startPrice, yDomain } = useMemo(() => {
        if (!rawData || rawData.length === 0) return { chartData: [], offset: 0, startPrice: 0, yDomain: [0, 100] };
        let processedData = rawData;
        if (rawData.length > 300) {
            const step = Math.ceil(rawData.length / 300);
            processedData = rawData.filter((_, i) => i % step === 0);
        }
        const convertedData = processedData.map(d => {
            let rate = fxRate;
            if (needsFxConversion && Object.keys(fxHistory).length > 0) {
                const dateKey = d.date.split('T')[0];
                if (fxHistory[dateKey]) {
                    rate = fxHistory[dateKey];
                } else {
                    const sortedDates = Object.keys(fxHistory).sort();
                    for (let i = sortedDates.length - 1; i >= 0; i--) {
                        if (sortedDates[i] <= dateKey) {
                            rate = fxHistory[sortedDates[i]];
                            break;
                        }
                    }
                }
            }
            return { date: d.date, value: d.rawPrice * rate };
        });
        const firstRate = needsFxConversion && Object.keys(fxHistory).length > 0
            ? (fxHistory[rawData[0].date.split('T')[0]] || fxRate) : fxRate;
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
        return { chartData: convertedData, offset: off, startPrice: start, yDomain: fixedYDomain };
    }, [rawData, fxRate, fxHistory, needsFxConversion]);

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

    const handleMouseDown = useCallback((e) => {
        if (e && e.activeTooltipIndex !== undefined) {
            setSelectionStart(e.activeTooltipIndex);
            setSelectionEnd(e.activeTooltipIndex);
            setIsSelecting(true);
        }
    }, []);

    const handleMouseMove = useCallback((e) => {
        if (isSelecting && e && e.activeTooltipIndex !== undefined) {
            setSelectionEnd(e.activeTooltipIndex);
        }
    }, [isSelecting]);

    const handleMouseUp = useCallback(() => {
        setIsSelecting(false);
    }, []);

    const handleTouchStart = useCallback((e) => {
        if (e.touches.length === 2 && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
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
    }, [chartData]);

    const handleTouchMove = useCallback((e) => {
        if (e.touches.length === 2 && containerRef.current) {
            // Prevent scrolling when using two fingers for selection
            if (e.cancelable) e.preventDefault();

            const rect = containerRef.current.getBoundingClientRect();
            const count = chartData.length;
            if (count === 0) return;

            const t1 = e.touches[0].clientX - rect.left;
            const t2 = e.touches[1].clientX - rect.left;

            const idx1 = Math.max(0, Math.min(count - 1, Math.floor((t1 / rect.width) * count)));
            const idx2 = Math.max(0, Math.min(count - 1, Math.floor((t2 / rect.width) * count)));

            setSelectionStart(idx1);
            setSelectionEnd(idx2);
        }
    }, [chartData]);

    const handleTouchEnd = useCallback((e) => {
        if (e.touches.length < 2) {
            setIsSelecting(false);
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
                            <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={1} />
                                <stop offset={offset} stopColor={red} stopOpacity={1} />
                            </linearGradient>
                            <linearGradient id="splitFill" x1="0" y1="0" x2="0" y2="1">
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
                            stroke="url(#splitColor)"
                            fill="url(#splitFill)"
                            strokeWidth={2}
                            baseValue={startPrice}
                            isAnimationActive={false}
                        />

                        {/* White highlight line for selected portion only */}
                        {selectionMetrics && (
                            <Area
                                type="monotone"
                                dataKey={(d) => {
                                    const idx = chartData.findIndex(cd => cd.date === d.date);
                                    if (idx >= selectionMetrics.startIdx && idx <= selectionMetrics.endIdx) {
                                        return d.value;
                                    }
                                    return null;
                                }}
                                stroke="#ffffff"
                                fill="none"
                                strokeWidth={2.5}
                                connectNulls={false}
                                isAnimationActive={false}
                            />
                        )}
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

function LoadingChart() {
    const skeletonData = [{ v: 40 }, { v: 45 }, { v: 42 }, { v: 50 }, { v: 48 }, { v: 55 }, { v: 52 }, { v: 60 }];
    return (
        <div style={{ height: '240px', width: '100%', opacity: 0.3, filter: 'grayscale(1)', cursor: 'default' }} className="animate-pulse no-select">
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <AreaChart data={skeletonData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="skeletonGradientAsset" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#525252" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#525252" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="#525252" fill="url(#skeletonGradientAsset)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
