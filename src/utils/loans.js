// Private loans are ledger assets priced locally.
// One unit is one unit of outstanding principal in the loan currency, so a
// disbursement is a BUY at price 1. The unit price is
// (principal + accrued unpaid interest) / principal, which lets the regular
// FIFO accounting, holdings, history and FX conversion value loans unchanged:
// - BUY / DEPOSIT add principal, SELL / WITHDRAW return it (cash above the
//   principal on a SELL is interest paid), INCOME records interest paid.
// - Interest accrues on Actual/365, simple by default or capitalised (compound).

export const LOAN_PREFIX = 'LOAN:';
export const LOAN_QUOTE_TYPE = 'LOAN';
export const LOAN_TRANSACTION_TYPES = ['BUY', 'INCOME', 'SELL'];

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365;
const EPSILON = 0.000001;

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function isLoanSymbol(symbol) {
    return typeof symbol === 'string' && symbol.trim().toUpperCase().startsWith(LOAN_PREFIX);
}

export function createLoanSymbol(now = Date.now(), random = Math.random) {
    const suffix = Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');
    return `${LOAN_PREFIX}${now.toString(36)}${suffix}`.toUpperCase();
}

export function getLoanAnnualRate(loan) {
    const rate = toNumber(loan?.annualRate);
    return rate > 0 ? rate / 100 : 0;
}

function loanFlows(symbol, transactions) {
    const key = String(symbol || '').trim().toUpperCase();
    return (transactions || [])
        .filter(tx => String(tx.baseCurrency || '').trim().toUpperCase() === key)
        .map(tx => ({
            id: tx.id,
            time: Date.parse(tx.date),
            type: tx.type,
            units: Math.max(0, toNumber(tx.baseAmount)),
            cash: Math.max(0, toNumber(tx.quoteAmount))
        }))
        .filter(flow => Number.isFinite(flow.time))
        .sort((a, b) => a.time - b.time || (Number(a.id) || 0) - (Number(b.id) || 0));
}

function emptyState(time) {
    return { time, principal: 0, unpaid: 0, earned: 0, paid: 0, contributed: 0, repaid: 0 };
}

export function createLoanValuer(loan, transactions) {
    const rate = getLoanAnnualRate(loan);
    const compound = loan?.interestMode === 'compound';
    const flows = loanFlows(loan?.symbol, transactions);

    const accrue = (state, time) => {
        const years = (time - state.time) / DAY_MS / YEAR_DAYS;
        if (years <= 0 || rate === 0) return { ...state, time: Math.max(state.time, time) };
        const interest = compound
            ? (state.principal + state.unpaid) * ((1 + rate) ** years - 1)
            : state.principal * rate * years;
        return { ...state, time, unpaid: state.unpaid + interest, earned: state.earned + interest };
    };

    const checkpoints = [];
    let state = emptyState(flows[0]?.time ?? 0);
    for (const flow of flows) {
        state = accrue(state, flow.time);
        if (flow.type === 'BUY' || flow.type === 'DEPOSIT') {
            state.principal += flow.units;
            state.contributed += flow.units;
        } else if (flow.type === 'SELL' || flow.type === 'WITHDRAW') {
            const returned = Math.min(flow.units, state.principal);
            state.principal -= returned;
            state.repaid += returned;
            if (flow.type === 'SELL') {
                const interest = Math.max(0, flow.cash - flow.units);
                state.paid += interest;
                state.unpaid = Math.max(0, state.unpaid - interest);
            }
        } else if (flow.type === 'INCOME') {
            state.paid += flow.cash;
            state.unpaid = Math.max(0, state.unpaid - flow.cash);
        }
        if (state.principal < EPSILON) state.principal = 0;
        checkpoints.push({ ...state });
    }

    const stateAt = (time) => {
        let low = 0;
        let high = checkpoints.length - 1;
        let match = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (checkpoints[mid].time <= time) {
                match = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        if (match < 0) return { ...emptyState(time), value: 0 };
        const accrued = accrue(checkpoints[match], time);
        return { ...accrued, value: accrued.principal + accrued.unpaid };
    };

    return {
        rate,
        compound,
        flows,
        firstTime: flows[0]?.time ?? null,
        stateAt
    };
}

function unitPrice(state) {
    return state.principal > EPSILON ? (state.principal + state.unpaid) / state.principal : null;
}

// Interest accrued over the last day on the current balance, i.e. the daily
// change with no disbursement or repayment in between.
function dailyAccrual(valuer, state) {
    if (valuer.rate === 0 || state.principal <= EPSILON) return 0;
    if (valuer.compound) return (state.principal + state.unpaid) * (1 - (1 + valuer.rate) ** (-1 / YEAR_DAYS));
    return state.principal * valuer.rate / YEAR_DAYS;
}

export function getLoanQuote(loan, transactions, now = Date.now()) {
    const valuer = createLoanValuer(loan, transactions);
    const state = valuer.stateAt(now);
    const price = unitPrice(state);
    if (price === null) return null;
    const accrual = dailyAccrual(valuer, state);
    const previousValue = state.value - accrual;
    return {
        symbol: loan.symbol,
        name: loan.name || loan.symbol,
        price,
        change: accrual / state.principal,
        changePercent: previousValue > EPSILON ? (accrual / previousValue) * 100 : 0,
        currency: loan.currency,
        quoteType: LOAN_QUOTE_TYPE,
        marketState: 'REGULAR',
        fetchedAt: now,
        marketTime: now,
        isStale: false
    };
}

function utcDay(time) {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Daily points (UTC midnight) from the first disbursement up to `to`, plus the
// exact `to` instant. `price` is per principal unit, `value` is the loan total.
export function buildLoanHistory(loan, transactions, { from = null, to = Date.now() } = {}) {
    const valuer = createLoanValuer(loan, transactions);
    if (valuer.firstTime === null || valuer.firstTime > to) return [];
    const points = [];
    let lastPrice = 1;
    const push = (time) => {
        const state = valuer.stateAt(time);
        const price = unitPrice(state);
        if (price !== null) lastPrice = price;
        points.push({ date: new Date(time).toISOString(), price: lastPrice, value: state.value, principal: state.principal });
    };
    const start = utcDay(Math.max(valuer.firstTime, from ?? valuer.firstTime));
    for (let time = start; time <= to; time += DAY_MS) push(time);
    if (points.length === 0 || Date.parse(points[points.length - 1].date) < to) push(to);
    return points;
}

export function getLoanSummary(loan, transactions, now = Date.now()) {
    const valuer = createLoanValuer(loan, transactions);
    const state = valuer.stateAt(now);
    const maturityTime = loan?.maturityDate ? Date.parse(loan.maturityDate) : NaN;
    const hasMaturity = Number.isFinite(maturityTime);
    const startTime = valuer.firstTime;
    let projection = null;
    if (hasMaturity && state.principal > EPSILON && maturityTime > now) {
        const atMaturity = valuer.stateAt(maturityTime);
        projection = {
            value: atMaturity.value,
            interest: atMaturity.unpaid,
            totalInterest: atMaturity.earned
        };
    }
    const termMs = hasMaturity && startTime !== null ? maturityTime - startTime : null;
    return {
        principal: state.principal,
        contributed: state.contributed,
        repaid: state.repaid,
        accrued: state.unpaid,
        earned: state.earned,
        paid: state.paid,
        value: state.value,
        dailyAccrual: dailyAccrual(valuer, state),
        annualRate: valuer.rate * 100,
        startDate: startTime === null ? null : new Date(startTime).toISOString(),
        maturityDate: hasMaturity ? new Date(maturityTime).toISOString() : null,
        daysToMaturity: hasMaturity ? Math.ceil((maturityTime - now) / DAY_MS) : null,
        termProgress: termMs && termMs > 0 ? Math.max(0, Math.min(1, (now - startTime) / termMs)) : null,
        isMatured: hasMaturity && now >= maturityTime,
        isClosed: state.principal <= EPSILON && state.contributed > 0,
        projection
    };
}

// Accrued interest a repayment on `date` would settle, before any payment.
export function getLoanAccruedAt(loan, transactions, date) {
    const time = Date.parse(date);
    if (!Number.isFinite(time)) return { principal: 0, accrued: 0 };
    const state = createLoanValuer(loan, transactions).stateAt(time);
    return { principal: state.principal, accrued: state.unpaid };
}

export function buildLoanQuoteMap(loans, transactions, now = Date.now()) {
    const quotes = {};
    for (const loan of loans || []) {
        const quote = getLoanQuote(loan, transactions, now);
        if (quote) quotes[String(loan.symbol).toUpperCase()] = quote;
    }
    return quotes;
}
