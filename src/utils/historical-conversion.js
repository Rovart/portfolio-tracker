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

export function getMapRateForDate(rateMap, dateStr) {
    if (!rateMap || !dateStr) return null;
    if (rateMap[dateStr]) return rateMap[dateStr];

    const dates = Object.keys(rateMap).sort();
    let match = null;
    for (const date of dates) {
        if (date > dateStr) break;
        match = date;
    }

    return match ? rateMap[match] : null;
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
