'use client';

import { useEffect, useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis } from 'recharts';

const RANGES = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

export default function AssetChart({ symbol }) {
    const [rawData, setRawData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('1Y');

    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`);
                const json = await res.json();
                if (json.history && json.history.length > 0) {
                    setRawData(json.history.map(p => ({
                        date: p.date.split('T')[0],
                        value: p.price
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
    }, [symbol, range]);

    // Optimize data & Calculate Gradient Offset
    const { chartData, offset, startPrice } = useMemo(() => {
        if (!rawData || rawData.length === 0) return { chartData: [], offset: 0, startPrice: 0 };

        // Downsample for performance (keep max ~300 points)
        let processedData = rawData;
        if (rawData.length > 300) {
            const step = Math.ceil(rawData.length / 300);
            processedData = rawData.filter((_, i) => i % step === 0);
        }

        const start = rawData[0].value;
        const prices = processedData.map(d => d.value);
        const max = Math.max(...prices);
        const min = Math.min(...prices);

        // Calculate offset for split gradient (0 = top/max, 1 = bottom/min)
        let off = 0;
        if (max === min) {
            off = 0.5;
        } else {
            off = (max - start) / (max - min);
            if (isNaN(off) || !isFinite(off)) off = 0;
            // Clamp offset (though start should theoretically be within min/max, floating point issues or downsampling quirks might exist)
            off = Math.max(0, Math.min(1, off));
        }

        return { chartData: processedData, offset: off, startPrice: start };
    }, [rawData]);

    if (loading) return <div className="h-40 flex items-center justify-center text-muted">Loading chart...</div>;
    if (rawData.length === 0) return <div className="h-40 flex items-center justify-center text-muted">No chart data</div>;

    const green = "#22c55e";
    const red = "#ef4444";

    return (
        <div className="flex flex-col gap-4">
            <div style={{ height: '240px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
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
                                    {val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>,
                                'Price'
                            ]}
                            labelStyle={{ display: 'none' }}
                            cursor={{ stroke: '#525252', strokeWidth: 1 }}
                            isAnimationActive={false} // Improves hover performance
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
                            fontSize: '0.75rem', /* text-xs equivalent */
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
