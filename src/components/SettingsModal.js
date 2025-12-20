'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Edit2, Check, X, Upload, Download, FolderOpen, ChevronDown, Star, Bell } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import {
    getAllPortfolios,
    addPortfolio,
    updatePortfolio,
    deletePortfolio,
    exportToCsv,
    importTransactions,
    clearAllTransactions
} from '@/utils/db';
import { checkPermissions, requestPermissions, scheduleDailyNotifications, cancelAllNotifications, scheduleTestNotification } from '@/utils/notifications';

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

    // Import conflict dialog state
    const [importConflict, setImportConflict] = useState(null);

    // Delete confirmation state
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'portfolio', id, name }

    // Notification State
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [notificationTime, setNotificationTime] = useState('09:00');

    useEffect(() => {
        const init = async () => {
            const enabled = localStorage.getItem('notifications_enabled') === 'true';
            const time = localStorage.getItem('notification_time') || '09:00';

            if (enabled) {
                const granted = await checkPermissions();
                setNotificationsEnabled(granted);
                if (!granted) {
                    localStorage.setItem('notifications_enabled', 'false');
                }
            }
            setNotificationTime(time);
        };
        init();
    }, []);

    const handleNotificationToggle = async (enabled) => {
        console.log('Toggling notifications to:', enabled);
        if (enabled) {
            const granted = await requestPermissions();
            console.log('Permission granted:', granted);
            if (granted) {
                setNotificationsEnabled(true);
                localStorage.setItem('notifications_enabled', 'true');
                await scheduleDailyNotifications(notificationTime, portfolios);
            } else {
                alert('Notification permissions are required. Please check your system/browser settings to allow notifications for this app.');
                setNotificationsEnabled(false);
            }
        } else {
            setNotificationsEnabled(false);
            localStorage.setItem('notifications_enabled', 'false');
            await cancelAllNotifications();
        }
    };

    const handleTimeChange = async (newTime) => {
        setNotificationTime(newTime);
        localStorage.setItem('notification_time', newTime);
        if (notificationsEnabled) {
            await scheduleDailyNotifications(newTime, portfolios);
        }
    };
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

    const handleDeletePortfolio = (id) => {
        if (portfolios.length <= 1) {
            // Show modal for error case
            setDeleteConfirm({ type: 'error', message: 'You must have at least one portfolio' });
            return;
        }
        const portfolio = portfolios.find(p => p.id === id);
        setDeleteConfirm({ type: 'portfolio', id, name: portfolio?.name || 'Portfolio' });
    };

    const confirmDeletePortfolio = async (id) => {
        await deletePortfolio(id);
        await loadPortfolios();

        // Refresh the dashboard's transaction list
        if (currentPortfolioId === id) {
            // If we deleted the portfolio we were viewing, jump to 'all'
            onPortfolioChange('all');
        } else {
            // Otherwise just refresh the current view (like 'all') to reflect deleted transactions
            onPortfolioChange(currentPortfolioId);
        }

        // If we deleted the portfolio selected in the export tab, reset it to 'all'
        if (ioPortfolioId === id) {
            setIoPortfolioId('all');
        }
    };

    const handleSetDefault = async (id) => {
        // Clear default from all portfolios, then set on selected (or toggle off)
        const currentDefault = portfolios.find(p => p.isDefault);
        for (const p of portfolios) {
            if (p.isDefault) {
                await updatePortfolio(p.id, { isDefault: false });
            }
        }
        // Toggle: if clicking the current default, just clear it (All will be default)
        if (currentDefault?.id !== id) {
            await updatePortfolio(id, { isDefault: true });
        }
        loadPortfolios();
    };

    const handleExportCsv = async () => {
        const { exportToCsv } = await import('@/utils/db');
        // If only one portfolio, always use that one
        const effectiveId = portfolios.length === 1 ? portfolios[0].id : ioPortfolioId;
        const exportId = effectiveId === 'all' ? null : effectiveId;
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
        let csvPortfolioNames = new Set();

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
                    case 'Portfolio Name':
                        tx.csvPortfolioName = val || null;
                        if (val) csvPortfolioNames.add(val);
                        break;
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

        // Reset file input so same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = '';

        const uniquePortfolioNames = Array.from(csvPortfolioNames);
        const csvPortfolioName = uniquePortfolioNames.length === 1 ? uniquePortfolioNames[0] : null;

        // If importing from "All Portfolios" view, handle multi-portfolio import
        if (ioPortfolioId === 'all') {
            if (uniquePortfolioNames.length > 1) {
                // Multiple portfolios in CSV - import each and stay on 'All'
                for (const pName of uniquePortfolioNames) {
                    const groupTxs = transactions.filter(tx => tx.csvPortfolioName === pName);
                    let targetP = portfolios.find(p => p.name === pName);
                    let targetId;
                    if (targetP) {
                        targetId = targetP.id;
                    } else {
                        targetId = await addPortfolio(pName);
                    }
                    const txsToImport = groupTxs.map(tx => ({
                        ...tx,
                        portfolioId: targetId
                    }));
                    await importTransactions(txsToImport, targetId);
                }
                await loadPortfolios();
                onPortfolioChange('all');
                onClose();
                return;
            } else if (uniquePortfolioNames.length === 1) {
                // Single portfolio in CSV - import and switch to it
                const pName = uniquePortfolioNames[0];
                let targetP = portfolios.find(p => p.name === pName);
                let targetId;
                if (targetP) {
                    targetId = targetP.id;
                } else {
                    targetId = await addPortfolio(pName);
                }
                const txsToImport = transactions.map(tx => ({
                    ...tx,
                    portfolioId: targetId
                }));
                await importTransactions(txsToImport, targetId);
                await loadPortfolios();
                onPortfolioChange(targetId);
                onClose();
                return;
            } else {
                // No portfolio names in CSV - import to default portfolio
                await doImport(transactions, 1, 1);
                return;
            }
        }

        // Get target portfolio info
        const targetPortfolioId = ioPortfolioId === 'all' ? 1 : ioPortfolioId;
        const targetPortfolio = portfolios.find(p => p.id === targetPortfolioId);
        const targetPortfolioName = targetPortfolio?.name || 'Default';

        // If CSV has multiple portfolios but user selected a specific target, 
        // fallback to multi-portfolio import logic
        if (uniquePortfolioNames.length > 1) {
            for (const pName of uniquePortfolioNames) {
                const groupTxs = transactions.filter(tx => tx.csvPortfolioName === pName);
                let targetP = portfolios.find(p => p.name === pName);
                if (!targetP) {
                    const newId = await addPortfolio(pName);
                    targetP = { id: newId, name: pName };
                }
                const txsToImport = groupTxs.map(tx => ({
                    ...tx,
                    portfolioId: targetP.id
                }));
                await importTransactions(txsToImport, targetP.id);
            }
            await loadPortfolios();
            onPortfolioChange('all');
            onClose();
            return;
        }

        // Check if CSV portfolio name differs from target (single portfolio case)
        if (csvPortfolioName && csvPortfolioName !== targetPortfolioName) {
            // Show conflict dialog
            setImportConflict({
                csvPortfolioName,
                targetPortfolioName,
                transactions,
                targetPortfolioId
            });
            return;
        }

        // No conflict - proceed with import
        await doImport(transactions, targetPortfolioId, targetPortfolioId);
    };

    const doImport = async (transactions, portfolioId, targetViewId) => {
        // Create new transaction objects with the correct portfolioId
        // This ensures we don't mutate the original and correctly assign the ID
        const txsToImport = transactions.map(tx => ({
            ...tx,
            portfolioId: portfolioId  // Force the new portfolio ID
        }));
        await importTransactions(txsToImport, portfolioId);
        // Switch to the target view (affected portfolio)
        onPortfolioChange(targetViewId || portfolioId);
        setImportConflict(null);
        onClose();
    };

    const handleImportMerge = async () => {
        if (!importConflict) return;
        // Merge should switch to the portfolio we merged INTO
        await doImport(importConflict.transactions, importConflict.targetPortfolioId, importConflict.targetPortfolioId);
    };

    const handleImportCreateNew = async () => {
        if (!importConflict) return;
        // Create new portfolio with CSV name - addPortfolio returns the ID directly
        const newPortfolioId = await addPortfolio(importConflict.csvPortfolioName);
        // Import into the NEW portfolio ID (not the CSV's old ID)
        const txsToImport = importConflict.transactions.map(tx => ({
            ...tx,
            portfolioId: newPortfolioId  // Use new portfolio ID
        }));
        await importTransactions(txsToImport, newPortfolioId);
        await loadPortfolios();
        setImportConflict(null);
        // Switch to the newly created portfolio
        onPortfolioChange(newPortfolioId);
        onClose();
    };

    const tabs = [
        { id: 'portfolios', label: 'Portfolios', icon: FolderOpen },
        { id: 'export', label: 'Export/Import', icon: Download },
        { id: 'notifications', label: 'Notifications', icon: Bell }
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
                                                <div className="flex items-center gap-1">
                                                    {/* Default star - only show when multiple portfolios */}
                                                    {portfolios.length > 1 && (
                                                        <button
                                                            onClick={() => handleSetDefault(portfolio.id)}
                                                            className="p-2 rounded-full hover:bg-yellow-500/20 transition-all"
                                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                                                            title={portfolio.isDefault ? 'Remove as default' : 'Set as default view'}
                                                        >
                                                            <Star
                                                                size={16}
                                                                className={portfolio.isDefault ? 'text-yellow-400' : 'text-white/40'}
                                                                fill={portfolio.isDefault ? '#facc15' : 'none'}
                                                            />
                                                        </button>
                                                    )}
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
                                    value={ioPortfolioId}
                                    onChange={(e) => setIoPortfolioId(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                                    style={{
                                        width: '100%',
                                        background: `rgba(255, 255, 255, 0.05) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 14px center`,
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '12px',
                                        padding: '12px 44px 12px 14px',
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
                                    <option value="all" style={{ background: '#121212', color: 'white' }}>All Portfolios (Consolidated)</option>
                                    {portfolios.map(p => (
                                        <option key={p.id} value={p.id} style={{ background: '#121212', color: 'white' }}>{p.name}</option>
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

                    {activeTab === 'notifications' && (
                        <div className="flex flex-col gap-4">
                            <p className="text-muted text-sm leading-relaxed">
                                Receive daily updates about your portfolio performance.
                            </p>

                            <div
                                className="p-4 rounded-xl flex items-center justify-between cursor-pointer group hover:bg-white/[0.05] transition-all"
                                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                                onClick={() => handleNotificationToggle(!notificationsEnabled)}
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="text-white font-medium group-hover:text-green-400 transition-colors">Daily Notifications</span>
                                    <span className="text-xs text-muted">Get a daily summary for each portfolio</span>
                                </div>
                                <div
                                    className="relative w-12 h-6 rounded-full transition-all duration-200 shadow-inner"
                                    style={{
                                        backgroundColor: notificationsEnabled ? '#22c55e' : 'rgba(255,255,255,0.06)',
                                        border: `1px solid ${notificationsEnabled ? '#22c55e' : 'rgba(255,255,255,0.1)'}`
                                    }}
                                >
                                    <div
                                        className="absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all duration-200 shadow-md"
                                        style={{
                                            left: notificationsEnabled ? 'calc(100% - 19px)' : '3px'
                                        }}
                                    />
                                </div>
                            </div>

                            {notificationsEnabled && (
                                <>
                                    <div className="p-4 rounded-xl flex items-center justify-between"
                                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                        <span className="text-white font-medium">Notification Time</span>
                                        <input
                                            type="time"
                                            value={notificationTime}
                                            onChange={(e) => handleTimeChange(e.target.value)}
                                            className="bg-transparent text-white border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-white/30"
                                            style={{ colorScheme: 'dark' }}
                                        />
                                    </div>

                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            const success = await scheduleTestNotification();
                                            if (success) alert('Test notification sent! It should appear in a few seconds.');
                                            else alert('Failed to send test notification.');
                                        }}
                                        className="p-3 rounded-xl border border-white/10 bg-white/5 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all text-center"
                                    >
                                        Send Test Notification Now
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Import Conflict Dialog */}
            {importConflict && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    padding: '20px'
                }}>
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(30, 30, 35, 0.98) 0%, rgba(20, 20, 25, 0.98) 100%)',
                        borderRadius: '20px',
                        padding: '32px',
                        maxWidth: '420px',
                        width: '100%',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }}>
                        {/* Header with icon */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: 'rgba(251, 191, 36, 0.12)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                            </div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600', color: '#fff' }}>
                                Portfolio Mismatch
                            </h3>
                        </div>

                        {/* Content */}
                        <div style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '12px',
                            padding: '16px',
                            marginBottom: '20px'
                        }}>
                            <div style={{ marginBottom: '16px' }}>
                                <span style={{ fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    CSV Portfolio
                                </span>
                                <p style={{ margin: '4px 0 0 0', fontSize: '1rem', fontWeight: '600', color: '#fbbf24' }}>
                                    {importConflict.csvPortfolioName}
                                </p>
                            </div>

                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                margin: '12px 0',
                                color: '#52525b'
                            }}>
                                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                                <span style={{ fontSize: '0.7rem' }}>importing into</span>
                                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                            </div>

                            <div>
                                <span style={{ fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Target Portfolio
                                </span>
                                <p style={{ margin: '4px 0 0 0', fontSize: '1rem', fontWeight: '600', color: '#fff' }}>
                                    {importConflict.targetPortfolioName}
                                </p>
                            </div>
                        </div>

                        <p style={{
                            margin: '0 0 24px 0',
                            color: '#a1a1aa',
                            fontSize: '0.875rem'
                        }}>
                            <span style={{ fontWeight: '600', color: '#fff' }}>{importConflict.transactions.length}</span> transaction{importConflict.transactions.length !== 1 ? 's' : ''} to import
                        </p>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                                onClick={handleImportMerge}
                                className="btn hover-bg-surface"
                                style={{
                                    flex: 1,
                                    padding: '14px 20px',
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    color: '#fff',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontWeight: '600',
                                    fontSize: '0.9rem'
                                }}
                            >
                                Merge Here
                            </button>
                            <button
                                onClick={handleImportCreateNew}
                                className="btn hover-bg-surface"
                                style={{
                                    flex: 1,
                                    padding: '14px 20px',
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    color: '#fff',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontWeight: '600',
                                    fontSize: '0.9rem'
                                }}
                            >
                                Create New
                            </button>
                        </div>
                        <button
                            onClick={() => setImportConflict(null)}
                            className="btn-ghost"
                            style={{
                                width: '100%',
                                marginTop: '12px',
                                padding: '12px',
                                backgroundColor: 'transparent',
                                color: '#71717a',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '0.85rem'
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={deleteConfirm !== null}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={() => {
                    if (deleteConfirm?.type === 'portfolio') {
                        confirmDeletePortfolio(deleteConfirm.id);
                    }
                }}
                title={deleteConfirm?.type === 'error' ? 'Notice' : 'Delete Portfolio'}
                message={deleteConfirm?.type === 'error'
                    ? deleteConfirm.message
                    : `Are you sure you want to delete "${deleteConfirm?.name}"? This will permanently remove the portfolio and all its transactions.`}
                confirmText={deleteConfirm?.type === 'error' ? 'OK' : 'Delete'}
                cancelText={deleteConfirm?.type === 'error' ? '' : 'Cancel'}
                confirmStyle={deleteConfirm?.type === 'error' ? 'primary' : 'danger'}
            />
        </div>
    );
}
