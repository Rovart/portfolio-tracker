'use client';

import { useState, useEffect } from 'react';
import ProfitChart from './ProfitChart';
import HoldingsList from './HoldingsList';
import TransactionModal from './TransactionModal';
import { calculateHoldings } from '@/utils/portfolio-logic';
import { calculatePortfolioHistory } from '@/utils/portfolio-history';

const TIMEFRAMES = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL'];

export default function Dashboard({ initialTransactions }) {
    const [transactions, setTransactions] = useState(initialTransactions);
    const [holdings, setHoldings] = useState([]);
    const [prices, setPrices] = useState({});
    const [history, setHistory] = useState([]);
    const [timeframe, setTimeframe] = useState('1M');
    const [selectedHolding, setSelectedHolding] = useState(null); // Valid holding object
    const [isModalOpen, setIsModalOpen] = useState(false); // General modal state
    const [modalMode, setModalMode] = useState('MANAGE'); // MANAGE (existing) or ADD (new)
    const [loading, setLoading] = useState(true);

    // Load from LocalStorage
    useEffect(() => {
        const saved = localStorage.getItem('portfolio_transactions');
        if (saved) {
            setTransactions(JSON.parse(saved));
        } else {
            setTransactions(initialTransactions);
        }
        setLoading(false);
    }, [initialTransactions]);

    // Fetch Prices when transactions change (implies holdings might change)
    useEffect(() => {
        if (loading) return;

        // 1. Identification of unique assets
        const uniqueAssets = [...new Set(transactions.map(t => t.baseCurrency))];

        // 2. Fetch prices
        async function fetchQuotes() {
            if (uniqueAssets.length === 0) return;
            try {
                const res = await fetch(`/api/quote?symbols=${uniqueAssets.join(',')}`);
                const result = await res.json();
                if (result.data) {
                    const pxMap = {};
                    result.data.forEach(q => pxMap[q.symbol] = { price: q.price, changePercent: q.changePercent });
                    setPrices(pxMap);
                }
            } catch (e) {
                console.error('Failed to fetch quotes', e);
            }
        }

        fetchQuotes();
        // Refresh prices every 60s
        const interval = setInterval(fetchQuotes, 60000);
        return () => clearInterval(interval);

    }, [transactions, loading]);

    // Recalculate Holdings when transactions or prices change
    useEffect(() => {
        const h = calculateHoldings(transactions, prices);
        setHoldings(h);
    }, [transactions, prices]);

    // TRUE PORTFOLIO HISTORY
    useEffect(() => {
        if (!transactions || transactions.length === 0) return;

        async function loadTrueHistory() {
            // 1. Identify all assets ever touched (Base OR Quote if needed, usually just Base for price lookup)
            const uniqueAssets = [...new Set(transactions.map(t => t.baseCurrency))];
            const range = '1Y'; // Default to 1Y logic for now or mapped timeframe

            const historyMap = {};

            await Promise.all(uniqueAssets.map(async (sym) => {
                if (sym === 'USD' || !sym) return;
                try {
                    // We fetch 1Y (or ALL) to build the timeline
                    // Simplification: We only care about the visual part, but accurate calc needs history before that? 
                    // calculatePortfolioHistory iterates from First Tx. So we need history from First Tx.
                    const res = await fetch(`/api/history?symbol=${sym}&range=ALL`);
                    const data = await res.json();
                    if (data.history) {
                        historyMap[sym] = data.history.map(d => ({
                            date: d.date.split('T')[0],
                            price: d.price
                        }));
                    }
                } catch (e) { console.error(e); }
            }));

            const chartData = calculatePortfolioHistory(transactions, historyMap);

            // Filter for view
            const now = new Date();
            let cutoff = new Date();
            if (timeframe === '1D') cutoff.setDate(now.getDate() - 1);
            else if (timeframe === '1W') cutoff.setDate(now.getDate() - 7);
            else if (timeframe === '1M') cutoff.setMonth(now.getMonth() - 1);
            else if (timeframe === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
            else if (timeframe === 'YTD') cutoff = new Date(now.getFullYear(), 0, 1);
            else if (timeframe === 'ALL') cutoff = new Date(0); // Epoch

            const cutoffStr = cutoff.toISOString().split('T')[0];
            setHistory(chartData.filter(d => d.date >= cutoffStr));
        }

        const tId = setTimeout(loadTrueHistory, 500);
        return () => clearTimeout(tId);

    }, [transactions, timeframe]);


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

    const handleSaveTransaction = (tx) => {
        const exists = transactions.find(t => t.id === tx.id);
        let updated;
        if (exists) {
            updated = transactions.map(t => t.id === tx.id ? tx : t);
        } else {
            updated = [tx, ...transactions];
        }
        setTransactions(updated);
        localStorage.setItem('portfolio_transactions', JSON.stringify(updated));
        syncTransactionsToFile(updated);
    };

    const handleDeleteTransaction = (id) => {
        const updated = transactions.filter(t => t.id !== id);
        setTransactions(updated);
        localStorage.setItem('portfolio_transactions', JSON.stringify(updated));
        syncTransactionsToFile(updated);
    };

    const openAddModal = () => {
        setSelectedHolding(null);
        setModalMode('ADD');
        setIsModalOpen(true);
    };

    const openManageModal = (holding) => {
        setSelectedHolding(holding);
        setModalMode('MANAGE');
        setIsModalOpen(true);
    };

    // Dashboard calculations
    const totalValue = holdings.reduce((acc, h) => acc + (h.value || 0), 0);
    // Calculate 24h change amount based on holdings
    const prevValue = holdings.reduce((acc, h) => {
        const changeFactor = 1 + ((h.change24h || 0) / 100);
        // Avoid divide by zero
        if (Math.abs(changeFactor) < 0.0001) return acc + h.value;
        return acc + (h.value / changeFactor);
    }, 0);

    const diff = totalValue - prevValue;
    let percent = 0;
    if (prevValue !== 0 && !isNaN(prevValue) && isFinite(prevValue)) {
        percent = (diff / prevValue) * 100;
    }

    // Final safety check
    const safeDiff = isNaN(diff) ? 0 : diff;
    const safePercent = isNaN(percent) ? 0 : percent;

    return (
        <div className="container animate-enter">
            <header className="flex flex-col items-center py-8 gap-2 relative">
                <h1 className="text-muted text-sm uppercase tracking-wider">Total Balance</h1>
                <div className="text-4xl font-bold">
                    ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className={`text-lg ${safeDiff >= 0 ? 'text-success' : 'text-danger'}`}>
                    {safeDiff >= 0 ? '+' : ''}${Math.abs(safeDiff).toLocaleString(undefined, { maximumFractionDigits: 2 })} ({safePercent.toFixed(2)}%)
                </div>

                <button
                    onClick={openAddModal}
                    className="btn absolute right-0 top-8"
                    style={{ padding: '8px 12px', fontSize: '24px', lineHeight: '1' }}
                >
                    +
                </button>
            </header>

            <div className="flex justify-between mb-8 overflow-x-auto gap-2 no-scrollbar">
                {TIMEFRAMES.map((tf) => (
                    <button
                        key={tf}
                        onClick={() => setTimeframe(tf)}
                        className={`btn ${timeframe === tf ? 'bg-white text-black' : 'btn-ghost'}`}
                        style={{
                            background: timeframe === tf ? 'var(--foreground)' : 'transparent',
                            color: timeframe === tf ? 'var(--background)' : 'var(--muted)'
                        }}
                    >
                        {tf}
                    </button>
                ))}
            </div>

            <div className="mb-8">
                <ProfitChart data={history} />
            </div>

            <HoldingsList
                holdings={holdings}
                onSelect={openManageModal}
            />

            {isModalOpen && (
                <TransactionModal
                    mode={modalMode} // ADD or MANAGE
                    holding={selectedHolding} // Null if ADD
                    transactions={transactions}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSaveTransaction}
                    onDelete={handleDeleteTransaction}
                />
            )}
        </div>
    );
}
