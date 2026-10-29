'use client';

import { apiFetch } from './api-client.js';
import { createCryptoStream, createYahooStream, cryptoBase } from './live-quotes.js';

// One set of websockets for the whole app: the dashboard and the asset sheet
// register what they show, and every listener receives the latest trade per
// symbol at most once a second. With no listener left (the app went to the
// background or the tab was hidden) every socket is closed.
const FLUSH_INTERVAL = 1000;
const REFRESH_DELAY = 100;

const owners = new Map();
const cryptoMarkets = new Map(); // coin → BitcoinWisdom market id, or null when it has no dollar market
const lookups = new Set();
let symbolsByMarket = new Map();
let yahoo = null;
let crypto = null;
let pending = new Map();
let flushTimer = null;
let refreshTimer = null;
let received = 0;
let lastTick = null;

function flush() {
    flushTimer = null;
    if (!pending.size) return;
    const ticks = pending;
    pending = new Map();
    for (const owner of owners.values()) owner.onTicks(ticks);
}

function queue(tick) {
    received++;
    lastTick = tick;
    pending.set(tick.symbol, tick);
    flushTimer ||= setTimeout(flush, FLUSH_INTERVAL);
}

function queueCrypto(ticks) {
    const time = Date.now();
    for (const [id, usdPrice] of ticks) {
        for (const symbol of symbolsByMarket.get(id) || []) {
            queue({ symbol, usdPrice, time, session: 'regular', source: 'bitcoinwisdom' });
        }
    }
}

async function lookUp(coins) {
    const missing = coins.filter(coin => !lookups.has(coin));
    if (!missing.length) return;
    missing.forEach(coin => lookups.add(coin));
    try {
        for (let offset = 0; offset < missing.length; offset += 50) {
            const batch = missing.slice(offset, offset + 50);
            const res = await apiFetch(`/api/crypto-markets?symbols=${encodeURIComponent(batch.join(','))}`);
            if (!res.ok) throw new Error(`Crypto markets responded ${res.status}`);
            const found = new Map(((await res.json()).markets || []).map(market => [market.symbol, market.id]));
            batch.forEach(coin => cryptoMarkets.set(coin, found.get(coin) ?? null));
        }
    } catch (error) {
        // Until the catalogue answers (next start of the stream), Yahoo streams these coins.
        console.warn('Crypto market lookup failed:', error.message);
        missing.forEach(coin => { if (!cryptoMarkets.has(coin)) cryptoMarkets.set(coin, null); });
    } finally {
        missing.forEach(coin => lookups.delete(coin));
        scheduleRefresh();
    }
}

function stop() {
    yahoo?.close();
    crypto?.close();
    yahoo = null;
    crypto = null;
    symbolsByMarket = new Map();
    pending = new Map();
    clearTimeout(flushTimer);
    flushTimer = null;
    // Coins with no market are looked up again next time.
    for (const [coin, id] of cryptoMarkets) if (id === null) cryptoMarkets.delete(coin);
}

function refresh() {
    refreshTimer = null;
    const entries = [...owners.values()].flatMap(owner => owner.entries);
    if (!entries.length) {
        stop();
        return;
    }

    const yahooSymbols = new Set();
    const byMarket = new Map();
    const unknown = new Set();
    for (const { symbol, crypto: isCrypto } of entries) {
        const coin = isCrypto ? cryptoBase(symbol) : null;
        if (!coin) {
            yahooSymbols.add(symbol);
        } else if (!cryptoMarkets.has(coin)) {
            unknown.add(coin);
        } else if (cryptoMarkets.get(coin) === null) {
            yahooSymbols.add(symbol);
        } else {
            const id = cryptoMarkets.get(coin);
            byMarket.set(id, [...new Set([...(byMarket.get(id) || []), symbol])]);
        }
    }
    symbolsByMarket = byMarket;

    yahoo ||= createYahooStream({ onTick: queue });
    yahoo.setSymbols([...yahooSymbols]);
    crypto ||= createCryptoStream({ onTicks: queueCrypto });
    crypto.setMarkets([...byMarket.keys()]);
    if (unknown.size) lookUp([...unknown]);
}

function scheduleRefresh() {
    // Coalesces a listener leaving and coming back (a re-render) into one change.
    if (!refreshTimer) refreshTimer = setTimeout(refresh, REFRESH_DELAY);
}

// `entries` are { symbol, crypto } with Yahoo symbols; crypto ones stream from
// BitcoinWisdom when it lists the coin. Returns the function that stops watching.
export function watchLiveQuotes(entries, onTicks) {
    if (typeof WebSocket === 'undefined' || !entries.length) return () => {};
    const token = Symbol('live-quotes');
    owners.set(token, { entries, onTicks });
    scheduleRefresh();
    return () => {
        owners.delete(token);
        scheduleRefresh();
    };
}

export function liveQuoteStatus() {
    return {
        listeners: owners.size,
        yahoo: yahoo?.status() || null,
        crypto: crypto?.status() || null,
        cryptoMarkets: Object.fromEntries(cryptoMarkets),
        received,
        lastTick
    };
}

if (typeof window !== 'undefined') window.__monetraLiveQuotes = liveQuoteStatus;
