'use client';

import { useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, YAxis } from 'recharts';

export default function ProfitChart({ data, baseCurrency, hideBalances, loading }) {
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

    if (loading || !chartData || chartData.length === 0) return <LoadingChart />;

    const green = "#22c55e";
    const red = "#ef4444";

    return (
        <div style={{ height: '300px', width: '100%', cursor: 'default' }} className="no-select">
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
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
                    <Tooltip
                        contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px' }}
                        formatter={(value) => [
                            <span style={{ color: value >= startValue ? green : red }}>
                                {hideBalances ? '••••••' : `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                            </span>,
                            'Value'
                        ]}
                        labelStyle={{ display: 'none' }}
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
