'use client';

import { useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';

export default function ProfitChart({ data, baseCurrency, hideBalances, loading }) {
    // Range selection state
    const [rangeStart, setRangeStart] = useState(null);
    const [rangeEnd, setRangeEnd] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    // Clear range selection
    const clearRangeSelection = useCallback(() => {
        setRangeStart(null);
        setRangeEnd(null);
        setIsDragging(false);
    }, []);

    // Optimize data & Calculate Gradient Offset
    const { chartData, offset, startValue } = useMemo(() => {
        if (!data || data.length === 0) return { chartData: [], offset: 0, startValue: 0 };

        // Downsample for performance (keep max ~300 points)
        let processedData = data;
        if (data.length > 300) {
            const step = Math.ceil(data.length / 300);
            processedData = data.filter((_, i) => i % step === 0);
        }

        const start = data[0].value;
        const values = processedData.map(d => d.value);
        const max = Math.max(...values);
        const min = Math.min(...values);

        // Calculate offset (0 = top/max, 1 = bottom/min)
        let off = 0;
        if (max === min) {
            off = 0.5;
        } else {
            off = (max - start) / (max - min);
            if (isNaN(off) || !isFinite(off)) off = 0;
            off = Math.max(0, Math.min(1, off));
        }

        return { chartData: processedData, offset: off, startValue: start };
    }, [data]);

    // Calculate range selection metrics
    const rangeMetrics = useMemo(() => {
        if (rangeStart === null || rangeEnd === null || chartData.length === 0) return null;

        const startIdx = Math.min(rangeStart, rangeEnd);
        const endIdx = Math.max(rangeStart, rangeEnd);

        if (startIdx < 0 || endIdx >= chartData.length) return null;

        const startVal = chartData[startIdx].value;
        const endVal = chartData[endIdx].value;
        const change = endVal - startVal;
        const changePercent = startVal !== 0 ? ((endVal - startVal) / startVal) * 100 : 0;

        return {
            startValue: startVal,
            endValue: endVal,
            change,
            changePercent,
            startDate: chartData[startIdx].date,
            endDate: chartData[endIdx].date
        };
    }, [rangeStart, rangeEnd, chartData]);

    // Handle chart mouse/touch events for range selection
    const handleChartMouseDown = useCallback((e) => {
        if (!e || !e.activeTooltipIndex) return;
        setRangeStart(e.activeTooltipIndex);
        setRangeEnd(e.activeTooltipIndex);
        setIsDragging(true);
    }, []);

    const handleChartMouseMove = useCallback((e) => {
        if (!isDragging || !e || e.activeTooltipIndex === undefined) return;
        setRangeEnd(e.activeTooltipIndex);
    }, [isDragging]);

    const handleChartMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    if (loading || !chartData || chartData.length === 0) return <LoadingChart />;

    const green = "#22c55e";
    const red = "#ef4444";

    return (
        <div className="flex flex-col gap-2 no-select" style={{ cursor: 'default' }}>
            {/* Range Selection Display */}
            {rangeMetrics && !hideBalances && (
                <div
                    className="flex items-center justify-between p-3 rounded-xl animate-in fade-in"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                    <div className="flex flex-col">
                        <span className="text-[10px] text-muted uppercase tracking-wider">Range Selection</span>
                        <span className="text-xs text-white/70">
                            {new Date(rangeMetrics.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} → {new Date(rangeMetrics.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                            <span className={`text-lg font-bold ${rangeMetrics.changePercent >= 0 ? 'text-success' : 'text-danger'}`}>
                                {rangeMetrics.changePercent >= 0 ? '+' : ''}{rangeMetrics.changePercent.toFixed(2)}%
                            </span>
                            <span className={`text-xs ${rangeMetrics.change >= 0 ? 'text-success' : 'text-danger'}`}>
                                {rangeMetrics.change >= 0 ? '+' : ''}{rangeMetrics.change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                            </span>
                        </div>
                        <button
                            onClick={clearRangeSelection}
                            className="p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-white transition-colors"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            <div style={{ height: '300px', width: '100%', touchAction: 'pan-y' }}>
                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <AreaChart
                        data={chartData}
                        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                        onMouseDown={handleChartMouseDown}
                        onMouseMove={handleChartMouseMove}
                        onMouseUp={handleChartMouseUp}
                        onMouseLeave={handleChartMouseUp}
                    >
                        <defs>
                            <linearGradient id="splitColorProfit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={1} />
                                <stop offset={offset} stopColor={red} stopOpacity={1} />
                            </linearGradient>
                            <linearGradient id="splitFillProfit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={0.2} />
                                <stop offset={offset} stopColor={red} stopOpacity={0.2} />
                            </linearGradient>
                        </defs>
                        <XAxis
                            dataKey="date"
                            hide
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            hide
                            domain={['auto', 'auto']}
                        />
                        {/* Reference line for range selection */}
                        {rangeStart !== null && rangeEnd !== null && chartData[Math.min(rangeStart, rangeEnd)] && (
                            <ReferenceLine
                                y={chartData[Math.min(rangeStart, rangeEnd)].value}
                                stroke="rgba(255,255,255,0.3)"
                                strokeDasharray="4 4"
                            />
                        )}
                        <Tooltip
                            contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px', padding: '8px 12px' }}
                            formatter={(value) => [
                                <span style={{ color: value >= startValue ? green : red }}>
                                    {hideBalances ? '••••••' : `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                </span>,
                                'Value'
                            ]}
                            labelFormatter={(label) => {
                                const date = new Date(label);
                                return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                            }}
                            labelStyle={{ color: '#a1a1aa', fontSize: '0.75rem', marginBottom: '4px' }}
                            cursor={{ stroke: '#525252', strokeWidth: 1 }}
                            isAnimationActive={false}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="url(#splitColorProfit)"
                            fill="url(#splitFillProfit)"
                            strokeWidth={2}
                            fillOpacity={1}
                            baseValue={startValue}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Instructions for range selection */}
            {!rangeMetrics && (
                <p className="text-[10px] text-muted/50 text-center mt-1">
                    Click and drag on the chart to measure portfolio change
                </p>
            )}
        </div>
    );
}

function LoadingChart() {
    // Static waving data for the skeleton
    const skeletonData = [
        { v: 40 }, { v: 45 }, { v: 42 }, { v: 50 }, { v: 48 }, { v: 55 }, { v: 52 }, { v: 60 }
    ];

    return (
        <div style={{ height: '300px', width: '100%', opacity: 0.6, filter: 'grayscale(1)', cursor: 'default' }} className="animate-pulse no-select">
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <AreaChart data={skeletonData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="skeletonGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#525252" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#525252" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <Area
                        type="monotone"
                        dataKey="v"
                        stroke="#525252"
                        fill="url(#skeletonGradient)"
                        strokeWidth={2}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
