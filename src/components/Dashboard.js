'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Eye, EyeOff, Search, Settings } from 'lucide-react';
import ProfitChart from './ProfitChart';
import CompositionChart from './CompositionChart';
import HoldingsList, { WATCHLIST_SORT_OPTIONS } from './HoldingsList';
import TransactionModal from './TransactionModal';
import SettingsModal from './SettingsModal';
import PullToRefresh from './PullToRefresh';
import { calculateHoldings } from '@/utils/portfolio-logic';
import { calculatePortfolioHistory } from '@/utils/portfolio-history';
import { getAssetDisplayName } from '@/utils/commodities';
import { getCachedAssetHistory, setCachedAssetHistory, getCachedFxHistory, invalidateAssetCache, clearFxCache } from '@/utils/fxCache';
import {
    getAllTransactions,
    getTransactionsByPortfolio,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    getSetting,
    setSetting,
    ensureDefaultPortfolio,
    getAllPortfolios,
    getWatchlistAssets
} from '@/utils/db';

const TIMEFRAMES = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL'];

export default function Dashboard() {
    const [transactions, setTransactions] = useState([]);
    const [holdings, setHoldings] = useState([]);
    const [prices, setPrices] = useState({});
    const [history, setHistory] = useState([]);
    const [timeframe, setTimeframe] = useState('1D');
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
    const [historyLoading, setHistoryLoading] = useState(false);
    const [rawHistory, setRawHistory] = useState([]);
    const [hideBalances, setHideBalances] = useState(false);
    const [baseCurrency, setBaseCurrency] = useState('USD');
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [portfolios, setPortfolios] = useState([]);
    const [currentPortfolioId, setCurrentPortfolioId] = useState('all'); // 'all' or portfolio id
    const [isWatchlistView, setIsWatchlistView] = useState(false);
    const [watchlistAssets, setWatchlistAssets] = useState([]);
    const [watchlistSort, setWatchlistSort] = useState('custom');
    const prevTimeframeRef = useRef(timeframe);
    const prevBaseCurrencyRef = useRef(baseCurrency);
    const prevBaseCurrencyQuotesRef = useRef(baseCurrency);

    const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD', 'IDR'];

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
                    // Close Transaction modal if open
                    if (isModalOpen) {
                        setIsModalOpen(false);
                        setSelectedHolding(null);
                        return;
                    }
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
                const savedPortfolioId = await getSetting('current_portfolio');
                const initialPortfolioId = favPortfolio ? favPortfolio.id : (savedPortfolioId || 'all');
                setCurrentPortfolioId(initialPortfolioId);

                // Check if this is a watchlist
                const currentPortfolio = allPortfolios.find(p => p.id === initialPortfolioId);
                const isWatchlist = currentPortfolio?.isWatchlist || false;
                setIsWatchlistView(isWatchlist);

                if (isWatchlist) {
                    const assets = await getWatchlistAssets(initialPortfolioId);
                    setWatchlistAssets(assets);
                    setTransactions([]);
                } else {
                    // Load transactions for current portfolio
                    const savedTransactions = initialPortfolioId === 'all'
                        ? await getAllTransactions()
                        : await getTransactionsByPortfolio(initialPortfolioId);
                    setTransactions(savedTransactions || []);
                }

                const savedPrivacy = await getSetting('hide_balances', false);
                setHideBalances(savedPrivacy);

                const savedCurrency = await getSetting('base_currency', 'USD');
                setBaseCurrency(savedCurrency);

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
    }, []);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only once on mount

    const togglePrivacy = async () => {
        const newState = !hideBalances;
        setHideBalances(newState);
        await setSetting('hide_balances', newState);
    };

    const handleCurrencyChange = async (curr) => {
        setBaseCurrency(curr);
        await setSetting('base_currency', curr);
    };

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
            setTransactions([]);
        } else {
            // Reload transactions for the new portfolio
            setWatchlistAssets([]);
            const newTransactions = portfolioId === 'all'
                ? await getAllTransactions()
                : await getTransactionsByPortfolio(portfolioId);
            setTransactions(newTransactions || []);
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
        // Clear cached data and increment trigger to force useEffect to re-run
        setPrices({});
        setRawHistory([]);
        setRefreshTrigger(prev => prev + 1);
        // Small delay to show the refresh indicator
        await new Promise(resolve => setTimeout(resolve, 300));
    }, []);

    // Fetch Prices when transactions change (implies holdings might change)
    useEffect(() => {
        if (loading) return;

        // Identification of unique assets - include watchlist assets if in watchlist mode
        const baseAssets = isWatchlistView
            ? [...new Set(watchlistAssets.map(a => a.symbol))]
            : [...new Set(transactions.map(t => t.baseCurrency))];
        const initialQuoteAssets = isWatchlistView
            ? []
            : [...new Set(transactions.map(t => t.quoteCurrency))].filter(c => c && c !== baseCurrency);

        if (baseAssets.length === 0) {
            setPricesLoading(false);
            return;
        }

        // Cancellation flag to prevent race conditions during portfolio switching
        let isCancelled = false;

        // 2. Fetch prices
        let isInitialFetch = Object.keys(prices).length === 0;

        async function fetchQuotes(isBackground = false) {
            if (isCancelled) return;

            // Only show skeletons on the VERY FIRST load or explicit currency change, never on background refresh
            // But if we just switched portfolios (prices empty), we definitely want loading state.
            const currencyChanged = prevBaseCurrencyQuotesRef.current !== baseCurrency;

            // If prices are empty (portfolio switch) or currency changed, show loading
            // Prevent loading state on background refreshes to avoid UI flash
            if (!isBackground && ((Object.keys(prices).length === 0) || currencyChanged)) {
                setPricesLoading(true);
            }
            prevBaseCurrencyQuotesRef.current = baseCurrency;

            try {
                // Pass 1: Fetch asset prices and discover currencies
                const fetchList = [...baseAssets];
                baseAssets.forEach(asset => {
                    const s = asset.toUpperCase();
                    if (s.length === 3 && /^[A-Z]{3}$/.test(s) && s !== 'USD') {
                        fetchList.push(`${s}USD=X`);
                    }
                });

                if (baseCurrency !== 'USD') {
                    fetchList.push(`${baseCurrency}USD=X`);
                }

                const res = await fetch(`/api/quote?symbols=${[...new Set(fetchList)].join(',')}`);
                if (isCancelled) return;

                const result = await res.json();
                if (isCancelled) return;

                if (!result.data) {
                    setPricesLoading(false);
                    return;
                }

                const pxMap = {};
                const discoveredCurrencies = new Set(initialQuoteAssets);

                result.data.forEach(q => {
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
                        marketState: q.marketState
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
                const fxToFetch = [...discoveredCurrencies].filter(c => c !== 'USD' && c !== baseCurrency);
                if (fxToFetch.length > 0) {
                    const fxSymbols = fxToFetch.map(c => `${c}USD=X`);
                    const fxRes = await fetch(`/api/quote?symbols=${fxSymbols.join(',')}`);
                    if (isCancelled) return;

                    const fxResult = await fxRes.json();
                    if (isCancelled) return;

                    if (fxResult.data) {
                        fxResult.data.forEach(q => {
                            pxMap[q.symbol] = { price: q.price, changePercent: q.changePercent, currency: 'USD', quoteType: 'CURRENCY' };
                            const bare = q.symbol.replace('USD=X', '');
                            if (bare.length === 3) {
                                pxMap[bare] = { price: q.price, changePercent: q.changePercent, currency: 'USD', quoteType: 'CURRENCY' };
                            }
                        });
                    }
                }

                // Ensure we have the base currency to USD rate
                if (baseCurrency !== 'USD' && !pxMap[`${baseCurrency}USD=X`]) {
                    const usdRes = await fetch(`/api/quote?symbols=${baseCurrency}USD=X`);
                    if (isCancelled) return;

                    const usdResult = await usdRes.json();
                    if (isCancelled) return;

                    if (usdResult.data && usdResult.data[0]) {
                        const q = usdResult.data[0];
                        pxMap[`${baseCurrency}USD=X`] = { price: q.price, changePercent: q.changePercent, currency: 'USD', quoteType: 'CURRENCY' };
                        pxMap[baseCurrency] = { price: q.price, changePercent: q.changePercent, currency: 'USD', quoteType: 'CURRENCY' };
                    }
                }

                setPrices(pxMap);
                setPricesLoading(false);
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

    }, [transactions, loading, baseCurrency, refreshTrigger, isWatchlistView, watchlistAssets]);

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

                // Apply FX conversion if needed
                let fxRate = 1;
                if (assetCurrency !== baseCurrency) {
                    // Pivot via USD: assetCurrency -> USD -> baseCurrency
                    let toUsdRate = 1;
                    if (assetCurrency !== 'USD') {
                        const toUsdPair = prices[`${assetCurrency}USD=X`] || prices[assetCurrency];
                        if (toUsdPair && toUsdPair.price) {
                            toUsdRate = parseFloat(toUsdPair.price);
                        }
                    }

                    let fromUsdRate = 1;
                    if (baseCurrency !== 'USD') {
                        const fromUsdPair = prices[`${baseCurrency}USD=X`] || prices[baseCurrency];
                        if (fromUsdPair && fromUsdPair.price) {
                            // baseCurrency/USD gives us "1 base = X USD", we need USD/base = 1/X
                            fromUsdRate = 1 / parseFloat(fromUsdPair.price);
                        }
                    }

                    fxRate = toUsdRate * fromUsdRate;
                }

                const price = rawPrice * fxRate;

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

                const convertedDisplayPrice = displayPrice * fxRate;

                // Recalculate dailyPnl based on display price
                const displayPriceChange = displayPrice - (displayPrice / (1 + displayChange / 100));
                const displayDailyPnl = displayPriceChange * fxRate;

                return {
                    asset: asset.symbol,
                    name: getAssetDisplayName(asset.symbol, asset.name) || asset.symbol,
                    symbol: asset.symbol,
                    amount: 1, // Watchlist tracks with notional 1 unit
                    price: convertedDisplayPrice,
                    value: convertedDisplayPrice, // Value = price * 1
                    change24h: displayChange,
                    dailyPnl: displayDailyPnl,
                    originalType: asset.type,
                    currency: asset.currency,
                    quoteCurrency: assetCurrency, // Track original currency for display
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
            setHoldings(watchlistHoldings);
        } else {
            const h = calculateHoldings(transactions, prices, baseCurrency);
            setHoldings(h);
        }
    }, [transactions, prices, baseCurrency, isWatchlistView, watchlistAssets]);

    // UI Scroll reset: Only on timeframe change
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [timeframe]);

    // TRUE PORTFOLIO HISTORY
    useEffect(() => {
        if (pricesLoading) return;

        if (!transactions || transactions.length === 0) {
            setRawHistory([]);
            setHistoryLoading(false);
            return;
        }

        async function loadTrueHistory() {
            const hasChangedRange = prevTimeframeRef.current !== timeframe || prevBaseCurrencyRef.current !== baseCurrency;
            if (hasChangedRange || rawHistory.length === 0) {
                setHistoryLoading(true);
            }
            prevTimeframeRef.current = timeframe;
            prevBaseCurrencyRef.current = baseCurrency;
            // 1. Identify all assets and explicit quote currencies
            const baseAssets = [...new Set(transactions.map(t => t.baseCurrency))];
            const explicitQuoteAssets = [...new Set(transactions.map(t => t.quoteCurrency))].filter(c => c && c !== baseCurrency);

            const historyMap = {};
            const discoveredCurrencies = new Set(explicitQuoteAssets);

            try {
                // Pass 1: Get current quotes to discover currencies for baseAssets
                const res = await fetch(`/api/quote?symbols=${baseAssets.join(',')}`);
                const result = await res.json();
                if (result.data) {
                    result.data.forEach(q => {
                        if (q.currency && q.currency.toUpperCase() !== baseCurrency) {
                            discoveredCurrencies.add(q.currency.toUpperCase());
                        }
                        // Detect bare currencies (e.g., EUR=X) and add for FX conversion
                        if (q.symbol && q.symbol.endsWith('=X')) {
                            const base = q.symbol.replace('=X', '');
                            if (base.length <= 4 && base !== baseCurrency) {
                                discoveredCurrencies.add(base.toUpperCase());
                            }
                        }
                    });
                }
            } catch (e) {
                console.error("Discovery error", e);
            }

            // Pass 2: Fetch history for all base assets and discovered quote currencies
            // Using cached history with timeframe-aware TTLs (5min for 1D, 15min for 1W, 1hr for others)
            // Only upgrade 3-letter symbols to USD pairs if they are currencies (based on prices state quoteType)
            const upgradedBaseAssets = baseAssets.map(sym => {
                const s = sym.toUpperCase();
                // Skip already-formatted symbols
                if (s.includes('=X') || s.includes('-') || s === 'USD') return sym;

                // For 3-letter symbols, check if it's a currency or a stock
                if (s.length === 3 && /^[A-Z]{3}$/.test(s)) {
                    // If prices state has this symbol with quoteType that's NOT currency, keep as stock
                    const quote = prices[s];
                    if (quote && quote.quoteType && quote.quoteType !== 'CURRENCY') {
                        return sym; // It's a stock/ETF like TLT, keep as-is
                    }
                    // Otherwise, try the USD pair (for currencies like AUD)
                    if (prices[`${s}USD=X`]) {
                        return `${s}USD=X`;
                    }
                }
                return sym;
            });
            // Build FX symbols to fetch - include discovered currencies AND base currency for USD-to-base conversion
            const fxSymbols = [...discoveredCurrencies].map(c => c === 'USD' ? null : `${c}USD=X`).filter(Boolean);
            // IMPORTANT: Always include baseCurrency's USD pair for portfolio history calculations
            if (baseCurrency !== 'USD') {
                fxSymbols.push(`${baseCurrency}USD=X`);
            }
            const allSymbolsToFetch = [...new Set([...upgradedBaseAssets, ...fxSymbols])];

            await Promise.all(allSymbolsToFetch.map(async (fetchSym) => {
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
                        // Use asset history cache for regular assets
                        historyData = await getCachedAssetHistory(fetchSym, 'ALL');
                    }

                    // If short timeframe, augment with granular data (with shorter cache)
                    if (timeframe === '1D' || timeframe === '1W') {
                        let granularData = [];
                        if (isFxSymbol) {
                            const fxMatch = fetchSym.match(fxRegex);
                            if (fxMatch) {
                                const fxCurr = fxMatch[1].toUpperCase();
                                // Use USD (not baseCurrency) for consistency with pivot logic
                                const fxMap = await getCachedFxHistory(fxCurr, 'USD', timeframe);
                                granularData = Object.entries(fxMap).map(([date, price]) => ({ date, price }));
                            }
                        } else {
                            granularData = await getCachedAssetHistory(fetchSym, timeframe);
                        }

                        if (granularData.length > 0) {
                            const merged = [...historyData, ...granularData];
                            const unique = Array.from(new Map(merged.map(item => [item.date, item])).values());
                            historyData = unique.sort((a, b) => a.date.localeCompare(b.date));
                        }
                    }

                    // PRE-SMOOTH: Apply aggressive IQR + V-shape detection to individual asset prices
                    // This catches dividend spikes, splits, and API errors BEFORE portfolio aggregation
                    if (historyData.length > 10) {
                        const pricesArr = historyData.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
                        const q1 = pricesArr[Math.floor(pricesArr.length * 0.25)];
                        const q3 = pricesArr[Math.floor(pricesArr.length * 0.75)];
                        const iqr = q3 - q1;
                        const lower = q1 - (1.5 * iqr);
                        const upper = q3 + (1.5 * iqr);

                        // Pass 1: IQR outlier replacement
                        historyData = historyData.map((point, i, arr) => {
                            if (point.price < lower || point.price > upper) {
                                const start = Math.max(0, i - 2);
                                const end = Math.min(arr.length, i + 3);
                                const neighborPrices = arr.slice(start, end).map(p => p.price).filter(p => p > 0).sort((a, b) => a - b);
                                if (neighborPrices.length > 0) {
                                    const median = neighborPrices[Math.floor(neighborPrices.length / 2)];
                                    return { ...point, price: median };
                                }
                            }
                            return point;
                        });

                        // Pass 2-4: V-shape spike detection (catches 15%+ deviations from neighbors)
                        for (let pass = 0; pass < 3; pass++) {
                            for (let i = 1; i < historyData.length - 1; i++) {
                                const prev = historyData[i - 1].price;
                                const curr = historyData[i].price;
                                const next = historyData[i + 1].price;
                                if (prev > 0 && next > 0) {
                                    const diffPrev = Math.abs(curr - prev) / prev;
                                    const diffNext = Math.abs(curr - next) / next;
                                    if (diffPrev > 0.15 && diffNext > 0.15) {
                                        historyData[i] = { ...historyData[i], price: (prev + next) / 2 };
                                    }
                                }
                            }
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
            }));

            // Create a quote mapping for the history calculation
            const quoteMap = {};
            transactions.forEach(t => {
                if (t.baseCurrency && t.quoteCurrency) {
                    quoteMap[t.baseCurrency] = t.quoteCurrency;
                }
            });

            // Fallback: use live prices to fill in missing currencies in quoteMap
            Object.keys(prices).forEach(sym => {
                if (!quoteMap[sym] && prices[sym].currency) {
                    quoteMap[sym] = prices[sym].currency;
                }
            });

            const chartData = calculatePortfolioHistory(transactions, historyMap, baseCurrency, quoteMap);
            setRawHistory(chartData);
            setHistoryLoading(false);
        }

        loadTrueHistory();


    }, [transactions, timeframe, baseCurrency, pricesLoading, refreshTrigger]);

    // DERIVED HISTORY: Apply timeframe cutoff to raw history
    // NOTE: We no longer append a "real-time" point as it was causing value mismatches.
    // The chart shows historical performance; the header shows the live total.
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
            const firstTxDate = transactions.length > 0
                ? new Date(Math.min(...transactions.map(t => new Date(t.date))))
                : new Date(0);
            cutoff = firstTxDate;
        }

        const cutoffStr = cutoff.toISOString();
        let filtered = rawHistory.filter(d => d.date >= cutoffStr);

        // RESAMPLE: Reduce granularity for smoother charts
        // Daily: 30-min buckets, Weekly: 2-hour buckets
        if ((timeframe === '1D' || timeframe === '1W') && filtered.length > 0) {
            const bucketMinutes = timeframe === '1D' ? 30 : 120; // 30 min for daily, 2 hours for weekly
            const buckets = {};
            filtered.forEach(point => {
                const d = new Date(point.date);
                // Round to bucket
                const mins = Math.floor(d.getMinutes() / bucketMinutes) * bucketMinutes;
                d.setMinutes(mins, 0, 0);
                if (timeframe === '1W') {
                    // For weekly, also round hours to 2-hour blocks
                    const hrs = Math.floor(d.getHours() / 2) * 2;
                    d.setHours(hrs, 0, 0, 0);
                }
                const bucketKey = d.toISOString();
                // Keep last value in each bucket
                buckets[bucketKey] = point.value;
            });
            filtered = Object.entries(buckets)
                .map(([date, value]) => ({ date, value }))
                .sort((a, b) => a.date.localeCompare(b.date));
        }

        // MOVING AVERAGE SMOOTHING for daily view
        if (timeframe === '1D' && filtered.length > 5) {
            const windowSize = 3; // 3-point moving average
            filtered = filtered.map((point, i, arr) => {
                if (i < 1 || i >= arr.length - 1) return point;
                const values = arr.slice(Math.max(0, i - 1), Math.min(arr.length, i + 2)).map(p => p.value);
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                return { ...point, value: avg };
            });
        }

        // SPIKE REMOVAL: Multiple passes with lower threshold for smoother result
        const spikeThreshold = timeframe === '1D' ? 0.10 : 0.15; // 10% for daily, 15% for weekly
        const spikePasses = timeframe === '1D' ? 4 : 3;

        if (filtered.length > 5) {
            for (let pass = 0; pass < spikePasses; pass++) {
                filtered = filtered.map((point, i, arr) => {
                    if (i === 0 || i === arr.length - 1) return point;
                    const prev = arr[i - 1].value;
                    const curr = point.value;
                    const next = arr[i + 1].value;
                    if (prev === 0 || next === 0) return point;
                    const diffPrev = Math.abs(curr - prev) / prev;
                    const diffNext = Math.abs(curr - next) / next;
                    if ((diffPrev > spikeThreshold && diffNext > spikeThreshold) || (curr === 0 && prev > 0 && next > 0)) {
                        return { ...point, value: (prev + next) / 2 };
                    }
                    return point;
                });
            }
        }

        // Append live price point if prices are stable
        const hasPrices = Object.keys(prices).length > 0 && !pricesLoading;
        if (hasPrices) {
            const realTimeHoldings = calculateHoldings(transactions, prices, baseCurrency);
            const currentTotal = realTimeHoldings.reduce((acc, h) => acc + h.value, 0);
            if (currentTotal > 0) {
                filtered.push({
                    date: new Date().toISOString(),
                    value: currentTotal
                });
            }
        }

        setHistory(filtered);

    }, [rawHistory, transactions, timeframe, prices, pricesLoading, baseCurrency]);


    const syncTransactionsToFile = async (updatedTx) => {
        try {
            await fetch('/api/sync-csv', {
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
                        originalType: type || 'MANUAL'
                    };
                }).filter(t => t.baseCurrency);

                await clearAllTransactions();
                await importTransactions(parsed);
                clearFxCache(); // Reset all caches since we have entirely new data
                const updated = await getAllTransactions();
                setTransactions(updated);
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
    const totalValue = holdings.reduce((acc, h) => acc + (h.value || 0), 0);

    // Dynamic Timeframe Performance Calculation
    let displayDiff = 0;
    let displayPercent = 0;

    // Daily change for comparison
    const prevValueDay = holdings.reduce((acc, h) => {
        const changeFactor = 1 + ((h.change24h || 0) / 100);
        if (Math.abs(changeFactor) < 0.0001) return acc + h.value;
        return acc + (h.value / changeFactor);
    }, 0);
    const displayDiffDay = totalValue - prevValueDay;
    const displayPercentDay = prevValueDay !== 0 ? (displayDiffDay / prevValueDay) * 100 : 0;

    if (timeframe === '1D') {
        displayDiff = displayDiffDay;
        displayPercent = displayPercentDay;
    } else if (history.length > 1) {
        // Calculate performance from the start of the current historical view
        const startPoint = history[0].value;
        const currentPoint = history[history.length - 1].value;
        displayDiff = currentPoint - startPoint;
        if (startPoint !== 0) displayPercent = (displayDiff / startPoint) * 100;
    }

    const safeDiff = displayDiff || 0;
    const safePercent = displayPercent || 0;

    return (
        <>
            {/* Portfolio Selector - OUTSIDE PullToRefresh to allow horizontal scrolling */}
            {portfolios.length > 1 && (
                <div className="container" style={{ paddingBottom: '8px' }}>
                    <div
                        className="no-scrollbar"
                        style={{
                            display: 'flex',
                            gap: '8px',
                            overflowX: 'scroll',
                            overflowY: 'hidden',
                            WebkitOverflowScrolling: 'touch',
                            touchAction: 'pan-x',
                            paddingBottom: '4px',
                            width: '100%'
                        }}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => handlePortfolioChange('all')}
                            className={`pill ${currentPortfolioId === 'all' ? 'active' : ''}`}
                            style={{ flexShrink: 0 }}
                        >
                            All
                        </button>
                        {portfolios.map(p => (
                            <button
                                key={p.id}
                                onClick={() => handlePortfolioChange(p.id)}
                                className={`pill ${currentPortfolioId === p.id ? 'active' : ''} ${p.isWatchlist ? 'watchlist' : ''}`}
                                style={{ flexShrink: 0 }}
                            >
                                {p.isWatchlist && <Eye size={12} style={{ marginRight: '5px', verticalAlign: 'text-top' }} />}
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <PullToRefresh onRefresh={handleRefresh} disabled={holdings.length === 0}>
                <div className={`container animate-enter ${isWatchlistView ? 'is-watchlist' : ''}`} style={portfolios.length > 1 ? { paddingTop: 0 } : {}}>
                    <div className={`grid-desktop ${isWatchlistView ? 'is-watchlist' : ''}`}>
                        {/* Main Content: Charts & Performance */}
                        <div className="main-content">

                            <header className={`flex flex-col items-start px-1 ${isWatchlistView ? 'pb-4' : 'pb-8'} gap-4 w-full text-white`}>
                                <div className="flex items-center justify-between w-full gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-muted text-xs sm:text-sm uppercase tracking-wider font-bold truncate">
                                            {isWatchlistView ? 'Watchlist' : 'Portfolio Performance'}
                                        </span>
                                        {!isWatchlistView && (
                                            <button
                                                onClick={togglePrivacy}
                                                className="p-1 text-muted hover:text-white transition-colors shrink-0"
                                                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                                                title={hideBalances ? "Show Balances" : "Hide Balances"}
                                            >
                                                {hideBalances ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                                        <div className="relative">
                                            <select
                                                value={baseCurrency}
                                                onChange={(e) => handleCurrencyChange(e.target.value)}
                                                className="bg-white-5 hover:bg-white-10 border border-white-10 text-white text-xs font-bold rounded-full cursor-pointer transition-all focus:outline-none"
                                                style={{
                                                    appearance: 'none',
                                                    WebkitAppearance: 'none',
                                                    MozAppearance: 'none',
                                                    padding: '6px 28px 6px 12px',
                                                    width: 'auto',
                                                    minWidth: '70px',
                                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                                                    backgroundRepeat: 'no-repeat',
                                                    backgroundPosition: 'right 10px center'
                                                }}
                                            >
                                                {CURRENCIES.map(c => (
                                                    <option key={c} value={c} style={{ backgroundColor: '#171717', color: 'white' }}>
                                                        {c}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        {/* Watchlist Sort - only show for watchlists with multiple items */}
                                        {isWatchlistView && holdings.length > 1 && (
                                            <select
                                                value={watchlistSort}
                                                onChange={(e) => {
                                                    setWatchlistSort(e.target.value);
                                                    localStorage.setItem('watchlist_sort', e.target.value);
                                                }}
                                                className="bg-white-5 hover:bg-white-10 border border-white-10 text-white text-xs font-bold rounded-full cursor-pointer transition-all focus:outline-none"
                                                style={{
                                                    appearance: 'none',
                                                    WebkitAppearance: 'none',
                                                    MozAppearance: 'none',
                                                    padding: '6px 28px 6px 12px',
                                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                                                    backgroundRepeat: 'no-repeat',
                                                    backgroundPosition: 'right 10px center'
                                                }}
                                            >
                                                {WATCHLIST_SORT_OPTIONS.map(o => (
                                                    <option key={o.id} value={o.id} style={{ backgroundColor: '#171717', color: 'white' }}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                        <button
                                            onClick={() => setIsSettingsModalOpen(true)}
                                            className="p-2 text-muted hover:text-white transition-colors rounded-full hover:bg-white-5"
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}
                                            title="Settings"
                                        >
                                            <Settings size={18} />
                                        </button>
                                    </div>
                                </div>
                                {pricesLoading || (historyLoading && timeframe !== '1D') ? (
                                    <div className="flex flex-col gap-2">
                                        {pricesLoading ? (
                                            <>
                                                {!isWatchlistView && <div className="h-10 w-48 bg-white-10 rounded animate-pulse" />}
                                                {!isWatchlistView && (
                                                    <div className="flex gap-4">
                                                        <div className="h-6 w-32 bg-white-10 rounded animate-pulse" />
                                                        <div className="h-6 w-40 bg-white-10 rounded animate-pulse" />
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                {!isWatchlistView && (
                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <div className="text-2xl font-bold tracking-tight">
                                                            {hideBalances ? '••••••' : `${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                                        </div>
                                                    </div>
                                                )}
                                                {!isWatchlistView && (
                                                    <div className="flex gap-4">
                                                        <div className="h-6 w-32 bg-white-10 rounded animate-pulse" />
                                                        <div className="h-6 w-40 bg-white-10 rounded animate-pulse" />
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-1">
                                        {!isWatchlistView && (
                                            <>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <div className="text-2xl font-bold tracking-tight">
                                                        {hideBalances ? '••••••' : `${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                                    </div>
                                                    {timeframe !== '1D' && (
                                                        <div style={{ marginLeft: '5px' }} className={`text-xs px-2 py-0.5 rounded-md font-medium ${displayDiffDay >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                                                            {hideBalances ? (
                                                                `(${displayPercentDay >= 0 ? '+' : ''}${displayPercentDay.toFixed(2)}%)`
                                                            ) : (
                                                                `${displayDiffDay >= 0 ? '+' : '-'}${Math.abs(displayDiffDay).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} (${displayPercentDay >= 0 ? '+' : ''}${displayPercentDay.toFixed(2)}%)`
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={`text font-medium flex flex-wrap items-center gap-x-3`}>
                                                    <div className={safeDiff >= 0 ? 'text-success' : 'text-danger'}>
                                                        {hideBalances ? (
                                                            <span className="flex items-center gap-1">
                                                                {safePercent >= 0 ? '+' : ''}{safePercent.toFixed(2)}%
                                                            </span>
                                                        ) : (
                                                            <span>{safeDiff >= 0 ? '+' : '-'}{Math.abs(safeDiff).toLocaleString(undefined, { maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency} ({safePercent >= 0 ? '+' : ''}{safePercent.toFixed(2)}%)</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </header>

                            {/* Charts hidden for watchlists */}
                            {!isWatchlistView && (
                                <>
                                    <div className="no-select">
                                        <ProfitChart
                                            data={history}
                                            baseCurrency={baseCurrency}
                                            hideBalances={hideBalances}
                                            loading={historyLoading}
                                        />
                                    </div>


                                    <div className="flex justify-between mb-8 overflow-x-auto gap-1 sm:gap-2 no-scrollbar">
                                        {TIMEFRAMES.map((tf) => (
                                            <button
                                                key={tf}
                                                onClick={() => {
                                                    setTimeframe(tf);
                                                    localStorage.setItem('portfolio_chart_timeframe', tf);
                                                }}
                                                className={`btn ${timeframe === tf ? 'bg-white text-black shadow-lg' : 'btn-ghost opacity-60 hover:opacity-100'}`}
                                                style={{
                                                    background: timeframe === tf ? 'var(--foreground)' : 'transparent',
                                                    color: timeframe === tf ? 'var(--background)' : 'var(--muted)',
                                                    flex: 1,
                                                    minWidth: '45px',
                                                    padding: '8px 4px',
                                                    fontSize: '0.75rem'
                                                }}
                                            >
                                                {tf}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="mb-6 desktop-only no-select">
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
                                onExternalSortChange={(newSort) => {
                                    setWatchlistSort(newSort);
                                    localStorage.setItem('watchlist_sort', newSort);
                                }}
                            />
                        </div>
                    </div>
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
                    onClick={openAddModal}
                    className="btn fixed hover-scale active-scale shadow-lg"
                    style={{
                        bottom: '24px',
                        right: '24px',
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        fontSize: '24px',
                        lineHeight: '1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'white',
                        color: 'black',
                        zIndex: 10,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                    }}
                >
                    <Search size={24} />
                </button>
            )}
        </>
    );
}
