import Dexie from 'dexie';

// Create IndexedDB database
const db = new Dexie('PortfolioTracker');

// Version 1: Original schema
db.version(1).stores({
    transactions: '++id, date, type, baseCurrency, quoteCurrency',
    settings: 'key'
});

// Version 2: Add portfolios with backwards compatibility
db.version(2).stores({
    transactions: '++id, date, type, baseCurrency, quoteCurrency, portfolioId',
    settings: 'key',
    portfolios: '++id, name, createdAt'
}).upgrade(async tx => {
    // Create default portfolio for existing data
    const defaultPortfolio = await tx.table('portfolios').add({
        name: 'Default',
        createdAt: new Date().toISOString()
    });

    // Assign all existing transactions to the default portfolio
    await tx.table('transactions').toCollection().modify(transaction => {
        transaction.portfolioId = defaultPortfolio;
    });
});

// Portfolio helpers
export async function getAllPortfolios() {
    return await db.portfolios.orderBy('createdAt').toArray();
}

export async function addPortfolio(name) {
    const id = await db.portfolios.add({
        name,
        createdAt: new Date().toISOString()
    });
    return id;
}

export async function updatePortfolio(id, updates) {
    await db.portfolios.update(id, updates);
}

export async function deletePortfolio(id) {
    // Delete all transactions in this portfolio
    await db.transactions.where('portfolioId').equals(id).delete();
    // Delete the portfolio
    await db.portfolios.delete(id);
}

// Get transactions for a specific portfolio (or all if portfolioId is null)
export async function getTransactionsByPortfolio(portfolioId = null) {
    if (portfolioId === null) {
        return await db.transactions.orderBy('date').reverse().toArray();
    }
    return await db.transactions.where('portfolioId').equals(portfolioId).reverse().sortBy('date');
}

// Transaction helpers
export async function getAllTransactions() {
    return await db.transactions.orderBy('date').reverse().toArray();
}

export async function addTransaction(transaction) {
    const id = await db.transactions.add({
        ...transaction,
        portfolioId: transaction.portfolioId || 1, // Default portfolio if not specified
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
export async function importTransactions(transactions, portfolioId = 1) {
    await db.transactions.bulkAdd(transactions.map(tx => ({
        ...tx,
        portfolioId: tx.portfolioId || portfolioId,
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
export async function exportToCsv(portfolioId = null) {
    const transactions = portfolioId
        ? await getTransactionsByPortfolio(portfolioId)
        : await getAllTransactions();

    const portfolios = await getAllPortfolios();
    const portfolioMap = portfolios.reduce((acc, p) => ({ ...acc, [p.id]: p.name }), {});

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
        'Notes': tx.notes || '',
        'Portfolio Name': portfolioMap[tx.portfolioId] || 'Default',
        'Portfolio ID': tx.portfolioId || 1
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

// Ensure default portfolio exists
export async function ensureDefaultPortfolio() {
    const portfolios = await getAllPortfolios();
    if (portfolios.length === 0) {
        await addPortfolio('Default');
    }
    return await getAllPortfolios();
}

export { db };
