'use client';

import { apiFetch } from '@/utils/api-client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, Landmark, ChevronRight } from 'lucide-react';
import { formatSymbol } from '@/utils/commodities';
import AssetIcon from './AssetIcon';

// One-tap suggestions shown before the user types
const POPULAR = [
    { q: 'Bitcoin', label: 'BTC' },
    { q: 'Ethereum', label: 'ETH' },
    { q: 'Apple', label: 'AAPL' },
    { q: 'Microsoft', label: 'MSFT' },
    { q: 'S&P 500', label: 'S&P 500' },
    { q: 'Gold', label: 'Gold' }
];

const TYPE_LABELS = {
    CRYPTOCURRENCY: 'Crypto',
    EQUITY: 'Stock',
    ETF: 'ETF',
    FUTURE: 'Commodity',
    CURRENCY: 'Currency',
    INDEX: 'Index',
    MUTUALFUND: 'Fund'
};

function SkeletonRow() {
    return (
        <div className="list-row is-static">
            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
            <div className="flex flex-col flex-1" style={{ gap: '6px' }}>
                <div className="skeleton" style={{ width: '45%', height: 14 }} />
                <div className="skeleton" style={{ width: '25%', height: 12 }} />
            </div>
        </div>
    );
}

export default function AssetSearch({ onSelect, onCreateLoan }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (query.length < 2) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const delayDebounceFn = setTimeout(async () => {
            try {
                const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                setResults(data.results || []);
            } catch (err) {
                console.error(err);
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [query]);

    const handlePick = (item) => {
        const transformedItem = { ...item };

        // Bare currencies (EUR=X) are normalized to USD pairs for FX handling
        if (item.symbol && item.symbol.endsWith('=X')) {
            const base = item.symbol.replace('=X', '');
            if (base.length <= 4 && base !== 'USD') {
                transformedItem.symbol = `${base}USD=X`;
                transformedItem.displaySymbol = item.symbol;
                transformedItem.isBareCurrencyOrigin = true;
            } else if (base === 'USD') {
                transformedItem.isBareCurrencyOrigin = true;
            }
        }

        onSelect(transformedItem);
    };

    const showEmpty = query.length < 2;
    const showNoMatches = !searching && !showEmpty && results.length === 0;

    return (
        <div className="flex flex-col h-full" style={{ maxWidth: '560px', margin: '0 auto', width: '100%' }}>
            <div className="search-field" style={{ marginBottom: 'var(--space-5)', flexShrink: 0 }}>
                <Search size={17} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search stocks, ETFs, crypto"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    enterKeyHint="search"
                    aria-label="Search assets"
                />
                {searching ? (
                    <div className="animate-spin shrink-0" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%' }} />
                ) : query && (
                    <button
                        type="button"
                        aria-label="Clear search"
                        className="icon-button"
                        style={{ width: 28, height: 28 }}
                        onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                    >
                        <X size={15} />
                    </button>
                )}
            </div>

            {/* Side padding absorbs the rows' negative margin, so no horizontal scrollbar appears. */}
            <div className="flex-1 overflow-y-auto" style={{ minHeight: 0, margin: '0 -12px', padding: '0 12px' }}>
                {showEmpty && (
                    <div className="flex flex-col" style={{ gap: 'var(--space-5)' }}>
                        <section>
                            <h3 className="label" style={{ margin: '0 0 var(--space-2)' }}>Popular</h3>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
                                {POPULAR.map(p => (
                                    <button key={p.label} type="button" className="chip" onClick={() => setQuery(p.q)}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </section>

                        {onCreateLoan && (
                            <section>
                                <h3 className="label" style={{ margin: '0 0 var(--space-2)' }}>Private assets</h3>
                                <div className="list-group">
                                    <button type="button" onClick={onCreateLoan} className="list-row">
                                        <span className="asset-icon" style={{ width: 36, height: 36 }}>
                                            <Landmark size={17} />
                                        </span>
                                        <span className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
                                            <span className="list-row-title">Loan</span>
                                            <span className="list-row-subtitle truncate">Private loan at a fixed or estimated annual rate</span>
                                        </span>
                                        <ChevronRight size={16} className="text-muted shrink-0" />
                                    </button>
                                </div>
                            </section>
                        )}
                    </div>
                )}

                {searching && results.length === 0 && (
                    <div className="list-group">
                        {[0, 1, 2, 3].map(i => <SkeletonRow key={i} />)}
                    </div>
                )}

                {showNoMatches && (
                    <div className="flex flex-col items-center" style={{ padding: '48px 0', gap: '4px' }}>
                        <span className="list-row-title">No matches for “{query}”</span>
                        <span className="label">Try a ticker such as AAPL or BTC</span>
                    </div>
                )}

                {results.length > 0 && (
                    <div className="list-group" style={{ marginBottom: '60px' }}>
                        {results.map(item => {
                            const trimmedSymbol = formatSymbol(item.symbol, item.shortname || item.longname);
                            const wasTrimmed = trimmedSymbol !== item.symbol;
                            const isBaseSymbol = item.symbol.startsWith(trimmedSymbol) && item.symbol !== trimmedSymbol;

                            let displayTitle, displaySubtitle;
                            if (!wasTrimmed) {
                                displayTitle = item.shortname || item.longname || item.symbol;
                                displaySubtitle = item.symbol;
                            } else if (isBaseSymbol) {
                                displayTitle = item.shortname || item.longname || trimmedSymbol;
                                displaySubtitle = item.symbol;
                            } else {
                                displayTitle = trimmedSymbol;
                                displaySubtitle = item.shortname || item.longname || item.symbol;
                            }

                            return (
                                <button key={item.symbol} type="button" className="list-row" onClick={() => handlePick(item)}>
                                    <AssetIcon symbol={item.symbol} type={item.type} size={36} />
                                    <span className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
                                        <span className="list-row-title truncate">{displayTitle}</span>
                                        <span className="list-row-subtitle truncate">
                                            {displaySubtitle}
                                            {item.exchange && ` · ${item.exchange}`}
                                        </span>
                                    </span>
                                    <span className="hint shrink-0">{TYPE_LABELS[item.type] || item.type || 'Asset'}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
