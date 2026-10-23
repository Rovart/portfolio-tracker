'use client';

import { apiFetch } from '@/utils/api-client';

import { useState, useEffect, memo } from 'react';
import { formatDate, formatMoney, formatPercent } from '@/utils/format';
import { getLatestEarningsResult } from '@/utils/market-data';

function quarterLabel(date) {
    const d = new Date(date);
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(2)}`;
}

// Next earnings report plus how the last four quarters landed: a ring for the
// estimate and a dot for the actual EPS (green beat, red miss), with the
// upcoming quarter as a dashed ring at its consensus.
const EarningsEvent = memo(function EarningsEvent({ symbol }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!symbol) return;

        async function fetchEarnings() {
            setLoading(true);
            try {
                const res = await apiFetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`);
                if (!res.ok) throw new Error('Failed to fetch');
                const json = await res.json();
                setData(json.data);
            } catch (e) {
                console.error('Failed to fetch earnings:', e);
            } finally {
                setLoading(false);
            }
        }
        fetchEarnings();
    }, [symbol]);

    if (loading) {
        return (
            <div className="earnings" aria-busy="true" aria-label="Earnings">
                <div className="flex justify-between">
                    <div className="skeleton" style={{ width: 120, height: 32 }} />
                    <div className="skeleton" style={{ width: 70, height: 32 }} />
                </div>
                <div className="skeleton" style={{ height: 112, marginTop: 'var(--space-4)' }} />
            </div>
        );
    }

    const earnings = data?.calendarEvents?.earnings;
    const currency = data?.financialData?.financialCurrency || 'USD';
    const money = value => formatMoney(value, currency);

    const dates = (earnings?.earningsDate || []).map(date => Date.parse(date)).filter(Number.isFinite);
    const daysUntil = dates.length ? Math.ceil((dates[0] - Date.now()) / 86400000) : null;
    const upcoming = daysUntil !== null && daysUntil >= 0;
    const estimate = upcoming && Number.isFinite(earnings.earningsAverage) ? earnings.earningsAverage : null;

    const quarters = (data?.earningsHistory || [])
        .filter(item => Number.isFinite(item?.epsActual) && Number.isFinite(item?.epsEstimate))
        .slice()
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
        .slice(-4);
    const latest = getLatestEarningsResult(quarters);
    if (!upcoming && !latest) return null;

    const countdown = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
    // Yahoo gives a window while the date is unconfirmed.
    const when = upcoming && dates.length > 1
        ? `${formatDate(dates[0], { withYear: false })} – ${formatDate(dates[1], { withYear: false })}`
        : upcoming ? formatDate(dates[0], { withYear: false }) : null;

    const columns = [
        ...quarters.map(item => ({
            key: item.date,
            label: quarterLabel(item.date),
            value: money(item.epsActual),
            estimate: item.epsEstimate,
            actual: item.epsActual,
            tone: item.epsActual >= item.epsEstimate ? 'is-beat' : 'is-miss'
        })),
        ...(estimate !== null ? [{ key: 'next', label: formatDate(dates[0], { withYear: false }), value: money(estimate), estimate, actual: null, isNext: true }] : [])
    ];

    const values = columns.flatMap(column => [column.estimate, column.actual]).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.abs(max) || 1;
    // Keep dots off the top and bottom edges of the plot.
    const y = value => 10 + ((value - min) / span) * 80;

    const beats = quarters.filter(item => item.epsActual >= item.epsEstimate).length;

    return (
        <section className="earnings" aria-label="Earnings">
            <div className="earnings-head">
                <div className="flex flex-col min-w-0" style={{ gap: '2px' }}>
                    <span className="label">{upcoming ? 'Next earnings' : 'Earnings'}</span>
                    <span className="earnings-figure truncate">
                        {upcoming
                            ? <>{when}<span className="earnings-countdown"> · {countdown}</span></>
                            : `Last reported ${quarterLabel(latest.date)}`}
                    </span>
                </div>
                {estimate !== null && (
                    <div className="flex flex-col items-end shrink-0" style={{ gap: '2px' }}>
                        <span className="label">EPS estimate</span>
                        <span className="earnings-figure">{money(estimate)}</span>
                    </div>
                )}
            </div>

            {columns.length > 1 && (
                <div
                    className="earnings-plot"
                    role="img"
                    aria-label={columns.map(column => column.isNext
                        ? `Next report: ${column.value} expected`
                        : `${column.label}: ${column.value} against ${money(column.estimate)} expected`).join('; ')}
                    style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                >
                    {columns.map(column => (
                        <div key={column.key} className={`earnings-col${column.isNext ? ' is-next' : ''}`}>
                            <div className="earnings-track">
                                <span className="earnings-ring" style={{ bottom: `${y(column.estimate)}%` }} />
                                {column.actual !== null && (
                                    <span className={`earnings-dot ${column.tone}`} style={{ bottom: `${y(column.actual)}%` }} />
                                )}
                            </div>
                            <span className="earnings-col-label">{column.label}</span>
                            <span className="earnings-col-value">{column.value}</span>
                        </div>
                    ))}
                </div>
            )}

            {latest && (
                <div className="earnings-foot">
                    <span>
                        {quarters.length > 1
                            ? `Beat ${beats} of the last ${quarters.length}`
                            : `${latest.surprisePercent >= 0 ? 'Beat' : 'Missed'} the estimate by ${formatPercent(Math.abs(latest.surprisePercent), { signed: false, decimals: 1 })}`}
                    </span>
                    <span className="earnings-legend" aria-hidden="true">
                        <span><i className="earnings-dot is-beat is-legend" />Actual</span>
                        <span><i className="earnings-ring is-legend" />Estimate</span>
                    </span>
                </div>
            )}
        </section>
    );
});

export default EarningsEvent;
