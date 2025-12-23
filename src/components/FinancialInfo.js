'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, ComposedChart, Line } from 'recharts';

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
        data.earningsHistory?.length > 0;

    if (!hasData) return null;

    return (
        <div className="flex flex-col gap-6 pb-4">
            {/* Key Stats */}
            <StatsSection data={data} />

            {/* Profitability Trend */}
            {data.incomeStatement?.filter(i => i.totalRevenue).length > 1 && (
                <ProfitabilityTrend data={data} />
            )}

            {/* Earnings Chart */}
            {data.earningsHistory?.length > 0 && (
                <EarningsChart data={data} />
            )}

            {/* Revenue Trend */}
            {data.incomeStatement?.filter(i => i.totalRevenue).length > 1 && (
                <RevenueTrend data={data} />
            )}

            {/* Financial Health / Liquidity */}
            {(data.financialData?.totalCash || data.financialData?.totalDebt) && (
                <FinancialHealth data={data} />
            )}
        </div>
    );
}

// Number formatting
const formatNum = (n, d = 1) => {
    if (n === null || n === undefined || isNaN(n) || n === 0) return null;
    if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(d)}T`;
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(d)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(d)}M`;
    return `$${n.toFixed(d)}`;
};

const formatPct = (n) => {
    if (n === null || n === undefined || isNaN(n) || n === 0) return null;
    return `${(n * 100).toFixed(1)}%`;
};

// Reusable Premium Tooltip
const CustomTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
    if (!active || !payload?.length) return null;

    return (
        <div className="px-5 py-4 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-xl" style={{ background: 'rgba(10, 10, 10, 0.95)' }}>
            <div className="text-xs text-white/30 uppercase tracking-[0.2em] font-bold mb-4 border-b border-white/5 pb-2">
                {label}
            </div>
            <div className="flex flex-col gap-3">
                {payload.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-10">
                        <div className="flex items-center gap-2.5">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color || p.fill }} />
                            <span className="text-xs font-medium text-white/50">{p.name}</span>
                        </div>
                        <span className="text-xs font-bold" style={{ color: p.color || p.fill }}>
                            {prefix}{typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : p.value}{suffix}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Specialized EPS Tooltip
const EpsTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const estimate = payload.find(p => p.dataKey === 'epsEstimate')?.value;
    const actual = payload.find(p => p.dataKey === 'epsActual')?.value;
    const beat = actual >= estimate;

    return (
        <div className="px-5 py-4 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-xl" style={{ background: 'rgba(10, 10, 10, 0.95)' }}>
            <div className="text-xs text-white/30 uppercase tracking-[0.2em] font-bold mb-4 border-b border-white/5 pb-2">
                Q{Math.floor(new Date(label).getMonth() / 3) + 1} {new Date(label).getFullYear()}
            </div>
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-10">
                    <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#444446' }} />
                        <span className="text-xs font-medium text-white/50">Estimate</span>
                    </div>
                    <span className="text-xs font-bold text-white/80">${estimate?.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-10">
                    <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: beat ? '#22c55e' : '#ef4444' }} />
                        <span className="text-xs font-medium text-white/50">Actual</span>
                    </div>
                    <span className="text-xs font-bold" style={{ color: beat ? '#22c55e' : '#ef4444' }}>
                        ${actual?.toFixed(2)}
                    </span>
                </div>
                {beat && (
                    <div className="mt-1 pt-2 border-t border-white/5 text-xs text-success/80 font-semibold tracking-wide uppercase">
                        Beat by {((actual - estimate) / Math.abs(estimate) * 100).toFixed(1)}%
                    </div>
                )}
            </div>
        </div>
    );
};

// Profitability Trend (Revenue vs Net Income + Margin line)
function ProfitabilityTrend({ data }) {
    const chartData = data.incomeStatement
        .filter(i => i.totalRevenue)
        .slice()
        .reverse()
        .map(i => ({
            year: `'${new Date(i.date).getFullYear().toString().slice(2)}`,
            revenue: i.totalRevenue / 1e9,
            income: i.netIncome ? i.netIncome / 1e9 : 0,
            margin: i.netIncome && i.totalRevenue ? (i.netIncome / i.totalRevenue * 100) : 0
        }));

    return (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-baseline justify-between mb-8">
                <span className="text-xs font-semibold text-white/90 uppercase tracking-wide">Profitability Trend</span>
                <span className="text-xs text-white/20 lowercase">billions USD</span>
            </div>

            <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
                        <XAxis dataKey="year" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="left" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}B`} />
                        <YAxis yAxisId="right" orientation="right" hide domain={[0, 'auto']} />
                        <Tooltip content={<CustomTooltip prefix="$" suffix="B" />} cursor={false} />
                        <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#3b82f6" opacity={0.1} radius={[2, 2, 0, 0]} barSize={25} />
                        <Bar yAxisId="left" dataKey="income" name="Net Income" fill="#22c55e" radius={[2, 2, 0, 0]} barSize={25} />
                        <Line yAxisId="right" type="monotone" dataKey="margin" name="Net Margin" stroke="#eab308" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// Financial Health (Liquidity comparison)
function FinancialHealth({ data }) {
    const fd = data.financialData;
    const cash = fd.totalCash || 0;
    const debt = fd.totalDebt || 0;
    const total = cash + debt;

    // Percentages for the stacked bar
    const cashWidth = total > 0 ? (cash / total) * 100 : 0;
    const debtWidth = total > 0 ? (debt / total) * 100 : 0;

    return (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-baseline justify-between mb-6">
                <span className="text-xs font-semibold text-white/90 uppercase tracking-wide">Liquidity & Debt</span>
                <span className="text-xs text-white/20 lowercase">Overall Health</span>
            </div>

            <div className="flex flex-col gap-6">
                {/* Modern Stacked Indicator */}
                <div className="flex flex-col gap-2">
                    <div className="flex h-3 rounded-full overflow-hidden bg-white/5">
                        <div style={{ width: `${cashWidth}%`, background: '#22c55e' }} className="h-full" />
                        <div style={{ width: `${debtWidth}%`, background: '#ef4444' }} className="h-full opacity-60" />
                    </div>
                    <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest px-1">
                        <span className="text-success">CASH {cashWidth.toFixed(0)}%</span>
                        <span className="text-danger">DEBT {debtWidth.toFixed(0)}%</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                        <span className="text-[10px] text-white/40 uppercase font-medium">Total Cash</span>
                        <span className="text-sm font-bold text-white">{formatNum(cash)}</span>
                    </div>
                    <div className="flex flex-col gap-1 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                        <span className="text-[10px] text-white/40 uppercase font-medium">Total Debt</span>
                        <span className="text-sm font-bold text-white">{formatNum(debt)}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-white/40 uppercase font-medium">Current Ratio</span>
                        <span className="text-[9px] text-white/20 lowercase italic">Ability to pay short-term debt</span>
                    </div>
                    <div className={`text-xl font-black ${fd.currentRatio > 2 ? 'text-success' : fd.currentRatio < 1 ? 'text-danger' : 'text-white'}`}>
                        {fd.currentRatio?.toFixed(2)}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Earnings Chart
function EarningsChart({ data }) {
    const earnings = data.earningsHistory.slice().reverse();
    if (earnings.length === 0) return null;

    return (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-baseline justify-between mb-8">
                <span className="text-xs font-semibold text-white/90 uppercase tracking-wide">Quarterly EPS Evolution</span>
            </div>

            <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={earnings} margin={{ top: 0, right: 0, left: -24, bottom: 0 }} barGap={2}>
                        <XAxis dataKey="date" tick={{ fill: '#52525b', fontSize: 10 }} tickFormatter={(v) => `Q${Math.floor(new Date(v).getMonth() / 3) + 1}`} axisLine={false} tickLine={false} />
                        <YAxis domain={['auto', 'auto']} tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                        <Tooltip content={<EpsTooltip />} cursor={false} />
                        <Bar dataKey="epsEstimate" fill="#444446" radius={[2, 2, 2, 2]} barSize={5} />
                        <Bar dataKey="epsActual" radius={[4, 4, 4, 4]} barSize={12}>
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
        { label: 'P/E Ratio', value: (sd.trailingPE && sd.trailingPE > 0) ? sd.trailingPE.toFixed(1) : null },
        { label: 'Forward P/E', value: (ks.forwardPE && ks.forwardPE > 0) ? ks.forwardPE.toFixed(1) : null },
        { label: 'PEG Ratio', value: (ks.pegRatio && ks.pegRatio > 0) ? ks.pegRatio.toFixed(2) : null },
        { label: 'Dividend Yield', value: formatPct(sd.dividendYield) },
        { label: 'Beta', value: (ks.beta && ks.beta !== 0) ? ks.beta.toFixed(2) : null },
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
        { label: 'Debt to Equity', value: (fd.debtToEquity && fd.debtToEquity > 0) ? fd.debtToEquity.toFixed(0) : null },
        { label: 'Free Cash Flow', value: formatNum(fd.freeCashflow) },
    ].filter(s => s.value !== null && s.value !== '0.0' && s.value !== '0.00');

    if (stats.length === 0) return null;

    return (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Key Statistics</span>
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
            <div className="flex items-baseline justify-between mb-8">
                <span className="text-xs font-semibold text-white/90 uppercase tracking-wide">Historical Revenue</span>
                <span className="text-xs text-white/20 lowercase">billions USD</span>
            </div>

            <div style={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revGradFin" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="year" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis domain={['auto', 'auto']} tick={{ fill: '#52525b', fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(0)}B`} axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomTooltip prefix="$" suffix="B" />} cursor={false} />
                        <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#revGradFin)" strokeWidth={2} name="Revenue" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col gap-4 animate-pulse">
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
