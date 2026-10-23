'use client';

import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { GripVertical, ChevronDown, Wallet, Sun, Moon, Plus } from 'lucide-react';
import { updateWatchlistAssetPositions } from '@/utils/db';
import { formatSymbol } from '@/utils/commodities';
import AssetIcon from './AssetIcon';
import SortMenu from './SortMenu';
import { Segmented } from './ui';
import { LoanRateText } from './LoanPanel';
import { ALLOCATION_COLORS } from './CompositionChart';
import { changeTone, formatMoney, formatPercent, formatPrice, formatQuantity } from '@/utils/format';

function getHoldingLabel(holding) {
    if (holding.loan) return holding.loan.name || holding.name;
    return DISPLAY_NAME ? holding.name : formatSymbol(holding.asset, holding.name);
}

function formatRowSubtitle(holding, isWatchlist, hideBalances, baseCurrency) {
    if (holding.loan) return null;
    if (holding.valuationUnavailable || !Number.isFinite(holding.price)) return 'Price unavailable';
    const price = formatPrice(holding.price, baseCurrency);
    if (isWatchlist) return price;
    return `${hideBalances ? '••••' : formatQuantity(holding.amount, { maxDecimals: 4 })} · ${price}`;
}

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
    dragItemRef,
    indented = false
}) {
    const isBeingDragged = draggedIndex === index;
    const isDragOver = dragOverIndex === index;
    const showDragHandle = isDraggable && !isFiatItem;
    const unavailable = holding.valuationUnavailable || !Number.isFinite(holding.price);
    const showTotal = returnMode === 'total' && !isWatchlist;
    const profitUnavailable = showTotal && holding.totalProfit === null;
    const totalProfit = holding.totalProfit || 0;
    const totalProfitPercent = holding.costBasis > 0 ? (totalProfit / holding.costBasis) * 100 : 0;
    const changeValue = showTotal ? totalProfit : (holding.dailyPnl || 0);
    const changePercent = showTotal ? totalProfitPercent : (holding.change24h || 0);
    const subtitle = formatRowSubtitle(holding, isWatchlist, hideBalances, baseCurrency);
    const handleKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(holding);
    };

    return (
        <div
            className={`list-row${indented ? ' is-indented' : ''}${isBeingDragged ? ' opacity-60' : ''}`}
            style={isDragOver ? { boxShadow: 'inset 0 0 0 1px var(--border-strong)' } : undefined}
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
                <span className="text-muted cursor-grab" style={{ touchAction: 'none', marginRight: '-4px' }} onClick={(e) => e.stopPropagation()}>
                    <GripVertical size={16} />
                </span>
            )}

            <AssetIcon symbol={holding.asset} type={holding.originalType} isFiat={holding.isFiat} size={36} />

            <div className="flex-1 flex flex-col min-w-0" style={{ gap: '2px' }}>
                <span className="list-row-title truncate flex items-center" style={{ gap: '5px' }}>
                    <span className="truncate">{getHoldingLabel(holding)}</span>
                    {!loading && holding.marketState === 'PRE' && <Sun size={12} className="shrink-0 text-muted" aria-label="Pre-market" />}
                    {!loading && (holding.marketState === 'POST' || holding.marketState === 'POSTPOST') && <Moon size={12} className="shrink-0 text-muted" aria-label="After-hours" />}
                </span>
                <span className="list-row-subtitle truncate">
                    {loading ? <span className="skeleton inline-block" style={{ width: 96, height: 11 }} /> : holding.loan ? (
                        <>
                            {holding.loan.project ? `${holding.loan.project} · ` : ''}
                            <LoanRateText loan={holding.loan} />
                        </>
                    ) : subtitle}
                </span>
            </div>

            <div className="flex flex-col items-end shrink-0" style={{ gap: '2px', textAlign: 'right' }}>
                {loading ? (
                    <>
                        <span className="skeleton" style={{ width: 80, height: 14 }} />
                        <span className="skeleton" style={{ width: 52, height: 11 }} />
                    </>
                ) : (
                    <>
                        <span className="list-row-title">
                            {hideBalances && !isWatchlist ? '••••••' : unavailable ? '—' : formatMoney(holding.value, baseCurrency)}
                        </span>
                        {!unavailable && holding.asset !== baseCurrency && (
                            profitUnavailable
                                ? <span className="list-row-subtitle">No cost basis</span>
                                : (
                                    <span className={`list-row-subtitle ${changeTone(changeValue || changePercent)}`}>
                                        {hideBalances && !isWatchlist ? formatPercent(changePercent) : `${formatMoney(changeValue, baseCurrency, { signed: true })} · ${formatPercent(changePercent)}`}
                                    </span>
                                )
                        )}
                    </>
                )}
            </div>
        </div>
    );
});

// Toggle this to switch between Symbol and Short Name
const DISPLAY_NAME = false; // true = Name, false = Symbol


const TYPE_GROUP_LABELS = {
    CRYPTOCURRENCY: 'Crypto',
    EQUITY: 'Stocks',
    ETF: 'ETFs',
    MUTUALFUND: 'Funds',
    FUTURE: 'Commodities',
    INDEX: 'Indexes',
    CURRENCY: 'Currencies',
    LOAN: 'Loans'
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
                    color: label === 'Other' ? 'rgba(255,255,255,0.18)' : ALLOCATION_COLORS[Math.min(i, ALLOCATION_COLORS.length - 1)]
                }));
        } else {
            const top = assets.slice(0, 4).filter(h => (h.value || 0) / total >= 0.02);
            const rest = assets.slice(top.length).reduce((acc, h) => acc + (h.value || 0), 0);

            segs = top.map((h, i) => ({
                label: h.loan ? (h.loan.name || 'Loan') : h.asset,
                pct: (h.value / total) * 100,
                color: ALLOCATION_COLORS[Math.min(i, ALLOCATION_COLORS.length - 1)]
            }));
            if (rest / total >= 0.005) {
                segs.push({ label: 'Other', pct: (rest / total) * 100, color: 'rgba(255,255,255,0.18)' });
            }
        }

        if (cashValue / total >= 0.005) {
            segs.push({ label: 'Cash', pct: (Math.max(cashValue, 0) / total) * 100, color: 'rgba(255,255,255,0.1)' });
        }
        return segs;
    }, [holdings, cashValue]);

    if (segments.length < 2) return null;

    return (
        <div className="no-select" style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', gap: '2px', height: '4px', borderRadius: '9999px', overflow: 'hidden' }}>
                {segments.map(seg => (
                    <div key={seg.label} style={{ width: `${seg.pct}%`, minWidth: '3px', background: seg.color, transition: 'width var(--dur-base) var(--ease-out)' }} />
                ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: '8px' }}>
                {segments.map(seg => (
                    <span key={seg.label} className="label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-xs)' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '2px', background: seg.color, flexShrink: 0 }} />
                        <span className="truncate" style={{ maxWidth: '140px' }}>{seg.label}</span>
                        <span style={{ color: 'var(--text-faint)' }}>{formatPercent(seg.pct, { signed: false, decimals: seg.pct >= 10 ? 0 : 1 })}</span>
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
                    return getHoldingLabel(a).localeCompare(getHoldingLabel(b));
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
    const fiatValueUnavailable = fiatHoldings.some(holding => holding.valuationUnavailable);
    const displayedFiatChange = returnMode === 'total' ? totalFiatProfit : totalFiatDailyPnl;

    const rowProps = {
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
    };

    return (
        <div className="flex flex-col">
            {/* Only show header for regular portfolios - watchlist sort is in the top bar */}
            {!isWatchlist && (
                <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    <h2 className="section-title">Holdings</h2>
                    <div className="flex items-center shrink-0" style={{ gap: 'var(--space-3)' }}>
                        <Segmented
                            variant="compact"
                            ariaLabel="Return shown"
                            options={[{ id: 'daily', label: 'Today' }, { id: 'total', label: 'Total' }]}
                            value={returnMode}
                            onChange={handleReturnModeChange}
                        />
                        {holdings.length > 1 && (
                            <SortMenu options={activeOptions} value={sortBy} onChange={handleSortChange} />
                        )}
                    </div>
                </div>
            )}

            {/* Portfolio allocation at a glance */}
            {!isWatchlist && !loading && nonFiatHoldings.length > 1 && (
                <AllocationBar holdings={nonFiatHoldings} cashValue={totalFiatValue} />
            )}

            <div className="list-group">
                {nonFiatHoldings.map((holding, index) => (
                    <HoldingRow key={holding.asset} holding={holding} index={index} isFiatItem={false} {...rowProps} />
                ))}

                {/* Collapsible cash row - only for regular portfolios with fiat holdings */}
                {!isWatchlist && fiatHoldings.length > 0 && (
                    <div
                        className="list-row"
                        onClick={toggleFiatCollapsed}
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            toggleFiatCollapsed();
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={!fiatCollapsed}
                    >
                        <span className="asset-icon" style={{ width: 36, height: 36 }}>
                            <Wallet size={16} />
                        </span>
                        <div className="flex-1 flex flex-col min-w-0" style={{ gap: '2px' }}>
                            <span className="list-row-title">Cash</span>
                            <span className="list-row-subtitle">
                                {fiatHoldings.length} {fiatHoldings.length === 1 ? 'currency' : 'currencies'}
                            </span>
                        </div>
                        <div className="flex items-center shrink-0" style={{ gap: 'var(--space-2)' }}>
                            <div className="flex flex-col items-end" style={{ gap: '2px' }}>
                                <span className="list-row-title">
                                    {hideBalances ? '••••••' : fiatValueUnavailable ? 'Partial value' : formatMoney(totalFiatValue, baseCurrency)}
                                </span>
                                {!fiatValueUnavailable && !hideBalances && Math.abs(displayedFiatChange) >= 0.005 && (
                                    <span className={`list-row-subtitle ${changeTone(displayedFiatChange)}`}>
                                        {formatMoney(displayedFiatChange, baseCurrency, { signed: true })}
                                    </span>
                                )}
                            </div>
                            <ChevronDown size={16} className="text-muted" style={{ transform: fiatCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
                        </div>
                    </div>
                )}

                {!isWatchlist && !fiatCollapsed && fiatHoldings.map((holding, index) => (
                    <HoldingRow key={holding.asset} holding={holding} index={index} isFiatItem={true} indented {...rowProps} />
                ))}
            </div>

            {holdings.length === 0 && !loading && (
                <button type="button" className="empty-state" onClick={onAddAsset}>
                    <span className="empty-state-icon"><Plus size={20} strokeWidth={2.25} /></span>
                    <span className="list-row-title">{isWatchlist ? 'Add to watchlist' : 'Add your first asset'}</span>
                    <span className="list-row-subtitle">Stocks, ETFs, crypto, currencies or a private loan</span>
                </button>
            )}
        </div>
    );
}
