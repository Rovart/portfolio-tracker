'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Edit2, Check, X, Upload, Download, FolderOpen } from 'lucide-react';
import {
    getAllPortfolios,
    addPortfolio,
    updatePortfolio,
    deletePortfolio,
    exportToCsv,
    importTransactions,
    clearAllTransactions
} from '@/utils/db';

export default function SettingsModal({ onClose, onPortfolioChange, currentPortfolioId }) {
    const [activeTab, setActiveTab] = useState('portfolios');
    const [portfolios, setPortfolios] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState('');
    const [newPortfolioName, setNewPortfolioName] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [loading, setLoading] = useState(true);
    const [ioPortfolioId, setIoPortfolioId] = useState(currentPortfolioId);
    const fileInputRef = useRef(null);

    useEffect(() => {
        loadPortfolios();
    }, []);

    // Handle Android back button
    useEffect(() => {
        let backButtonListener = null;

        const setupBackButton = async () => {
            try {
                const { App } = await import('@capacitor/app');
                backButtonListener = await App.addListener('backButton', () => {
                    onClose();
                });
            } catch (e) {
                console.log('Capacitor App plugin not available');
            }
        };

        setupBackButton();

        return () => {
            if (backButtonListener) {
                backButtonListener.remove();
            }
        };
    }, [onClose]);

    const loadPortfolios = async () => {
        setLoading(true);
        const p = await getAllPortfolios();
        setPortfolios(p);
        setLoading(false);
    };

    const handleAddPortfolio = async () => {
        if (!newPortfolioName.trim()) return;
        await addPortfolio(newPortfolioName.trim());
        setNewPortfolioName('');
        setShowAddForm(false);
        loadPortfolios();
    };

    const handleUpdatePortfolio = async (id) => {
        if (!editingName.trim()) return;
        await updatePortfolio(id, { name: editingName.trim() });
        setEditingId(null);
        setEditingName('');
        loadPortfolios();
    };

    const handleDeletePortfolio = async (id) => {
        if (portfolios.length <= 1) {
            alert('You must have at least one portfolio');
            return;
        }
        if (!confirm('Delete this portfolio and all its transactions?')) return;
        await deletePortfolio(id);
        loadPortfolios();
        // If we deleted the current portfolio, switch to first available
        if (currentPortfolioId === id) {
            const remaining = portfolios.filter(p => p.id !== id);
            if (remaining.length > 0) {
                onPortfolioChange(remaining[0].id);
            }
        }
    };

    const handleExportCsv = async () => {
        const { exportToCsv } = await import('@/utils/db');
        const exportId = ioPortfolioId === 'all' ? null : ioPortfolioId;
        const csv = await exportToCsv(exportId);
        const pName = ioPortfolioId === 'all' ? 'all' : (portfolios.find(p => p.id === ioPortfolioId)?.name || 'export');
        const filename = `portfolio-${pName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;

        try {
            const { Capacitor } = await import('@capacitor/core');
            if (Capacitor.isNativePlatform()) {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                const { Share } = await import('@capacitor/share');

                const result = await Filesystem.writeFile({
                    path: filename,
                    data: csv,
                    directory: Directory.Cache,
                    encoding: 'utf8'
                });

                await Share.share({
                    title: 'Export Portfolio',
                    text: 'Portfolio transactions export',
                    url: result.uri,
                    dialogTitle: 'Save or Share CSV'
                });
                return;
            }
        } catch (e) {
            console.log('Native export failed:', e);
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportCsv = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const text = await file.text();
        const lines = text.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            alert('CSV file is empty or invalid');
            return;
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const transactions = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const tx = {};

            headers.forEach((header, idx) => {
                const val = values[idx] || '';
                switch (header) {
                    case 'Date': tx.date = val; break;
                    case 'Way': tx.type = val; break;
                    case 'Base amount': tx.baseAmount = parseFloat(val) || 0; break;
                    case 'Base currency (name)': tx.baseCurrency = val; break;
                    case 'Base type': tx.originalType = val; break;
                    case 'Quote amount': tx.quoteAmount = val ? parseFloat(val) : null; break;
                    case 'Quote currency': tx.quoteCurrency = val || null; break;
                    case 'Exchange': tx.exchange = val || null; break;
                    case 'Fee amount': tx.fee = parseFloat(val) || 0; break;
                    case 'Fee currency (name)': tx.feeCurrency = val || null; break;
                    case 'Notes': tx.notes = val || null; break;
                    case 'Portfolio ID': tx.portfolioId = parseInt(val) || null; break;
                }
            });

            if (tx.date && tx.baseCurrency) {
                transactions.push(tx);
            }
        }

        if (transactions.length === 0) {
            alert('No valid transactions found in CSV');
            return;
        }

        // If currently viewing a specific portfolio, force all imported tx to that portfolio
        // If viewing 'all', respect the Portfolio ID in the CSV if present
        const targetPortfolioId = ioPortfolioId === 'all' ? 1 : ioPortfolioId;

        if (ioPortfolioId !== 'all') {
            transactions.forEach(tx => tx.portfolioId = ioPortfolioId);
        }

        await importTransactions(transactions, targetPortfolioId);
        alert(`Imported ${transactions.length} transactions`);
        onClose();
    };

    const tabs = [
        { id: 'portfolios', label: 'Portfolios', icon: FolderOpen },
        { id: 'export', label: 'Export/Import', icon: Download }
    ];

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
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-6" style={{ borderBottom: '1px solid #262626' }}>
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="p-2 -ml-2 rounded-full hover-bg-surface transition-all text-muted hover:text-white"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ margin: 0 }}>
                        Settings
                    </h2>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-2 p-4 overflow-x-auto" style={{ borderBottom: '1px solid #262626' }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`pill flex items-center gap-2 ${activeTab === tab.id ? 'active' : ''}`}
                    >
                        <tab.icon size={14} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                    {activeTab === 'portfolios' && (
                        <div className="flex flex-col gap-4">
                            <p className="text-muted text-sm">
                                Manage your portfolios. Each portfolio tracks assets independently.
                            </p>

                            {/* Portfolio List */}
                            <div className="flex flex-col gap-3">
                                {portfolios.map(portfolio => (
                                    <div
                                        key={portfolio.id}
                                        className="flex items-center justify-between p-4 rounded-xl"
                                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                                    >
                                        {editingId === portfolio.id ? (
                                            <div className="flex items-center gap-2 flex-1">
                                                <input
                                                    type="text"
                                                    value={editingName}
                                                    onChange={e => setEditingName(e.target.value)}
                                                    className="flex-1 text-white text-sm font-medium"
                                                    style={{
                                                        background: 'rgba(255, 255, 255, 0.08)',
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                        borderRadius: '12px',
                                                        padding: '10px 14px',
                                                        outline: 'none',
                                                        transition: 'all 0.2s ease'
                                                    }}
                                                    onFocus={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)'}
                                                    onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
                                                    autoFocus
                                                />
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleUpdatePortfolio(portfolio.id)}
                                                        className="transition-all"
                                                        style={{
                                                            background: 'rgba(34, 197, 94, 0.15)',
                                                            border: '1px solid rgba(34, 197, 94, 0.25)',
                                                            color: '#4ade80',
                                                            borderRadius: '10px',
                                                            padding: '8px 12px',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        <Check size={18} strokeWidth={2.5} />
                                                    </button>
                                                    <button
                                                        onClick={() => { setEditingId(null); setEditingName(''); }}
                                                        className="transition-all"
                                                        style={{
                                                            background: 'rgba(255, 255, 255, 0.06)',
                                                            border: '1px solid rgba(255, 255, 255, 0.12)',
                                                            color: 'rgba(255, 255, 255, 0.6)',
                                                            borderRadius: '10px',
                                                            padding: '8px 12px',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        <X size={18} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <span className="font-medium">{portfolio.name}</span>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => { setEditingId(portfolio.id); setEditingName(portfolio.name); }}
                                                        className="p-2 rounded-full hover:bg-white/10 text-white/60"
                                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    {portfolios.length > 1 && (
                                                        <button
                                                            onClick={() => handleDeletePortfolio(portfolio.id)}
                                                            className="p-2 rounded-full hover:bg-red-500/20 text-red-400"
                                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Add New Portfolio */}
                            {showAddForm ? (
                                <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                    <input
                                        type="text"
                                        value={newPortfolioName}
                                        onChange={e => setNewPortfolioName(e.target.value)}
                                        placeholder="Portfolio name..."
                                        className="flex-1 text-white text-sm font-medium"
                                        style={{
                                            background: 'rgba(255, 255, 255, 0.08)',
                                            border: '1px solid rgba(255, 255, 255, 0.15)',
                                            borderRadius: '12px',
                                            padding: '10px 14px',
                                            outline: 'none',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)'}
                                        onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
                                        autoFocus
                                    />
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleAddPortfolio}
                                            className="transition-all"
                                            style={{
                                                background: 'rgba(34, 197, 94, 0.15)',
                                                border: '1px solid rgba(34, 197, 94, 0.25)',
                                                color: '#4ade80',
                                                borderRadius: '10px',
                                                padding: '8px 12px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            <Check size={18} strokeWidth={2.5} />
                                        </button>
                                        <button
                                            onClick={() => { setShowAddForm(false); setNewPortfolioName(''); }}
                                            className="transition-all"
                                            style={{
                                                background: 'rgba(255, 255, 255, 0.06)',
                                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                                color: 'rgba(255, 255, 255, 0.6)',
                                                borderRadius: '10px',
                                                padding: '8px 12px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            <X size={18} strokeWidth={2.5} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowAddForm(true)}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl text-muted hover:text-white transition-all"
                                    style={{ cursor: 'pointer', background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)' }}
                                >
                                    <Plus size={20} />
                                    <span>Add Portfolio</span>
                                </button>
                            )}
                        </div>
                    )}

                    {activeTab === 'export' && (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-muted text-xs font-semibold uppercase tracking-wider">Target Portfolio</label>
                                <select
                                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all text-sm font-medium appearance-none cursor-pointer"
                                    value={ioPortfolioId}
                                    onChange={(e) => setIoPortfolioId(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                                    style={{
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5' /%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 16px center',
                                        backgroundSize: '16px'
                                    }}
                                >
                                    <option value="all">All Portfolios (Consolidated)</option>
                                    {portfolios.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            <p className="text-muted text-sm pb-2">
                                Select which portfolio to export or where you want to import your data.
                            </p>

                            <button
                                onClick={handleExportCsv}
                                className="flex items-center gap-3 p-4 rounded-xl hover:bg-white/5 transition-all"
                                style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                            >
                                <div className="p-3 rounded-full bg-blue-500/20">
                                    <Download size={20} className="text-blue-400" />
                                </div>
                                <div>
                                    <div className="font-medium">Export CSV</div>
                                    <div className="text-sm text-muted">Download all transactions as CSV</div>
                                </div>
                            </button>

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-3 p-4 rounded-xl hover:bg-white/5 transition-all"
                                style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                            >
                                <div className="p-3 rounded-full bg-green-500/20">
                                    <Upload size={20} className="text-green-400" />
                                </div>
                                <div>
                                    <div className="font-medium">Import CSV</div>
                                    <div className="text-sm text-muted">Import transactions from CSV file</div>
                                </div>
                            </button>

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                onChange={handleImportCsv}
                                style={{ display: 'none' }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
