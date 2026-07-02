'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wallet, Plus, Trash2, RefreshCw } from 'lucide-react';
import { getWalletsForChain, addWallet, removeWallet } from '@/utils/db';

function shortenAddress(address) {
    if (!address || address.length <= 14) return address;
    return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

// Watch-only wallet tracking for on-chain assets (BTC / ETH).
// Balances are read from public endpoints via /api/wallet — no keys, read-only.
export default function WalletTracker({ chain, price, changePercent, baseCurrency, hideBalances }) {
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
            const list = await getWalletsForChain(chain);
            if (cancelled) return;
            setWallets(list);
            if (list.length > 0) refreshAll(list);
        })();
        return () => { cancelled = true; };
    }, [chain, refreshAll]);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!address.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            // Validate the address by fetching its balance before saving
            const res = await fetch(`/api/wallet?chain=${chain}&address=${encodeURIComponent(address.trim())}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Could not verify address');

            const id = await addWallet(chain, address, label);
            const wallet = { id, chain, address: address.trim(), label: label.trim() };
            setWallets(prev => [...prev, wallet]);
            setBalances(prev => ({ ...prev, [id]: { balance: json.balance } }));
            setAddress('');
            setLabel('');
            setAdding(false);
        } catch (err) {
            setError(err.message || 'Failed to add wallet');
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async (id) => {
        await removeWallet(id);
        setWallets(prev => prev.filter(w => w.id !== id));
    };

    const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };

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
                    {!adding && (
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
                    )}
                </div>
            </div>

            {adding && (
                <form onSubmit={handleAdd} className="flex flex-col gap-2" style={{ marginBottom: '12px' }}>
                    <input
                        className="input-reset"
                        style={{ fontSize: '0.85rem', padding: '10px 12px' }}
                        placeholder={chain === 'BTC' ? 'Bitcoin address (bc1… / 1… / 3…)' : 'Ethereum address (0x…)'}
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                    />
                    <input
                        className="input-reset"
                        style={{ fontSize: '0.85rem', padding: '10px 12px' }}
                        placeholder="Label (optional, e.g. Cold storage)"
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                    />
                    {error && <span className="text-danger" style={{ fontSize: '0.78rem' }}>{error}</span>}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setAdding(false); setError(''); }}
                            style={{ flex: 1, background: 'transparent', border: '1px solid var(--card-border-strong)', borderRadius: '10px', padding: '9px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={busy || !address.trim()}
                            style={{ flex: 2, background: 'var(--foreground)', border: 'none', borderRadius: '10px', padding: '9px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--background)', cursor: 'pointer', opacity: busy || !address.trim() ? 0.5 : 1 }}
                        >
                            {busy ? 'Verifying…' : 'Track wallet'}
                        </button>
                    </div>
                </form>
            )}

            {wallets.length === 0 && !adding && (
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
        </div>
    );
}
