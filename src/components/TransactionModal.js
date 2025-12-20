'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import AssetSearch from './AssetSearch';
import AssetChart from './AssetChart';
import ConfirmModal from './ConfirmModal';
import { Trash2, Edit2, X, Plus, ChevronLeft, ArrowLeft } from 'lucide-react';
import { normalizeAsset } from '@/utils/portfolio-logic';

const DISPLAY_NAME = true; // true = Name, false = Symbol

export default function TransactionModal({ mode, holding, transactions, onClose, onSave, onDelete, hideBalances, baseCurrency, portfolios = [], currentPortfolioId = 'all' }) {
    const modalRef = useRef(null);
    const [currentView, setCurrentView] = useState(mode === 'ADD' ? 'SEARCH' : 'LIST');
    const [selectedAsset, setSelectedAsset] = useState(holding ? {
        symbol: holding.symbol || holding.asset,
        amount: holding.amount,
        originalType: holding.originalType,
        currency: holding.currency,
        name: holding.name
    } : null);
    const [editingTx, setEditingTx] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, type, date }

    // Consolidated price data - updated atomically to guarantee single render
    // Always start loading to prevent showing cached USD price before FX conversion
    const [priceData, setPriceData] = useState({
        price: null, // Don't use cached price - wait for fresh fetch with FX
        changePercent: null,
        fxRate: 1,          // For display (may be 1 for bare currencies to avoid double conversion)
        actualFxRate: 1,    // True FX rate for calculations (used as fallback in avg price)
        historicalFx: {},
        isLoading: true // Always start loading
    });

    const prevSymbolRef = useRef(selectedAsset?.symbol);

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

    useEffect(() => {
        if (!selectedAsset) return;

        const isNewAsset = prevSymbolRef.current !== selectedAsset?.symbol;

        // Only show loading for new asset or no price
        if (isNewAsset || !priceData.price) {
            setPriceData(prev => ({ ...prev, isLoading: true }));
        }
        prevSymbolRef.current = selectedAsset?.symbol;

        async function fetchData() {
            // Priority: currency from selectedAsset, then symbol split
            let quoteCurr = selectedAsset.currency;
            if (!quoteCurr) {
                const parts = selectedAsset.symbol.split(/[-/]/);
                quoteCurr = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'USD';
            }

            // Normalize asset symbol for fetching
            let fetchSym = selectedAsset.symbol;
            if (selectedAsset.originalType === 'CRYPTOCURRENCY' && !fetchSym.includes('-')) {
                fetchSym += '-USD';
            }

            let symbolsToFetch = [fetchSym];
            if (quoteCurr && quoteCurr !== baseCurrency) {
                symbolsToFetch.push(`${quoteCurr}${baseCurrency}=X`);
            }

            try {
                const res = await fetch(`/api/quote?symbols=${symbolsToFetch.join(',')}`);
                const json = await res.json();

                let fetchedPrice = null;
                let fetchedChange = null;
                let fetchedCurrency = quoteCurr;
                let fetchedFxRate = 1;

                if (json.data) {
                    const assetQuote = json.data.find(q => q.symbol === fetchSym);
                    if (assetQuote) {
                        fetchedPrice = assetQuote.price;
                        fetchedChange = assetQuote.changePercent;
                        fetchedCurrency = (assetQuote.currency || quoteCurr).toUpperCase();
                    }

                    // For bare currencies (EUR from EUR=X → EURUSD=X), special handling:
                    // The assetPrice from EURUSD=X IS already the EUR/USD conversion rate
                    // So we should NOT multiply by fxRate again!
                    let bareCurrCode = null;
                    if (selectedAsset.isBareCurrencyOrigin && fetchSym.endsWith('=X')) {
                        const base = fetchSym.replace('=X', '');
                        if (base.length > 4) {
                            bareCurrCode = base.substring(0, 3).toUpperCase();
                        } else {
                            bareCurrCode = base.toUpperCase();
                        }
                    }

                    // Track the actual FX rate for calculations (separate from display fxRate)
                    let actualFxRateValue = fetchedFxRate;

                    if (bareCurrCode) {
                        // BARE CURRENCY CASE:
                        // For EUR (EURUSD=X) with baseCurrency USD: price IS the rate, fxRate = 1 for display
                        // For EUR (EURUSD=X) with baseCurrency EUR: price = 1, fxRate = 1
                        if (bareCurrCode === baseCurrency) {
                            // Holding EUR, displaying in EUR → price is 1
                            fetchedPrice = 1;
                            fetchedFxRate = 1;
                            actualFxRateValue = 1;
                        } else {
                            // Holding EUR, displaying in USD → price = EURUSD rate, fxRate = 1 for display
                            // But save the actual rate for avg price calculation fallback
                            actualFxRateValue = fetchedPrice; // The price IS the FX rate
                            fetchedFxRate = 1; // Don't double-convert for display!
                        }
                    } else {
                        // REGULAR ASSET CASE: normal FX conversion
                        if (fetchedCurrency === baseCurrency) {
                            fetchedFxRate = 1;
                            actualFxRateValue = 1;
                        } else {
                            const expectedFxSymbol = `${fetchedCurrency}${baseCurrency}=X`;
                            let fxQuote = json.data.find(q => q.symbol === expectedFxSymbol);

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
                                console.warn(`Could not get FX rate for ${expectedFxSymbol}, using 1`);
                            }
                        }
                    }

                    // Store actualFxRate for later use
                    var fetchedActualFxRate = actualFxRateValue;
                }

                // Fetch historical FX if needed
                // For bare currencies, use the bare currency code, not the Yahoo-reported currency
                let fetchedHMap = {};
                let currencyForHistory = fetchedCurrency;
                if (selectedAsset.isBareCurrencyOrigin && fetchSym.endsWith('=X')) {
                    const base = fetchSym.replace('=X', '');
                    currencyForHistory = base.length > 4 ? base.substring(0, 3).toUpperCase() : base.toUpperCase();
                }

                if (currencyForHistory && currencyForHistory !== baseCurrency) {
                    try {
                        // Use FX cache for historical data
                        const { getCachedFxHistory } = await import('@/utils/fxCache');
                        fetchedHMap = await getCachedFxHistory(currencyForHistory, baseCurrency, 'ALL');
                    } catch (e) {
                        console.error('Failed to fetch historical FX:', e);
                    }
                }

                // Update currency in selectedAsset if needed (won't re-trigger effect)
                if (fetchedCurrency !== selectedAsset.currency) {
                    setSelectedAsset(prev => prev ? { ...prev, currency: fetchedCurrency } : prev);
                }

                // SINGLE atomic update - guarantees exactly one render
                setPriceData({
                    price: fetchedPrice,
                    changePercent: fetchedChange,
                    fxRate: fetchedFxRate,
                    actualFxRate: fetchedActualFxRate || fetchedFxRate,
                    historicalFx: fetchedHMap,
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
    }, [selectedAsset?.symbol, baseCurrency]);

    // Destructure for easy access throughout component
    const { price: assetPrice, changePercent, fxRate, actualFxRate, historicalFx, isLoading: loadingPrice } = priceData;

    const assetTransactions = selectedAsset
        ? transactions.filter(t => {
            const normalizedBase = normalizeAsset(t.baseCurrency);
            const normalizedTarget = normalizeAsset(selectedAsset.symbol);
            return normalizedBase === normalizedTarget || normalizeAsset(t.quoteCurrency) === normalizedTarget;
        })
            .map(t => {
                const isReverse = normalizeAsset(t.quoteCurrency) === normalizeAsset(selectedAsset.symbol);
                return { ...t, isReverse };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date))
        : [];

    const { currentBalance, averagePurchasePrice } = useMemo(() => {
        if (!selectedAsset) return { currentBalance: 0, averagePurchasePrice: 0 };
        let totalAmount = 0;
        let totalCostBase = 0; // Total cost in baseCurrency
        let buyAmount = 0;

        const normalizedSymbol = normalizeAsset(selectedAsset.symbol);

        // Detect if this is a bare currency (EURUSD=X for EUR holdings)
        const sym = selectedAsset.symbol || '';
        const isBareOrigin = selectedAsset.isBareCurrencyOrigin;
        let bareCurrCode = null;
        if (isBareOrigin && sym.endsWith('=X')) {
            // Extract EUR from EURUSD=X
            const base = sym.replace('=X', '');
            if (base.length > 4) {
                bareCurrCode = base.substring(0, 3).toUpperCase();
            } else {
                bareCurrCode = base.toUpperCase();
            }
        }

        transactions
            .filter(t => normalizeAsset(t.baseCurrency) === normalizedSymbol)
            .forEach(t => {
                const bAmt = parseFloat(t.baseAmount) || 0;
                const qAmt = parseFloat(t.quoteAmount) || 0;
                const dateStr = t.date.split('T')[0];

                // For bare currencies (deposits), the asset currency is the bare currency code (e.g., EUR)
                // For regular assets, use the transaction's quote currency or asset's currency
                const txQuoteCurr = (t.quoteCurrency || selectedAsset.currency || 'USD').toUpperCase();

                // Get FX rate to convert from txQuoteCurrency to baseCurrency
                let hFx = 1;
                if (txQuoteCurr !== baseCurrency) {
                    hFx = historicalFx[dateStr] || actualFxRate || 1;
                }

                if (['BUY', 'DEPOSIT'].includes(t.type)) {
                    totalAmount += bAmt;
                    // Only BUY contributes to avg price (not DEPOSIT)
                    if (t.type === 'BUY') {
                        totalCostBase += qAmt * hFx;
                        buyAmount += bAmt;
                    }
                } else if (['SELL', 'WITHDRAW'].includes(t.type)) {
                    totalAmount -= bAmt;
                }
            });

        const avgBase = buyAmount > 0 ? (totalCostBase / buyAmount) : 0;
        return { currentBalance: totalAmount, averagePurchasePrice: avgBase };
    }, [transactions, selectedAsset?.symbol, selectedAsset?.currency, historicalFx, actualFxRate, baseCurrency]);

    const handleAssetSelect = (asset) => {
        // Calculate current balance for the selected asset from transaction history
        const normalizedTarget = normalizeAsset(asset.symbol);
        const balance = transactions
            ? transactions
                .filter(t => normalizeAsset(t.baseCurrency) === normalizedTarget)
                .reduce((acc, t) => {
                    const bAmt = parseFloat(t.baseAmount) || 0;
                    if (['BUY', 'DEPOSIT'].includes(t.type)) return acc + bAmt;
                    if (['SELL', 'WITHDRAW'].includes(t.type)) return acc - bAmt;
                    return acc;
                }, 0)
            : 0;

        setSelectedAsset({
            symbol: asset.symbol,
            price: null,
            amount: balance,
            originalType: asset.type,
            currency: asset.currency, // Use currency from search result
            isBareCurrencyOrigin: asset.isBareCurrencyOrigin || false
        });
        setCurrentView('LIST');
        setEditingTx(null);
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

    // Layout fixed
    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#000',
                color: 'white',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                animation: 'fadeIn 0.2s ease-out',
                height: '100dvh',
                width: '100vw',
                paddingTop: 'env(safe-area-inset-top, 0px)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)'
            }}
        >
            {/* Header Area */}
            <div className="flex items-center justify-between p-4 sm:p-6 sm:px-8" style={{ borderBottom: '1px solid #262626' }}>
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleBack}
                        className="p-2 -ml-2 rounded-full hover-bg-surface transition-all text-muted hover:text-white"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ margin: 0 }}>
                        {currentView === 'SEARCH' ? 'Add Asset' : (
                            DISPLAY_NAME ? (selectedAsset?.name || selectedAsset?.symbol) : selectedAsset?.symbol || 'Details'
                        )}
                    </h2>
                </div>
                {currentView === 'LIST' && selectedAsset && (
                    <button
                        onClick={() => { setEditingTx(null); setCurrentView('FORM'); }}
                        className="btn flex items-center gap-2"
                        style={{ padding: '10px 20px' }}
                    >
                        <Plus size={18} />
                        <span className="hidden sm:inline">Add Transaction</span>
                    </button>
                )}
            </div>

            <div
                ref={modalRef}
                className="flex-1 overflow-y-auto p-6"
                style={{
                    paddingBottom: '120px',
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
                            {/* Chart Section */}
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-start mb-4 gap-4">
                                    <div className="flex flex-col flex-1 items-start">
                                        <span className="text-xs sm:text-sm text-muted uppercase tracking-wider">Current Price</span>
                                        {loadingPrice || !assetPrice ? (
                                            <div className="h-7 w-24 bg-white-10 rounded animate-pulse mt-1" />
                                        ) : (
                                            <span className={`text sm:text-2xl ${(changePercent || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {(assetPrice * fxRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                            </span>
                                        )}
                                    </div>
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
                                    <div className="flex flex-col flex-1 items-end">
                                        <span className="text-xs sm:text-sm text-muted uppercase tracking-wider text-right">Total Value</span>
                                        {loadingPrice || !assetPrice ? (
                                            <div className="h-7 w-32 bg-white-10 rounded animate-pulse mt-1" />
                                        ) : (
                                            <span className="text sm:text-2xl text-success text-right">{hideBalances ? '••••••' : `${(currentBalance * assetPrice * fxRate).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="w-full">
                                    <AssetChart
                                        symbol={selectedAsset.symbol}
                                        baseCurrency={baseCurrency}
                                        fxRate={fxRate}
                                        parentLoading={loadingPrice}
                                        assetCurrency={selectedAsset.currency || priceData.currency}
                                    />
                                </div>
                            </div>

                            {/* Transactions List */}
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
                                                    </div>
                                                </div>

                                                <div className="flex-1 flex flex-col items-end">
                                                    {tx.type === 'BUY' && !tx.isReverse && (
                                                        <>
                                                            {loadingPrice || !assetPrice ? (
                                                                <div className="h-5 w-20 bg-white-10 rounded animate-pulse ml-auto" style={{ marginRight: '10px' }} />
                                                            ) : (
                                                                (() => {
                                                                    const dateStr = tx.date.split('T')[0];
                                                                    // Use the ASSET's currency, not the tx quote currency
                                                                    // Use asset's currency as fallback when tx has no quoteCurrency
                                                                    const txQuoteCurrency = (tx.quoteCurrency || selectedAsset.currency || 'USD').toUpperCase();

                                                                    // FX for cost: convert tx quote currency to base currency
                                                                    let costFx = 1;
                                                                    if (txQuoteCurrency !== baseCurrency) {
                                                                        costFx = historicalFx[dateStr] || fxRate || 1;
                                                                    }
                                                                    const costBase = tx.quoteAmount * costFx;

                                                                    // Current value uses fxRate (asset to base)
                                                                    const currentValBase = tx.baseAmount * assetPrice * fxRate;
                                                                    const pnlBase = currentValBase - costBase;
                                                                    const pnlPercent = (pnlBase / costBase) * 100;

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
                                                                            // Use asset's currency as fallback when tx has no quoteCurrency
                                                                            const txQuoteCurrency = (tx.quoteCurrency || selectedAsset.currency || 'USD').toUpperCase();
                                                                            // FX for cost: convert tx quote currency to base currency
                                                                            let costFx = 1;
                                                                            if (txQuoteCurrency !== baseCurrency) {
                                                                                costFx = historicalFx[dateStr] || fxRate || 1;
                                                                            }
                                                                            return `${((tx.quoteAmount / tx.baseAmount) * costFx).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`;
                                                                        })()}
                                                                    </span>
                                                                )}
                                                                {tx.type === 'BUY' && (
                                                                    loadingPrice || !assetPrice ? (
                                                                        <div className="h-3 w-8 bg-white-10 rounded animate-pulse ml-auto" style={{ marginLeft: '5px' }} />
                                                                    ) : (
                                                                        <span className="text-xs text-[10px] text-muted">
                                                                            | {hideBalances ? '••••••' : (() => {
                                                                                const dateStr = tx.date.split('T')[0];
                                                                                // Use asset's currency as fallback when tx has no quoteCurrency
                                                                                const txQuoteCurrency = (tx.quoteCurrency || selectedAsset.currency || 'USD').toUpperCase();
                                                                                const hFx = txQuoteCurrency !== baseCurrency ? (historicalFx[dateStr] || fxRate || 1) : 1;
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

            {/* Delete Confirmation Modal */}
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

    // Show portfolio selector if in 'All' view with multiple portfolios
    const showPortfolioSelector = currentPortfolioId === 'all' && portfolios.length > 1;
    const [selectedPortfolioId, setSelectedPortfolioId] = useState(
        existingTx?.portfolioId || (portfolios.length > 0 ? portfolios[0].id : 1)
    );

    // Detect quote currency from symbol (e.g., BTC-EUR -> EUR, SAP.DE -> EUR)
    const detectedQuote = useMemo(() => {
        if (fetchedCurrency) return fetchedCurrency.toUpperCase();
        if (holding.currency) return holding.currency.toUpperCase();
        if (!sym) return 'USD';

        // Try to split by common dividers
        const parts = sym.split(/[-/.]/);
        // Special case for Yahoo Finance symbols like SAP.DE, AAPL.MI etc.
        if (sym.includes('.') && parts.length > 1) {
            const suffix = parts[parts.length - 1].toUpperCase();
            const suffixMap = { 'DE': 'EUR', 'MI': 'EUR', 'PA': 'EUR', 'AS': 'EUR', 'MC': 'EUR', 'L': 'GBP', 'HK': 'HKD', 'TO': 'CAD' };
            if (suffixMap[suffix]) return suffixMap[suffix];
        }

        if (parts.length > 1) {
            const quote = parts[parts.length - 1].toUpperCase();
            // Basic sanity check to ensure it looks like a currency code
            if (quote.length === 3) return quote;
        }
        return 'USD';
    }, [sym, holding.currency, fetchedCurrency]);

    // Default type: DEPOSIT for bare currencies, else existing or BUY
    const [type, setType] = useState(() => {
        if (existingTx?.type) return existingTx.type;
        return isBareCurrency ? 'DEPOSIT' : 'BUY';
    });
    const [amount, setAmount] = useState(existingTx?.baseAmount || '');
    const [price, setPrice] = useState(existingTx ? (existingTx.quoteAmount / (existingTx.baseAmount || 1)) : '');
    const [date, setDate] = useState(existingTx?.date ? new Date(existingTx.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    // Calculate quote balance to determine default toggle state
    const quoteBalance = useMemo(() => {
        if (!transactions || !detectedQuote) return 0;
        const q = detectedQuote.toUpperCase();
        return transactions
            .filter(t => {
                const b = (t.baseCurrency || '').toUpperCase();
                // Match "EUR", "EUR=X", "EURUSD=X" or "EUR-USD"
                return b === q || b === `${q}=X` || b === `${q}USD=X` || b === `${q}-USD` || b === `USD-${q}`;
            })
            .reduce((acc, t) => {
                const bAmt = parseFloat(t.baseAmount) || 0;
                if (['BUY', 'DEPOSIT'].includes(t.type)) return acc + bAmt;
                if (['SELL', 'WITHDRAW'].includes(t.type)) return acc - bAmt;
                return acc;
            }, 0);
    }, [transactions, detectedQuote]);

    const [useFiat, setUseFiat] = useState(existingTx ? !!existingTx.quoteCurrency : quoteBalance > 0);

    // Sync useFiat when quote currency changes (for new transactions)
    useEffect(() => {
        if (!existingTx) {
            setUseFiat(quoteBalance > 0);
        }
    }, [detectedQuote, quoteBalance, existingTx]);

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
                        setPrice(json.data[0].price);
                    }
                } catch (e) { console.error(e); }
                finally { setFetchingPrice(false); }
            }
            fetchPrice();
        } else if (existingTx && existingTx.quoteAmount && existingTx.baseAmount) {
            setPrice(existingTx.quoteAmount / existingTx.baseAmount);
        }
    }, [sym, existingTx, isBareCurrency, bareCurrencyCode, baseCurrency]);

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
                        setPrice(dayPrice.price);
                    }
                }
            } catch (e) { console.error(e); }
            finally { setFetchingPrice(false); }
        }

        const tId = setTimeout(fetchHistorical, 500);
        return () => clearTimeout(tId);
    }, [date, sym]);

    const handleMax = () => {
        if (holding.amount) {
            setAmount(holding.amount);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const cleanPrice = parseFloat(price);
        const cleanAmount = parseFloat(amount);

        // Validate
        if (!amount || isNaN(cleanAmount)) return;
        if ((type === 'BUY' || type === 'SELL') && (!price || isNaN(cleanPrice))) return;

        const tx = {
            id: existingTx?.id || Math.random().toString(36).substr(2, 9),
            date: new Date(date).toISOString(),
            type,
            baseAmount: cleanAmount,
            baseCurrency: sym,
            quoteAmount: (type === 'BUY' || type === 'SELL') ? (cleanAmount * cleanPrice) : 0,
            // ALWAYS store quoteCurrency for BUY/SELL - it's essential for FX conversion
            // useFiat only controls whether we deduct from fiat balance, not the currency recording
            quoteCurrency: (type === 'BUY' || type === 'SELL') ? detectedQuote : null,
            exchange: 'MANUAL',
            originalType: holding.originalType || (detectedQuote === 'USD' ? 'CRYPTOCURRENCY' : 'MANUAL'),
            // Track if this transaction should affect fiat balance
            affectsFiatBalance: useFiat,
            // Portfolio ID - use selected if in 'All' view, otherwise use current
            portfolioId: showPortfolioSelector ? selectedPortfolioId : (existingTx?.portfolioId || (currentPortfolioId === 'all' ? 1 : currentPortfolioId))
        };

        onSave(tx);
    };

    const labelStyle = { fontSize: '0.75rem', fontWeight: 'bold', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'block' };

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
                        {portfolios.map(p => (
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
                <label style={labelStyle}>Amount ({sym})</label>
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

            {(type === 'BUY' || type === 'SELL') && (
                <>
                    <div>
                        <label style={labelStyle}>
                            <div className="flex justify-between">
                                <span>Price per unit ({detectedQuote})</span>
                                {fetchingPrice && <span className="animate-pulse" style={{ color: '#3b82f6' }}>Fetching...</span>}
                            </div>
                        </label>
                        <input
                            type="number"
                            step="any"
                            required
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
                                <span className="text-xs text-muted font-medium uppercase tracking-wider">Total:</span>
                                <span className="text-xs font-bold text-white">
                                    {(parseFloat(amount) * parseFloat(price)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {detectedQuote}
                                </span>
                            </div>
                        )}
                    </div>

                    <div
                        className="flex items-center justify-between p-4 rounded-2xl hover-bg-surface transition-all"
                        style={{ border: '1px solid #262626', background: '#171717', cursor: 'pointer' }}
                        onClick={() => setUseFiat(!useFiat)}
                    >
                        <span className="text-sm font-medium text-white select-none">
                            {type === 'BUY' ? `Deduct from ${detectedQuote} balance` : `Add to ${detectedQuote} balance`}
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
                </>
            )}

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

            <div className="flex gap-4 mt-8 pt-4 border-t border-white/5">
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 btn btn-ghost"
                    style={{ fontSize: '1rem', fontWeight: 'bold' }}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="flex-[2] btn"
                    style={{ fontSize: '1.125rem', padding: '16px' }} // text-lg equivalent
                >
                    Save
                </button>
            </div>
        </form>
    );
}
