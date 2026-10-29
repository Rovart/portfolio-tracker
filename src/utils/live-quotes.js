// Live prices pushed by websockets, shared by the web app and the Capacitor
// WebView (both providers accept any Origin, so no server relay is needed).
//
// Yahoo (stocks, ETFs, FX, indices, futures): each message is JSON
// {"type":"pricing","message":"<base64>"} holding a protobuf PricingData, the
// last trade of one symbol, about two seconds behind and with US pre-market and
// after-hours. One connection serves at most 100 symbols and silently ignores
// the rest. Some exchanges (Hong Kong, most of Xetra and Paris) send nothing and
// stay on polled quotes.
//
// BitcoinWisdom (crypto): {"ok":1,"type":"tickers","tickers":[[marketId, price]]}
// for the subscribed market ids, priced in USD stablecoins.

export const YAHOO_STREAM_URL = 'wss://streamer.finance.yahoo.com/?version=2';
export const CRYPTO_STREAM_URL = 'wss://ws.bitcoinwisdom.io/index';
export const SYMBOLS_PER_CONNECTION = 100;
const MAX_CRYPTO_MARKETS = 500;
const CRYPTO_IDLE_TIMEOUT = 45000;
const MAX_RECONNECT_DELAY = 60000;
const CROSS_SOURCE_PRIORITY = 60000;

// PricingData fields used: 1 id, 2 price (float), 3 time (sint64, ms),
// 5 exchange, 7 market hours (enum), 8 change percent (float), 9 day volume
// (sint64), 12 change (float). Enums are plain varints; only sint64 are zigzag.
const ZIGZAG_FIELDS = new Set([3, 9, 14, 19, 21, 22, 24, 26, 27, 28, 29]);
const SESSIONS = ['pre', 'regular', 'post', 'post'];
const textDecoder = new TextDecoder();

export function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

// Floats carry seven significant digits: rounded to what Yahoo quotes.
const roundFloat = value => (Number.isFinite(value) ? Number(value.toPrecision(7)) : null);

export function decodePricingData(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fields = {};
    let offset = 0;
    const varint = () => {
        let value = 0;
        let scale = 1;
        let byte;
        do {
            byte = bytes[offset++];
            value += (byte & 127) * scale;
            scale *= 128;
        } while (byte & 128 && offset < bytes.length);
        return value;
    };
    while (offset < bytes.length) {
        const key = varint();
        const field = Math.floor(key / 8);
        const wire = key % 8;
        if (wire === 0) {
            const value = varint();
            fields[field] = ZIGZAG_FIELDS.has(field) ? (value % 2 ? -(value + 1) / 2 : value / 2) : value;
        } else if (wire === 5) {
            if (offset + 4 > bytes.length) break;
            fields[field] = view.getFloat32(offset, true);
            offset += 4;
        } else if (wire === 1) {
            if (offset + 8 > bytes.length) break;
            fields[field] = view.getFloat64(offset, true);
            offset += 8;
        } else if (wire === 2) {
            const length = varint();
            fields[field] = textDecoder.decode(bytes.subarray(offset, offset + length));
            offset += length;
        } else {
            break;
        }
    }
    const price = roundFloat(fields[2]);
    if (!fields[1] || !(price > 0)) return null;
    return {
        symbol: String(fields[1]).toUpperCase(),
        price,
        time: fields[3] || null,
        exchange: fields[5] || null,
        session: SESSIONS[fields[7] ?? 1] || 'regular',
        changePercent: roundFloat(fields[8]),
        change: roundFloat(fields[12]),
        dayVolume: fields[9] ?? null,
        source: 'yahoo'
    };
}

export function parseYahooMessage(data) {
    try {
        const message = JSON.parse(data);
        if (message?.type !== 'pricing' || typeof message.message !== 'string') return null;
        return decodePricingData(base64ToBytes(message.message));
    } catch {
        return null;
    }
}

export function parseCryptoMessage(data) {
    try {
        const message = typeof data === 'string' ? JSON.parse(data) : null;
        if (!message?.ok || message.type !== 'tickers' || !Array.isArray(message.tickers)) return [];
        return message.tickers
            .map(row => (Array.isArray(row) ? [Number(row[0]), Number(row[1])] : []))
            .filter(([id, price]) => Number.isSafeInteger(id) && id > 0 && Number.isFinite(price) && price > 0);
    } catch {
        return [];
    }
}

export function chunkSymbols(symbols, size = SYMBOLS_PER_CONNECTION) {
    const groups = [];
    for (let offset = 0; offset < symbols.length; offset += size) groups.push(symbols.slice(offset, offset + size));
    return groups;
}

// Groups of at most `size` symbols, one per connection. Symbols keep the group
// they already had, so adding or removing one reconnects a single connection;
// when removals leave more connections than needed, everything is regrouped.
export function assignSymbols(symbols, previous = [], size = SYMBOLS_PER_CONNECTION) {
    const wanted = [...new Set(symbols)];
    const remaining = new Set(wanted);
    const groups = previous.map(group => group.filter(symbol => remaining.delete(symbol)));
    const rest = wanted.filter(symbol => remaining.has(symbol));
    for (const group of groups) {
        while (group.length < size && rest.length) group.push(rest.shift());
    }
    groups.push(...chunkSymbols(rest, size));
    const used = groups.filter(group => group.length).length;
    return used > Math.ceil(wanted.length / size) ? chunkSymbols(wanted, size) : groups;
}

// 1 s, 2 s, 4 s ... up to a minute, with ±20 % jitter so connections that
// dropped together do not come back together.
export function reconnectDelay(attempt, random = Math.random) {
    const base = Math.min(MAX_RECONNECT_DELAY, 1000 * 2 ** attempt);
    return Math.round(base * (0.8 + random() * 0.4));
}

const defaultTimers = {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: handle => clearTimeout(handle)
};

// One websocket that reopens with a growing pause until it is closed. The pause
// only resets once a message arrives, so a server that accepts and immediately
// drops the connection is not hammered. With `idleTimeout`, a silent socket is
// treated as dead and replaced.
function keepOpen({ Socket, url, timers, random, idleTimeout = 0, onOpen, onMessage }) {
    let socket = null;
    let retry = null;
    let idle = null;
    let attempt = 0;
    let stopped = false;

    const watchIdle = ws => {
        if (!idleTimeout) return;
        timers.clear(idle);
        idle = timers.set(() => { if (socket === ws) ws.close(); }, idleTimeout);
    };
    const schedule = () => {
        if (stopped) return;
        retry = timers.set(connect, reconnectDelay(attempt++, random));
    };
    function connect() {
        retry = null;
        if (stopped) return;
        let ws;
        try {
            ws = socket = new Socket(url);
        } catch {
            socket = null;
            schedule();
            return;
        }
        watchIdle(ws);
        ws.onopen = () => { if (socket === ws) onOpen(ws); };
        ws.onmessage = event => {
            if (socket !== ws) return;
            attempt = 0;
            watchIdle(ws);
            onMessage(event.data);
        };
        ws.onerror = () => {};
        ws.onclose = () => {
            if (socket !== ws) return;
            socket = null;
            timers.clear(idle);
            schedule();
        };
    }
    connect();

    return {
        send(data) {
            if (socket?.readyState === 1) socket.send(data);
        },
        isOpen: () => socket?.readyState === 1,
        close() {
            stopped = true;
            timers.clear(retry);
            timers.clear(idle);
            const ws = socket;
            socket = null;
            ws?.close();
        }
    };
}

export function createYahooStream({
    Socket = globalThis.WebSocket,
    url = YAHOO_STREAM_URL,
    perConnection = SYMBOLS_PER_CONNECTION,
    timers = defaultTimers,
    random = Math.random,
    onTick = () => {}
} = {}) {
    let slots = [];

    const open = symbols => ({
        symbols,
        connection: keepOpen({
            Socket, url, timers, random,
            onOpen: ws => ws.send(JSON.stringify({ subscribe: symbols })),
            onMessage: data => {
                const tick = parseYahooMessage(data);
                if (tick) onTick(tick);
            }
        })
    });

    return {
        setSymbols(symbols) {
            const groups = assignSymbols(symbols, slots.map(slot => slot.symbols), perConnection);
            const next = [];
            groups.forEach((group, index) => {
                const slot = slots[index];
                if (slot && slot.symbols.join() === group.join()) {
                    if (group.length) next.push(slot);
                    return;
                }
                slot?.connection.close();
                if (group.length) next.push(open(group));
            });
            slots.slice(groups.length).forEach(slot => slot.connection.close());
            slots = next;
        },
        status: () => ({
            connections: slots.length,
            open: slots.filter(slot => slot.connection.isOpen()).length,
            symbols: slots.reduce((total, slot) => total + slot.symbols.length, 0)
        }),
        close() {
            slots.forEach(slot => slot.connection.close());
            slots = [];
        }
    };
}

export function createCryptoStream({
    Socket = globalThis.WebSocket,
    url = CRYPTO_STREAM_URL,
    timers = defaultTimers,
    random = Math.random,
    idleTimeout = CRYPTO_IDLE_TIMEOUT,
    onTicks = () => {}
} = {}) {
    let ids = [];
    let connection = null;
    const subscribe = ws => {
        ws.send(JSON.stringify({ method: 'subscriptions', list: ids }));
        ws.send('active');
    };

    return {
        setMarkets(marketIds) {
            const next = [...new Set(marketIds)].filter(Number.isSafeInteger).sort((a, b) => a - b).slice(0, MAX_CRYPTO_MARKETS);
            if (next.join() === ids.join()) return;
            ids = next;
            if (!ids.length) {
                connection?.close();
                connection = null;
            } else if (!connection) {
                connection = keepOpen({
                    Socket, url, timers, random, idleTimeout,
                    onOpen: subscribe,
                    onMessage: data => {
                        const ticks = parseCryptoMessage(data).filter(([id]) => ids.includes(id));
                        if (ticks.length) onTicks(ticks);
                    }
                });
            } else if (connection.isOpen()) {
                subscribe(connection);
            }
        },
        status: () => ({ markets: ids.length, open: !!connection?.isOpen() }),
        close() {
            connection?.close();
            connection = null;
            ids = [];
        }
    };
}

// Yahoo crypto symbols are BASE-QUOTE; ambiguous tickers carry a numeric id
// (UNI7083-USD), which BitcoinWisdom does not use.
export function cryptoBase(symbol) {
    const match = String(symbol || '').toUpperCase().match(/^([A-Z0-9]+)-[A-Z]{3,5}$/);
    if (!match) return null;
    return match[1].match(/^(.*[A-Z])\d{3,}$/)?.[1] || match[1];
}

// Prices that can stream: real Yahoo symbols, not the bare-currency aliases
// (EUR → EURUSD=X) the dashboard keeps, loans or funds priced once a day.
export function liveQuoteEntries(quotes) {
    return Object.entries(quotes || {})
        .filter(([symbol, quote]) => {
            if (!symbol || symbol === 'USD') return false;
            const type = String(quote?.quoteType || '').toUpperCase();
            if (type === 'LOAN' || type === 'MUTUALFUND') return false;
            return !(type === 'CURRENCY' && /^[A-Z]{3}$/.test(symbol));
        })
        .map(([symbol, quote]) => ({ symbol, crypto: String(quote?.quoteType || '').toUpperCase() === 'CRYPTOCURRENCY' && !!cryptoBase(symbol) }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function quoteTime(quote) {
    const time = Date.parse(quote?.marketTime ?? '');
    return Number.isFinite(time) ? time : 0;
}

function previousClose(quote) {
    const price = Number(quote?.price);
    const percent = Number(quote?.changePercent);
    const change = Number(quote?.change);
    if (price > 0 && Number.isFinite(percent) && percent > -100) return price / (1 + percent / 100);
    if (price > 0 && Number.isFinite(change)) return price - change;
    return null;
}

// Applies one streamed trade to a polled quote ({ price, change, changePercent,
// currency, marketState, preMarketPrice, ... }). The trade wins only when it is
// newer than both the quote and the last trade applied to it, so a slower poll
// never moves a price backwards. Crypto ticks come from another provider, timed
// on arrival, whose clock cannot be compared with Yahoo's: they stay on top of
// the poll while under a minute old, so the price does not flicker between the
// two sources. They come in USD (`usdPrice`) and are converted with
// `usdRate(currency)`, the USD value of one unit of the quote's currency. The
// applied trade is kept in `liveTick` to be replayed over the next poll.
export function applyLiveTick(quote, tick, usdRate = () => null, now = Date.now()) {
    if (!quote || !tick) return quote;
    const time = Number(tick.time);
    if (!Number.isFinite(time) || time <= 0) return quote;
    if (quote.liveTick?.time >= time) return quote;
    const crossSource = tick.source && tick.source !== 'yahoo';
    if (quoteTime(quote) > time && !(crossSource && now - time < CROSS_SOURCE_PRIORITY)) return quote;

    const session = tick.session || 'regular';
    const reference = Number(
        session === 'pre' ? quote.preMarketPrice || quote.price
            : session === 'post' ? quote.postMarketPrice || quote.price
                : quote.price
    );
    let price = Number(tick.price);
    let change = Number.isFinite(tick.change) ? tick.change : null;
    let changePercent = Number.isFinite(tick.changePercent) ? tick.changePercent : null;

    if (tick.usdPrice > 0) {
        const currency = String(quote.currency || 'USD').toUpperCase();
        const rate = currency === 'USD' ? 1 : Number(usdRate(currency));
        if (!(rate > 0)) return quote;
        price = tick.usdPrice / rate;
        // A coin on another chain shares its ticker: never accept a far price.
        if (reference > 0 && Math.abs(price / reference - 1) > 0.2) return quote;
        change = null;
        changePercent = null;
    }
    if (!(price > 0)) return quote;

    // London listings stream in pence while polled quotes are already in pounds.
    if (String(quote.currency || '').toUpperCase() === 'GBP' && reference > 0) {
        const ratio = price / reference;
        if (ratio > 50 && ratio < 200) {
            price /= 100;
            if (change !== null) change /= 100;
        }
    }

    const liveTick = { time, session, price, change, changePercent, source: tick.source || 'yahoo' };
    const live = { liveTick, marketTime: new Date(time).toISOString(), isStale: false };

    if (session === 'pre' || session === 'post') {
        const base = Number(quote.price);
        const percent = changePercent ?? (base > 0 ? (price / base - 1) * 100 : null);
        return session === 'pre'
            ? { ...quote, ...live, preMarketPrice: price, preMarketChangePercent: percent, marketState: 'PRE' }
            : { ...quote, ...live, postMarketPrice: price, postMarketChangePercent: percent, marketState: 'POST' };
    }

    if (change === null || changePercent === null) {
        const close = previousClose(quote);
        if (close > 0) {
            change = price - close;
            changePercent = (price / close - 1) * 100;
        }
    }
    return {
        ...quote,
        ...live,
        price,
        ...(change !== null ? { change } : {}),
        ...(changePercent !== null ? { changePercent } : {}),
        marketState: 'REGULAR'
    };
}

// Applies a batch of ticks (Map symbol → tick) to a price map, including the
// bare-currency aliases the dashboard derives from XXXUSD=X. Returns the same
// object when nothing changed, so React skips the render.
export function applyLiveTicks(prices, ticks, usdRate = () => null) {
    let next = prices;
    const update = (symbol, tick) => {
        const quote = next[symbol];
        const updated = applyLiveTick(quote, tick, usdRate);
        if (updated === quote) return;
        if (next === prices) next = { ...prices };
        next[symbol] = updated;
    };
    for (const [symbol, tick] of ticks) {
        update(symbol, tick);
        const bare = symbol.match(/^([A-Z]{3})USD=X$/)?.[1];
        if (bare && next[bare]?.quoteType === 'CURRENCY') update(bare, tick);
    }
    return next;
}

// A new poll replaces the price map, but a streamed trade newer than the poll
// (or a fresh crypto trade) stays on top of it.
export function preferLiveQuotes(polled, previous, now = Date.now()) {
    let next = polled;
    for (const [symbol, quote] of Object.entries(polled)) {
        const liveTick = previous?.[symbol]?.liveTick;
        if (!liveTick) continue;
        const updated = applyLiveTick(quote, liveTick, undefined, now);
        if (updated === quote) continue;
        if (next === polled) next = { ...polled };
        next[symbol] = updated;
    }
    return next;
}
