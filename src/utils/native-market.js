import { CapacitorHttp } from '@capacitor/core';
import { normalizeCurrency, normalizeFinancials, normalizeSearch, scalePrice, getQuoteMarketTime } from './market-data.js';

const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const FINANCIAL_MODULES = ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'calendarEvents', 'earnings', 'earningsHistory', 'earningsTrend', 'incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory'];
const DATE_FIELDS = new Set(['endDate', 'quarter', 'earningsDate', 'exDividendDate', 'dividendDate']);
const USER_AGENT = 'Mozilla/5.0 (compatible; Monetra/1.6.1)';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

class MarketError extends Error {
    constructor(message, status = 502) { super(message); this.status = status; }
}

function unwrapYahoo(value, key = '') {
    if (Array.isArray(value)) return value.map(item => unwrapYahoo(item, key));
    if (value && typeof value === 'object') {
        if ('raw' in value) return unwrapYahoo(value.raw, key);
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, unwrapYahoo(item, name)]));
    }
    if (DATE_FIELDS.has(key) && typeof value === 'number') return new Date(value * 1000).toISOString();
    return value;
}

export function nativeHistoryQuery(range, now = new Date()) {
    const start = new Date(now);
    switch (range) {
        case '1D': start.setDate(start.getDate() - 1); break;
        case '1W': start.setDate(start.getDate() - 7); break;
        case '3M': start.setMonth(start.getMonth() - 3); break;
        case '1Y': start.setFullYear(start.getFullYear() - 1); break;
        case 'YTD': start.setMonth(0, 1); start.setHours(0, 0, 0, 0); break;
        case 'ALL': start.setTime(0); break;
        default: start.setMonth(start.getMonth() - 1);
    }
    const hourly = ['1D', '1W', '1M'].includes(range) || (range === 'YTD' && now - start < 60 * 86400000);
    return { period1: Math.floor(start.getTime() / 86400000) * 86400, period2: Math.floor(now.getTime() / 1000), interval: hourly ? '1h' : '1d' };
}

function chartHistory(result) {
    const closes = result.indicators?.quote?.[0]?.close || [];
    return (result.timestamp || []).map((time, index) => ({
        date: new Date(time * 1000).toISOString(), price: scalePrice(closes[index], result.meta?.currency)
    })).filter(point => Number.isFinite(point.price) && point.price > 0);
}

function normalizeQuote(quote) {
    return {
        symbol: quote.symbol,
        price: scalePrice(quote.regularMarketPrice, quote.currency),
        change: scalePrice(quote.regularMarketChange, quote.currency),
        changePercent: quote.regularMarketChangePercent,
        name: quote.shortName || quote.longName || quote.symbol,
        currency: normalizeCurrency(quote.currency),
        quoteType: quote.quoteType, typeDisp: quote.typeDisp,
        preMarketPrice: scalePrice(quote.preMarketPrice, quote.currency) ?? null,
        preMarketChangePercent: quote.preMarketChangePercent ?? null,
        postMarketPrice: scalePrice(quote.postMarketPrice, quote.currency) ?? null,
        postMarketChangePercent: quote.postMarketChangePercent ?? null,
        marketState: quote.marketState ?? null,
        marketTime: getQuoteMarketTime(quote)
    };
}

// The same API contract as the web server, executed inside the app. Only public
// market symbols / watch-only addresses leave the device; the ledger stays local.
export function createNativeMarketApi(transport = options => CapacitorHttp.request(options), clock = () => new Date()) {
    let crumb;
    let crumbExpires = 0;
    let sessionRequest;

    async function http(url, options = {}) {
        const result = await transport({
            url, method: 'GET', connectTimeout: 10000, readTimeout: 15000, responseType: 'json',
            ...options, headers: { Accept: options.responseType === 'text' ? '*/*' : 'application/json', 'User-Agent': USER_AGENT, ...options.headers }
        });
        if (result.status < 200 || result.status >= 300) throw new MarketError(`Market provider responded ${result.status}`, result.status);
        return typeof result.data === 'string' && options.responseType !== 'text' ? JSON.parse(result.data) : result.data;
    }

    async function session() {
        if (crumb && crumbExpires > clock().getTime()) return crumb;
        if (!sessionRequest) {
            const pending = (async () => {
                // fc returns 404 but sets Yahoo's anonymous session cookie.
                // Capacitor's native cookie manager retains it for getcrumb / queries.
                await transport({ url: 'https://fc.yahoo.com/', method: 'GET', headers: { 'User-Agent': USER_AGENT }, responseType: 'text', connectTimeout: 10000, readTimeout: 15000 });
                const value = await http(`${YAHOO_HOSTS[0]}/v1/test/getcrumb`, { responseType: 'text' });
                if (typeof value !== 'string' || !value.trim() || /[\s<>]/.test(value) || value.length > 100) throw new MarketError('Yahoo session unavailable');
                crumb = value.trim();
                crumbExpires = clock().getTime() + 3600000;
                return crumb;
            })();
            sessionRequest = pending;
            pending.finally(() => { if (sessionRequest === pending) sessionRequest = null; }).catch(() => {});
        }
        return sessionRequest;
    }

    async function yahoo(path, params, authenticated = false) {
        let lastError;
        for (const host of YAHOO_HOSTS) {
            try {
                const query = new URLSearchParams(params);
                if (authenticated) query.set('crumb', await session());
                const body = await http(`${host}${path}?${query}`);
                const error = body.chart?.error || body.quoteResponse?.error || body.quoteSummary?.error;
                if (error) throw new MarketError(error.description || 'Market data unavailable', error.code === 'Not Found' ? 404 : 502);
                return body;
            } catch (error) {
                lastError = error;
                if (error.status === 404) throw error;
                if (authenticated && [401, 403].includes(error.status)) { crumb = null; crumbExpires = 0; }
            }
        }
        throw lastError;
    }

    async function chart(symbol, params) {
        const body = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}`, params);
        const result = body.chart?.result?.[0];
        if (!result) throw new MarketError('No history available', 404);
        return result;
    }

    async function quotes(symbols) {
        const data = [];
        try {
            const body = await yahoo('/v7/finance/quote', { symbols: symbols.join(',') }, true);
            data.push(...(body.quoteResponse?.result || []).map(normalizeQuote)
                .filter(item => symbols.includes(item.symbol) && Number.isFinite(item.price) && item.price > 0));
            if (symbols.every(symbol => data.some(quote => quote.symbol === symbol))) return { data, source: 'yahoo-native' };
        } catch { /* Chart metadata provides a quote when the quote endpoint is unavailable. */ }
        const missing = symbols.filter(symbol => !data.some(quote => quote.symbol === symbol));
        // Bound parallel chart fallbacks to avoid flooding Yahoo for large portfolios.
        for (let offset = 0; offset < missing.length; offset += 4) {
            const batch = await Promise.allSettled(missing.slice(offset, offset + 4).map(async symbol => {
                const result = await chart(symbol, { range: '1d', interval: '5m' });
                const meta = result.meta;
                const previous = meta.previousClose ?? meta.chartPreviousClose;
                const change = Number.isFinite(previous) ? meta.regularMarketPrice - previous : null;
                return normalizeQuote({ ...meta, quoteType: meta.instrumentType, regularMarketChange: change, regularMarketChangePercent: previous > 0 ? change / previous * 100 : null });
            }));
            data.push(...batch.filter(item => item.status === 'fulfilled' && Number.isFinite(item.value.price) && item.value.price > 0).map(item => item.value));
        }
        if (!data.length) throw new MarketError('No quotes available');
        return { data, source: 'yahoo-native-chart' };
    }

    async function history(symbol, range) {
        let result = await chart(symbol, nativeHistoryQuery(range, clock()));
        let points = chartHistory(result);
        if (range === '1D' && points.length === 0) {
            const params = nativeHistoryQuery('1W', clock());
            result = await chart(symbol, params);
            points = chartHistory(result);
            if (points.length) {
                const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: result.meta?.exchangeTimezoneName || 'UTC' });
                const lastDay = formatter.format(new Date(points.at(-1).date));
                points = points.filter(point => formatter.format(new Date(point.date)) === lastDay);
            }
        }
        return { history: points, source: 'yahoo-native' };
    }

    async function wallet(chain, address) {
        if (chain === 'BTC' && /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,40})$/.test(address)) {
            const data = await http(`https://mempool.space/api/address/${encodeURIComponent(address)}`);
            const stats = [data.chain_stats || {}, data.mempool_stats || {}];
            return { chain, address, balance: stats.reduce((total, item) => total + (item.funded_txo_sum || 0) - (item.spent_txo_sum || 0), 0) / 1e8 };
        }
        if (chain === 'ETH' && /^0x[a-fA-F0-9]{40}$/.test(address)) {
            for (const url of ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']) {
                try {
                    const data = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 } });
                    if (data.error || !/^0x[0-9a-f]+$/i.test(data.result || '')) throw new MarketError('Wallet balance unavailable');
                    return { chain, address, balance: Number(BigInt(data.result)) / 1e18 };
                } catch { /* Try the second public RPC endpoint. */ }
            }
            throw new MarketError('Wallet balance unavailable');
        }
        throw new MarketError('Invalid wallet chain or address', 400);
    }

    return async function nativeApiFetch(endpoint, options = {}) {
        const url = new URL(endpoint, 'https://localhost');
        const params = url.searchParams;
        if (options.method && options.method.toUpperCase() !== 'GET') return jsonResponse({ error: 'Native market API is read-only' }, 405);
        try {
            let body;
            const symbol = params.get('symbol');
            switch (url.pathname) {
                case '/api/quote': {
                    const symbols = [...new Set((params.get('symbols') || '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean))];
                    if (!symbols.length || symbols.length > 200) throw new MarketError('Invalid symbol list', 400);
                    body = await quotes(symbols);
                    break;
                }
                case '/api/history':
                    if (!symbol) throw new MarketError('No symbol provided', 400);
                    body = await history(symbol, params.get('range') || '1M');
                    break;
                case '/api/search': {
                    const q = params.get('q') || '';
                    const result = q ? await yahoo('/v1/finance/search', { q, quotesCount: '20', newsCount: '0' }) : { quotes: [] };
                    body = { results: normalizeSearch(result, q), source: 'yahoo-native' };
                    break;
                }
                case '/api/financials': {
                    if (!symbol) throw new MarketError('No symbol provided', 400);
                    const result = await yahoo(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, { modules: FINANCIAL_MODULES.join(',') }, true);
                    const summary = result.quoteSummary?.result?.[0];
                    if (!summary) throw new MarketError('No financial data available', 404);
                    body = { data: normalizeFinancials(unwrapYahoo(summary)), source: 'yahoo-native' };
                    break;
                }
                case '/api/wallet': body = await wallet((params.get('chain') || '').toUpperCase(), (params.get('address') || '').trim()); break;
                default: throw new MarketError('Unknown local API endpoint', 404);
            }
            return jsonResponse(body);
        } catch (error) {
            return jsonResponse({ error: error.message || 'Market provider unavailable' }, error.status >= 400 && error.status <= 599 ? error.status : 502);
        }
    };
}
