'use client';

import { useEffect, useState } from 'react';
import { initializeBundledStorage } from '@/utils/legacy-storage';

export default function StorageReady({ children }) {
    const [ready, setReady] = useState(process.env.NEXT_PUBLIC_BUNDLED_APP !== 'true');
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        initializeBundledStorage().then(() => {
            if (!cancelled) setReady(true);
        }).catch(() => {
            if (!cancelled) setFailed(true);
        });
        return () => { cancelled = true; };
    }, [attempt]);

    if (ready) return children;
    return <div className="flex flex-col items-center justify-center gap-4" style={{ minHeight: '100vh' }} role="status">
        <p>{failed ? 'Unable to load your saved portfolios.' : 'Loading your saved portfolios…'}</p>
        {failed && <button className="btn" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry</button>}
    </div>;
}
