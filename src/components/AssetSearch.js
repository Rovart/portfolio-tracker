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
        <div className="flex flex-col h-full">
            <div className="mb-6 relative">
                <div className="flex items-center gap-3 bg-[#171717] rounded-xl px-4 py-3 border border-white/5 focus-within:border-white/20 transition-all">
                    <Search className="text-muted" size={20} />
                    <input
                        type="text"
                        placeholder="Search assets..."
                        className="flex-1 bg-transparent text-lg text-white placeholder-neutral-500 outline-none font-medium"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {searching && <div className="text-muted text-center py-8">Searching...</div>}

                {!searching && results.length === 0 && query.length >= 2 && (
                    <div className="text-muted text-center py-8">No results found.</div>
                )}

                <div className="flex flex-col gap-2">
                    {results.map((item) => (
                        <div
                            key={item.symbol}
                            className="flex items-center justify-between p-4 rounded-2xl hover:bg-white/5 cursor-pointer transition-colors group"
                            onClick={() => onSelect(item)}
                        >
                            <div className="flex flex-col">
                                <span className="font-bold text-lg group-hover:text-white transition-colors">{item.symbol}</span>
                                <span className="text-sm text-muted">{item.shortname}</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-xs font-bold px-2 py-1 bg-white/5 rounded-lg text-muted">{item.type}</span>
                                <span className="text-xs text-muted mt-1">{item.exchange}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
