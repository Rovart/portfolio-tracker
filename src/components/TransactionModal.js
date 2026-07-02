'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import AssetSearch from './AssetSearch';
import EarningsEvent from './EarningsEvent';
import ConfirmModal from './ConfirmModal';

// Heavy, chart-driven views are code-split so opening the modal doesn't have to
// parse/execute recharts up front, and lazily mounted after the open animation.
const ChartSkeleton = () => (
    <div className="w-full rounded-2xl bg-white-5 animate-pulse" style={{ height: '300px' }} />
);
const AssetChart = dynamic(() => import('./AssetChart'), {
    ssr: false,
    loading: () => <ChartSkeleton />
});
const FinancialInfo = dynamic(() => import('./FinancialInfo'), {
    ssr: false,
    loading: () => <div className="w-full rounded-2xl bg-white-5 animate-pulse" style={{ height: '200px' }} />
});
import { Trash2, Edit2, X, Plus, ChevronLeft, ArrowLeft, Moon, Sun, Eye, EyeOff } from 'lucide-react';
import {
    normalizeAsset,
    isFiatAsset,
    getQuoteCurrencyFromSymbol,
    calculateAssetAccounting
} from '@/utils/portfolio-logic';
import {
    buildHistoricalConversionMap,
    getHistoricalConversionRate,
    getMapRateForDate
} from '@/utils/historical-conversion';
import { addWatchlistAsset, removeWatchlistAsset, isSymbolInWatchlist } from '@/utils/db';
import { COMMODITY_NAMES } from '@/utils/commodities';

// Header display logic: Title = Name, Subtitle = Symbol
const ASSET_SUMMARY_METRICS = ['value', 'total', 'realized', 'unrealized'];

function toFiniteNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

// Live FX rate helper: how many units of `to` one unit of `from` is worth.
// Tries the direct Yahoo pair first, then pivots via USD when needed.
async function fetchLiveFxRate(from, to) {
    const F = String(from || '').toUpperCase();
    const T = String(to || '').toUpperCase();
    if (!F || !T || F === T) return 1;

    try {
        const res = await fetch(`/api/quote?symbols=${F}${T}=X`);
        const json = await res.json();
        const direct = json.data?.[0]?.price;
        if (direct) return direct;
    } catch (e) {
        console.error('Direct FX fetch failed', e);
    }

    const toUsd = async (code) => {
        if (code === 'USD') return 1;
        try {
            const res = await fetch(`/api/quote?symbols=${code}USD=X`);
            const json = await res.json();
            return json.data?.[0]?.price || null;
        } catch (e) {
            console.error('Pivot FX fetch failed', e);
            return null;
        }
    };

    const [fromUsd, toUsdRate] = await Promise.all([toUsd(F), toUsd(T)]);
    if (fromUsd && toUsdRate) return fromUsd / toUsdRate;
    return 1;
}

export default function TransactionModal({
    mode,
    holding,
    transactions,
    onClose,
    onSave,
    onDelete,
    hideBalances,
    baseCurrency,
    portfolios = [],
    currentPortfolioId = 'all',
    isWatchlist = false,
    watchlistAssets = [],
    onWatchlistUpdate
}) {
    const modalRef = useRef(null);
    const sheetRef = useRef(null);
    const backdropRef = useRef(null);
    const dragState = useRef({ active: false, startY: 0, startTime: 0, dy: 0 });
    const heavyRafRef = useRef(0);
    const [currentView, setCurrentView] = useState(mode === 'ADD' ? 'SEARCH' : 'LIST');
    const [selectedAsset, setSelectedAsset] = useState(holding ? {
        symbol: holding.symbol || holding.asset,
        amount: holding.amount,
        originalType: holding.originalType,
        currency: holding.currency,
        name: holding.name,
        isBareCurrencyOrigin: holding.isBareCurrencyOrigin || false,
        // Extended hours data
        preMarketPrice: holding.preMarketPrice,
        preMarketChangePercent: holding.preMarketChangePercent,
        postMarketPrice: holding.postMarketPrice,
        postMarketChangePercent: holding.postMarketChangePercent,
        marketState: holding.marketState
    } : null);
    const [editingTx, setEditingTx] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, type, date }
    const [assetTab, setAssetTab] = useState('overview'); // 'overview' | 'financials'
    // Defer heavy chart mounting until after the modal has painted/animated in
    const [heavyReady, setHeavyReady] = useState(false);
    const [isInWatchlist, setIsInWatchlist] = useState(false);
    const [rangePerformance, setRangePerformance] = useState(null); // { range, change, changePercent }
    const [assetSummaryMetric, setAssetSummaryMetric] = useState('value'); // 'value' | 'total' | 'realized' | 'unrealized'

    // Sync selectedAsset when holding prop changes (e.g. if name is loaded late in Dashboard)
    // Use primitive dependencies to minimize re-runs
    useEffect(() => {
        if (holding) {
            setSelectedAsset({
                symbol: holding.symbol || holding.asset,
                amount: holding.amount,
                originalType: holding.originalType,
                currency: holding.currency,
                name: holding.name,
                isBareCurrencyOrigin: holding.isBareCurrencyOrigin || false,
                preMarketPrice: holding.preMarketPrice,
                preMarketChangePercent: holding.preMarketChangePercent,
                postMarketPrice: holding.postMarketPrice,
                postMarketChangePercent: holding.postMarketChangePercent,
                marketState: holding.marketState
            });
        }
    }, [
        holding,
        holding?.symbol,
        holding?.asset,
        holding?.amount,
        holding?.originalType,
        holding?.currency,
        holding?.name,
        holding?.isBareCurrencyOrigin,
        holding?.preMarketPrice,
        holding?.preMarketChangePercent,
        holding?.postMarketPrice,
        holding?.postMarketChangePercent,
        holding?.marketState
    ]);

    // Consolidated price data - updated atomically to guarantee single render
    // Always start loading to prevent showing cached USD price before FX conversion
    const [priceData, setPriceData] = useState({
        price: null, // Don't use cached price - wait for fresh fetch with FX
        changePercent: null,
        fxRate: 1,          // For display (may be 1 for bare currencies to avoid double conversion)
        actualFxRate: 1,    // True FX rate for calculations (used as fallback in avg price)
        historicalFx: {},
        transactionFx: {},  // Map of quoteCurrency -> historical rates for transaction cost basis
        isLoading: true // Always start loading
    });

    const prevSymbolRef = useRef(selectedAsset?.symbol);
    const priceDataPriceRef = useRef(priceData.price);
    const selectedAssetSymbol = selectedAsset?.symbol;
    const selectedAssetCurrency = selectedAsset?.currency;
    const selectedAssetOriginalType = selectedAsset?.originalType;
    const selectedAssetIsBareCurrencyOrigin = selectedAsset?.isBareCurrencyOrigin;

    useEffect(() => {
        setAssetSummaryMetric('value');
    }, [selectedAssetSymbol]);

    useEffect(() => {
        priceDataPriceRef.current = priceData.price;
    }, [priceData.price]);

    // 1. Lock background scroll and reset body
    useEffect(() => {
        const originalStyle = window.getComputedStyle(document.body).overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalStyle;
        };
    }, []);

    // 2. Handle Android back button/gesture via Capacitor App plugin
    useEffect(() => {
        let backButtonListener = null;

        const setupBackButton = async () => {
            try {
                const { App } = await import('@capacitor/app');
                backButtonListener = await App.addListener('backButton', () => {
                    if (currentView === 'FORM') {
                        setCurrentView('LIST');
                        setEditingTx(null);
                    } else {
                        onClose();
                    }
                });
            } catch (e) {
                // Capacitor App plugin not available (web browser)
                console.log('Capacitor App plugin not available');
            }
        };

        setupBackButton();

        return () => {
            if (backButtonListener) {
                backButtonListener.remove();
            }
        };
    }, [currentView, onClose]);


    // 2. Robust scroll to top on view change
    useEffect(() => {
        const timer = setTimeout(() => {
            if (modalRef.current) {
                modalRef.current.scrollTo({ top: 0, behavior: 'instant' });
            }
        }, 10); // Small delay to beat browser's auto-focus scroll
        return () => clearTimeout(timer);
    }, [currentView, selectedAsset?.symbol, editingTx?.id]);

    // 3. Check if asset is in watchlist (for watchlist mode)
    useEffect(() => {
        if (!isWatchlist || !selectedAsset?.symbol || currentPortfolioId === 'all') {
            setIsInWatchlist(false);
            return;
        }

        async function checkWatchlist() {
            const inWatchlist = await isSymbolInWatchlist(currentPortfolioId, selectedAsset.symbol);
            setIsInWatchlist(inWatchlist);
        }
        checkWatchlist();
    }, [isWatchlist, selectedAsset?.symbol, currentPortfolioId, watchlistAssets]);

    useEffect(() => {
        if (!selectedAssetSymbol) return;

        const isNewAsset = prevSymbolRef.current !== selectedAssetSymbol;

        // Only show loading for new asset or no price
        if (isNewAsset || !priceDataPriceRef.current) {
            setPriceData(prev => ({ ...prev, isLoading: true }));
        }
        prevSymbolRef.current = selectedAssetSymbol;

        async function fetchData() {
            // Priority: currency from selectedAsset, then symbol split
            let quoteCurr = selectedAssetCurrency;
            if (!quoteCurr) {
                const parts = selectedAssetSymbol.split(/[-/]/);
                quoteCurr = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'USD';
            }

            // Normalize asset symbol for fetching
            let fetchSym = selectedAssetSymbol;
            if (selectedAssetOriginalType === 'CRYPTOCURRENCY' && !fetchSym.includes('-')) {
                fetchSym += '-USD';
            }

            // Only upgrade bare fiat symbols (e.g. AUD -> AUDUSD=X) if it is a KNOWN currency type
            // Do NOT assume 3-letter symbols are currencies - TLT, SPY, etc. are ETFs
            const isCurrencyType = selectedAssetOriginalType === 'CURRENCY' || selectedAssetIsBareCurrencyOrigin;

            if (isCurrencyType && fetchSym.toUpperCase() !== 'USD' && !fetchSym.includes('=X')) {
                fetchSym = `${fetchSym.toUpperCase()}USD=X`;
            }

            let symbolsToFetch = [fetchSym];
            // For USD-to-base conversion, always fetch {base}USD=X (e.g., EURUSD=X), not the other way around
            if (baseCurrency !== 'USD') {
                symbolsToFetch.push(`${baseCurrency}USD=X`);
            }

            try {
                const res = await fetch(`/api/quote?symbols=${symbolsToFetch.join(',')}`);
                const json = await res.json();

                let fetchedPrice = null;
                let fetchedChange = null;
                let fetchedAbsChange = null;
                let fetchedCurrency = quoteCurr;
                let fetchedFxRate = 1;
                let fetchedMarketState = null;
                let fetchedPreMarketPrice = null;
                let fetchedPreMarketChange = null;
                let fetchedPostMarketPrice = null;
                let fetchedPostMarketChange = null;

                if (json.data) {
                    // Use case-insensitive matching for symbol to be robust
                    const assetQuote = json.data?.find(q =>
                        q.symbol?.toUpperCase() === fetchSym.toUpperCase() ||
                        q.symbol?.toUpperCase().replace(/-/g, '') === fetchSym.toUpperCase().replace(/-/g, '')
                    );

                    if (assetQuote) {
                        fetchedPrice = assetQuote.price;
                        fetchedChange = assetQuote.changePercent;
                        fetchedAbsChange = assetQuote.change;
                        fetchedCurrency = (assetQuote.currency || quoteCurr).toUpperCase();

                        // Store extended market data for better display
                        fetchedMarketState = assetQuote.marketState;
                        fetchedPreMarketPrice = assetQuote.preMarketPrice;
                        fetchedPreMarketChange = assetQuote.preMarketChangePercent;
                        fetchedPostMarketPrice = assetQuote.postMarketPrice;
                        fetchedPostMarketChange = assetQuote.postMarketChangePercent;
                    }

                    // For bare currencies (EUR from EUR=X → EURUSD=X), special handling:
                    // The assetPrice from EURUSD=X IS already the EUR/USD conversion rate
                    // So we should NOT multiply by fxRate again!
                    let bareCurrCode = null;
                    if ((selectedAssetIsBareCurrencyOrigin && fetchSym.endsWith('=X')) || (fetchSym.endsWith('USD=X') && fetchSym.length === 8)) {
                        const base = fetchSym.replace(/=X$/, '').replace(/USD$/, '');
                        bareCurrCode = base.toUpperCase();
                    }


                    // Track the actual FX rate for calculations (separate from display fxRate)
                    let actualFxRateValue = fetchedFxRate;

                    if (bareCurrCode) {
                        // BARE CURRENCY CASE:
                        // For EUR (EURUSD=X) with baseCurrency USD: price IS the rate, fxRate = 1 for display
                        // For EUR (EURUSD=X) with baseCurrency EUR: price = 1, fxRate = 1
                        // For AUD (AUDUSD=X) with baseCurrency EUR: price = AUDUSD, fxRate = USD/EUR = 1/EURUSD
                        if (bareCurrCode === baseCurrency) {
                            // Holding EUR, displaying in EUR → price is 1
                            fetchedPrice = 1;
                            fetchedFxRate = 1;
                            actualFxRateValue = 1;
                        } else if (baseCurrency === 'USD') {
                            // Holding EUR/AUD, displaying in USD → price = XXXUSD rate, fxRate = 1
                            actualFxRateValue = fetchedPrice; // The price IS the FX rate
                            fetchedFxRate = 1; // Don't double-convert for display!
                        } else {
                            // Holding AUD (AUDUSD=X price), displaying in EUR
                            // We need: AUD/EUR = (AUD/USD) * (USD/EUR) = AUDUSD * (1/EURUSD)
                            // fetchedPrice is already AUD/USD
                            // We need to get USD/EUR = 1 / EURUSD
                            try {
                                const baseToUsdSymbol = `${baseCurrency}USD=X`;
                                const fxRes = await fetch(`/api/quote?symbols=${baseToUsdSymbol}`);
                                const fxJson = await fxRes.json();
                                if (fxJson.data?.[0]?.price) {
                                    // baseToUsd is EURUSD = 1.04, so USD/EUR = 1/1.04 = 0.96
                                    const usdToBaseRate = 1 / fxJson.data[0].price;
                                    actualFxRateValue = fetchedPrice * usdToBaseRate;
                                    fetchedFxRate = usdToBaseRate; // For display of the conversion
                                } else {
                                    // Fallback: just use the USD price without conversion
                                    actualFxRateValue = fetchedPrice;
                                    fetchedFxRate = 1;
                                    console.warn(`Could not fetch ${baseToUsdSymbol} for conversion`);
                                }
                            } catch (e) {
                                console.error('Failed to fetch USD to base rate:', e);
                                actualFxRateValue = fetchedPrice;
                                fetchedFxRate = 1;
                            }
                        }
                    } else {
                        // REGULAR ASSET CASE: normal FX conversion
                        if (fetchedCurrency === baseCurrency) {
                            fetchedFxRate = 1;
                            actualFxRateValue = 1;
                        } else {
                            const expectedFxSymbol = `${fetchedCurrency}${baseCurrency}=X`;
                            let fxQuote = json.data?.find(q => q.symbol === expectedFxSymbol);

                            if (!fxQuote) {
                                try {
                                    const fxRes = await fetch(`/api/quote?symbols=${expectedFxSymbol}`);
                                    const fxJson = await fxRes.json();
                                    if (fxJson.data?.[0]) {
                                        fxQuote = fxJson.data[0];
                                    }
                                } catch (e) {
                                    console.error('Failed to fetch FX rate:', e);
                                }
                            }

                            if (fxQuote && fxQuote.price) {
                                fetchedFxRate = fxQuote.price;
                                actualFxRateValue = fxQuote.price;
                            } else {
                                // Yahoo often lacks direct USD->non-USD or cross pairs. Pivot via USD.
                                let toUsdRate = 1;
                                if (fetchedCurrency !== 'USD') {
                                    const toUsdSymbol = `${fetchedCurrency}USD=X`;
                                    let toUsdQuote = json.data?.find(q => q.symbol === toUsdSymbol);
                                    if (!toUsdQuote) {
                                        try {
                                            const fxRes = await fetch(`/api/quote?symbols=${toUsdSymbol}`);
                                            const fxJson = await fxRes.json();
                                            toUsdQuote = fxJson.data?.[0];
                                        } catch (e) {
                                            console.error('Failed to fetch quote-to-USD FX rate:', e);
                                        }
                                    }
                                    if (toUsdQuote?.price) toUsdRate = toUsdQuote.price;
                                }

                                let fromUsdRate = 1;
                                if (baseCurrency !== 'USD') {
                                    const baseToUsdSymbol = `${baseCurrency}USD=X`;
                                    let baseToUsdQuote = json.data?.find(q => q.symbol === baseToUsdSymbol);
                                    if (!baseToUsdQuote) {
                                        try {
                                            const fxRes = await fetch(`/api/quote?symbols=${baseToUsdSymbol}`);
                                            const fxJson = await fxRes.json();
                                            baseToUsdQuote = fxJson.data?.[0];
                                        } catch (e) {
                                            console.error('Failed to fetch base-to-USD FX rate:', e);
                                        }
                                    }
                                    if (baseToUsdQuote?.price) fromUsdRate = 1 / baseToUsdQuote.price;
                                }

                                fetchedFxRate = toUsdRate * fromUsdRate;
                                actualFxRateValue = fetchedFxRate;
                            }
                        }
                    }

                    // Store actualFxRate for later use
                    var fetchedActualFxRate = actualFxRateValue;
                }

                // Initializer vars for update
                let fetchedAbsChangeValue = fetchedAbsChange;

                // Fetch historical FX if needed
                // For bare currencies, use the bare currency code, not the Yahoo-reported currency
                let fetchedHMap = {};
                let currencyForHistory = fetchedCurrency;
                if (selectedAssetIsBareCurrencyOrigin && fetchSym.endsWith('=X')) {
                    const base = fetchSym.replace('=X', '');
                    currencyForHistory = base.length > 4 ? base.substring(0, 3).toUpperCase() : base.toUpperCase();
                }

                if (currencyForHistory && currencyForHistory !== baseCurrency) {
                    try {
                        fetchedHMap = await buildHistoricalConversionMap(currencyForHistory, baseCurrency);
                    } catch (e) {
                        console.error('Failed to fetch historical FX:', e);
                    }
                }

                // Fetch conversion history for every quote/fee currency used by the ledger.
                // Needed for cost basis across mixed quote currencies and crypto-to-crypto trades.
                const fetchedTransactionFx = {};
                if (transactions && transactions.length > 0) {
                    const conversionCurrencies = new Set();
                    transactions.forEach(t => {
                        [t.quoteCurrency, t.feeCurrency].forEach(curr => {
                            const normalized = normalizeAsset(curr);
                            if (normalized && normalized !== baseCurrency) conversionCurrencies.add(normalized);
                        });
                    });

                    await Promise.all([...conversionCurrencies].map(async (curr) => {
                        if (curr !== baseCurrency) {
                            try {
                                fetchedTransactionFx[curr] = await buildHistoricalConversionMap(curr, baseCurrency);
                            } catch (e) {
                                console.error(`Failed to fetch conversion history for ${curr}:`, e);
                                fetchedTransactionFx[curr] = {};
                            }
                        }
                    }));
                }

                // Update currency in selectedAsset if needed (won't re-trigger effect)
                if (fetchedCurrency !== selectedAssetCurrency) {
                    setSelectedAsset(prev => prev ? { ...prev, currency: fetchedCurrency } : prev);
                }
                // Update name if we don't have a descriptive one yet (missing or same as symbol)
                setSelectedAsset(prev => {
                    if (!prev) return null;
                    const isGenericName = !prev.name || prev.name === prev.symbol;
                    // Find the assetQuote again to get the name
                    const assetQuote = json.data?.find(q =>
                        q.symbol?.toUpperCase() === fetchSym.toUpperCase() ||
                        q.symbol?.toUpperCase().replace(/-/g, '') === fetchSym.toUpperCase().replace(/-/g, '')
                    );
                    return { ...prev, name: isGenericName ? (assetQuote?.name || prev.name) : prev.name };
                });

                // SINGLE atomic update - guarantees exactly one render
                setPriceData({
                    price: fetchedPrice,
                    change: fetchedAbsChangeValue,
                    changePercent: fetchedChange,
                    fxRate: fetchedFxRate,
                    actualFxRate: fetchedActualFxRate || fetchedFxRate,
                    historicalFx: fetchedHMap,
                    transactionFx: fetchedTransactionFx,
                    marketState: fetchedMarketState,
                    preMarketPrice: fetchedPreMarketPrice,
                    preMarketChange: fetchedPreMarketChange,
                    postMarketPrice: fetchedPostMarketPrice,
                    postMarketChange: fetchedPostMarketChange,
                    isLoading: false
                });
            } catch (e) {
                console.error(e);
                setPriceData(prev => ({ ...prev, isLoading: false }));
            }
        }

        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [
        selectedAssetSymbol,
        selectedAssetCurrency,
        selectedAssetOriginalType,
        selectedAssetIsBareCurrencyOrigin,
        baseCurrency,
        transactions
    ]);

    // Destructure for easy access throughout component
    const {
        price: assetPrice,
        change: assetChange,
        changePercent,
        fxRate,
        transactionFx,
        isLoading: loadingPrice,
        marketState: currentMarketState,
        preMarketPrice: currentPrePrice,
        preMarketChange: currentPreChange,
        postMarketPrice: currentPostPrice,
        postMarketChange: currentPostChange
    } = priceData;

    const livePriceSnapshot = useMemo(() => {
        let localPrice = toFiniteNumber(assetPrice);
        let localChangePercent = toFiniteNumber(changePercent);
        let localAbsChange = toFiniteNumber(assetChange);

        if (currentMarketState?.includes('PRE') && toFiniteNumber(currentPrePrice) > 0) {
            localPrice = toFiniteNumber(currentPrePrice);
            localChangePercent = toFiniteNumber(currentPreChange);
            localAbsChange = localPrice - (localPrice / (1 + (localChangePercent / 100)));
        } else if (currentMarketState?.includes('POST') && toFiniteNumber(currentPostPrice) > 0) {
            localPrice = toFiniteNumber(currentPostPrice);
            localChangePercent = toFiniteNumber(currentPostChange);
            localAbsChange = localPrice - (localPrice / (1 + (localChangePercent / 100)));
        }

        return {
            localPrice,
            changePercent: localChangePercent,
            absChange: localAbsChange,
            priceBase: localPrice * fxRate,
            absChangeBase: localAbsChange * fxRate
        };
    }, [
        assetPrice,
        assetChange,
        changePercent,
        currentMarketState,
        currentPrePrice,
        currentPreChange,
        currentPostPrice,
        currentPostChange,
        fxRate
    ]);

    const liveAssetPrice = livePriceSnapshot.localPrice;

    const assetTransactions = selectedAsset
        ? transactions.filter(t => {
            const normalizedBase = normalizeAsset(t.baseCurrency);
            const normalizedTarget = normalizeAsset(selectedAsset.symbol);

            // Case 1: This asset is the base (e.g. Bought BTC)
            if (normalizedBase === normalizedTarget) return true;

            // Case 2: This asset is the quote (e.g. Bought BTC with USD, looking at USD)
            if (normalizeAsset(t.quoteCurrency) === normalizedTarget) {
                // HIDE FROM HISTORY if specifically marked as not affecting balance
                if (t.affectsFiatBalance === false) return false;
                return true;
            }
            return false;
        })
            .map(t => {
                const isReverse = normalizeAsset(t.quoteCurrency) === normalizeAsset(selectedAsset.symbol);
                return { ...t, isReverse };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date))
        : [];

    const selectedSymbol = selectedAsset?.symbol;

    const assetAccounting = useMemo(() => {
        if (!selectedSymbol) {
            return {
                currentBalance: 0,
                averagePurchasePrice: 0,
                remainingCostBasis: 0
            };
        }

        return calculateAssetAccounting(
            transactions,
            selectedSymbol,
            baseCurrency,
            (from, to, dateStr) => {
                const historicalRate = getHistoricalConversionRate(transactionFx, from, to, dateStr);
                if (historicalRate) return historicalRate;

                const fromAsset = normalizeAsset(from);
                const selectedCurrency = normalizeAsset(selectedAsset?.currency);
                if (fromAsset && selectedCurrency && fromAsset === selectedCurrency) {
                    return fxRate || null;
                }

                return null;
            }
        );
    }, [transactions, selectedSymbol, transactionFx, baseCurrency, selectedAsset?.currency, fxRate]);

    const {
        currentBalance = 0,
        averagePurchasePrice = 0,
        remainingCostBasis: currentCostBasisBase = 0,
        realizedPnl: realizedProfitBase = 0
    } = assetAccounting;

    const currentValueBase = currentBalance * liveAssetPrice * fxRate;
    const isSelectedFiat = isFiatAsset(selectedSymbol);
    const unrealizedProfitBase = isSelectedFiat ? 0 : currentValueBase - currentCostBasisBase;
    const totalProfitBase = isSelectedFiat ? 0 : unrealizedProfitBase + realizedProfitBase;

    const getDisplayQuoteCurrency = (tx) => {
        const explicitQuote = normalizeAsset(tx.quoteCurrency);
        if (explicitQuote) return explicitQuote;

        const rawBase = String(tx.baseCurrency || '').toUpperCase();
        if (rawBase.includes('-') || rawBase.includes('/')) {
            return getQuoteCurrencyFromSymbol(rawBase) || baseCurrency;
        }

        return baseCurrency;
    };

    const toggleAssetSummaryMetric = () => {
        setAssetSummaryMetric(prev => {
            const index = ASSET_SUMMARY_METRICS.indexOf(prev);
            return ASSET_SUMMARY_METRICS[(index + 1) % ASSET_SUMMARY_METRICS.length];
        });
    };

    const isAssetProfitMetric = assetSummaryMetric !== 'value';
    const isAssetRealizedMetric = assetSummaryMetric === 'realized';
    const isAssetUnrealizedMetric = assetSummaryMetric === 'unrealized';
    const assetSummaryValue = isAssetRealizedMetric
        ? realizedProfitBase
        : isAssetUnrealizedMetric
            ? unrealizedProfitBase
            : assetSummaryMetric === 'total'
                ? totalProfitBase
                : currentValueBase;
    const assetSummaryLabel = isAssetRealizedMetric
        ? 'Realized P/L'
        : isAssetUnrealizedMetric
            ? 'Unrealized P/L'
            : assetSummaryMetric === 'total'
                ? 'Total P/L'
                : 'Total Value';
    const nextAssetSummaryLabel = assetSummaryMetric === 'value'
        ? 'Total P/L'
        : assetSummaryMetric === 'total'
            ? 'Realized P/L'
            : assetSummaryMetric === 'realized'
                ? 'Unrealized P/L'
                : 'Total Value';
    const assetSummarySign = isAssetProfitMetric || isAssetRealizedMetric
        ? (assetSummaryValue >= 0 ? '+' : '-')
        : (assetSummaryValue < 0 ? '-' : '');
    const assetSummaryClass = isAssetProfitMetric
        ? (assetSummaryValue >= 0 ? 'text-success' : 'text-danger')
        : 'text-success';
    const canShowAssetSummary = !loadingPrice && (isAssetRealizedMetric || liveAssetPrice);

    const handleAssetSelect = (asset) => {
        const balance = calculateAssetAccounting(transactions, asset.symbol, baseCurrency).currentBalance;

        setSelectedAsset({
            symbol: asset.symbol,
            name: asset.name || asset.shortname || asset.symbol,
            price: null,
            amount: balance,
            originalType: asset.type,
            currency: asset.currency, // Use currency from search result
            isBareCurrencyOrigin: asset.isBareCurrencyOrigin || false
        });
        setCurrentView('LIST');
        setAssetTab('overview');
        setEditingTx(null);
    };

    // Watchlist handlers
    const handleAddToWatchlist = async () => {
        if (!selectedAsset || currentPortfolioId === 'all') return;
        await addWatchlistAsset(currentPortfolioId, {
            symbol: selectedAsset.symbol,
            name: selectedAsset.name || selectedAsset.symbol,
            type: selectedAsset.originalType || 'EQUITY',
            currency: selectedAsset.currency || 'USD'
        });
        setIsInWatchlist(true);
        if (onWatchlistUpdate) await onWatchlistUpdate();
    };

    const handleRemoveFromWatchlist = async () => {
        if (!selectedAsset || currentPortfolioId === 'all') return;
        await removeWatchlistAsset(currentPortfolioId, selectedAsset.symbol);
        setIsInWatchlist(false);
        if (onWatchlistUpdate) await onWatchlistUpdate();
        onClose(); // Close after removing
    };

    const handleEdit = (tx) => {
        setEditingTx(tx);
        setCurrentView('FORM');
    };

    const handleBack = () => {
        if (currentView === 'FORM') {
            setCurrentView('LIST');
            setEditingTx(null);
        } else {
            // Close modal from SEARCH or LIST views
            onClose();
        }
    };

    const toList = () => {
        setCurrentView('LIST');
    };

    // Let the open animation run on a clear main thread, then mount the chart.
    useEffect(() => {
        const raf = requestAnimationFrame(() => {
            const raf2 = requestAnimationFrame(() => setHeavyReady(true));
            heavyRafRef.current = raf2;
        });
        heavyRafRef.current = raf;
        return () => cancelAnimationFrame(heavyRafRef.current);
    }, []);

    // --- Bottom-sheet drag-to-dismiss (handle only) ---
    const DISMISS_DISTANCE = 130;   // px dragged before it dismisses on release
    const DISMISS_VELOCITY = 0.55;  // px/ms flick velocity that dismisses regardless of distance

    const setSheetTransform = (dy) => {
        if (sheetRef.current) {
            sheetRef.current.style.transform = dy > 0 ? `translateY(${dy}px)` : 'translateY(0)';
        }
        if (backdropRef.current) {
            // Fade the backdrop as the sheet is pulled down
            const progress = Math.min(Math.max(dy, 0) / 400, 1);
            backdropRef.current.style.opacity = String(1 - progress * 0.6);
        }
    };

    const handleDragStart = (e) => {
        // Allow dragging from the grabber and the header, but never hijack a tap
        // on an interactive control (back arrow, buttons, selects, inputs).
        if (e.target.closest('button, select, input, textarea, a')) return;
        dragState.current = { active: true, startY: e.clientY, startTime: Date.now(), dy: 0 };
        if (sheetRef.current) sheetRef.current.style.transition = 'none';
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
    };

    const handleDragMove = (e) => {
        const s = dragState.current;
        if (!s.active) return;
        let dy = e.clientY - s.startY;
        // Resist upward drag with damping — nothing in the real world stops hard
        if (dy < 0) dy = dy / 4;
        s.dy = dy;
        setSheetTransform(dy);
    };

    const handleDragEnd = () => {
        const s = dragState.current;
        if (!s.active) return;
        s.active = false;
        const elapsed = Math.max(Date.now() - s.startTime, 1);
        const velocity = s.dy / elapsed;

        if (sheetRef.current) {
            sheetRef.current.style.transition = 'transform 260ms var(--ease-drawer)';
        }

        if (s.dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
            if (sheetRef.current) sheetRef.current.style.transform = 'translateY(100%)';
            if (backdropRef.current) backdropRef.current.style.opacity = '0';
            setTimeout(() => onClose(), 200);
        } else {
            setSheetTransform(0);
        }
    };

    // Only the add/edit transaction FORM is presented as a drag-to-dismiss bottom
    // sheet. Watching an asset (LIST) and searching stay full-screen.
    const isSheet = currentView === 'FORM';

    return (
        <div
            ref={backdropRef}
            className={isSheet ? 'animate-overlay' : ''}
            onClick={isSheet ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                alignItems: isSheet ? 'flex-end' : 'stretch',
                justifyContent: 'center',
                background: isSheet ? 'rgba(0, 0, 0, 0.6)' : 'transparent'
            }}
        >
            <div
                ref={sheetRef}
                className={isSheet ? 'animate-sheet' : 'animate-modal'}
                style={isSheet ? {
                    position: 'relative',
                    width: '100%',
                    maxWidth: '640px',
                    maxHeight: '92dvh',
                    backgroundColor: 'var(--background-elevated)',
                    color: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    borderTopLeftRadius: '24px',
                    borderTopRightRadius: '24px',
                    overflow: 'hidden',
                    boxShadow: '0 -8px 40px rgba(0, 0, 0, 0.5)',
                    border: '1px solid var(--card-border)',
                    borderBottom: 'none',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)'
                } : {
                    position: 'relative',
                    width: '100%',
                    maxWidth: '100%',
                    height: '100dvh',
                    backgroundColor: '#000',
                    color: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    paddingTop: 'env(safe-area-inset-top, 0px)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)'
                }}
            >
                {/* Drag handle — sheet only */}
                {isSheet && (
                    <div
                        onPointerDown={handleDragStart}
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '10px 0 6px', cursor: 'grab', touchAction: 'none' }}
                    >
                        <div style={{ width: '40px', height: '5px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.18)' }} />
                    </div>
                )}
            {/* Header Area — also draggable when presented as a sheet */}
            <div
                className="flex items-center justify-between p-4 sm:p-6 sm:px-8"
                style={{ borderBottom: '1px solid #262626', flexShrink: 0, ...(isSheet ? { touchAction: 'none', cursor: 'grab' } : {}) }}
                onPointerDown={isSheet ? handleDragStart : undefined}
                onPointerMove={isSheet ? handleDragMove : undefined}
                onPointerUp={isSheet ? handleDragEnd : undefined}
                onPointerCancel={isSheet ? handleDragEnd : undefined}
            >
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleBack}
                        className="p-2 -ml-2 rounded-full hover-bg-surface transition-all text-muted hover:text-white"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <div className="flex flex-col min-w-0">
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight truncate" style={{ margin: 0 }}>
                            {currentView === 'SEARCH' ? 'Add Asset' : (() => {
                                // Get base symbol without currency suffix
                                const baseSymbol = selectedAsset?.symbol?.split(/[-/]/)[0];
                                
                                // Check if it's a commodity
                                const commodityName = COMMODITY_NAMES[baseSymbol];
                                if (commodityName) {
                                    const quoteCurr = editingTx?.quoteCurrency?.toUpperCase() || selectedAsset?.currency || 'USD';
                                    return `${commodityName} ${quoteCurr}`;
                                }
                                
                                // Regular asset - reconstruct name with correct currency
                                if (editingTx?.quoteCurrency && selectedAsset?.name) {
                                    return selectedAsset.name.replace(/\s+[A-Z]{3}$/, ` ${editingTx.quoteCurrency.toUpperCase()}`);
                                }
                                
                                return selectedAsset?.name || selectedAsset?.symbol || 'Details';
                            })()}
                        </h2>
                        {currentView === 'LIST' && selectedAsset?.symbol && (
                            <span className="text-[10px] sm:text-xs text-muted font-bold truncate uppercase tracking-widest opacity-80">
                                {editingTx?.quoteCurrency 
                                    ? `${selectedAsset.symbol.split(/[-/]/)[0]}-${editingTx.quoteCurrency.toUpperCase()}`
                                    : selectedAsset.symbol}
                            </span>
                        )}
                    </div>
                </div>
                {currentView === 'LIST' && selectedAsset && (
                    isWatchlist ? (
                        // Watchlist mode - show add/remove button
                        isInWatchlist ? (
                            <button
                                onClick={handleRemoveFromWatchlist}
                                className="btn flex items-center gap-2"
                                style={{
                                    padding: '10px 20px',
                                    background: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    fontWeight: '700'
                                }}
                            >
                                <EyeOff size={18} />
                                <span className="hidden sm:inline">Remove</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleAddToWatchlist}
                                className="btn flex items-center gap-2"
                                style={{
                                    padding: '10px 20px',
                                    background: 'white',
                                    color: 'black',
                                    border: 'none',
                                    fontWeight: '700'
                                }}
                            >
                                <Eye size={18} />
                                <span className="hidden sm:inline">Add to Watchlist</span>
                            </button>
                        )
                    ) : (
                        // Regular portfolio mode - show add transaction button
                        <button
                            onClick={() => { setEditingTx(null); setCurrentView('FORM'); }}
                            className="btn flex items-center gap-2"
                            style={{ padding: '10px 20px' }}
                        >
                            <Plus size={18} />
                            <span className="hidden sm:inline">Add Transaction</span>
                        </button>
                    )
                )}
            </div>

            <div
                ref={modalRef}
                className="flex-1 overflow-y-auto p-6"
                style={{
                    minHeight: 0,
                    paddingBottom: '40px',
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain'
                }}
            >
                <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>

                    {currentView === 'SEARCH' && (
                        <AssetSearch onSelect={handleAssetSelect} onCancel={onClose} />
                    )}

                    {currentView === 'LIST' && selectedAsset && (
                        <div className="flex flex-col gap-4">
                            {/* Tab Navigation - only show for individual stocks (EQUITY) AND NOT WATCHLIST */}
                            {selectedAsset.originalType === 'EQUITY' && !isWatchlist && (
                                <div className="flex gap-2 p-1 rounded-full" style={{ background: '#171717' }}>
                                    <button
                                        onClick={() => setAssetTab('overview')}
                                        className="flex-1 text-xs font-bold rounded-full transition-all"
                                        style={{
                                            background: assetTab === 'overview' ? 'white' : 'transparent',
                                            color: assetTab === 'overview' ? 'black' : '#a1a1aa',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '12px 16px',
                                            boxShadow: assetTab === 'overview' ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none'
                                        }}
                                    >
                                        OVERVIEW
                                    </button>
                                    <button
                                        onClick={() => setAssetTab('financials')}
                                        className="flex-1 text-xs font-bold rounded-full transition-all"
                                        style={{
                                            background: assetTab === 'financials' ? 'white' : 'transparent',
                                            color: assetTab === 'financials' ? 'black' : '#a1a1aa',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '12px 16px',
                                            boxShadow: assetTab === 'financials' ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none'
                                        }}
                                    >
                                        FINANCIALS
                                    </button>
                                </div>
                            )}

                            {/* Overview Tab */}
                            {assetTab === 'overview' && (
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-start mb-4 gap-4">
                                        <div className="flex flex-col flex-1 items-start">
                                            <span className="text-xs sm:text-sm text-muted uppercase tracking-wider flex items-center gap-1.5">
                                                Current Price
                                                {currentMarketState && currentMarketState !== 'REGULAR' && currentMarketState !== 'CLOSED' && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)', marginLeft: '5px' }}>
                                                        {currentMarketState.includes('PRE') ? (
                                                            <Sun size={10} className="text-amber-400" />
                                                        ) : (
                                                            <Moon size={10} className="text-blue-400" />
                                                        )}
                                                        <span style={{ display: 'none' }} className="opacity-80">{currentMarketState.includes('PRE') ? 'Pre' : 'After'}</span>
                                                    </span>
                                                )}
                                            </span>
                                            {loadingPrice || !liveAssetPrice ? (
                                                <div className="h-7 w-24 bg-white-10 rounded animate-pulse mt-1" />
                                            ) : (() => {
                                                const displayChange = livePriceSnapshot.changePercent;
                                                const displayAbsChange = livePriceSnapshot.absChange;
                                                return (
                                                    <div className="flex flex-col">
                                                        <div className="flex items-baseline gap-2">
                                                            <span className={`text sm:text-2xl font-bold`}>
                                                                {livePriceSnapshot.priceBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                                            </span>
                                                            {/* 1D change on the right when viewing different timeframe - ONLY FOR WATCHLIST */}
                                                            {rangePerformance && rangePerformance.range !== '1D' && isWatchlist && (
                                                                <span className={`text-xs font-medium ${displayChange >= 0 ? 'text-success' : 'text-danger'}`}>
                                                                    {displayAbsChange >= 0 ? '+' : ''}{livePriceSnapshot.absChangeBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({displayChange >= 0 ? '+' : ''}{displayChange.toFixed(2)}%)
                                                                </span>
                                                            )}
                                                        </div>
                                                        {/* Show 1D change below when viewing 1D, or selected timeframe when not 1D */}
                                                        {(!rangePerformance || rangePerformance.range === '1D') ? (
                                                            <span className={`text-xs font-medium ${displayChange >= 0 ? 'text-success' : 'text-danger'}`}>
                                                                {displayAbsChange >= 0 ? '+' : ''}{livePriceSnapshot.absChangeBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({displayChange >= 0 ? '+' : ''}{displayChange.toFixed(2)}%)
                                                            </span>
                                                        ) : (
                                                            <span className={`text-xs font-medium ${rangePerformance.changePercent >= 0 ? 'text-success' : 'text-danger'}`}>
                                                                {rangePerformance.change >= 0 ? '+' : ''}{(rangePerformance.change * fxRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({rangePerformance.changePercent >= 0 ? '+' : ''}{rangePerformance.changePercent.toFixed(2)}%)
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        {/* Hide Avg Purchase and Total Value for Watchlists */}
                                        {!isWatchlist && (
                                            <>
                                                {/* Only show Avg Purchase if there are BUY transactions (avgPrice > 0) */}
                                                {averagePurchasePrice > 0 && (
                                                    <div className="flex flex-col flex-1 items-center">
                                                        <span className="text-xs sm:text-sm text-muted uppercase tracking-wider text-center">Avg Purchase</span>
                                                        {loadingPrice ? (
                                                            <div className="h-7 w-24 bg-white-10 rounded animate-pulse mt-1" />
                                                        ) : (
                                                            <span className="text sm:text-2xl text-center">
                                                                {averagePurchasePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={toggleAssetSummaryMetric}
                                                    className="flex flex-col flex-1 items-end text-right active-scale"
                                                    style={{
                                                        background: 'transparent',
                                                        border: 'none',
                                                        padding: 0,
                                                        cursor: 'pointer',
                                                        touchAction: 'manipulation',
                                                        minHeight: '48px'
                                                    }}
                                                    title={`Show ${nextAssetSummaryLabel}`}
                                                    aria-label={`${assetSummaryLabel}: ${hideBalances ? 'hidden' : `${assetSummarySign}${Math.abs(assetSummaryValue).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}`}
                                                >
                                                    <span className="text-xs sm:text-sm text-muted uppercase tracking-wider text-right">{assetSummaryLabel}</span>
                                                    {!canShowAssetSummary ? (
                                                        <div className="h-7 w-32 bg-white-10 rounded animate-pulse mt-1" />
                                                    ) : (
                                                        <span className={`text sm:text-2xl text-right ${assetSummaryClass}`}>
                                                            {hideBalances ? '••••••' : `${assetSummarySign}${Math.abs(assetSummaryValue).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                                        </span>
                                                    )}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    <div className="w-full">
                                        {!heavyReady ? <ChartSkeleton /> : (
                                        <AssetChart
                                            symbol={selectedAsset.symbol}
                                            baseCurrency={baseCurrency}
                                            fxRate={fxRate}
                                            parentLoading={loadingPrice}
                                            assetCurrency={selectedAsset.currency || priceData.currency}
                                            // If it's a currency not equal to base, pass the constructed pair (e.g. AUDUSD=X)
                                            // otherwise pass null to let AssetChart decide or use default logic
                                            // Improved logic: Anchored to USD
                                            chartSymbol={(() => {
                                                const s = selectedAsset.symbol;
                                                // Only treat as currency if explicitly marked - don't assume based on length
                                                const isBare = selectedAsset.isBareCurrencyOrigin ||
                                                    selectedAsset.originalType === 'CURRENCY';

                                                if (isBare && !s.includes('=X') && !s.includes('-')) {
                                                    // Always use USD pair (AUD -> AUDUSD=X)
                                                    // If the asset is 'USD', it's special (handled by AssetChart or no chart)
                                                    if (s === 'USD') return s;
                                                    return `${s}USD=X`;
                                                }
                                                return s;
                                            })()}
                                            onRangePerformance={setRangePerformance}
                                            transactions={assetTransactions.filter(tx => !tx.isReverse)}
                                        />
                                        )}
                                    </div>

                                    {/* Earnings Event - for both watchlist and portfolio equities */}
                                    {selectedAsset.originalType === 'EQUITY' && (
                                        <div className="mt-4">
                                            <EarningsEvent symbol={selectedAsset.symbol} />
                                        </div>
                                    )}

                                    {/* Transactions List - hidden for watchlists */}
                                    {!isWatchlist ? (
                                        <div>
                                            <h3 className="text-xl text-muted" style={{ marginBottom: '1rem' }}>History</h3>
                                            <div className="flex flex-col gap-2">
                                                {assetTransactions.length === 0 ? (
                                                    <p className="text-muted py-10 text-center">No transactions recorded.</p>
                                                ) : (
                                                    assetTransactions.map(tx => (
                                                        <div key={tx.id} className="flex justify-between items-center p-4 rounded-2xl hover-bg-surface transition-all" style={{ border: '1px solid transparent' }}>
                                                            <div className="flex items-center gap-4">
                                                                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: tx.isReverse ? (tx.type === 'BUY' ? '#ef4444' : '#22c55e') : (['BUY', 'DEPOSIT'].includes(tx.type) ? '#22c55e' : '#ef4444') }} />
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold" style={{ fontSize: '1rem' }}>
                                                                        {tx.isReverse ? (tx.type === 'BUY' ? 'SPENT' : 'RECEIVED') : tx.type}
                                                                    </span>
                                                                    <span className="text-sm text-muted">
                                                                        {tx.isReverse ? `${tx.type === 'BUY' ? 'Purchased' : 'Sold'} ${tx.baseCurrency} | ` : ''}
                                                                        {new Date(tx.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                                                    </span>
                                                                    {tx.notes && (
                                                                        <span className="text-xs text-muted" style={{ fontStyle: 'italic', marginTop: '2px', opacity: 0.7 }}>
                                                                            {tx.notes}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="flex-1 flex flex-col items-end">
                                                                {tx.type === 'BUY' && !tx.isReverse && (
                                                                    <>
                                                                        {loadingPrice || !liveAssetPrice ? (
                                                                            <div className="h-5 w-20 bg-white-10 rounded animate-pulse ml-auto" style={{ marginRight: '10px' }} />
                                                                        ) : (
                                                                            (() => {
                                                                                const dateStr = tx.date.split('T')[0];
                                                                                const txQuoteCurrency = getDisplayQuoteCurrency(tx);
                                                                                const costFx = getHistoricalConversionRate(transactionFx, txQuoteCurrency, baseCurrency, dateStr) || 0;
                                                                                const costBase = tx.quoteAmount * costFx;
                                                                                const currentValBase = tx.baseAmount * liveAssetPrice * fxRate;
                                                                                const pnlBase = currentValBase - costBase;
                                                                                const pnlPercent = costBase > 0 ? (pnlBase / costBase) * 100 : 0;
                                                                                if (costBase <= 0) {
                                                                                    return null;
                                                                                }
                                                                                return (
                                                                                    <span style={{ textAlign: 'right', marginRight: '10px' }} className={`text-sm font-bold ${pnlBase >= 0 ? 'text-success' : 'text-danger'}`}>
                                                                                        {hideBalances ? '' : `${pnlBase >= 0 ? '+' : '-'}${Math.abs(pnlBase).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} `}
                                                                                        ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                                                                                    </span>
                                                                                );
                                                                            })()
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-4">
                                                                <div className="flex flex-col items-end">
                                                                    <span className="font-mono font-medium" style={{ fontSize: '1rem' }}>
                                                                        {hideBalances ? '••••' : (tx.isReverse ? tx.quoteAmount : tx.baseAmount).toLocaleString()} {tx.isReverse ? tx.quoteCurrency : tx.baseCurrency}
                                                                    </span>
                                                                    {(tx.quoteAmount > 0 && !tx.isReverse) && (
                                                                        <div className="flex items-center gap-1">
                                                                            {loadingPrice ? (
                                                                                <div className="h-3 w-12 bg-white-10 rounded animate-pulse ml-auto" />
                                                                            ) : (
                                                                                <span className="text-xs text-muted">
                                                                                    {(() => {
                                                                                        const dateStr = tx.date.split('T')[0];
                                                                                        const txQuoteCurrency = getDisplayQuoteCurrency(tx);
                                                                                        const costFx = getHistoricalConversionRate(transactionFx, txQuoteCurrency, baseCurrency, dateStr) || 0;
                                                                                        return `${((tx.quoteAmount / tx.baseAmount) * costFx).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`;
                                                                                    })()}
                                                                                </span>
                                                                            )}
                                                                            {tx.type === 'BUY' && (
                                                                                loadingPrice || !liveAssetPrice ? (
                                                                                    <div className="h-3 w-8 bg-white-10 rounded animate-pulse ml-auto" style={{ marginLeft: '5px' }} />
                                                                                ) : (
                                                                                    <span className={`text-xs text-[10px] ${(tx.affectsQuoteBalance ?? tx.affectsFiatBalance) === false ? 'text-muted/50 decoration-line-through' : 'text-muted'}`} title={(tx.affectsQuoteBalance ?? tx.affectsFiatBalance) === false ? "Did not affect balance" : "Affected balance"}>
                                                                                        | {hideBalances ? '••••••' : (() => {
                                                                                            const dateStr = tx.date.split('T')[0];
                                                                                            const txQuoteCurrency = getDisplayQuoteCurrency(tx);
                                                                                            const hFx = getHistoricalConversionRate(transactionFx, txQuoteCurrency, baseCurrency, dateStr) || 0;
                                                                                            return `${(tx.quoteAmount * hFx).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`;
                                                                                        })()}
                                                                                    </span>
                                                                                )
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                <div className="flex flex-col">
                                                                    {!tx.isReverse && (
                                                                        <>
                                                                            <button onClick={() => handleEdit(tx)} className="p-1 text-muted hover:text-white hover-bg-surface rounded-full transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                <Edit2 size={16} />
                                                                            </button>
                                                                            <button onClick={() => setDeleteConfirm({ id: tx.id, type: tx.type, date: tx.date })} className="p-1 text-danger hover-bg-surface rounded-full transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        selectedAsset.originalType === 'EQUITY' && (
                                            <div className="mt-8">
                                                <FinancialInfo
                                                    symbol={selectedAsset.symbol}
                                                    baseCurrency={baseCurrency}
                                                />
                                            </div>
                                        )
                                    )}
                                </div>
                            )}

                            {/* Financials Tab */}
                            {assetTab === 'financials' && (
                                <FinancialInfo
                                    symbol={selectedAsset.symbol}
                                    baseCurrency={baseCurrency}
                                />
                            )}
                        </div>
                    )}

                    {currentView === 'FORM' && selectedAsset && (
                        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                            <TransactionForm
                                holding={selectedAsset}
                                existingTx={editingTx}
                                transactions={transactions}
                                fetchedCurrency={selectedAsset.currency}
                                portfolios={portfolios}
                                currentPortfolioId={currentPortfolioId}
                                baseCurrency={baseCurrency}
                                onSave={(tx) => { onSave(tx); setCurrentView('LIST'); setEditingTx(null); }}
                                onCancel={toList}
                            />
                        </div>
                    )}
                </div>
            </div>
            </div>

            {/* Delete Confirmation Modal — sibling of the sheet so the sheet's
                transform/overflow doesn't clip or offset this fixed overlay */}
            <ConfirmModal
                isOpen={deleteConfirm !== null}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={() => {
                    if (deleteConfirm) onDelete(deleteConfirm.id);
                }}
                title="Delete Transaction"
                message={`Delete this ${deleteConfirm?.type || 'transaction'} from ${deleteConfirm?.date ? new Date(deleteConfirm.date).toLocaleDateString() : 'this date'}? This cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                confirmStyle="danger"
            />
        </div >
    );
}

function TransactionForm({ holding, existingTx, transactions, onSave, onCancel, fetchedCurrency, portfolios = [], currentPortfolioId = 'all', baseCurrency = 'USD' }) {
    // Standardize symbol access
    const sym = holding.symbol || holding.asset;

    // Detect if this is a bare currency (e.g., EUR=X, USD=X - not a pair like EURUSD=X)
    // Bare currencies can only have DEPOSIT/WITHDRAW, not BUY/SELL
    // Also check isBareCurrencyOrigin flag (set when EUR=X is converted to EURUSD=X)
    const isBareCurrency = useMemo(() => {
        // If it was originally a bare currency (EUR=X → EURUSD=X), respect that
        if (holding.isBareCurrencyOrigin) return true;

        if (!sym) return false;
        const upper = sym.toUpperCase();
        // EUR=X, USD=X format: ends with =X and the base part is 3-4 characters (currency code)
        if (upper.endsWith('=X')) {
            const base = upper.replace('=X', '');
            // It's bare if it's a short currency code (not a pair like EURUSD=X)
            return base.length <= 4;
        }
        return false;
    }, [sym, holding.isBareCurrencyOrigin]);

    // Get the currency code from bare currency symbol (EUR from EUR=X or EURUSD=X)
    const bareCurrencyCode = useMemo(() => {
        if (!isBareCurrency || !sym) return null;
        const upper = sym.toUpperCase().replace('=X', '');
        // For EURUSD=X (converted from EUR=X), extract EUR
        if (upper.length > 4) {
            return upper.substring(0, 3);
        }
        return upper;
    }, [isBareCurrency, sym]);

    // Available transaction types - bare currencies are limited
    const availableTypes = isBareCurrency ? ['DEPOSIT', 'WITHDRAW'] : ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'];

    // Show portfolio selector if in 'All' view with multiple regular (non-watchlist) portfolios
    const regularPortfolios = portfolios.filter(p => !p.isWatchlist);
    const showPortfolioSelector = currentPortfolioId === 'all' && regularPortfolios.length > 1;
    const [selectedPortfolioId, setSelectedPortfolioId] = useState(
        existingTx?.portfolioId || (regularPortfolios.length > 0 ? regularPortfolios[0].id : 1)
    );

    // Detect quote currency from symbol (e.g., BTC-EUR -> EUR, SAP.DE -> EUR)
    const detectedQuote = useMemo(() => {
        // When editing, preserve the transaction's original quote currency so
        // stored historical data isn't rewritten.
        if (existingTx?.quoteCurrency) return existingTx.quoteCurrency.toUpperCase();

        // For any new transaction, default the price currency to the user's
        // selected base currency. The entered price (auto-fetched or manual) is
        // then expressed in that currency; the user can still override via the dropdown.
        return baseCurrency;
    }, [existingTx, baseCurrency]);
    const [quoteCurrency, setQuoteCurrency] = useState(detectedQuote);
    const [userModifiedQuoteCurrency, setUserModifiedQuoteCurrency] = useState(false);

    useEffect(() => {
        if (!userModifiedQuoteCurrency && detectedQuote && quoteCurrency !== detectedQuote) {
            setQuoteCurrency(detectedQuote);
        }
    }, [detectedQuote, quoteCurrency, userModifiedQuoteCurrency]);

    const quoteCurrencyOptions = useMemo(() => {
        const commonQuotes = [
            'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'HKD', 'SGD',
            'USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL'
        ];

        return Array.from(new Set([
            quoteCurrency,
            detectedQuote,
            holding.currency?.toUpperCase(),
            fetchedCurrency?.toUpperCase(),
            baseCurrency,
            ...commonQuotes
        ].filter(Boolean)));
    }, [quoteCurrency, detectedQuote, holding.currency, fetchedCurrency, baseCurrency]);

    // Default type: DEPOSIT for bare currencies, else existing or BUY
    const [type, setType] = useState(() => {
        if (existingTx?.type) return existingTx.type;
        return isBareCurrency ? 'DEPOSIT' : 'BUY';
    });
    const usesPrice = type === 'BUY' || type === 'SELL' || (type === 'DEPOSIT' && !isBareCurrency);
    const affectsQuoteBalance = type === 'BUY' || type === 'SELL';
    const priceLabel = type === 'DEPOSIT' ? 'Cost basis per unit' : 'Price per unit';
    const totalLabel = type === 'DEPOSIT' ? 'Cost basis' : 'Total';
    const [amount, setAmount] = useState(existingTx?.baseAmount || '');
    const [price, setPrice] = useState(existingTx ? (existingTx.quoteAmount / (existingTx.baseAmount || 1)) : '');
    const [date, setDate] = useState(existingTx?.date ? new Date(existingTx.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState(existingTx?.notes || '');
    const [fee, setFee] = useState(existingTx?.fee || '');
    const [feeCurrency, setFeeCurrency] = useState(existingTx?.feeCurrency || '');
    const [formError, setFormError] = useState('');
    const feeCurrencyOptions = useMemo(() => (
        Array.from(new Set([feeCurrency, ...quoteCurrencyOptions].filter(Boolean)))
    ), [feeCurrency, quoteCurrencyOptions]);

    useEffect(() => {
        if (!existingTx && (!feeCurrency || feeCurrency === detectedQuote) && quoteCurrency) {
            setFeeCurrency(quoteCurrency);
        }
    }, [quoteCurrency, detectedQuote, existingTx, feeCurrency]);

    // Calculate quote balance to determine default toggle state
    const quoteBalance = useMemo(() => {
        if (!transactions || !quoteCurrency) return 0;
        return calculateAssetAccounting(transactions, quoteCurrency, baseCurrency).currentBalance;
    }, [transactions, quoteCurrency, baseCurrency]);

    const [useFiat, setUseFiat] = useState(() => {
        if (existingTx) {
            // For existing tx, respect quote/cash balance flags if they exist,
            // otherwise default to true if it has a quoteCurrency
            if (existingTx.affectsQuoteBalance !== undefined) return !!existingTx.affectsQuoteBalance;
            if (existingTx.affectsFiatBalance !== undefined) return !!existingTx.affectsFiatBalance;
            return !!existingTx.quoteCurrency;
        }
        return quoteBalance > 0;
    });

    // Track if user has manually toggled the fiat switch
    // If they have, we don't auto-update it
    const [userModifiedUseFiat, setUserModifiedUseFiat] = useState(false);

    // Sync useFiat with balance and cost (for new transactions)
    useEffect(() => {
        if (!existingTx && !userModifiedUseFiat) {
            // Logic: 
            // 1. If no balance, default off
            // 2. If balance exists:
            //    - BUY: disable if cost > balance (don't default to negative), enable if cost <= balance
            //    - SELL/DEPOSIT/WITHDRAW: enable if balance > 0 (tracking this currency)

            if (type === 'BUY') {
                // Must have balance to deduct from
                if (quoteBalance <= 0) {
                    setUseFiat(false);
                } else {
                    const cost = (parseFloat(amount) || 0) * (parseFloat(price) || 0);
                    if (cost > quoteBalance) {
                        setUseFiat(false);
                    } else {
                        setUseFiat(true);
                    }
                }
            } else {
                // SELL/DEPOSIT/WITHDRAW: Always default to true (adding to balance)
                // Even if balance is 0, we are creating it now.
                setUseFiat(true);
            }
        }
    }, [quoteCurrency, quoteBalance, existingTx, amount, price, type, userModifiedUseFiat]);

    const [fetchingPrice, setFetchingPrice] = useState(false);
    const [isManualPrice, setIsManualPrice] = useState(false);

    // Initial price fetch (current) - ONLY if NOT editing
    useEffect(() => {
        if (!existingTx && sym && !isManualPrice) {
            async function fetchPrice() {
                setFetchingPrice(true);
                try {
                    // For bare currencies: DEPOSIT/WITHDRAW don't need a price
                    // The concept of "price" doesn't apply - you're just moving currency
                    if (isBareCurrency) {
                        setPrice('');  // No price for bare currency deposits
                        setFetchingPrice(false);
                        return;
                    }

                    // Normal asset price fetch
                    let fetchSym = sym;
                    if (holding.originalType === 'CRYPTOCURRENCY' && !fetchSym.includes('-')) {
                        fetchSym += '-USD';
                    }
                    const res = await fetch(`/api/quote?symbols=${fetchSym}`);
                    const json = await res.json();
                    if (json.data && json.data[0]) {
                        const quote = json.data[0];
                        const nativeCurrency = (quote.currency || 'USD').toUpperCase();
                        const targetCurrency = (quoteCurrency || nativeCurrency).toUpperCase();
                        // The market price is quoted in the asset's native currency; express it in
                        // the selected price currency so it follows the chosen base/quote currency.
                        let unitPrice = quote.price;
                        if (targetCurrency !== nativeCurrency) {
                            const rate = await fetchLiveFxRate(nativeCurrency, targetCurrency);
                            unitPrice = quote.price * rate;
                        }
                        setPrice(unitPrice);
                    }
                } catch (e) { console.error(e); }
                finally { setFetchingPrice(false); }
            }
            fetchPrice();
        } else if (existingTx && existingTx.quoteAmount && existingTx.baseAmount) {
            setPrice(existingTx.quoteAmount / existingTx.baseAmount);
        }
    }, [sym, existingTx, isBareCurrency, isManualPrice, holding.originalType, quoteCurrency]);

    // Historical price fetch when date changes - ONLY if NOT editing and NOT manually set
    useEffect(() => {
        if (existingTx || isManualPrice || !sym || !date) return;

        const today = new Date().toISOString().split('T')[0];
        if (date === today) return; // Already fetched current price or handled by initial load

        async function fetchHistorical() {
            setFetchingPrice(true);
            try {
                let fetchSym = sym;
                if (holding.originalType === 'CRYPTOCURRENCY' && !fetchSym.includes('-')) {
                    fetchSym += '-USD';
                }
                const res = await fetch(`/api/history?symbol=${fetchSym}&range=ALL`);
                const json = await res.json();
                if (json.history) {
                    const dayPrice = json.history.find(h => h.date.startsWith(date));
                    if (dayPrice) {
                        const nativeCurrency = (fetchedCurrency || holding.currency || 'USD').toUpperCase();
                        const targetCurrency = (quoteCurrency || nativeCurrency).toUpperCase();
                        let unitPrice = dayPrice.price;
                        if (targetCurrency !== nativeCurrency) {
                            // Use the FX rate for the transaction date, not today's rate.
                            const fxMap = await buildHistoricalConversionMap(nativeCurrency, targetCurrency);
                            const rate = getMapRateForDate(fxMap, date) || await fetchLiveFxRate(nativeCurrency, targetCurrency);
                            unitPrice = dayPrice.price * rate;
                        }
                        setPrice(unitPrice);
                    }
                }
            } catch (e) { console.error(e); }
            finally { setFetchingPrice(false); }
        }

        const tId = setTimeout(fetchHistorical, 500);
        return () => clearTimeout(tId);
    }, [date, sym, existingTx, isManualPrice, holding.originalType, quoteCurrency, fetchedCurrency, holding.currency]);

    const handleMax = () => {
        if (holding.amount) {
            setAmount(holding.amount);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setFormError('');
        const cleanPrice = parseFloat(price);
        const cleanAmount = parseFloat(amount);
        const cleanFee = parseFloat(fee) || 0;

        // Validate
        if (!amount || isNaN(cleanAmount)) return;
        if ((type === 'BUY' || type === 'SELL') && (!price || isNaN(cleanPrice))) return;
        const feeUsesSelectedAsset = normalizeAsset(feeCurrency) === normalizeAsset(sym);
        const balanceImpactAmount = ['SELL', 'WITHDRAW'].includes(type) && feeUsesSelectedAsset
            ? cleanAmount + cleanFee
            : cleanAmount;
        if (['SELL', 'WITHDRAW'].includes(type) && balanceImpactAmount > (parseFloat(holding.amount) || 0) + 0.00001) {
            setFormError(`Amount exceeds current position (${(parseFloat(holding.amount) || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })})`);
            return;
        }

        const hasCostBasis = usesPrice && price && !isNaN(cleanPrice);
        const shouldAffectQuoteBalance = affectsQuoteBalance ? useFiat : false;

        const tx = {
            // Merge with existing transaction to preserve fields like 'notes'
            ...(existingTx || {}),
            id: existingTx?.id || Math.random().toString(36).substr(2, 9),
            date: new Date(date).toISOString(),
            type,
            baseAmount: cleanAmount,
            baseCurrency: sym,
            quoteAmount: hasCostBasis ? (cleanAmount * cleanPrice) : 0,
            // Store the selected quote currency so mixed-currency crypto pairs stay explicit.
            quoteCurrency: hasCostBasis ? quoteCurrency : null,
            exchange: existingTx?.exchange || 'MANUAL',
            originalType: holding.originalType || existingTx?.originalType || (quoteCurrency === 'USD' ? 'CRYPTOCURRENCY' : 'MANUAL'),
            fee: cleanFee,
            feeCurrency: cleanFee > 0 ? (feeCurrency || quoteCurrency) : null,
            // Keep the old field for CSV/backwards compatibility, but use quote balance semantics internally.
            affectsFiatBalance: shouldAffectQuoteBalance,
            affectsQuoteBalance: shouldAffectQuoteBalance,
            // Portfolio ID - use selected if in 'All' view, otherwise use current
            portfolioId: showPortfolioSelector ? selectedPortfolioId : (existingTx?.portfolioId || (currentPortfolioId === 'all' ? 1 : currentPortfolioId)),
            // Notes
            notes: notes.trim() || null
        };

        onSave(tx);
    };

    const labelStyle = { fontSize: '0.75rem', fontWeight: 'bold', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'block' };
    const compactSelectStyle = {
        background: `#171717 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.55)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center`,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        color: 'white',
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontWeight: 700,
        minWidth: '92px',
        outline: 'none',
        padding: '8px 30px 8px 12px',
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none'
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Portfolio Selector - only show when in 'All' view with multiple portfolios */}
            {showPortfolioSelector && (
                <div>
                    <label style={labelStyle}>Add to Portfolio</label>
                    <select
                        value={selectedPortfolioId}
                        onChange={(e) => setSelectedPortfolioId(parseInt(e.target.value))}
                        style={{
                            width: '100%',
                            background: `#171717 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 14px center`,
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            padding: '14px 44px 14px 14px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            outline: 'none',
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            MozAppearance: 'none'
                        }}
                    >
                        {portfolios.filter(p => !p.isWatchlist).map(p => (
                            <option key={p.id} value={p.id} style={{ background: '#121212', color: 'white' }}>{p.name}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Type Selector */}
            <div className="flex gap-2 p-1 rounded-full" style={{ background: '#171717' }}>
                {availableTypes.map(t => {
                    const isActive = type === t;
                    return (
                        <button
                            key={t}
                            type="button"
                            className={`flex-1 text-xs font-bold rounded-full transition-all`}
                            style={{
                                background: isActive ? 'white' : 'transparent',
                                color: isActive ? 'black' : '#a1a1aa',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '12px 16px',
                                boxShadow: isActive ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none'
                            }}
                            onClick={() => setType(t)}
                        >
                            {t}
                        </button>
                    )
                })}
            </div>

            <div className="relative">
                <label style={labelStyle}>Amount ({sym.split(/[-/]/)[0]})</label>
                <div className="relative">
                    <input
                        type="number"
                        step="any"
                        required
                        autoFocus
                        className="input-reset"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="0.00"
                        style={{ fontSize: '2rem', paddingLeft: '1rem', paddingRight: (type === 'SELL' || type === 'WITHDRAW') ? '5rem' : '1rem' }}
                    />
                    {(type === 'SELL' || type === 'WITHDRAW') && holding.amount > 0 && (
                        <button
                            type="button"
                            onClick={handleMax}
                            style={{
                                position: 'absolute',
                                right: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: 'white',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                padding: '6px 12px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                backdropFilter: 'blur(4px)'
                            }}
                            className="hover:bg-white/20 active:scale-95"
                        >
                            MAX
                        </button>
                    )}
                </div>
            </div>

            {usesPrice && (
                <>
                    <div>
                        <div className="flex items-center justify-between gap-3" style={{ marginBottom: '0.5rem' }}>
                            <label
                                htmlFor="transaction-price"
                                style={{ ...labelStyle, marginBottom: 0 }}
                            >
                                {priceLabel}
                            </label>
                            <div className="flex items-center gap-2">
                                {fetchingPrice && <span className="animate-pulse text-xs font-bold uppercase tracking-wider" style={{ color: '#3b82f6' }}>Fetching...</span>}
                                <select
                                    aria-label="Price currency"
                                    value={quoteCurrency}
                                    onChange={e => {
                                        setQuoteCurrency(e.target.value);
                                        setUserModifiedQuoteCurrency(true);
                                    }}
                                    style={compactSelectStyle}
                                >
                                    {quoteCurrencyOptions.map(currency => (
                                        <option key={currency} value={currency} style={{ background: '#121212', color: 'white' }}>
                                            {currency}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <input
                            id="transaction-price"
                            type="number"
                            step="any"
                            required={type === 'BUY' || type === 'SELL'}
                            className="input-reset"
                            value={price}
                            onChange={e => {
                                setPrice(e.target.value);
                                setIsManualPrice(true);
                            }}
                            placeholder="0.00"
                        />
                        {amount && price && !isNaN(parseFloat(amount)) && !isNaN(parseFloat(price)) && (
                            <div className="mt-2 ml-1 flex gap-1 items-center">
                                <span className="text-xs text-muted font-medium uppercase tracking-wider">{totalLabel}:</span>
                                <span className="text-xs font-bold text-white">
                                    {(parseFloat(amount) * parseFloat(price)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quoteCurrency}
                                </span>
                            </div>
                        )}
                    </div>

                    {affectsQuoteBalance && (
                        <div
                            className="flex items-center justify-between p-4 rounded-2xl hover-bg-surface transition-all"
                            style={{ border: '1px solid #262626', background: '#171717', cursor: 'pointer' }}
                            onClick={() => {
                                setUseFiat(!useFiat);
                                setUserModifiedUseFiat(true);
                            }}
                        >
                            <span className="text-sm font-medium text-white select-none">
                                {type === 'BUY' ? `Deduct from ${quoteCurrency} balance` : `Add to ${quoteCurrency} balance`}
                            </span>
                            <div style={{
                                width: '48px', height: '24px', borderRadius: '999px', padding: '2px',
                                backgroundColor: useFiat ? '#3b82f6' : '#262626',
                                transition: 'background-color 0.2s'
                            }}>
                                <div style={{
                                    width: '20px', height: '20px', borderRadius: '50%', background: 'white',
                                    transform: useFiat ? 'translateX(24px)' : 'translateX(0)',
                                    transition: 'transform 0.2s',
                                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                                }} />
                            </div>
                        </div>
                    )}
                </>
            )}

            <div
                className="grid grid-cols-[1fr_120px] gap-3"
                style={{
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: 'minmax(0, 1fr) 120px',
                    marginBottom: '0.5rem'
                }}
            >
                <div>
                    <label style={labelStyle}>Fee</label>
                    <input
                        type="number"
                        step="any"
                        className="input-reset"
                        value={fee}
                        onChange={e => setFee(e.target.value)}
                        placeholder="0.00"
                    />
                </div>
                <div>
                    <label style={labelStyle}>Fee currency</label>
                    <select
                        value={feeCurrency}
                        onChange={e => setFeeCurrency(e.target.value)}
                        style={{ ...compactSelectStyle, width: '100%', minHeight: '47px', minWidth: 0, paddingTop: '13px', paddingBottom: '13px' }}
                    >
                        {feeCurrencyOptions.map(currency => (
                            <option key={currency} value={currency} style={{ background: '#121212', color: 'white' }}>
                                {currency}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div>
                <label style={labelStyle}>Date</label>
                <input
                    type="date"
                    required
                    className="input-reset"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                />
            </div>

            <div>
                <label style={labelStyle}>Notes (optional)</label>
                <textarea
                    className="input-reset"
                    placeholder="Add notes about this transaction..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    style={{ resize: 'vertical', minHeight: '60px' }}
                />
            </div>

            {formError && (
                <div className="text-danger text-sm font-medium">
                    {formError}
                </div>
            )}

            <div className="flex gap-3 mt-8 pt-4 border-t border-white/5">
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 btn btn-ghost"
                    style={{
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        padding: '14px',
                        borderRadius: '14px',
                        border: '1px solid var(--card-border-strong)'
                    }}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="flex-[2] btn"
                    style={{ fontSize: '1rem', fontWeight: 600, padding: '14px', borderRadius: '14px' }}
                >
                    Save
                </button>
            </div>
        </form>
    );
}
