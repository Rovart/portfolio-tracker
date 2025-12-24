import { useState, useMemo, useEffect } from 'react';

export default function AssetIcon({ symbol, type, size = 40, className = "" }) {
    const [iconSrc, setIconSrc] = useState(null);
    const [imageError, setImageError] = useState(false);
    const [loading, setLoading] = useState(true);

    // Clean symbol for icon lookup and display
    // Removes trailing =X, =F, .X, =, . and other common suffixes
    const cleanSym = useMemo(() => {
        if (!symbol) return '';
        // regex: match [= or .] followed optionally by X or F, at the end
        // This handles: =X, =F, .X, .F, =, .
        return symbol.toUpperCase().replace(/[=.](X|F)?$/, '').replace(/[=.]+$/, '');
    }, [symbol]);

    // Generate a consistent gradient based on the clean symbol
    const gradient = useMemo(() => {
        let hash = 0;
        const str = cleanSym || 'A';
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        return `linear-gradient(135deg, hsl(${hue}, 65%, 50%), hsl(${hue}, 75%, 40%))`;
    }, [cleanSym]);

    // Determine initials (max 3 chars)
    // Take raw symbol first 3 chars, then remove punctuation like . or =
    const initials = useMemo(() => {
        let s = (symbol || '?').substring(0, 3).toUpperCase();
        return s.replace(/[=.]/g, '');
    }, [symbol]);

    // Fetch icon via API to avoid console errors
    useEffect(() => {
        if (!symbol) {
            setLoading(false);
            return;
        }

        let active = true;
        setLoading(true);
        setImageError(false);
        setIconSrc(null);

        const url = `/api/icon?symbol=${encodeURIComponent(symbol)}&type=${type || ''}`;

        fetch(url)
            .then(res => {
                if (!active) return;
                if (res.ok) {
                    res.blob().then(blob => {
                        if (!active) return;
                        const objectUrl = URL.createObjectURL(blob);
                        setIconSrc(objectUrl);
                        setLoading(false);
                    });
                } else {
                    setImageError(true);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (active) {
                    setImageError(true);
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [symbol, type]);

    // Cleanup object URL when iconSrc changes
    useEffect(() => {
        return () => {
            if (iconSrc) URL.revokeObjectURL(iconSrc);
        };
    }, [iconSrc]);

    // Show skeleton while loading
    if (loading) {
        return (
            <div
                className={`shrink-0 rounded-full animate-pulse ${className}`}
                style={{
                    width: size,
                    height: size,
                    marginRight: '10px',
                    backgroundColor: 'rgba(255,255,255,0.2)'
                }}
            />
        );
    }

    if (iconSrc && !imageError) {
        return (
            <div
                className={`relative shrink-0 rounded-full overflow-hidden ${className}`}
                style={{ width: size, height: size, backgroundColor: '#262626', marginRight: '10px' }}
            >
                <img
                    src={iconSrc}
                    alt={cleanSym}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                />
            </div>
        );
    }

    return (
        <div
            className={`shrink-0 rounded-full flex items-center justify-center font-bold text-white shadow-lg ${className}`}
            style={{
                width: size,
                height: size,
                background: gradient,
                fontSize: size * 0.35,
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                marginRight: '10px'
            }}
        >
            {initials}
        </div>
    );
}
