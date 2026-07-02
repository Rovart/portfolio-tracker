import { NextResponse } from 'next/server';

// Watch-only wallet balance lookup. No API keys required:
// - BTC: mempool.space public REST API
// - ETH: Cloudflare's public Ethereum JSON-RPC gateway
const BTC_ADDRESS_REGEX = /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,40})$/;
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

async function fetchBtcBalance(address) {
    const res = await fetch(`https://mempool.space/api/address/${address}`, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 60 }
    });
    if (!res.ok) throw new Error(`mempool.space responded ${res.status}`);
    const data = await res.json();
    const chain = data.chain_stats || {};
    const mempool = data.mempool_stats || {};
    const sats = (chain.funded_txo_sum || 0) - (chain.spent_txo_sum || 0)
        + (mempool.funded_txo_sum || 0) - (mempool.spent_txo_sum || 0);
    return sats / 1e8;
}

async function fetchEthBalance(address) {
    const res = await fetch('https://cloudflare-eth.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBalance',
            params: [address, 'latest'],
            id: 1
        }),
        next: { revalidate: 60 }
    });
    if (!res.ok) throw new Error(`cloudflare-eth responded ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'RPC error');
    // Hex wei -> ETH. Number precision is fine for display purposes.
    return Number(BigInt(data.result)) / 1e18;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const chain = (searchParams.get('chain') || '').toUpperCase();
    const address = (searchParams.get('address') || '').trim();

    if (!chain || !address) {
        return NextResponse.json({ error: 'chain and address are required' }, { status: 400 });
    }

    try {
        let balance;
        if (chain === 'BTC') {
            if (!BTC_ADDRESS_REGEX.test(address)) {
                return NextResponse.json({ error: 'Invalid Bitcoin address' }, { status: 400 });
            }
            balance = await fetchBtcBalance(address);
        } else if (chain === 'ETH') {
            if (!ETH_ADDRESS_REGEX.test(address)) {
                return NextResponse.json({ error: 'Invalid Ethereum address' }, { status: 400 });
            }
            balance = await fetchEthBalance(address);
        } else {
            return NextResponse.json({ error: `Unsupported chain: ${chain}` }, { status: 400 });
        }

        const response = NextResponse.json({ chain, address, balance });
        response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        return response;
    } catch (error) {
        console.error('Wallet balance error:', error);
        return NextResponse.json({ error: 'Failed to fetch wallet balance' }, { status: 502 });
    }
}
