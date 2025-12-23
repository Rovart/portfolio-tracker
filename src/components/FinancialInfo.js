'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';
import { Calendar, TrendingUp, PieChart, DollarSign, Target, Users } from 'lucide-react';

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
    if (error) return <div className="text-center text-muted py-10">{error}</div>;
    if (!data) return <div className="text-center text-muted py-10">No financial data available</div>;

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
        return `${(num * 100).toFixed(2)}%`;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Calendar Events */}
            {data.calendarEvents && (
                <Section title="Upcoming Events" icon={Calendar}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {data.calendarEvents.earnings?.earningsDate && (
                            <EventCard
                                label="Next Earnings"
                                date={Array.isArray(data.calendarEvents.earnings.earningsDate)
                                    ? data.calendarEvents.earnings.earningsDate[0]
                                    : data.calendarEvents.earnings.earningsDate}
                            />
                        )}
                        {data.calendarEvents.exDividendDate && (
                            <EventCard label="Ex-Dividend" date={data.calendarEvents.exDividendDate} />
                        )}
                        {data.calendarEvents.dividendDate && (
                            <EventCard label="Dividend Payment" date={data.calendarEvents.dividendDate} />
                        )}
                    </div>
                </Section>
            )}

            {/* Key Statistics */}
            {(data.keyStats || data.summaryDetail || data.financialData) && (
                <Section title="Key Statistics" icon={PieChart}>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <StatCard label="Market Cap" value={formatNumber(data.summaryDetail?.marketCap)} />
                        <StatCard label="P/E Ratio" value={data.summaryDetail?.trailingPE?.toFixed(2)} />
                        <StatCard label="Forward P/E" value={data.keyStats?.forwardPE?.toFixed(2)} />
                        <StatCard label="PEG Ratio" value={data.keyStats?.pegRatio?.toFixed(2)} />
                        <StatCard label="Price/Book" value={data.keyStats?.priceToBook?.toFixed(2)} />
                        <StatCard label="Beta" value={data.keyStats?.beta?.toFixed(2)} />
                        <StatCard label="52W High" value={formatNumber(data.summaryDetail?.fiftyTwoWeekHigh)} />
                        <StatCard label="52W Low" value={formatNumber(data.summaryDetail?.fiftyTwoWeekLow)} />
                        <StatCard label="52W Change" value={formatPercent(data.keyStats?.fiftyTwoWeekChange)} isPercent />
                        <StatCard label="Dividend Yield" value={formatPercent(data.summaryDetail?.dividendYield)} isPercent />
                        <StatCard label="Avg Volume" value={formatNumber(data.summaryDetail?.averageVolume, 0)} />
                        <StatCard label="Shares Outstanding" value={formatNumber(data.keyStats?.sharesOutstanding, 0)} />
                    </div>
                </Section>
            )}

            {/* Analyst Ratings */}
            {data.financialData && data.financialData.numberOfAnalystOpinions > 0 && (
                <Section title="Analyst Ratings" icon={Target}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard
                            label="Recommendation"
                            value={data.financialData.recommendationKey?.replace('_', ' ').toUpperCase()}
                            highlight
                        />
                        <StatCard label="Target High" value={formatNumber(data.financialData.targetHighPrice)} />
                        <StatCard label="Target Mean" value={formatNumber(data.financialData.targetMeanPrice)} />
                        <StatCard label="Target Low" value={formatNumber(data.financialData.targetLowPrice)} />
                    </div>
                    <p className="text-[10px] text-muted mt-2">Based on {data.financialData.numberOfAnalystOpinions} analyst opinions</p>
                </Section>
            )}

            {/* Profitability */}
            {data.financialData && (
                <Section title="Profitability" icon={TrendingUp}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Gross Margin" value={formatPercent(data.financialData.grossMargins)} isPercent />
                        <StatCard label="Operating Margin" value={formatPercent(data.financialData.operatingMargins)} isPercent />
                        <StatCard label="Profit Margin" value={formatPercent(data.financialData.profitMargins)} isPercent />
                        <StatCard label="EBITDA Margin" value={formatPercent(data.financialData.ebitdaMargins)} isPercent />
                        <StatCard label="ROE" value={formatPercent(data.financialData.returnOnEquity)} isPercent />
                        <StatCard label="ROA" value={formatPercent(data.financialData.returnOnAssets)} isPercent />
                        <StatCard label="Revenue Growth" value={formatPercent(data.financialData.revenueGrowth)} isPercent />
                        <StatCard label="Free Cash Flow" value={formatNumber(data.financialData.freeCashflow)} />
                    </div>
                </Section>
            )}

            {/* Balance Sheet */}
            {data.financialData && (
                <Section title="Balance Sheet" icon={DollarSign}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Total Cash" value={formatNumber(data.financialData.totalCash)} />
                        <StatCard label="Total Debt" value={formatNumber(data.financialData.totalDebt)} />
                        <StatCard label="Debt/Equity" value={data.financialData.debtToEquity?.toFixed(2)} />
                        <StatCard label="Current Ratio" value={data.financialData.currentRatio?.toFixed(2)} />
                    </div>
                </Section>
            )}

            {/* Earnings History Chart */}
            {data.earningsHistory && data.earningsHistory.length > 0 && (
                <Section title="Earnings History" icon={TrendingUp}>
                    <div style={{ height: '200px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.earningsHistory.slice().reverse()} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <XAxis
                                    dataKey="date"
                                    tick={{ fill: '#71717a', fontSize: 10 }}
                                    tickFormatter={(val) => {
                                        const d = new Date(val);
                                        return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear().toString().slice(2)}`;
                                    }}
                                />
                                <YAxis tick={{ fill: '#71717a', fontSize: 10 }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px' }}
                                    labelFormatter={(val) => formatDate(val)}
                                    formatter={(value, name) => [value?.toFixed(2), name === 'epsActual' ? 'Actual EPS' : 'Estimate EPS']}
                                />
                                <Bar dataKey="epsEstimate" fill="#525252" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="epsActual" radius={[4, 4, 0, 0]}>
                                    {data.earningsHistory.slice().reverse().map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.epsActual >= entry.epsEstimate ? '#22c55e' : '#ef4444'}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded" style={{ background: '#525252' }} />
                            <span className="text-[10px] text-muted">Estimate</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded" style={{ background: '#22c55e' }} />
                            <span className="text-[10px] text-muted">Beat</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded" style={{ background: '#ef4444' }} />
                            <span className="text-[10px] text-muted">Miss</span>
                        </div>
                    </div>
                </Section>
            )}

            {/* Revenue & Income Trend */}
            {data.incomeStatement && data.incomeStatement.length > 1 && (
                <Section title="Revenue & Income" icon={TrendingUp}>
                    <div style={{ height: '200px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data.incomeStatement.slice().reverse()} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <XAxis
                                    dataKey="date"
                                    tick={{ fill: '#71717a', fontSize: 10 }}
                                    tickFormatter={(val) => new Date(val).getFullYear()}
                                />
                                <YAxis tick={{ fill: '#71717a', fontSize: 10 }} tickFormatter={(val) => formatNumber(val, 0)} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '8px' }}
                                    labelFormatter={(val) => new Date(val).getFullYear()}
                                    formatter={(value) => [formatNumber(value)]}
                                />
                                <Line type="monotone" dataKey="totalRevenue" stroke="#3b82f6" strokeWidth={2} dot={false} name="Revenue" />
                                <Line type="monotone" dataKey="netIncome" stroke="#22c55e" strokeWidth={2} dot={false} name="Net Income" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-0.5 rounded" style={{ background: '#3b82f6' }} />
                            <span className="text-[10px] text-muted">Revenue</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-0.5 rounded" style={{ background: '#22c55e' }} />
                            <span className="text-[10px] text-muted">Net Income</span>
                        </div>
                    </div>
                </Section>
            )}

            {/* Institutional Ownership */}
            {data.keyStats && (data.keyStats.heldPercentInsiders || data.keyStats.heldPercentInstitutions) && (
                <Section title="Ownership" icon={Users}>
                    <div className="grid grid-cols-2 gap-3">
                        <StatCard label="Insiders" value={formatPercent(data.keyStats.heldPercentInsiders)} isPercent />
                        <StatCard label="Institutions" value={formatPercent(data.keyStats.heldPercentInstitutions)} isPercent />
                    </div>
                </Section>
            )}
        </div>
    );
}

function Section({ title, icon: Icon, children }) {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                {Icon && <Icon size={16} className="text-muted" />}
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white/80">{title}</h3>
            </div>
            {children}
        </div>
    );
}

function StatCard({ label, value, isPercent = false, highlight = false }) {
    const isPositive = isPercent && value && !value.includes('—') && parseFloat(value) > 0;
    const isNegative = isPercent && value && !value.includes('—') && parseFloat(value) < 0;

    return (
        <div
            className="flex flex-col p-3 rounded-xl"
            style={{ background: highlight ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.03)' }}
        >
            <span className="text-[10px] text-muted uppercase tracking-wider">{label}</span>
            <span className={`text-sm font-medium ${isPositive ? 'text-success' : isNegative ? 'text-danger' : 'text-white'}`}>
                {value || '—'}
            </span>
        </div>
    );
}

function EventCard({ label, date }) {
    const eventDate = new Date(date);
    const isUpcoming = eventDate > new Date();
    const daysUntil = Math.ceil((eventDate - new Date()) / (1000 * 60 * 60 * 24));

    return (
        <div
            className="flex items-center justify-between p-3 rounded-xl"
            style={{ background: isUpcoming ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.03)' }}
        >
            <div className="flex flex-col">
                <span className="text-[10px] text-muted uppercase tracking-wider">{label}</span>
                <span className="text-sm font-medium text-white">
                    {eventDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
            </div>
            {isUpcoming && daysUntil <= 30 && (
                <div className="px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-medium">
                    {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                </div>
            )}
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col gap-6 animate-pulse">
            {[1, 2, 3].map(i => (
                <div key={i} className="flex flex-col gap-3">
                    <div className="h-4 w-32 bg-white/10 rounded" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map(j => (
                            <div key={j} className="h-16 bg-white/5 rounded-xl" />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
