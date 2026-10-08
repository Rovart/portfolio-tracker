import { db } from './db.js';

const TABLES = ['portfolios', 'transactions', 'settings', 'watchlistAssets', 'wallets'];
const MIGRATION_KEY = 'bundled_storage_migrated_v1';
const readPreferences = storage => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return [key, storage.getItem(key)];
}));

function writePreferences(storage, values) {
    for (const key of Object.keys(readPreferences(storage))) storage.removeItem(key);
    for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
}

export function validateBackup(input) {
    if (input?.format !== 'monetra-backup' || input.version !== 1 || !Number.isFinite(Date.parse(input.createdAt))) {
        throw new Error('This is not a supported Monetra backup.');
    }
    const preferences = input.preferences;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences) ||
        Object.values(preferences).some(value => typeof value !== 'string')) {
        throw new Error('The backup preferences are invalid.');
    }
    for (const name of TABLES) {
        const rows = input.tables?.[name];
        if (!Array.isArray(rows)) throw new Error(`The backup is missing ${name}.`);
        const keys = new Set();
        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${name} record.`);
            const key = name === 'settings' ? row.key : row.id;
            if ((name === 'settings' ? typeof key !== 'string' || !key : !Number.isSafeInteger(key) || key <= 0) || keys.has(key)) {
                throw new Error(`Invalid or duplicate ${name} identifier.`);
            }
            keys.add(key);
        }
    }
    const portfolioIds = new Set(input.tables.portfolios.map(row => row.id));
    for (const name of ['transactions', 'watchlistAssets', 'wallets']) {
        for (const row of input.tables[name]) {
            if (!portfolioIds.has(row.portfolioId)) throw new Error(`A ${name} record refers to a missing portfolio.`);
        }
    }
    for (const tx of input.tables.transactions) {
        if (!Number.isFinite(Date.parse(tx.date)) || !['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW'].includes(tx.type) ||
            typeof tx.baseCurrency !== 'string' || !tx.baseCurrency || !Number.isFinite(tx.baseAmount) || tx.baseAmount < 0 ||
            ['quoteAmount', 'fee', 'costBasisBase'].some(key => tx[key] != null && (!Number.isFinite(tx[key]) || tx[key] < 0))) {
            throw new Error('The backup contains an invalid transaction.');
        }
    }
    for (const row of input.tables.portfolios) {
        if (typeof row.name !== 'string' || !row.name.trim()) throw new Error('Invalid portfolio name.');
    }
    for (const row of input.tables.watchlistAssets) {
        if (typeof row.symbol !== 'string' || !row.symbol) throw new Error('Invalid watchlist symbol.');
    }
    for (const row of input.tables.wallets) {
        if (!['BTC', 'ETH'].includes(row.chain) || typeof row.address !== 'string' || !row.address) throw new Error('Invalid wallet.');
    }
    return input;
}

export async function createBackup(database = db, storage = localStorage) {
    const tables = await database.transaction('r', TABLES.map(name => database.table(name)), async () =>
        Object.fromEntries(await Promise.all(TABLES.map(async name => [name, await database.table(name).toArray()])))
    );
    return { format: 'monetra-backup', version: 1, createdAt: new Date().toISOString(), tables, preferences: readPreferences(storage) };
}

export async function restoreBackup(input, database = db, storage = localStorage) {
    const backup = JSON.parse(JSON.stringify(validateBackup(input)));
    const previousPreferences = readPreferences(storage);
    try {
        await database.transaction('rw', TABLES.map(name => database.table(name)), async () => {
            const migration = await database.table('settings').get(MIGRATION_KEY);
            for (const name of TABLES) {
                await database.table(name).clear();
                const rows = name === 'settings' ? backup.tables[name].filter(row => row.key !== MIGRATION_KEY) : backup.tables[name];
                if (rows.length) await database.table(name).bulkAdd(rows);
            }
            if (migration) await database.table('settings').put(migration);
            writePreferences(storage, backup.preferences);
        });
    } catch (error) {
        writePreferences(storage, previousPreferences);
        throw error;
    }
}
