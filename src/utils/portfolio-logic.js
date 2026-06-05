const EPSILON = 0.00001;

export const COMMON_FIAT_CURRENCIES = [
    'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD',
    'IDR', 'NZD', 'SEK', 'NOK', 'DKK', 'KRW', 'INR', 'BRL', 'MXN', 'ZAR',
    'THB'
];

export const COMMON_CRYPTO_ASSETS = [
    'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE', 'CRV',
    'SUSHI', 'COMP', 'MKR', 'YFI', 'SNX', 'BAL', 'LRC', 'MATIC', 'POL',
    'AVAX', 'FTM', 'NEAR', 'ALGO', 'VET', 'FIL', 'XTZ', 'ATOM', 'LTC',
    'BCH', 'XLM', 'XRP', 'DOGE', 'SHIB', 'BNB', 'USDT', 'USDC'
];

const PAIR_QUOTES = [...new Set([...COMMON_FIAT_CURRENCIES, ...COMMON_CRYPTO_ASSETS])];
const EXCHANGE_SUFFIX_QUOTES = {
    DE: 'EUR',
    MI: 'EUR',
    PA: 'EUR',
    AS: 'EUR',
    MC: 'EUR',
    L: 'GBP',
    HK: 'HKD',
    TO: 'CAD',
    SW: 'CHF',
    SS: 'CNY',
    SZ: 'CNY',
    SI: 'SGD',
    AX: 'AUD',
    T: 'JPY'
};

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function upper(value) {
    return value ? String(value).trim().toUpperCase() : '';
}

function normalizeMarketCurrency(currency) {
    const curr = upper(currency);
    if (curr === 'GBX' || curr === 'GBP') return 'GBP';
    return curr;
}

function isPenceCurrency(currency) {
    const raw = String(currency || '').trim();
    return raw === 'GBp' || upper(raw) === 'GBX';
}

export function normalizeAsset(asset) {
    if (!asset) return asset;
    const s = upper(asset);

    if (s.endsWith('=X')) {
        const base = s.replace('=X', '');
        return base.length > 3 ? base.substring(0, 3) : base;
    }

    if (s.includes('-') || s.includes('/')) {
        const parts = s.split(/[-/]/);
        const lastPart = parts[parts.length - 1];
        if (parts.length > 1 && PAIR_QUOTES.includes(lastPart)) {
            return parts[0];
        }
    }

    return s;
}

export function isFiatAsset(asset) {
    const normalized = normalizeAsset(asset);
    return !!normalized && COMMON_FIAT_CURRENCIES.includes(upper(normalized));
}

export function isCryptoAsset(asset) {
    const normalized = normalizeAsset(asset);
    return !!normalized && COMMON_CRYPTO_ASSETS.includes(upper(normalized));
}

export function getQuoteCurrencyFromSymbol(symbol) {
    const s = upper(symbol);
    if (!s) return null;

    if (s.endsWith('=X')) {
        const pair = s.replace('=X', '');
        if (pair.length >= 6) return pair.substring(3, 6);
        return pair === 'USD' ? 'USD' : 'USD';
    }

    if (s.includes('-') || s.includes('/')) {
        const parts = s.split(/[-/]/);
        const quote = parts[parts.length - 1];
        if (PAIR_QUOTES.includes(quote) || quote.length === 3) return quote;
    }

    if (s.includes('.')) {
        const suffix = s.split('.').pop();
        if (EXCHANGE_SUFFIX_QUOTES[suffix]) return EXCHANGE_SUFFIX_QUOTES[suffix];
    }

    return null;
}

function quotePrice(priceMap, symbol) {
    const quote = priceMap?.[symbol];
    const price = toNumber(quote?.price);
    return price > 0 ? price : null;
}

function quoteChangePercent(priceMap, symbol) {
    const value = priceMap?.[symbol]?.changePercent;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getCurrencyUsdRate(priceMap, currency) {
    const curr = upper(currency);
    if (!curr) return null;
    if (curr === 'USD') return 1;

    const direct = quotePrice(priceMap, `${curr}USD=X`);
    if (direct) return direct;

    const bare = priceMap?.[curr];
    if (bare && (bare.quoteType === 'CURRENCY' || bare.currency === 'USD')) {
        const price = toNumber(bare.price);
        if (price > 0) return price;
    }

    const yahooBare = quotePrice(priceMap, `${curr}=X`);
    if (yahooBare) return yahooBare;

    const inverse = quotePrice(priceMap, `USD${curr}=X`);
    if (inverse) return 1 / inverse;

    return null;
}

function getCurrencyUsdChangePercent(priceMap, currency) {
    const curr = upper(currency);
    if (!curr || curr === 'USD') return 0;

    const direct = quoteChangePercent(priceMap, `${curr}USD=X`);
    if (direct !== null) return direct;

    const bare = priceMap?.[curr];
    const bareChange = parseFloat(bare?.changePercent);
    if (bare && (bare.quoteType === 'CURRENCY' || bare.currency === 'USD') && Number.isFinite(bareChange)) {
        return bareChange;
    }

    const yahooBare = quoteChangePercent(priceMap, `${curr}=X`);
    if (yahooBare !== null) return yahooBare;

    const inverse = quoteChangePercent(priceMap, `USD${curr}=X`);
    if (inverse !== null) return ((1 / (1 + inverse / 100)) - 1) * 100;

    return null;
}

export function getCurrentFxRate(priceMap, fromCurrency, toCurrency) {
    const from = upper(normalizeAsset(fromCurrency));
    const to = upper(normalizeAsset(toCurrency));

    if (!from || !to) return null;
    if (from === to) return 1;

    const direct = quotePrice(priceMap, `${from}${to}=X`);
    if (direct) return direct;

    const inverse = quotePrice(priceMap, `${to}${from}=X`);
    if (inverse) return 1 / inverse;

    const fromUsd = getCurrencyUsdRate(priceMap, from);
    const toUsd = getCurrencyUsdRate(priceMap, to);
    if (!fromUsd || !toUsd) return null;

    return fromUsd / toUsd;
}

export function getCurrentFxChangePercent(priceMap, fromCurrency, toCurrency) {
    const from = upper(normalizeAsset(fromCurrency));
    const to = upper(normalizeAsset(toCurrency));

    if (!from || !to || from === to) return 0;

    const direct = quoteChangePercent(priceMap, `${from}${to}=X`);
    if (direct !== null) return direct;

    const inverse = quoteChangePercent(priceMap, `${to}${from}=X`);
    if (inverse !== null) return ((1 / (1 + inverse / 100)) - 1) * 100;

    const fromUsdChange = getCurrencyUsdChangePercent(priceMap, from);
    const toUsdChange = getCurrencyUsdChangePercent(priceMap, to);
    if (fromUsdChange === null || toUsdChange === null) return 0;

    const usdToTargetChange = ((1 / (1 + toUsdChange / 100)) - 1) * 100;
    return ((1 + fromUsdChange / 100) * (1 + usdToTargetChange / 100) - 1) * 100;
}

export function getPreferredPricingSymbol(asset, priceMap = {}) {
    const raw = upper(asset);
    const normalized = upper(normalizeAsset(asset));
    if (!normalized) return raw;

    if (raw && priceMap[raw]) return raw;

    if (isFiatAsset(normalized)) {
        return normalized === 'USD' ? 'USD=X' : `${normalized}USD=X`;
    }

    if (isCryptoAsset(normalized)) {
        const usdPair = `${normalized}-USD`;
        if (priceMap[usdPair] || !raw || raw === normalized) return usdPair;
    }

    return raw || normalized;
}

function choosePriceSymbol(existingSymbol, candidateSymbol) {
    if (!existingSymbol) return candidateSymbol;

    const existingQuote = getQuoteCurrencyFromSymbol(existingSymbol);
    const candidateQuote = getQuoteCurrencyFromSymbol(candidateSymbol);

    if (candidateQuote === 'USD' && existingQuote !== 'USD') return candidateSymbol;
    return existingSymbol;
}

function registerAssetMetadata(metadata, asset, symbol, quoteCurrency) {
    if (!asset) return;
    const normalized = upper(asset);
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

function getTransactionQuoteCurrency(tx, baseCurrency) {
    const explicitQuote = normalizeAsset(tx.quoteCurrency);
    if (explicitQuote) return explicitQuote;

    const qAmt = toNumber(tx.quoteAmount);
    if (!qAmt) return null;

    const rawBase = upper(tx.baseCurrency);
    if (rawBase.includes('-') || rawBase.includes('/')) {
        const pairQuote = getQuoteCurrencyFromSymbol(rawBase);
        if (pairQuote) return normalizeAsset(pairQuote);
    }

    return normalizeAsset(baseCurrency);
}

function shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies) {
    if (!quote) return false;
    if (typeof tx.affectsQuoteBalance === 'boolean') return tx.affectsQuoteBalance;
    if (typeof tx.affectsFiatBalance === 'boolean') return tx.affectsFiatBalance;
    if (!isFiatAsset(quote)) return true;
    return cashTrackedCurrencies.has(upper(quote));
}

function createAccount() {
    return {
        lots: [],
        remainingCostBasis: 0,
        accountedQuantity: 0,
        totalBuyQuantity: 0,
        totalBuyCost: 0,
        realizedPnl: 0,
        transferredCost: 0,
        missingCostFx: false,
        missingCostBasis: false,
        oversoldQuantity: 0
    };
}

function getAccount(accounts, asset) {
    const key = upper(asset);
    if (!accounts[key]) accounts[key] = createAccount();
    return accounts[key];
}

function addLot(accounts, asset, quantity, costBasis, tx) {
    const qty = Math.max(0, toNumber(quantity));
    if (!asset || qty <= EPSILON) return;

    const cost = Math.max(0, toNumber(costBasis));
    const account = getAccount(accounts, asset);
    account.lots.push({ quantity: qty, costBasis: cost, date: tx?.date, id: tx?.id });
    account.remainingCostBasis += cost;
    account.accountedQuantity += qty;
}

function consumeLots(accounts, asset, quantity, proceedsBase = 0, realize = false) {
    const account = getAccount(accounts, asset);
    const requestedQuantity = Math.max(0, toNumber(quantity));
    let remaining = requestedQuantity;
    let consumedCost = 0;
    let consumedQuantity = 0;

    while (remaining > EPSILON && account.lots.length > 0) {
        const lot = account.lots[0];
        const take = Math.min(remaining, lot.quantity);
        const ratio = lot.quantity > 0 ? take / lot.quantity : 0;
        const cost = lot.costBasis * ratio;

        lot.quantity -= take;
        lot.costBasis -= cost;
        remaining -= take;
        consumedCost += cost;
        consumedQuantity += take;

        if (lot.quantity <= EPSILON) account.lots.shift();
    }

    account.remainingCostBasis = Math.max(0, account.remainingCostBasis - consumedCost);
    account.accountedQuantity = Math.max(0, account.accountedQuantity - consumedQuantity);

    if (remaining > EPSILON) {
        account.oversoldQuantity += remaining;
    }

    if (realize) {
        const proceeds = toNumber(proceedsBase);
        const recognizedProceeds = requestedQuantity > EPSILON
            ? proceeds * (consumedQuantity / requestedQuantity)
            : 0;
        account.realizedPnl += recognizedProceeds - consumedCost;
    } else {
        account.transferredCost += consumedCost;
    }

    return consumedCost;
}

function convertTxAmount(amount, assetOrCurrency, baseCurrency, dateStr, convertRateForTx, accounts, ownerAsset) {
    const qty = toNumber(amount);
    if (!qty || !assetOrCurrency) return 0;

    const from = normalizeAsset(assetOrCurrency);
    if (!from) return 0;
    if (upper(from) === upper(baseCurrency)) return qty;

    const rate = convertRateForTx ? convertRateForTx(from, baseCurrency, dateStr) : null;
    if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0) {
        if (ownerAsset) getAccount(accounts, ownerAsset).missingCostFx = true;
        return 0;
    }

    return qty * rate;
}

export function calculatePortfolioAccounting(transactions, baseCurrency = 'USD', convertRateForTx = null) {
    const sortedTransactions = [...(transactions || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const cashTrackedCurrencies = collectCashTrackedCurrencies(sortedTransactions);
    const balances = {};
    const accounts = {};
    const metadata = { priceSymbolMap: {}, quoteMap: {} };

    sortedTransactions.forEach(tx => {
        const type = tx.type;
        const base = normalizeAsset(tx.baseCurrency);
        const quote = getTransactionQuoteCurrency(tx, baseCurrency);
        const feeCurr = normalizeAsset(tx.feeCurrency);
        const bAmt = toNumber(tx.baseAmount);
        const qAmt = toNumber(tx.quoteAmount);
        const fAmt = toNumber(tx.fee);
        const dateStr = tx.date ? String(tx.date).split('T')[0] : null;
        const explicitCostBasisBase = toNumber(tx.costBasisBase);

        if (!base) return;

        balances[base] = balances[base] || 0;
        registerAssetMetadata(metadata, base, tx.baseCurrency, tx.quoteCurrency);

        if (quote) {
            balances[quote] = balances[quote] || 0;
            registerAssetMetadata(metadata, quote, tx.quoteCurrency || quote, 'USD');
        }

        if (feeCurr) balances[feeCurr] = balances[feeCurr] || 0;

        const affectsQuoteBalance = shouldAffectQuoteBalance(tx, quote, cashTrackedCurrencies);
        const quoteValueBase = quote
            ? convertTxAmount(qAmt, quote, baseCurrency, dateStr, convertRateForTx, accounts, base)
            : 0;
        const feeValueBase = feeCurr
            ? convertTxAmount(fAmt, feeCurr, baseCurrency, dateStr, convertRateForTx, accounts, base)
            : 0;

        if (type === 'BUY') {
            balances[base] += bAmt;

            const netLotQuantity = feeCurr === base ? Math.max(0, bAmt - fAmt) : bAmt;
            const feeAddsToCost = feeCurr && feeCurr !== base ? feeValueBase : 0;
            const costBase = quoteValueBase + feeAddsToCost;

            if (!isFiatAsset(base)) {
                addLot(accounts, base, netLotQuantity, costBase, tx);
                const account = getAccount(accounts, base);
                account.totalBuyQuantity += netLotQuantity;
                account.totalBuyCost += costBase;
            }

            if (quote && affectsQuoteBalance) {
                balances[quote] -= qAmt;
                if (!isFiatAsset(quote)) {
                    consumeLots(accounts, quote, qAmt, quoteValueBase, true);
                }
            }
        } else if (type === 'SELL') {
            balances[base] -= bAmt;

            const sellFeeBase = feeCurr && feeCurr !== base ? feeValueBase : 0;
            const proceedsBase = quoteValueBase - sellFeeBase;

            if (!isFiatAsset(base)) {
                consumeLots(accounts, base, bAmt, proceedsBase, true);
            }

            if (quote && affectsQuoteBalance) {
                balances[quote] += qAmt;
                if (!isFiatAsset(quote)) {
                    addLot(accounts, quote, qAmt, Math.max(0, proceedsBase), tx);
                }
            }
        } else if (type === 'DEPOSIT') {
            balances[base] += bAmt;
            if (!isFiatAsset(base)) {
                let depositCostBase = explicitCostBasisBase > 0 ? explicitCostBasisBase : quoteValueBase;
                if (feeCurr && feeCurr !== base) depositCostBase += feeValueBase;
                addLot(accounts, base, bAmt, depositCostBase, tx);
                if (depositCostBase <= EPSILON) {
                    getAccount(accounts, base).missingCostBasis = true;
                }
            }
        } else if (type === 'WITHDRAW') {
            balances[base] -= bAmt;
            if (!isFiatAsset(base)) consumeLots(accounts, base, bAmt, 0, false);
        }

        if (fAmt && feeCurr) {
            balances[feeCurr] -= fAmt;
            const feeAlreadyRepresentedInBuyLot = type === 'BUY' && feeCurr === base;
            if (!feeAlreadyRepresentedInBuyLot && !isFiatAsset(feeCurr)) {
                consumeLots(accounts, feeCurr, fAmt, 0, false);
            }
        }
    });

    return {
        balances,
        positions: accounts,
        priceSymbolMap: metadata.priceSymbolMap,
        quoteMap: metadata.quoteMap,
        cashTrackedCurrencies
    };
}

export function calculateAssetAccounting(transactions, asset, baseCurrency = 'USD', convertRateForTx = null) {
    const target = normalizeAsset(asset);
    const accounting = calculatePortfolioAccounting(transactions, baseCurrency, convertRateForTx);
    const balance = toNumber(accounting.balances[target]);
    const account = accounting.positions[target] || createAccount();
    const remainingCostBasis = account.remainingCostBasis || 0;
    const averagePurchasePrice = balance > EPSILON ? remainingCostBasis / balance : 0;

    return {
        asset: target,
        currentBalance: balance,
        remainingCostBasis,
        averagePurchasePrice,
        realizedPnl: account.realizedPnl || 0,
        totalBuyQuantity: account.totalBuyQuantity || 0,
        totalBuyCost: account.totalBuyCost || 0,
        missingCostFx: !!account.missingCostFx,
        missingCostBasis: !!account.missingCostBasis,
        oversoldQuantity: account.oversoldQuantity || 0
    };
}

function getAssetPriceSnapshot(asset, amount, priceMap, baseCurrency, preferredSymbol) {
    const normalized = upper(asset);
    const base = upper(baseCurrency);
    const isFiat = isFiatAsset(normalized);
    let priceSym = preferredSymbol || getPreferredPricingSymbol(normalized, priceMap);
    let quote = priceMap?.[priceSym];

    if (!quote && isFiat) {
        priceSym = normalized === 'USD' ? 'USD=X' : `${normalized}USD=X`;
        quote = priceMap?.[priceSym];
    }

    if (!quote && isCryptoAsset(normalized)) {
        priceSym = `${normalized}-USD`;
        quote = priceMap?.[priceSym];
    }

    quote = quote || {};

    let usedMarketState = 'REGULAR';
    let localPrice = toNumber(quote.price);
    let assetChangePercent = toNumber(quote.changePercent);

    if (quote.marketState === 'PRE' && quote.preMarketPrice) {
        localPrice = toNumber(quote.preMarketPrice);
        assetChangePercent = toNumber(quote.preMarketChangePercent);
        usedMarketState = 'PRE';
    } else if ((quote.marketState === 'POST' || quote.marketState === 'POSTPOST') && quote.postMarketPrice) {
        localPrice = toNumber(quote.postMarketPrice);
        assetChangePercent = toNumber(quote.postMarketChangePercent);
        usedMarketState = 'POST';
    }

    const quoteCurrencyFromFeed = normalizeMarketCurrency(quote.currency);
    let quoteCurrency = quoteCurrencyFromFeed || getQuoteCurrencyFromSymbol(priceSym) || 'USD';
    if (isPenceCurrency(quote.currency)) {
        localPrice = localPrice / 100;
    }
    let fxRate = 1;
    let fxMissing = false;
    let fxChangePercent = 0;

    if (isFiat) {
        localPrice = 1;
        quoteCurrency = normalized;
        assetChangePercent = 0;
    }

    if (normalized === base) {
        localPrice = 1;
        fxRate = 1;
        assetChangePercent = 0;
    } else {
        const rate = getCurrentFxRate(priceMap, quoteCurrency, base);
        if (rate === null) {
            fxMissing = true;
            fxRate = 0;
        } else {
            fxRate = rate;
            fxChangePercent = getCurrentFxChangePercent(priceMap, quoteCurrency, base);
        }
    }

    const value = amount * localPrice * fxRate;
    const combinedChangePercent = ((1 + assetChangePercent / 100) * (1 + fxChangePercent / 100) - 1) * 100;
    const combinedChangeFactor = 1 + (combinedChangePercent / 100);
    const prevValueBase = value / (Math.abs(combinedChangeFactor) < EPSILON ? 1 : combinedChangeFactor);
    const dailyPnl = value - prevValueBase;

    const qt = upper(quote.quoteType);
    const td = upper(quote.typeDisp);
    let category = 'Shares';

    if (isFiat || qt === 'CURRENCY' || td.includes('CURRENCY') || priceSym?.endsWith('=X')) {
        category = 'Currencies';
    } else if (qt === 'ETF' || td.includes('ETF')) {
        category = 'ETFs';
    } else if (qt === 'CRYPTOCURRENCY' || td.includes('CRYPTO') || isCryptoAsset(normalized)) {
        category = 'Crypto';
    } else if (qt === 'MUTUALFUND' || td.includes('FUND')) {
        category = 'Funds';
    } else if (qt === 'EQUITY' || td.includes('EQUITY') || td.includes('STOCK') || td.includes('SHARE')) {
        category = 'Shares';
    }

    return {
        asset: normalized,
        originalAsset: priceSym || normalized,
        name: quote.name || normalized,
        amount,
        localPrice,
        price: localPrice * fxRate,
        value,
        change24h: combinedChangePercent,
        dailyPnl,
        quoteCurrency,
        fxRate,
        fxMissing,
        priceMissing: !isFiat && localPrice <= 0,
        isFiat: category === 'Currencies',
        category,
        isBareCurrencyOrigin: category === 'Currencies',
        originalType: qt || (category === 'Currencies' ? 'CURRENCY' : undefined),
        preMarketPrice: quote.preMarketPrice,
        preMarketChangePercent: quote.preMarketChangePercent,
        postMarketPrice: quote.postMarketPrice,
        postMarketChangePercent: quote.postMarketChangePercent,
        marketState: usedMarketState
    };
}

export function getCurrentAssetRate(priceMap, fromAsset, toCurrency) {
    const from = normalizeAsset(fromAsset);
    const to = normalizeAsset(toCurrency);

    if (!from || !to) return null;
    if (upper(from) === upper(to)) return 1;
    if (isFiatAsset(from)) return getCurrentFxRate(priceMap, from, to);

    const snapshot = getAssetPriceSnapshot(from, 1, priceMap, to, null);
    if (snapshot.fxMissing || snapshot.priceMissing || snapshot.price <= 0) return null;
    return snapshot.price;
}

export function calculateHoldings(transactions, priceMap, baseCurrency = 'USD', convertRateForTx = null) {
    const accounting = calculatePortfolioAccounting(
        transactions,
        baseCurrency,
        convertRateForTx || ((from, to) => getCurrentAssetRate(priceMap, from, to))
    );

    return Object.entries(accounting.balances)
        .filter(([_, amount]) => Math.abs(amount) > EPSILON)
        .map(([asset, amount]) => {
            const snapshot = getAssetPriceSnapshot(
                asset,
                amount,
                priceMap,
                baseCurrency,
                accounting.priceSymbolMap[asset]
            );
            const position = accounting.positions[asset] || createAccount();
            const costBasis = snapshot.isFiat ? 0 : position.remainingCostBasis;
            const unrealizedProfit = snapshot.isFiat ? 0 : snapshot.value - costBasis;
            const realizedProfit = snapshot.isFiat ? 0 : position.realizedPnl;
            const totalProfit = realizedProfit + unrealizedProfit;
            const averagePurchasePrice = !snapshot.isFiat && amount > EPSILON && costBasis > 0
                ? costBasis / amount
                : 0;

            return {
                ...snapshot,
                costBasis,
                averagePurchasePrice,
                unrealizedProfit,
                realizedProfit,
                totalProfit,
                missingCostFx: !!position.missingCostFx,
                missingCostBasis: !!position.missingCostBasis,
                oversoldQuantity: position.oversoldQuantity || 0
            };
        })
        .sort((a, b) => {
            if (a.isFiat && !b.isFiat) return 1;
            if (!a.isFiat && b.isFiat) return -1;
            return b.value - a.value;
        });
}

export async function fetchPortfolioHistory() {
    return [];
}
