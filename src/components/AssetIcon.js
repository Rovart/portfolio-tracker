import Image from 'next/image';
import { useState, useMemo, memo } from 'react';

const COMMON_FIAT = ['USD', 'EUR', 'AUD', 'GBP', 'JPY', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD', 'MXN', 'SGD', 'INR', 'BRL', 'RUB'];

const AssetIcon = memo(function AssetIcon({ symbol, type, isFiat, size = 40, className = "" }) {
    const imageKey = `${symbol || ''}|${type || ''}`;
    const [imageErrorKey, setImageErrorKey] = useState(null);

    // Clean symbol for icon lookup and display
    // Removes trailing =X, =F, .X, =, . and other common suffixes
    const cleanSym = useMemo(() => {
        if (!symbol) return '';
        // regex: match [= or .] followed optionally by X or F, at the end
        // This handles: =X, =F, .X, .F, =, .
        return symbol.toUpperCase().replace(/[=.](X|F)?$/, '').replace(/[=.]+$/, '');
    }, [symbol]);

    // Check if it's a currency based on prop or name
    const shouldSkipLogo = useMemo(() => {
        return isFiat || COMMON_FIAT.includes(cleanSym);
    }, [isFiat, cleanSym]);

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

    const iconSrc = !shouldSkipLogo && symbol && imageErrorKey !== imageKey
        ? `/api/icon?symbol=${encodeURIComponent(symbol)}&type=${type || ''}`
        : null;

    // Skip logo and show initials if it's a fiat currency or image failed
    if (iconSrc) {
        return (
            <div
                className={`relative shrink-0 rounded-full overflow-hidden ${className}`}
                style={{ width: size, height: size, backgroundColor: '#262626', marginRight: '10px' }}
            >
                <Image
                    src={iconSrc}
                    alt={cleanSym}
                    width={size}
                    height={size}
                    unoptimized
                    style={{ objectFit: 'contain' }}
                    onError={() => setImageErrorKey(imageKey)}
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
});

export default AssetIcon;
