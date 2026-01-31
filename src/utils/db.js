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

// Version 3: Add watchlist support
db.version(3).stores({
    transactions: '++id, date, type, baseCurrency, quoteCurrency, portfolioId',
    settings: 'key',
    portfolios: '++id, name, createdAt, isWatchlist',
    watchlistAssets: '++id, portfolioId, symbol, addedAt'
});

// Version 4: Add position fields for custom ordering
db.version(4).stores({
    transactions: '++id, date, type, baseCurrency, quoteCurrency, portfolioId',
    settings: 'key',
    portfolios: '++id, name, createdAt, isWatchlist, position',
    watchlistAssets: '++id, portfolioId, symbol, addedAt, position'
}).upgrade(async tx => {
    // Set initial positions for existing portfolios based on createdAt
    const portfolios = await tx.table('portfolios').toArray();
    portfolios.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let i = 0; i < portfolios.length; i++) {
        await tx.table('portfolios').update(portfolios[i].id, { position: i });
    }

    // Set initial positions for existing watchlist assets based on addedAt
    const assets = await tx.table('watchlistAssets').toArray();
    // Group by portfolioId
    const grouped = assets.reduce((acc, a) => {
        if (!acc[a.portfolioId]) acc[a.portfolioId] = [];
        acc[a.portfolioId].push(a);
        return acc;
    }, {});

    for (const portfolioId of Object.keys(grouped)) {
        grouped[portfolioId].sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));
        for (let i = 0; i < grouped[portfolioId].length; i++) {
            await tx.table('watchlistAssets').update(grouped[portfolioId][i].id, { position: i });
        }
    }
});

// Portfolio helpers
export async function getAllPortfolios() {
    const portfolios = await db.portfolios.toArray();
    // Sort by position, fallback to createdAt if position is undefined
    return portfolios.sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined) {
            return a.position - b.position;
        }
        return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

export async function addPortfolio(name) {
    // Get next position
    const portfolios = await db.portfolios.toArray();
    const maxPos = portfolios.reduce((max, p) => Math.max(max, p.position || 0), -1);

    const id = await db.portfolios.add({
        name,
        createdAt: new Date().toISOString(),
        position: maxPos + 1
    });
    return id;
}

export async function updatePortfolio(id, updates) {
    await db.portfolios.update(id, updates);
}

export async function deletePortfolio(id) {
    // Delete all transactions in this portfolio
    await db.transactions.where('portfolioId').equals(id).delete();
    // Delete all watchlist assets in this portfolio
    await db.watchlistAssets.where('portfolioId').equals(id).delete();
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

// Watchlist asset helpers
export async function getWatchlistAssets(portfolioId) {
    const assets = await db.watchlistAssets.where('portfolioId').equals(portfolioId).toArray();
    // Sort by position, fallback to addedAt if position is undefined
    return assets.sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined) {
            return a.position - b.position;
        }
        return new Date(a.addedAt) - new Date(b.addedAt);
    });
}

export async function addWatchlistAsset(portfolioId, asset) {
    // Check if already exists
    const existing = await db.watchlistAssets
        .where({ portfolioId, symbol: asset.symbol })
        .first();
    if (existing) return existing.id;

    // Get next position
    const assets = await db.watchlistAssets.where('portfolioId').equals(portfolioId).toArray();
    const maxPos = assets.reduce((max, a) => Math.max(max, a.position || 0), -1);

    const id = await db.watchlistAssets.add({
        portfolioId,
        symbol: asset.symbol,
        name: asset.name || asset.shortname || asset.symbol,
        type: asset.type || asset.originalType || 'EQUITY',
        currency: asset.currency || 'USD',
        addedAt: new Date().toISOString(),
        position: maxPos + 1
    });
    return id;
}

export async function removeWatchlistAsset(portfolioId, symbol) {
    await db.watchlistAssets.where({ portfolioId, symbol }).delete();
}

export async function isSymbolInWatchlist(portfolioId, symbol) {
    const existing = await db.watchlistAssets
        .where({ portfolioId, symbol })
        .first();
    return !!existing;
}

export async function getAllWatchlistAssets() {
    return await db.watchlistAssets.toArray();
}

// Update watchlist asset name
export async function updateWatchlistAssetName(portfolioId, symbol, newName) {
    const asset = await db.watchlistAssets
        .where({ portfolioId, symbol })
        .first();
    if (asset) {
        await db.watchlistAssets.update(asset.id, { name: newName });
    }
}

// Bulk position update functions
export async function updatePortfolioPositions(orderedIds) {
    // orderedIds is an array of portfolio IDs in the desired order
    for (let i = 0; i < orderedIds.length; i++) {
        await db.portfolios.update(orderedIds[i], { position: i });
    }
}

export async function updateWatchlistAssetPositions(portfolioId, orderedSymbols) {
    // orderedSymbols is an array of symbols in the desired order
    const assets = await db.watchlistAssets.where('portfolioId').equals(portfolioId).toArray();
    const symbolToId = assets.reduce((acc, a) => ({ ...acc, [a.symbol]: a.id }), {});

    for (let i = 0; i < orderedSymbols.length; i++) {
        const id = symbolToId[orderedSymbols[i]];
        if (id) {
            await db.watchlistAssets.update(id, { position: i });
        }
    }
}

export { db };
