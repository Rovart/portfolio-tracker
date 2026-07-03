'use client';

import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { GripVertical, ChevronDown, ChevronRight, Wallet, Sun, Moon, Plus } from 'lucide-react';
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
    returnMode,
    onSelect,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dragItemRef
}) {
    const isBeingDragged = draggedIndex === index;
    const isDragOver = dragOverIndex === index;
    const showDragHandle = isDraggable && !isFiatItem;
    const totalProfit = holding.totalProfit || 0;
    const totalProfitPercent = holding.costBasis > 0 ? (totalProfit / holding.costBasis) * 100 : 0;
    const displayedChangeValue = returnMode === 'total' && !isWatchlist ? totalProfit : (holding.dailyPnl || 0);
    const displayedChangePercent = returnMode === 'total' && !isWatchlist ? totalProfitPercent : (holding.change24h || 0);
    const displayedChangePositive = displayedChangeValue >= 0;
    const handleKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(holding);
    };

    return (
        <div
            key={holding.asset}
            className={`card interactive-surface flex justify-between items-center ${isBeingDragged ? 'opacity-50' : ''} ${isDragOver ? 'border-primary' : ''}`}
            style={{ cursor: 'pointer', transition: 'opacity 150ms var(--ease-out), border-color 150ms var(--ease-out), background-color 150ms var(--ease-out), transform 140ms var(--ease-out)', marginBottom: 0 }}
            onClick={() => onSelect(holding)}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
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
                {loading ? (
                    <div className="w-16 sm:w-20 h-4 bg-white-10 rounded animate-pulse mt-1 ml-auto" />
                ) : (
                    holding.asset !== baseCurrency && (
                        <span
                            className="text-[10px] sm:text-xs font-semibold"
                            style={{
                                marginTop: '3px',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                color: displayedChangePositive ? 'var(--success)' : 'var(--danger)',
                                background: displayedChangePositive ? 'rgba(48, 209, 88, 0.1)' : 'rgba(255, 69, 58, 0.1)'
                            }}
                        >
                            {/* Nominal change hidden by privacy mode on regular portfolios */}
                            {(!hideBalances || isWatchlist) && `${displayedChangePositive ? '+' : '-'}${Math.abs(displayedChangeValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} `}
                            ({displayedChangePercent >= 0 ? '+' : ''}{displayedChangePercent.toFixed(2)}%)
                        </span>
                    )
                )}
            </div>
        </div>
    );
});

// Toggle this to switch between Symbol and Short Name
const DISPLAY_NAME = false; // true = Name, false = Symbol

// Distinct, muted-professional palette for allocation segments
const ALLOC_COLORS = ['#4c8dff', '#30d158', '#bf5af2', '#ff9f0a', '#64d2ff', '#ffd60a', '#ff6482', '#ac8e68'];

const TYPE_GROUP_LABELS = {
    CRYPTOCURRENCY: 'Crypto',
    EQUITY: 'Stocks',
    ETF: 'ETFs',
    MUTUALFUND: 'Funds',
    FUTURE: 'Commodities',
    INDEX: 'Indexes',
    CURRENCY: 'Currencies'
};

// Slim stacked allocation bar. Few assets: one segment per asset.
// Many assets: grouped by asset class so the bar stays readable.
function AllocationBar({ holdings, cashValue }) {
    const segments = useMemo(() => {
        const assets = [...holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
        const total = assets.reduce((acc, h) => acc + (h.value || 0), 0) + Math.max(cashValue, 0);
        if (total <= 0) return [];

        let segs;
        if (assets.length > 6) {
            // Group by asset class
            const byType = new Map();
            assets.forEach(h => {
                const label = TYPE_GROUP_LABELS[String(h.originalType || '').toUpperCase()] || 'Other';
                byType.set(label, (byType.get(label) || 0) + (h.value || 0));
            });
            segs = [...byType.entries()]
                .sort((a, b) => b[1] - a[1])
                .filter(([, value]) => value / total >= 0.005)
                .map(([label, value], i) => ({
                    label,
                    pct: (value / total) * 100,
                    color: label === 'Other' ? 'rgba(255,255,255,0.28)' : ALLOC_COLORS[i % ALLOC_COLORS.length]
                }));
        } else {
            const top = assets.slice(0, 4).filter(h => (h.value || 0) / total >= 0.02);
            const rest = assets.slice(top.length).reduce((acc, h) => acc + (h.value || 0), 0);

            segs = top.map((h, i) => ({
                label: h.asset,
                pct: (h.value / total) * 100,
                color: ALLOC_COLORS[i % ALLOC_COLORS.length]
            }));
            if (rest / total >= 0.005) {
                segs.push({ label: 'Other', pct: (rest / total) * 100, color: 'rgba(255,255,255,0.28)' });
            }
        }

        if (cashValue / total >= 0.005) {
            segs.push({ label: 'Cash', pct: (Math.max(cashValue, 0) / total) * 100, color: 'rgba(255,255,255,0.14)' });
        }
        return segs;
    }, [holdings, cashValue]);

    if (segments.length < 2) return null;

    return (
        <div className="no-select" style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '3px', height: '6px', borderRadius: '9999px', overflow: 'hidden' }}>
                {segments.map(seg => (
                    <div
                        key={seg.label}
                        style={{
                            width: `${seg.pct}%`,
                            minWidth: '4px',
                            background: seg.color,
                            borderRadius: '9999px',
                            transition: 'width 400ms var(--ease-in-out)'
                        }}
                    />
                ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: '8px' }}>
                {segments.map(seg => (
                    <span key={seg.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
                        {seg.label}
                        <span style={{ color: 'var(--text-faint)' }}>{seg.pct.toFixed(seg.pct >= 10 ? 0 : 1)}%</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

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
    const [returnMode, setReturnMode] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('holdings_return_mode') || 'daily';
        }
        return 'daily';
    });
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
    }, [isWatchlist, currentPortfolioId, setSortBy]); // Also reset when portfolio changes

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

    const handleReturnModeChange = (mode) => {
        setReturnMode(mode);
        localStorage.setItem('holdings_return_mode', mode);
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
    const { nonFiatHoldings, fiatHoldings, totalFiatValue, totalFiatDailyPnl, totalFiatProfit } = useMemo(() => {
        const fiat = [];
        const nonFiat = [];
        let fiatTotal = 0;
        let fiatDailyTotal = 0;
        let fiatProfitTotal = 0;

        holdings.forEach(h => {
            if (h.isFiat && !isWatchlist) {
                fiat.push(h);
                fiatTotal += h.value || 0;
                fiatDailyTotal += h.dailyPnl || 0;
                fiatProfitTotal += h.totalProfit || 0;
            } else {
                nonFiat.push(h);
            }
        });

        // Sort non-fiat holdings
        const sortedNonFiat = sortBy === 'custom' ? nonFiat : [...nonFiat].sort((a, b) => {
            switch (sortBy) {
                case 'gainers':
                    return returnMode === 'total'
                        ? (b.totalProfit || 0) - (a.totalProfit || 0)
                        : b.change24h - a.change24h;
                case 'losers':
                    return returnMode === 'total'
                        ? (a.totalProfit || 0) - (b.totalProfit || 0)
                        : a.change24h - b.change24h;
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
            totalFiatDailyPnl: fiatDailyTotal,
            totalFiatProfit: fiatProfitTotal
        };
    }, [holdings, sortBy, isWatchlist, returnMode]);

    const activeOptions = isWatchlist ? WATCHLIST_SORT_OPTIONS : SORT_OPTIONS;
    const isDraggable = isWatchlist && sortBy === 'custom';
    const displayedFiatChange = returnMode === 'total' ? totalFiatProfit : totalFiatDailyPnl;

    return (
        <div className="flex flex-col gap-2">
            {/* Only show header for regular portfolios - watchlist sort is in the top bar */}
            {!isWatchlist && (
                <div className="flex items-center justify-between mb-1 gap-2">
                    <h2 className="text-xl">Holdings</h2>
                    <div className="flex items-center gap-2 shrink-0">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', borderRadius: '10px', padding: '3px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--card-border)' }}>
                            {[
                                { id: 'daily', label: 'Daily' },
                                { id: 'total', label: 'Total' }
                            ].map(mode => (
                                <button
                                    key={mode.id}
                                    type="button"
                                    onClick={() => handleReturnModeChange(mode.id)}
                                    className="transition-all"
                                    style={{
                                        background: returnMode === mode.id ? 'var(--foreground)' : 'transparent',
                                        color: returnMode === mode.id ? 'var(--background)' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: '7px',
                                        padding: '5px 12px',
                                        fontSize: '0.72rem',
                                        fontWeight: 600,
                                        letterSpacing: '-0.01em',
                                        cursor: 'pointer',
                                        boxShadow: returnMode === mode.id ? '0 1px 3px rgba(0,0,0,0.35)' : 'none'
                                    }}
                                >
                                    {mode.label}
                                </button>
                            ))}
                        </div>
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
                </div>
            )}

            {/* Portfolio allocation at a glance */}
            {!isWatchlist && !loading && nonFiatHoldings.length > 1 && (
                <AllocationBar holdings={nonFiatHoldings} cashValue={totalFiatValue} />
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
                    returnMode={returnMode}
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
                        className={`interactive-surface flex justify-between items-center cursor-pointer hover:bg-white/5 transition-colors rounded-xl ${fiatCollapsed ? 'card' : ''}`}
                        onClick={toggleFiatCollapsed}
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            toggleFiatCollapsed();
                        }}
                        role="button"
                        tabIndex={0}
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
                            <span className={`text-[10px] sm:text-sm font-medium ${displayedFiatChange >= 0 ? 'text-success' : 'text-danger'}`}>
                                {!hideBalances && `${displayedFiatChange >= 0 ? '+' : '-'}${Math.abs(displayedFiatChange).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
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
                                    returnMode={returnMode}
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
                    className="interactive-surface flex flex-col items-center justify-center animate-enter transition-all"
                    style={{
                        cursor: 'pointer',
                        gap: '14px',
                        padding: '40px 24px',
                        borderRadius: '18px',
                        border: '1px dashed var(--card-border-strong)',
                        background: 'rgba(255, 255, 255, 0.02)'
                    }}
                    onClick={onAddAsset}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onAddAsset();
                    }}
                    role="button"
                    tabIndex={0}
                >
                    <div style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '15px',
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid var(--card-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <Plus size={24} style={{ color: 'var(--foreground)' }} strokeWidth={2.25} />
                    </div>
                    <div className="flex flex-col items-center" style={{ gap: '3px' }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.98rem' }}>
                            {isWatchlist ? 'Add to watchlist' : 'Add your first asset'}
                        </p>
                        <p className="text-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                            Search stocks, crypto, ETFs and more
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
