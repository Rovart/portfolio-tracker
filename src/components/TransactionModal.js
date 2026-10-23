'use client';

import { apiFetch } from '@/utils/api-client';
import { getCachedQuotes } from '@/utils/fxCache';
import useMarketActivity from './useMarketActivity';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import AssetSearch from './AssetSearch';
import EarningsEvent from './EarningsEvent';
import ConfirmModal from './ConfirmModal';
import WalletTracker from './WalletTracker';
import BottomSheet, { closeTopSheet } from './BottomSheet';
import { LoanActions, LoanDetails, LoanForm, LoanTransactionForm, LoanValue, LOAN_TRANSACTION_LABELS, loanRateLabel } from './LoanPanel';

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
import { Plus, ArrowLeft, Moon, Sun, Eye, EyeOff, ChevronsUpDown } from 'lucide-react';
import { AmountField, Delta, FormRow, Money, Segmented, StatStrip, SwitchRow } from './ui';
import { changeTone, formatDate, formatMoney, formatPercent, formatPrice, formatQuantity, MASK } from '@/utils/format';
import {
    normalizeAsset,
    isFiatAsset,
    getQuoteCurrencyFromSymbol,
    calculateAssetAccounting,
    getCurrentFxRate
} from '@/utils/portfolio-logic';
import {
    buildHistoricalConversionMap,
    getHistoricalConversionRate,
    getMapRateForDate
} from '@/utils/historical-conversion';
import { addWatchlistAsset, removeWatchlistAsset, isSymbolInWatchlist } from '@/utils/db';
import { COMMODITY_NAMES } from '@/utils/commodities';
import { getTransactionExecutionPrice } from '@/utils/chart-data';
import { buildLoanHistory, getLoanQuote, isLoanSymbol } from '@/utils/loans';

const LOAN_CHART_RANGES = ['1M', '3M', '1Y', 'ALL'];
const REVERSE_LABELS = { BUY: 'Purchased', SELL: 'Sold', INCOME: 'Income from' };
const TRANSACTION_LABELS = { BUY: 'Buy', SELL: 'Sell', DEPOSIT: 'Deposit', WITHDRAW: 'Withdrawal', INCOME: 'Income' };
const RANGE_CAPTIONS = { '1D': 'Today', '1W': 'Past week', '1M': 'Past month', '3M': 'Past 3 months', '1Y': 'Past year', 'ALL': 'All time' };

// Header display logic: Title = Name, Subtitle = Symbol

// Prices shown in an input: cents above 1, significant digits below.
function roundPrice(value) {
    if (!Number.isFinite(value)) return '';
    const digits = Math.abs(value) >= 1 ? 2 : Math.min(10, 4 - Math.floor(Math.log10(Math.abs(value) || 1)));
    return Number(value.toFixed(digits));
}

function toFiniteNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

// Live FX rate helper: how many units of `to` one unit of `from` is worth.
// Reuses available quotes and USD pairs before requesting a direct cross pair.
async function fetchLiveFxRate(from, to, quotes = []) {
    const F = String(from || '').toUpperCase();
    const T = String(to || '').toUpperCase();
    if (!F || !T) return null;
    if (F === T) return 1;
    const priceMap = Object.fromEntries(quotes.map(quote => [quote.symbol, quote]));
    const existing = getCurrentFxRate(priceMap, F, T);
    if (existing) return existing;
    const symbols = [F, T].filter(code => code !== 'USD').map(code => `${code}USD=X`);
    for (const quote of await getCachedQuotes(symbols)) priceMap[quote.symbol] = quote;
    const pivot = getCurrentFxRate(priceMap, F, T);
    if (pivot) return pivot;
    const direct = (await getCachedQuotes([`${F}${T}=X`]))[0]?.price;
    return direct || null;
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
    onWatchlistUpdate,
    onWalletsChange,
    loans = [],
    onCreateLoan,
    onUpdateLoan,
    onDeleteLoan
}) {
    const { active: marketActive, revision: marketRevision } = useMarketActivity();
    const modalRef = useRef(null);
    const heavyRafRef = useRef(0);
    const [currentView, setCurrentView] = useState(mode === 'ADD' ? 'SEARCH' : 'LIST');
    const [selectedAsset, setSelectedAsset] = useState(holding ? {
        symbol: holding.symbol || holding.asset,
        amount: holding.amount,
        walletAmount: holding.walletAmount || 0,
        hasWalletPosition: !!holding.hasWalletPosition,
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
    const [isEditingLoanTerms, setIsEditingLoanTerms] = useState(false);
    const [loanDeleteConfirm, setLoanDeleteConfirm] = useState(false);
    const [assetTab, setAssetTab] = useState('overview'); // 'overview' | 'financials'
    const [returnMetric, setReturnMetric] = useState('total'); // 'total' | 'unrealized' | 'realized'
    // Defer heavy chart mounting until after the modal has painted/animated in
    const [heavyReady, setHeavyReady] = useState(false);
    const [isInWatchlist, setIsInWatchlist] = useState(false);
    const [rangePerformance, setRangePerformance] = useState(null); // { range, change, changePercent, startPrice }
    // Chart interaction mirrored in the price block: a scrubbed point or a selected range.
    const [chartScrub, setChartScrub] = useState(null);
    const [chartSelection, setChartSelection] = useState(null);
    const resetChartInteraction = useCallback(() => {
        setChartScrub(null);
        setChartSelection(null);
    }, []);

    // Sync selectedAsset when holding prop changes (e.g. if name is loaded late in Dashboard)
    // Use primitive dependencies to minimize re-runs
    useEffect(() => {
        if (holding) {
            setSelectedAsset({
                symbol: holding.symbol || holding.asset,
                amount: holding.amount,
                walletAmount: holding.walletAmount || 0,
                hasWalletPosition: !!holding.hasWalletPosition,
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
        holding?.walletAmount,
        holding?.hasWalletPosition,
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
    const loansBySymbol = useMemo(() => (
        new Map(loans.map(loan => [String(loan.symbol).toUpperCase(), loan]))
    ), [loans]);
    const selectedLoan = isLoanSymbol(selectedAssetSymbol) ? loansBySymbol.get(selectedAssetSymbol.toUpperCase()) || null : null;
    const getAssetDisplayName = symbol => isLoanSymbol(symbol) ? loansBySymbol.get(symbol.toUpperCase())?.name || 'loan' : symbol;

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
                    // An open bottom sheet (transaction form, wallet add) owns the
                    // back gesture — close just the sheet, never the whole modal.
                    if (closeTopSheet()) return;
                    if (currentView === 'FORM') {
                        setCurrentView('LIST');
                        setEditingTx(null);
                    } else if (currentView === 'LOAN_FORM') {
                        setCurrentView('SEARCH');
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
        if (!selectedAssetSymbol || !marketActive) return;
        let isCancelled = false;

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

            const isUsdCash = isCurrencyType && fetchSym.toUpperCase() === 'USD';
            // Loans have no market quote: their accrued price is computed locally.
            const isLoanAsset = isLoanSymbol(fetchSym);
            let symbolsToFetch = isUsdCash || isLoanAsset ? [] : [fetchSym];
            // For USD-to-base conversion, always fetch {base}USD=X (e.g., EURUSD=X), not the other way around
            if (baseCurrency !== 'USD') {
                symbolsToFetch.push(`${baseCurrency}USD=X`);
            }

            try {
                const marketQuotes = await getCachedQuotes(symbolsToFetch);
                const loanQuote = isLoanAsset && selectedLoan ? getLoanQuote(selectedLoan, transactions) : null;
                const json = { data: loanQuote ? [...marketQuotes, { ...loanQuote, symbol: fetchSym }] : marketQuotes };
                if (isCancelled) return;

                let fetchedPrice = isUsdCash ? 1 : null;
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

                    // A bare currency is priced through its USD pair; regular
                    // instruments are priced in the feed's actual quote currency.
                    let bareCurrCode = null;
                    if ((selectedAssetIsBareCurrencyOrigin && fetchSym.endsWith('=X')) || (fetchSym.endsWith('USD=X') && fetchSym.length === 8)) {
                        bareCurrCode = fetchSym.replace(/=X$/, '').replace(/USD$/, '').toUpperCase();
                    }
                    if (bareCurrCode === baseCurrency) {
                        fetchedPrice = 1;
                        fetchedFxRate = 1;
                    } else {
                        fetchedFxRate = await fetchLiveFxRate(bareCurrCode ? 'USD' : fetchedCurrency, baseCurrency, json.data);
                    }
                    var fetchedActualFxRate = bareCurrCode ? (fetchedPrice && fetchedFxRate ? fetchedPrice * fetchedFxRate : null) : fetchedFxRate;
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

                if (isCancelled) return;
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
                    fetchedAt: json.data.find(q => q.symbol === fetchSym)?.fetchedAt,
                    marketTime: json.data.find(q => q.symbol === fetchSym)?.marketTime,
                    isStale: json.data.find(q => q.symbol === fetchSym)?.isStale,
                    marketState: fetchedMarketState,
                    preMarketPrice: fetchedPreMarketPrice,
                    preMarketChange: fetchedPreMarketChange,
                    postMarketPrice: fetchedPostMarketPrice,
                    postMarketChange: fetchedPostMarketChange,
                    isLoading: false
                });
            } catch (e) {
                console.error(e);
                if (!isCancelled) setPriceData(prev => ({ ...prev, isLoading: false }));
            }
        }

        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => { isCancelled = true; clearInterval(interval); };
    }, [
        marketActive,
        marketRevision,
        selectedAssetSymbol,
        selectedAssetCurrency,
        selectedAssetOriginalType,
        selectedAssetIsBareCurrencyOrigin,
        selectedLoan,
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

    const assetTransactions = useMemo(() => {
        if (!selectedAssetSymbol) return [];
        const normalizedTarget = normalizeAsset(selectedAssetSymbol);
        return transactions.filter(t => {
            const normalizedBase = normalizeAsset(t.baseCurrency);

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
                const isReverse = normalizeAsset(t.quoteCurrency) === normalizedTarget;
                return { ...t, isReverse };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date))
    }, [transactions, selectedAssetSymbol]);

    const chartTransactions = useMemo(() => assetTransactions
        .filter(tx => !tx.isReverse)
        .map(tx => ({
            ...tx,
            executionPrice: getTransactionExecutionPrice(tx, baseCurrency, (currency, date) => {
                const historicalRate = getHistoricalConversionRate(transactionFx, currency, baseCurrency, date);
                if (historicalRate) return historicalRate;
                if (currency === normalizeAsset(selectedAssetCurrency)) {
                    return getMapRateForDate(priceData.historicalFx, date) || fxRate;
                }
                return null;
            })
        })), [assetTransactions, baseCurrency, transactionFx, selectedAssetCurrency, priceData.historicalFx, fxRate]);

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
        realizedPnl: realizedProfitBase = 0,
        missingCostFx,
        missingCostBasis
    } = assetAccounting;

    const walletBalance = toFiniteNumber(selectedAsset?.walletAmount);
    const combinedCurrentBalance = currentBalance + walletBalance;
    const valuationUnavailable = !liveAssetPrice || !Number.isFinite(fxRate) || fxRate <= 0;
    const transactionValueBase = valuationUnavailable ? null : currentBalance * liveAssetPrice * fxRate;
    const currentValueBase = valuationUnavailable ? null : combinedCurrentBalance * liveAssetPrice * fxRate;
    const isSelectedFiat = isFiatAsset(selectedSymbol);
    const unrealizedProfitBase = isSelectedFiat ? 0 : valuationUnavailable || missingCostFx || missingCostBasis ? null : transactionValueBase - currentCostBasisBase;
    const totalProfitBase = isSelectedFiat ? 0 : unrealizedProfitBase === null || missingCostFx ? null : unrealizedProfitBase + realizedProfitBase;

    const getDisplayQuoteCurrency = (tx) => {
        const explicitQuote = normalizeAsset(tx.quoteCurrency);
        if (explicitQuote) return explicitQuote;

        const rawBase = String(tx.baseCurrency || '').toUpperCase();
        if (rawBase.includes('-') || rawBase.includes('/')) {
            return getQuoteCurrencyFromSymbol(rawBase) || baseCurrency;
        }

        return baseCurrency;
    };

    // The position in one compact band, so History stays close to the chart.
    // The return figure cycles through total, unrealized and realized on tap.
    const heldAmount = Math.abs(combinedCurrentBalance) < 0.005 ? 0 : combinedCurrentBalance;
    const heldTicker = normalizeAsset(selectedSymbol) || selectedSymbol || '';
    const canShowAveragePurchase = averagePurchasePrice > 0;
    const hideMoney = value => hideBalances ? MASK : value;
    const priceKnown = !loadingPrice && !valuationUnavailable;
    const hasRealized = !missingCostFx && Math.abs(realizedProfitBase) >= 0.005;
    const returnMetrics = hasRealized ? ['total', 'unrealized', 'realized'] : ['total'];
    const shownReturnMetric = returnMetrics.includes(returnMetric) ? returnMetric : 'total';
    const returnFigure = {
        total: { label: 'Total return', value: totalProfitBase, basis: currentCostBasisBase },
        unrealized: { label: 'Unrealized', value: unrealizedProfitBase, basis: currentCostBasisBase },
        realized: { label: 'Realized', value: missingCostFx ? null : realizedProfitBase, basis: null }
    }[shownReturnMetric];
    const returnPercent = returnFigure.basis > 0 && Number.isFinite(returnFigure.value)
        ? (returnFigure.value / returnFigure.basis) * 100 : null;
    const heldText = `${hideBalances ? '••••' : formatQuantity(heldAmount, { maxDecimals: 6 })} ${heldTicker}`;
    const positionItems = [
        {
            label: 'Value',
            value: priceKnown ? hideMoney(formatMoney(currentValueBase, baseCurrency)) : heldText,
            sub: priceKnown
                ? `${heldText}${walletBalance > 0 && !hideBalances ? ` · ${formatQuantity(walletBalance, { maxDecimals: 6 })} in wallets` : ''}`
                : null
        },
        !isSelectedFiat && canShowAveragePurchase && { label: 'Avg cost', value: formatPrice(averagePurchasePrice, baseCurrency) },
        !isSelectedFiat && priceKnown && {
            id: 'return',
            label: returnMetrics.length > 1 ? <>{returnFigure.label}<ChevronsUpDown size={11} aria-hidden="true" /></> : returnFigure.label,
            value: !Number.isFinite(returnFigure.value) ? '—'
                : hideBalances ? (returnPercent === null ? MASK : formatPercent(returnPercent))
                    : formatMoney(returnFigure.value, baseCurrency, { signed: true }),
            tone: changeTone(returnFigure.value),
            sub: !hideBalances && returnPercent !== null ? formatPercent(returnPercent) : null,
            subTone: changeTone(returnFigure.value),
            onClick: returnMetrics.length > 1
                ? () => setReturnMetric(returnMetrics[(returnMetrics.indexOf(shownReturnMetric) + 1) % returnMetrics.length])
                : undefined,
            ariaLabel: returnMetrics.length > 1 ? `${returnFigure.label}, tap to switch` : undefined
        }
    ];

    const handleAssetSelect = (asset) => {
        const balance = calculateAssetAccounting(transactions, asset.symbol, baseCurrency).currentBalance;

        setSelectedAsset({
            symbol: asset.symbol,
            name: asset.name || asset.shortname || asset.symbol,
            price: null,
            amount: balance,
            walletAmount: 0,
            hasWalletPosition: false,
            originalType: asset.type,
            currency: asset.currency, // Use currency from search result
            isBareCurrencyOrigin: asset.isBareCurrencyOrigin || false
        });
        setCurrentView('LIST');
        setAssetTab('overview');
        setReturnMetric('total');
        setEditingTx(null);
        resetChartInteraction();
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
        } else if (currentView === 'LOAN_FORM') {
            setCurrentView('SEARCH');
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

    // Dismissing the transaction form returns to the asset view, never home
    const closeForm = () => {
        setCurrentView('LIST');
        setEditingTx(null);
    };

    const handleWalletBalanceChange = useCallback((nextWalletAmount) => {
        setSelectedAsset(prev => prev ? {
            ...prev,
            walletAmount: nextWalletAmount,
            hasWalletPosition: nextWalletAmount > 0
        } : prev);
    }, []);

    const handleLoanCreate = async (terms, disbursement) => {
        if (!onCreateLoan) return;
        const loan = await onCreateLoan(terms, disbursement);
        setSelectedAsset({
            symbol: loan.symbol,
            name: loan.name,
            amount: disbursement.baseAmount,
            walletAmount: 0,
            hasWalletPosition: false,
            originalType: 'LOAN',
            currency: loan.currency,
            isBareCurrencyOrigin: false
        });
        setAssetTab('overview');
        setEditingTx(null);
        setCurrentView('LIST');
    };

    const handleLoanTermsSave = async (terms) => {
        if (!selectedLoan) return;
        await onUpdateLoan?.(selectedLoan.id, terms);
        setSelectedAsset(prev => prev ? { ...prev, name: terms.name } : prev);
        setIsEditingLoanTerms(false);
    };

    // Accrued loan value over time; orphan loan entries (no terms) get no market lookup.
    const loanHistory = useMemo(() => {
        if (!isLoanSymbol(selectedAssetSymbol)) return null;
        if (!selectedLoan) return [];
        return buildLoanHistory(selectedLoan, transactions).map(point => ({ date: point.date, price: point.value }));
    }, [selectedAssetSymbol, selectedLoan, transactions]);

    // The add/edit FORM is a bottom sheet layered on top of the asset view,
    // which stays mounted underneath so dismissing the sheet lands back on it.
    const isFormOpen = currentView === 'FORM' && !!selectedAsset;
    const showAssetView = (currentView === 'LIST' || isFormOpen) && !!selectedAsset;
    const isOrphanLoan = isLoanSymbol(selectedAsset?.symbol) && !selectedLoan;

    const headerTitle = (() => {
        if (currentView === 'SEARCH') return 'Add asset';
        if (currentView === 'LOAN_FORM') return 'New loan';
        if (selectedLoan) return selectedLoan.name || 'Loan';
        const baseSymbol = selectedAsset?.symbol?.split(/[-/]/)[0];
        const commodityName = COMMODITY_NAMES[baseSymbol];
        if (commodityName) {
            const quoteCurr = editingTx?.quoteCurrency?.toUpperCase() || selectedAsset?.currency || 'USD';
            return `${commodityName} ${quoteCurr}`;
        }
        if (editingTx?.quoteCurrency && selectedAsset?.name) {
            return selectedAsset.name.replace(/\s+[A-Z]{3}$/, ` ${editingTx.quoteCurrency.toUpperCase()}`);
        }
        return selectedAsset?.name || selectedAsset?.symbol || 'Details';
    })();
    const headerSubtitle = !showAssetView || !selectedAsset?.symbol ? null
        : isLoanSymbol(selectedAsset.symbol) ? [selectedLoan?.project || 'Private loan', selectedLoan && loanRateLabel(selectedLoan, { withMode: true })].filter(Boolean).join(' · ')
            : editingTx?.quoteCurrency ? `${selectedAsset.symbol.split(/[-/]/)[0]}-${editingTx.quoteCurrency.toUpperCase()}`
                : selectedAsset.symbol;

    // The price block follows the chart: a selected range, a scrubbed point, or now.
    const rangeStartPrice = rangePerformance?.startPrice;
    let priceFigure = null;
    if (!loadingPrice && !valuationUnavailable) {
        if (chartSelection?.start && chartSelection?.end) {
            const from = chartSelection.start.value;
            const to = chartSelection.end.value;
            priceFigure = {
                label: `${formatDate(chartSelection.start.date)} – ${formatDate(chartSelection.end.date)}`,
                value: to,
                change: to - from,
                percent: from ? ((to - from) / from) * 100 : 0,
                caption: null
            };
        } else if (chartScrub?.point) {
            const value = chartScrub.point.value;
            const change = Number.isFinite(rangeStartPrice) ? value - rangeStartPrice : null;
            priceFigure = {
                label: formatDate(chartScrub.point.date, { withTime: ['1D', '1W', '1M'].includes(rangePerformance?.range) }),
                value,
                change,
                percent: change !== null && rangeStartPrice ? (change / rangeStartPrice) * 100 : null,
                caption: RANGE_CAPTIONS[rangePerformance?.range] ? `vs. start of ${RANGE_CAPTIONS[rangePerformance.range].toLowerCase()}` : null
            };
        } else if (rangePerformance && rangePerformance.range !== '1D') {
            priceFigure = {
                label: 'Price',
                value: livePriceSnapshot.priceBase,
                change: rangePerformance.change,
                percent: rangePerformance.changePercent,
                caption: RANGE_CAPTIONS[rangePerformance.range]
            };
        } else {
            priceFigure = {
                label: 'Price',
                value: livePriceSnapshot.priceBase,
                change: livePriceSnapshot.absChangeBase,
                percent: livePriceSnapshot.changePercent,
                caption: 'Today'
            };
        }
    }

    const describeTransaction = (tx) => {
        const isLoanTx = isLoanSymbol(tx.baseCurrency);
        const dateStr = tx.date.split('T')[0];
        const title = tx.isReverse
            ? (tx.type === 'BUY' ? 'Spent' : 'Received')
            : isLoanTx ? (LOAN_TRANSACTION_LABELS[tx.type] || tx.type) : (TRANSACTION_LABELS[tx.type] || tx.type);
        const subtitle = `${tx.isReverse ? `${REVERSE_LABELS[tx.type] || 'Sold'} ${getAssetDisplayName(tx.baseCurrency)} · ` : ''}${formatDate(tx.date)}`;

        if (tx.isReverse) {
            return { title, subtitle, amount: formatMoney(tx.quoteAmount, tx.quoteCurrency) };
        }
        if (isLoanTx || tx.type === 'INCOME') {
            const currency = tx.quoteCurrency || selectedLoan?.currency || baseCurrency;
            const isPrincipal = ['BUY', 'DEPOSIT', 'WITHDRAW'].includes(tx.type);
            const cashUnchanged = (tx.affectsQuoteBalance ?? tx.affectsFiatBalance) === false;
            const parts = [];
            if (tx.type === 'SELL') parts.push(`${formatMoney(tx.baseAmount, currency)} principal · ${formatMoney(Math.max(0, tx.quoteAmount - tx.baseAmount), currency)} interest`);
            if (cashUnchanged) parts.push('cash unchanged');
            return { title, subtitle, amount: formatMoney(isPrincipal ? tx.baseAmount : tx.quoteAmount, currency), detail: parts.join(' · ') || null };
        }

        const amount = `${formatQuantity(tx.baseAmount)} ${String(tx.baseCurrency).split(/[-/]/)[0]}`;
        if (!(tx.quoteAmount > 0)) return { title, subtitle, amount };
        const costFx = getHistoricalConversionRate(transactionFx, getDisplayQuoteCurrency(tx), baseCurrency, dateStr) || 0;
        const costBase = tx.quoteAmount * costFx;
        if (!(costBase > 0)) return { title, subtitle, amount };
        const unitPrice = formatPrice(costBase / tx.baseAmount, baseCurrency);
        let profit = null;
        if (tx.type === 'BUY' && !loadingPrice && !valuationUnavailable) {
            const pnl = tx.baseAmount * liveAssetPrice * fxRate - costBase;
            profit = { value: pnl, percent: (pnl / costBase) * 100 };
        }
        return { title, subtitle, amount, detail: `at ${unitPrice}`, profit };
    };

    return (
        <div className="asset-modal animate-modal">
            <div className="modal-header">
                <button type="button" onClick={handleBack} className="icon-button" aria-label="Back" style={{ marginLeft: '-8px' }}>
                    <ArrowLeft size={22} />
                </button>
                <div className="flex flex-col min-w-0 flex-1" style={{ gap: '1px' }}>
                    <h2 className="modal-title truncate">{headerTitle}</h2>
                    {headerSubtitle && <span className="label truncate">{headerSubtitle}</span>}
                </div>
            </div>

            <div ref={modalRef} className="modal-body">
                <div className="modal-content">

                    {currentView === 'SEARCH' && (
                        <AssetSearch
                            onSelect={handleAssetSelect}
                            onCancel={onClose}
                            onCreateLoan={!isWatchlist && onCreateLoan ? () => setCurrentView('LOAN_FORM') : undefined}
                        />
                    )}

                    {currentView === 'LOAN_FORM' && (
                        <div className="animate-enter" style={{ maxWidth: '600px', margin: '0 auto' }}>
                            <LoanForm
                                baseCurrency={baseCurrency}
                                transactions={transactions}
                                portfolios={portfolios}
                                currentPortfolioId={currentPortfolioId}
                                onSubmit={handleLoanCreate}
                                onCancel={() => setCurrentView('SEARCH')}
                            />
                        </div>
                    )}

                    {showAssetView && (
                        <div className="flex flex-col" style={{ gap: 'var(--space-5)' }}>
                            {selectedAsset.originalType === 'EQUITY' && !isWatchlist && (
                                <Segmented
                                    variant="tabs"
                                    ariaLabel="Asset view"
                                    options={[{ id: 'overview', label: 'Overview' }, { id: 'financials', label: 'Financials' }]}
                                    value={assetTab}
                                    onChange={(tab) => { resetChartInteraction(); setAssetTab(tab); }}
                                />
                            )}

                            {assetTab === 'overview' && (
                                <>
                                    {selectedLoan ? (
                                        <LoanValue
                                            loan={selectedLoan}
                                            transactions={assetTransactions}
                                            baseCurrency={baseCurrency}
                                            fxRate={fxRate}
                                            hideBalances={hideBalances}
                                            scrub={chartScrub?.point || null}
                                        />
                                    ) : isOrphanLoan ? (
                                        <p className="label" style={{ margin: 0 }}>This loan has no terms on this device. Restore a complete backup to value it.</p>
                                    ) : (
                                        <div className="flex flex-col" style={{ gap: '4px' }}>
                                                <span className="label flex items-center" style={{ gap: '6px' }}>
                                                    {priceFigure?.label || 'Price'}
                                                    {!chartScrub && currentMarketState?.includes('PRE') && <span className="flex items-center" style={{ gap: '3px' }}><Sun size={12} /> Pre-market</span>}
                                                    {!chartScrub && currentMarketState?.includes('POST') && <span className="flex items-center" style={{ gap: '3px' }}><Moon size={12} /> After hours</span>}
                                                </span>
                                                {loadingPrice ? (
                                                    <>
                                                        <div className="skeleton" style={{ width: 160, height: 30 }} />
                                                        <div className="skeleton" style={{ width: 120, height: 14, marginTop: 4 }} />
                                                    </>
                                                ) : !priceFigure ? (
                                                    <span className="stat-value text-muted">Price unavailable</span>
                                                ) : (
                                                    <>
                                                        <span className="hero-value" style={{ fontSize: '34px' }}>
                                                            <Money value={priceFigure.value} currency={baseCurrency} />
                                                        </span>
                                                        {Number.isFinite(priceFigure.change) && (
                                                            <span className="flex items-center flex-wrap" style={{ gap: '2px 8px', fontSize: 'var(--fs-sm)' }}>
                                                                <Delta value={priceFigure.change} percent={priceFigure.percent} currency={baseCurrency} className="font-medium" />
                                                                {priceFigure.caption && <span className="label">{priceFigure.caption}</span>}
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                        </div>
                                    )}

                                    {!heavyReady ? <ChartSkeleton /> : (
                                        <AssetChart
                                            symbol={selectedAsset.symbol}
                                            baseCurrency={baseCurrency}
                                            fxRate={fxRate}
                                            parentLoading={loadingPrice}
                                            assetCurrency={selectedAsset.currency || priceData.currency}
                                            // Bare currencies chart against USD (AUD -> AUDUSD=X).
                                            chartSymbol={(() => {
                                                const s = selectedAsset.symbol;
                                                const isBare = selectedAsset.isBareCurrencyOrigin || selectedAsset.originalType === 'CURRENCY';
                                                if (isBare && !s.includes('=X') && !s.includes('-')) {
                                                    if (s === 'USD') return s;
                                                    return `${s}USD=X`;
                                                }
                                                return s;
                                            })()}
                                            onRangePerformance={setRangePerformance}
                                            transactions={chartTransactions}
                                            localHistory={loanHistory}
                                            ranges={loanHistory ? LOAN_CHART_RANGES : undefined}
                                            matchMarkerPrices={!loanHistory}
                                            markerLabels={loanHistory ? LOAN_TRANSACTION_LABELS : null}
                                            onScrub={setChartScrub}
                                            onRangeSelect={setChartSelection}
                                        />
                                    )}

                                    {selectedLoan && (
                                        <LoanDetails
                                            loan={selectedLoan}
                                            transactions={assetTransactions}
                                            baseCurrency={baseCurrency}
                                            hideBalances={hideBalances}
                                            realizedProfitBase={missingCostFx ? null : realizedProfitBase}
                                        />
                                    )}

                                    {!isWatchlist && !selectedLoan && !isOrphanLoan && (heldAmount !== 0 || assetTransactions.length > 0) && (
                                        <StatStrip items={positionItems} />
                                    )}

                                    {selectedAsset.originalType === 'EQUITY' && (
                                        <EarningsEvent symbol={selectedAsset.symbol} />
                                    )}

                                    {!isWatchlist && (
                                        <section aria-label="History">
                                            <h3 className="section-title" style={{ marginBottom: '4px' }}>History</h3>
                                            {assetTransactions.length === 0 ? (
                                                <p className="label" style={{ padding: 'var(--space-5) 0', textAlign: 'center', margin: 0 }}>
                                                    {selectedLoan ? 'No entries yet.' : 'No transactions yet.'}
                                                </p>
                                            ) : (
                                                <div className="list-group is-plain">
                                                    {assetTransactions.map(tx => {
                                                        const row = describeTransaction(tx);
                                                        // Mirrored cash legs belong to another asset's entry, so they are not editable here.
                                                        const RowTag = tx.isReverse ? 'div' : 'button';
                                                        return (
                                                            <RowTag
                                                                key={tx.id}
                                                                {...(tx.isReverse
                                                                    ? { className: 'list-row is-static' }
                                                                    : { type: 'button', className: 'list-row', onClick: () => handleEdit(tx), 'aria-label': `Edit ${row.title.toLowerCase()} from ${row.subtitle}` })}
                                                            >
                                                                <div className="flex flex-col" style={{ gap: '2px', flex: '0 1 auto', minWidth: '84px' }}>
                                                                    <span className="list-row-title">{row.title}</span>
                                                                    <span className="list-row-subtitle">{row.subtitle}</span>
                                                                    {tx.notes && <span className="hint" style={{ whiteSpace: 'pre-wrap' }}>{tx.notes}</span>}
                                                                </div>
                                                                <div className="flex flex-col items-end flex-1 min-w-0" style={{ gap: '2px', textAlign: 'right' }}>
                                                                    <span className="list-row-title">{hideBalances ? '••••' : row.amount}</span>
                                                                    {(row.detail || row.profit) && !hideBalances && (
                                                                        <span className="list-row-subtitle">
                                                                            {row.detail}
                                                                            {row.profit && (
                                                                                <span className={changeTone(row.profit.value)}>
                                                                                    {row.detail ? ' · ' : ''}{formatMoney(row.profit.value, baseCurrency, { signed: true })} ({formatPercent(row.profit.percent)})
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                    )}
                                                                    {row.profit && hideBalances && (
                                                                        <span className={`list-row-subtitle ${changeTone(row.profit.value)}`}>{formatPercent(row.profit.percent)}</span>
                                                                    )}
                                                                </div>
                                                            </RowTag>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </section>
                                    )}

                                    {['BTC', 'ETH'].includes(normalizeAsset(selectedAsset.symbol)) && (
                                        <WalletTracker
                                            chain={normalizeAsset(selectedAsset.symbol)}
                                            price={livePriceSnapshot.priceBase}
                                            changePercent={livePriceSnapshot.changePercent}
                                            baseCurrency={baseCurrency}
                                            hideBalances={hideBalances}
                                            portfolioId={currentPortfolioId === 'all' ? 1 : currentPortfolioId}
                                            onWalletsChange={onWalletsChange}
                                            onBalanceChange={handleWalletBalanceChange}
                                        />
                                    )}

                                    {isWatchlist && selectedAsset.originalType === 'EQUITY' && (
                                        <FinancialInfo symbol={selectedAsset.symbol} currency={selectedAsset.currency || priceData.currency} />
                                    )}

                                    {selectedLoan && (
                                        <LoanActions
                                            onEdit={() => setIsEditingLoanTerms(true)}
                                            onDelete={() => setLoanDeleteConfirm(true)}
                                        />
                                    )}
                                </>
                            )}

                            {assetTab === 'financials' && (
                                <FinancialInfo symbol={selectedAsset.symbol} currency={selectedAsset.currency || priceData.currency} />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showAssetView && !isOrphanLoan && (
                <div className="action-bar">
                    <div>
                        {isWatchlist ? (
                            isInWatchlist ? (
                                <button type="button" onClick={handleRemoveFromWatchlist} className="btn btn-secondary btn-block">
                                    <EyeOff size={17} /> Remove from watchlist
                                </button>
                            ) : (
                                <button type="button" onClick={handleAddToWatchlist} className="btn btn-block">
                                    <Eye size={17} /> Add to watchlist
                                </button>
                            )
                        ) : (
                            <button type="button" onClick={() => { setEditingTx(null); setCurrentView('FORM'); }} className="btn btn-block">
                                {selectedLoan ? 'Add entry' : 'Add transaction'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Add/Edit Transaction — bottom sheet over the asset view */}
            {isFormOpen && (
                <BottomSheet
                    title={selectedLoan ? (editingTx ? 'Edit entry' : 'New entry') : (editingTx ? 'Edit transaction' : 'New transaction')}
                    subtitle={selectedAsset?.name || selectedAsset?.symbol}
                    onClose={closeForm}
                >
                    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                        {selectedLoan ? (
                            <LoanTransactionForm
                                loan={selectedLoan}
                                existingTx={editingTx}
                                transactions={transactions}
                                onSave={(tx) => { onSave(tx); closeForm(); }}
                                onCancel={closeForm}
                            />
                        ) : (
                            <TransactionForm
                                holding={selectedAsset}
                                existingTx={editingTx}
                                transactions={transactions}
                                fetchedCurrency={selectedAsset.currency}
                                portfolios={portfolios}
                                currentPortfolioId={currentPortfolioId}
                                baseCurrency={baseCurrency}
                                onSave={(tx) => { onSave(tx); closeForm(); }}
                                onCancel={closeForm}
                            />
                        )}
                        {editingTx && (
                            <div className="flex justify-center" style={{ marginTop: 'var(--space-3)' }}>
                                <button
                                    type="button"
                                    className="btn-text is-danger"
                                    onClick={() => setDeleteConfirm({
                                        id: editingTx.id,
                                        type: describeTransaction(editingTx).title,
                                        date: editingTx.date
                                    })}
                                >
                                    {selectedLoan ? 'Delete entry' : 'Delete transaction'}
                                </button>
                            </div>
                        )}
                    </div>
                </BottomSheet>
            )}

            {isEditingLoanTerms && selectedLoan && (
                <BottomSheet title="Loan terms" subtitle={selectedLoan.name} onClose={() => setIsEditingLoanTerms(false)}>
                    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                        <LoanForm
                            loan={selectedLoan}
                            transactions={transactions}
                            baseCurrency={baseCurrency}
                            onSubmit={handleLoanTermsSave}
                            onCancel={() => setIsEditingLoanTerms(false)}
                        />
                    </div>
                </BottomSheet>
            )}

            <ConfirmModal
                isOpen={loanDeleteConfirm && !!selectedLoan}
                onClose={() => setLoanDeleteConfirm(false)}
                onConfirm={async () => {
                    const loan = selectedLoan;
                    if (!loan) return;
                    await onDeleteLoan?.(loan);
                    onClose();
                }}
                title="Delete loan"
                message={`Delete "${selectedLoan?.name || 'this loan'}" and its ${assetTransactions.length} ${assetTransactions.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                confirmStyle="danger"
            />

            {/* Delete Confirmation Modal — sibling of the sheet so the sheet's
                transform/overflow doesn't clip or offset this fixed overlay */}
            <ConfirmModal
                isOpen={deleteConfirm !== null}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={() => {
                    if (!deleteConfirm) return;
                    onDelete(deleteConfirm.id);
                    if (editingTx?.id === deleteConfirm.id) closeForm();
                }}
                title="Delete entry"
                message={`Delete this ${deleteConfirm?.type?.toLowerCase() || 'entry'} from ${deleteConfirm?.date ? formatDate(deleteConfirm.date) : 'this date'}? This cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                confirmStyle="danger"
            />
        </div>
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
    const priceLabel = type === 'DEPOSIT' ? 'Cost per unit' : 'Price per unit';
    const totalLabel = type === 'DEPOSIT' ? 'Cost basis' : 'Total';
    const [amount, setAmount] = useState(existingTx?.baseAmount || '');
    // An edited entry keeps its exact price (only float noise trimmed), so saving it unchanged keeps its total.
    const [price, setPrice] = useState(existingTx ? Number((existingTx.quoteAmount / (existingTx.baseAmount || 1)).toFixed(8)) : '');
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
                    const json = { data: await getCachedQuotes([fetchSym]) };
                    if (json.data && json.data[0]) {
                        const quote = json.data[0];
                        const nativeCurrency = (quote.currency || 'USD').toUpperCase();
                        const targetCurrency = (quoteCurrency || nativeCurrency).toUpperCase();
                        // The market price is quoted in the asset's native currency; express it in
                        // the selected price currency so it follows the chosen base/quote currency.
                        let unitPrice = quote.price;
                        if (targetCurrency !== nativeCurrency) {
                            const rate = await fetchLiveFxRate(nativeCurrency, targetCurrency);
                            if (!rate) throw new Error('Exchange rate unavailable. Enter the execution price manually.');
                            unitPrice = quote.price * rate;
                        }
                        setPrice(roundPrice(unitPrice));
                    }
                } catch (e) { console.error(e); }
                finally { setFetchingPrice(false); }
            }
            fetchPrice();
        } else if (existingTx && existingTx.quoteAmount && existingTx.baseAmount) {
            setPrice(Number((existingTx.quoteAmount / existingTx.baseAmount).toFixed(8)));
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
                const res = await apiFetch(`/api/history?symbol=${fetchSym}&range=ALL`);
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
                            if (!rate) throw new Error('Exchange rate unavailable. Enter the execution price manually.');
                            unitPrice = dayPrice.price * rate;
                        }
                        setPrice(roundPrice(unitPrice));
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

    const sizeLabel = sym.split(/[-/]/)[0];
    const canUseMax = (type === 'SELL' || type === 'WITHDRAW') && holding.amount > 0;
    const total = parseFloat(amount) * parseFloat(price);

    return (
        <form onSubmit={handleSubmit} className="form-stack">
            <Segmented
                variant="tabs"
                ariaLabel="Transaction type"
                options={availableTypes.map(t => ({ id: t, label: TRANSACTION_LABELS[t] || t }))}
                value={type}
                onChange={setType}
            />

            <AmountField
                id="transaction-amount"
                label="Amount"
                value={amount}
                onChange={setAmount}
                unit={sizeLabel}
                autoFocus
                meta={(
                    <>
                        {usesPrice && Number.isFinite(total) && <span>{totalLabel} {formatMoney(total, quoteCurrency)}</span>}
                        {canUseMax && (
                            <button type="button" className="btn-text" style={{ minHeight: 0, fontSize: 'var(--fs-sm)' }} onClick={handleMax}>
                                Max {formatQuantity(parseFloat(holding.amount) || 0)}
                            </button>
                        )}
                    </>
                )}
            />

            <div className="form-list">
                {showPortfolioSelector && (
                    <FormRow label="Portfolio" htmlFor="transaction-portfolio">
                        <select
                            id="transaction-portfolio"
                            className="form-input"
                            value={selectedPortfolioId}
                            onChange={(e) => setSelectedPortfolioId(parseInt(e.target.value))}
                        >
                            {portfolios.filter(p => !p.isWatchlist).map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </FormRow>
                )}

                {usesPrice && (
                    <FormRow label={priceLabel} hint={fetchingPrice ? 'Updating…' : null} htmlFor="transaction-price">
                        <input
                            id="transaction-price"
                            type="number"
                            step="any"
                            inputMode="decimal"
                            required={type === 'BUY' || type === 'SELL'}
                            className="form-input"
                            value={price}
                            onChange={e => {
                                setPrice(e.target.value);
                                setIsManualPrice(true);
                            }}
                            placeholder="0.00"
                        />
                        <select
                            aria-label="Price currency"
                            className="form-input"
                            style={{ flex: 'none' }}
                            value={quoteCurrency}
                            onChange={e => {
                                setQuoteCurrency(e.target.value);
                                setUserModifiedQuoteCurrency(true);
                            }}
                        >
                            {quoteCurrencyOptions.map(currency => (
                                <option key={currency} value={currency}>{currency}</option>
                            ))}
                        </select>
                    </FormRow>
                )}

                {usesPrice && affectsQuoteBalance && (
                    <SwitchRow
                        checked={useFiat}
                        onChange={(next) => {
                            setUseFiat(next);
                            setUserModifiedUseFiat(true);
                        }}
                        label={type === 'BUY' ? `Pay from ${quoteCurrency} cash` : `Add to ${quoteCurrency} cash`}
                    />
                )}

                <FormRow label="Fee" htmlFor="transaction-fee">
                    <input
                        id="transaction-fee"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        className="form-input"
                        value={fee}
                        onChange={e => setFee(e.target.value)}
                        placeholder="0"
                    />
                    <select
                        aria-label="Fee currency"
                        className="form-input"
                        style={{ flex: 'none' }}
                        value={feeCurrency}
                        onChange={e => setFeeCurrency(e.target.value)}
                    >
                        {feeCurrencyOptions.map(currency => (
                            <option key={currency} value={currency}>{currency}</option>
                        ))}
                    </select>
                </FormRow>

                <FormRow label="Date" htmlFor="transaction-date">
                    <input
                        id="transaction-date"
                        type="date"
                        required
                        className="form-input"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                    />
                </FormRow>

                <div className="form-row">
                    <textarea
                        aria-label="Note"
                        className="form-input"
                        placeholder="Add a note"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={notes.includes('\n') ? 3 : 1}
                    />
                </div>
            </div>

            {formError && <div className="form-error" role="alert">{formError}</div>}

            <button type="submit" className="btn btn-block">Save</button>
        </form>
    );
}
