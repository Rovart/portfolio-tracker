import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    applyLiveTick,
    applyLiveTicks,
    assignSymbols,
    chunkSymbols,
    createCryptoStream,
    createYahooStream,
    cryptoBase,
    decodePricingData,
    liveQuoteEntries,
    parseCryptoMessage,
    parseYahooMessage,
    preferLiveQuotes,
    reconnectDelay
} from '../src/utils/live-quotes.js';
import { findCryptoMarkets, parseCryptoSymbols, pickCryptoMarket } from '../src/utils/crypto-markets.js';
import { createNativeMarketApi } from '../src/utils/native-market.js';
import { withLivePoint } from '../src/utils/chart-data.js';

// Messages captured from wss://streamer.finance.yahoo.com on 29 Oct 2026.
const EURUSD_REGULAR = 'CghFVVJVU0Q9WBWalI4/GLDTlu6waCoDQ0NZMA44AUXGwO69ZQBoqrrYAQj1AgBoqrr9AsbA7r0=';
const SAN_MC_REGULAR = 'CgZTQU4uTUMVexQmQRig1ajtsGgqA01DRTAIOAFFBrugv0i23poHZQArB76wAdwB2AEE9QIAKwe+/QIGu6C/';
const NVDA_PRE = 'CgROVkRBFaT/VUMYgO687rBoKgNOTVMwCDgARZ0xJL9lANKwv9gBBPUCANKwv/0CnTEkvw==';
const VOD_L_PENCE = 'CgVWT0QuTBUAAO1CGKDgzu2waCoDTFNFMAg4AUUw3WQ/SMLjb2WAZoY/sAGoAdgBBPUCgGaGP/0CMN1kPw==';
const message = base64 => JSON.stringify({ type: 'pricing', message: base64 });

// Minimal protobuf writer for synthetic PricingData messages.
function varint(value) {
    const bytes = [];
    let rest = value;
    while (rest >= 128) {
        bytes.push((rest % 128) | 128);
        rest = Math.floor(rest / 128);
    }
    bytes.push(rest);
    return bytes;
}
const zigzag = value => (value < 0 ? -value * 2 - 1 : value * 2);
function encodePricing({ id, price, time, session, changePercent, change, volume }) {
    const bytes = [];
    const text = [...new TextEncoder().encode(id)];
    bytes.push(0x0a, ...varint(text.length), ...text);
    const float = (field, value) => {
        const buffer = new DataView(new ArrayBuffer(4));
        buffer.setFloat32(0, value, true);
        bytes.push(field * 8 + 5, ...new Uint8Array(buffer.buffer));
    };
    if (price !== undefined) float(2, price);
    if (time !== undefined) bytes.push(3 * 8, ...varint(zigzag(time)));
    if (session !== undefined) bytes.push(7 * 8, ...varint(session));
    if (changePercent !== undefined) float(8, changePercent);
    if (volume !== undefined) bytes.push(9 * 8, ...varint(zigzag(volume)));
    if (change !== undefined) float(12, change);
    return new Uint8Array(bytes);
}

class FakeSocket {
    static instances = [];
    constructor(url) {
        this.url = url;
        this.sent = [];
        this.readyState = 0;
        FakeSocket.instances.push(this);
    }
    send(data) { this.sent.push(data); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({ code: 1000 });
    }
}

function fakeTimers() {
    let now = 0;
    let lastId = 0;
    const tasks = new Map();
    return {
        set(callback, delay) { tasks.set(++lastId, { callback, at: now + delay }); return lastId; },
        clear(id) { tasks.delete(id); },
        advance(ms) {
            const target = now + ms;
            for (;;) {
                const [id, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0] || [];
                if (!task || task.at > target) break;
                tasks.delete(id);
                now = task.at;
                task.callback();
            }
            now = target;
        },
        delays: () => [...tasks.values()].map(task => task.at - now)
    };
}

const symbols = count => Array.from({ length: count }, (_, index) => `S${String(index).padStart(3, '0')}`);
const subscribed = socket => JSON.parse(socket.sent[0]).subscribe;

test('real Yahoo messages decode: regular FX, delayed Madrid trade with volume, pre-market, London pence', () => {
    assert.deepEqual(parseYahooMessage(message(EURUSD_REGULAR)), {
        symbol: 'EURUSD=X', price: 1.11391, time: 1793264375000, exchange: 'CCY', session: 'regular',
        changePercent: -0.1165786, change: -0.001300097, dayVolume: null, source: 'yahoo'
    });
    const san = parseYahooMessage(message(SAN_MC_REGULAR));
    assert.equal(san.symbol, 'SAN.MC');
    assert.equal(san.price, 10.38);
    assert.equal(san.dayVolume, 7559067);
    assert.equal(san.exchange, 'MCE');
    const nvda = parseYahooMessage(message(NVDA_PRE));
    assert.equal(nvda.symbol, 'NVDA');
    assert.equal(nvda.session, 'pre');
    assert.equal(nvda.time, 1793264688000);
    assert.equal(nvda.price, 213.9986);
    assert.ok(nvda.changePercent < 0 && nvda.change < 0);
    const vod = parseYahooMessage(message(VOD_L_PENCE));
    assert.equal(vod.symbol, 'VOD.L');
    assert.equal(vod.price, 118.5);
});

test('the decoder unzigzags only sint64 fields and reads enums, including an explicit zero, as plain varints', () => {
    const post = decodePricingData(encodePricing({ id: 'aapl', price: 230.25, time: 1793300000123, session: 2, changePercent: 1.5, change: -3.25, volume: 123456789 }));
    assert.deepEqual(
        { symbol: post.symbol, price: post.price, time: post.time, session: post.session, changePercent: post.changePercent, change: post.change, dayVolume: post.dayVolume },
        { symbol: 'AAPL', price: 230.25, time: 1793300000123, session: 'post', changePercent: 1.5, change: -3.25, dayVolume: 123456789 }
    );
    assert.equal(decodePricingData(encodePricing({ id: 'X', price: 1, time: 1, session: 0 })).session, 'pre');
    assert.equal(decodePricingData(encodePricing({ id: 'X', price: 1, time: 1, session: 3 })).session, 'post');
    assert.equal(decodePricingData(encodePricing({ id: 'X', price: 1, time: 1 })).session, 'regular');
    assert.equal(decodePricingData(encodePricing({ id: 'X', price: 1, time: -5 })).time, -5);
});

test('malformed or unpriced messages are ignored instead of throwing', () => {
    assert.equal(decodePricingData(encodePricing({ id: 'X', price: 0, time: 1 })), null);
    assert.equal(decodePricingData(encodePricing({ id: 'X', time: 1 })), null);
    const truncated = encodePricing({ id: 'AAPL', price: 10, time: 1, changePercent: 2 });
    assert.doesNotThrow(() => decodePricingData(truncated.subarray(0, truncated.length - 2)));
    assert.equal(parseYahooMessage('not json'), null);
    assert.equal(parseYahooMessage(JSON.stringify({ type: 'heartbeat' })), null);
    assert.equal(parseYahooMessage(JSON.stringify({ type: 'pricing', message: '%%%' })), null);
});

test('BitcoinWisdom tickers keep only valid market ids and positive prices', () => {
    assert.deepEqual(parseCryptoMessage(JSON.stringify({ ok: 1, type: 'tickers', tickers: [[256, 80059.53], [12260, '79915.19'], [0, 5], [7, -1], ['x', 2], 'bad'] })),
        [[256, 80059.53], [12260, 79915.19]]);
    assert.deepEqual(parseCryptoMessage(JSON.stringify({ ok: 0, type: 'tickers', tickers: [[1, 2]] })), []);
    assert.deepEqual(parseCryptoMessage('{'), []);
});

test('symbols split into connections of at most 100, keeping groups stable as the list changes', () => {
    assert.deepEqual(chunkSymbols(symbols(250)).map(group => group.length), [100, 100, 50]);
    assert.deepEqual(chunkSymbols([]), []);

    const first = assignSymbols(symbols(250));
    assert.deepEqual(first.map(group => group.length), [100, 100, 50]);
    assert.deepEqual(first.flat().sort(), symbols(250));

    // A new symbol fills the group with room; the full ones are untouched.
    const added = assignSymbols([...symbols(250), 'NEW'], first);
    assert.deepEqual(added.slice(0, 2), first.slice(0, 2));
    assert.deepEqual(added[2], [...first[2], 'NEW']);

    // A removal only changes its own group, which stays in place.
    const removed = assignSymbols(symbols(250).filter(symbol => symbol !== 'S005'), first);
    assert.deepEqual(removed[1], first[1]);
    assert.deepEqual(removed[0], first[0].filter(symbol => symbol !== 'S005'));

    // Removals that leave more connections than needed regroup everything.
    const shrunk = assignSymbols([...first[0].slice(0, 40), ...first[1].slice(0, 40), ...first[2].slice(0, 10)], first);
    assert.deepEqual(shrunk.map(group => group.length), [90]);
});

test('the Yahoo stream opens one subscription per 100 symbols and only reconnects the group that changed', () => {
    FakeSocket.instances = [];
    const timers = fakeTimers();
    const ticks = [];
    const stream = createYahooStream({ Socket: FakeSocket, timers, random: () => 0.5, onTick: tick => ticks.push(tick) });
    stream.setSymbols(symbols(250));
    assert.equal(FakeSocket.instances.length, 3);
    FakeSocket.instances.forEach(socket => socket.open());
    assert.deepEqual(FakeSocket.instances.map(socket => subscribed(socket).length), [100, 100, 50]);
    assert.deepEqual(FakeSocket.instances.flatMap(subscribed).sort(), symbols(250));
    assert.ok(FakeSocket.instances.every(socket => socket.url === 'wss://streamer.finance.yahoo.com/?version=2'));
    assert.deepEqual(stream.status(), { connections: 3, open: 3, symbols: 250 });

    FakeSocket.instances[0].receive(message(EURUSD_REGULAR));
    assert.equal(ticks[0].symbol, 'EURUSD=X');

    stream.setSymbols([...symbols(250), 'AAPL']);
    assert.equal(FakeSocket.instances.length, 4);
    assert.equal(FakeSocket.instances[2].readyState, 3);
    assert.ok(FakeSocket.instances.slice(0, 2).every(socket => socket.readyState === 1));
    FakeSocket.instances[3].open();
    assert.deepEqual(subscribed(FakeSocket.instances[3]), [...symbols(250).slice(200), 'AAPL']);

    stream.setSymbols(symbols(250).slice(0, 100));
    assert.equal(FakeSocket.instances[1].readyState, 3);
    assert.equal(FakeSocket.instances[3].readyState, 3);
    assert.deepEqual(stream.status(), { connections: 1, open: 1, symbols: 100 });
    stream.close();
    assert.ok(FakeSocket.instances.every(socket => socket.readyState === 3));
    assert.deepEqual(timers.delays(), [], 'closing schedules no reconnection');
});

test('dropped connections come back with a growing, jittered pause that resets once data flows', () => {
    assert.deepEqual([0, 1, 2, 3, 10].map(attempt => reconnectDelay(attempt, () => 0.5)), [1000, 2000, 4000, 8000, 60000]);
    assert.equal(reconnectDelay(0, () => 0), 800);
    assert.equal(reconnectDelay(0, () => 1), 1200);

    FakeSocket.instances = [];
    const timers = fakeTimers();
    const stream = createYahooStream({ Socket: FakeSocket, timers, random: () => 0.5 });
    stream.setSymbols(['AAPL']);
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop();
    assert.deepEqual(timers.delays(), [1000]);
    timers.advance(1000);
    assert.equal(FakeSocket.instances.length, 2);
    FakeSocket.instances[1].drop();
    assert.deepEqual(timers.delays(), [2000]);
    timers.advance(2000);
    FakeSocket.instances[2].open();
    assert.deepEqual(subscribed(FakeSocket.instances[2]), ['AAPL'], 'a new connection subscribes again');
    FakeSocket.instances[2].receive(message(NVDA_PRE));
    FakeSocket.instances[2].drop();
    assert.deepEqual(timers.delays(), [1000], 'a message resets the pause');
    stream.close();
    assert.deepEqual(timers.delays(), []);
});

test('the crypto stream subscribes market ids, resubscribes in place and replaces a silent socket', () => {
    FakeSocket.instances = [];
    const timers = fakeTimers();
    const received = [];
    const stream = createCryptoStream({ Socket: FakeSocket, timers, random: () => 0.5, onTicks: ticks => received.push(...ticks) });
    stream.setMarkets([258, 256, 256]);
    const socket = FakeSocket.instances[0];
    assert.equal(socket.url, 'wss://ws.bitcoinwisdom.io/index');
    socket.open();
    assert.deepEqual(socket.sent, [JSON.stringify({ method: 'subscriptions', list: [256, 258] }), 'active']);
    socket.receive(JSON.stringify({ ok: 1, type: 'tickers', tickers: [[256, 80000], [999, 1]] }));
    assert.deepEqual(received, [[256, 80000]]);

    stream.setMarkets([256, 258, 6128]);
    assert.equal(FakeSocket.instances.length, 1, 'a change reuses the open socket');
    assert.deepEqual(socket.sent.slice(2), [JSON.stringify({ method: 'subscriptions', list: [256, 258, 6128] }), 'active']);

    timers.advance(45000);
    assert.equal(socket.readyState, 3, 'no message for 45 s closes the socket');
    timers.advance(1000);
    assert.equal(FakeSocket.instances.length, 2);
    FakeSocket.instances[1].open();
    assert.deepEqual(JSON.parse(FakeSocket.instances[1].sent[0]).list, [256, 258, 6128]);

    stream.setMarkets([]);
    assert.equal(FakeSocket.instances[1].readyState, 3);
    assert.deepEqual(timers.delays(), []);
});

test('regular, pre-market and after-hours trades move the matching quote fields', () => {
    const quote = { symbol: 'NVDA', price: 200, changePercent: 1, currency: 'USD', marketState: 'CLOSED', marketTime: '2026-10-28T20:00:00.000Z' };
    const pre = applyLiveTick(quote, { symbol: 'NVDA', price: 198, changePercent: -1, change: -2, session: 'pre', time: Date.parse('2026-10-29T08:57:42Z') });
    assert.equal(pre.price, 200, 'the regular price stays the previous close');
    assert.equal(pre.preMarketPrice, 198);
    assert.equal(pre.preMarketChangePercent, -1);
    assert.equal(pre.marketState, 'PRE');
    assert.equal(pre.marketTime, '2026-10-29T08:57:42.000Z');
    assert.equal(pre.isStale, false);

    const regular = applyLiveTick(pre, { price: 205, change: 5, changePercent: 2.5, session: 'regular', time: Date.parse('2026-10-29T13:31:00Z') });
    assert.deepEqual([regular.price, regular.change, regular.changePercent, regular.marketState], [205, 5, 2.5, 'REGULAR']);

    const post = applyLiveTick(regular, { price: 210, session: 'post', time: Date.parse('2026-10-29T20:30:00Z') });
    assert.equal(post.postMarketPrice, 210);
    assert.ok(Math.abs(post.postMarketChangePercent - (210 / 205 - 1) * 100) < 1e-9, 'missing percent is measured from the close');
    assert.equal(post.marketState, 'POST');
});

test('older trades never move a price backwards, and a newer poll wins over an older trade', () => {
    const quote = { price: 100, changePercent: 0, currency: 'USD', marketTime: '2026-10-29T14:00:00.000Z' };
    assert.equal(applyLiveTick(quote, { price: 90, session: 'regular', time: Date.parse('2026-10-29T13:59:59Z') }), quote);
    const live = applyLiveTick(quote, { price: 101, session: 'regular', time: Date.parse('2026-10-29T14:00:05Z') });
    assert.equal(applyLiveTick(live, { price: 99, session: 'regular', time: Date.parse('2026-10-29T14:00:04Z') }), live);

    // The next poll is older than the trade: the trade is replayed on top of it.
    const olderPoll = { price: 100.5, changePercent: 0.5, currency: 'USD', marketTime: '2026-10-29T14:00:01.000Z' };
    const kept = preferLiveQuotes({ X: olderPoll }, { X: live });
    assert.equal(kept.X.price, 101);
    // A poll newer than the trade replaces it.
    const newerPoll = { ...olderPoll, price: 102, marketTime: '2026-10-29T14:01:00.000Z' };
    assert.equal(preferLiveQuotes({ X: newerPoll }, { X: live }).X, newerPoll);
    const untouched = { X: olderPoll };
    assert.equal(preferLiveQuotes(untouched, {}), untouched);
});

test('London pence are scaled to pounds like the polled quote', () => {
    const quote = { price: 1.18, change: 0.01, changePercent: 0.85, currency: 'GBP', marketTime: '2026-10-29T08:00:00.000Z' };
    const live = applyLiveTick(quote, parseYahooMessage(message(VOD_L_PENCE)));
    assert.equal(live.price, 1.185);
    assert.ok(Math.abs(live.change - 0.0105) < 1e-6, 'the change is scaled too');
    assert.equal(live.changePercent, 0.8940001);
    // Replaying the stored trade does not scale it twice.
    assert.equal(preferLiveQuotes({ V: quote }, { V: live }).V.price, 1.185);
});

test('crypto dollar prices are converted to the pair currency, keep the day change basis and reject a different coin', () => {
    const btcEur = { price: 72000, changePercent: -2, currency: 'EUR', quoteType: 'CRYPTOCURRENCY', marketTime: '2026-10-29T08:00:00.000Z' };
    const time = Date.parse('2026-10-29T08:00:10Z');
    const live = applyLiveTick(btcEur, { usdPrice: 80000, time, session: 'regular', source: 'bitcoinwisdom' }, currency => (currency === 'EUR' ? 1.11 : null));
    assert.ok(Math.abs(live.price - 80000 / 1.11) < 1e-6);
    const previousClose = 72000 / 0.98;
    assert.ok(Math.abs(live.changePercent - (live.price / previousClose - 1) * 100) < 1e-9);
    assert.ok(Math.abs(live.change - (live.price - previousClose)) < 1e-6);
    assert.equal(live.liveTick.source, 'bitcoinwisdom');

    assert.equal(applyLiveTick(btcEur, { usdPrice: 80000, time }, () => null), btcEur, 'no FX rate, no conversion');
    assert.equal(applyLiveTick(btcEur, { usdPrice: 3, time }, () => 1.11), btcEur, 'a far price is another coin');
    const usd = applyLiveTick({ ...btcEur, currency: 'USD', price: 80100 }, { usdPrice: 80000, time });
    assert.equal(usd.price, 80000);
});

test('a fresh crypto trade stays on top of a poll from the other provider; a stale one yields', () => {
    const tickTime = Date.parse('2026-10-29T08:00:10Z');
    const live = applyLiveTick({ price: 80100, changePercent: 0, currency: 'USD', marketTime: '2026-10-29T08:00:00.000Z' },
        { usdPrice: 80250, time: tickTime, session: 'regular', source: 'bitcoinwisdom' });
    const poll = { price: 80130, changePercent: 0.1, currency: 'USD', marketTime: '2026-10-29T08:00:12.000Z' };
    assert.equal(preferLiveQuotes({ BTC: poll }, { BTC: live }, tickTime + 5000).BTC.price, 80250);
    assert.equal(preferLiveQuotes({ BTC: poll }, { BTC: live }, tickTime + 61000).BTC, poll);
    // Yahoo trades share the poll's clock: a newer poll always wins.
    const yahooLive = { ...live, liveTick: { ...live.liveTick, source: 'yahoo' } };
    assert.equal(preferLiveQuotes({ BTC: poll }, { BTC: yahooLive }, tickTime + 5000).BTC, poll);
});

test('a batch updates every matching quote, including bare currency aliases, and leaves the map alone otherwise', () => {
    const prices = {
        'EURUSD=X': { price: 1.1, changePercent: 0, quoteType: 'CURRENCY', currency: 'USD', marketTime: '2026-10-29T08:00:00.000Z' },
        EUR: { price: 1.1, changePercent: 0, quoteType: 'CURRENCY', currency: 'USD', marketTime: '2026-10-29T08:00:00.000Z' },
        AAPL: { price: 230, changePercent: 0, currency: 'USD', marketTime: '2026-10-29T08:00:00.000Z' }
    };
    const tick = parseYahooMessage(message(EURUSD_REGULAR));
    const next = applyLiveTicks(prices, new Map([[tick.symbol, tick]]));
    assert.notEqual(next, prices);
    assert.equal(next['EURUSD=X'].price, 1.11391);
    assert.equal(next.EUR.price, 1.11391);
    assert.equal(next.AAPL, prices.AAPL);
    assert.equal(applyLiveTicks(prices, new Map([['MSFT', { price: 1, time: Date.now() }]])), prices);
});

test('only real market symbols stream; crypto pairs are flagged with their coin', () => {
    assert.deepEqual(liveQuoteEntries({
        AAPL: { quoteType: 'EQUITY' },
        'EURUSD=X': { quoteType: 'CURRENCY' },
        EUR: { quoteType: 'CURRENCY' },
        USD: { quoteType: 'CURRENCY' },
        'BTC-EUR': { quoteType: 'CRYPTOCURRENCY' },
        VFIAX: { quoteType: 'MUTUALFUND' },
        'LOAN-1': { quoteType: 'LOAN' },
        'ES=F': { quoteType: 'FUTURE' }
    }), [
        { symbol: 'AAPL', crypto: false },
        { symbol: 'BTC-EUR', crypto: true },
        { symbol: 'ES=F', crypto: false },
        { symbol: 'EURUSD=X', crypto: false }
    ]);
    assert.equal(cryptoBase('BTC-USD'), 'BTC');
    assert.equal(cryptoBase('UNI7083-USD'), 'UNI');
    assert.equal(cryptoBase('1INCH-USD'), '1INCH');
    assert.equal(cryptoBase('AAPL'), null);
});

test('the crypto catalogue lookup keeps the exact coin with a dollar market, the best ranked one', async () => {
    const assets = [
        { marketId: 12260, baseCurrency: 'wbtc', quoteCurrency: 'usdt', lastPrice: 79939, pos: 19 },
        { marketId: 17612, baseCurrency: 'btc', quoteCurrency: 'usdt', lastPrice: 1, pos: 1509 },
        { marketId: 256, baseCurrency: 'btc', quoteCurrency: 'usdt', lastPrice: 80092.53, pos: 1, exchangeName: 'Binance' },
        { marketId: 99, baseCurrency: 'btc', quoteCurrency: 'eur', lastPrice: 72000, pos: 0 }
    ];
    assert.deepEqual(pickCryptoMarket('BTC', assets), { symbol: 'BTC', id: 256, price: 80092.53, quote: 'USDT', exchange: 'Binance' });
    assert.equal(pickCryptoMarket('MATIC', assets), null);
    assert.deepEqual(parseCryptoSymbols('btc, eth,BTC'), ['BTC', 'ETH']);
    assert.equal(parseCryptoSymbols('BTC-USD'), null);
    assert.equal(parseCryptoSymbols(''), null);

    const requested = [];
    const markets = await findCryptoMarkets(['BTC', 'NOPE'], async url => {
        requested.push(new URL(url).searchParams.get('filterString'));
        return { success: true, data: { assets } };
    });
    assert.deepEqual(requested, ['BTC', 'NOPE']);
    assert.deepEqual(markets.map(market => market.id), [256]);
    await assert.rejects(findCryptoMarkets(['BTC'], async () => { throw new Error('offline'); }), /unavailable/);
});

test('the native app answers /api/crypto-markets itself, without a web server', async () => {
    const calls = [];
    const api = createNativeMarketApi(async options => {
        calls.push(options.url);
        return { status: 200, headers: {}, data: { success: true, data: { assets: [{ marketId: 258, baseCurrency: 'eth', quoteCurrency: 'usdt', lastPrice: 2319.76, pos: 2 }] } } };
    });
    const response = await api('/api/crypto-markets?symbols=ETH');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).markets, [{ symbol: 'ETH', id: 258, price: 2319.76, quote: 'USDT', exchange: '' }]);
    assert.ok(calls[0].startsWith('https://api.bitcoinwisdom.io/api/v1/index?'));
    assert.equal((await api('/api/crypto-markets?symbols=')).status, 400);
});

test('the live price updates the open candle or extends the chart', () => {
    const raw = [{ date: '2026-10-29T13:30:00.000Z', rawPrice: 100 }, { date: '2026-10-29T13:35:00.000Z', rawPrice: 101 }];
    assert.deepEqual(withLivePoint(raw, 102, Date.parse('2026-10-29T13:37:00Z'), '1D').at(-1), { date: '2026-10-29T13:35:00.000Z', rawPrice: 102 });
    assert.deepEqual(withLivePoint(raw, 103, Date.parse('2026-10-29T13:41:00Z'), '1D').at(-1), { date: '2026-10-29T13:41:00.000Z', rawPrice: 103 });
    assert.equal(withLivePoint(raw, 103, Date.parse('2026-10-29T13:41:00Z'), '1D').length, 3);
    // Daily candles: same day replaces, the next day appends.
    assert.equal(withLivePoint(raw, 104, Date.parse('2026-10-29T20:00:00Z'), '1Y').length, 2);
    assert.equal(withLivePoint(raw, 104, Date.parse('2026-10-30T08:00:00Z'), '1Y').length, 3);
    assert.equal(withLivePoint(raw, 104, Date.parse('2026-10-29T13:00:00Z'), '1D'), raw, 'older than the curve');
    assert.equal(withLivePoint(raw, null, Date.now(), '1D'), raw);
});

test('the shared hub routes crypto to BitcoinWisdom, the rest to Yahoo, batches ticks and closes when unused', async () => {
    const originalSocket = globalThis.WebSocket;
    const originalFetch = globalThis.fetch;
    FakeSocket.instances = [];
    globalThis.WebSocket = FakeSocket;
    const lookups = [];
    globalThis.fetch = async url => {
        lookups.push(url);
        return new Response(JSON.stringify({ markets: [{ symbol: 'BTC', id: 256, price: 80000 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const { watchLiveQuotes } = await import('../src/utils/live-quotes-client.js');
        const batches = [];
        const stop = watchLiveQuotes([
            { symbol: 'AAPL', crypto: false },
            { symbol: 'BTC-USD', crypto: true },
            { symbol: 'XYZ-USD', crypto: true }
        ], ticks => batches.push(ticks));
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepEqual(lookups, ['/api/crypto-markets?symbols=BTC%2CXYZ']);
        const yahoo = FakeSocket.instances.filter(socket => socket.url.includes('yahoo') && socket.readyState !== 3);
        const crypto = FakeSocket.instances.filter(socket => socket.url.includes('bitcoinwisdom') && socket.readyState !== 3);
        assert.equal(yahoo.length, 1);
        assert.equal(crypto.length, 1);
        yahoo[0].open();
        crypto[0].open();
        assert.deepEqual(subscribed(yahoo[0]).sort(), ['AAPL', 'XYZ-USD'], 'a coin BitcoinWisdom lacks streams from Yahoo');
        assert.deepEqual(JSON.parse(crypto[0].sent[0]).list, [256]);

        crypto[0].receive(JSON.stringify({ ok: 1, type: 'tickers', tickers: [[256, 80100]] }));
        yahoo[0].receive(message(NVDA_PRE));
        crypto[0].receive(JSON.stringify({ ok: 1, type: 'tickers', tickers: [[256, 80200]] }));
        assert.equal(batches.length, 0, 'ticks wait for the once-a-second flush');
        await new Promise(resolve => setTimeout(resolve, 1100));
        assert.equal(batches.length, 1);
        assert.equal(batches[0].get('BTC-USD').usdPrice, 80200, 'only the latest trade per symbol');
        assert.equal(batches[0].get('NVDA').session, 'pre');

        stop();
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.ok(FakeSocket.instances.every(socket => socket.readyState === 3), 'no listener left closes every socket');
    } finally {
        globalThis.WebSocket = originalSocket;
        globalThis.fetch = originalFetch;
    }
});
