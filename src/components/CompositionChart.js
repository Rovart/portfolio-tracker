'use client';

import { memo, useMemo } from 'react';
import { formatMoney, formatPercent, MASK } from '@/utils/format';

export const ALLOCATION_COLORS = ['#e4e4e7', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a'];

// Allocation by asset class: a ranked list with proportional bars.
function CompositionChart({ holdings, baseCurrency, hideBalances, loading }) {
    const rows = useMemo(() => {
        const totals = new Map();
        for (const holding of holdings || []) {
            const value = holding.value || 0;
            if (value <= 0) continue;
            const category = holding.category || 'Other';
            totals.set(category, (totals.get(category) || 0) + value);
        }
        const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
        return [...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, value], index) => ({
                name,
                value,
                share: total > 0 ? (value / total) * 100 : 0,
                color: ALLOCATION_COLORS[Math.min(index, ALLOCATION_COLORS.length - 1)]
            }));
    }, [holdings]);

    if (loading || rows.length < 2) return null;

    return (
        <section aria-label="Allocation">
            <h2 className="section-title" style={{ marginBottom: 'var(--space-3)' }}>Allocation</h2>
            <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
                {rows.map(row => (
                    <div key={row.name} className="flex flex-col" style={{ gap: '6px' }}>
                        <div className="flex items-center justify-between" style={{ fontSize: 'var(--fs-sm)' }}>
                            <span>{row.name}</span>
                            <span className="flex" style={{ gap: 'var(--space-3)' }}>
                                <span className="label">{hideBalances ? MASK : formatMoney(row.value, baseCurrency)}</span>
                                <span style={{ minWidth: '56px', textAlign: 'right' }}>{formatPercent(row.share, { signed: false, decimals: 1 })}</span>
                            </span>
                        </div>
                        <div style={{ height: '4px', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            <div style={{ width: `${row.share}%`, height: '100%', borderRadius: '999px', background: row.color, transition: 'width var(--dur-base) var(--ease-out)' }} />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

export default memo(CompositionChart);
