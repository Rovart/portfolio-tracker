'use client';

import { useState, useEffect, memo } from 'react';
import { Calendar, TrendingUp, TrendingDown, Clock } from 'lucide-react';

/**
 * EarningsEvent - Revolut-style earnings date display
 * Shows upcoming earnings events with a clean, premium design
 */
const EarningsEvent = memo(function EarningsEvent({ symbol }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!symbol) return;

        async function fetchEarnings() {
            setLoading(true);
            try {
                const res = await fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`);
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
            <div className="rounded-2xl p-4 animate-pulse" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="h-4 w-32 bg-white/5 rounded mb-3" />
                <div className="h-12 w-full bg-white/5 rounded" />
            </div>
        );
    }

    // Check if we have earnings date
    const earnings = data?.calendarEvents?.earnings;
    if (!earnings?.earningsDate || earnings.earningsDate.length === 0) {
        return null;
    }

    // Get the next earnings date
    const earningsDate = new Date(earnings.earningsDate[0]);
    const now = new Date();
    const daysUntil = Math.ceil((earningsDate - now) / (1000 * 60 * 60 * 24));

    // Don't show if earnings date is in the past
    if (daysUntil < 0) return null;

    // Get the last quarter results for context
    const lastQuarter = data?.earningsHistory?.[0];
    const beat = lastQuarter && lastQuarter.epsActual >= lastQuarter.epsEstimate;

    // Format date nicely
    const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    const formattedDate = earningsDate.toLocaleDateString(undefined, dateOptions);

    // Determine urgency styling
    let urgencyClass = '';
    let urgencyBg = 'rgba(255,255,255,0.03)';
    let urgencyBorder = 'transparent';
    if (daysUntil <= 7) {
        urgencyBg = 'rgba(239, 68, 68, 0.08)';
        urgencyBorder = 'rgba(239, 68, 68, 0.2)';
        urgencyClass = 'text-red-400';
    } else if (daysUntil <= 14) {
        urgencyBg = 'rgba(251, 191, 36, 0.08)';
        urgencyBorder = 'rgba(251, 191, 36, 0.2)';
        urgencyClass = 'text-amber-400';
    }

    return (
        <div
            className="rounded-2xl p-4 transition-all"
            style={{
                background: urgencyBg,
                border: `1px solid ${urgencyBorder}`
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-white/50" />
                    <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                        Upcoming Earnings
                    </span>
                </div>
                {daysUntil <= 14 && (
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${urgencyClass}`}>
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
                    </span>
                )}
            </div>

            {/* Main Content */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-lg font-bold text-white">
                        {formattedDate}
                    </span>
                    {earnings.earningsDate.length > 1 && (
                        <span className="text-xs text-white/40">
                            to {new Date(earnings.earningsDate[1]).toLocaleDateString(undefined, dateOptions)}
                        </span>
                    )}
                </div>

                {/* Estimates if available */}
                {earnings.earningsAverage && (
                    <div className="flex flex-col items-end">
                        <span className="text-xs text-white/40 uppercase tracking-wider">Est. EPS</span>
                        <span className="text-sm font-bold text-white">
                            ${earnings.earningsAverage.toFixed(2)}
                        </span>
                        {earnings.earningsLow && earnings.earningsHigh && (
                            <span className="text-[10px] text-white/30">
                                ${earnings.earningsLow.toFixed(2)} - ${earnings.earningsHigh.toFixed(2)}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Last Quarter Performance */}
            {lastQuarter && lastQuarter.epsActual && (
                <div
                    className="mt-3 pt-3 flex items-center justify-between"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                >
                    <div className="flex items-center gap-2">
                        {beat ? (
                            <TrendingUp size={14} className="text-success" />
                        ) : (
                            <TrendingDown size={14} className="text-danger" />
                        )}
                        <span className="text-xs text-white/50">Last Quarter</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${beat ? 'text-success' : 'text-danger'}`}>
                            {beat ? 'Beat' : 'Missed'} by {Math.abs(lastQuarter.surprisePercent || 0).toFixed(1)}%
                        </span>
                        <span className="text-xs text-white/40">
                            (${lastQuarter.epsActual.toFixed(2)} vs ${lastQuarter.epsEstimate.toFixed(2)})
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
});

export default EarningsEvent;
