import Image from 'next/image';
import { apiUrl } from '@/utils/api-client';
import { getIconSources } from '@/utils/icon-data';
import { useState, useMemo, memo } from 'react';
import { Landmark } from 'lucide-react';

const COMMON_FIAT = ['USD', 'EUR', 'AUD', 'GBP', 'JPY', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD', 'MXN', 'SGD', 'INR', 'BRL', 'RUB'];

const AssetIcon = memo(function AssetIcon({ symbol, type, isFiat, size = 40, className = "" }) {
    const imageKey = `${symbol || ''}|${type || ''}`;
    const [imageError, setImageError] = useState({ key: null, index: 0 });

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

    // Determine initials (max 3 chars)
    // Take raw symbol first 3 chars, then remove punctuation like . or =
    const initials = useMemo(() => {
        let s = (symbol || '?').substring(0, 3).toUpperCase();
        return s.replace(/[=.]/g, '');
    }, [symbol]);

    const imageIndex = imageError.key === imageKey ? imageError.index : 0;

    if (type === 'LOAN') {
        return (
            <div className={`asset-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true">
                <Landmark size={Math.round(size * 0.46)} />
            </div>
        );
    }

    const sources = process.env.NEXT_PUBLIC_BUNDLED_APP === 'true'
        ? getIconSources(symbol, type)
        : [apiUrl(`/api/icon?symbol=${encodeURIComponent(symbol || '')}&type=${encodeURIComponent(type || '')}`)];
    const iconSrc = !shouldSkipLogo && symbol ? sources[imageIndex] : null;

    // Skip logo and show initials if it's a fiat currency or image failed
    if (iconSrc) {
        return (
            <div className={`asset-icon has-logo ${className}`} style={{ width: size, height: size }}>
                <Image
                    src={iconSrc}
                    alt={cleanSym}
                    width={size}
                    height={size}
                    unoptimized
                    style={{ objectFit: 'contain' }}
                    onError={() => setImageError({ key: imageKey, index: imageIndex + 1 })}
                />
            </div>
        );
    }

    // Neutral monogram when there is no logo.
    return (
        <div className={`asset-icon ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.3) }} aria-hidden="true">
            {initials}
        </div>
    );
});

export default AssetIcon;
