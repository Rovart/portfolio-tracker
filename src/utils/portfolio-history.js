import {
    normalizeAsset,
    getQuoteCurrencyFromSymbol,
    COMMON_FIAT_CURRENCIES,
    COMMON_CRYPTO_ASSETS,
    isFiatAsset
} from './portfolio-logic';

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

function buildHistoryIndexes(historicalPrices) {
    const indexes = {};

    Object.entries(historicalPrices || {}).forEach(([key, history]) => {
        if (!Array.isArray(history) || history.length === 0) return;

        const exact = new Map();
        const daily = new Map();
        const sorted = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date)));

        sorted.forEach(point => {
            const price = toNumber(point?.price);
            const date = String(point?.date || '');
            if (!date || price <= 0) return;

            exact.set(date, price);
            daily.set(date.split('T')[0], price);
        });

        indexes[key] = { exact, daily };
    });

    return indexes;
}

function findPrice(historyIndexes, timestamp, key, lastKnownPrices) {
    const index = historyIndexes?.[key];
    if (!index) return null;

    const dateOnly = timestamp.split('T')[0];
    const price = index.exact.get(timestamp) || index.daily.get(dateOnly);

    if (price > 0) {
        lastKnownPrices[key] = price;
        return price;
    }

    return lastKnownPrices[key] || null;
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

function getCurrencyUsdRate(currency, timestamp, historyIndexes, lastKnownPrices) {
    const curr = upper(currency);
    if (!curr) return null;
    if (curr === 'USD') return 1;

    const directSym = `${curr}USD=X`;
    const direct = findPrice(historyIndexes, timestamp, directSym, lastKnownPrices);
    if (direct) return direct;

    const inverseSym = `USD${curr}=X`;
    const inverse = findPrice(historyIndexes, timestamp, inverseSym, lastKnownPrices);
    if (inverse) return 1 / inverse;

    return null;
}

function getFxRate(currency, baseCurrency, timestamp, historyIndexes, lastKnownPrices) {
    const from = upper(normalizeAsset(currency));
    const to = upper(normalizeAsset(baseCurrency));

    if (!from || !to) return null;
    if (from === to) return 1;

    const directSym = `${from}${to}=X`;
    const direct = findPrice(historyIndexes, timestamp, directSym, lastKnownPrices);
    if (direct) return direct;

    const inverseSym = `${to}${from}=X`;
    const inverse = findPrice(historyIndexes, timestamp, inverseSym, lastKnownPrices);
    if (inverse) return 1 / inverse;

    const fromUsd = getCurrencyUsdRate(from, timestamp, historyIndexes, lastKnownPrices);
    const toUsd = getCurrencyUsdRate(to, timestamp, historyIndexes, lastKnownPrices);
    if (!fromUsd || !toUsd) return null;

    return fromUsd / toUsd;
}

function valueBalance(asset, amount, timestamp, historicalPrices, historyIndexes, baseCurrency, metadata, externalQuoteMap, lastKnownPrices) {
    const normalized = upper(asset);
    if (!normalized || Math.abs(amount) < EPSILON) return null;

    let localPrice = 1;
    let quoteCurrency = normalized;

    if (!isFiatAsset(normalized)) {
        const priceSym = getPriceSymbol(normalized, metadata, historicalPrices);
        localPrice = findPrice(historyIndexes, timestamp, priceSym, lastKnownPrices);
        if (!localPrice) return null;

        quoteCurrency = upper(externalQuoteMap[normalized]) ||
            metadata.quoteMap[normalized] ||
            getQuoteCurrencyFromSymbol(priceSym) ||
            'USD';
    }

    const fxRate = getFxRate(quoteCurrency, baseCurrency, timestamp, historyIndexes, lastKnownPrices);
    if (!fxRate) return null;

    return amount * localPrice * fxRate;
}

export function calculatePortfolioHistory(transactions, historicalPrices, baseCurrency = 'USD', externalQuoteMap = {}) {
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

    const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
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
    const lastKnownPrices = {};
    let txIndex = 0;
    let units = 0;
    let unitValue = 1;
    let initialChartValue = 0;
    let initialized = false;

    for (const timestamp of sortedTimestamps) {
        const timestampDate = String(timestamp).split('T')[0];
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

            if (tx.type === 'BUY') {
                currentBalances[base] += bAmt;
                if (quote && affectsQuoteBalance) {
                    currentBalances[quote] -= qAmt;
                }
            } else if (tx.type === 'SELL') {
                currentBalances[base] -= bAmt;
                if (quote && affectsQuoteBalance) {
                    currentBalances[quote] += qAmt;
                }
            } else if (tx.type === 'DEPOSIT') {
                currentBalances[base] += bAmt;
                externalFlows.push({ asset: base, amount: bAmt });
            } else if (tx.type === 'WITHDRAW') {
                currentBalances[base] -= bAmt;
                externalFlows.push({ asset: base, amount: -bAmt });
            }

            if (fAmt && feeCurr && shouldAffectFeeBalance(feeCurr, base, quote, affectsQuoteBalance, cashTrackedCurrencies)) {
                currentBalances[feeCurr] -= fAmt;
            }

            txIndex++;
        }

        let totalValue = 0;
        let hasValuedAsset = false;

        for (const [asset, amount] of Object.entries(currentBalances)) {
            if (!amount || isNaN(amount) || Math.abs(amount) < EPSILON) continue;
            const value = valueBalance(
                asset,
                amount,
                timestamp,
                historicalPrices,
                historyIndexes,
                baseCurrency,
                metadata,
                externalQuoteMap,
                lastKnownPrices
            );
            if (value === null || !Number.isFinite(value)) continue;
            totalValue += value;
            hasValuedAsset = true;
        }

        if (!hasValuedAsset || !Number.isFinite(totalValue) || totalValue <= 0) continue;

        let externalFlowValue = 0;
        externalFlows.forEach(flow => {
            const value = valueBalance(
                flow.asset,
                flow.amount,
                timestamp,
                historicalPrices,
                historyIndexes,
                baseCurrency,
                metadata,
                externalQuoteMap,
                lastKnownPrices
            );
            if (value !== null && Number.isFinite(value)) externalFlowValue += value;
        });

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

        dailyData.push({
            date: timestamp,
            value: initialChartValue * unitValue,
            rawValue: totalValue
        });
    }

    return dailyData;
}
