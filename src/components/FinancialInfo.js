'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import { TrendingUp, TrendingDown, Calendar, Target, Activity, DollarSign, PieChart, BarChart2 } from 'lucide-react';

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
                setError('Financial data not available for this asset');
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [symbol]);

    if (loading) return <LoadingSkeleton />;
    if (error) return <ErrorState message={error} />;
    if (!data) return <ErrorState message="No financial data available" />;

    return (
        <div className="flex flex-col gap-5">
            {/* Key Metrics Row */}
            <KeyMetricsRow data={data} />

            {/* Analyst Section */}
            {data.financialData?.numberOfAnalystOpinions > 0 && (
                <AnalystCard data={data} />
            )}

            {/* Earnings History */}
            {data.earningsHistory?.length > 0 && (
                <EarningsCard data={data} />
            )}

            {/* Upcoming Events */}
            {data.calendarEvents && <EventsCard data={data} />}

            {/* Detailed Metrics */}
            <DetailedMetrics data={data} />

            {/* Revenue Chart */}
            {data.incomeStatement?.filter(i => i.totalRevenue).length > 1 && (
                <RevenueCard data={data} />
            )}
        </div>
    );
}

// Format helpers
const fmt = (num, decimals = 2) => {
    if (num === null || num === undefined || isNaN(num)) return null;
    if (Math.abs(num) >= 1e12) return `${(num / 1e12).toFixed(decimals)}T`;
    if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
    if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
    if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
    return num.toFixed ? num.toFixed(decimals) : String(num);
};

const pct = (num) => {
    if (num === null || num === undefined || isNaN(num)) return null;
    return `${(num * 100).toFixed(1)}%`;
};

// Key Metrics - compact row
function KeyMetricsRow({ data }) {
    const metrics = [
        { label: 'Mkt Cap', value: fmt(data.summaryDetail?.marketCap, 1) },
        { label: 'P/E', value: data.summaryDetail?.trailingPE?.toFixed(1) },
        { label: 'Div', value: pct(data.summaryDetail?.dividendYield) },
        { label: 'Beta', value: data.keyStats?.beta?.toFixed(2) },
    ].filter(m => m.value !== null);

    if (metrics.length === 0) return null;

    return (
        <div className="flex gap-2">
            {metrics.map((m, i) => (
                <div
                    key={i}
                    className="flex-1 p-3 rounded-xl text-center"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">{m.label}</div>
                    <div className="text-sm font-semibold text-white">{m.value}</div>
                </div>
            ))}
        </div>
    );
}

// Analyst Card
function AnalystCard({ data }) {
    const fd = data.financialData;
    const rec = fd.recommendationKey?.replace(/_/g, ' ').toUpperCase();
    if (!rec) return null;

    const isBuy = rec.includes('BUY');
    const isSell = rec.includes('SELL');
    const recColor = isBuy ? '#22c55e' : isSell ? '#ef4444' : '#a1a1aa';

    const current = fd.currentPrice || 0;
    const target = fd.targetMeanPrice || 0;
    const upside = current > 0 ? ((target - current) / current * 100) : null;
    const low = fd.targetLowPrice;
    const high = fd.targetHighPrice;

    const pricePosition = low && high && high > low
        ? Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100))
        : 50;

    return (
        <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Target size={14} className="text-white/40" />
                    <span className="text-xs text-white/60">Analyst Ratings</span>
                </div>
                {fd.numberOfAnalystOpinions && (
                    <span className="text-[10px] text-white/30">{fd.numberOfAnalystOpinions} analysts</span>
                )}
            </div>

            <div className="flex items-center gap-4">
                {/* Recommendation */}
                <div
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: `${recColor}15`, color: recColor }}
                >
                    {rec}
                </div>

                {/* Price Target Bar */}
                {low && high && (
                    <div className="flex-1 flex items-center gap-2">
                        <span className="text-[10px] text-white/40 w-10 text-right">{fmt(low, 0)}</span>
                        <div className="flex-1 h-1.5 rounded-full relative" style={{ background: 'rgba(255,255,255,0.1)' }}>
                            <div
                                className="absolute h-1.5 rounded-full"
                                style={{
                                    left: 0,
                                    width: `${pricePosition}%`,
                                    background: isBuy ? '#22c55e' : isSell ? '#ef4444' : '#3b82f6'
                                }}
                            />
                            <div
                                className="absolute w-2.5 h-2.5 rounded-full border-2 border-white"
                                style={{
                                    left: `${pricePosition}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    background: '#0a0a0a'
                                }}
                            />
                        </div>
                        <span className="text-[10px] text-white/40 w-10">{fmt(high, 0)}</span>
                    </div>
                )}

                {/* Upside */}
                {upside !== null && (
                    <div className="flex items-center gap-1">
                        {upside >= 0 ? (
                            <TrendingUp size={12} className="text-success" />
                        ) : (
                            <TrendingDown size={12} className="text-danger" />
                        )}
                        <span className={`text-sm font-bold ${upside >= 0 ? 'text-success' : 'text-danger'}`}>
                            {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

// Earnings Card
function EarningsCard({ data }) {
    const earnings = data.earningsHistory.slice().reverse();
    if (earnings.length === 0) return null;

    return (
        <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <BarChart2 size={14} className="text-white/40" />
                    <span className="text-xs text-white/60">Quarterly EPS</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-white/40">
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#22c55e' }} /> Beat
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: '#ef4444' }} /> Miss
                    </span>
                </div>
            </div>

            <div style={{ height: '120px' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={earnings} margin={{ top: 5, right: 5, left: -25, bottom: 0 }} barGap={4}>
                        <XAxis
                            dataKey="date"
                            tick={{ fill: '#525252', fontSize: 9 }}
                            tickFormatter={(val) => {
                                const d = new Date(val);
                                return `Q${Math.floor(d.getMonth() / 3) + 1}`;
                            }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis tick={{ fill: '#525252', fontSize: 9 }} axisLine={false} tickLine={false} />
                        <Tooltip
                            contentStyle={{ background: '#171717', border: 'none', borderRadius: '8px', fontSize: '11px' }}
                            labelFormatter={(val) => `Q${Math.floor(new Date(val).getMonth() / 3) + 1} ${new Date(val).getFullYear()}`}
                            formatter={(v, name) => [`$${v?.toFixed(2)}`, name === 'epsActual' ? 'Actual' : 'Est']}
                        />
                        <Bar dataKey="epsEstimate" fill="#3f3f46" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="epsActual" radius={[3, 3, 0, 0]}>
                            {earnings.map((entry, i) => (
                                <Cell key={i} fill={entry.epsActual >= entry.epsEstimate ? '#22c55e' : '#ef4444'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// Events Card
function EventsCard({ data }) {
    const events = [];
    const now = new Date();

    if (data.calendarEvents.earnings?.earningsDate?.[0]) {
        const d = new Date(data.calendarEvents.earnings.earningsDate[0]);
        const days = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        if (days > 0) events.push({ label: 'Earnings', date: d, days });
    }
    if (data.calendarEvents.exDividendDate) {
        const d = new Date(data.calendarEvents.exDividendDate);
        const days = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        if (days > 0) events.push({ label: 'Ex-Div', date: d, days });
    }
    if (data.calendarEvents.dividendDate) {
        const d = new Date(data.calendarEvents.dividendDate);
        const days = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        if (days > 0) events.push({ label: 'Dividend', date: d, days });
    }

    if (events.length === 0) return null;

    return (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {events.map((e, i) => (
                <div
                    key={i}
                    className="flex-shrink-0 p-3 rounded-xl flex items-center gap-3"
                    style={{ background: 'rgba(59, 130, 246, 0.08)' }}
                >
                    <Calendar size={14} className="text-blue-400" />
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-white/40">{e.label}</div>
                        <div className="text-xs font-medium text-white">
                            {e.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                    </div>
                    <div className="text-[10px] text-blue-400 font-medium">
                        {e.days}d
                    </div>
                </div>
            ))}
        </div>
    );
}

// Detailed Metrics
function DetailedMetrics({ data }) {
    const sections = [
        {
            title: 'Valuation',
            icon: PieChart,
            items: [
                ['P/E (TTM)', data.summaryDetail?.trailingPE?.toFixed(1)],
                ['Forward P/E', data.keyStats?.forwardPE?.toFixed(1)],
                ['PEG', data.keyStats?.pegRatio?.toFixed(2)],
                ['P/B', data.keyStats?.priceToBook?.toFixed(1)],
                ['EV/Rev', data.keyStats?.enterpriseToRevenue?.toFixed(1)],
                ['EV/EBITDA', data.keyStats?.enterpriseToEbitda?.toFixed(1)],
            ]
        },
        {
            title: 'Profitability',
            icon: Activity,
            items: [
                ['Gross Margin', pct(data.financialData?.grossMargins)],
                ['Op. Margin', pct(data.financialData?.operatingMargins)],
                ['Net Margin', pct(data.financialData?.profitMargins)],
                ['ROE', pct(data.financialData?.returnOnEquity)],
                ['ROA', pct(data.financialData?.returnOnAssets)],
                ['Rev Growth', pct(data.financialData?.revenueGrowth)],
            ]
        },
        {
            title: 'Balance Sheet',
            icon: DollarSign,
            items: [
                ['Cash', fmt(data.financialData?.totalCash, 1)],
                ['Debt', fmt(data.financialData?.totalDebt, 1)],
                ['D/E', data.financialData?.debtToEquity?.toFixed(0)],
                ['Current', data.financialData?.currentRatio?.toFixed(2)],
                ['FCF', fmt(data.financialData?.freeCashflow, 1)],
            ]
        }
    ];

    return (
        <div className="flex flex-col gap-3">
            {sections.map((section, i) => {
                const validItems = section.items.filter(([, v]) => v !== null && v !== undefined);
                if (validItems.length === 0) return null;

                const Icon = section.icon;
                return (
                    <div key={i} className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="flex items-center gap-2 mb-3">
                            <Icon size={14} className="text-white/40" />
                            <span className="text-xs text-white/60">{section.title}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                            {validItems.map(([label, value], j) => (
                                <div key={j} className="flex flex-col">
                                    <span className="text-[10px] text-white/30">{label}</span>
                                    <span className={`text-sm font-medium ${typeof value === 'string' && value.includes('%')
                                            ? (parseFloat(value) > 0 ? 'text-success' : parseFloat(value) < 0 ? 'text-danger' : 'text-white')
                                            : 'text-white'
                                        }`}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// Revenue Card
function RevenueCard({ data }) {
    const chartData = data.incomeStatement
        .filter(i => i.totalRevenue)
        .slice()
        .reverse()
        .map(item => ({
            year: new Date(item.date).getFullYear().toString().slice(2),
            revenue: item.totalRevenue,
            income: item.netIncome,
        }));

    if (chartData.length < 2) return null;

    return (
        <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-white/40" />
                    <span className="text-xs text-white/60">Revenue & Income</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-white/40">
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-0.5 rounded" style={{ background: '#3b82f6' }} /> Rev
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-0.5 rounded" style={{ background: '#22c55e' }} /> Net
                    </span>
                </div>
            </div>

            <div style={{ height: '100px' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="year" tick={{ fill: '#525252', fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#525252', fontSize: 9 }} tickFormatter={(v) => fmt(v, 0)} axisLine={false} tickLine={false} />
                        <Tooltip
                            contentStyle={{ background: '#171717', border: 'none', borderRadius: '8px', fontSize: '11px' }}
                            formatter={(v) => [fmt(v, 1)]}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#revGrad)" strokeWidth={1.5} name="Revenue" />
                        <Area type="monotone" dataKey="income" stroke="#22c55e" fill="url(#incGrad)" strokeWidth={1.5} name="Net Income" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col gap-4 animate-pulse">
            <div className="flex gap-2">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex-1 h-14 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }} />
                ))}
            </div>
            <div className="h-24 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }} />
            <div className="h-36 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }} />
        </div>
    );
}

function ErrorState({ message }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity size={32} className="text-white/20 mb-3" />
            <p className="text-white/50 text-sm">{message}</p>
            <p className="text-white/20 text-xs mt-1">Available for stocks and ETFs only</p>
        </div>
    );
}
