import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeMarketApi, nativeHistoryQuery } from '../src/utils/native-market.js';
import { getIconSources } from '../src/utils/icon-data.js';
import { getQuoteMarketTime } from '../src/utils/market-data.js';

const reply = (data, status = 200) => ({ data, status, headers: {} });
const chartReply = (currency = 'USD', closes = [100, 110], timestamps = [1790942400, 1791028800]) => reply({ chart: { result: [{
    meta: { symbol: 'AAPL', currency, instrumentType: 'EQUITY', regularMarketPrice: 110, previousClose: 100, exchangeTimezoneName: 'UTC' },
    timestamp: timestamps, indicators: { quote: [{ close: closes }] }
}], error: null } });
const clock = () => new Date('2026-10-04T12:00:00Z');
const sessionTransport = (handler, calls) => async options => {
    calls.push(options);
    if (options.url === 'https://fc.yahoo.com/') return reply('', 404);
    if (options.url.includes('/getcrumb')) return reply('anonymous/session');
    return handler(options);
};

test('batched native quotes preserve pence conversion and extended-session prices without a web server', async () => {
    const calls = [];
    const api = createNativeMarketApi(sessionTransport(options => {
        const url = new URL(options.url);
        assert.equal(url.pathname, '/v7/finance/quote');
        assert.equal(url.searchParams.get('symbols'), 'AAPL,VOD.L');
        assert.equal(url.searchParams.get('crumb'), 'anonymous/session');
        return reply({ quoteResponse: { result: [
            { symbol: 'AAPL', regularMarketPrice: 110, regularMarketChange: 10, regularMarketChangePercent: 10, currency: 'USD' },
            { symbol: 'VOD.L', regularMarketPrice: 120, regularMarketChange: 2, preMarketPrice: 125, postMarketChangePercent: 0, currency: 'GBp' }
        ] } });
    }, calls), clock);
    const result = await (await api('/api/quote?symbols=AAPL,VOD.L,AAPL')).json();
    assert.equal(result.data[1].price, 1.2);
    assert.equal(result.data[1].currency, 'GBP');
    assert.equal(result.data[1].change, 0.02);
    assert.equal(result.data[1].preMarketPrice, 1.25);
    assert.equal(result.data[1].postMarketChangePercent, 0);
    assert.equal(calls.filter(call => call.url === 'https://fc.yahoo.com/').length, 1);
    assert.ok(calls.every(call => new URL(call.url).hostname.endsWith('yahoo.com')));
});

test('native history discards missing prices and applies the same currency scale as native quotes', async () => {
    const api = createNativeMarketApi(async options => {
        assert.equal(new URL(options.url).pathname, '/v8/finance/chart/VOD.L');
        return chartReply('GBp', [100, null, 120, -1], [1790942400, 1791028800, 1791115200, 1791201600]);
    }, clock);
    const result = await (await api('/api/history?symbol=VOD.L&range=1Y')).json();
    assert.deepEqual(result.history.map(point => point.price), [1, 1.2]);
    assert.equal(result.history[0].date, new Date(1790942400000).toISOString());
});

test('native history preserves provider prices including isolated legitimate spikes', async () => {
    const closes = [100, 100, 100, 100, 100, 150, 100, 100, 100, 100, 100, 100];
    const api = createNativeMarketApi(async () => chartReply('USD', closes, closes.map((_, i) => 1790942400 + i * 3600)), clock);
    const result = await (await api('/api/history?symbol=AAPL&range=1D')).json();
    assert.deepEqual(result.history.map(point => point.price), closes);
});

test('partial quote results recover missing symbols without refetching the symbols already priced', async () => {
    const calls = [];
    const api = createNativeMarketApi(sessionTransport(options => options.url.includes('/finance/quote')
        ? reply({ quoteResponse: { result: [{ symbol: 'MSFT', regularMarketPrice: 200, currency: 'USD' }] } })
        : chartReply(), calls), clock);
    const result = await (await api('/api/quote?symbols=AAPL,MSFT')).json();
    assert.equal(result.data.find(quote => quote.symbol === 'MSFT').price, 200);
    assert.equal(result.data.find(quote => quote.symbol === 'AAPL').price, 110);
    assert.equal(calls.filter(call => call.url.includes('/finance/chart/')).length, 1);
});

test('quote timestamps use the displayed session and accept web Date objects as well as native Unix seconds', () => {
    const regular = 1790942400;
    const post = regular + 3600;
    assert.equal(getQuoteMarketTime({ regularMarketTime: regular }), new Date(regular * 1000).toISOString());
    assert.equal(getQuoteMarketTime({ regularMarketTime: new Date(regular * 1000) }), new Date(regular * 1000).toISOString());
    assert.equal(getQuoteMarketTime({ regularMarketTime: regular, postMarketTime: post, postMarketPrice: 100, marketState: 'POST' }), new Date(post * 1000).toISOString());
    assert.equal(getQuoteMarketTime({ regularMarketTime: 'bad' }), null);
});

test('daily history on a non-trading day retrieves only the latest trading session', async () => {
    let requests = 0;
    const api = createNativeMarketApi(async () => ++requests === 1
        ? chartReply('USD', [], [])
        : chartReply('USD', [90, 100, 110], [1790856000, 1790942400, 1790946000]), clock);
    const result = await (await api('/api/history?symbol=AAPL&range=1D')).json();
    assert.equal(requests, 2);
    assert.deepEqual(result.history.map(point => point.price), [100, 110]);
});

test('direct Yahoo host fallback recovers history and quote endpoint outages recover chart metadata', async () => {
    const calls = [];
    const api = createNativeMarketApi(async options => {
        calls.push(options.url);
        if (options.url.includes('/finance/chart/') && options.url.startsWith('https://query2.')) return chartReply();
        return reply('Unavailable', 503);
    }, clock);
    const history = await api('/api/history?symbol=AAPL&range=1M');
    assert.equal(history.status, 200);
    const quotes = await (await api('/api/quote?symbols=AAPL')).json();
    assert.equal(quotes.data[0].price, 110);
    assert.equal(quotes.data[0].change, 10);
    assert.equal(quotes.data[0].changePercent, 10);
    assert.equal(quotes.source, 'yahoo-native-chart');
    assert.ok(calls.some(url => url.startsWith('https://query2.finance.yahoo.com')));
});

test('financial statements unwrap Yahoo raw values and dates, sharing one anonymous session with quotes', async () => {
    const calls = [];
    const api = createNativeMarketApi(sessionTransport(options => options.url.includes('/quoteSummary/')
        ? reply({ quoteSummary: { result: [{
            defaultKeyStatistics: { forwardPE: { raw: 0, fmt: '0' }, enterpriseValue: { raw: 500 } },
            calendarEvents: { earnings: { earningsDate: [{ raw: 1790942400 }] } },
            incomeStatementHistory: { incomeStatementHistory: [{ endDate: { raw: 1767139200 }, totalRevenue: { raw: 1000 } }] }
        }] } })
        : reply({ quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 110, currency: 'USD' }] } }), calls), clock);
    const [financials, quotes] = await Promise.all([api('/api/financials?symbol=AAPL'), api('/api/quote?symbols=AAPL')]);
    assert.equal(quotes.status, 200);
    const result = await financials.json();
    assert.equal(result.data.keyStats.forwardPE, 0);
    assert.equal(result.data.keyStats.enterpriseValue, 500);
    assert.equal(result.data.incomeStatement[0].totalRevenue, 1000);
    assert.equal(result.data.incomeStatement[0].date, new Date(1767139200000).toISOString());
    assert.equal(result.data.calendarEvents.earnings.earningsDate[0], new Date(1790942400000).toISOString());
    assert.equal(calls.filter(call => call.url === 'https://fc.yahoo.com/').length, 1);
});

test('expired anonymous Yahoo sessions are refreshed when authenticated queries return 401', async () => {
    const calls = [];
    let quoteCalls = 0;
    const api = createNativeMarketApi(sessionTransport(() => ++quoteCalls === 1
        ? reply('', 401)
        : reply({ quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 110, currency: 'USD' }] } }), calls), clock);
    assert.equal((await api('/api/quote?symbols=AAPL')).status, 200);
    assert.equal(calls.filter(call => call.url.endsWith('/getcrumb')).length, 2);
});

test('native search keeps currencies, commodities and crypto pairs supported by the web app', async () => {
    const api = createNativeMarketApi(async () => reply({ quotes: [
        { symbol: 'AAPL', quoteType: 'EQUITY', shortname: 'Apple', isYahooFinance: true },
        { symbol: 'news', quoteType: 'NONE', isYahooFinance: true }
    ] }), clock);
    assert.equal((await (await api('/api/search?q=gold')).json()).results[0].symbol, 'GC=F');
    assert.equal((await (await api('/api/search?q=EUR')).json()).results[0].symbol, 'EUR=X');
    assert.equal((await (await api('/api/search?q=ETHAUD')).json()).results[0].symbol, 'ETH-AUD');
    const results = (await (await api('/api/search?q=Apple')).json()).results;
    assert.equal(results.length, 1);
    assert.equal(results[0].shortname, 'Apple');
});

test('watch-only native BTC includes pending balances and ETH uses public RPC fallback', async () => {
    const calls = [];
    const api = createNativeMarketApi(async options => {
        calls.push(options);
        if (options.url.includes('mempool.space')) return reply({ chain_stats: { funded_txo_sum: 200000000, spent_txo_sum: 100000000 }, mempool_stats: { funded_txo_sum: 25000000 } });
        if (options.url.includes('publicnode')) return reply({ error: { message: 'Unavailable' } });
        assert.equal(options.data.method, 'eth_getBalance');
        assert.deepEqual(options.data.params, [`0x${'1'.repeat(40)}`, 'latest']);
        return reply({ result: '0xde0b6b3a7640000' });
    }, clock);
    assert.equal((await (await api('/api/wallet?chain=BTC&address=1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).json()).balance, 1.25);
    assert.equal((await (await api(`/api/wallet?chain=ETH&address=0x${'1'.repeat(40)}`)).json()).balance, 1);
    assert.equal(calls.length, 3);
});

test('invalid requests and local ledger writes cannot send anything to a provider', async () => {
    const api = createNativeMarketApi(async () => { throw new Error('Unexpected network request'); }, clock);
    assert.equal((await api('/api/history')).status, 400);
    assert.equal((await api('/api/financials')).status, 400);
    assert.equal((await api('/api/wallet?chain=ETH&address=bad')).status, 400);
    assert.equal((await api('/api/quote?symbols=')).status, 400);
    assert.equal((await api('/api/sync-csv', { method: 'POST', body: 'ledger' })).status, 405);
    assert.equal((await api('/api/unknown')).status, 404);
});

test('intraday, year-to-date and full history use supported Yahoo time windows', () => {
    assert.equal(nativeHistoryQuery('1W', clock()).interval, '1h');
    assert.equal(nativeHistoryQuery('1M', clock()).interval, '1h');
    assert.equal(nativeHistoryQuery('1Y', clock()).interval, '1d');
    assert.equal(nativeHistoryQuery('YTD', new Date('2026-01-15T12:00:00Z')).interval, '1h');
    assert.equal(nativeHistoryQuery('YTD', clock()).interval, '1d');
    assert.equal(nativeHistoryQuery('ALL', clock()).period1, 0);
});

test('native logos resolve directly to the same providers and reject path traversal', () => {
    assert.ok(getIconSources('ETH-EUR', 'CRYPTOCURRENCY')[0].includes('/eth@2x.png'));
    assert.ok(getIconSources('AAPL', 'EQUITY')[0].endsWith('/AAPL.png'));
    assert.deepEqual(getIconSources('../secret'), []);
});
