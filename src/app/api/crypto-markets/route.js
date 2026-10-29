import { findCryptoMarkets, parseCryptoSymbols } from '@/utils/crypto-markets';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const symbols = parseCryptoSymbols(new URL(request.url).searchParams.get('symbols'));
    if (!symbols) {
        return NextResponse.json({ error: 'Invalid symbol list' }, { status: 400 });
    }

    try {
        const markets = await findCryptoMarkets(symbols, async url => {
            const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
            if (!res.ok) throw new Error(`BitcoinWisdom responded ${res.status}`);
            return res.json();
        });
        const response = NextResponse.json({ markets, source: 'bitcoinwisdom' });
        // Market ids rarely change: cache for a day at the edge.
        response.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
        return response;
    } catch (error) {
        console.error('Crypto markets error:', error);
        return NextResponse.json({ error: 'Crypto markets unavailable' }, { status: 502 });
    }
}
