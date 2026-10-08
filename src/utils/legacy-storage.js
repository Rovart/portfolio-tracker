import { Capacitor, registerPlugin } from '@capacitor/core';
import { db } from './db.js';

const LegacyStorage = registerPlugin('LegacyStorage');
const MIGRATION_KEY = 'bundled_storage_migrated_v1';
const TABLES = ['portfolios', 'transactions', 'settings', 'watchlistAssets', 'wallets'];
let initialization;

export async function restoreLegacySnapshot(snapshot, database = db, storage = localStorage) {
    if (snapshot?.version !== 1 || !snapshot.tables || !snapshot.localStorage) {
        throw new Error('Invalid legacy storage snapshot.');
    }
    for (const name of TABLES) {
        if (snapshot.tables[name] !== undefined && !Array.isArray(snapshot.tables[name])) {
            throw new Error('Invalid legacy storage table.');
        }
    }
    const addedKeys = [];
    try {
        return await database.transaction('rw', TABLES.map(name => database.table(name)), async () => {
            if (await database.table('settings').get(MIGRATION_KEY)) return false;
            const existing = await Promise.all(TABLES.map(name => database.table(name).count()));
            if (existing.some(count => count > 0)) {
                // Never merge over portfolios already created in the bundled app.
                await database.table('settings').put({ key: MIGRATION_KEY, value: true });
                return false;
            }
            // Preserve preferences already set in the new local origin.
            for (const [key, value] of Object.entries(snapshot.localStorage)) {
                if (typeof value === 'string' && storage.getItem(key) === null) {
                    storage.setItem(key, value);
                    addedKeys.push(key);
                }
            }
            for (const name of TABLES) {
                const rows = snapshot.tables[name] || [];
                if (rows.length > 0) await database.table(name).bulkAdd(rows);
            }
            await database.table('settings').put({ key: MIGRATION_KEY, value: true });
            return true;
        });
    } catch (error) {
        for (const key of addedKeys) storage.removeItem(key);
        throw error;
    }
}

export function initializeBundledStorage() {
    if (process.env.NEXT_PUBLIC_BUNDLED_APP !== 'true' || Capacitor.getPlatform() !== 'android') return Promise.resolve();
    if (!initialization) {
        initialization = (async () => {
            if (await db.settings.get(MIGRATION_KEY)) return;
            const snapshot = await LegacyStorage.read();
            await restoreLegacySnapshot(snapshot);
        })().catch(error => {
            initialization = null;
            throw error;
        });
    }
    return initialization;
}
