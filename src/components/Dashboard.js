'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, EyeOff, Search, Settings } from 'lucide-react';
import ProfitChart from './ProfitChart';
import CompositionChart from './CompositionChart';
import HoldingsList from './HoldingsList';
import TransactionModal from './TransactionModal';
import SettingsModal from './SettingsModal';
import PullToRefresh from './PullToRefresh';
import { calculateHoldings } from '@/utils/portfolio-logic';
import { calculatePortfolioHistory } from '@/utils/portfolio-history';
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
    getAllPortfolios
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
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
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
    const prevTimeframeRef = useRef(timeframe);
    const prevBaseCurrencyRef = useRef(baseCurrency);
    const prevBaseCurrencyQuotesRef = useRef(baseCurrency);

    const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'HKD', 'SGD'];

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
                const initialPortfolioId = favPortfolio ? favPortfolio.id : 'all';
                setCurrentPortfolioId(initialPortfolioId);

                // Load transactions for current portfolio
                const savedTransactions = initialPortfolioId === 'all'
                    ? await getAllTransactions()
                    : await getTransactionsByPortfolio(initialPortfolioId);
                setTransactions(savedTransactions || []);

                const savedPrivacy = await getSetting('hide_balances', false);
                setHideBalances(savedPrivacy);

                const savedCurrency = await getSetting('base_currency', 'USD');
                setBaseCurrency(savedCurrency);
            } catch (e) {
                console.error('Failed to load from IndexedDB:', e);
            }
            setLoading(false);
        }
        loadData();
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

    // Handle portfolio change
    const handlePortfolioChange = async (portfolioId) => {
        setCurrentPortfolioId(portfolioId);
        await setSetting('current_portfolio', portfolioId);

        // Reload transactions for the new portfolio
        const newTransactions = portfolioId === 'all'
            ? await getAllTransactions()
            : await getTransactionsByPortfolio(portfolioId);
        setTransactions(newTransactions || []);

        // Trigger data refresh
        setPricesLoading(true);
        setHistoryLoading(true);
        setPrices({});
        setRawHistory([]);
        setRefreshTrigger(prev => prev + 1);
    };

    // Reload portfolios (called after settings modal closes)
    const reloadPortfolios = async () => {
        const allPortfolios = await getAllPortfolios();
        setPortfolios(allPortfolios);
    };

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

        // Identification of unique assets
        const baseAssets = [...new Set(transactions.map(t => t.baseCurrency))];
        const initialQuoteAssets = [...new Set(transactions.map(t => t.quoteCurrency))].filter(c => c && c !== baseCurrency);

        if (baseAssets.length === 0) {
            setPricesLoading(false);
            return;
        }

        // 2. Fetch prices
        let isInitialFetch = Object.keys(prices).length === 0;
        async function fetchQuotes() {
            // Only show skeletons on the VERY FIRST load or explicit currency change, never on background refresh
            const currencyChanged = prevBaseCurrencyQuotesRef.current !== baseCurrency;
            if (isInitialFetch || currencyChanged) {
                setPricesLoading(true);
                isInitialFetch = false;
            }
            prevBaseCurrencyQuotesRef.current = baseCurrency;

            try {
                // Pass 1: Fetch asset prices and discover currencies
                // For 3-letter symbols, fetch BOTH the original (might be stock like TLT) AND the USD pair (might be currency like AUD)
                // The response quoteType will determine how to link them
                const fetchList = [...baseAssets];
                baseAssets.forEach(asset => {
                    const s = asset.toUpperCase();
                    // For 3-letter symbols that might be currencies, also fetch their USD pair
                    if (s.length === 3 && /^[A-Z]{3}$/.test(s) && s !== 'USD') {
                        fetchList.push(`${s}USD=X`);
                    }
                });

                // Always ensure we have the pivot from USD to Base if Base is not USD
                // We need {Base}USD=X (e.g. EURUSD=X) to calculate USD/EUR = 1 / EURUSD
                if (baseCurrency !== 'USD') {
                    fetchList.push(`${baseCurrency}USD=X`);
                }

                const res = await fetch(`/api/quote?symbols=${[...new Set(fetchList)].join(',')}`);
                const result = await res.json();

                if (!result.data) return;

                const pxMap = {};
                const discoveredCurrencies = new Set(initialQuoteAssets);

                result.data.forEach(q => {
                    pxMap[q.symbol] = {
                        price: q.price,
                        changePercent: q.changePercent,
                        currency: q.currency,
                        name: q.name,
                        quoteType: q.quoteType
                    };

                    // Auto-link bare symbol (AUD) to USD pair (AUDUSD=X)
                    // ONLY when the USD pair is actually a currency (quoteType === 'CURRENCY')
                    // This prevents linking stock tickers like TLT to TLTUSD=X
                    if (q.quoteType === 'CURRENCY' && q.symbol.endsWith('USD=X')) {
                        const bare = q.symbol.replace('USD=X', '');
                        if (bare.length === 3 && !pxMap[bare]) {
                            // Only link if we don't already have a quote for the bare symbol
                            pxMap[bare] = { ...pxMap[q.symbol], currency: 'USD' };
                        }
                    }

                    if (q.currency && q.currency.toUpperCase() !== baseCurrency) {
                        discoveredCurrencies.add(q.currency.toUpperCase());
                    }

                    // Detect bare currencies (e.g., EUR=X) and add them to discovered currencies
                    if (q.symbol && (q.symbol.endsWith('=X') || q.quoteType === 'CURRENCY')) {
                        let base = q.symbol.replace('=X', '');
                        // If it's a USD pair (AUDUSD), the base is AUD
                        if (base.endsWith('USD') && base.length === 6) {
                            base = base.substring(0, 3);
                        }
                        if (base.length === 3 && base !== baseCurrency) {
                            discoveredCurrencies.add(base.toUpperCase());
                        }
                    }
                });

                // Pass 2: Fetch any missing exchange rates (always in USD pairs)
                // We need {Currency}USD=X so that portfolio-logic can pivot correctly
                const fxToFetch = [...discoveredCurrencies].filter(c => c !== 'USD' && c !== baseCurrency);
                if (fxToFetch.length > 0) {
                    const fxSymbols = fxToFetch.map(c => `${c}USD=X`);
                    const fxRes = await fetch(`/api/quote?symbols=${fxSymbols.join(',')}`);
                    const fxResult = await fxRes.json();

                    if (fxResult.data) {
                        fxResult.data.forEach(q => {
                            // Store the full symbol
                            pxMap[q.symbol] = { price: q.price, changePercent: q.changePercent, currency: 'USD', quoteType: 'CURRENCY' };

                            // Also store by bare currency
                            const bare = q.symbol.replace('USD=X', '');
                            if (bare.length === 3) {
                                pxMap[bare] = { price: q.price, changePercent: q.changePercent, currency: 'USD', quoteType: 'CURRENCY' };
                            }
                        });
                    }
                }

                // Ensure we have the base currency to USD rate for pivot calculations
                // portfolio-logic expects {baseCurrency}USD=X to exist
                if (baseCurrency !== 'USD' && !pxMap[`${baseCurrency}USD=X`]) {
                    const usdRes = await fetch(`/api/quote?symbols=${baseCurrency}USD=X`);
                    const usdResult = await usdRes.json();
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
                setPricesLoading(false);
            }
        }

        fetchQuotes();
        // Refresh prices every 30s in the background
        const interval = setInterval(fetchQuotes, 30000);
        return () => clearInterval(interval);

    }, [transactions, loading, baseCurrency, refreshTrigger]);

    // Recalculate Holdings when transactions or prices change
    useEffect(() => {
        const h = calculateHoldings(transactions, prices, baseCurrency);
        setHoldings(h);
    }, [transactions, prices, baseCurrency]);

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
                        const fxMatch = fetchSym.match(fxRegex);
                        if (fxMatch) {
                            const fxCurr = fxMatch[1].toUpperCase();
                            // Get FX history as map, convert to array
                            const fxMap = await getCachedFxHistory(fxCurr, baseCurrency, 'ALL');
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
                                const fxMap = await getCachedFxHistory(fxCurr, baseCurrency, timeframe);
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
                        const prices = historyData.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
                        const q1 = prices[Math.floor(prices.length * 0.25)];
                        const q3 = prices[Math.floor(prices.length * 0.75)];
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

                    // Map back from 'EURUSD=X' to 'EUR' for the logic
                    const regex = new RegExp(`^([A-Z]{3})${baseCurrency}(=X)$`, 'i');
                    const fxMatch = fetchSym.match(regex);
                    if (fxMatch) {
                        historyMap[fxMatch[1].toUpperCase()] = historyData;
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
        if (!rawHistory.length) return;

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

        // SMOOTHING: Final pass to catch spikes
        if (filtered.length > 5) {
            filtered = filtered.map((point, i, arr) => {
                if (i === 0 || i === arr.length - 1) return point;
                const prev = arr[i - 1].value;
                const curr = point.value;
                const next = arr[i + 1].value;
                if (prev === 0 || next === 0) return point;
                const diffPrev = Math.abs(curr - prev) / prev;
                const diffNext = Math.abs(curr - next) / next;
                if ((diffPrev > 0.25 && diffNext > 0.25) || (curr === 0 && prev > 0 && next > 0)) {
                    return { ...point, value: (prev + next) / 2 };
                }
                return point;
            });
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
            originalType: holding.originalType
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
                                className={`pill ${currentPortfolioId === p.id ? 'active' : ''}`}
                                style={{ flexShrink: 0 }}
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <PullToRefresh onRefresh={handleRefresh} disabled={holdings.length === 0}>
                <div className="container animate-enter" style={portfolios.length > 1 ? { paddingTop: 0 } : {}}>
                    <div className="grid-desktop">
                        {/* Main Content: Charts & Performance */}
                        <div className="main-content">

                            <header className="flex flex-col items-start px-1 pb-8 gap-4 w-full">
                                <div className="flex items-center justify-between w-full gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-muted text-xs sm:text-sm uppercase tracking-wider font-bold truncate">Portfolio Performance</span>
                                        <button
                                            onClick={togglePrivacy}
                                            className="p-1 text-muted hover:text-white transition-colors shrink-0"
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                                            title={hideBalances ? "Show Balances" : "Hide Balances"}
                                        >
                                            {hideBalances ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
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
                                        {/* Consolidated loading state: only show skeletons for what's missing */}
                                        {pricesLoading ? (
                                            <>
                                                <div className="h-10 w-48 bg-white-10 rounded animate-pulse" />
                                                <div className="flex gap-4">
                                                    <div className="h-6 w-32 bg-white-10 rounded animate-pulse" />
                                                    <div className="h-6 w-40 bg-white-10 rounded animate-pulse" />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <div className="text-2xl font-bold tracking-tight">
                                                        {hideBalances ? '••••••' : `${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}
                                                    </div>
                                                </div>
                                                <div className="flex gap-4">
                                                    <div className="h-6 w-32 bg-white-10 rounded animate-pulse" />
                                                    <div className="h-6 w-40 bg-white-10 rounded animate-pulse" />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-1">
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
                                    </div>
                                )}
                            </header>

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
                                        onClick={() => setTimeframe(tf)}
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
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSaveTransaction}
                    onDelete={handleDeleteTransaction}
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
