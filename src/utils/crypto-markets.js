// BitcoinWisdom market ids for crypto symbols, needed to subscribe to its price
// stream. The catalogue has no CORS headers, so the browser asks /api/crypto-markets
// and the native app runs the same lookup with native HTTP.
const CRYPTO_INDEX = 'https://api.bitcoinwisdom.io/api/v1/index';
const USD_QUOTES = new Set(['usd', 'usdt', 'usdc']);
export const MAX_CRYPTO_LOOKUPS = 50;

export function parseCryptoSymbols(value) {
    const symbols = [...new Set(String(value || '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean))];
    if (!symbols.length || symbols.length > MAX_CRYPTO_LOOKUPS || symbols.some(symbol => !/^[A-Z0-9]{1,15}$/.test(symbol))) return null;
    return symbols;
}

export function cryptoIndexUrl(symbol) {
    const url = new URL(CRYPTO_INDEX);
    for (const [key, value] of Object.entries({ page: '0', orderBy: 'marketCapUsd', sortOrder: 'desc', quote: 'usd', filterString: symbol })) {
        url.searchParams.set(key, value);
    }
    return url.href;
}

// The search matches substrings (BTC also finds WBTC): keep the exact coin
// priced in dollars, the best ranked when several markets share its ticker.
export function pickCryptoMarket(symbol, assets) {
    const wanted = symbol.toLowerCase();
    const market = (Array.isArray(assets) ? assets : [])
        .filter(asset => String(asset?.baseCurrency || '').toLowerCase() === wanted
            && USD_QUOTES.has(String(asset.quoteCurrency || '').toLowerCase())
            && Number.isSafeInteger(Number(asset.marketId)) && Number(asset.marketId) > 0
            && Number(asset.lastPrice) > 0)
        .sort((a, b) => (Number(a.pos) || Infinity) - (Number(b.pos) || Infinity))[0];
    if (!market) return null;
    return {
        symbol,
        id: Number(market.marketId),
        price: Number(market.lastPrice),
        quote: String(market.quoteCurrency).toUpperCase(),
        exchange: String(market.exchangeName || '')
    };
}

// `fetchJson(url)` resolves the parsed catalogue page. Coins without a dollar
// market are left out; the caller streams them from Yahoo instead.
export async function findCryptoMarkets(symbols, fetchJson) {
    const markets = [];
    let failures = 0;
    for (let offset = 0; offset < symbols.length; offset += 4) {
        const batch = await Promise.allSettled(symbols.slice(offset, offset + 4).map(async symbol => {
            const body = await fetchJson(cryptoIndexUrl(symbol));
            if (!body?.success || !Array.isArray(body.data?.assets)) throw new Error('Invalid crypto catalogue');
            return pickCryptoMarket(symbol, body.data.assets);
        }));
        for (const result of batch) {
            if (result.status === 'rejected') failures++;
            else if (result.value) markets.push(result.value);
        }
    }
    if (failures === symbols.length) throw new Error('Crypto catalogue unavailable');
    return markets;
}
