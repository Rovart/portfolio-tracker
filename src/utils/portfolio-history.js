import {
    normalizeAsset,
    getQuoteCurrencyFromSymbol,
    COMMON_FIAT_CURRENCIES,
    COMMON_CRYPTO_ASSETS,
    isFiatAsset
} from './portfolio-logic.js';

const EPSILON = 0.00001;

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function upper(value) {
    return value ? String(value).trim().toUpperCase() : '';
}

function choosePriceSymbol(existingSymbol, candidateSymbol) {
    if (!existingSymbol) return candidateSymbol;
    const existingQuote = getQuoteCurrencyFromSymbol(existingSymbol);
    const candidateQuote = getQuoteCurrencyFromSymbol(candidateSymbol);
    if (candidateQuote === 'USD' && existingQuote !== 'USD') return candidateSymbol;
    return existingSymbol;
}

function registerMetadata(metadata, asset, symbol, quoteCurrency) {
    const normalized = upper(asset);
    if (!normalized) return;

    const rawSymbol = upper(symbol || asset);
    metadata.priceSymbolMap[normalized] = choosePriceSymbol(metadata.priceSymbolMap[normalized], rawSymbol);

    const quote = upper(quoteCurrency) || getQuoteCurrencyFromSymbol(rawSymbol);
    if (quote) {
        if (!metadata.quoteMap[normalized] || quote === 'USD') {
            metadata.quoteMap[normalized] = quote;
        }
    }
}

function collectCashTrackedCurrencies(sortedTransactions) {
    const tracked = new Set();
    sortedTransactions.forEach(tx => {
        const base = normalizeAsset(tx.baseCurrency);
        const quote = normalizeAsset(tx.quoteCurrency);

        if (['DEPOSIT', 'WITHDRAW'].includes(tx.type) && isFiatAsset(base)) {
            tracked.add(upper(base));
        }

        if (quote && (tx.affectsQuoteBalance === true || tx.affectsFiatBalance === true)) {
            tracked.add(upper(quote));
        }
    });
    return tracked;
}

function shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies) {
    if (!quote) return false;
    if (typeof tx.affectsQuoteBalance === 'boolean') return tx.affectsQuoteBalance;
    if (typeof tx.affectsFiatBalance === 'boolean') return tx.affectsFiatBalance;
    if (!isFiatAsset(quote)) return true;
    return cashTrackedCurrencies.has(upper(quote));
}

function shouldAffectFeeBalance(feeCurr, base, quote, affectsQuoteBalance, cashTrackedCurrencies) {
    if (!feeCurr) return false;
    if (feeCurr === base) return true;
    if (feeCurr === quote) return affectsQuoteBalance;
    if (!isFiatAsset(feeCurr)) return true;
    return cashTrackedCurrencies.has(upper(feeCurr));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// When a point in time is known. A bare date ("2026-10-22") is a daily close,
// so it only becomes true at the end of that day; anything else is an instant.
export function historyTime(date) {
    const text = String(date || '');
    return DATE_ONLY.test(text) ? Date.parse(`${text}T23:59:59.999Z`) : Date.parse(text);
}

// Per price series: times (ascending) and prices, for as-of lookups.
function buildHistoryIndexes(historicalPrices) {
    const indexes = {};

    Object.entries(historicalPrices || {}).forEach(([key, history]) => {
        if (!Array.isArray(history) || history.length === 0) return;

        const points = history
            .map(point => ({ time: historyTime(point?.date), price: toNumber(point?.price) }))
            .filter(point => Number.isFinite(point.time) && point.price > 0)
            .sort((a, b) => a.time - b.time);
        if (points.length === 0) return;

        indexes[key] = { times: points.map(point => point.time), prices: points.map(point => point.price) };
    });

    return indexes;
}

// The latest price known at `time` — never a later one. Taking the day's close
// for an instant within that day made multi-asset curves zigzag whenever two
// series had candles at different times (stocks at :30, crypto at :00).
function findPrice(historyIndexes, time, key) {
    const index = historyIndexes?.[key];
    if (!index) return null;

    const { times, prices } = index;
    let low = 0;
    let high = times.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (times[mid] <= time) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found >= 0 ? prices[found] : null;
}

function getPriceSymbol(asset, metadata, historicalPrices) {
    const normalized = upper(asset);
    let priceSym = metadata.priceSymbolMap[normalized] || normalized;

    if (historicalPrices[priceSym]?.length > 0) return priceSym;

    if (COMMON_FIAT_CURRENCIES.includes(normalized)) {
        return normalized === 'USD' ? 'USD' : `${normalized}USD=X`;
    }

    if (COMMON_CRYPTO_ASSETS.includes(normalized)) {
        return `${normalized}-USD`;
    }

    return priceSym;
}

function getCurrencyUsdRate(currency, time, historyIndexes) {
    const curr = upper(currency);
    if (!curr) return null;
    if (curr === 'USD') return 1;

    const directSym = `${curr}USD=X`;
    const direct = findPrice(historyIndexes, time, directSym);
    if (direct) return direct;

    const inverseSym = `USD${curr}=X`;
    const inverse = findPrice(historyIndexes, time, inverseSym);
    if (inverse) return 1 / inverse;

    return null;
}

function getFxRate(currency, baseCurrency, time, historyIndexes) {
    const from = upper(normalizeAsset(currency));
    const to = upper(normalizeAsset(baseCurrency));

    if (!from || !to) return null;
    if (from === to) return 1;

    const directSym = `${from}${to}=X`;
    const direct = findPrice(historyIndexes, time, directSym);
    if (direct) return direct;

    const inverseSym = `${to}${from}=X`;
    const inverse = findPrice(historyIndexes, time, inverseSym);
    if (inverse) return 1 / inverse;

    const fromUsd = getCurrencyUsdRate(from, time, historyIndexes);
    const toUsd = getCurrencyUsdRate(to, time, historyIndexes);
    if (!fromUsd || !toUsd) return null;

    return fromUsd / toUsd;
}

function valueBalance(asset, amount, time, historicalPrices, historyIndexes, baseCurrency, metadata, externalQuoteMap) {
    const normalized = upper(asset);
    if (!normalized || Math.abs(amount) < EPSILON) return null;

    let localPrice = 1;
    let quoteCurrency = normalized;

    if (!isFiatAsset(normalized)) {
        const priceSym = getPriceSymbol(normalized, metadata, historicalPrices);
        localPrice = findPrice(historyIndexes, time, priceSym);
        if (!localPrice) return null;

        // The quote currency MUST describe the instrument we priced with, not the
        // asset in general. An asset traded via several pairs (BTC-USD + BTC-EUR)
        // must convert its BTC-USD price as USD — resolving by normalized asset
        // let one pair's currency mislabel another pair's prices.
        quoteCurrency = upper(externalQuoteMap[priceSym]) ||
            upper(getQuoteCurrencyFromSymbol(priceSym)) ||
            upper(externalQuoteMap[normalized]) ||
            metadata.quoteMap[normalized] ||
            'USD';
    }

    const fxRate = getFxRate(quoteCurrency, baseCurrency, time, historyIndexes);
    if (!fxRate) return null;

    return amount * localPrice * fxRate;
}

// livePriceResolver: optional (asset) => unit price in base currency, or null when
// the asset has no live quote. When provided it enforces consistency with the live
// holdings valuation: assets unpriceable live are excluded from every point (they
// contribute nothing to the live total either), and the final "now" point is valued
// with live prices so the chart meets the header value exactly instead of cliffing.
export function calculatePortfolioHistory(transactions, historicalPrices, baseCurrency = 'USD', externalQuoteMap = {}, livePriceResolver = null) {
    if (!transactions || transactions.length === 0) return [];

    const timestampSet = new Set();
    Object.values(historicalPrices || {}).forEach(history => {
        if (!Array.isArray(history)) return;
        history.forEach(point => {
            if (point?.date) timestampSet.add(point.date);
        });
    });
    transactions.forEach(t => timestampSet.add(String(t.date).split('T')[0]));
    const historyIndexes = buildHistoryIndexes(historicalPrices);
    const nowStr = new Date().toISOString();
    timestampSet.add(nowStr);
    const sortedTimestamps = [...timestampSet].sort();

    const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date) || (Number(a.id) || 0) - (Number(b.id) || 0));
    const cashTrackedCurrencies = collectCashTrackedCurrencies(sortedTransactions);
    const metadata = { priceSymbolMap: {}, quoteMap: {} };

    sortedTransactions.forEach(tx => {
        const base = normalizeAsset(tx.baseCurrency);
        const quote = normalizeAsset(tx.quoteCurrency);
        registerMetadata(metadata, base, tx.baseCurrency, tx.quoteCurrency);
        if (quote) registerMetadata(metadata, quote, tx.quoteCurrency || quote, 'USD');
    });

    const currentBalances = {};
    const dailyData = [];
    let txIndex = 0;
    let units = 0;
    let unitValue = 1;
    let initialChartValue = 0;
    let initialized = false;
    let cumulativeFlow = 0;

    // Resolve live prices once; null = asset has no live quote right now
    const liveRates = {};
    const getLiveRate = (asset) => {
        if (!livePriceResolver) return undefined;
        if (!(asset in liveRates)) {
            const rate = livePriceResolver(asset);
            liveRates[asset] = Number.isFinite(rate) && rate > 0 ? rate : null;
        }
        return liveRates[asset];
    };

    const finalTimestamp = sortedTimestamps[sortedTimestamps.length - 1];
    const divergences = [];

    for (const timestamp of sortedTimestamps) {
        const timestampDate = String(timestamp).split('T')[0];
        const time = historyTime(timestamp);
        const externalFlows = [];

        while (txIndex < sortedTransactions.length) {
            const tx = sortedTransactions[txIndex];
            const txDateOnly = String(tx.date).split('T')[0];
            if (txDateOnly > timestampDate) break;

            const base = normalizeAsset(tx.baseCurrency);
            const quote = normalizeAsset(tx.quoteCurrency);
            const feeCurr = normalizeAsset(tx.feeCurrency);
            const bAmt = toNumber(tx.baseAmount);
            const qAmt = toNumber(tx.quoteAmount);
            const fAmt = toNumber(tx.fee);
            const affectsQuoteBalance = shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies);

            if (base && !currentBalances[base]) currentBalances[base] = 0;
            if (quote && !currentBalances[quote]) currentBalances[quote] = 0;
            if (feeCurr && !currentBalances[feeCurr]) currentBalances[feeCurr] = 0;

            // A trade paid or received outside the tracked cash moves money across
            // the portfolio boundary, so it counts as a contribution or withdrawal.
            if (tx.type === 'BUY') {
                currentBalances[base] += bAmt;
                if (quote && affectsQuoteBalance) {
                    currentBalances[quote] -= qAmt;
                } else {
                    externalFlows.push({ asset: base, amount: bAmt });
                }
            } else if (tx.type === 'SELL') {
                currentBalances[base] -= bAmt;
                if (quote && affectsQuoteBalance) {
                    currentBalances[quote] += qAmt;
                } else {
                    externalFlows.push({ asset: base, amount: -bAmt });
                }
            } else if (tx.type === 'DEPOSIT') {
                currentBalances[base] += bAmt;
                externalFlows.push({ asset: base, amount: bAmt });
            } else if (tx.type === 'WITHDRAW') {
                currentBalances[base] -= bAmt;
                externalFlows.push({ asset: base, amount: -bAmt });
            } else if (tx.type === 'INCOME') {
                // Interest/dividends are returns; paid out of the portfolio they are a withdrawal.
                if (quote && affectsQuoteBalance) {
                    currentBalances[quote] += qAmt;
                } else if (quote) {
                    externalFlows.push({ asset: quote, amount: -qAmt });
                }
            }

            if (fAmt && feeCurr && shouldAffectFeeBalance(feeCurr, base, quote, affectsQuoteBalance, cashTrackedCurrencies)) {
                currentBalances[feeCurr] -= fAmt;
            }

            txIndex++;
        }

        let totalValue = 0;
        let hasValuedAsset = false;
        const isFinal = timestamp === finalTimestamp;

        for (const [asset, amount] of Object.entries(currentBalances)) {
            if (!amount || isNaN(amount) || Math.abs(amount) < EPSILON) continue;

            const liveRate = getLiveRate(asset);
            // Consistency with the live valuation: an asset without a live quote
            // contributes nothing to the header total, so it must not inflate the
            // chart either — otherwise the curve ends in a permanent fake cliff.
            if (liveRate === null) continue;

            const value = valueBalance(
                asset,
                amount,
                time,
                historicalPrices,
                historyIndexes,
                baseCurrency,
                metadata,
                externalQuoteMap
            );

            if (isFinal && liveRate !== undefined) {
                const liveValue = amount * liveRate;
                if (value !== null && Number.isFinite(value) && Math.abs(liveValue) > EPSILON) {
                    const drift = Math.abs(value - liveValue) / Math.max(Math.abs(liveValue), EPSILON);
                    if (drift > 0.02) divergences.push({ asset, histValue: value, liveValue });
                }
                totalValue += liveValue;
                hasValuedAsset = true;
                continue;
            }

            if (value === null || !Number.isFinite(value)) continue;
            totalValue += value;
            hasValuedAsset = true;
        }

        if (!hasValuedAsset || !Number.isFinite(totalValue) || totalValue <= 0) continue;

        let externalFlowValue = 0;
        externalFlows.forEach(flow => {
            // Assets left out of the valuation (no live quote) must not move the index either.
            if (getLiveRate(flow.asset) === null) return;
            const value = valueBalance(
                flow.asset,
                flow.amount,
                time,
                historicalPrices,
                historyIndexes,
                baseCurrency,
                metadata,
                externalQuoteMap
            );
            if (value !== null && Number.isFinite(value)) externalFlowValue += value;
        });

        cumulativeFlow += externalFlowValue;

        if (!initialized) {
            initialized = true;
            initialChartValue = totalValue;
            units = totalValue;
            unitValue = 1;
        } else {
            if (Math.abs(externalFlowValue) > EPSILON && unitValue > EPSILON) {
                units += externalFlowValue / unitValue;
            }
            if (units > EPSILON) {
                unitValue = totalValue / units;
            }
        }

        // netFlow: contributions minus withdrawals so far, so a range's gain is
        // Δvalue − ΔnetFlow and its return is the ratio of `value` (time-weighted).
        dailyData.push({
            date: timestamp,
            value: initialChartValue * unitValue,
            rawValue: totalValue,
            netFlow: cumulativeFlow
        });
    }

    // Surface assets whose historical valuation drifts from their live quote —
    // this is the signature of stale/wrong history data (delisted or renamed
    // symbols, bad price feeds) and the cause of chart-vs-actual mismatches.
    if (divergences.length > 0) {
        console.warn(
            '[portfolio-history] Historical valuation differs >2% from live quotes for:',
            divergences.map(d => `${d.asset} (hist ${d.histValue.toFixed(2)} vs live ${d.liveValue.toFixed(2)})`).join(', ')
        );
    }

    return dailyData;
}

// Gain between two points of a history (excluding money added or withdrawn) and
// its Modified Dietz return: gain over the average capital at work, with each
// flow weighted by the share of the period it was invested. Unlike a
// time-weighted index, its sign always matches the gain.
export function getPeriodReturn(points, startIndex = 0, endIndex = points.length - 1) {
    const start = points[startIndex];
    const end = points[endIndex];
    if (!start || !end) return { diff: 0, percent: 0 };
    const startTime = Date.parse(start.date);
    const span = Date.parse(end.date) - startTime;
    let weightedFlow = 0;
    for (let i = startIndex + 1; i <= endIndex; i++) {
        const flow = (points[i].netFlow ?? 0) - (points[i - 1].netFlow ?? 0);
        if (!flow) continue;
        const weight = span > 0 ? (Date.parse(end.date) - Date.parse(points[i].date)) / span : 0;
        weightedFlow += flow * Math.max(0, Math.min(1, weight));
    }
    const diff = end.value - start.value - ((end.netFlow ?? 0) - (start.netFlow ?? 0));
    const capital = start.value + weightedFlow;
    return { diff, percent: capital > EPSILON ? (diff / capital) * 100 : 0 };
}
