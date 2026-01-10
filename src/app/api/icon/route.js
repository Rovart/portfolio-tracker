import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const type = searchParams.get('type');

    if (!symbol) return new NextResponse('Missing symbol', { status: 400 });

    // Security: Prevent path traversal
    if (symbol.includes('..') || symbol.includes('/') || symbol.includes('\\')) {
        return new NextResponse('Invalid symbol', { status: 400 });
    }

    // Clean symbol logic - remove trailing =X, =F, .X, =, .
    let cleanSym = symbol.toUpperCase().replace(/[=.](X|F)?$/, '').replace(/[=.]+$/, '');

    // Check if it's a crypto trading pair (e.g., ETH-EUR, BTC-USD)
    // Extract base symbol for crypto pairs
    let baseCryptoSym = null;
    if (cleanSym.includes('-')) {
        const parts = cleanSym.split('-');
        // The first part is typically the crypto (ETH-EUR -> ETH)
        baseCryptoSym = parts[0];
    }

    // Common cryptocurrencies for detection
    const COMMON_CRYPTO = [
        'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT',
        'MATIC', 'LINK', 'LTC', 'UNI', 'AVAX', 'SHIB', 'ATOM', 'TRX', 'ETC', 'XLM',
        'NEAR', 'APT', 'ARB', 'OP', 'FIL', 'ALGO', 'VET', 'ICP', 'AAVE', 'MKR',
        'GRT', 'SNX', 'CRV', 'LDO', 'SAND', 'MANA', 'AXS', 'FLOW', 'CHZ', 'ENJ',
        'XMR', 'DASH', 'ZEC', 'BCH', 'EOS', 'NEO', 'IOTA', 'COMP', 'YFI', 'SUSHI',
        'PEPE', 'WIF', 'BONK', 'FLOKI', 'RENDER', 'FET', 'INJ', 'SUI', 'SEI', 'TIA'
    ];

    // Determine if this is a crypto asset
    const isCrypto = type === 'CRYPTOCURRENCY' || type === 'crypto' ||
        COMMON_CRYPTO.includes(cleanSym) ||
        (baseCryptoSym && COMMON_CRYPTO.includes(baseCryptoSym));

    // Use base symbol for crypto lookups if it's a trading pair
    const cryptoLookupSym = baseCryptoSym || cleanSym;

    // Sources
    const fmpUrl = `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;
    const cryptoUrl = `https://assets.coincap.io/assets/icons/${cryptoLookupSym.toLowerCase()}@2x.png`;
    const cryptoCompareUrl = `https://www.cryptocompare.com/media/37746238/${cryptoLookupSym.toLowerCase()}.png`;

    // For crypto assets, try crypto sources FIRST
    if (isCrypto) {
        // Try CoinCap first
        try {
            const ccRes = await fetch(cryptoUrl, { next: { revalidate: 604800 } });
            if (ccRes.ok) {
                const contentType = ccRes.headers.get('content-type');
                if (contentType && contentType.includes('image')) {
                    const buffer = await ccRes.arrayBuffer();
                    return new NextResponse(buffer, {
                        headers: {
                            'Content-Type': 'image/png',
                            'Cache-Control': 'public, max-age=604800'
                        }
                    });
                }
            }
        } catch (e) { }

        // Try CryptoCompare as fallback for crypto
        try {
            const ccpRes = await fetch(cryptoCompareUrl, { next: { revalidate: 604800 } });
            if (ccpRes.ok) {
                const contentType = ccpRes.headers.get('content-type');
                if (contentType && contentType.includes('image')) {
                    const buffer = await ccpRes.arrayBuffer();
                    return new NextResponse(buffer, {
                        headers: {
                            'Content-Type': 'image/png',
                            'Cache-Control': 'public, max-age=604800'
                        }
                    });
                }
            }
        } catch (e) { }
    }

    // Try Financial Modeling Prep (stocks, ETFs, etc.)
    // Skip FMP for crypto pairs to avoid wrong logos
    if (!isCrypto) {
        try {
            const fmpRes = await fetch(fmpUrl, { next: { revalidate: 604800 } });
            if (fmpRes.ok) {
                const contentType = fmpRes.headers.get('content-type');
                if (contentType && contentType.includes('image')) {
                    const buffer = await fmpRes.arrayBuffer();
                    // Make sure the image is not a tiny placeholder (at least 1KB)
                    if (buffer.byteLength > 1000) {
                        return new NextResponse(buffer, {
                            headers: {
                                'Content-Type': 'image/png',
                                'Cache-Control': 'public, max-age=604800'
                            }
                        });
                    }
                }
            }
        } catch (e) { }
    }

    // For non-crypto that failed FMP, try CoinCap as last resort (might be unlisted crypto)
    if (!isCrypto) {
        try {
            const ccRes = await fetch(cryptoUrl, { next: { revalidate: 604800 } });
            if (ccRes.ok) {
                const contentType = ccRes.headers.get('content-type');
                if (contentType && contentType.includes('image')) {
                    const buffer = await ccRes.arrayBuffer();
                    return new NextResponse(buffer, {
                        headers: {
                            'Content-Type': 'image/png',
                            'Cache-Control': 'public, max-age=604800'
                        }
                    });
                }
            }
        } catch (e) { }
    }

    // Return 404 if not found
    return new NextResponse('Not Found', { status: 404 });
}
