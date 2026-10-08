import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import Dexie from 'dexie';
import { restoreLegacySnapshot } from '../src/utils/legacy-storage.js';

const memoryStorage = initial => {
    const values = new Map(Object.entries(initial || {}));
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        key: index => [...values.keys()][index],
        get length() { return values.size; }
    };
};
let databaseId = 0;
function targetDatabase(t) {
    const database = new Dexie(`MigrationTest-${++databaseId}`);
    database.version(1).stores({ portfolios: '++id', transactions: '++id', settings: 'key', watchlistAssets: '++id', wallets: '++id' });
    t.after(() => database.delete());
    return database;
}
const snapshot = () => ({
    version: 1,
    tables: {
        portfolios: [{ id: 8, name: 'Investments' }],
        transactions: [{ id: 20, portfolioId: 8, type: 'BUY', baseCurrency: 'AAPL', baseAmount: 2, quoteAmount: 200 }],
        settings: [{ key: 'baseCurrency', value: 'EUR' }],
        watchlistAssets: [{ id: 12, portfolioId: 8, symbol: 'MSFT' }],
        wallets: [{ id: 9, portfolioId: 8, chain: 'bitcoin', address: 'public-address' }]
    },
    localStorage: { asset_chart_timeframe: '1Y', portfolio_chart_timeframe: 'ALL' }
});

test('migration preserves portfolio relationships, IDs and preferences and runs once', async t => {
    const database = targetDatabase(t);
    const storage = memoryStorage({ asset_chart_timeframe: '1M' });
    assert.equal(await restoreLegacySnapshot(snapshot(), database, storage), true);
    assert.equal((await database.transactions.get(20)).portfolioId, 8);
    assert.equal((await database.portfolios.get(8)).name, 'Investments');
    assert.equal((await database.wallets.get(9)).portfolioId, 8);
    assert.equal((await database.watchlistAssets.get(12)).symbol, 'MSFT');
    assert.equal((await database.settings.get('baseCurrency')).value, 'EUR');
    assert.equal(storage.getItem('portfolio_chart_timeframe'), 'ALL');
    assert.equal(storage.getItem('asset_chart_timeframe'), '1M');
    assert.equal(await database.portfolios.add({ name: 'New portfolio' }), 9);
    assert.equal(await restoreLegacySnapshot(snapshot(), database, storage), false);
    assert.equal(await database.transactions.count(), 1);
});

test('existing bundled data is preserved and migration is marked complete', async t => {
    const database = targetDatabase(t);
    const storage = memoryStorage();
    await database.portfolios.add({ id: 2, name: 'Already local' });
    assert.equal(await restoreLegacySnapshot(snapshot(), database, storage), false);
    assert.equal(await database.transactions.count(), 0);
    assert.equal((await database.portfolios.get(2)).name, 'Already local');
    assert.equal((await database.settings.get('bundled_storage_migrated_v1')).value, true);
    assert.equal(storage.length, 0);
});

test('failed migration rolls back every table and added preferences, allowing a safe retry', async t => {
    const database = targetDatabase(t);
    const storage = memoryStorage({ asset_chart_timeframe: '1M' });
    const invalid = snapshot();
    invalid.tables.transactions.push({ ...invalid.tables.transactions[0] });
    await assert.rejects(restoreLegacySnapshot(invalid, database, storage));
    assert.equal(await database.portfolios.count(), 0);
    assert.equal(await database.transactions.count(), 0);
    assert.equal(await database.settings.count(), 0);
    assert.equal(storage.getItem('portfolio_chart_timeframe'), null);
    assert.equal(storage.getItem('asset_chart_timeframe'), '1M');
    assert.equal(await restoreLegacySnapshot(snapshot(), database, storage), true);
});

test('invalid snapshots cannot write data or preferences', async t => {
    const database = targetDatabase(t);
    const storage = memoryStorage();
    await assert.rejects(restoreLegacySnapshot({ ...snapshot(), version: 2 }, database, storage), /Invalid/);
    await assert.rejects(restoreLegacySnapshot({ ...snapshot(), tables: { transactions: {} } }, database, storage), /Invalid/);
    assert.equal(await database.transactions.count(), 0);
    assert.equal(storage.length, 0);
});

async function readNativeSnapshot(indexedDB, localStorage) {
    const html = await readFile(new URL('../android/app/src/main/assets/legacy-storage.html', import.meta.url), 'utf8');
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    return new Promise((resolve, reject) => {
        runInNewContext(script, {
            indexedDB, localStorage,
            MonetraLegacy: { complete: json => resolve(JSON.parse(json)), failed: () => reject(new Error('Snapshot failed')) }
        });
    });
}

test('the native reader copies legacy storage without modifying it', async t => {
    const indexedDB = new IDBFactory();
    const source = new Dexie('PortfolioTracker', { indexedDB, IDBKeyRange: globalThis.IDBKeyRange });
    source.version(1).stores({ transactions: '++id', settings: 'key' });
    t.after(() => source.delete());
    await source.transactions.add({ id: 7, type: 'SELL', baseAmount: 3 });
    await source.settings.add({ key: 'privacyMode', value: true });
    const storage = memoryStorage({ asset_chart_timeframe: 'ALL' });
    const read = await readNativeSnapshot(indexedDB, storage);
    assert.deepEqual(read.tables.transactions, [{ id: 7, type: 'SELL', baseAmount: 3 }]);
    assert.deepEqual(read.tables.settings, [{ key: 'privacyMode', value: true }]);
    assert.equal(read.localStorage.asset_chart_timeframe, 'ALL');
    assert.equal(await source.transactions.count(), 1);
    assert.equal(storage.length, 1);
});

test('first install migrates an empty snapshot without creating an old-origin database', async () => {
    const indexedDB = new IDBFactory();
    assert.deepEqual(await readNativeSnapshot(indexedDB, memoryStorage()), { version: 1, tables: {}, localStorage: {} });
    assert.deepEqual(await indexedDB.databases(), []);
});
