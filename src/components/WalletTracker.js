'use client';

import { apiFetch } from '@/utils/api-client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { getWalletsForChain, addWallet, removeWallet } from '@/utils/db';
import BottomSheet from './BottomSheet';
import { FormRow } from './ui';
import { formatMoney, formatPercent, formatQuantity } from '@/utils/format';

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
            const res = await apiFetch(`/api/wallet?chain=${chain}&address=${encodeURIComponent(wallet.address)}`);
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
            const res = await apiFetch(`/api/wallet?chain=${chain}&address=${encodeURIComponent(trimmedAddress)}`);
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

    return (
        <section aria-label="Watched wallets">
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
                <h3 className="section-title">Watched wallets</h3>
                <div className="flex items-center" style={{ gap: '4px' }}>
                    {wallets.length > 0 && (
                        <button type="button" onClick={() => refreshAll(wallets)} title="Refresh balances" aria-label="Refresh balances" className="icon-button">
                            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                    )}
                    <button type="button" onClick={() => setAdding(true)} className="btn-text">
                        <Plus size={16} /> Add address
                    </button>
                </div>
            </div>

            {wallets.length === 0 && (
                <p className="label" style={{ margin: 0 }}>
                    Track a {chain} address read-only — balance and value update automatically.
                </p>
            )}

            {wallets.length > 0 && <div className="list-group">
                {wallets.map(w => {
                    const state = balances[w.id];
                    const balance = state?.balance;
                    const value = Number.isFinite(balance) ? balance * (price || 0) : null;
                    const positive = (changePercent || 0) >= 0;
                    return (
                        <div key={w.id} className="list-row is-static" style={{ paddingRight: 'var(--space-2)' }}>
                            <div className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
                                <span className="list-row-title truncate">
                                    {w.label || shortenAddress(w.address)}
                                </span>
                                <span className="list-row-subtitle truncate" style={{ fontFamily: 'var(--font-geist-mono), monospace' }} title={w.address}>
                                    {shortenAddress(w.address)}
                                </span>
                            </div>
                            <div className="flex items-center shrink-0" style={{ gap: '10px' }}>
                                <div className="flex flex-col items-end" style={{ gap: '2px' }}>
                                    {state?.error ? (
                                        <span className="list-row-subtitle delta-down">{state.error}</span>
                                    ) : !state ? (
                                        <span className="skeleton inline-block" style={{ width: 64, height: 14 }} />
                                    ) : (
                                        <>
                                            <span className="list-row-title">
                                                {hideBalances ? '••••' : `${formatQuantity(balance, { maxDecimals: 6 })} ${unit}`}
                                            </span>
                                            <span className="list-row-subtitle">
                                                {hideBalances ? '••••' : formatMoney(value ?? 0, baseCurrency)}
                                                {Number.isFinite(changePercent) && (
                                                    <span className={positive ? 'delta-up' : 'delta-down'}> · {formatPercent(changePercent)}</span>
                                                )}
                                            </span>
                                        </>
                                    )}
                                </div>
                                <button type="button" onClick={() => handleRemove(w.id)} title="Stop tracking" aria-label="Stop tracking" className="icon-button">
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>}

            {/* Add address — bottom sheet, Save enabled once the address is valid */}
            {adding && (
                <BottomSheet
                    title="Track wallet"
                    subtitle={`Watch-only ${chain} address`}
                    onClose={closeAddSheet}
                    maxWidth={560}
                >
                    <form onSubmit={handleAdd} className="form-stack" style={{ maxWidth: '520px', margin: '0 auto' }}>
                        <div className="form-list">
                            <div className="form-row">
                                <input
                                    id="wallet-address"
                                    aria-label="Address"
                                    className="form-input"
                                    style={{ textAlign: 'left', fontFamily: 'var(--font-geist-mono), monospace' }}
                                    placeholder={chain === 'BTC' ? 'Address: bc1…, 1… or 3…' : 'Address: 0x…'}
                                    value={address}
                                    onChange={e => { setAddress(e.target.value); setError(''); }}
                                    autoFocus
                                    spellCheck={false}
                                    autoComplete="off"
                                    autoCorrect="off"
                                />
                            </div>
                            <FormRow label="Label" htmlFor="wallet-label">
                                <input
                                    id="wallet-label"
                                    className="form-input"
                                    placeholder="Optional"
                                    value={label}
                                    onChange={e => setLabel(e.target.value)}
                                />
                            </FormRow>
                        </div>
                        {trimmedAddress && !isValidAddress && (
                            <span className="hint">Doesn&apos;t look like a valid {chain} address yet</span>
                        )}

                        {error && <span className="form-error">{error}</span>}

                        <button
                            type="submit"
                            disabled={!isValidAddress || busy}
                            className="btn btn-block"
                            style={{ opacity: isValidAddress && !busy ? 1 : 0.4, cursor: isValidAddress && !busy ? 'pointer' : 'default' }}
                        >
                            {busy ? 'Verifying…' : 'Save'}
                        </button>
                        <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
                            Read-only. We never ask for keys — only a public address.
                        </p>
                    </form>
                </BottomSheet>
            )}
        </section>
    );
}
