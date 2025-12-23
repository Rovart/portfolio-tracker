'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';
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
    const [rangeStart, setRangeStart] = useState(null);
    const [rangeEnd, setRangeEnd] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const chartContainerRef = useRef(null);

    // Save range preference
    const handleRangeChange = (newRange) => {
        setRange(newRange);
        localStorage.setItem('asset_chart_timeframe', newRange);
        clearRangeSelection();
    };

    // Clear range selection
    const clearRangeSelection = useCallback(() => {
        setRangeStart(null);
        setRangeEnd(null);
        setIsDragging(false);
    }, []);

    // Determine if we need FX conversion
    const needsFxConversion = assetCurrency && assetCurrency !== baseCurrency;

    // Fetch raw prices and FX history in parallel (both use cache)
    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                // Fetch asset history using cache
                const targetSym = chartSymbol || symbol;
                const pricePromise = getCachedAssetHistory(targetSym, range);

                // Fetch FX history using cache
                let fxPromise = Promise.resolve({});
                if (needsFxConversion && assetCurrency) {
                    fxPromise = getCachedFxHistory(assetCurrency, baseCurrency, range);
                }

                const [priceData, fxData] = await Promise.all([pricePromise, fxPromise]);

                // getCachedAssetHistory returns array directly: [{date, price}]
                if (priceData && priceData.length > 0) {
                    setRawData(priceData.map(p => ({
                        date: p.date,
                        rawPrice: p.price
                    })));
                } else {
                    setRawData([]);
                }

                // Set FX history from cache
                setFxHistory(fxData || {});
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        if (symbol || chartSymbol) load();
    }, [symbol, range, needsFxConversion, assetCurrency, baseCurrency, chartSymbol]);

    // Optimize data & Calculate Gradient Offset - apply FX conversion here
    const { chartData, offset, startPrice } = useMemo(() => {
        if (!rawData || rawData.length === 0) return { chartData: [], offset: 0, startPrice: 0 };

        // Downsample for performance (keep max ~300 points)
        let processedData = rawData;
        if (rawData.length > 300) {
            const step = Math.ceil(rawData.length / 300);
            processedData = rawData.filter((_, i) => i % step === 0);
        }

        // Apply FX conversion - use historical rate if available, else current fxRate
        const convertedData = processedData.map(d => {
            let rate = fxRate; // Default to current rate
            if (needsFxConversion && Object.keys(fxHistory).length > 0) {
                const dateKey = d.date.split('T')[0];
                // Try exact date, or find closest earlier date
                if (fxHistory[dateKey]) {
                    rate = fxHistory[dateKey];
                } else {
                    // Find the closest earlier date
                    const sortedDates = Object.keys(fxHistory).sort();
                    for (let i = sortedDates.length - 1; i >= 0; i--) {
                        if (sortedDates[i] <= dateKey) {
                            rate = fxHistory[sortedDates[i]];
                            break;
                        }
                    }
                }
            }
            return {
                date: d.date,
                value: d.rawPrice * rate
            };
        });

        const firstRate = needsFxConversion && Object.keys(fxHistory).length > 0
            ? (fxHistory[rawData[0].date.split('T')[0]] || fxRate)
            : fxRate;
        const start = rawData[0].rawPrice * firstRate;
        const prices = convertedData.map(d => d.value);
        const max = Math.max(...prices);
        const min = Math.min(...prices);

        // Calculate offset for split gradient (0 = top/max, 1 = bottom/min)
        let off = 0;
        if (max === min) {
            off = 0.5;
        } else {
            off = (max - start) / (max - min);
            if (isNaN(off) || !isFinite(off)) off = 0;
            off = Math.max(0, Math.min(1, off));
        }

        return { chartData: convertedData, offset: off, startPrice: start };
    }, [rawData, fxRate, fxHistory, needsFxConversion]);

    // Calculate range selection metrics
    const rangeMetrics = useMemo(() => {
        if (rangeStart === null || rangeEnd === null || chartData.length === 0) return null;

        const startIdx = Math.min(rangeStart, rangeEnd);
        const endIdx = Math.max(rangeStart, rangeEnd);

        if (startIdx < 0 || endIdx >= chartData.length) return null;

        const startValue = chartData[startIdx].value;
        const endValue = chartData[endIdx].value;
        const change = endValue - startValue;
        const changePercent = startValue !== 0 ? ((endValue - startValue) / startValue) * 100 : 0;

        return {
            startValue,
            endValue,
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

    if (loading || parentLoading) return <LoadingChart />;
    if (rawData.length === 0) return <div className="h-40 flex items-center justify-center text-muted">No chart data</div>;

    const green = "#22c55e";
    const red = "#ef4444";

    return (
        <div className="flex flex-col gap-4 no-select" style={{ cursor: 'default' }}>
            {/* Range Selection Display */}
            {rangeMetrics && (
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

            <div
                ref={chartContainerRef}
                style={{ height: '240px', width: '100%', touchAction: 'pan-y' }}
            >
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
                        <YAxis domain={['auto', 'auto']} hide />
                        {/* Reference lines for range selection */}
                        {rangeStart !== null && rangeEnd !== null && chartData[Math.min(rangeStart, rangeEnd)] && (
                            <ReferenceLine
                                y={chartData[Math.min(rangeStart, rangeEnd)].value}
                                stroke="rgba(255,255,255,0.3)"
                                strokeDasharray="4 4"
                            />
                        )}
                        <Tooltip
                            contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', padding: '8px 12px' }}
                            formatter={(val) => [
                                <span style={{ color: val >= startPrice ? green : red }}>
                                    {val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                </span>,
                                'Price'
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
                            stroke="url(#splitColor)"
                            fill="url(#splitFill)"
                            strokeWidth={2}
                            baseValue={startPrice}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Instructions for range selection */}
            {!rangeMetrics && (
                <p className="text-[10px] text-muted/50 text-center">
                    Click and drag on the chart to measure price change
                </p>
            )}

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
