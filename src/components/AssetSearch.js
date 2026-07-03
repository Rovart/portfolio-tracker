'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, X, TrendingUp } from 'lucide-react';
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

function SkeletonRow({ delay }) {
    return (
        <div
            className="flex items-center animate-enter"
            style={{ gap: '12px', padding: '12px 14px', borderRadius: '14px', background: 'rgba(255,255,255,0.02)', animationDelay: `${delay}ms` }}
        >
            <div className="rounded-full bg-white-10 animate-pulse shrink-0" style={{ width: '38px', height: '38px' }} />
            <div className="flex flex-col flex-1" style={{ gap: '7px' }}>
                <div className="h-4 bg-white-10 rounded animate-pulse" style={{ width: '45%' }} />
                <div className="h-3 bg-white-5 rounded animate-pulse" style={{ width: '25%' }} />
            </div>
        </div>
    );
}

export default function AssetSearch({ onSelect }) {
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
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
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
        <div className="flex flex-col h-full animate-enter" style={{ maxWidth: '560px', margin: '0 auto', width: '100%' }}>
            {/* Search field */}
            <div className="search-field" style={{ marginBottom: '18px', flexShrink: 0 }}>
                <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search stocks, crypto, ETFs…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    enterKeyHint="search"
                />
                {searching ? (
                    <div className="animate-spin shrink-0" style={{ width: '15px', height: '15px', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%' }} />
                ) : query && (
                    <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0 }}
                    >
                        <X size={12} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
                {/* Before typing: popular quick-searches */}
                {showEmpty && (
                    <div className="animate-enter">
                        <span className="flex items-center gap-2" style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                            <TrendingUp size={12} />
                            Popular
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {POPULAR.map(p => (
                                <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => setQuery(p.q)}
                                    className="transition-all"
                                    style={{
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid var(--card-border)',
                                        borderRadius: '10px',
                                        padding: '8px 14px',
                                        fontSize: '0.82rem',
                                        fontWeight: 500,
                                        color: 'var(--foreground)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Loading: skeleton rows keep the layout stable */}
                {searching && results.length === 0 && (
                    <div className="flex flex-col" style={{ gap: '6px' }}>
                        {[0, 1, 2, 3].map(i => <SkeletonRow key={i} delay={i * 50} />)}
                    </div>
                )}

                {showNoMatches && (
                    <div className="flex flex-col items-center" style={{ padding: '48px 0', gap: '6px' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)' }}>No matches for &quot;{query}&quot;</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>Try a ticker symbol like AAPL or BTC</span>
                    </div>
                )}

                {results.length > 0 && (
                    <div className="flex flex-col" style={{ gap: '4px', paddingBottom: '60px' }}>
                        {results.map((item, idx) => {
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
                                <div
                                    key={item.symbol}
                                    className="flex items-center transition-all animate-enter"
                                    style={{
                                        gap: '2px',
                                        padding: '10px 12px',
                                        borderRadius: '14px',
                                        cursor: 'pointer',
                                        animationDelay: `${Math.min(idx * 30, 240)}ms`
                                    }}
                                    onClick={() => handlePick(item)}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return;
                                        event.preventDefault();
                                        handlePick(item);
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <AssetIcon symbol={item.symbol} type={item.type} size={38} />
                                    <div className="flex flex-col min-w-0 flex-1" style={{ gap: '1px' }}>
                                        <span className="truncate" style={{ fontSize: '0.92rem', fontWeight: 600, letterSpacing: '-0.01em' }}>{displayTitle}</span>
                                        <span className="truncate" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {displaySubtitle}
                                            {item.exchange && <span style={{ color: 'var(--text-faint)' }}>{'  ·  '}{item.exchange}</span>}
                                        </span>
                                    </div>
                                    <span className="shrink-0" style={{
                                        fontSize: '0.68rem',
                                        fontWeight: 600,
                                        color: 'var(--text-muted)',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid var(--card-border)',
                                        padding: '3px 9px',
                                        borderRadius: '7px',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {TYPE_LABELS[item.type] || item.type || 'Asset'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
