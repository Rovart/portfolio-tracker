'use client';

import { useState, useEffect } from 'react';

// Toggle this to switch between Symbol and Short Name
const DISPLAY_NAME = false; // true = Name, false = Symbol

const SORT_OPTIONS = [
    { id: 'size', label: 'Size' },
    { id: 'gainers', label: 'Gainers' },
    { id: 'losers', label: 'Losers' },
    { id: 'alphabetical', label: 'Name' }
];

export default function HoldingsList({ holdings, onSelect, onAddAsset, loading, hideBalances, baseCurrency, isWatchlist = false }) {
    const [sortBy, setSortBy] = useState('size');

    // Load saved sort preference
    useEffect(() => {
        const saved = localStorage.getItem('holdings_sort');
        if (saved && SORT_OPTIONS.find(o => o.id === saved)) {
            setSortBy(saved);
        }
    }, []);

    // Save sort preference
    const handleSortChange = (newSort) => {
        setSortBy(newSort);
        localStorage.setItem('holdings_sort', newSort);
    };

    // Sort holdings based on selected option
    // FIAT currencies go to bottom for regular portfolios (not watchlists)
    const sortedHoldings = [...holdings].sort((a, b) => {
        // Use isFiat flag from portfolio-logic - but only for non-watchlist views
        if (!isWatchlist) {
            const aIsFiat = a.isFiat;
            const bIsFiat = b.isFiat;

            // If one is FIAT and the other isn't, FIAT goes to bottom
            if (aIsFiat && !bIsFiat) return 1;
            if (!aIsFiat && bIsFiat) return -1;
        }

        // Both are FIAT or both are not FIAT - apply normal sorting
        switch (sortBy) {
            case 'gainers':
                return b.change24h - a.change24h;
            case 'losers':
                return a.change24h - b.change24h;
            case 'alphabetical':
                const nameA = DISPLAY_NAME ? a.name : a.asset;
                const nameB = DISPLAY_NAME ? b.name : b.asset;
                return nameA.localeCompare(nameB);
            case 'size':
            default:
                return b.value - a.value;
        }
    });

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl">Holdings</h2>
                {holdings.length > 1 && (
                    <select
                        value={sortBy}
                        onChange={(e) => handleSortChange(e.target.value)}
                        className="bg-white-5 hover:bg-white-10 border border-white-10 text-white text-xs font-medium rounded-full cursor-pointer transition-all focus:outline-none"
                        style={{
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            MozAppearance: 'none',
                            padding: '4px 24px 4px 10px',
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 8px center'
                        }}
                    >
                        {SORT_OPTIONS.map(o => (
                            <option key={o.id} value={o.id} style={{ backgroundColor: '#171717', color: 'white' }}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            {sortedHoldings.map((holding) => (
                <div
                    key={holding.asset}
                    className="card flex justify-between items-center"
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect(holding)}
                >
                    <div className="flex-1 flex flex-col min-w-0 pr-2">
                        <span className="text-base sm:text-lg font-bold truncate">
                            {DISPLAY_NAME ? holding.name : holding.asset}
                        </span>
                        <span className="text-[10px] sm:text-xs text-muted truncate">
                            {loading ? (
                                <span className="inline-block w-24 h-3 bg-white-10 rounded animate-pulse" />
                            ) : (
                                <>
                                    {hideBalances ? '••••' : holding.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} | {holding.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                </>
                            )}
                        </span>
                    </div>

                    <div className="flex flex-col items-end shrink-0" style={{ textAlign: 'right' }}>
                        <span className="text-base sm:text-lg font-bold">
                            {loading ? (
                                <div className="w-24 sm:w-32 h-6 bg-white-10 rounded animate-pulse ml-auto" />
                            ) : (
                                hideBalances ? '••••••' : `${holding.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`
                            )}
                        </span>
                        <span className={`text-[10px] sm:text-sm font-medium ${holding.change24h >= 0 ? 'text-success' : 'text-danger'}`}>
                            {loading ? (
                                <div className="w-16 sm:w-20 h-4 bg-white-10 rounded animate-pulse mt-1 ml-auto" />
                            ) : (
                                <>
                                    {hideBalances ? '' : `${holding.dailyPnl >= 0 ? '+' : '-'}${Math.abs(holding.dailyPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} `}
                                    ({holding.change24h >= 0 ? '+' : ''}{holding.change24h.toFixed(2)}%)
                                </>
                            )}
                        </span>
                    </div>
                </div>
            ))}
            {holdings.length === 0 && !loading && (
                <div
                    className="card flex flex-col items-center justify-center py-10 bg-white-5 rounded-2xl border border-white-5 border-dashed gap-2 animate-enter hover:bg-white/10 hover:border-white/20 transition-all"
                    style={{ cursor: 'pointer' }}
                    onClick={onAddAsset}
                >
                    <p className="text-sm font-medium text-white/80" style={{ margin: 0 }}>No assets yet.</p>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-muted" style={{ margin: 0 }}>Tap to add your first asset</p>
                </div>
            )}
        </div>
    );
}
