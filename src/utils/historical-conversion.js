'use client';

import { getCachedAssetHistory, getCachedFxHistory } from './fxCache';
import {
    COMMON_CRYPTO_ASSETS,
    COMMON_FIAT_CURRENCIES,
    normalizeAsset
} from './portfolio-logic';

function upper(value) {
    return value ? String(value).trim().toUpperCase() : '';
}

const sortedDateCache = new WeakMap();

function getSortedDates(rateMap) {
    if (!rateMap || typeof rateMap !== 'object') return [];
    const cached = sortedDateCache.get(rateMap);
    if (cached) return cached;

    const dates = Object.keys(rateMap).sort();
    sortedDateCache.set(rateMap, dates);
    return dates;
}

export function getMapRateForDate(rateMap, dateStr) {
    if (!rateMap || !dateStr) return null;
    if (rateMap[dateStr]) return rateMap[dateStr];

    const dates = getSortedDates(rateMap);
    if (dates.length === 0) return null;

    let low = 0;
    let high = dates.length - 1;
    let matchIndex = -1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (dates[mid] <= dateStr) {
            matchIndex = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return matchIndex >= 0 ? rateMap[dates[matchIndex]] : rateMap[dates[0]];
}

export function getHistoricalConversionRate(conversionMaps, currency, baseCurrency, dateStr) {
    const curr = upper(normalizeAsset(currency));
    const base = upper(normalizeAsset(baseCurrency));
    if (!curr || !base) return null;
    if (curr === base) return 1;

    return getMapRateForDate(conversionMaps?.[curr], dateStr);
}

export function getTransactionConversionCurrencies(transactions, baseCurrency) {
    const base = upper(normalizeAsset(baseCurrency));
    const currencies = new Set();

    (transactions || []).forEach(tx => {
        [tx.quoteCurrency, tx.feeCurrency].forEach(currency => {
            const normalized = upper(normalizeAsset(currency));
            if (normalized && normalized !== base) currencies.add(normalized);
        });
    });

    return [...currencies];
}

export async function buildHistoricalConversionMap(currency, baseCurrency) {
    const curr = upper(normalizeAsset(currency));
    const base = upper(normalizeAsset(baseCurrency));
    if (!curr || !base || curr === base) return {};

    if (COMMON_FIAT_CURRENCIES.includes(curr)) {
        return await getCachedFxHistory(curr, base, 'ALL');
    }

    if (COMMON_CRYPTO_ASSETS.includes(curr)) {
        const assetHistory = await getCachedAssetHistory(`${curr}-USD`, 'ALL');
        if (!assetHistory || assetHistory.length === 0) return {};

        const usdToBase = base === 'USD'
            ? {}
            : await getCachedFxHistory('USD', base, 'ALL');
        const fxDates = Object.keys(usdToBase).sort();
        let fxIndex = 0;
        let lastFx = base === 'USD' ? 1 : null;

        return assetHistory.reduce((acc, point) => {
            const date = String(point.date).split('T')[0];
            while (fxIndex < fxDates.length && fxDates[fxIndex] <= date) {
                lastFx = usdToBase[fxDates[fxIndex]];
                fxIndex++;
            }
            if (lastFx && point.price) acc[date] = point.price * lastFx;
            return acc;
        }, {});
    }

    return {};
}

export async function buildHistoricalConversionMaps(transactions, baseCurrency) {
    const currencies = getTransactionConversionCurrencies(transactions, baseCurrency);
    const entries = await Promise.all(currencies.map(async currency => {
        const map = await buildHistoricalConversionMap(currency, baseCurrency);
        return [currency, map];
    }));

    return entries.reduce((acc, [currency, map]) => {
        acc[currency] = map;
        return acc;
    }, {});
}
