'use client';

import { apiFetch } from '@/utils/api-client';

import { startTransition, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Eye, EyeOff, Plus, Settings } from 'lucide-react';
import ProfitChart from './ProfitChart';
import CompositionChart from './CompositionChart';
import { AnimatedMoney, Delta, Money, Segmented } from './ui';
import { changeTone, formatDate, formatPercent } from '@/utils/format';
import useMarketActivity from './useMarketActivity';
import HoldingsList, { WATCHLIST_SORT_OPTIONS } from './HoldingsList';
import SortMenu from './SortMenu';
import CurrencyMenu from './CurrencyMenu';
import TransactionModal from './TransactionModal';
import SettingsModal from './SettingsModal';
import PullToRefresh from './PullToRefresh';
import {
    calculateHoldings,
    normalizeAsset,
    getCurrentAssetRate,
    getQuoteCurrencyFromSymbol,
    COMMON_FIAT_CURRENCIES,
    COMMON_CRYPTO_ASSETS
} from '@/utils/portfolio-logic';
import { calculatePortfolioHistory, getPeriodReturn } from '@/utils/portfolio-history';
import { formatSymbol } from '@/utils/commodities';
import { getCachedQuotes, getCachedAssetHistory, setCachedAssetHistory, getCachedFxHistory, invalidateAssetCache, clearFxCache } from '@/utils/fxCache';
import { historyInterval } from '@/utils/market-data';
import {
    buildHistoricalConversionMaps,
    getHistoricalConversionRate
} from '@/utils/historical-conversion';
import { parsePortfolioCsv } from '@/utils/csvImport';
import { buildLoanHistory, buildLoanQuoteMap, isLoanSymbol } from '@/utils/loans';
import {
    getAllTransactions,
    getTransactionsByPortfolio,
    backfillMissingQuoteCurrencies,
    addTransaction,
    importTransactions,
    addPortfolio,
    updateTransaction,
    deleteTransaction,
    getSetting,
    setSetting,
    ensureDefaultPortfolio,
    getAllPortfolios,
    getWalletsForPortfolio,
    getWatchlistAssets,
    updateWatchlistAssetName,
    getLoans,
    addLoan,
    updateLoan,
    deleteLoan
} from '@/utils/db';

const TIMEFRAMES = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL'];
const TIMEFRAME_LABELS = {
    '1D': 'Today',
    '1W': 'Past week',
    '1M': 'Past month',
    '1Y': 'Past year',
    'YTD': 'Year to date',
    'ALL': 'All time'
};
const MONETAX_ALLOWED_ORIGINS = (process.env.NEXT_PUBLIC_MONETAX_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => normalizeOrigin(origin))
    .filter(Boolean);

function normalizeOrigin(origin) {
    try {
        return new URL(String(origin).trim()).origin;
    } catch {
        return null;
    }
}

function isLocalhostOrigin(origin) {
    try {
        const { hostname } = new URL(origin);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    } catch {
        return false;
    }
}

function isAllowedMonetaxOrigin(origin) {
    if (!origin || origin === 'null') return false;
    if (MONETAX_ALLOWED_ORIGINS.includes(origin)) return true;
    return process.env.NODE_ENV !== 'production' && isLocalhostOrigin(origin);
}

function addExpandedMarketSymbols(target, symbol) {
    if (!symbol) return;

    const raw = String(symbol).trim();
    const upper = raw.toUpperCase();
    const normalized = normalizeAsset(upper);
    if (!normalized) return;

    target.add(raw);

    if (COMMON_FIAT_CURRENCIES.includes(normalized)) {
        if (normalized !== 'USD') target.add(`${normalized}USD=X`);
        return;
    }

    if (COMMON_CRYPTO_ASSETS.includes(normalized) && upper === normalized) {
        target.add(`${normalized}-USD`);
    }
}

function getTransactionMarketSymbols(transactions) {
    const symbols = new Set();
    transactions.forEach(tx => {
        // Loans are priced locally; only their currency needs market data.
        if (!isLoanSymbol(tx.baseCurrency)) addExpandedMarketSymbols(symbols, tx.baseCurrency);
        addExpandedMarketSymbols(symbols, tx.quoteCurrency);
        addExpandedMarketSymbols(symbols, tx.feeCurrency);
    });
    return [...symbols].filter(Boolean);
}

function getFiatCurrenciesFromTransactions(transactions, baseCurrency) {
    const currencies = new Set();
    transactions.forEach(tx => {
        [tx.baseCurrency, tx.quoteCurrency, tx.feeCurrency].forEach(symbol => {
            const normalized = normalizeAsset(symbol);
            if (
                normalized &&
                COMMON_FIAT_CURRENCIES.includes(normalized) &&
                normalized !== baseCurrency
            ) {
                currencies.add(normalized);
            }
        });
    });
    return currencies;
}

function toFiniteNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchWalletBalance(wallet) {
    try {
        const res = await apiFetch(`/api/wallet?chain=${wallet.chain}&address=${encodeURIComponent(wallet.address)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Lookup failed');
        return { balance: json.balance };
    } catch (e) {
        return { error: e.message || 'Lookup failed' };
    }
}

function getWalletPositionSymbol(chain) {
    const normalized = normalizeAsset(chain);
    if (COMMON_CRYPTO_ASSETS.includes(normalized)) return `${normalized}-USD`;
    return chain;
}

// Chart bucket per range for intraday data: enough points for a smooth path
// (1D ≈ 144, 1W ≈ 168, 1M ≈ 180) without drawing every candle.
const HISTORY_BUCKET_MINUTES = { '1D': 10, '1W': 60, '1M': 240, YTD: 720 };

function isIntradayRange(timeframe) {
    return historyInterval(timeframe) !== '1d';
}

function getHistoryBucketKey(dateValue, timeframe) {
    const time = Date.parse(dateValue);
    if (!Number.isFinite(time)) return null;
    const minutes = HISTORY_BUCKET_MINUTES[timeframe];
    if (!minutes || !isIntradayRange(timeframe)) return new Date(time).toISOString().split('T')[0];
    const size = minutes * 60000;
    return new Date(Math.floor(time / size) * size).toISOString();
}

function mergeLiveHistoryPoint(points, livePoint, timeframe) {
    const next = [...points];
    if (next.length === 0) return [livePoint];

    const last = next[next.length - 1];
    const lastBucket = getHistoryBucketKey(last.date, timeframe);
    const liveBucket = getHistoryBucketKey(livePoint.date, timeframe);

    if (lastBucket && liveBucket && lastBucket === liveBucket) {
        next[next.length - 1] = livePoint;
        return next;
    }

    next.push(livePoint);
    return next.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadPortfolioTransactions(portfolioId, baseCurrency) {
    const savedTransactions = portfolioId === 'all'
        ? await getAllTransactions()
        : await getTransactionsByPortfolio(portfolioId);

    return await backfillMissingQuoteCurrencies(savedTransactions || [], baseCurrency);
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = [];
    let nextIndex = 0;
    const workerCount = Math.min(limit, items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex++;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }));

    return results;
}

function getLiveHistoryAdjustmentRatio(rawHistory) {
    for (let i = rawHistory.length - 1; i >= 0; i--) {
        const point = rawHistory[i];
        const rawValue = parseFloat(point?.rawValue);
        const value = parseFloat(point?.value);
        if (Number.isFinite(rawValue) && rawValue > 0 && Number.isFinite(value) && value > 0) {
            return value / rawValue;
        }
    }
    return 1;
}

function DashboardSkeleton({ isWatchlist = false }) {
    return (
        <div className={`grid-desktop ${isWatchlist ? 'is-watchlist' : ''}`} aria-busy="true" aria-live="polite">
            <div className="main-content">
                <header className="portfolio-header">
                    <div className="flex items-center justify-between w-full">
                        <div className="skeleton" style={{ width: 90, height: 14 }} />
                        <div className="skeleton" style={{ width: 64, height: 28 }} />
                    </div>
                    {!isWatchlist && (
                        <div className="flex flex-col" style={{ gap: 10, marginTop: 'var(--space-3)' }}>
                            <div className="skeleton" style={{ width: 210, height: 36 }} />
                            <div className="skeleton" style={{ width: 160, height: 16 }} />
                        </div>
                    )}
                </header>
                {!isWatchlist && (
                    <>
                        <div style={{ height: 280 }} />
                        <div className="skeleton" style={{ height: 36, borderRadius: 'var(--r-md)' }} />
                    </>
                )}
            </div>

            <div className="sidebar">
                <div className="skeleton" style={{ width: 90, height: 18, marginBottom: 'var(--space-3)' }} />
                <div className="list-group">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="list-row is-static">
                            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                            <div className="flex flex-col flex-1" style={{ gap: 6 }}>
                                <div className="skeleton" style={{ width: '40%', height: 14 }} />
                                <div className="skeleton" style={{ width: '25%', height: 12 }} />
                            </div>
                            <div className="flex flex-col items-end" style={{ gap: 6 }}>
                                <div className="skeleton" style={{ width: 80, height: 14 }} />
                                <div className="skeleton" style={{ width: 48, height: 12 }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function Dashboard() {
    const { active: marketActive, revision: marketRevision } = useMarketActivity();
    const [transactions, setTransactions] = useState([]);
    const [holdings, setHoldings] = useState([]);
    const [prices, setPrices] = useState({});
    const [history, setHistory] = useState([]);
    // Timeframe the current `history` was built for (the chart fades in on change).
    const [historyTimeframe, setHistoryTimeframe] = useState(null);
    const [timeframe, setTimeframe] = useState('1D');
    // The control reflects a tap immediately; the heavier timeframe update is a transition.
    const [selectedTimeframe, setSelectedTimeframe] = useState(null);
    const [selectedHolding, setSelectedHolding] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    // Check sessionStorage synchronously to open settings immediately (no flash)
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(() => {
        if (typeof window !== 'undefined') {
            const shouldOpen = sessionStorage.getItem('openSettings') === 'true';
            if (shouldOpen) {
                sessionStorage.removeItem('openSettings');
                return true;
            }
        }
        return false;
    });
    const [modalMode, setModalMode] = useState('MANAGE');
    const [loading, setLoading] = useState(true);
    const [pricesLoading, setPricesLoading] = useState(true);
    // Gates the full-page skeleton until the first pricing + holdings pass is done,
    // so values appear all at once instead of cash flashing in before market data.
    const [hasBooted, setHasBooted] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [rawHistory, setRawHistory] = useState([]);
    const [transactionFx, setTransactionFx] = useState({});
    const [transactionFxLoading, setTransactionFxLoading] = useState(false);
    const [hideBalances, setHideBalances] = useState(false);
    const [baseCurrency, setBaseCurrency] = useState('USD');
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [portfolios, setPortfolios] = useState([]);
    const [currentPortfolioId, setCurrentPortfolioId] = useState('all'); // 'all' or portfolio id
    const [isWatchlistView, setIsWatchlistView] = useState(false);
    const [watchlistAssets, setWatchlistAssets] = useState([]);
    const [trackedWallets, setTrackedWallets] = useState([]);
    const [loans, setLoans] = useState([]);
    const [walletBalances, setWalletBalances] = useState({});
    const [watchlistSort, setWatchlistSort] = useState('custom');
    const [chartMode] = useState('value'); // Chart always shows portfolio Value
    const [monetaxImportStatus, setMonetaxImportStatus] = useState(null);
    // Chart interaction shown in the header: a scrubbed point or a selected range.
    const [chartScrub, setChartScrub] = useState(null);
    const [chartSelection, setChartSelection] = useState(null);
    const prevTimeframeRef = useRef(timeframe);
    const prevBaseCurrencyRef = useRef(baseCurrency);
    const prevBaseCurrencyQuotesRef = useRef(baseCurrency);
    const pricesRef = useRef(prices);
    const rawHistoryRef = useRef(rawHistory);
    const priceMetadataRef = useRef({});
    const monetaxImportInProgressRef = useRef(false);
    const monetaxImportRequestedRef = useRef(false);

    const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD', 'IDR'];

    // Market quotes plus locally accrued loan quotes. Recomputed with every
    // market refresh so loan interest keeps accruing in the live valuation.
    const effectivePrices = useMemo(() => {
        if (isWatchlistView || loans.length === 0) return prices;
        return { ...prices, ...buildLoanQuoteMap(loans, transactions) };
    }, [prices, loans, transactions, isWatchlistView]);

    const loansBySymbol = useMemo(() => (
        Object.fromEntries(loans.map(loan => [String(loan.symbol).toUpperCase(), loan]))
    ), [loans]);

    useEffect(() => {
        pricesRef.current = effectivePrices;
    }, [effectivePrices]);

    useEffect(() => {
        rawHistoryRef.current = rawHistory;
    }, [rawHistory]);

    const priceMetadata = useMemo(() => {
        return Object.entries(prices).reduce((acc, [symbol, quote]) => {
            acc[symbol] = {
                currency: quote?.currency,
                quoteType: quote?.quoteType
            };
            return acc;
        }, {});
    }, [prices]);

    const priceMetadataKey = useMemo(() => {
        return Object.entries(priceMetadata)
            .map(([symbol, quote]) => `${symbol}:${quote.currency || ''}:${quote.quoteType || ''}`)
            .sort()
            .join('|');
    }, [priceMetadata]);

    useEffect(() => {
        priceMetadataRef.current = priceMetadata;
    }, [priceMetadata]);

    const historicalRateResolver = useCallback((from, to, dateStr) => {
        return getHistoricalConversionRate(transactionFx, from, to, dateStr) ??
            getCurrentAssetRate(pricesRef.current, from, to);
    }, [transactionFx]);

    const transactionMarketSymbols = useMemo(() => (
        getTransactionMarketSymbols(transactions)
    ), [transactions]);

    const transactionFiatCurrencies = useMemo(() => (
        getFiatCurrenciesFromTransactions(transactions, baseCurrency)
    ), [transactions, baseCurrency]);

    const walletMarketSymbols = useMemo(() => (
        isWatchlistView
            ? []
            : [...new Set(trackedWallets.map(wallet => getWalletPositionSymbol(wallet.chain)).filter(Boolean))]
    ), [trackedWallets, isWatchlistView]);

    // Wallet balances as positions. History only needs the balances, so it uses
    // this price-independent list and is not recomputed on every quote refresh.
    const walletHistoryTransactions = useMemo(() => (
        trackedWallets.flatMap(wallet => {
            const balance = toFiniteNumber(walletBalances[wallet.id]?.balance);
            if (balance <= 0) return [];

            return [{
                id: `wallet-${wallet.id}`,
                date: wallet.addedAt || new Date().toISOString(),
                type: 'DEPOSIT',
                baseAmount: balance,
                baseCurrency: getWalletPositionSymbol(wallet.chain),
                quoteAmount: 0,
                quoteCurrency: '',
                fee: 0,
                feeCurrency: '',
                portfolioId: wallet.portfolioId,
                originalType: 'CRYPTOCURRENCY',
                isWalletPosition: true,
                walletId: wallet.id,
                chain: wallet.chain
            }];
        })
    ), [trackedWallets, walletBalances]);

    const walletPositionTransactions = useMemo(() => (
        walletHistoryTransactions.map(tx => {
            const unitValue = getCurrentAssetRate(prices, tx.chain, baseCurrency);
            return { ...tx, costBasisBase: unitValue ? tx.baseAmount * unitValue : 0 };
        })
    ), [walletHistoryTransactions, prices, baseCurrency]);

    const portfolioPositionTransactions = useMemo(() => (
        isWatchlistView ? transactions : [...transactions, ...walletPositionTransactions]
    ), [transactions, walletPositionTransactions, isWatchlistView]);

    const historyPositionTransactions = useMemo(() => (
        isWatchlistView ? transactions : [...transactions, ...walletHistoryTransactions]
    ), [transactions, walletHistoryTransactions, isWatchlistView]);

    const walletAmountByAsset = useMemo(() => {
        return walletHistoryTransactions.reduce((acc, tx) => {
            const asset = normalizeAsset(tx.baseCurrency);
            if (!asset) return acc;
            acc[asset] = (acc[asset] || 0) + toFiniteNumber(tx.baseAmount);
            return acc;
        }, {});
    }, [walletHistoryTransactions]);

    const loadPortfolioWallets = useCallback(async (portfolioId, shouldLoad = true) => {
        if (!shouldLoad) {
            setTrackedWallets([]);
            setWalletBalances({});
            return;
        }

        const wallets = await getWalletsForPortfolio(portfolioId);
        setTrackedWallets(wallets);

        if (wallets.length === 0) {
            setWalletBalances({});
            return;
        }

        const entries = await Promise.all(wallets.map(async wallet => [wallet.id, await fetchWalletBalance(wallet)]));
        setWalletBalances(Object.fromEntries(entries));
    }, []);

    const handleWalletsChange = useCallback(async () => {
        if (isWatchlistView) return;
        setPricesLoading(true);
        await loadPortfolioWallets(currentPortfolioId, true);
        setRefreshTrigger(prev => prev + 1);
    }, [currentPortfolioId, isWatchlistView, loadPortfolioWallets]);

    // Handle Android back button/gesture
    // When modals are open, close them; when on main Dashboard, exit the app
    useEffect(() => {
        let backButtonListener = null;

        const setupBackButton = async () => {
            try {
                const { App } = await import('@capacitor/app');
                backButtonListener = await App.addListener('backButton', () => {
                    // Close Settings modal if open
                    if (isSettingsModalOpen) {
                        setIsSettingsModalOpen(false);
                        return;
                    }
                    // TransactionModal registers its own back handler (sheet → asset
                    // view → close); doing anything here would double-handle the
                    // gesture and kick the user all the way home.
                    if (isModalOpen) return;
                    // No modals open - exit the app
                    App.exitApp();
                });
            } catch (e) {
                // Capacitor App plugin not available (web browser)
            }
        };

        setupBackButton();

        return () => {
            if (backButtonListener) {
                backButtonListener.remove();
            }
        };
    }, [isModalOpen, isSettingsModalOpen]);

    // Load from IndexedDB
    useEffect(() => {
        async function loadData() {
            try {
                // Ensure default portfolio exists
                const allPortfolios = await ensureDefaultPortfolio();
                setPortfolios(allPortfolios);

                // Determine initial portfolio:
                // 1. Check for a portfolio marked as default (isDefault: true)
                // 2. If no favorite, always default to 'all'
                const favPortfolio = allPortfolios.find(p => p.isDefault);
                const [savedPortfolioId, savedPrivacy, savedCurrency] = await Promise.all([
                    getSetting('current_portfolio'),
                    getSetting('hide_balances', false),
                    getSetting('base_currency', 'USD')
                ]);
                const initialPortfolioId = favPortfolio ? favPortfolio.id : (savedPortfolioId || 'all');
                setCurrentPortfolioId(initialPortfolioId);

                // Check if this is a watchlist
                const currentPortfolio = allPortfolios.find(p => p.id === initialPortfolioId);
                const isWatchlist = currentPortfolio?.isWatchlist || false;
                setIsWatchlistView(isWatchlist);

                setBaseCurrency(savedCurrency);

                if (isWatchlist) {
                    const assets = await getWatchlistAssets(initialPortfolioId);
                    setWatchlistAssets(assets);
                    await loadPortfolioWallets(initialPortfolioId, false);
                    setLoans([]);
                    setTransactions([]);
                } else {
                    // Load transactions for current portfolio
                    const [savedTransactions, savedLoans] = await Promise.all([
                        loadPortfolioTransactions(initialPortfolioId, savedCurrency),
                        getLoans(initialPortfolioId)
                    ]);
                    await loadPortfolioWallets(initialPortfolioId, true);
                    setLoans(savedLoans);
                    setTransactions(savedTransactions);
                }

                setHideBalances(savedPrivacy);

                // Load saved portfolio timeframe
                const savedTimeframe = localStorage.getItem('portfolio_chart_timeframe');
                if (savedTimeframe && ['1D', '1W', '1M', '3M', '1Y', 'YTD', 'ALL'].includes(savedTimeframe)) {
                    setTimeframe(savedTimeframe);
                }

                // Load saved watchlist sort preference
                const savedWatchlistSort = localStorage.getItem('watchlist_sort');
                if (savedWatchlistSort && WATCHLIST_SORT_OPTIONS.find(o => o.id === savedWatchlistSort)) {
                    setWatchlistSort(savedWatchlistSort);
                }
            } catch (e) {
                console.error('Failed to load from IndexedDB:', e);
            }
            setLoading(false);
        }
        loadData();
    }, [loadPortfolioWallets]);

    // Auto-open settings modal if ?settings=true is in URL (fallback for direct links)
    const searchParams = useSearchParams();
    const router = useRouter();
    useEffect(() => {
        // Only check URL param - sessionStorage is handled in useState initializer
        if (searchParams.get('settings') === 'true') {
            setIsSettingsModalOpen(true);
            // Clean up URL without triggering re-render loop
            window.history.replaceState({}, '', '/');
        }
        if (searchParams.get('monetaxImport') === '1') {
            monetaxImportRequestedRef.current = true;
            setMonetaxImportStatus({ kind: 'loading', message: 'Waiting for MoneTAX data...' });
            window.history.replaceState({}, '', '/');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only once on mount

    useEffect(() => {
        let cancelled = false;

        async function importMonetaxPayload(payload, source, origin) {
            if (payload?.source !== 'MoneTAX' || !payload?.csv) return;
            if (monetaxImportInProgressRef.current) return;
            monetaxImportInProgressRef.current = true;
            setMonetaxImportStatus({ kind: 'loading', message: 'Importing MoneTAX portfolio...' });

            try {
                const { transactions: importedTransactions, portfolioNames } = parsePortfolioCsv(payload.csv);
                if (importedTransactions.length === 0) {
                    throw new Error('No valid transactions found in the MoneTAX payload.');
                }

                let allPortfolios = await ensureDefaultPortfolio();
                let targetViewId = 'all';

                if (portfolioNames.length > 1) {
                    for (const portfolioName of portfolioNames) {
                        const groupTxs = importedTransactions.filter(tx => tx.csvPortfolioName === portfolioName);
                        let target = allPortfolios.find(p => p.name === portfolioName);
                        if (!target) {
                            const id = await addPortfolio(portfolioName);
                            target = { id, name: portfolioName };
                            allPortfolios = await getAllPortfolios();
                        }
                        await importTransactions(groupTxs.map(tx => ({ ...tx, portfolioId: target.id })), target.id);
                    }
                } else {
                    const portfolioName = portfolioNames[0] || payload.portfolioName || 'MoneTAX';
                    let target = allPortfolios.find(p => p.name === portfolioName);
                    if (!target) {
                        const id = await addPortfolio(portfolioName);
                        target = { id, name: portfolioName };
                    }
                    await importTransactions(importedTransactions.map(tx => ({ ...tx, portfolioId: target.id })), target.id);
                    targetViewId = target.id;
                }

                if (cancelled) return;
                const nextPortfolios = await getAllPortfolios();
                setPortfolios(nextPortfolios);
                await handlePortfolioChange(targetViewId, nextPortfolios);
                setMonetaxImportStatus({
                    kind: 'success',
                    message: `Imported ${importedTransactions.length} MoneTAX transactions.`,
                });
                source?.postMessage?.({
                    type: 'monetax-import-result',
                    ok: true,
                    count: importedTransactions.length,
                }, origin);
            } catch (error) {
                const message = error?.message || 'MoneTAX import failed.';
                monetaxImportInProgressRef.current = false;
                setMonetaxImportStatus({ kind: 'error', message });
                source?.postMessage?.({ type: 'monetax-import-result', ok: false, error: message }, origin);
            }
        }

        function handleMessage(event) {
            if (event.data?.type !== 'monetax-import') return;
            if (!monetaxImportRequestedRef.current || event.source !== window.opener) return;
            if (!isAllowedMonetaxOrigin(event.origin)) {
                const message = 'MoneTAX origin is not allowed for direct import.';
                setMonetaxImportStatus({ kind: 'error', message });
                event.source?.postMessage?.({ type: 'monetax-import-result', ok: false, error: message }, event.origin);
                return;
            }
            importMonetaxPayload(event.data.payload, event.source, event.origin);
        }

        window.addEventListener('message', handleMessage);
        if (monetaxImportRequestedRef.current) {
            window.opener?.postMessage?.({ type: 'monetax-ready' }, '*');
        }

        return () => {
            cancelled = true;
            window.removeEventListener('message', handleMessage);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const togglePrivacy = async () => {
        const newState = !hideBalances;
        setHideBalances(newState);
        await setSetting('hide_balances', newState);
    };

    const handleCurrencyChange = async (curr) => {
        setBaseCurrency(curr);
        await setSetting('base_currency', curr);
    };

    const handleTimeframeChange = useCallback((tf) => {
        setChartScrub(null);
        setChartSelection(null);
        setSelectedTimeframe(tf);
        startTransition(() => setTimeframe(tf));
        localStorage.setItem('portfolio_chart_timeframe', tf);
    }, []);

    const handleWatchlistSortChange = useCallback((newSort) => {
        setWatchlistSort(newSort);
        localStorage.setItem('watchlist_sort', newSort);
    }, []);

    // Handle portfolio change
    const handlePortfolioChange = async (portfolioId, updatedPortfolios = null) => {
        // Immediate clear to prevent stale data/charts
        setPricesLoading(true);
        setHistoryLoading(true);
        setPrices({});
        setRawHistory([]);
        setHistory([]);
        setLoading(true);

        setCurrentPortfolioId(portfolioId);
        await setSetting('current_portfolio', portfolioId);

        // Check if this is a watchlist - use updated list if provided, otherwise state
        const sourcePortfolios = updatedPortfolios || portfolios;
        const portfolio = sourcePortfolios.find(p => p.id === portfolioId);
        const isWatchlist = portfolio?.isWatchlist || false;
        setIsWatchlistView(isWatchlist);

        if (isWatchlist) {
            // Load watchlist assets instead of transactions
            const assets = await getWatchlistAssets(portfolioId);
            setWatchlistAssets(assets);
            await loadPortfolioWallets(portfolioId, false);
            setLoans([]);
            setTransactions([]);
        } else {
            // Reload transactions for the new portfolio
            setWatchlistAssets([]);
            const [newTransactions, newLoans] = await Promise.all([
                loadPortfolioTransactions(portfolioId, baseCurrency),
                getLoans(portfolioId)
            ]);
            await loadPortfolioWallets(portfolioId, true);
            setLoans(newLoans);
            setTransactions(newTransactions);
        }

        // Trigger data refresh logic
        setLoading(false);
        setRefreshTrigger(prev => prev + 1);
    };

    // Reload portfolios (called after settings modal closes)
    const reloadPortfolios = async () => {
        const allPortfolios = await getAllPortfolios();
        setPortfolios(allPortfolios);

        // If we are on 'all' but there is only one portfolio, force switch to it
        // This ensures users don't get stuck in 'all' view when they essentially have one context
        if (currentPortfolioId === 'all' && allPortfolios.length === 1) {
            handlePortfolioChange(allPortfolios[0].id, allPortfolios);
            return;
        }

        // If the current portfolio no longer exists (deleted), switch to 'all' or first available
        if (currentPortfolioId !== 'all' && !allPortfolios.find(p => p.id === currentPortfolioId)) {
            handlePortfolioChange('all', allPortfolios);
            return;
        }

        // If the current portfolio's watchlist status changed, we need to refresh the view
        const current = allPortfolios.find(p => p.id === currentPortfolioId);
        if (current && current.isWatchlist !== isWatchlistView) {
            handlePortfolioChange(currentPortfolioId, allPortfolios);
        }
    };

    // Reload watchlist assets when refreshTrigger changes (e.g., after reordering)
    useEffect(() => {
        if (!isWatchlistView || currentPortfolioId === 'all' || loading) return;

        async function reloadWatchlistAssets() {
            const assets = await getWatchlistAssets(currentPortfolioId);
            setWatchlistAssets(assets);
        }
        reloadWatchlistAssets();
    }, [refreshTrigger, isWatchlistView, currentPortfolioId, loading]);

    // Pull-to-refresh handler - forces a full data reload
    const handleRefresh = useCallback(async () => {
        setPricesLoading(true);
        setHistoryLoading(true);
        // Invalidate memory freshness while retaining last-known prices for outages.
        clearFxCache({ keepQuotes: true });
        setRefreshTrigger(prev => prev + 1);
        if (!isWatchlistView) {
            await loadPortfolioWallets(currentPortfolioId, true);
        }
        // Small delay to show the refresh indicator
        await new Promise(resolve => setTimeout(resolve, 300));
    }, [currentPortfolioId, isWatchlistView, loadPortfolioWallets]);

    useEffect(() => {
        if (marketActive && marketRevision > 0 && !loading && !isWatchlistView) {
            loadPortfolioWallets(currentPortfolioId, true);
        }
    }, [marketActive, marketRevision, loading, isWatchlistView, currentPortfolioId, loadPortfolioWallets]);

    useEffect(() => {
        if (!marketActive) return;
        if (loading || isWatchlistView || !transactions || transactions.length === 0) {
            setTransactionFx({});
            setTransactionFxLoading(false);
            return;
        }

        let isCancelled = false;

        async function loadTransactionFx() {
            setTransactionFxLoading(true);
            try {
                const maps = await buildHistoricalConversionMaps(transactions, baseCurrency);
                if (!isCancelled) setTransactionFx(maps);
            } catch (e) {
                console.error('Failed to fetch transaction conversion history', e);
                if (!isCancelled) setTransactionFx({});
            } finally {
                if (!isCancelled) setTransactionFxLoading(false);
            }
        }

        loadTransactionFx();

        return () => {
            isCancelled = true;
        };
    }, [transactions, baseCurrency, loading, isWatchlistView, refreshTrigger, marketActive, marketRevision]);

    // Fetch Prices when transactions change (implies holdings might change)
    useEffect(() => {
        if (loading || !marketActive) return;

        // Identification of unique assets - include quote/fee assets so crypto-to-crypto
        // and fee balances can be valued, not only the transaction base asset.
        const marketAssets = isWatchlistView
            ? [...new Set(watchlistAssets.map(a => a.symbol))]
            : [...new Set([...transactionMarketSymbols, ...walletMarketSymbols])];
        const initialQuoteAssets = isWatchlistView
            ? new Set()
            : transactionFiatCurrencies;

        if (marketAssets.length === 0) {
            setPricesLoading(false);
            return;
        }

        // Cancellation flag to prevent race conditions during portfolio switching
        let isCancelled = false;

        async function fetchQuotes(isBackground = false) {
            if (isCancelled) return;

            // Only show skeletons on the VERY FIRST load or explicit currency change, never on background refresh
            // But if we just switched portfolios (prices empty), we definitely want loading state.
            const currencyChanged = prevBaseCurrencyQuotesRef.current !== baseCurrency;

            // If prices are empty (portfolio switch) or currency changed, show loading
            // Prevent loading state on background refreshes to avoid UI flash
            if (!isBackground && ((Object.keys(pricesRef.current).length === 0) || currencyChanged)) {
                setPricesLoading(true);
            }
            prevBaseCurrencyQuotesRef.current = baseCurrency;

            try {
                // Pass 1: Fetch asset prices and discover currencies
                const fetchSet = new Set();
                marketAssets.forEach(asset => addExpandedMarketSymbols(fetchSet, asset));

                if (baseCurrency !== 'USD') {
                    fetchSet.add(`${baseCurrency}USD=X`);
                }

                const quoteData = await getCachedQuotes([...fetchSet]);
                if (isCancelled) return;

                if (quoteData.length === 0) {
                    setPricesLoading(false);
                    return;
                }

                const pxMap = {};
                const discoveredCurrencies = new Set(initialQuoteAssets);

                quoteData.forEach(q => {
                    pxMap[q.symbol] = {
                        price: q.price,
                        changePercent: q.changePercent,
                        currency: q.currency,
                        name: q.name,
                        quoteType: q.quoteType,
                        preMarketPrice: q.preMarketPrice,
                        preMarketChangePercent: q.preMarketChangePercent,
                        postMarketPrice: q.postMarketPrice,
                        postMarketChangePercent: q.postMarketChangePercent,
                        marketState: q.marketState,
                        fetchedAt: q.fetchedAt,
                        marketTime: q.marketTime,
                        isStale: q.isStale
                    };

                    if (q.quoteType === 'CURRENCY' && q.symbol.endsWith('USD=X')) {
                        const bare = q.symbol.replace('USD=X', '');
                        if (bare.length === 3 && !pxMap[bare]) {
                            pxMap[bare] = { ...pxMap[q.symbol], currency: 'USD' };
                        }
                    }

                    if (q.currency && q.currency.toUpperCase() !== baseCurrency) {
                        discoveredCurrencies.add(q.currency.toUpperCase());
                    }

                    if (q.symbol && (q.symbol.endsWith('=X') || q.quoteType === 'CURRENCY')) {
                        let base = q.symbol.replace('=X', '');
                        if (base.endsWith('USD') && base.length === 6) {
                            base = base.substring(0, 3);
                        }
                        if (base.length === 3 && base !== baseCurrency) {
                            discoveredCurrencies.add(base.toUpperCase());
                        }
                    }
                });

                // Pass 2: Fetch any missing exchange rates
                const fxToFetch = [...discoveredCurrencies].filter(c =>
                    COMMON_FIAT_CURRENCIES.includes(c) && c !== 'USD' && c !== baseCurrency
                );
                if (fxToFetch.length > 0) {
                    const fxSymbols = fxToFetch.map(c => `${c}USD=X`);
                    const fxData = await getCachedQuotes(fxSymbols);
                    if (isCancelled) return;

                    fxData.forEach(q => {
                        pxMap[q.symbol] = { ...q, currency: 'USD', quoteType: 'CURRENCY' };
                        const bare = q.symbol.replace('USD=X', '');
                        if (bare.length === 3) {
                            pxMap[bare] = { ...q, currency: 'USD', quoteType: 'CURRENCY' };
                        }
                    });
                }

                // Ensure we have the base currency to USD rate
                if (baseCurrency !== 'USD' && !pxMap[`${baseCurrency}USD=X`]) {
                    const usdData = await getCachedQuotes([`${baseCurrency}USD=X`]);
                    if (isCancelled) return;

                    if (usdData[0]) {
                        const q = usdData[0];
                        pxMap[`${baseCurrency}USD=X`] = { ...q, currency: 'USD', quoteType: 'CURRENCY' };
                        pxMap[baseCurrency] = { ...q, currency: 'USD', quoteType: 'CURRENCY' };
                    }
                }

                setPrices(pxMap);
                setPricesLoading(false);

                // Refresh watchlist asset names from Yahoo data
                if (isWatchlistView && watchlistAssets.length > 0 && currentPortfolioId) {
                    const nameUpdates = [];
                    for (const asset of watchlistAssets) {
                        const quoteData = pxMap[asset.symbol];
                        if (quoteData && quoteData.name && quoteData.name !== asset.name) {
                            nameUpdates.push(updateWatchlistAssetName(currentPortfolioId, asset.symbol, quoteData.name));
                        }
                    }

                    if (nameUpdates.length > 0) {
                        await Promise.all(nameUpdates);
                        const updatedAssets = await getWatchlistAssets(currentPortfolioId);
                        setWatchlistAssets(updatedAssets);
                    }
                }
            } catch (e) {
                console.error('Failed to fetch quotes', e);
                if (!isCancelled) setPricesLoading(false);
            }
        }

        fetchQuotes(false);
        // Refresh prices every 30s in the background
        const interval = setInterval(() => fetchQuotes(true), 30000);
        return () => {
            isCancelled = true;
            clearInterval(interval);
        };

    }, [transactionMarketSymbols, transactionFiatCurrencies, walletMarketSymbols, loading, baseCurrency, refreshTrigger, isWatchlistView, watchlistAssets, currentPortfolioId, marketActive, marketRevision]);

    // Recalculate Holdings when transactions or prices change
    useEffect(() => {
        if (isWatchlistView && watchlistAssets.length > 0) {
            // For watchlists, create holdings from watchlist assets with unit amounts
            const watchlistHoldings = watchlistAssets.map(asset => {
                const priceData = prices[asset.symbol] || {};
                const rawPrice = priceData.price || 0;
                const change24h = priceData.changePercent || 0;

                // Get the asset's native currency (usually USD for most assets)
                const assetCurrency = (priceData.currency || asset.currency || 'USD').toUpperCase();

                const fxRate = assetCurrency === baseCurrency
                    ? 1
                    : getCurrentAssetRate(prices, assetCurrency, baseCurrency);
                const fxMissing = assetCurrency !== baseCurrency && !getCurrentAssetRate(prices, assetCurrency, baseCurrency);

                const valuationUnavailable = fxMissing || rawPrice <= 0;
                const price = valuationUnavailable ? null : rawPrice * fxRate;

                // Nominal change (dailyPnl for watchlist items) - also converted
                let change = priceData.change;
                if (change === undefined || change === null) {
                    // Fallback calculation if nominal change is missing
                    change = rawPrice - (rawPrice / (1 + change24h / 100));
                }
                const dailyPnl = (change || 0) * fxRate;

                // Determine best display price based on market state
                let displayPrice = rawPrice;
                let displayChange = change24h;
                const marketState = priceData.marketState;

                if (marketState?.includes('PRE') && priceData.preMarketPrice) {
                    displayPrice = priceData.preMarketPrice;
                    displayChange = priceData.preMarketChangePercent || change24h;
                } else if ((marketState?.includes('POST')) && priceData.postMarketPrice) {
                    displayPrice = priceData.postMarketPrice;
                    displayChange = priceData.postMarketChangePercent || change24h;
                }

                const convertedDisplayPrice = valuationUnavailable ? null : displayPrice * fxRate;

                // Recalculate dailyPnl based on display price
                const displayPriceChange = displayPrice - (displayPrice / (1 + displayChange / 100));
                const displayDailyPnl = displayPriceChange * fxRate;

                return {
                    asset: asset.symbol,
                    name: formatSymbol(asset.symbol, asset.name),
                    symbol: asset.symbol,
                    amount: 1, // Watchlist tracks with notional 1 unit
                    price: convertedDisplayPrice,
                    value: convertedDisplayPrice, // Value = price * 1
                    change24h: valuationUnavailable ? null : displayChange,
                    dailyPnl: valuationUnavailable ? null : displayDailyPnl,
                    valuationUnavailable,
                    priceMissing: rawPrice <= 0,
                    fetchedAt: priceData.fetchedAt,
                    marketTime: priceData.marketTime,
                    isStale: priceData.isStale,
                    originalType: asset.type,
                    currency: asset.currency,
                    quoteCurrency: assetCurrency, // Track original currency for display
                    fxMissing,
                    isFiat: false, // Watchlists don't have fiat treatment
                    isWatchlistItem: true,
                    // Extended hours data for TransactionModal
                    marketState: marketState,
                    preMarketPrice: priceData.preMarketPrice,
                    preMarketChangePercent: priceData.preMarketChangePercent,
                    postMarketPrice: priceData.postMarketPrice,
                    postMarketChangePercent: priceData.postMarketChangePercent
                };
            });
            startTransition(() => {
                setHoldings(watchlistHoldings);
                // Flip in the same transition so the skeleton is replaced by real holdings
                // atomically (no intermediate frame with partial data).
                if (!loading && !pricesLoading) setHasBooted(true);
            });
        } else {
            if (transactionFxLoading) return;
            const h = calculateHoldings(portfolioPositionTransactions, effectivePrices, baseCurrency, historicalRateResolver)
                .map(holding => {
                    const walletAmount = walletAmountByAsset[normalizeAsset(holding.asset)] || 0;
                    const loan = loansBySymbol[String(holding.asset).toUpperCase()];
                    if (loan) return { ...holding, loan, name: loan.name || holding.name };
                    return walletAmount > 0
                        ? { ...holding, walletAmount, hasWalletPosition: true }
                        : holding;
                });
            startTransition(() => {
                setHoldings(h);
                if (!loading && !pricesLoading) setHasBooted(true);
            });
        }
    }, [
        prices,
        effectivePrices,
        loansBySymbol,
        baseCurrency,
        isWatchlistView,
        watchlistAssets,
        transactionFxLoading,
        historicalRateResolver,
        loading,
        pricesLoading,
        portfolioPositionTransactions,
        walletAmountByAsset
    ]);

    // TRUE PORTFOLIO HISTORY
    useEffect(() => {
        if (pricesLoading || !marketActive) return;

        if (!historyPositionTransactions || historyPositionTransactions.length === 0) {
            setRawHistory([]);
            setHistoryLoading(false);
            return;
        }

        let isCancelled = false;

        async function loadTrueHistory() {
            const hasChangedRange = prevTimeframeRef.current !== timeframe || prevBaseCurrencyRef.current !== baseCurrency;
            if (hasChangedRange || rawHistoryRef.current.length === 0) {
                setHistoryLoading(true);
            }
            prevTimeframeRef.current = timeframe;
            prevBaseCurrencyRef.current = baseCurrency;
            // 1. Identify all assets/currencies that can appear as balances.
            const marketAssets = [...new Set([...transactionMarketSymbols, ...walletMarketSymbols])];
            const explicitQuoteAssets = transactionFiatCurrencies;

            const historyMap = {};
            const discoveredCurrencies = new Set(explicitQuoteAssets);

            Object.entries(priceMetadataRef.current).forEach(([symbol, quote]) => {
                const currency = quote.currency?.toUpperCase();
                if (
                    currency &&
                    COMMON_FIAT_CURRENCIES.includes(currency) &&
                    currency !== baseCurrency
                ) {
                    discoveredCurrencies.add(currency);
                }

                if (symbol && symbol.endsWith('=X')) {
                    const base = symbol.replace('=X', '');
                    if (
                        base.length <= 4 &&
                        COMMON_FIAT_CURRENCIES.includes(base.toUpperCase()) &&
                        base !== baseCurrency
                    ) {
                        discoveredCurrencies.add(base.toUpperCase());
                    }
                }
            });

            // Pass 2: Fetch history for all assets and discovered fiat currencies.
            // Using cached history with timeframe-aware TTLs (5min for 1D, 15min for 1W, 1hr for others)
            const upgradedBaseAssets = marketAssets.map(sym => {
                const s = String(sym).toUpperCase();
                const normalized = normalizeAsset(s);
                // Skip already-formatted symbols
                if (s.includes('=X') || s.includes('-') || s === 'USD') return sym;

                if (COMMON_FIAT_CURRENCIES.includes(normalized)) {
                    if (normalized === 'USD') return 'USD';
                    return `${normalized}USD=X`;
                }

                if (COMMON_CRYPTO_ASSETS.includes(normalized)) {
                    return `${normalized}-USD`;
                }

                if (s.length === 3 && /^[A-Z]{3}$/.test(s)) {
                    const quote = priceMetadataRef.current[s];
                    if (quote && quote.quoteType && quote.quoteType !== 'CURRENCY') {
                        return sym;
                    }
                    if (priceMetadataRef.current[`${s}USD=X`]) {
                        return `${s}USD=X`;
                    }
                }
                return sym;
            });
            // Build FX symbols to fetch - include discovered currencies AND base currency for USD-to-base conversion
            const fxSymbols = [...discoveredCurrencies]
                .filter(c => COMMON_FIAT_CURRENCIES.includes(c))
                .map(c => c === 'USD' ? null : `${c}USD=X`)
                .filter(Boolean);
            // IMPORTANT: Always include baseCurrency's USD pair for portfolio history calculations
            if (baseCurrency !== 'USD') {
                fxSymbols.push(`${baseCurrency}USD=X`);
            }
            const allSymbolsToFetch = [...new Set([...upgradedBaseAssets, ...fxSymbols])];

            await mapWithConcurrency(allSymbolsToFetch, 6, async (fetchSym) => {
                if (isCancelled) return;
                if (fetchSym === 'USD' || !fetchSym) return;
                try {
                    // Check if this is an FX symbol (now checking for USD pairs)
                    const fxRegex = /^([A-Z]{3})USD(=X)$/i;
                    const isFxSymbol = fxRegex.test(fetchSym);

                    let historyData = [];

                    if (isFxSymbol) {
                        // Use FX cache for currency pairs
                        // IMPORTANT: Always fetch against USD for portfolio history pivot calculations
                        const fxMatch = fetchSym.match(fxRegex);
                        if (fxMatch) {
                            const fxCurr = fxMatch[1].toUpperCase();
                            // Get FX history against USD (not baseCurrency!) for pivot calculations
                            const fxMap = await getCachedFxHistory(fxCurr, 'USD', 'ALL');
                            historyData = Object.entries(fxMap).map(([date, price]) => ({ date, price }))
                                .sort((a, b) => a.date.localeCompare(b.date));
                        }
                    } else {
                        // Daily candles are closes: keyed by bare date, they only
                        // count from the end of that day (see historyTime).
                        historyData = (await getCachedAssetHistory(fetchSym, 'ALL'))
                            .map(point => ({ date: String(point.date).slice(0, 10), price: point.price }));
                    }

                    // Short ranges add intraday candles with their real times, FX included
                    // (the FX cache keeps one rate per day, which steps at midnight).
                    if (isIntradayRange(timeframe)) {
                        const granularData = await getCachedAssetHistory(fetchSym, timeframe);
                        if (granularData.length > 0) {
                            const merged = [...historyData, ...granularData];
                            const unique = Array.from(new Map(merged.map(item => [item.date, item])).values());
                            historyData = unique.sort((a, b) => a.date.localeCompare(b.date));
                        }
                    }

                    historyMap[fetchSym] = historyData;

                    // Map back from 'XXXUSD=X' to 'XXX' for portfolio-history lookup
                    // (We now fetch all FX against USD, not baseCurrency)
                    const fxMatch = fetchSym.match(/^([A-Z]{3})USD(=X)$/i);
                    if (fxMatch) {
                        // Store under both the symbol and the bare currency
                        historyMap[`${fxMatch[1].toUpperCase()}USD=X`] = historyData;
                    }
                } catch (e) { console.error(e); }
            });

            if (isCancelled) return;

            // Loans have no market history: their accrued value is rebuilt locally.
            const now = Date.now();
            loans.forEach(loan => {
                const symbol = String(loan.symbol).toUpperCase();
                historyMap[symbol] = buildLoanHistory(loan, historyPositionTransactions, { to: now })
                    .map(point => ({ date: point.date, price: point.price }));
            });

            // Create a market quote mapping for the history calculation.
            // Market quote currency must come from the price feed first; the transaction
            // quote currency is only the payment currency and can differ from the listing.
            const quoteMap = {};
            Object.entries(priceMetadataRef.current).forEach(([sym, quote]) => {
                const marketCurrency = normalizeAsset(quote?.currency || getQuoteCurrencyFromSymbol(sym));
                if (!marketCurrency) return;
                // Key by the exact instrument so multi-pair assets can't collide:
                // BTC-USD → USD and BTC-EUR → EUR must both survive. A normalized
                // ('BTC') entry is only a fallback and must never be overwritten by
                // a later pair (that made history value USD prices as EUR).
                quoteMap[String(sym).toUpperCase()] = marketCurrency;
                const normalized = normalizeAsset(sym);
                if (normalized && !quoteMap[normalized]) {
                    quoteMap[normalized] = marketCurrency;
                }
            });

            loans.forEach(loan => {
                quoteMap[String(loan.symbol).toUpperCase()] = normalizeAsset(loan.currency);
            });

            historyPositionTransactions.forEach(t => {
                const base = normalizeAsset(t.baseCurrency);
                if (!base || quoteMap[base]) return;

                const symbolQuote = normalizeAsset(getQuoteCurrencyFromSymbol(t.baseCurrency));
                if (symbolQuote) {
                    quoteMap[base] = symbolQuote;
                } else if (t.quoteCurrency) {
                    quoteMap[base] = normalizeAsset(t.quoteCurrency);
                }
            });

            await new Promise(resolve => setTimeout(resolve, 0));
            if (isCancelled) return;
            // Live resolver keeps the chart consistent with the header valuation:
            // the final point uses live quotes and unpriceable assets are excluded
            // from the whole curve (they contribute nothing to the live total either).
            const livePriceResolver = (asset) => getCurrentAssetRate(pricesRef.current, asset, baseCurrency);
            const chartData = calculatePortfolioHistory(historyPositionTransactions, historyMap, baseCurrency, quoteMap, livePriceResolver);
            if (isCancelled) return;
            startTransition(() => {
                setRawHistory(chartData);
                setHistoryLoading(false);
            });
        }

        loadTrueHistory();

        return () => {
            isCancelled = true;
        };

    }, [
        historyPositionTransactions,
        loans,
        transactionMarketSymbols,
        walletMarketSymbols,
        transactionFiatCurrencies,
        timeframe,
        baseCurrency,
        pricesLoading,
        refreshTrigger,
        priceMetadataKey,
        marketActive,
        marketRevision
    ]);

    // DERIVED HISTORY: Apply timeframe cutoff to raw history.
    // The chart is TWR-like performance adjusted for external deposits/withdrawals;
    // the header shows the live net liquidation value.
    useEffect(() => {
        if (!rawHistory.length) {
            setHistory([]);
            return;
        }

        // Apply Timeframe Cutoff
        const now = new Date();
        let cutoff = new Date();
        if (timeframe === '1D') cutoff.setDate(now.getDate() - 1);
        else if (timeframe === '1W') cutoff.setDate(now.getDate() - 7);
        else if (timeframe === '1M') cutoff.setMonth(now.getMonth() - 1);
        else if (timeframe === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
        else if (timeframe === 'YTD') cutoff = new Date(now.getFullYear(), 0, 1);
        else if (timeframe === 'ALL') {
            const firstTxTime = historyPositionTransactions.reduce((min, t) => {
                const time = Date.parse(t.date);
                return Number.isFinite(time) && time < min ? time : min;
            }, Infinity);
            const firstTxDate = new Date(Number.isFinite(firstTxTime) ? firstTxTime : 0);
            cutoff = firstTxDate;
        }

        const cutoffStr = cutoff.toISOString();
        let filtered = rawHistory.filter(d => d.date >= cutoffStr);

        // Intraday ranges: drop the daily-close points (they belong to the end of
        // their day, not its start) and resample into even buckets.
        if (isIntradayRange(timeframe) && filtered.length > 0) {
            const intraday = filtered.filter(point => String(point.date).includes('T'));
            const buckets = new Map();
            (intraday.length > 1 ? intraday : filtered).forEach(point => {
                const bucketKey = getHistoryBucketKey(point.date, timeframe);
                // Keep the last full point in each bucket so rawValue survives mode changes.
                if (bucketKey) buckets.set(bucketKey, { ...point, date: bucketKey });
            });
            filtered = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
        }

        // Append/replace a live point in the same adjusted scale as the history.
        // Using raw currentTotal directly would make the last point jump to net value.
        const hasPrices = Object.keys(prices).length > 0 && !pricesLoading;
        if (hasPrices) {
            const currentTotal = holdings.reduce((acc, h) => acc + h.value, 0);
            if (currentTotal > 0) {
                const adjustmentRatio = getLiveHistoryAdjustmentRatio(rawHistory);
                filtered = mergeLiveHistoryPoint(filtered, {
                    date: new Date().toISOString(),
                    value: currentTotal * adjustmentRatio,
                    rawValue: currentTotal,
                    netFlow: rawHistory[rawHistory.length - 1]?.netFlow ?? 0,
                    isLive: true
                }, timeframe);
            }
        }

        if (chartMode === 'value') {
            filtered = filtered.map(point => ({
                ...point,
                value: Number.isFinite(parseFloat(point.rawValue)) ? point.rawValue : point.value
            }));
        }

        startTransition(() => {
            setHistory(filtered);
            setHistoryTimeframe(timeframe);
        });

    }, [rawHistory, historyPositionTransactions, timeframe, prices, pricesLoading, holdings, chartMode]);


    const syncTransactionsToFile = async (updatedTx) => {
        // The bundled Android app keeps its ledger on the device.
        if (process.env.NEXT_PUBLIC_BUNDLED_APP === 'true') return;
        try {
            await apiFetch('/api/sync-csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactions: updatedTx })
            });
        } catch (e) {
            console.error('Failed to sync to CSV', e);
        }
    };

    const handleSaveTransaction = async (tx) => {
        // We do NOT invalidate asset cache here. The price history of the asset hasn't changed,
        // only our holdings. The portfolio history effect will run automatically when 'transactions' updates.

        const exists = transactions.find(t => t.id === tx.id);
        let updated;
        if (exists) {
            await updateTransaction(tx.id, tx);
            updated = transactions.map(t => t.id === tx.id ? tx : t);
        } else {
            // Add portfolioId if not already set
            const txWithPortfolio = {
                ...tx,
                portfolioId: tx.portfolioId || (currentPortfolioId === 'all' ? 1 : currentPortfolioId)
            };
            const newId = await addTransaction(txWithPortfolio);
            const newTx = { ...txWithPortfolio, id: newId };
            updated = [newTx, ...transactions];
        }
        setTransactions(updated);
        // Trigger generic refresh to ensure all effects run
        setRefreshTrigger(prev => prev + 1);
    };

    const handleCreateLoan = async (terms, disbursement) => {
        const portfolioId = terms.portfolioId || (currentPortfolioId === 'all' ? 1 : currentPortfolioId);
        const loan = { ...terms, portfolioId };
        const { loanId, transactionId } = await addLoan(loan, disbursement);
        const savedLoan = { ...loan, id: loanId, createdAt: new Date().toISOString() };
        const savedTx = { ...disbursement, portfolioId, id: transactionId, date: new Date(disbursement.date).toISOString() };
        setLoans(prev => [...prev, savedLoan]);
        setTransactions(prev => [savedTx, ...prev]);
        setRefreshTrigger(prev => prev + 1);
        return savedLoan;
    };

    const handleUpdateLoan = async (id, updates) => {
        await updateLoan(id, updates);
        setLoans(prev => prev.map(loan => loan.id === id ? { ...loan, ...updates } : loan));
    };

    const handleDeleteLoan = async (loan) => {
        await deleteLoan(loan.id);
        setLoans(prev => prev.filter(item => item.id !== loan.id));
        setTransactions(prev => prev.filter(tx => tx.baseCurrency !== loan.symbol));
        setRefreshTrigger(prev => prev + 1);
    };

    const handleDeleteTransaction = async (id) => {
        await deleteTransaction(id);
        const updated = transactions.filter(t => t.id !== id);
        setTransactions(updated);
        setRefreshTrigger(prev => prev + 1);
    };

    const handleImportCsv = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const text = await file.text();
        const { importTransactions, clearAllTransactions } = await import('@/utils/db');
        const Papa = (await import('papaparse')).default;

        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                // Process CSV rows similar to data.js
                const parsed = results.data.map(row => {
                    let symbol = row['Base currency (name)'] || row['Base currency'] || '';
                    const type = row['Base type'];

                    if (type === 'CRYPTO' && !symbol.includes('-')) symbol += '-USD';
                    else if (type === 'FIAT' && symbol !== 'USD') symbol += '=X';

                    const balanceFlag = row['Affects Quote Balance'] || row['Affects Cash Balance'] || row['Affects Fiat Balance'];
                    const affectsQuoteBalance = balanceFlag
                        ? ['TRUE', '1', 'YES', 'Y'].includes(String(balanceFlag).toUpperCase())
                        : undefined;

                    return {
                        date: new Date(row.Date).toISOString(),
                        type: row.Way,
                        baseAmount: parseFloat(row['Base amount']) || 0,
                        baseCurrency: symbol,
                        quoteAmount: parseFloat(row['Quote amount']) || 0,
                        quoteCurrency: row['Quote currency'] || '',
                        exchange: row.Exchange || '',
                        fee: parseFloat(row['Fee amount']) || 0,
                        feeCurrency: row['Fee currency (name)'] || '',
                        affectsFiatBalance: affectsQuoteBalance,
                        affectsQuoteBalance,
                        originalType: type || 'MANUAL'
                    };
                }).filter(t => t.baseCurrency);

                await clearAllTransactions();
                await importTransactions(parsed);
                clearFxCache(); // Reset all caches since we have entirely new data
                const updated = await getAllTransactions();
                const repaired = await backfillMissingQuoteCurrencies(updated, baseCurrency);
                setTransactions(repaired);
                alert(`Imported ${parsed.length} transactions`);
            }
        });
    };

    const handleExportCsv = async () => {
        const { exportToCsv } = await import('@/utils/db');
        const csv = await exportToCsv();
        const filename = `portfolio-${new Date().toISOString().split('T')[0]}.csv`;

        // Check if we're on a native platform
        try {
            const { Capacitor } = await import('@capacitor/core');
            if (Capacitor.isNativePlatform()) {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                const { Share } = await import('@capacitor/share');

                // Write file to cache directory
                const result = await Filesystem.writeFile({
                    path: filename,
                    data: csv,
                    directory: Directory.Cache,
                    encoding: 'utf8'
                });

                // Share the file so user can save it
                await Share.share({
                    title: 'Export Portfolio',
                    text: 'Portfolio transactions export',
                    url: result.uri,
                    dialogTitle: 'Save or Share CSV'
                });
                return;
            }
        } catch (e) {
            console.log('Native export failed, falling back to web download:', e);
        }

        // Fallback: Web browser download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const openAddModal = () => {
        setSelectedHolding(null);
        setModalMode('ADD');
        setIsModalOpen(true);
    };

    const openManageModal = (holding) => {
        setSelectedHolding({
            asset: holding.asset,
            symbol: holding.originalAsset, // Pass the actual market symbol
            price: holding.localPrice,
            amount: holding.amount,
            walletAmount: holding.walletAmount || 0,
            hasWalletPosition: !!holding.hasWalletPosition,
            originalType: holding.originalType,
            isBareCurrencyOrigin: holding.isBareCurrencyOrigin || false,
            currency: holding.quoteCurrency,
            // Extended hours data
            preMarketPrice: holding.preMarketPrice,
            preMarketChangePercent: holding.preMarketChangePercent,
            postMarketPrice: holding.postMarketPrice,
            postMarketChangePercent: holding.postMarketChangePercent,
            marketState: holding.marketState
        });
        setModalMode('MANAGE');
        setIsModalOpen(true);
    };

    // Dashboard calculations
    const {
        totalValue,
        displayPercentDay,
        safeDiff,
        safePercent
    } = useMemo(() => {
        const currentTotal = holdings.reduce((acc, h) => acc + (h.value || 0), 0);
        const grossAssets = holdings.reduce((acc, h) => acc + (!h.isFiat ? (h.value || 0) : 0), 0);
        const cash = holdings.reduce((acc, h) => acc + (h.isFiat ? (h.value || 0) : 0), 0);
        const prevValueDay = holdings.reduce((acc, h) => {
            const changeFactor = 1 + ((h.change24h || 0) / 100);
            if (Math.abs(changeFactor) < 0.0001) return acc + h.value;
            return acc + (h.value / changeFactor);
        }, 0);
        const dayDiff = currentTotal - prevValueDay;
        const dayPercent = prevValueDay !== 0 ? (dayDiff / prevValueDay) * 100 : 0;

        let displayDiff = dayDiff;
        let displayPercent = dayPercent;

        if (timeframe !== '1D' && history.length > 1) {
            const change = getPeriodReturn(history);
            displayDiff = change.diff;
            displayPercent = change.percent;
        }

        return {
            totalValue: currentTotal,
            grossAssetsValue: grossAssets,
            cashValue: cash,
            displayDiffDay: dayDiff,
            displayPercentDay: dayPercent,
            safeDiff: displayDiff || 0,
            safePercent: displayPercent || 0
        };
    }, [holdings, history, timeframe]);

    const unavailableCount = holdings.filter(holding => holding.valuationUnavailable).length;
    const knownValueCount = holdings.length - unavailableCount;
    const showTime = timeframe === '1D' || timeframe === '1W';

    // The header follows the chart: a selected range, a scrubbed point, or now.
    let headerFigure = { value: totalValue, diff: safeDiff, percent: safePercent, caption: TIMEFRAME_LABELS[timeframe] || '', live: true };
    if (chartSelection?.start && chartSelection?.end) {
        headerFigure = {
            value: chartSelection.end.value,
            ...chartSelection.change,
            caption: `${formatDate(chartSelection.start.date, { withTime: showTime })} – ${formatDate(chartSelection.end.date, { withTime: showTime })}`,
            live: false
        };
    } else if (chartScrub?.point) {
        headerFigure = {
            value: chartScrub.point.value,
            ...chartScrub.change,
            caption: formatDate(chartScrub.point.date, { withTime: showTime }),
            live: false
        };
    }
    const currentPortfolioName = currentPortfolioId === 'all'
        ? (portfolios.length > 1 ? 'All portfolios' : 'Total value')
        : portfolios.find(p => p.id === currentPortfolioId)?.name || 'Portfolio';
    const showValueSkeleton = pricesLoading && holdings.length === 0;
    const changeIsStale = headerFigure.live && historyLoading && timeframe !== '1D';

    return (
        <>
            {monetaxImportStatus && (
                <div className="toast" data-kind={monetaxImportStatus.kind} role="status" aria-live="polite">
                    {monetaxImportStatus.message}
                </div>
            )}
            {/* Portfolio Selector - OUTSIDE PullToRefresh to allow horizontal scrolling */}
            {portfolios.length > 1 && (
                <div className="container" style={{ paddingBottom: 0 }}>
                    <div
                        className="no-scrollbar"
                        style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                    >
                        <Segmented
                            variant="compact"
                            ariaLabel="Portfolio"
                            style={{ width: 'max-content', gap: 'var(--space-5)' }}
                            value={currentPortfolioId}
                            onChange={(id) => handlePortfolioChange(id)}
                            options={[
                                { id: 'all', label: 'All' },
                                ...portfolios.map(p => ({
                                    id: p.id,
                                    label: p.isWatchlist
                                        ? <span className="inline-flex items-center" style={{ gap: '5px' }}><Eye size={13} />{p.name}</span>
                                        : p.name
                                }))
                            ]}
                        />
                    </div>
                </div>
            )}

            <PullToRefresh onRefresh={handleRefresh} disabled={!hasBooted || holdings.length === 0}>
                <div className={`container ${isWatchlistView ? 'is-watchlist' : ''}`} style={portfolios.length > 1 ? { paddingTop: 0 } : {}}>
                    {!hasBooted ? (
                        <DashboardSkeleton isWatchlist={isWatchlistView} />
                    ) : (
                    <div className={`grid-desktop animate-enter ${isWatchlistView ? 'is-watchlist' : ''}`}>
                        {/* Main Content: Charts & Performance */}
                        <div className="main-content">
                            <header className="portfolio-header">
                                <div className="flex items-center justify-between w-full" style={{ gap: 'var(--space-2)' }}>
                                    <div className="flex items-center min-w-0" style={{ gap: '2px' }}>
                                        <span className="label truncate">{isWatchlistView ? 'Watchlist' : currentPortfolioName}</span>
                                        {!isWatchlistView && (
                                            <button
                                                type="button"
                                                onClick={togglePrivacy}
                                                className="icon-button"
                                                style={{ width: 28, height: 28 }}
                                                aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
                                                title={hideBalances ? 'Show balances' : 'Hide balances'}
                                            >
                                                {hideBalances ? <EyeOff size={15} /> : <Eye size={15} />}
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center shrink-0" style={{ gap: '4px' }}>
                                        <CurrencyMenu currencies={CURRENCIES} value={baseCurrency} onChange={handleCurrencyChange} />
                                        {/* Watchlist Sort - only show for watchlists with multiple items */}
                                        {isWatchlistView && holdings.length > 1 && (
                                            <SortMenu
                                                label="Sort watchlist"
                                                options={WATCHLIST_SORT_OPTIONS}
                                                value={watchlistSort}
                                                onChange={(newSort) => {
                                                    setWatchlistSort(newSort);
                                                    localStorage.setItem('watchlist_sort', newSort);
                                                }}
                                            />
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setIsSettingsModalOpen(true)}
                                            className="icon-button"
                                            aria-label="Settings"
                                            title="Settings"
                                        >
                                            <Settings size={18} />
                                        </button>
                                    </div>
                                </div>

                                {!isWatchlistView && (
                                    <div className="flex flex-col" style={{ gap: '6px', marginTop: 'var(--space-2)' }}>
                                        {showValueSkeleton ? (
                                            <>
                                                <div className="skeleton" style={{ width: 210, height: 36 }} />
                                                <div className="skeleton" style={{ width: 160, height: 16 }} />
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    type="button"
                                                    className="hero-value hero-button"
                                                    onClick={togglePrivacy}
                                                    title={hideBalances ? 'Show balances' : 'Hide balances'}
                                                >
                                                    {unavailableCount > 0 && knownValueCount === 0
                                                        ? 'Price unavailable'
                                                        : headerFigure.live
                                                            ? <AnimatedMoney value={headerFigure.value} currency={baseCurrency} hidden={hideBalances} />
                                                            : <Money value={headerFigure.value} currency={baseCurrency} hidden={hideBalances} />}
                                                </button>
                                                {unavailableCount > 0 ? (
                                                    <p role="status" className="label" style={{ margin: 0 }}>
                                                        Partial value · {unavailableCount} {unavailableCount === 1 ? 'asset needs' : 'assets need'} a price
                                                    </p>
                                                ) : (
                                                    <div className={`fade-swap flex items-center flex-wrap${changeIsStale ? ' is-stale' : ''}`} style={{ gap: '2px 8px', fontSize: 'var(--fs-md)' }}>
                                                        <Delta value={headerFigure.diff} percent={headerFigure.percent} currency={baseCurrency} hidden={hideBalances} className="font-medium" />
                                                        <span className="label">{headerFigure.caption}</span>
                                                        {headerFigure.live && timeframe !== '1D' && (
                                                            <span className="label">
                                                                · Today <span className={changeTone(displayPercentDay)}>{formatPercent(displayPercentDay)}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </header>

                            {/* Charts hidden for watchlists */}
                            {!isWatchlistView && (
                                <>
                                    <div className="portfolio-chart">
                                        <ProfitChart
                                            data={history}
                                            loading={historyLoading || historyTimeframe !== timeframe}
                                            timeframe={historyTimeframe}
                                            onScrub={setChartScrub}
                                            onRangeSelect={setChartSelection}
                                        />
                                    </div>

                                    <Segmented
                                        className="portfolio-timeframes no-select"
                                        activeColor={headerFigure.live ? (safeDiff >= 0 ? 'var(--success)' : 'var(--danger)') : undefined}
                                        ariaLabel="Chart timeframe"
                                        options={TIMEFRAMES.map(tf => ({ id: tf, label: tf }))}
                                        value={selectedTimeframe || timeframe}
                                        onChange={handleTimeframeChange}
                                    />

                                    <div className="desktop-only no-select" style={{ marginTop: 'var(--space-6)' }}>
                                        <CompositionChart holdings={holdings} baseCurrency={baseCurrency} hideBalances={hideBalances} loading={pricesLoading} />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Sidebar: Balance & Holdings */}
                        <div className="sidebar">
                            <HoldingsList
                                holdings={holdings}
                                loading={pricesLoading}
                                onSelect={openManageModal}
                                onAddAsset={openAddModal}
                                hideBalances={hideBalances}
                                baseCurrency={baseCurrency}
                                isWatchlist={isWatchlistView}
                                currentPortfolioId={currentPortfolioId}
                                onWatchlistReorder={() => setRefreshTrigger(prev => prev + 1)}
                                externalSort={watchlistSort}
                                onExternalSortChange={handleWatchlistSortChange}
                            />
                        </div>
                    </div>
                    )}
                </div>
            </PullToRefresh>

            {isModalOpen && (
                <TransactionModal
                    mode={modalMode}
                    holding={selectedHolding}
                    transactions={transactions}
                    hideBalances={hideBalances}
                    baseCurrency={baseCurrency}
                    portfolios={portfolios}
                    currentPortfolioId={currentPortfolioId}
                    isWatchlist={isWatchlistView}
                    watchlistAssets={watchlistAssets}
                    loans={loans}
                    onCreateLoan={handleCreateLoan}
                    onUpdateLoan={handleUpdateLoan}
                    onDeleteLoan={handleDeleteLoan}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSaveTransaction}
                    onDelete={handleDeleteTransaction}
                    onWatchlistUpdate={async () => {
                        // Refresh watchlist assets
                        if (currentPortfolioId !== 'all') {
                            const assets = await getWatchlistAssets(currentPortfolioId);
                            setWatchlistAssets(assets);
                            setRefreshTrigger(prev => prev + 1);
                        }
                    }}
                    onWalletsChange={handleWalletsChange}
                />
            )}

            {isSettingsModalOpen && (
                <SettingsModal
                    onClose={() => {
                        setIsSettingsModalOpen(false);
                        reloadPortfolios();
                        setRefreshTrigger(prev => prev + 1);
                    }}
                    onPortfolioChange={handlePortfolioChange}
                    currentPortfolioId={currentPortfolioId}
                />
            )}

            {!isModalOpen && !isSettingsModalOpen && (
                <button
                    type="button"
                    onClick={openAddModal}
                    aria-label="Add asset"
                    className="fab"
                >
                    <Plus size={24} strokeWidth={2.25} />
                </button>
            )}
        </>
    );
}
