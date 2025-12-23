'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';

export default function FinancialInfo({ symbol, baseCurrency = 'USD' }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function fetchData() {
            if (!symbol) return;
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`);
                if (!res.ok) throw new Error('Failed to fetch');
                const json = await res.json();
                setData(json.data);
            } catch (e) {
                setError('Financial data not available');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [symbol]);

    if (loading) return <LoadingSkeleton />;
    if (error || !data) return null;

    // Check if there's any meaningful data
    const hasData = data.summaryDetail?.marketCap ||
        data.financialData?.numberOfAnalystOpinions ||
        data.earningsHistory?.length > 0;

    if (!hasData) return null;

    return (
        <div className="flex flex-col gap-6 pb-4">
            {/* Analyst Rating Section */}
            {data.financialData?.numberOfAnalystOpinions > 0 && (
                <AnalystSection data={data} />
            )}

            {/* Earnings Chart */}
            {data.earningsHistory?.length > 0 && (
                <EarningsChart data={data} />
            )}

            {/* Key Stats */}
            <StatsSection data={data} />

            {/* Revenue Trend */}
            {data.incomeStatement?.filter(i => i.totalRevenue).length > 1 && (
                <RevenueTrend data={data} />
            )}
        </div>
    );
}

// Number formatting
const formatNum = (n, d = 1) => {
    if (n === null || n === undefined || isNaN(n)) return null;
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(d)}T`;
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(d)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(d)}M`;
    return `$${n.toFixed(d)}`;
};

const formatPct = (n) => {
    if (n === null || n === undefined || isNaN(n)) return null;
    return `${(n * 100).toFixed(1)}%`;
};

// Analyst Section - cleaner design
function AnalystSection({ data }) {
    const fd = data.financialData;
    const rec = fd.recommendationKey?.toUpperCase().replace(/_/g, ' ');
    if (!rec) return null;

    const analysts = fd.numberOfAnalystOpinions;
    const current = fd.currentPrice || 0;
    const target = fd.targetMeanPrice || 0;
    const low = fd.targetLowPrice;
    const high = fd.targetHighPrice;
    const upside = current > 0 ? ((target - current) / current * 100) : 0;

    const isBuy = rec.includes('BUY') || rec.includes('STRONG');
    const isSell = rec.includes('SELL');

    return (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Analyst Consensus</span>
                <span className="text-[11px] text-white/30">{analysts} analysts</span>
            </div>

            <div className="flex items-baseline gap-3 mb-4">
                <span className={`text-2xl font-bold ${isBuy ? 'text-success' : isSell ? 'text-danger' : 'text-white'}`}>
                    {rec}
                </span>
                {upside !== 0 && (
                    <span className={`text-sm font-medium ${upside >= 0 ? 'text-success' : 'text-danger'}`}>
                        {upside >= 0 ? '+' : ''}{upside.toFixed(0)}% upside
                    </span>
                )}
            </div>

            {/* Price target row */}
            {low && high && high > low && (
                <div className="flex items-center gap-3 text-xs">
                    <div className="text-white/40">
                        <div className="text-[10px] uppercase">Low</div>
                        <div className="font-medium text-white/70">${low.toFixed(0)}</div>
                    </div>

                    <div className="flex-1 relative h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                            className="absolute h-1 rounded-full"
                            style={{
                                left: 0,
                                width: `${((target - low) / (high - low)) * 100}%`,
                                background: isBuy ? '#22c55e' : isSell ? '#ef4444' : '#3b82f6'
                            }}
                        />
                        <div
                            className="absolute top-1/2 w-2 h-2 rounded-full bg-white"
                            style={{
                                left: `${Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100))}%`,
                                transform: 'translate(-50%, -50%)',
                                boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                            }}
                        />
                    </div>

                    <div className="text-white/40 text-right">
                        <div className="text-[10px] uppercase">High</div>
                        <div className="font-medium text-white/70">${high.toFixed(0)}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Custom tooltip for EPS chart
const EpsTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const estimate = payload.find(p => p.dataKey === 'epsEstimate')?.value;
    const actual = payload.find(p => p.dataKey === 'epsActual')?.value;
    const beat = actual >= estimate;

    return (
        <div className="px-3 py-2 rounded-lg" style={{ background: '#1c1c1e', border: '1px solid #38383a' }}>
            <div className="text-[11px] text-white/50 mb-1">
                Q{Math.floor(new Date(label).getMonth() / 3) + 1} {new Date(label).getFullYear()}
            </div>
            <div className="flex items-center gap-4">
                <div>
                    <div className="text-[10px] text-white/40">Est</div>
                    <div className="text-sm font-medium text-white/70">${estimate?.toFixed(2)}</div>
                </div>
                <div>
                    <div className="text-[10px] text-white/40">Actual</div>
                    <div className={`text-sm font-bold ${beat ? 'text-success' : 'text-danger'}`}>
                        ${actual?.toFixed(2)}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Earnings Chart - cleaner
function EarningsChart({ data }) {
    const earnings = data.earningsHistory.slice().reverse();
    if (earnings.length === 0) return null;

    return (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Quarterly EPS</span>
                <div className="flex items-center gap-3 text-[10px] text-white/40">
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#3f3f46' }} />
                        Est
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#22c55e' }} />
                        Beat
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#ef4444' }} />
                        Miss
                    </span>
                </div>
            </div>

            <div style={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={earnings} margin={{ top: 8, right: 0, left: -24, bottom: 0 }} barGap={4}>
                        <XAxis
                            dataKey="date"
                            tick={{ fill: '#52525b', fontSize: 10 }}
                            tickFormatter={(v) => `Q${Math.floor(new Date(v).getMonth() / 3) + 1}`}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: '#52525b', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `$${v}`}
                        />
                        <Tooltip
                            content={<EpsTooltip />}
                            cursor={false}
                        />
                        <Bar dataKey="epsEstimate" fill="#3f3f46" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="epsActual" radius={[3, 3, 0, 0]}>
                            {earnings.map((e, i) => (
                                <Cell key={i} fill={e.epsActual >= e.epsEstimate ? '#22c55e' : '#ef4444'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// Stats Section - clean list style
function StatsSection({ data }) {
    const sd = data.summaryDetail || {};
    const ks = data.keyStats || {};
    const fd = data.financialData || {};

    const stats = [
        { label: 'Market Cap', value: formatNum(sd.marketCap) },
        { label: 'P/E Ratio', value: sd.trailingPE?.toFixed(1) },
        { label: 'Forward P/E', value: ks.forwardPE?.toFixed(1) },
        { label: 'PEG Ratio', value: ks.pegRatio?.toFixed(2) },
        { label: 'Dividend Yield', value: formatPct(sd.dividendYield) },
        { label: 'Beta', value: ks.beta?.toFixed(2) },
        {
            label: '52W Range', value: sd.fiftyTwoWeekLow && sd.fiftyTwoWeekHigh ?
                `$${sd.fiftyTwoWeekLow.toFixed(0)} - $${sd.fiftyTwoWeekHigh.toFixed(0)}` : null
        },
        { label: 'Gross Margin', value: formatPct(fd.grossMargins) },
        { label: 'Operating Margin', value: formatPct(fd.operatingMargins) },
        { label: 'Profit Margin', value: formatPct(fd.profitMargins) },
        { label: 'Return on Equity', value: formatPct(fd.returnOnEquity) },
        { label: 'Revenue Growth', value: formatPct(fd.revenueGrowth) },
        { label: 'Total Cash', value: formatNum(fd.totalCash) },
        { label: 'Total Debt', value: formatNum(fd.totalDebt) },
        { label: 'Debt to Equity', value: fd.debtToEquity?.toFixed(0) },
        { label: 'Free Cash Flow', value: formatNum(fd.freeCashflow) },
    ].filter(s => s.value !== null);

    if (stats.length === 0) return null;

    return (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <span className="text-xs font-medium text-white/50 uppercase tracking-wider">Key Statistics</span>
            </div>
            {stats.map((stat, i) => (
                <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}
                >
                    <span className="text-sm text-white/50">{stat.label}</span>
                    <span className={`text-sm font-medium ${typeof stat.value === 'string' && stat.value.includes('%') && !stat.value.includes('-')
                        ? (parseFloat(stat.value) > 20 ? 'text-success' : 'text-white')
                        : 'text-white'
                        }`}>
                        {stat.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

// Revenue Trend
function RevenueTrend({ data }) {
    const chartData = data.incomeStatement
        .filter(i => i.totalRevenue)
        .slice()
        .reverse()
        .map(i => ({
            year: `'${new Date(i.date).getFullYear().toString().slice(2)}`,
            revenue: i.totalRevenue / 1e9,
            income: i.netIncome ? i.netIncome / 1e9 : 0
        }));

    if (chartData.length < 2) return null;

    return (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-baseline justify-between mb-4">
                <span className="text-xs font-semibold text-white/90 uppercase tracking-wide">Annual Revenue</span>
                <span className="text-[10px] text-white/20 lowercase">billions USD</span>
            </div>

            <div style={{ height: 100 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 0, left: -24, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revGradFin" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis
                            dataKey="year"
                            tick={{ fill: '#52525b', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            domain={['auto', 'auto']}
                            tick={{ fill: '#52525b', fontSize: 10 }}
                            tickFormatter={(v) => `$${v.toFixed(0)}B`}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            contentStyle={{
                                background: '#1c1c1e',
                                border: '1px solid #38383a',
                                borderRadius: 8,
                                fontSize: 11,
                                padding: '6px 10px'
                            }}
                            formatter={(v) => [`$${v.toFixed(1)}B`]}
                            labelStyle={{ color: '#a1a1aa', fontSize: 10, marginBottom: 2 }}
                            cursor={false}
                        />
                        <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#3b82f6"
                            fill="url(#revGradFin)"
                            strokeWidth={1.5}
                            name="Revenue"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col gap-4 animate-pulse">
            <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="h-3 w-24 rounded mb-4" style={{ background: 'rgba(255,255,255,0.05)' }} />
                <div className="h-8 w-20 rounded mb-3" style={{ background: 'rgba(255,255,255,0.05)' }} />
                <div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
            </div>
            <div className="rounded-2xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="p-4">
                    <div className="h-3 w-20 rounded" style={{ background: 'rgba(255,255,255,0.05)' }} />
                </div>
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="px-4 py-3 flex justify-between">
                        <div className="h-4 w-24 rounded" style={{ background: 'rgba(255,255,255,0.03)' }} />
                        <div className="h-4 w-16 rounded" style={{ background: 'rgba(255,255,255,0.03)' }} />
                    </div>
                ))}
            </div>
        </div>
    );
}
