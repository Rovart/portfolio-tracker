import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Dexie from 'dexie';
import { db, exportToCsv, getAllTransactions, importTransactions } from '../src/utils/db.js';
import { parsePortfolioCsv } from '../src/utils/csvImport.js';
import { calculateAssetAccounting } from '../src/utils/portfolio-logic.js';
import { createBackup, restoreBackup, validateBackup } from '../src/utils/backup.js';

const tables = ['portfolios', 'transactions', 'settings', 'watchlistAssets', 'wallets'];
const storage = values => {
    const map = new Map(Object.entries(values));
    return { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: key => map.get(key) ?? null,
        setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
};
let sequence = 0;
const database = t => {
    const target = new Dexie(`BackupReview-${++sequence}`);
    target.version(1).stores({ portfolios: '++id', transactions: '++id', settings: 'key', watchlistAssets: '++id', wallets: '++id' });
    t.after(() => target.delete());
    return target;
};
const transaction = (type, hour, amount) => ({ type, date: `2026-10-08T${hour}:00:00.123Z`,
    baseCurrency: 'AAPL', baseAmount: 1, quoteCurrency: 'USD', quoteAmount: amount, affectsQuoteBalance: false, portfolioId: 7 });

test('CSV round-trip preserves intraday FIFO profits, timestamp precision and multiline notes', async t => {
    for (const name of tables) await db.table(name).clear();
    t.after(async () => { for (const name of tables) await db.table(name).clear(); });
    await db.portfolios.add({ id: 7, name: 'Investments' });
    await db.transactions.bulkAdd([
        { ...transaction('BUY', '09', 100), notes: 'Line one\nLine two, with "quotes"' },
        transaction('BUY', '10', 200), transaction('SELL', '11', 300)
    ]);
    const before = calculateAssetAccounting(await getAllTransactions(), 'AAPL');
    const parsed = parsePortfolioCsv(await exportToCsv());
    assert.equal(parsed.transactions[0].date, '2026-10-08T09:00:00.123Z');
    assert.equal(parsed.transactions[0].notes, 'Line one\nLine two, with "quotes"');
    await db.transactions.clear();
    await importTransactions(parsed.transactions, 7);
    const after = calculateAssetAccounting(await getAllTransactions(), 'AAPL');
    assert.equal(before.realizedPnl, 200);
    assert.equal(after.realizedPnl, before.realizedPnl);
    assert.equal(after.remainingCostBasis, before.remainingCostBasis);
    assert.equal(after.oversoldQuantity, 0);
});

test('FIFO preserves insertion order for trades with identical timestamps', () => {
    const ledger = [
        { ...transaction('SELL', '09', 300), id: 3 },
        { ...transaction('BUY', '09', 200), id: 2 },
        { ...transaction('BUY', '09', 100), id: 1 }
    ];
    assert.equal(calculateAssetAccounting(ledger, 'AAPL').realizedPnl, 200);
});

test('CSV rejects invalid dates and malformed rows before anything is imported', () => {
    assert.throws(() => parsePortfolioCsv('Date,Way,Base amount,Base currency\nbad,BUY,1,AAPL'), /invalid date/);
    assert.throws(() => parsePortfolioCsv('Date,Way,Base amount,Base currency\n2026-10-08,BUY,1,AAPL,extra'), /malformed/);
    assert.equal(parsePortfolioCsv('Date,Way,Base amount,Base currency\n2026-10-08,BUY,1,AAPL').transactions.length, 1);
});

test('complete backups preserve portfolios, ledger, wallets, watchlists and preferences across databases', async t => {
    const source = database(t);
    const target = database(t);
    await source.portfolios.bulkAdd([{ id: 7, name: 'Investments', position: 1 }, { id: 9, name: 'Watching', isWatchlist: true }]);
    await source.transactions.add({ ...transaction('BUY', '09', 100), id: 42, costBasisBase: 123, notes: 'Exact snapshot' });
    await source.wallets.add({ id: 14, portfolioId: 7, chain: 'ETH', address: '0x' + '1'.repeat(40), label: 'Savings' });
    await source.watchlistAssets.add({ id: 16, portfolioId: 9, symbol: 'MSFT', position: 2 });
    await source.settings.put({ key: 'base_currency', value: 'EUR' });
    const sourceStorage = storage({ portfolio_chart_timeframe: '1Y', notifications_enabled: 'false' });
    const backup = JSON.parse(JSON.stringify(await createBackup(source, sourceStorage)));
    await target.portfolios.add({ id: 1, name: 'Replaced' });
    await target.settings.put({ key: 'bundled_storage_migrated_v1', value: true });
    const targetStorage = storage({ old_preference: 'discard' });
    await restoreBackup(backup, target, targetStorage);
    for (const name of tables.filter(name => name !== 'settings')) assert.deepEqual(await target.table(name).toArray(), backup.tables[name]);
    assert.equal((await target.settings.get('base_currency')).value, 'EUR');
    assert.equal((await target.settings.get('bundled_storage_migrated_v1')).value, true);
    assert.equal(targetStorage.getItem('portfolio_chart_timeframe'), '1Y');
    assert.equal(targetStorage.getItem('old_preference'), null);
});

test('invalid backup versions, duplicate IDs and broken references cannot erase existing data', async t => {
    const target = database(t);
    await target.portfolios.add({ id: 7, name: 'Keep me' });
    const preferences = storage({ keep: 'yes' });
    const backup = await createBackup(target, preferences);
    for (const invalid of [
        { ...backup, version: 2 },
        { ...backup, tables: { ...backup.tables, portfolios: [...backup.tables.portfolios, ...backup.tables.portfolios] } },
        { ...backup, tables: { ...backup.tables, transactions: [{ ...transaction('BUY','09',100), id: 1, portfolioId: 99 }] } },
        { ...backup, tables: { ...backup.tables, transactions: [{ ...transaction('BUY','09',Infinity), id: 1 }] } }
    ]) {
        assert.throws(() => validateBackup(invalid));
        await assert.rejects(restoreBackup(invalid, target, preferences));
        assert.equal((await target.portfolios.get(7)).name, 'Keep me');
        assert.equal(preferences.getItem('keep'), 'yes');
    }
});

test('a preference write failure rolls back the complete restore and retains original preferences', async t => {
    const target = database(t);
    await target.portfolios.add({ id: 7, name: 'Keep me' });
    const preferences = storage({ keep: 'yes' });
    const backup = await createBackup(target, preferences);
    backup.tables.portfolios[0].name = 'Changed';
    backup.preferences = { fail: 'write' };
    const originalWrite = preferences.setItem;
    preferences.setItem = (key, value) => { if (key === 'fail') throw new Error('Storage unavailable'); originalWrite(key, value); };
    await assert.rejects(restoreBackup(backup, target, preferences), /Storage unavailable/);
    assert.equal((await target.portfolios.get(7)).name, 'Keep me');
    assert.equal(preferences.getItem('keep'), 'yes');
});
