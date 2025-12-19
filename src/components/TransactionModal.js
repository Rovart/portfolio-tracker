'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import AssetSearch from './AssetSearch';
import AssetChart from './AssetChart';
import { Trash2, Edit2, X, Plus, ChevronLeft, ArrowLeft } from 'lucide-react';

const DISPLAY_NAME = true; // true = Name, false = Symbol

export default function TransactionModal({ mode, holding, transactions, onClose, onSave, onDelete, hideBalances, baseCurrency }) {
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

    // Consolidated price data - updated atomically to guarantee single render
    // Always start loading to prevent showing cached USD price before FX conversion
    const [priceData, setPriceData] = useState({
        price: null, // Don't use cached price - wait for fresh fetch with FX
        changePercent: null,
        fxRate: 1,
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
                        fetchedCurrency = assetQuote.currency || quoteCurr;
                    }

                    const fxQuote = json.data.find(q => q.symbol === `${quoteCurr}${baseCurrency}=X`);
                    if (fxQuote) {
                        fetchedFxRate = fxQuote.price;
                    } else if (quoteCurr === baseCurrency) {
                        fetchedFxRate = 1;
                    }
                }

                // Fetch historical FX if needed
                let fetchedHMap = {};
                if (quoteCurr && quoteCurr !== baseCurrency) {
                    const hRes = await fetch(`/api/history?symbol=${quoteCurr}${baseCurrency}=X&range=ALL`);
                    const hJson = await hRes.json();
                    if (hJson.history) {
                        hJson.history.forEach(d => {
                            fetchedHMap[d.date.split('T')[0]] = d.price;
                        });
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
    const { price: assetPrice, changePercent, fxRate, historicalFx, isLoading: loadingPrice } = priceData;

    const assetTransactions = selectedAsset
        ? transactions.filter(t => t.baseCurrency === selectedAsset.symbol || t.quoteCurrency === selectedAsset.symbol).sort((a, b) => new Date(b.date) - new Date(a.date))
        : [];

    const { currentBalance, averagePurchasePrice } = useMemo(() => {
        if (!selectedAsset) return { currentBalance: 0, averagePurchasePrice: 0 };
        let totalAmount = 0;
        let totalCostBase = 0; // Total cost in baseCurrency
        let buyAmount = 0;

        // Priority: currency from selectedAsset, then symbol split
        let quoteCurr = selectedAsset.currency;
        if (!quoteCurr) {
            const parts = selectedAsset.symbol.split(/[-/]/);
            quoteCurr = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'USD';
        }

        transactions
            .filter(t => t.baseCurrency === selectedAsset.symbol)
            .forEach(t => {
                const bAmt = parseFloat(t.baseAmount) || 0;
                const qAmt = parseFloat(t.quoteAmount) || 0;
                const dateStr = t.date.split('T')[0];

                // Get historical FX rate or fallback to current
                const hFx = quoteCurr === baseCurrency ? 1 : (historicalFx[dateStr] || fxRate || 1);

                if (['BUY', 'DEPOSIT'].includes(t.type)) {
                    totalAmount += bAmt;
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
    }, [transactions, selectedAsset?.symbol, selectedAsset?.currency, historicalFx, fxRate, baseCurrency]);

    const handleAssetSelect = (asset) => {
        // Calculate current balance for the selected asset from transaction history
        const balance = transactions
            ? transactions
                .filter(t => t.baseCurrency === asset.symbol)
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
            currency: asset.currency // Use currency from search result
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
                width: '100vw'
            }}
        >
            {/* Header Area */}
            <div className="flex items-center justify-between p-6 sm:px-8" style={{ borderBottom: '1px solid #262626' }}>
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
                                                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ['BUY', 'DEPOSIT'].includes(tx.type) ? '#22c55e' : '#ef4444' }} />
                                                    <div className="flex flex-col">
                                                        <span className="font-bold" style={{ fontSize: '1rem' }}>{tx.type}</span>
                                                        <span className="text-sm text-muted">{new Date(tx.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                                    </div>
                                                </div>

                                                <div className="flex-1 flex flex-col items-end">
                                                    {tx.type === 'BUY' && (
                                                        <>
                                                            {loadingPrice || !assetPrice ? (
                                                                <div className="h-5 w-20 bg-white-10 rounded animate-pulse ml-auto" style={{ marginRight: '10px' }} />
                                                            ) : (
                                                                (() => {
                                                                    const dateStr = tx.date.split('T')[0];
                                                                    const hFx = (tx.quoteCurrency || 'USD') === baseCurrency ? 1 : (historicalFx[dateStr] || fxRate || 1);
                                                                    const costBase = tx.quoteAmount * hFx;
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
                                                            {hideBalances ? '••••' : tx.baseAmount.toLocaleString()} {tx.baseCurrency}
                                                        </span>
                                                        {(tx.quoteAmount > 0) && (
                                                            <div className="flex items-center gap-1">
                                                                {loadingPrice ? (
                                                                    <div className="h-3 w-12 bg-white-10 rounded animate-pulse ml-auto" />
                                                                ) : (
                                                                    <span className="text-xs text-muted">
                                                                        {(() => {
                                                                            const dateStr = tx.date.split('T')[0];
                                                                            const hFx = (tx.quoteCurrency || 'USD') === baseCurrency ? 1 : (historicalFx[dateStr] || fxRate || 1);
                                                                            return `${((tx.quoteAmount / tx.baseAmount) * hFx).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`;
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
                                                                                const hFx = (tx.quoteCurrency || 'USD') === baseCurrency ? 1 : (historicalFx[dateStr] || fxRate || 1);
                                                                                return `${(tx.quoteAmount * hFx).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`;
                                                                            })()}
                                                                        </span>
                                                                    )
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-col">
                                                        <button onClick={() => handleEdit(tx)} className="p-1 text-muted hover:text-white hover-bg-surface rounded-full transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button onClick={() => handleDelete(onDelete, tx.id)} className="p-1 text-danger hover-bg-surface rounded-full transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                                            <Trash2 size={16} />
                                                        </button>
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
                                onSave={(tx) => { onSave(tx); setCurrentView('LIST'); setEditingTx(null); }}
                                onCancel={toList}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
}

function handleDelete(fn, id) {
    if (confirm('Delete this transaction? This cannot be undone.')) fn(id);
}

function TransactionForm({ holding, existingTx, transactions, onSave, onCancel, fetchedCurrency }) {
    // Standardize symbol access
    const sym = holding.symbol || holding.asset;

    // Detect quote currency from symbol (e.g., BTC-EUR -> EUR)
    const detectedQuote = useMemo(() => {
        if (fetchedCurrency) return fetchedCurrency.toUpperCase();
        if (holding.currency) return holding.currency.toUpperCase();
        if (!sym) return 'USD';
        const parts = sym.split(/[-/]/);
        if (parts.length > 1) {
            const quote = parts[parts.length - 1].toUpperCase();
            return quote;
        }
        return 'USD';
    }, [sym, holding.currency, fetchedCurrency]);

    const [type, setType] = useState(existingTx?.type || 'BUY');
    const [amount, setAmount] = useState(existingTx?.baseAmount || '');
    const [price, setPrice] = useState(existingTx ? (existingTx.quoteAmount / (existingTx.baseAmount || 1)) : '');
    const [date, setDate] = useState(existingTx?.date ? new Date(existingTx.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    // Calculate quote balance to determine default toggle state
    const quoteBalance = useMemo(() => {
        if (!transactions) return 0;
        return transactions
            .filter(t => t.baseCurrency === detectedQuote)
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
    }, [sym, existingTx]);

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
            quoteCurrency: useFiat ? detectedQuote : null,
            exchange: 'MANUAL',
            originalType: holding.originalType || (detectedQuote === 'USD' ? 'CRYPTOCURRENCY' : 'MANUAL') // Heuristic or passed state
        };

        if (!useFiat && (type === 'BUY' || type === 'SELL')) {
            tx.quoteCurrency = null;
        }

        onSave(tx);
    };

    const labelStyle = { fontSize: '0.75rem', fontWeight: 'bold', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'block' };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Type Selector */}
            <div className="flex gap-2 p-1 rounded-full" style={{ background: '#171717' }}>
                {['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'].map(t => {
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
