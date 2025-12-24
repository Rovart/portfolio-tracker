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

    // Clean symbol logic (same as frontend)
    // Remove trailing =X, =F, .X, =, .
    const cleanSym = symbol.toUpperCase().replace(/[=.](X|F)?$/, '').replace(/[=.]+$/, '');

    // Sources
    const fmpUrl = `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;
    const cryptoUrl = `https://assets.coincap.io/assets/icons/${cleanSym.toLowerCase()}@2x.png`;

    // Heuristic for Crypto
    const isCrypto = type === 'CRYPTOCURRENCY' || type === 'crypto' ||
        ['BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE'].includes(cleanSym);

    // 1. Try Financial Modeling Prep (User preference: First)
    // Cache for 7 days (604800 seconds)
    try {
        const fmpRes = await fetch(fmpUrl, { next: { revalidate: 604800 } });
        if (fmpRes.ok) {
            const buffer = await fmpRes.arrayBuffer();
            return new NextResponse(buffer, {
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=604800'
                }
            });
        }
    } catch (e) {
        // Continue to next source
    }

    // 2. Try CoinCap (if it might be crypto)
    if (isCrypto) {
        try {
            const ccRes = await fetch(cryptoUrl, { next: { revalidate: 604800 } });
            if (ccRes.ok) {
                const buffer = await ccRes.arrayBuffer();
                return new NextResponse(buffer, {
                    headers: {
                        'Content-Type': 'image/png',
                        'Cache-Control': 'public, max-age=604800'
                    }
                });
            }
        } catch (e) { }
    }

    // Return 404 if not found
    return new NextResponse('Not Found', { status: 404 });
}
