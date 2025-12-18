'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, Sector } from 'recharts';
import { useMemo, useState } from 'react';

const renderActiveShape = (props) => {
    const RADIAN = Math.PI / 180;
    const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
    const sin = Math.sin(-RADIAN * midAngle);
    const cos = Math.cos(-RADIAN * midAngle);
    const sx = cx + (outerRadius + 10) * cos;
    const sy = cy + (outerRadius + 10) * sin;
    const mx = cx + (outerRadius + 30) * cos;
    const my = cy + (outerRadius + 30) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 22;
    const ey = my;
    const textAnchor = cos >= 0 ? 'start' : 'end';

    return (
        <g>
            <text x={cx} y={cy} dy={8} textAnchor="middle" fill={fill} style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                {payload.name}
            </text>
            <Sector
                cx={cx}
                cy={cy}
                innerRadius={innerRadius}
                outerRadius={outerRadius + 8}
                startAngle={startAngle}
                endAngle={endAngle}
                fill={fill}
            />
            <Sector
                cx={cx}
                cy={cy}
                startAngle={startAngle}
                endAngle={endAngle}
                innerRadius={outerRadius + 10}
                outerRadius={outerRadius + 12}
                fill={fill}
            />
        </g>
    );
};

export default function CompositionChart({ holdings, baseCurrency, hideBalances, loading }) {
    const [activeIndex, setActiveIndex] = useState(null);

    const onPieEnter = (_, index) => {
        setActiveIndex(index);
    };

    const onPieLeave = () => {
        setActiveIndex(null);
    };

    const data = useMemo(() => {
        if (!holdings || holdings.length === 0) return [];

        const categories = {};
        holdings.forEach(h => {
            const cat = h.category || 'Other';
            categories[cat] = (categories[cat] || 0) + (h.value || 0);
        });

        return Object.entries(categories)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);
    }, [holdings]);

    if (loading) return <LoadingPie />;
    if (!data || data.length === 0) return null;

    const COLORS = {
        'Currencies': '#3b82f6',
        'ETFs': '#8b5cf6',
        'Crypto': '#f59e0b',
        'Shares': '#10b981',
        'Funds': '#ec4899',
        'Other': '#64748b'
    };

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const item = payload[0].payload;
            return (
                <div style={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)' }}>
                    <p style={{ color: '#fff', margin: 0, fontWeight: 'bold', fontSize: '0.9rem' }}>{item.name}</p>
                    <p style={{ color: payload[0].color, margin: 0, fontSize: '1rem' }}>
                        {hideBalances ? '••••••' : `${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ height: '380px', width: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
            <h2 className="text-sm text-muted uppercase tracking-widest font-bold mb-4" style={{ fontSize: '0.75rem' }}>Portfolio Composition</h2>
            <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            activeIndex={activeIndex}
                            activeShape={renderActiveShape}
                            data={data}
                            cx="50%"
                            cy="45%"
                            innerRadius={70}
                            outerRadius={95}
                            paddingAngle={4}
                            dataKey="value"
                            isAnimationActive={true}
                            stroke="none"
                            onMouseEnter={onPieEnter}
                            onMouseLeave={onPieLeave}
                        >
                            {data.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[entry.name] || COLORS['Other']}
                                    style={{
                                        filter: activeIndex !== null && activeIndex !== index ? 'opacity(0.6)' : 'none',
                                        transition: 'all 0.3s ease'
                                    }}
                                />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            verticalAlign="bottom"
                            align="center"
                            iconType="circle"
                            formatter={(value) => <span style={{ color: '#a1a1aa', fontSize: '0.875rem' }}>{value}</span>}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function LoadingPie() {
    const dummyData = [{ value: 1 }];
    return (
        <div style={{ height: '380px', width: '100%', display: 'flex', flexDirection: 'column', background: 'transparent' }} className="animate-pulse">
            <h2 className="text-sm text-muted uppercase tracking-widest font-bold mb-4" style={{ fontSize: '0.75rem' }}>Portfolio Composition</h2>
            <div style={{ flex: 1, minHeight: 0, opacity: 0.15 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={dummyData}
                            cx="50%"
                            cy="45%"
                            innerRadius={70}
                            outerRadius={95}
                            dataKey="value"
                            stroke="none"
                            fill="#525252"
                            isAnimationActive={false}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
