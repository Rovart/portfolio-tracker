'use client';

import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

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
            <div className="mb-12 pt-6">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-6 bg-white/[0.03] rounded-[40px] px-10 py-8 focus-within:bg-white/[0.07] focus-within:ring-1 focus-within:ring-white/10 transition-all shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] overflow-hidden border border-white/5">
                        <input
                            type="text"
                            placeholder="Search markets..."
                            className="input-reset"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <h3 className="text-xs font-bold text-muted uppercase tracking-widest mb-4 px-1">Results</h3>

                {searching && (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span className="text-muted font-medium">Searching markets...</span>
                    </div>
                )}

                {!searching && results.length === 0 && query.length >= 2 && (
                    <div className="text-muted text-center py-20 bg-[#171717]/50 rounded-3xl border border-dashed border-white/5">
                        <p className="text-lg font-medium opacity-50">No matches found for "{query}"</p>
                    </div>
                )}

                <div className="flex flex-col gap-3 pb-20">
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
                                }
                            }

                            onSelect(transformedItem);
                        };

                        return (
                            <div
                                key={item.symbol}
                                className="bg-[#171717] border border-white/5 flex items-center justify-between p-5 rounded-3xl hover:bg-white/5 active:scale-[0.98] cursor-pointer transition-all group overflow-hidden relative"
                                onClick={handleClick}
                            >
                                <div className="flex flex-col min-w-0">
                                    <span className="font-bold text-xl group-hover:text-white transition-colors tracking-tight">{item.displaySymbol || item.symbol}</span>
                                    <span className="text-sm text-muted line-clamp-1">{item.shortname || item.longname}</span>
                                </div>
                                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                    <span className="text-[10px] font-bold px-2.5 py-1 bg-white/10 rounded-full text-white uppercase tracking-wider">{item.type || 'ASSET'}</span>
                                    <span className="text-xs text-muted font-medium opacity-60 uppercase">{item.exchange}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div >
    );
}
