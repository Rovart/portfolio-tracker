import Dexie from 'dexie';

// Create IndexedDB database
const db = new Dexie('PortfolioTracker');

db.version(1).stores({
    transactions: '++id, date, type, baseCurrency, quoteCurrency',
    settings: 'key'
});

// Transaction helpers
export async function getAllTransactions() {
    return await db.transactions.orderBy('date').reverse().toArray();
}

export async function addTransaction(transaction) {
    const id = await db.transactions.add({
        ...transaction,
        date: new Date(transaction.date).toISOString(),
        createdAt: new Date().toISOString()
    });
    return id;
}

export async function updateTransaction(id, updates) {
    await db.transactions.update(id, updates);
}

export async function deleteTransaction(id) {
    await db.transactions.delete(id);
}

export async function clearAllTransactions() {
    await db.transactions.clear();
}

// Bulk import (for CSV migration)
export async function importTransactions(transactions) {
    await db.transactions.bulkAdd(transactions.map(tx => ({
        ...tx,
        date: new Date(tx.date).toISOString(),
        createdAt: new Date().toISOString()
    })));
}

// Settings helpers
export async function getSetting(key, defaultValue = null) {
    const setting = await db.settings.get(key);
    return setting ? setting.value : defaultValue;
}

export async function setSetting(key, value) {
    await db.settings.put({ key, value });
}

// Export for CSV download
export async function exportToCsv() {
    const transactions = await getAllTransactions();

    const csvRows = transactions.map(tx => ({
        'Date': new Date(tx.date).toISOString().split('T')[0],
        'Way': tx.type,
        'Base amount': tx.baseAmount,
        'Base currency (name)': tx.baseCurrency,
        'Base type': tx.originalType || 'MANUAL',
        'Quote amount': tx.quoteAmount || '',
        'Quote currency': tx.quoteCurrency || '',
        'Exchange': tx.exchange || '',
        'Fee amount': tx.fee || 0,
        'Fee currency (name)': tx.feeCurrency || '',
        'Notes': tx.notes || ''
    }));

    // Convert to CSV string
    if (csvRows.length === 0) return '';

    const headers = Object.keys(csvRows[0]);
    const lines = [
        headers.join(','),
        ...csvRows.map(row => headers.map(h => {
            const val = row[h];
            // Escape commas and quotes
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ];

    return lines.join('\n');
}

export { db };
