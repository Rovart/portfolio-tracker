'use client';

import { useEffect, useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis } from 'recharts';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

export default function AssetChart({ symbol, baseCurrency = 'USD', fxRate = 1, parentLoading = false }) {
    const [rawData, setRawData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('1Y');

    // Fetch raw prices (in asset's native currency) - only when symbol/range changes
    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`);
                const json = await res.json();
                if (json.history && json.history.length > 0) {
                    // Store raw prices without FX conversion
                    setRawData(json.history.map(p => ({
                        date: p.date, // Use full timestamp
                        rawPrice: p.price // Store raw price, convert later
                    })));
                } else {
                    setRawData([]);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        if (symbol) load();
    }, [symbol, range]); // Removed fxRate - don't re-fetch when rate changes

    // Optimize data & Calculate Gradient Offset - apply FX conversion here
    const { chartData, offset, startPrice } = useMemo(() => {
        if (!rawData || rawData.length === 0) return { chartData: [], offset: 0, startPrice: 0 };

        // Downsample for performance (keep max ~300 points)
        let processedData = rawData;
        if (rawData.length > 300) {
            const step = Math.ceil(rawData.length / 300);
            processedData = rawData.filter((_, i) => i % step === 0);
        }

        // Apply FX conversion here (not during fetch)
        const convertedData = processedData.map(d => ({
            date: d.date,
            value: d.rawPrice * fxRate
        }));

        const start = rawData[0].rawPrice * fxRate;
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
    }, [rawData, fxRate]);

    if (loading || parentLoading) return <LoadingChart />;
    if (rawData.length === 0) return <div className="h-40 flex items-center justify-center text-muted">No chart data</div>;

    const green = "#22c55e";
    const red = "#ef4444";

    return (
        <div className="flex flex-col gap-4 no-select" style={{ cursor: 'default' }}>
            <div style={{ height: '240px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
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
                        <Tooltip
                            contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px' }}
                            formatter={(val) => [
                                <span style={{ color: val >= startPrice ? green : red }}>
                                    {val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                </span>,
                                'Price'
                            ]}
                            labelStyle={{ display: 'none' }}
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

            {/* Timeframe Selector */}
            <div className="flex justify-between overflow-x-auto gap-2 no-scrollbar">
                {RANGES.map(r => (
                    <button
                        key={r}
                        onClick={() => setRange(r)}
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
