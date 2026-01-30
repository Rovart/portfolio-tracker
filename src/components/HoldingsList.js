'use client';

import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { GripVertical, ChevronDown, ChevronRight, Wallet, Sun, Moon } from 'lucide-react';
import { updateWatchlistAssetPositions } from '@/utils/db';
import { formatSymbol } from '@/utils/commodities';
import AssetIcon from './AssetIcon';

// Extracted memoized component for holding rows to prevent unnecessary re-renders
const HoldingRow = memo(function HoldingRow({
    holding,
    index,
    isFiatItem,
    isDraggable,
    draggedIndex,
    dragOverIndex,
    loading,
    hideBalances,
    isWatchlist,
    baseCurrency,
    onSelect,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dragItemRef
}) {
    const isBeingDragged = draggedIndex === index;
    const isDragOver = dragOverIndex === index;
    const showDragHandle = isDraggable && !isFiatItem;

    return (
        <div
            key={holding.asset}
            className={`card flex justify-between items-center ${isBeingDragged ? 'opacity-50' : ''} ${isDragOver ? 'border-primary' : ''}`}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s, border-color 0.15s', marginBottom: 0 }}
            onClick={() => onSelect(holding)}
            draggable={showDragHandle}
            onDragStart={(e) => showDragHandle && handleDragStart(e, index)}
            onDragOver={(e) => { if (showDragHandle && dragItemRef.current !== null) handleDragOver(e, index); }}
            onDragEnd={showDragHandle ? handleDragEnd : undefined}
            onDrop={(e) => e.preventDefault()}
        >
            {showDragHandle && (
                <div
                    className="pr-2 text-muted cursor-grab"
                    style={{ touchAction: 'none', marginRight: '10px' }}
                    onClick={(e) => e.stopPropagation()}
                >
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
            >
                <span className="text-base sm:text-lg font-bold truncate">
                    {DISPLAY_NAME ? holding.name : formatSymbol(holding.asset, holding.name)}
                    {/* Market State Icons */}
                    {!loading && holding.marketState === 'PRE' && (
                        <Sun size={12} className="inline" style={{ color: '#facc15', marginLeft: '5px' }} title="Pre-market" />
                    )}
                    {!loading && (holding.marketState === 'POST' || holding.marketState === 'POSTPOST') && (
                        <Moon size={12} className="inline" style={{ color: '#9ca3af', marginLeft: '5px' }} title="After-hours" />
                    )}
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
                            {/* Hide change if asset is the same as base currency (e.g. EUR in EUR portfolio) */}
                            {holding.asset !== baseCurrency && (
                                <>
                                    {/* Always show nominal change unless hidden by privacy on regular portfolios */}
                                    {(!hideBalances || isWatchlist) && `${holding.dailyPnl >= 0 ? '+' : '-'}${Math.abs(holding.dailyPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} `}
                                    ({holding.change24h >= 0 ? '+' : ''}{holding.change24h.toFixed(2)}%)
                                </>
                            )}
                        </>
                    )}
                </span>
            </div>
        </div>
    );
});

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

    // Fiat section collapsed state
    const [fiatCollapsed, setFiatCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('fiat_collapsed') === 'true';
        }
        return true; // Default to collapsed
    });

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

    // Save fiat collapsed state
    const toggleFiatCollapsed = () => {
        const newState = !fiatCollapsed;
        setFiatCollapsed(newState);
        localStorage.setItem('fiat_collapsed', newState.toString());
    };

    // Save sort preference
    const handleSortChange = (newSort) => {
        setSortBy(newSort);
        const storageKey = isWatchlist ? 'watchlist_sort' : 'holdings_sort';
        localStorage.setItem(storageKey, newSort);
    };

    // Drag and drop handlers - memoized to prevent unnecessary re-renders
    const handleDragStart = useCallback((e, index) => {
        dragItemRef.current = index;
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e, index) => {
        e.preventDefault();
        if (dragItemRef.current === index) return;
        dragOverItemRef.current = index;
        setDragOverIndex(index);
    }, []);

    const handleDragEnd = useCallback(async () => {
        if (dragItemRef.current !== null && dragOverItemRef.current !== null && dragItemRef.current !== dragOverItemRef.current) {
            // Reorder the holdings
            const items = [...holdings];
            const draggedItem = items[dragItemRef.current];
            items.splice(dragItemRef.current, 1);
            items.splice(dragOverItemRef.current, 0, draggedItem);

            // Get new order of symbols
            const orderedSymbols = items.map(h => h.symbol || h.asset);

            // Update positions in database
            if (currentPortfolioId) {
                await updateWatchlistAssetPositions(currentPortfolioId, orderedSymbols);
                if (onWatchlistReorder) onWatchlistReorder();
            }
        }

        // Reset drag state
        setDraggedIndex(null);
        setDragOverIndex(null);
        dragItemRef.current = null;
        dragOverItemRef.current = null;
    }, [holdings, currentPortfolioId, onWatchlistReorder]);

    // Sort holdings and separate fiat from non-fiat
    const { nonFiatHoldings, fiatHoldings, totalFiatValue, totalFiatDailyPnl } = useMemo(() => {
        const fiat = [];
        const nonFiat = [];
        let fiatTotal = 0;
        let fiatDailyTotal = 0;

        holdings.forEach(h => {
            if (h.isFiat && !isWatchlist) {
                fiat.push(h);
                fiatTotal += h.value || 0;
                fiatDailyTotal += h.dailyPnl || 0;
            } else {
                nonFiat.push(h);
            }
        });

        // Sort non-fiat holdings
        const sortedNonFiat = sortBy === 'custom' ? nonFiat : [...nonFiat].sort((a, b) => {
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

        // Sort fiat by value
        const sortedFiat = [...fiat].sort((a, b) => b.value - a.value);

        return {
            nonFiatHoldings: sortedNonFiat,
            fiatHoldings: sortedFiat,
            totalFiatValue: fiatTotal,
            totalFiatDailyPnl: fiatDailyTotal
        };
    }, [holdings, sortBy, isWatchlist]);

    const activeOptions = isWatchlist ? WATCHLIST_SORT_OPTIONS : SORT_OPTIONS;
    const isDraggable = isWatchlist && sortBy === 'custom';

    return (
        <div className="flex flex-col gap-2">
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

            {/* Non-fiat holdings */}
            {nonFiatHoldings.map((holding, index) => (
                <HoldingRow
                    key={holding.asset}
                    holding={holding}
                    index={index}
                    isFiatItem={false}
                    isDraggable={isDraggable}
                    draggedIndex={draggedIndex}
                    dragOverIndex={dragOverIndex}
                    loading={loading}
                    hideBalances={hideBalances}
                    isWatchlist={isWatchlist}
                    baseCurrency={baseCurrency}
                    onSelect={onSelect}
                    handleDragStart={handleDragStart}
                    handleDragOver={handleDragOver}
                    handleDragEnd={handleDragEnd}
                    dragItemRef={dragItemRef}
                />
            ))}

            {/* Collapsible Fiat Section - only for regular portfolios with fiat holdings */}
            {!isWatchlist && fiatHoldings.length > 0 && (
                <div
                    className="mt-2 rounded-xl transition-all"
                    style={!fiatCollapsed ? {
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        padding: '8px'
                    } : {}}
                >
                    {/* Fiat header - clickable to expand/collapse */}
                    <div
                        className={`flex justify-between items-center cursor-pointer hover:bg-white/5 transition-colors rounded-xl ${fiatCollapsed ? 'card' : ''}`}
                        onClick={toggleFiatCollapsed}
                        style={fiatCollapsed ? {
                            background: 'rgba(255,255,255,0.02)',
                            borderColor: 'rgba(255,255,255,0.05)'
                        } : { padding: '8px' }}
                    >
                        <div className="flex items-center gap-3">
                            {fiatCollapsed ? (
                                <ChevronRight size={18} className="text-muted" />
                            ) : (
                                <ChevronDown size={18} className="text-muted" />
                            )}
                            <div
                                className="shrink-0 rounded-full flex items-center justify-center"
                                style={{
                                    width: 40,
                                    height: 40,
                                    background: 'linear-gradient(135deg, hsl(45, 65%, 50%), hsl(45, 75%, 40%))',
                                    marginRight: '10px'
                                }}
                            >
                                <Wallet size={20} className="text-white" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-base sm:text-lg font-bold">Currencies</span>
                                <span className="text-[10px] sm:text-xs text-muted">
                                    {fiatHoldings.length} {fiatHoldings.length === 1 ? 'currency' : 'currencies'}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col items-end">
                            <span className="text-base sm:text-lg font-bold">
                                {hideBalances ? '••••••' : `${totalFiatValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                            </span>
                            <span className={`text-[10px] sm:text-sm font-medium ${totalFiatDailyPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                {!hideBalances && `${totalFiatDailyPnl >= 0 ? '+' : '-'}${Math.abs(totalFiatDailyPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                            </span>
                        </div>
                    </div>

                    {/* Expanded fiat holdings */}
                    {!fiatCollapsed && (
                        <div className="flex flex-col gap-2 mt-2">
                            {fiatHoldings.map((holding, index) => (
                                <HoldingRow
                                    key={holding.asset}
                                    holding={holding}
                                    index={index}
                                    isFiatItem={true}
                                    isDraggable={isDraggable}
                                    draggedIndex={draggedIndex}
                                    dragOverIndex={dragOverIndex}
                                    loading={loading}
                                    hideBalances={hideBalances}
                                    isWatchlist={isWatchlist}
                                    baseCurrency={baseCurrency}
                                    onSelect={onSelect}
                                    handleDragStart={handleDragStart}
                                    handleDragOver={handleDragOver}
                                    handleDragEnd={handleDragEnd}
                                    dragItemRef={dragItemRef}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

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
