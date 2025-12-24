'use client';

import { useState, useEffect, useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { updateWatchlistAssetPositions } from '@/utils/db';
import AssetIcon from './AssetIcon';

// Toggle this to switch between Symbol and Short Name
const DISPLAY_NAME = false; // true = Name, false = Symbol

const SORT_OPTIONS = [
    { id: 'size', label: 'Size' },
    { id: 'gainers', label: 'Gainers' },
    { id: 'losers', label: 'Losers' },
    { id: 'alphabetical', label: 'Name' }
];

export const WATCHLIST_SORT_OPTIONS = [
    { id: 'custom', label: 'Custom' },
    { id: 'gainers', label: 'Gainers' },
    { id: 'losers', label: 'Losers' },
    { id: 'alphabetical', label: 'Name' }
];

export default function HoldingsList({ holdings, onSelect, onAddAsset, loading, hideBalances, baseCurrency, isWatchlist = false, currentPortfolioId, onWatchlistReorder, externalSort, onExternalSortChange }) {
    // Use external sort control for watchlists if provided
    const [internalSortBy, setInternalSortBy] = useState(isWatchlist ? 'custom' : 'size');
    const sortBy = (isWatchlist && externalSort !== undefined) ? externalSort : internalSortBy;
    const setSortBy = (isWatchlist && onExternalSortChange) ? onExternalSortChange : setInternalSortBy;
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const dragItemRef = useRef(null);
    const dragOverItemRef = useRef(null);

    // Load saved sort preference OR reset when switching portfolio types
    useEffect(() => {
        const storageKey = isWatchlist ? 'watchlist_sort' : 'holdings_sort';
        const saved = localStorage.getItem(storageKey);
        const options = isWatchlist ? WATCHLIST_SORT_OPTIONS : SORT_OPTIONS;

        if (saved && options.find(o => o.id === saved)) {
            setSortBy(saved);
        } else {
            // Set default based on type
            setSortBy(isWatchlist ? 'custom' : 'size');
        }
    }, [isWatchlist, currentPortfolioId]); // Also reset when portfolio changes

    // Save sort preference
    const handleSortChange = (newSort) => {
        setSortBy(newSort);
        const storageKey = isWatchlist ? 'watchlist_sort' : 'holdings_sort';
        localStorage.setItem(storageKey, newSort);
    };

    // Drag and drop handlers
    const handleDragStart = (e, index) => {
        dragItemRef.current = index;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        if (dragItemRef.current === index) return;
        dragOverItemRef.current = index;
        setDragOverIndex(index);
    };

    const handleDragEnd = async () => {
        if (dragItemRef.current !== null && dragOverItemRef.current !== null && dragItemRef.current !== dragOverItemRef.current) {
            // Reorder the holdings
            const items = [...holdings];
            const draggedItem = items[dragItemRef.current];
            items.splice(dragItemRef.current, 1);
            items.splice(dragOverItemRef.current, 0, draggedItem);

            // Get new order of symbols
            const orderedSymbols = items.map(h => h.symbol || h.asset);

            // Save to database
            if (currentPortfolioId && currentPortfolioId !== 'all') {
                await updateWatchlistAssetPositions(currentPortfolioId, orderedSymbols);
            }

            // Notify parent to refresh
            if (onWatchlistReorder) {
                onWatchlistReorder(orderedSymbols);
            }
        }

        dragItemRef.current = null;
        dragOverItemRef.current = null;
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    // Sort holdings based on selected option
    // FIAT currencies go to bottom for regular portfolios (not watchlists)
    const sortedHoldings = sortBy === 'custom'
        ? holdings // Custom order respects original array order (from DB)
        : [...holdings].sort((a, b) => {
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

    const activeOptions = isWatchlist ? WATCHLIST_SORT_OPTIONS : SORT_OPTIONS;
    const isDraggable = isWatchlist && sortBy === 'custom';

    return (
        <div className="flex flex-col gap-1">
            {/* Only show header for regular portfolios - watchlist sort is in the top bar */}
            {!isWatchlist && (
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
                            {activeOptions.map(o => (
                                <option key={o.id} value={o.id} style={{ backgroundColor: '#171717', color: 'white' }}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            )}
            {sortedHoldings.map((holding, index) => (
                <div
                    key={holding.asset}
                    className={`card flex justify-between items-center ${draggedIndex === index ? 'opacity-50' : ''} ${dragOverIndex === index ? 'border-primary' : ''}`}
                    style={{ cursor: isDraggable ? 'grab' : 'pointer', transition: 'opacity 0.15s, border-color 0.15s, margin-right 10px' }}
                    onClick={() => !isDraggable && onSelect(holding)}
                    draggable={isDraggable}
                    onDragStart={(e) => isDraggable && handleDragStart(e, index)}
                    onDragOver={(e) => { if (isDraggable && dragItemRef.current !== null) handleDragOver(e, index); }}
                    onDragEnd={isDraggable ? handleDragEnd : undefined}
                    onDrop={(e) => e.preventDefault()}
                >
                    {isDraggable && (
                        <div className="pr-2 text-muted cursor-grab" style={{ touchAction: 'none', marginRight: '10px' }}>
                            <GripVertical size={16} />
                        </div>
                    )}

                    <AssetIcon
                        symbol={holding.asset}
                        type={holding.originalType}
                        isFiat={holding.isFiat}
                        size={40}
                        className="mr-3"
                    />

                    <div
                        className="flex-1 flex flex-col min-w-0 pr-2"
                        style={isDraggable ? { cursor: 'pointer' } : {}}
                        onClick={(e) => { if (isDraggable) { e.stopPropagation(); onSelect(holding); } }}
                    >
                        <span className="text-base sm:text-lg font-bold truncate">
                            {DISPLAY_NAME ? holding.name : holding.asset}
                        </span>
                        <span className="text-[10px] sm:text-xs text-muted truncate">
                            {loading ? (
                                <span className="inline-block w-24 h-3 bg-white-10 rounded animate-pulse" />
                            ) : (
                                <>
                                    {isWatchlist ? (
                                        // Watchlist: Just show price
                                        `${holding.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`
                                    ) : (
                                        // Regular: Show Amount | Price
                                        `${hideBalances ? '••••' : holding.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} | ${holding.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`
                                    )}
                                </>
                            )}
                        </span>
                    </div>

                    <div className="flex flex-col items-end shrink-0" style={{ textAlign: 'right' }}>
                        <span className="text-base sm:text-lg font-bold">
                            {loading ? (
                                <div className="w-24 sm:w-32 h-6 bg-white-10 rounded animate-pulse ml-auto" />
                            ) : (
                                // For watchlists, 'value' is just the price (since amount is 1)
                                ((hideBalances && !isWatchlist) ? '••••••' : `${holding.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`)
                            )}
                        </span>
                        <span className={`text-[10px] sm:text-sm font-medium ${holding.change24h >= 0 ? 'text-success' : 'text-danger'}`}>
                            {loading ? (
                                <div className="w-16 sm:w-20 h-4 bg-white-10 rounded animate-pulse mt-1 ml-auto" />
                            ) : (
                                <>
                                    {/* Always show nominal change unless hidden by privacy on regular portfolios */}
                                    {/* Always show nominal change unless hidden by privacy on regular portfolios */}
                                    {(!hideBalances || isWatchlist) && `${holding.dailyPnl >= 0 ? '+' : '-'}${Math.abs(holding.dailyPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} `}
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
