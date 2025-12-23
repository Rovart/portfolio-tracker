'use client';

import { useState, useEffect } from 'react';
import { ArrowUpDown } from 'lucide-react';

// Toggle this to switch between Symbol and Short Name
const DISPLAY_NAME = false; // true = Name, false = Symbol

const SORT_OPTIONS = [
    { id: 'size', label: 'Size' },
    { id: 'gainers', label: 'Top Gainers' },
    { id: 'losers', label: 'Top Losers' }
];

export default function HoldingsList({ holdings, onSelect, onAddAsset, loading, hideBalances, baseCurrency }) {
    const [sortBy, setSortBy] = useState('size');
    const [showSortMenu, setShowSortMenu] = useState(false);

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
        setShowSortMenu(false);
    };

    // Sort holdings based on selected option
    const sortedHoldings = [...holdings].sort((a, b) => {
        switch (sortBy) {
            case 'gainers':
                return b.change24h - a.change24h; // Highest gains first
            case 'losers':
                return a.change24h - b.change24h; // Biggest losses first
            case 'size':
            default:
                return b.value - a.value; // Largest holdings first
        }
    });

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <h2 className="text-xl">Holdings</h2>
                <div className="relative">
                    <button
                        onClick={() => setShowSortMenu(!showSortMenu)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-white transition-colors rounded-lg hover:bg-white/5"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                        <ArrowUpDown size={14} />
                        <span>{SORT_OPTIONS.find(o => o.id === sortBy)?.label}</span>
                    </button>
                    {showSortMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowSortMenu(false)}
                            />
                            <div
                                className="absolute right-0 top-full mt-1 z-50 bg-[#171717] border border-white/10 rounded-xl overflow-hidden shadow-xl"
                                style={{ minWidth: '120px' }}
                            >
                                {SORT_OPTIONS.map(option => (
                                    <button
                                        key={option.id}
                                        onClick={() => handleSortChange(option.id)}
                                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${sortBy === option.id
                                                ? 'bg-white/10 text-white'
                                                : 'text-muted hover:bg-white/5 hover:text-white'
                                            }`}
                                        style={{ border: 'none', cursor: 'pointer' }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
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
