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
        <div className="flex flex-col gap-6">
            {/* Summary Row */}
            <SummaryCards data={data} />

            {/* Analyst Section */}
            {data.financialData?.numberOfAnalystOpinions > 0 && (
                <AnalystSection data={data} />
            )}

            {/* Earnings History */}
            {data.earningsHistory?.length > 0 && (
                <EarningsSection data={data} />
            )}

            {/* Calendar Events */}
            {data.calendarEvents && (
                <CalendarSection data={data} />
            )}

            {/* Key Metrics Grid */}
            <MetricsSection data={data} />

            {/* Revenue Chart */}
            {data.incomeStatement?.length > 1 && (
                <RevenueSection data={data} />
            )}
        </div>
    );
}

// Format helpers
const formatNumber = (num, decimals = 2) => {
    if (num === null || num === undefined) return '—';
    if (Math.abs(num) >= 1e12) return `${(num / 1e12).toFixed(decimals)}T`;
    if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
    if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
    if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
    return num.toFixed ? num.toFixed(decimals) : num;
};

const formatPercent = (num) => {
    if (num === null || num === undefined) return '—';
    const pct = (num * 100).toFixed(1);
    return `${pct}%`;
};

// Summary Cards - Key metrics at a glance
function SummaryCards({ data }) {
    const metrics = [
        { label: 'Market Cap', value: formatNumber(data.summaryDetail?.marketCap), size: 'large' },
        { label: 'P/E', value: data.summaryDetail?.trailingPE?.toFixed(1) || '—' },
        { label: 'EPS', value: data.financialData?.earningsPerShare?.toFixed(2) || '—' },
        { label: 'Div Yield', value: formatPercent(data.summaryDetail?.dividendYield) },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {metrics.map((m, i) => (
                <div
                    key={i}
                    className="p-4 rounded-2xl flex flex-col justify-center"
                    style={{ background: '#1a1a1a' }}
                >
                    <span className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{m.label}</span>
                    <span className={`font-bold ${m.size === 'large' ? 'text-xl' : 'text-lg'} text-white`}>
                        {m.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

// Analyst Section
function AnalystSection({ data }) {
    const fd = data.financialData;
    const recommendation = fd.recommendationKey?.toUpperCase().replace('_', ' ') || 'N/A';
    const recColor = recommendation.includes('BUY') ? '#22c55e' :
        recommendation.includes('SELL') ? '#ef4444' : '#a1a1aa';

    const currentPrice = fd.currentPrice || 0;
    const targetMean = fd.targetMeanPrice || 0;
    const upside = currentPrice > 0 ? ((targetMean - currentPrice) / currentPrice * 100).toFixed(1) : 0;

    return (
        <div className="p-5 rounded-2xl" style={{ background: '#1a1a1a' }}>
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-white/60">Analyst Consensus</span>
                <span className="text-[10px] text-white/40">{fd.numberOfAnalystOpinions} analysts</span>
            </div>

            <div className="flex items-center gap-6">
                {/* Recommendation Badge */}
                <div
                    className="px-4 py-2 rounded-full font-bold text-sm"
                    style={{ background: `${recColor}20`, color: recColor }}
                >
                    {recommendation}
                </div>

                {/* Price Targets */}
                <div className="flex-1 flex items-center gap-4">
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] text-white/40">Low</span>
                        <span className="text-sm font-medium text-white/70">${formatNumber(fd.targetLowPrice, 0)}</span>
                    </div>

                    {/* Price Bar */}
                    <div className="flex-1 relative h-2 rounded-full" style={{ background: '#333' }}>
                        {fd.targetLowPrice && fd.targetHighPrice && (
                            <>
                                <div
                                    className="absolute top-0 bottom-0 rounded-full"
                                    style={{
                                        left: '0%',
                                        width: `${Math.min(100, (targetMean - fd.targetLowPrice) / (fd.targetHighPrice - fd.targetLowPrice) * 100)}%`,
                                        background: 'linear-gradient(90deg, #22c55e 0%, #3b82f6 100%)'
                                    }}
                                />
                                {/* Current Price Marker */}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white"
                                    style={{
                                        left: `${Math.min(100, Math.max(0, (currentPrice - fd.targetLowPrice) / (fd.targetHighPrice - fd.targetLowPrice) * 100))}%`,
                                        background: '#171717',
                                        marginLeft: '-6px'
                                    }}
                                />
                            </>
                        )}
                    </div>

                    <div className="flex flex-col items-center">
                        <span className="text-[10px] text-white/40">High</span>
                        <span className="text-sm font-medium text-white/70">${formatNumber(fd.targetHighPrice, 0)}</span>
                    </div>
                </div>

                {/* Upside */}
                <div className="flex flex-col items-end">
                    <span className="text-[10px] text-white/40">Upside</span>
                    <span className={`text-lg font-bold ${parseFloat(upside) >= 0 ? 'text-success' : 'text-danger'}`}>
                        {upside > 0 ? '+' : ''}{upside}%
                    </span>
                </div>
            </div>
        </div>
    );
}

// Earnings Section
function EarningsSection({ data }) {
    const earnings = data.earningsHistory.slice().reverse();

    return (
        <div className="p-5 rounded-2xl" style={{ background: '#1a1a1a' }}>
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-white/60">Earnings History</span>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: '#525252' }} />
                        <span className="text-[10px] text-white/40">Est</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />
                        <span className="text-[10px] text-white/40">Beat</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} />
                        <span className="text-[10px] text-white/40">Miss</span>
                    </div>
                </div>
            </div>

            <div style={{ height: '160px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={earnings} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2}>
                        <XAxis
                            dataKey="date"
                            tick={{ fill: '#71717a', fontSize: 10 }}
                            tickFormatter={(val) => {
                                const d = new Date(val);
                                return `Q${Math.floor(d.getMonth() / 3) + 1}'${d.getFullYear().toString().slice(2)}`;
                            }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip
                            contentStyle={{ background: '#171717', border: '1px solid #333', borderRadius: '12px', padding: '8px 12px' }}
                            labelFormatter={(val) => {
                                const d = new Date(val);
                                return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
                            }}
                            formatter={(value, name) => {
                                const label = name === 'epsActual' ? 'Actual' : 'Estimate';
                                return [`$${value?.toFixed(2)}`, label];
                            }}
                        />
                        <Bar dataKey="epsEstimate" fill="#525252" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="epsActual" radius={[4, 4, 0, 0]}>
                            {earnings.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.epsActual >= entry.epsEstimate ? '#22c55e' : '#ef4444'}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// Calendar Section
function CalendarSection({ data }) {
    const events = [];

    if (data.calendarEvents.earnings?.earningsDate?.[0]) {
        events.push({
            label: 'Next Earnings',
            date: new Date(data.calendarEvents.earnings.earningsDate[0]),
            icon: '📊'
        });
    }
    if (data.calendarEvents.exDividendDate) {
        events.push({
            label: 'Ex-Dividend',
            date: new Date(data.calendarEvents.exDividendDate),
            icon: '💰'
        });
    }
    if (data.calendarEvents.dividendDate) {
        events.push({
            label: 'Dividend Payment',
            date: new Date(data.calendarEvents.dividendDate),
            icon: '💵'
        });
    }

    if (events.length === 0) return null;

    const now = new Date();

    return (
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {events.map((event, i) => {
                const daysUntil = Math.ceil((event.date - now) / (1000 * 60 * 60 * 24));
                const isUpcoming = daysUntil > 0 && daysUntil <= 30;

                return (
                    <div
                        key={i}
                        className="flex-shrink-0 p-4 rounded-2xl flex items-center gap-3 min-w-[180px]"
                        style={{ background: isUpcoming ? 'rgba(59, 130, 246, 0.1)' : '#1a1a1a' }}
                    >
                        <span className="text-2xl">{event.icon}</span>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-widest text-white/40">{event.label}</span>
                            <span className="text-sm font-medium text-white">
                                {event.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                            {isUpcoming && (
                                <span className="text-[10px] text-blue-400 mt-0.5">
                                    {daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// Metrics Section
function MetricsSection({ data }) {
    const sections = [
        {
            title: 'Valuation',
            metrics: [
                { label: 'P/E (TTM)', value: data.summaryDetail?.trailingPE?.toFixed(2) },
                { label: 'Forward P/E', value: data.keyStats?.forwardPE?.toFixed(2) },
                { label: 'PEG Ratio', value: data.keyStats?.pegRatio?.toFixed(2) },
                { label: 'P/B', value: data.keyStats?.priceToBook?.toFixed(2) },
                { label: 'EV/Revenue', value: data.keyStats?.enterpriseToRevenue?.toFixed(2) },
                { label: 'EV/EBITDA', value: data.keyStats?.enterpriseToEbitda?.toFixed(2) },
            ]
        },
        {
            title: 'Profitability',
            metrics: [
                { label: 'Gross Margin', value: formatPercent(data.financialData?.grossMargins), isPercent: true },
                { label: 'Operating Margin', value: formatPercent(data.financialData?.operatingMargins), isPercent: true },
                { label: 'Profit Margin', value: formatPercent(data.financialData?.profitMargins), isPercent: true },
                { label: 'ROE', value: formatPercent(data.financialData?.returnOnEquity), isPercent: true },
                { label: 'ROA', value: formatPercent(data.financialData?.returnOnAssets), isPercent: true },
                { label: 'Revenue Growth', value: formatPercent(data.financialData?.revenueGrowth), isPercent: true },
            ]
        },
        {
            title: 'Financial Health',
            metrics: [
                { label: 'Total Cash', value: formatNumber(data.financialData?.totalCash) },
                { label: 'Total Debt', value: formatNumber(data.financialData?.totalDebt) },
                { label: 'Debt/Equity', value: data.financialData?.debtToEquity?.toFixed(0) },
                { label: 'Current Ratio', value: data.financialData?.currentRatio?.toFixed(2) },
                { label: 'Free Cash Flow', value: formatNumber(data.financialData?.freeCashflow) },
                { label: 'Beta', value: data.keyStats?.beta?.toFixed(2) },
            ]
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            {sections.map((section, i) => (
                <div key={i} className="p-4 rounded-2xl" style={{ background: '#1a1a1a' }}>
                    <span className="text-xs uppercase tracking-widest text-white/40 mb-3 block">{section.title}</span>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                        {section.metrics.map((m, j) => (
                            <div key={j} className="flex flex-col">
                                <span className="text-[10px] text-white/40">{m.label}</span>
                                <span className={`text-sm font-medium ${m.isPercent && m.value && !m.value.includes('—')
                                        ? (parseFloat(m.value) > 0 ? 'text-success' : parseFloat(m.value) < 0 ? 'text-danger' : 'text-white')
                                        : 'text-white'
                                    }`}>
                                    {m.value || '—'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// Revenue Section
function RevenueSection({ data }) {
    const chartData = data.incomeStatement.slice().reverse().map(item => ({
        year: new Date(item.date).getFullYear(),
        revenue: item.totalRevenue,
        netIncome: item.netIncome,
    }));

    return (
        <div className="p-5 rounded-2xl" style={{ background: '#1a1a1a' }}>
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-white/60">Revenue & Net Income</span>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 rounded" style={{ background: '#3b82f6' }} />
                        <span className="text-[10px] text-white/40">Revenue</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 rounded" style={{ background: '#22c55e' }} />
                        <span className="text-[10px] text-white/40">Net Income</span>
                    </div>
                </div>
            </div>

            <div style={{ height: '160px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis
                            dataKey="year"
                            tick={{ fill: '#71717a', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: '#71717a', fontSize: 10 }}
                            tickFormatter={(val) => formatNumber(val, 0)}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            contentStyle={{ background: '#171717', border: '1px solid #333', borderRadius: '12px', padding: '8px 12px' }}
                            formatter={(value) => [formatNumber(value)]}
                        />
                        <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#3b82f6"
                            fill="url(#revenueGrad)"
                            strokeWidth={2}
                            name="Revenue"
                        />
                        <Area
                            type="monotone"
                            dataKey="netIncome"
                            stroke="#22c55e"
                            fill="url(#incomeGrad)"
                            strokeWidth={2}
                            name="Net Income"
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
            <div className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-20 rounded-2xl" style={{ background: '#1a1a1a' }} />
                ))}
            </div>
            <div className="h-32 rounded-2xl" style={{ background: '#1a1a1a' }} />
            <div className="h-48 rounded-2xl" style={{ background: '#1a1a1a' }} />
        </div>
    );
}

function ErrorState({ message }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-4">📊</div>
            <p className="text-white/60 text-sm">{message}</p>
            <p className="text-white/30 text-xs mt-2">Financial data is only available for stocks and ETFs</p>
        </div>
    );
}
