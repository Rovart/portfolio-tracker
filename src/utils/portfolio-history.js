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

        if (quote && tx.affectsFiatBalance === true) {
            tracked.add(upper(quote));
        }
    });
    return tracked;
}

function shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies) {
    if (!quote) return false;
    if (typeof tx.affectsFiatBalance === 'boolean') return tx.affectsFiatBalance;
    return cashTrackedCurrencies.has(upper(quote));
}

function findPrice(history, timestamp, key, lastKnownPrices) {
    if (!history || history.length === 0) return null;

    const dateOnly = timestamp.split('T')[0];
    const exactEntry = history.find(p => p.date === timestamp) ||
        history.find(p => String(p.date).startsWith(dateOnly));

    if (exactEntry && exactEntry.price) {
        const price = toNumber(exactEntry.price);
        if (price > 0) {
            lastKnownPrices[key] = price;
            return price;
        }
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

function getCurrencyUsdRate(currency, timestamp, historicalPrices, lastKnownPrices) {
    const curr = upper(currency);
    if (!curr) return null;
    if (curr === 'USD') return 1;

    const directSym = `${curr}USD=X`;
    const direct = findPrice(historicalPrices[directSym], timestamp, directSym, lastKnownPrices);
    if (direct) return direct;

    const inverseSym = `USD${curr}=X`;
    const inverse = findPrice(historicalPrices[inverseSym], timestamp, inverseSym, lastKnownPrices);
    if (inverse) return 1 / inverse;

    return null;
}

function getFxRate(currency, baseCurrency, timestamp, historicalPrices, lastKnownPrices) {
    const from = upper(normalizeAsset(currency));
    const to = upper(normalizeAsset(baseCurrency));

    if (!from || !to) return null;
    if (from === to) return 1;

    const directSym = `${from}${to}=X`;
    const direct = findPrice(historicalPrices[directSym], timestamp, directSym, lastKnownPrices);
    if (direct) return direct;

    const inverseSym = `${to}${from}=X`;
    const inverse = findPrice(historicalPrices[inverseSym], timestamp, inverseSym, lastKnownPrices);
    if (inverse) return 1 / inverse;

    const fromUsd = getCurrencyUsdRate(from, timestamp, historicalPrices, lastKnownPrices);
    const toUsd = getCurrencyUsdRate(to, timestamp, historicalPrices, lastKnownPrices);
    if (!fromUsd || !toUsd) return null;

    return fromUsd / toUsd;
}

function valueBalance(asset, amount, timestamp, historicalPrices, baseCurrency, metadata, externalQuoteMap, lastKnownPrices) {
    const normalized = upper(asset);
    if (!normalized || Math.abs(amount) < EPSILON) return null;

    let localPrice = 1;
    let quoteCurrency = normalized;

    if (!isFiatAsset(normalized)) {
        const priceSym = getPriceSymbol(normalized, metadata, historicalPrices);
        const history = historicalPrices[priceSym];
        localPrice = findPrice(history, timestamp, priceSym, lastKnownPrices);
        if (!localPrice) return null;

        quoteCurrency = getQuoteCurrencyFromSymbol(priceSym) ||
            upper(externalQuoteMap[normalized]) ||
            metadata.quoteMap[normalized] ||
            'USD';
    }

    const fxRate = getFxRate(quoteCurrency, baseCurrency, timestamp, historicalPrices, lastKnownPrices);
    if (!fxRate) return null;

    return amount * localPrice * fxRate;
}

export function calculatePortfolioHistory(transactions, historicalPrices, baseCurrency = 'USD', externalQuoteMap = {}) {
    if (!transactions || transactions.length === 0) return [];

    const historicalEntries = Object.values(historicalPrices).flat();
    const transactionDates = transactions.map(t => String(t.date).split('T')[0]);
    const nowStr = new Date().toISOString();
    const sortedTimestamps = [...new Set([
        ...historicalEntries.map(h => h.date),
        ...transactionDates,
        nowStr
    ])].sort();

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

            if (base && !currentBalances[base]) currentBalances[base] = 0;
            if (quote && !currentBalances[quote]) currentBalances[quote] = 0;
            if (feeCurr && !currentBalances[feeCurr]) currentBalances[feeCurr] = 0;

            if (tx.type === 'BUY') {
                currentBalances[base] += bAmt;
                if (quote && shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies)) {
                    currentBalances[quote] -= qAmt;
                }
            } else if (tx.type === 'SELL') {
                currentBalances[base] -= bAmt;
                if (quote && shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies)) {
                    currentBalances[quote] += qAmt;
                }
            } else if (tx.type === 'DEPOSIT') {
                currentBalances[base] += bAmt;
                externalFlows.push({ asset: base, amount: bAmt });
            } else if (tx.type === 'WITHDRAW') {
                currentBalances[base] -= bAmt;
                externalFlows.push({ asset: base, amount: -bAmt });
            }

            if (fAmt && feeCurr) {
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
