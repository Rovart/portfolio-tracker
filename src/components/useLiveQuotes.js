'use client';

import { useEffect, useRef } from 'react';
import { watchLiveQuotes } from '@/utils/live-quotes-client';

// Streams prices for `entries` ({ symbol, crypto }) while `enabled`, calling
// `onTicks(Map symbol → tick)` at most once a second. Only a change in the
// symbols themselves reconnects.
export default function useLiveQuotes(entries, enabled, onTicks) {
    const handler = useRef(onTicks);
    useEffect(() => {
        handler.current = onTicks;
    }, [onTicks]);

    const key = entries.map(entry => `${entry.symbol}${entry.crypto ? '*' : ''}`).join(',');
    useEffect(() => {
        if (!enabled || !key) return undefined;
        const list = key.split(',').map(item => ({ symbol: item.replace(/\*$/, ''), crypto: item.endsWith('*') }));
        return watchLiveQuotes(list, ticks => handler.current(ticks));
    }, [enabled, key]);
}
