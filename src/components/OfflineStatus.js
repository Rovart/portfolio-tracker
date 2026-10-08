'use client';

import { useEffect, useState } from 'react';

export default function OfflineStatus() {
    const [offline, setOffline] = useState(false);
    const [savedSources, setSavedSources] = useState(() => new Set());
    useEffect(() => {
        const disconnected = () => setOffline(true);
        const connected = () => setOffline(false);
        const marketStatus = event => {
            const { url, saved } = event.detail;
            setSavedSources(current => {
                if (current.has(url) === saved) return current;
                const updated = new Set(current);
                if (saved) updated.add(url);
                else updated.delete(url);
                return updated;
            });
        };
        if (!navigator.onLine) disconnected();
        window.addEventListener('offline', disconnected);
        window.addEventListener('online', connected);
        window.addEventListener('monetra:market-status', marketStatus);
        return () => {
            window.removeEventListener('offline', disconnected);
            window.removeEventListener('online', connected);
            window.removeEventListener('monetra:market-status', marketStatus);
        };
    }, []);
    if (!offline && savedSources.size === 0) return null;
    return <div role="status" style={{ textAlign: 'center', padding: '8px 16px', fontSize: '0.75rem', color: 'var(--muted)', background: 'var(--card-bg)' }}>
        {savedSources.size > 0 ? 'Saved market data · prices may be out of date' : 'Offline · connect to update market prices'}
    </div>;
}
