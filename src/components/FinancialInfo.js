'use client';

import { apiFetch } from '@/utils/api-client';

import { useState, useEffect } from 'react';
import { KeyValueList } from './ui';
import { changeTone, formatCompactMoney, formatMoney, formatPercent, formatQuantity } from '@/utils/format';

const ratio = (value, decimals = 1) => (Number.isFinite(value) && value > 0 ? formatQuantity(value, { maxDecimals: decimals }) : null);
const share = (fraction, options) => (Number.isFinite(fraction) && fraction !== 0 ? formatPercent(fraction * 100, { signed: false, decimals: 1, ...options }) : null);

function quarterLabel(date) {
    const time = Date.parse(date);
    if (!Number.isFinite(time)) return '—';
    const d = new Date(time);
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

// Company fundamentals for the Financials tab: annual results, valuation,
// margins, quarterly EPS against estimates and the balance sheet.
// currency: the currency the stock trades in (market cap, 52-week range).
export default function FinancialInfo({ symbol, currency }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function fetchData() {
            if (!symbol) return;
            setLoading(true);
            setError(null);
            try {
                const res = await apiFetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`);
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

    // Only stocks have fundamentals (ETFs and funds do not).
    const quoteType = data.quoteType?.quoteType;
    if (quoteType && quoteType !== 'EQUITY') return null;
    if (!data.summaryDetail?.marketCap && !(data.earningsHistory?.length > 0)) return null;

    const reportCurrency = data.financialData?.financialCurrency || currency || 'USD';
    const priceCurrency = currency || reportCurrency;

    return (
        <div className="flex flex-col" style={{ gap: 'var(--space-6)', paddingBottom: 'var(--space-4)' }}>
            <AnnualResults statements={data.incomeStatement || []} currency={reportCurrency} />
            <Valuation data={data} currency={priceCurrency} />
            <Margins data={data} />
            <QuarterlyEps history={data.earningsHistory || []} currency={reportCurrency} />
            <BalanceSheet data={data} currency={reportCurrency} />
        </div>
    );
}

// Revenue and net income for the last four fiscal years, grey and white bars.
function AnnualResults({ statements, currency }) {
    const years = statements
        .filter(item => Number.isFinite(item.totalRevenue) && item.totalRevenue > 0)
        .slice()
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
        .slice(-4);
    if (years.length < 2) return null;

    const max = Math.max(...years.map(item => item.totalRevenue));
    const yearOf = item => new Date(item.date).getUTCFullYear();
    const latest = years[years.length - 1];
    const previous = years[years.length - 2];
    const growth = (latest.totalRevenue / previous.totalRevenue - 1) * 100;
    const margin = Number.isFinite(latest.netIncome) ? (latest.netIncome / latest.totalRevenue) * 100 : null;

    return (
        <section aria-label="Annual results">
            <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
                <h3 className="section-title">Annual results</h3>
                <span className="fin-legend" aria-hidden="true">
                    <span><i className="fin-swatch is-revenue" />Revenue</span>
                    <span><i className="fin-swatch is-income" />Net income</span>
                </span>
            </div>
            <div
                className="fin-chart"
                role="img"
                aria-label={years.map(item => `${yearOf(item)}: revenue ${formatCompactMoney(item.totalRevenue, currency)}, net income ${formatCompactMoney(item.netIncome, currency)}`).join('; ')}
            >
                {years.map(item => (
                    <div key={item.date} className="fin-bar-group">
                        <div className="fin-bar-pair">
                            <span className="fin-bar is-revenue" style={{ height: `${(item.totalRevenue / max) * 100}%` }} />
                            <span className="fin-bar is-income" style={{ height: `${(Math.max(0, item.netIncome || 0) / max) * 100}%` }} />
                        </div>
                        <span className="fin-bar-label">{yearOf(item)}</span>
                    </div>
                ))}
            </div>
            <KeyValueList
                twoColumn
                rows={[
                    {
                        label: `Revenue ${yearOf(latest)}`,
                        value: formatCompactMoney(latest.totalRevenue, currency),
                        sub: `${formatPercent(growth, { decimals: 1 })} vs ${yearOf(previous)}`,
                        subTone: changeTone(growth)
                    },
                    Number.isFinite(latest.netIncome) && {
                        label: `Net income ${yearOf(latest)}`,
                        value: formatCompactMoney(latest.netIncome, currency),
                        sub: margin !== null ? `${formatPercent(margin, { signed: false, decimals: 1 })} margin` : null
                    }
                ]}
            />
        </section>
    );
}

function Valuation({ data, currency }) {
    const sd = data.summaryDetail || {};
    const ks = data.keyStats || {};
    const rows = [
        Number.isFinite(sd.marketCap) && sd.marketCap > 0 && { label: 'Market cap', value: formatCompactMoney(sd.marketCap, currency) },
        ratio(sd.trailingPE) && { label: 'P/E', value: ratio(sd.trailingPE) },
        ratio(ks.forwardPE) && { label: 'Forward P/E', value: ratio(ks.forwardPE) },
        ratio(ks.pegRatio, 2) && { label: 'PEG', value: ratio(ks.pegRatio, 2) },
        share(sd.dividendYield, { decimals: 2 }) && { label: 'Dividend yield', value: share(sd.dividendYield, { decimals: 2 }) },
        Number.isFinite(ks.beta) && ks.beta !== 0 && { label: 'Beta', value: formatQuantity(ks.beta, { maxDecimals: 2 }) },
        Number.isFinite(sd.fiftyTwoWeekLow) && Number.isFinite(sd.fiftyTwoWeekHigh) && {
            label: '52-week range',
            value: `${formatMoney(sd.fiftyTwoWeekLow, currency)} – ${formatMoney(sd.fiftyTwoWeekHigh, currency)}`
        }
    ].filter(Boolean);
    if (rows.length === 0) return null;

    return (
        <section aria-label="Valuation">
            <h3 className="section-title">Valuation</h3>
            <KeyValueList twoColumn rows={rows} />
        </section>
    );
}

function Margins({ data }) {
    const fd = data.financialData || {};
    const rows = [
        share(fd.grossMargins) && { label: 'Gross margin', value: share(fd.grossMargins) },
        share(fd.operatingMargins) && { label: 'Operating margin', value: share(fd.operatingMargins) },
        share(fd.profitMargins) && { label: 'Net margin', value: share(fd.profitMargins) },
        share(fd.returnOnEquity) && { label: 'Return on equity', value: share(fd.returnOnEquity) },
        Number.isFinite(fd.revenueGrowth) && fd.revenueGrowth !== 0 && {
            label: 'Revenue growth',
            value: formatPercent(fd.revenueGrowth * 100, { decimals: 1 }),
            tone: changeTone(fd.revenueGrowth),
            sub: 'last quarter, year on year'
        }
    ].filter(Boolean);
    if (rows.length === 0) return null;

    return (
        <section aria-label="Margins">
            <h3 className="section-title">Margins</h3>
            <KeyValueList twoColumn rows={rows} />
        </section>
    );
}

// Newest quarter first; the surprise is coloured like any other gain or loss.
function QuarterlyEps({ history, currency }) {
    const quarters = history
        .filter(item => Number.isFinite(item.epsActual) && Number.isFinite(item.epsEstimate))
        .slice()
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (quarters.length === 0) return null;

    return (
        <section aria-label="Quarterly earnings per share">
            <h3 className="section-title">Earnings per share</h3>
            <KeyValueList
                twoColumn
                rows={quarters.map(item => {
                    const surprise = item.epsEstimate !== 0 ? ((item.epsActual - item.epsEstimate) / Math.abs(item.epsEstimate)) * 100 : null;
                    return {
                        label: quarterLabel(item.date),
                        value: formatMoney(item.epsActual, currency),
                        sub: surprise !== null
                            ? `${formatPercent(surprise, { decimals: 1 })} vs ${formatMoney(item.epsEstimate, currency)}`
                            : `${formatMoney(item.epsEstimate, currency)} expected`,
                        subTone: surprise !== null ? changeTone(surprise) : undefined
                    };
                })}
            />
        </section>
    );
}

function BalanceSheet({ data, currency }) {
    const fd = data.financialData || {};
    const money = value => (Number.isFinite(value) && value !== 0 ? formatCompactMoney(value, currency) : null);
    const rows = [
        money(fd.totalCash) && { label: 'Cash', value: money(fd.totalCash) },
        money(fd.totalDebt) && { label: 'Debt', value: money(fd.totalDebt) },
        Number.isFinite(fd.debtToEquity) && fd.debtToEquity > 0 && {
            label: 'Debt to equity',
            value: formatPercent(fd.debtToEquity, { signed: false, decimals: 0 })
        },
        ratio(fd.currentRatio, 2) && { label: 'Current ratio', value: ratio(fd.currentRatio, 2) },
        money(fd.freeCashflow) && { label: 'Free cash flow', value: money(fd.freeCashflow) }
    ].filter(Boolean);
    if (rows.length === 0) return null;

    return (
        <section aria-label="Balance sheet">
            <h3 className="section-title">Balance sheet</h3>
            <KeyValueList twoColumn rows={rows} />
        </section>
    );
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col" aria-busy="true" style={{ gap: 'var(--space-6)' }}>
            {[4, 5].map((count, section) => (
                <div key={section}>
                    <div className="skeleton" style={{ width: 120, height: 18, marginBottom: 12 }} />
                    {Array.from({ length: count }, (_, i) => (
                        <div key={i} className="flex justify-between" style={{ padding: '14px 0' }}>
                            <div className="skeleton" style={{ width: '32%', height: 14 }} />
                            <div className="skeleton" style={{ width: '20%', height: 14 }} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
