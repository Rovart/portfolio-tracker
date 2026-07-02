'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { formatSymbol } from '@/utils/commodities';

export default function AssetSearch({ onSelect, onCancel }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (query.length < 2) {
                setResults([]);
                return;
            }
            setSearching(true);
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                setResults(data.results || []);
            } catch (err) {
                console.error(err);
            } finally {
                setSearching(false);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [query]);

    return (
        <div className="flex flex-col h-full animate-enter">
            <div style={{ marginBottom: '20px' }}>
                <div className="search-field">
                    <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input
                        type="text"
                        placeholder="Search markets..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {(searching || results.length > 0 || (query.length >= 2)) && (
                    <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-3 px-1">Results</h3>
                )}

                {searching && (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span className="text-muted text-sm font-medium">Searching markets...</span>
                    </div>
                )}

                {!searching && results.length === 0 && query.length >= 2 && (
                    <div className="text-muted text-center py-12">
                        <p className="text-sm font-medium opacity-60">No matches found for &quot;{query}&quot;</p>
                    </div>
                )}

                <div className="flex flex-col gap-2 pb-20">
                    {results.map((item) => {
                        // Handle click - convert bare currencies (EUR=X) to XXXUSD=X format
                        const handleClick = () => {
                            const transformedItem = { ...item };

                            // Detect bare currency (e.g., EUR=X where base is 3-4 chars)
                            if (item.symbol && item.symbol.endsWith('=X')) {
                                const base = item.symbol.replace('=X', '');
                                if (base.length <= 4 && base !== 'USD') {
                                    // Convert EUR=X to EURUSD=X for consistent FX handling
                                    transformedItem.symbol = `${base}USD=X`;
                                    transformedItem.displaySymbol = item.symbol; // Keep original for display
                                    transformedItem.isBareCurrencyOrigin = true; // Flag to restrict to DEPOSIT/WITHDRAW
                                } else if (base === 'USD') {
                                    // USD=X is also a bare currency
                                    transformedItem.isBareCurrencyOrigin = true;
                                }
                            }

                            onSelect(transformedItem);
                        };

                        // Determine display based on whether symbol was trimmed
                        const trimmedSymbol = formatSymbol(item.symbol, item.shortname || item.longname);
                        // Check if symbol was trimmed (has exchange/currency suffix removed)
                        const wasTrimmed = trimmedSymbol !== item.symbol;
                        // Check if symbol starts with trimmed part (B5R.F starts with B5R)
                        const isBaseSymbol = item.symbol.startsWith(trimmedSymbol) && item.symbol !== trimmedSymbol;
                        
                        let displayTitle, displaySubtitle;
                        
                        if (!wasTrimmed) {
                            // No trimming occurred (e.g., AAPL), show full name as title
                            displayTitle = item.shortname || item.longname || item.symbol;
                            displaySubtitle = item.symbol;
                        } else if (isBaseSymbol) {
                            // Was trimmed and is base+suffix (e.g., B5R.F), show full name as title, full symbol as subtitle
                            displayTitle = item.shortname || item.longname || trimmedSymbol;
                            displaySubtitle = item.symbol;
                        } else {
                            // Was trimmed but not base+suffix format (commodities, etc.)
                            displayTitle = trimmedSymbol;
                            displaySubtitle = item.shortname || item.longname || item.symbol;
                        }

                        return (
                            <div
                                key={item.symbol}
                                className="interactive-surface bg-[#171717] border border-white/5 flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 active:scale-[0.98] cursor-pointer transition-all group overflow-hidden relative"
                                onClick={handleClick}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    handleClick();
                                }}
                                role="button"
                                tabIndex={0}
                            >
                                <div className="flex flex-col min-w-0" style={{ gap: '2px' }}>
                                    <span className="font-semibold text-lg group-hover:text-white transition-colors tracking-tight">{displayTitle}</span>
                                    <span className="text-sm text-muted line-clamp-1">{displaySubtitle}</span>
                                </div>
                                <div className="flex flex-col items-end flex-shrink-0" style={{ gap: '6px' }}>
                                    <span style={{
                                        fontSize: '9.5px',
                                        fontWeight: 600,
                                        letterSpacing: '0.055em',
                                        textTransform: 'uppercase',
                                        color: 'var(--text-muted)',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid var(--card-border)',
                                        padding: '3px 8px',
                                        borderRadius: '7px',
                                        whiteSpace: 'nowrap'
                                    }}>{item.type || 'ASSET'}</span>
                                    <span style={{ fontSize: '10px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 500 }}>{item.exchange}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div >
    );
}
