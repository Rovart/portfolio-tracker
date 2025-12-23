'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import { ChevronRight } from 'lucide-react';

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

// Analyst Section - clean modern design
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

    const getBadgeStyle = () => {
        if (rec.includes('BUY') || rec.includes('STRONG')) return { bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' };
        if (rec.includes('SELL')) return { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' };
        return { bg: 'rgba(161, 161, 170, 0.12)', color: '#a1a1aa' };
    };
    const badge = getBadgeStyle();

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Analyst Rating</h3>
                <span className="text-xs text-white/40">{analysts} analysts</span>
            </div>

            <div className="flex items-center gap-4 mb-4">
                <span
                    className="px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide"
                    style={{ background: badge.bg, color: badge.color }}
                >
                    {rec}
                </span>
                <div className="flex-1" />
                {upside !== 0 && (
                    <div className="text-right">
                        <div className="text-xs text-white/40">Target upside</div>
                        <div className={`text-lg font-bold ${upside >= 0 ? 'text-success' : 'text-danger'}`}>
                            {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
                        </div>
                    </div>
                )}
            </div>

            {/* Price target scale */}
            {low && high && high > low && (
                <div className="pt-2">
                    <div className="flex justify-between text-[10px] text-white/40 mb-2">
                        <span>${low.toFixed(0)}</span>
                        <span>Target: ${target.toFixed(0)}</span>
                        <span>${high.toFixed(0)}</span>
                    </div>
                    <div className="relative h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        {/* Range bar */}
                        <div
                            className="absolute h-2 rounded-full"
                            style={{
                                left: 0,
                                width: `${((target - low) / (high - low)) * 100}%`,
                                background: 'linear-gradient(90deg, #22c55e, #3b82f6)'
                            }}
                        />
                        {/* Current price marker */}
                        <div
                            className="absolute top-1/2 w-3 h-3 rounded-full border-2 border-white shadow-lg"
                            style={{
                                left: `${Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100))}%`,
                                transform: 'translate(-50%, -50%)',
                                background: '#0a0a0a'
                            }}
                        />
                    </div>
                    <div className="flex justify-between text-[10px] text-white/30 mt-1">
                        <span>Low</span>
                        <span>Current: ${current.toFixed(0)}</span>
                        <span>High</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// Earnings Chart
function EarningsChart({ data }) {
    const earnings = data.earningsHistory.slice().reverse();
    if (earnings.length === 0) return null;

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Quarterly EPS</h3>
                <div className="flex items-center gap-4 text-[10px] text-white/40">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#3f3f46' }} />
                        Estimate
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#22c55e' }} />
                        Actual
                    </span>
                </div>
            </div>

            <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={earnings} margin={{ top: 8, right: 0, left: -24, bottom: 0 }} barGap={6}>
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
                            contentStyle={{
                                background: '#18181b',
                                border: '1px solid #27272a',
                                borderRadius: 8,
                                fontSize: 11,
                                padding: '8px 12px'
                            }}
                            labelFormatter={(v) => `Q${Math.floor(new Date(v).getMonth() / 3) + 1} ${new Date(v).getFullYear()}`}
                            formatter={(v, name) => [`$${v?.toFixed(2)}`, name === 'epsActual' ? 'Actual' : 'Estimate']}
                        />
                        <Bar dataKey="epsEstimate" fill="#3f3f46" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="epsActual" radius={[4, 4, 0, 0]}>
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
        <div>
            <h3 className="text-sm font-semibold text-white mb-3">Key Statistics</h3>
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
                {stats.map((stat, i) => (
                    <div
                        key={i}
                        className="flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                    >
                        <span className="text-sm text-white/60">{stat.label}</span>
                        <span className={`text-sm font-medium ${typeof stat.value === 'string' && stat.value.includes('%') && !stat.value.includes('-')
                                ? (parseFloat(stat.value) > 20 ? 'text-success' : 'text-white')
                                : 'text-white'
                            }`}>
                            {stat.value}
                        </span>
                    </div>
                ))}
            </div>
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
        <div>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Annual Revenue</h3>
                <span className="text-[10px] text-white/40">in billions</span>
            </div>

            <div style={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 0, left: -24, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revGradFin" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
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
                            tick={{ fill: '#52525b', fontSize: 10 }}
                            tickFormatter={(v) => `$${v.toFixed(0)}B`}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            contentStyle={{
                                background: '#18181b',
                                border: '1px solid #27272a',
                                borderRadius: 8,
                                fontSize: 11
                            }}
                            formatter={(v) => [`$${v.toFixed(1)}B`]}
                        />
                        <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#3b82f6"
                            fill="url(#revGradFin)"
                            strokeWidth={2}
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
        <div className="flex flex-col gap-6 animate-pulse">
            <div>
                <div className="h-4 w-24 bg-white/5 rounded mb-4" />
                <div className="h-10 bg-white/5 rounded-lg" />
            </div>
            <div>
                <div className="h-4 w-20 bg-white/5 rounded mb-3" />
                <div className="h-32 bg-white/5 rounded-lg" />
            </div>
            <div>
                <div className="h-4 w-28 bg-white/5 rounded mb-3" />
                <div className="space-y-0">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="h-12 bg-white/5" style={{ borderRadius: i === 1 ? '12px 12px 0 0' : i === 5 ? '0 0 12px 12px' : 0 }} />
                    ))}
                </div>
            </div>
        </div>
    );
}
