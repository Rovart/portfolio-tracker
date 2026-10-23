import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLoanHistory,
    buildLoanQuoteMap,
    createLoanSymbol,
    getLoanAccruedAt,
    getLoanQuote,
    getLoanSummary,
    isLoanSymbol
} from '../src/utils/loans.js';
import { calculateAssetAccounting, calculateHoldings, normalizeAsset, getQuoteCurrencyFromSymbol } from '../src/utils/portfolio-logic.js';
import { calculatePortfolioHistory } from '../src/utils/portfolio-history.js';
import { validateBackup } from '../src/utils/backup.js';
import { parsePortfolioCsv } from '../src/utils/csvImport.js';

const DAY = 86400000;
const START = Date.parse('2026-01-01T00:00:00.000Z');
const at = days => START + days * DAY;
const iso = days => new Date(at(days)).toISOString();
const loan = overrides => ({
    id: 1, symbol: 'LOAN:TEST', name: 'Phase 2', currency: 'EUR',
    annualRate: 10, rateType: 'fixed', interestMode: 'simple', maturityDate: iso(365), portfolioId: 1, ...overrides
});
const entry = (type, days, baseAmount, quoteAmount = baseAmount, overrides = {}) => ({
    id: `${type}-${days}`, type, date: iso(days), baseCurrency: 'LOAN:TEST',
    baseAmount, quoteAmount, quoteCurrency: 'EUR', affectsQuoteBalance: false, ...overrides
});
const close = (actual, expected, tolerance = 1e-6) =>
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('loan symbols are unique, upper-case and never parsed as market pairs', () => {
    const symbol = createLoanSymbol(1700000000000, () => 0.5);
    assert.ok(isLoanSymbol(symbol));
    assert.equal(symbol, symbol.toUpperCase());
    assert.equal(normalizeAsset(symbol), symbol);
    assert.equal(getQuoteCurrencyFromSymbol(symbol), null);
    assert.equal(isLoanSymbol('LOANS'), false);
    assert.equal(isLoanSymbol('AAPL'), false);
});

test('simple interest accrues on Actual/365 from the disbursement date', () => {
    const ledger = [entry('BUY', 0, 10000)];
    const quote = getLoanQuote(loan(), ledger, at(365));
    close(quote.price, 1.1);
    assert.equal(quote.currency, 'EUR');
    assert.equal(quote.quoteType, 'LOAN');
    const half = getLoanSummary(loan(), ledger, at(182.5));
    close(half.value, 10500);
    close(half.accrued, 500);
    close(half.dailyAccrual, 10000 * 0.1 / 365);
    close(half.termProgress, 0.5);
    assert.equal(half.daysToMaturity, 183);
    close(half.projection.value, 11000);
    close(half.projection.interest, 1000);
    // Before the disbursement there is nothing to value.
    assert.equal(getLoanQuote(loan(), ledger, at(-1)), null);
});

test('compound interest capitalises the unpaid interest', () => {
    const ledger = [entry('BUY', 0, 10000)];
    const quote = getLoanQuote(loan({ interestMode: 'compound' }), ledger, at(730));
    close(quote.price, 1.21);
});

test('interest payments reset the accrued interest without touching the principal', () => {
    const ledger = [entry('BUY', 0, 10000), entry('INCOME', 182.5, 0, 500)];
    const summary = getLoanSummary(loan(), ledger, at(365));
    close(summary.principal, 10000);
    close(summary.paid, 500);
    close(summary.accrued, 500);
    close(summary.value, 10500);
    close(summary.earned, 1000);
});

test('repayments return principal and settle the interest included in the cash', () => {
    const ledger = [entry('BUY', 0, 10000), entry('SELL', 182.5, 5000, 5500)];
    const summary = getLoanSummary(loan(), ledger, at(365));
    close(summary.principal, 5000);
    close(summary.repaid, 5000);
    close(summary.paid, 500);
    // Second half-year accrues on the remaining principal only.
    close(summary.accrued, 250);
    const full = getLoanSummary(loan(), [...ledger, entry('SELL', 365, 5000, 5250)], at(400));
    assert.equal(full.isClosed, true);
    assert.equal(getLoanQuote(loan(), [...ledger, entry('SELL', 365, 5000, 5250)], at(400)), null);
});

test('a later tranche accrues from its own date', () => {
    const ledger = [entry('BUY', 0, 10000), entry('BUY', 182.5, 10000)];
    const summary = getLoanSummary(loan(), ledger, at(365));
    close(summary.value, 20000 + 1000 + 500);
});

test('repayment suggestions use what was outstanding on that date', () => {
    const ledger = [entry('BUY', 0, 10000), entry('INCOME', 100, 0, 100)];
    const position = getLoanAccruedAt(loan(), ledger, iso(182.5));
    close(position.principal, 10000);
    close(position.accrued, 400);
});

test('FIFO accounting values the loan at its accrued price and books interest as realized', () => {
    const symbol = 'LOAN:TEST';
    const ledger = [
        entry('BUY', 0, 10000, 10000, { affectsQuoteBalance: true }),
        { id: 'cash', type: 'DEPOSIT', date: iso(-1), baseCurrency: 'EUR', baseAmount: 12000 },
        entry('INCOME', 182.5, 0, 500, { affectsQuoteBalance: true })
    ];
    const prices = {
        ...buildLoanQuoteMap([loan()], ledger, at(365)),
        'EURUSD=X': { price: 1.2, currency: 'USD', quoteType: 'CURRENCY' }
    };
    const holdings = calculateHoldings(ledger, prices, 'EUR');
    const loanHolding = holdings.find(h => h.asset === symbol);
    const cash = holdings.find(h => h.asset === 'EUR');
    assert.equal(loanHolding.category, 'Loans');
    assert.equal(loanHolding.isFiat, false);
    close(loanHolding.value, 10500);
    close(loanHolding.costBasis, 10000);
    close(loanHolding.unrealizedProfit, 500);
    close(loanHolding.realizedProfit, 500);
    close(loanHolding.totalProfit, 1000);
    close(cash.amount, 2500);

    const usd = calculateHoldings(ledger, prices, 'USD', (from, to) => from === 'EUR' && to === 'USD' ? 1.2 : null);
    close(usd.find(h => h.asset === symbol).value, 10500 * 1.2);

    const repaid = [...ledger, entry('SELL', 365, 10000, 10500, { affectsQuoteBalance: true })];
    const accounting = calculateAssetAccounting(repaid, symbol, 'EUR');
    close(accounting.currentBalance, 0);
    close(accounting.realizedPnl, 1000);
});

test('portfolio history follows the accrued loan value and counts interest as return', () => {
    const ledger = [
        { id: 'cash', type: 'DEPOSIT', date: iso(0), baseCurrency: 'EUR', baseAmount: 10000 },
        entry('BUY', 0, 10000, 10000, { affectsQuoteBalance: true }),
        entry('INCOME', 100, 0, 200, { affectsQuoteBalance: true })
    ];
    const now = at(200);
    const history = calculatePortfolioHistory(ledger, {
        'LOAN:TEST': buildLoanHistory(loan(), ledger, { to: now }).map(({ date, price }) => ({ date, price }))
    }, 'EUR', { 'LOAN:TEST': 'EUR' });
    const pointAt = days => history.find(point => point.date.startsWith(iso(days).slice(0, 10)));
    close(pointAt(50).rawValue, 10000 * (1 + 0.1 * 50 / 365), 1e-6);
    // After the payment the cash holds the interest and the loan restarts accruing.
    close(pointAt(150).rawValue, 10000 + 10000 * 0.1 * 150 / 365, 1e-6);
    // Performance (TWR) includes the interest; only the initial deposit is an external flow.
    const last = history[history.length - 1];
    close(last.value / history[0].value, last.rawValue / 10000, 1e-9);
});

test('loan history is daily from the first disbursement and ends at the requested instant', () => {
    const ledger = [entry('BUY', 10, 1000)];
    const points = buildLoanHistory(loan(), ledger, { to: at(20.5) });
    assert.equal(points[0].date, iso(10));
    assert.equal(points.at(-1).date, iso(20.5));
    assert.equal(points.length, 12);
    close(points.at(-1).value, 1000 * (1 + 0.1 * 10.5 / 365));
    assert.deepEqual(buildLoanHistory(loan(), [], { to: at(20) }), []);
});

test('backups accept loans and stay compatible with backups made before loans', () => {
    const base = {
        format: 'monetra-backup', version: 1, createdAt: '2026-10-01T00:00:00Z', preferences: {},
        tables: { portfolios: [{ id: 1, name: 'Main' }], transactions: [], settings: [], watchlistAssets: [], wallets: [] }
    };
    assert.deepEqual(validateBackup(structuredClone(base)).tables.loans, []);
    const withLoan = structuredClone(base);
    withLoan.tables.loans = [{ ...loan(), id: 3 }];
    withLoan.tables.transactions = [{ ...entry('INCOME', 1, 0, 10), id: 9, portfolioId: 1 }];
    assert.equal(validateBackup(withLoan).tables.loans.length, 1);
    const invalid = structuredClone(withLoan);
    invalid.tables.loans[0].symbol = 'AAPL';
    assert.throws(() => validateBackup(invalid), /Invalid loan/);
});

test('CSV accepts interest entries without units but still rejects empty trades', () => {
    const header = 'Date,Way,Base amount,Base currency (name),Quote amount,Quote currency';
    assert.equal(parsePortfolioCsv(`${header}\n2026-10-08,INCOME,0,LOAN:TEST,25,EUR`).transactions.length, 1);
    assert.throws(() => parsePortfolioCsv(`${header}\n2026-10-08,BUY,0,LOAN:TEST,25,EUR`), /invalid/);
});
