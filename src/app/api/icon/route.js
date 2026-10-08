import { NextResponse } from 'next/server';
import { getIconSources } from '@/utils/icon-data';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const type = searchParams.get('type');
    if (!symbol) return new NextResponse('Missing symbol', { status: 400 });
    const sources = getIconSources(symbol, type);
    if (!sources.length) return new NextResponse('Invalid symbol', { status: 400 });
    for (const url of sources) {
        try {
            const response = await fetch(url, { next: { revalidate: 604800 } });
            if (!response.ok || !response.headers.get('content-type')?.includes('image')) continue;
            const buffer = await response.arrayBuffer();
            if (url.includes('financialmodelingprep.com') && buffer.byteLength <= 1000) continue;
            return new NextResponse(buffer, { headers: {
                'Content-Type': response.headers.get('content-type'),
                'Cache-Control': 'public, max-age=604800'
            } });
        } catch { /* Try the next logo source. */ }
    }
    return new NextResponse('Not Found', { status: 404 });
}
