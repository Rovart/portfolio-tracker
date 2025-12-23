'use client';

import { useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis, ReferenceArea } from 'recharts';

export default function ProfitChart({ data, baseCurrency, hideBalances, loading }) {
    // Range selection state
    const [selectionStart, setSelectionStart] = useState(null);
    const [selectionEnd, setSelectionEnd] = useState(null);
    const [isSelecting, setIsSelecting] = useState(false);

    const clearSelection = useCallback(() => {
        setSelectionStart(null);
        setSelectionEnd(null);
        setIsSelecting(false);
    }, []);

    const { chartData, offset, startValue } = useMemo(() => {
        if (!data || data.length === 0) return { chartData: [], offset: 0, startValue: 0 };
        let processedData = data;
        if (data.length > 300) {
            const step = Math.ceil(data.length / 300);
            processedData = data.filter((_, i) => i % step === 0);
        }
        const start = data[0].value;
        const values = processedData.map(d => d.value);
        const max = Math.max(...values);
        const min = Math.min(...values);
        let off = 0;
        if (max === min) off = 0.5;
        else {
            off = (max - start) / (max - min);
            if (isNaN(off) || !isFinite(off)) off = 0;
            off = Math.max(0, Math.min(1, off));
        }
        return { chartData: processedData, offset: off, startValue: start };
    }, [data]);

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

    if (loading || !chartData || chartData.length === 0) return <LoadingChart />;

    const green = "#22c55e";
    const red = "#ef4444";

    return (
        <div className="flex flex-col gap-2 no-select" style={{ cursor: 'default' }}>
            {/* Selection display */}
            {selectionMetrics && !hideBalances && (
                <div
                    className="flex items-center justify-between px-3 py-2 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                    onClick={clearSelection}
                >
                    <span className="text-xs text-muted">
                        {new Date(chartData[selectionMetrics.startIdx].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {' → '}
                        {new Date(chartData[selectionMetrics.endIdx].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <span className={`text-sm font-bold ${selectionMetrics.change >= 0 ? 'text-success' : 'text-danger'}`}>
                        {selectionMetrics.change >= 0 ? '+' : ''}{selectionMetrics.changePercent.toFixed(2)}%
                        <span className="font-normal text-xs ml-2">
                            ({selectionMetrics.change >= 0 ? '+' : ''}{selectionMetrics.change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency})
                        </span>
                    </span>
                </div>
            )}

            <div style={{ height: '300px', width: '100%' }}>
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
                            <linearGradient id="splitColorProfit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={1} />
                                <stop offset={offset} stopColor={red} stopOpacity={1} />
                            </linearGradient>
                            <linearGradient id="splitFillProfit" x1="0" y1="0" x2="0" y2="1">
                                <stop offset={offset} stopColor={green} stopOpacity={0.2} />
                                <stop offset={offset} stopColor={red} stopOpacity={0.2} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide axisLine={false} tickLine={false} />
                        <YAxis hide domain={['auto', 'auto']} />

                        {/* Gray overlay for areas outside selection */}
                        {selectionMetrics && (
                            <>
                                <ReferenceArea
                                    x1={chartData[0].date}
                                    x2={chartData[selectionMetrics.startIdx].date}
                                    fill="rgba(0,0,0,0.5)"
                                    fillOpacity={1}
                                />
                                <ReferenceArea
                                    x1={chartData[selectionMetrics.endIdx].date}
                                    x2={chartData[chartData.length - 1].date}
                                    fill="rgba(0,0,0,0.5)"
                                    fillOpacity={1}
                                />
                            </>
                        )}

                        <Tooltip
                            contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px', padding: '8px 12px' }}
                            formatter={(value) => [
                                <span key="val" style={{ color: value >= startValue ? green : red }}>
                                    {hideBalances ? '••••••' : `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                </span>,
                                'Value'
                            ]}
                            labelFormatter={(label) => new Date(label).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
        </div>
    );
}

function LoadingChart() {
    const skeletonData = [{ v: 40 }, { v: 45 }, { v: 42 }, { v: 50 }, { v: 48 }, { v: 55 }, { v: 52 }, { v: 60 }];
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
                    <Area type="monotone" dataKey="v" stroke="#525252" fill="url(#skeletonGradient)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
