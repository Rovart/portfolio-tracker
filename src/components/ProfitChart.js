'use client';

import { memo, useId, useMemo, useState, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis, ReferenceArea, ReferenceLine } from 'recharts';

function downsamplePreserveEdges(data, maxPoints = 300) {
    if (!data || data.length <= maxPoints) return data || [];
    const step = Math.ceil(data.length / maxPoints);
    const sampled = data.filter((_, i) => i % step === 0);
    const last = data[data.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
}

function ProfitChart({ data, baseCurrency, hideBalances, loading, chartMode = 'performance' }) {
    const [selectionStart, setSelectionStart] = useState(null);
    const [selectionEnd, setSelectionEnd] = useState(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const containerRef = useRef(null);
    const chartId = useId().replace(/:/g, '');
    const splitColorId = `splitColorProfit-${chartId}`;
    const splitFillId = `splitFillProfit-${chartId}`;

    const clearSelection = useCallback(() => {
        setSelectionStart(null);
        setSelectionEnd(null);
        setIsSelecting(false);
    }, []);

    const { chartData, offset, startValue, yDomain } = useMemo(() => {
        if (!data || data.length === 0) return { chartData: [], offset: 0, startValue: 0, yDomain: [0, 100] };
        const processedData = downsamplePreserveEdges(data);
        const start = data[0].value;
        const values = processedData.map(d => d.value);
        const max = Math.max(...values);
        const min = Math.min(...values);

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
        return { chartData: processedData, offset: off, startValue: start, yDomain: fixedYDomain };
    }, [data]);

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

    if (loading) return <LoadingChart />;
    if (!chartData || chartData.length === 0) return <EmptyChart />;

    const green = "#30d158";
    const red = "#ff453a";
    const hasSelection = selectionMetrics !== null;
    const lastIndex = chartData.length - 1;
    const isTrendUp = chartData[lastIndex].value >= startValue;

    // Live indicator: a subtle pulsing dot on the most recent point
    const renderLiveDot = (props) => {
        const { cx, cy, index } = props;
        if (index !== lastIndex || cx == null || cy == null) return <g key={`dot-${index}`} />;
        const color = isTrendUp ? green : red;
        return (
            <g key="live-dot">
                <circle cx={cx} cy={cy} r="4" fill={color} opacity="0.35">
                    <animate attributeName="r" values="4;9;4" dur="2.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.35;0;0.35" dur="2.2s" repeatCount="indefinite" />
                </circle>
                <circle cx={cx} cy={cy} r="3" fill={color} stroke="var(--background)" strokeWidth="1.5" />
            </g>
        );
    };

    return (
        <div
            className="flex flex-col gap-2 no-select"
            style={{
                cursor: 'default',
                touchAction: isSelecting ? 'none' : 'pan-y',
                userSelect: 'none',
                WebkitUserSelect: 'none'
            }}
        >
            <div
                ref={containerRef}
                style={{ height: '300px', width: '100%', position: 'relative' }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Selection metrics overlay on chart */}
                {selectionMetrics && !hideBalances && (
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
                            {selectionMetrics.change >= 0 ? '+' : ''}{hideBalances ? '••••' : selectionMetrics.change.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
                        </span>
                        <span className={`text-xs font-bold ${selectionMetrics.change >= 0 ? 'text-success' : 'text-danger'}`}>
                            ({selectionMetrics.change >= 0 ? '+' : ''}{selectionMetrics.changePercent.toFixed(2)}%)
                        </span>
                    </div>
                )}

                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <AreaChart
                        data={chartData}
                        margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
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
                            {/* Fill fades away from the baseline on both sides for depth */}
                            <linearGradient id={splitFillId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor={green} stopOpacity={0.28} />
                                <stop offset={offset} stopColor={green} stopOpacity={0.03} />
                                <stop offset={offset} stopColor={red} stopOpacity={0.03} />
                                <stop offset="1" stopColor={red} stopOpacity={0.24} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide axisLine={false} tickLine={false} />
                        <YAxis hide domain={yDomain} />

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

                        {/* Hide tooltip when selecting or when there's an active selection */}
                        {!isSelecting && !hasSelection && (
                            <Tooltip
                                contentStyle={{ backgroundColor: 'var(--card-bg-hi)', border: '1px solid var(--card-border-strong)', borderRadius: '10px', padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', fontVariantNumeric: 'tabular-nums' }}
                                formatter={(value) => [
                                    <span key="val" style={{ color: value >= startValue ? green : red }}>
                                        {hideBalances ? '••••••' : `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                    </span>,
                                    chartMode === 'value' ? 'Value' : 'Performance'
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
                            fillOpacity={1}
                            baseValue={startValue}
                            isAnimationActive={false}
                            dot={renderLiveDot}
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
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default memo(ProfitChart);

function LoadingChart() {
    return (
        <div style={{ height: '300px', width: '100%', opacity: 0.6, cursor: 'default', position: 'relative', overflow: 'hidden' }} className="animate-pulse no-select">
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 58, height: 2, background: '#525252', transform: 'skewY(-6deg)', transformOrigin: 'left center' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 130, background: 'linear-gradient(180deg, rgba(82,82,82,0.22), rgba(82,82,82,0))', clipPath: 'polygon(0 48%, 14% 43%, 28% 50%, 42% 34%, 56% 40%, 70% 25%, 84% 34%, 100% 14%, 100% 100%, 0 100%)' }} />
        </div>
    );
}

// Static, calm empty state — a flat baseline instead of an endlessly pulsing fake chart
function EmptyChart() {
    return (
        <div className="no-select" style={{ height: '300px', width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: '1px', background: 'var(--card-border)' }} />
            <span style={{ position: 'relative', fontSize: '0.8rem', color: 'var(--text-faint)', background: 'var(--background)', padding: '0 12px' }}>
                Add a transaction to see your portfolio history
            </span>
        </div>
    );
}
