'use client';

import { useState, useEffect } from 'react';
import AssetSearch from './AssetSearch';
import AssetChart from './AssetChart';
import { Trash2, Edit2, X, Plus, ChevronLeft, ArrowLeft } from 'lucide-react';

export default function TransactionModal({ mode, holding, transactions, onClose, onSave, onDelete }) {
    const [currentView, setCurrentView] = useState(mode === 'ADD' ? 'SEARCH' : 'LIST');
    const [selectedAsset, setSelectedAsset] = useState(holding ? { symbol: holding.asset, price: holding.price } : null);
    const [editingTx, setEditingTx] = useState(null);

    useEffect(() => {
        if (selectedAsset && !selectedAsset.price) {
            fetch(`/api/quote?symbols=${selectedAsset.symbol}`)
                .then(res => res.json())
                .then(json => {
                    if (json.data && json.data[0]) {
                        setSelectedAsset(prev => prev ? { ...prev, price: json.data[0].price } : prev);
                    }
                })
                .catch(console.error);
        }
    }, [selectedAsset?.symbol]);

    const assetTransactions = selectedAsset
        ? transactions.filter(t => t.baseCurrency === selectedAsset.symbol || t.quoteCurrency === selectedAsset.symbol).sort((a, b) => new Date(b.date) - new Date(a.date))
        : [];

    const handleAssetSelect = (asset) => {
        setSelectedAsset(asset);
        setCurrentView('FORM');
        setEditingTx(null);
    };

    const handleEdit = (tx) => {
        setEditingTx(tx);
        setCurrentView('FORM');
    };

    const toList = () => {
        if (mode === 'ADD' && !holding) {
            setCurrentView('SEARCH');
        } else {
            setCurrentView('LIST');
        }
    };

    // Layout fixed
    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, height: '100dvh',
            backgroundColor: '#000',
            color: 'white',
            zIndex: 100,
            display: 'flex', flexDirection: 'column',
            animation: 'fadeIn 0.2s ease-out'
        }}>
            {/* Header Area */}
            <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid #262626' }}>
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="p-2 -ml-2 rounded-full hover-bg-surface transition-all text-muted hover:text-white"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h2 className="text-2xl font-bold tracking-tight" style={{ margin: 0 }}>
                        {currentView === 'SEARCH' ? 'Add Asset' : (selectedAsset?.symbol || 'Details')}
                    </h2>
                </div>
                {currentView === 'LIST' && selectedAsset && (
                    <button
                        onClick={() => { setEditingTx(null); setCurrentView('FORM'); }}
                        className="p-3 bg-white text-black rounded-full hover-scale active-scale shadow-lg flex items-center gap-2 font-bold px-5"
                        style={{ border: 'none', cursor: 'pointer' }}
                    >
                        <Plus size={20} />
                        <span className="hidden sm:inline">Add Transaction</span>
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-6" style={{ paddingBottom: '80px' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>

                    {currentView === 'SEARCH' && (
                        <AssetSearch onSelect={handleAssetSelect} onCancel={onClose} />
                    )}

                    {currentView === 'LIST' && selectedAsset && (
                        <div className="flex flex-col gap-4">
                            {/* Chart Section */}
                            <div className="w-full">
                                <AssetChart symbol={selectedAsset.symbol} />
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
                                                    {tx.type === 'BUY' && selectedAsset?.price && (
                                                        <>
                                                            <span style={{ textAlign: 'right', marginRight: '10px' }} className={`text-sm font-bold ${selectedAsset.price >= (tx.quoteAmount / tx.baseAmount) ? 'text-success' : 'text-danger'}`}>
                                                                {selectedAsset.price >= (tx.quoteAmount / tx.baseAmount) ? '+' : '-'}${Math.abs((selectedAsset.price - (tx.quoteAmount / tx.baseAmount)) * tx.baseAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <div className="flex flex-col items-end">
                                                        <span className="font-mono font-medium" style={{ fontSize: '1rem' }}>
                                                            {tx.baseAmount.toLocaleString()} {tx.baseCurrency}
                                                        </span>
                                                        {(tx.quoteAmount > 0) && (
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-xs text-muted">
                                                                    ${(tx.quoteAmount / tx.baseAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                                </span>
                                                                {tx.type === 'BUY' && selectedAsset?.price && (
                                                                    <span style={{ marginLeft: '5px' }} className={`text-[10px] font-bold ${selectedAsset.price >= (tx.quoteAmount / tx.baseAmount) ? 'text-success' : 'text-danger'}`}>
                                                                        ({selectedAsset.price >= (tx.quoteAmount / tx.baseAmount) ? '+' : ''}{(((selectedAsset.price - (tx.quoteAmount / tx.baseAmount)) / (tx.quoteAmount / tx.baseAmount)) * 100).toFixed(2)}%)
                                                                    </span>
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
                                holding={{ asset: selectedAsset.symbol }}
                                existingTx={editingTx}
                                onSave={(tx) => { onSave(tx); mode === 'ADD' ? onClose() : setCurrentView('LIST'); }}
                                onCancel={toList}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function handleDelete(fn, id) {
    if (confirm('Delete this transaction? This cannot be undone.')) fn(id);
}

function TransactionForm({ holding, existingTx, onSave, onCancel }) {
    const [type, setType] = useState(existingTx?.type || 'BUY');
    const [amount, setAmount] = useState(existingTx?.baseAmount || '');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(existingTx?.date ? new Date(existingTx.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    const [useFiat, setUseFiat] = useState(existingTx ? !!existingTx.quoteCurrency : true);
    const [fetchingPrice, setFetchingPrice] = useState(false);

    useEffect(() => {
        if (!existingTx && holding.asset) {
            async function fetchPrice() {
                setFetchingPrice(true);
                try {
                    const res = await fetch(`/api/quote?symbols=${holding.asset}`);
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
    }, [holding.asset, existingTx]);

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
            baseCurrency: holding.asset,
            quoteAmount: (type === 'BUY' || type === 'SELL') ? (cleanAmount * cleanPrice) : 0,
            quoteCurrency: useFiat ? 'USD' : null,
            exchange: 'MANUAL',
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
                            className={`flex-1 py-3 text-xs font-bold rounded-full transition-all`}
                            style={{
                                background: isActive ? 'white' : 'transparent',
                                color: isActive ? 'black' : '#a1a1aa',
                                border: 'none',
                                cursor: 'pointer',
                                boxShadow: isActive ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none'
                            }}
                            onClick={() => setType(t)}
                        >
                            {t}
                        </button>
                    )
                })}
            </div>

            <div>
                <label style={labelStyle}>Amount ({holding.asset})</label>
                <input
                    type="number"
                    step="any"
                    required
                    autoFocus
                    className="input-reset"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                    style={{ fontSize: '2rem', paddingLeft: '1rem' }}
                />
            </div>

            {(type === 'BUY' || type === 'SELL') && (
                <>
                    <div>
                        <label style={labelStyle}>
                            <div className="flex justify-between">
                                <span>Price per unit (USD)</span>
                                {fetchingPrice && <span className="animate-pulse" style={{ color: '#3b82f6' }}>Fetching...</span>}
                            </div>
                        </label>
                        <input
                            type="number"
                            step="any"
                            required
                            className="input-reset"
                            value={price}
                            onChange={e => setPrice(e.target.value)}
                            placeholder="0.00"
                        />
                    </div>

                    <div
                        className="flex items-center justify-between p-4 rounded-2xl hover-bg-surface transition-all"
                        style={{ border: '1px solid #262626', background: '#171717', cursor: 'pointer' }}
                        onClick={() => setUseFiat(!useFiat)}
                    >
                        <span className="text-sm font-medium text-white select-none">
                            {type === 'BUY' ? 'Deduct from USD balance' : 'Add to USD balance'}
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
