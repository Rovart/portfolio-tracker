'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Wallet, Plus, Trash2, RefreshCw } from 'lucide-react';
import { getWalletsForChain, addWallet, removeWallet } from '@/utils/db';
import BottomSheet from './BottomSheet';

// Client-side mirrors of the server validation in /api/wallet
const ADDRESS_PATTERNS = {
    BTC: /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,40})$/,
    ETH: /^0x[a-fA-F0-9]{40}$/
};

function shortenAddress(address) {
    if (!address || address.length <= 14) return address;
    return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

// Watch-only wallet tracking for on-chain assets (BTC / ETH).
// Balances are read from public endpoints via /api/wallet — no keys, read-only.
export default function WalletTracker({ chain, price, changePercent, baseCurrency, hideBalances, portfolioId = 1, onWalletsChange, onBalanceChange }) {
    const [wallets, setWallets] = useState([]);
    const [balances, setBalances] = useState({}); // walletId -> { balance } | { error }
    const [adding, setAdding] = useState(false);
    const [address, setAddress] = useState('');
    const [label, setLabel] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const currencyLabel = baseCurrency === 'USD' ? '$' : baseCurrency;
    const unit = chain;

    const trimmedAddress = address.trim();
    const isValidAddress = useMemo(() => (
        ADDRESS_PATTERNS[chain] ? ADDRESS_PATTERNS[chain].test(trimmedAddress) : false
    ), [chain, trimmedAddress]);

    const totalBalance = useMemo(() => (
        wallets.reduce((sum, wallet) => {
            const balance = balances[wallet.id]?.balance;
            return Number.isFinite(balance) ? sum + balance : sum;
        }, 0)
    ), [wallets, balances]);

    useEffect(() => {
        onBalanceChange?.(totalBalance);
    }, [onBalanceChange, totalBalance]);

    const loadBalance = useCallback(async (wallet) => {
        try {
            const res = await fetch(`/api/wallet?chain=${chain}&address=${encodeURIComponent(wallet.address)}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Lookup failed');
            return { balance: json.balance };
        } catch (e) {
            return { error: e.message };
        }
    }, [chain]);

    const refreshAll = useCallback(async (list) => {
        setRefreshing(true);
        const entries = await Promise.all(list.map(async w => [w.id, await loadBalance(w)]));
        setBalances(Object.fromEntries(entries));
        setRefreshing(false);
    }, [loadBalance]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const list = await getWalletsForChain(chain, portfolioId);
            if (cancelled) return;
            setWallets(list);
            if (list.length > 0) refreshAll(list);
        })();
        return () => { cancelled = true; };
    }, [chain, portfolioId, refreshAll]);

    const closeAddSheet = useCallback(() => {
        setAdding(false);
        setAddress('');
        setLabel('');
        setError('');
    }, []);

    const handleAdd = async (e) => {
        e?.preventDefault?.();
        if (!isValidAddress || busy) return;
        setBusy(true);
        setError('');
        try {
            // Validate the address by fetching its balance before saving
            const res = await fetch(`/api/wallet?chain=${chain}&address=${encodeURIComponent(trimmedAddress)}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Could not verify address');

            const id = await addWallet(chain, trimmedAddress, label, portfolioId);
            const wallet = { id, portfolioId, chain, address: trimmedAddress, label: label.trim(), addedAt: new Date().toISOString() };
            setWallets(prev => [...prev, wallet]);
            setBalances(prev => ({ ...prev, [id]: { balance: json.balance } }));
            closeAddSheet();
            await onWalletsChange?.();
        } catch (err) {
            setError(err.message || 'Failed to add wallet');
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async (id) => {
        await removeWallet(id);
        setWallets(prev => prev.filter(w => w.id !== id));
        setBalances(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        await onWalletsChange?.();
    };

    const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };
    const fieldLabelStyle = { ...labelStyle, marginBottom: '8px', display: 'block' };

    return (
        <div className="mt-8">
            <div className="flex items-center justify-between" style={{ marginBottom: '10px' }}>
                <span style={labelStyle} className="flex items-center gap-2">
                    <Wallet size={13} />
                    Watched wallets
                </span>
                <div className="flex items-center gap-2">
                    {wallets.length > 0 && (
                        <button
                            type="button"
                            onClick={() => refreshAll(wallets)}
                            title="Refresh balances"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex' }}
                        >
                            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="flex items-center gap-1 transition-all"
                        style={{
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--card-border)',
                            borderRadius: '8px',
                            padding: '5px 10px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            color: 'var(--foreground)',
                            cursor: 'pointer'
                        }}
                    >
                        <Plus size={13} />
                        Add address
                    </button>
                </div>
            </div>

            {wallets.length === 0 && (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)' }}>
                    Track a {chain} address read-only — balance and value update automatically.
                </p>
            )}

            <div className="flex flex-col gap-2">
                {wallets.map(w => {
                    const state = balances[w.id];
                    const balance = state?.balance;
                    const value = Number.isFinite(balance) ? balance * (price || 0) : null;
                    const positive = (changePercent || 0) >= 0;
                    return (
                        <div
                            key={w.id}
                            className="flex items-center justify-between p-3 rounded-xl"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', gap: '10px' }}
                        >
                            <div className="flex flex-col min-w-0" style={{ gap: '2px' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600 }} className="truncate">
                                    {w.label || shortenAddress(w.address)}
                                </span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontFamily: 'var(--font-geist-mono), monospace' }} className="truncate" title={w.address}>
                                    {shortenAddress(w.address)}
                                </span>
                            </div>
                            <div className="flex items-center shrink-0" style={{ gap: '10px' }}>
                                <div className="flex flex-col items-end" style={{ gap: '2px' }}>
                                    {state?.error ? (
                                        <span className="text-danger" style={{ fontSize: '0.75rem' }}>{state.error}</span>
                                    ) : !state ? (
                                        <span className="inline-block w-16 h-4 bg-white-10 rounded animate-pulse" />
                                    ) : (
                                        <>
                                            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                                                {hideBalances ? '••••' : `${balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${unit}`}
                                            </span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                {hideBalances ? '••••' : `${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currencyLabel}`}
                                                {Number.isFinite(changePercent) && (
                                                    <span style={{ color: positive ? 'var(--success)' : 'var(--danger)', marginLeft: '6px' }}>
                                                        {positive ? '+' : ''}{changePercent.toFixed(2)}%
                                                    </span>
                                                )}
                                            </span>
                                        </>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleRemove(w.id)}
                                    title="Stop tracking"
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '4px', display: 'flex' }}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Add address — bottom sheet, Save enabled once the address is valid */}
            {adding && (
                <BottomSheet
                    title="Track wallet"
                    subtitle={`Watch-only ${chain} address`}
                    onClose={closeAddSheet}
                    maxWidth={560}
                >
                    <form onSubmit={handleAdd} className="flex flex-col gap-4" style={{ maxWidth: '520px', margin: '0 auto' }}>
                        <div>
                            <label style={fieldLabelStyle} htmlFor="wallet-address">Address</label>
                            <input
                                id="wallet-address"
                                className="input-reset"
                                style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: '0.9rem' }}
                                placeholder={chain === 'BTC' ? 'bc1…  /  1…  /  3…' : '0x…'}
                                value={address}
                                onChange={e => { setAddress(e.target.value); setError(''); }}
                                autoFocus
                                spellCheck={false}
                                autoComplete="off"
                                autoCorrect="off"
                            />
                            {trimmedAddress && !isValidAddress && (
                                <span style={{ display: 'block', marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                                    Doesn&apos;t look like a valid {chain} address yet
                                </span>
                            )}
                        </div>
                        <div>
                            <label style={fieldLabelStyle} htmlFor="wallet-label">Label (optional)</label>
                            <input
                                id="wallet-label"
                                className="input-reset"
                                placeholder="e.g. Cold storage"
                                value={label}
                                onChange={e => setLabel(e.target.value)}
                            />
                        </div>

                        {error && <span className="text-danger" style={{ fontSize: '0.8rem' }}>{error}</span>}

                        <button
                            type="submit"
                            disabled={!isValidAddress || busy}
                            className="transition-all"
                            style={{
                                width: '100%',
                                background: 'var(--foreground)',
                                border: 'none',
                                borderRadius: '14px',
                                padding: '14px',
                                fontSize: '1rem',
                                fontWeight: 600,
                                color: 'var(--background)',
                                cursor: isValidAddress && !busy ? 'pointer' : 'default',
                                opacity: isValidAddress && !busy ? 1 : 0.4,
                                marginTop: '4px'
                            }}
                        >
                            {busy ? 'Verifying…' : 'Save'}
                        </button>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-faint)', textAlign: 'center' }}>
                            Read-only. We never ask for keys — only a public address.
                        </p>
                    </form>
                </BottomSheet>
            )}
        </div>
    );
}
