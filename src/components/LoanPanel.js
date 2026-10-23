'use client';

import { useMemo, useState } from 'react';
import { AmountField, FormRow, KeyValueList, Money, Segmented, StatStrip, SwitchRow } from './ui';
import { calculateAssetAccounting, COMMON_FIAT_CURRENCIES } from '@/utils/portfolio-logic';
import { formatDate, formatMoney, formatPercent, MASK } from '@/utils/format';
import {
    createLoanSymbol,
    createLoanValuer,
    getLoanAccruedAt,
    getLoanSummary,
    LOAN_QUOTE_TYPE
} from '@/utils/loans';

const LOAN_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const TERM_PRESETS = [6, 12, 18, 24, 36];

export const LOAN_TRANSACTION_LABELS = {
    BUY: 'Principal',
    SELL: 'Repayment',
    INCOME: 'Interest',
    DEPOSIT: 'Principal',
    WITHDRAW: 'Write-off'
};

function todayKey() {
    return new Date().toISOString().split('T')[0];
}

function addMonths(dateKey, months) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().split('T')[0];
}

function monthsBetween(startKey, endKey) {
    if (!startKey || !endKey) return null;
    for (const months of TERM_PRESETS) {
        if (addMonths(startKey, months) === endKey) return months;
    }
    return null;
}

function SubmitButton({ label = 'Save' }) {
    return <button type="submit" className="btn btn-block">{label}</button>;
}

// "10,5 % estimated", plus "compound" when interest compounds.
export function loanRateLabel(loan, { withMode = false } = {}) {
    const rate = formatPercent(Number(loan?.annualRate) || 0, { signed: false, decimals: 2, minDecimals: 0 });
    const parts = [`${rate} ${loan?.rateType === 'estimated' ? 'estimated' : 'fixed'}`];
    if (withMode && loan?.interestMode === 'compound') parts.push('compound');
    return parts.join(' · ');
}

export function LoanRateText({ loan }) {
    return (
        <span title={loan?.rateType === 'estimated' ? 'Estimated annual return' : 'Fixed annual rate'}>
            {loanRateLabel(loan)}
        </span>
    );
}

// Value block above the loan chart. scrub: the point the user is pointing at
// on the chart ({ date, value } in base currency).
export function LoanValue({ loan, transactions, baseCurrency, fxRate, hideBalances, scrub = null }) {
    const summary = useMemo(() => getLoanSummary(loan, transactions), [loan, transactions]);
    const currency = loan.currency;
    const money = (value, options) => hideBalances ? MASK : formatMoney(value, currency, options);
    const valueBase = Number.isFinite(fxRate) && fxRate > 0 ? summary.value * fxRate : null;
    const showBase = currency !== baseCurrency && valueBase !== null;

    return (
        <div className="flex flex-col" style={{ gap: '4px' }}>
            <span className="label">{scrub ? formatDate(scrub.date) : 'Value today'}</span>
            <span className="hero-value" style={{ fontSize: '34px' }}>
                {scrub
                    ? <Money value={scrub.value} currency={baseCurrency} hidden={hideBalances} />
                    : <Money value={summary.value} currency={currency} hidden={hideBalances} />}
            </span>
            <div className="flex flex-wrap items-center" style={{ gap: '2px 10px', fontSize: 'var(--fs-sm)', visibility: scrub ? 'hidden' : undefined }}>
                <span className="delta-up font-medium">{money(summary.accrued, { signed: true })} accrued</span>
                {summary.dailyAccrual > 0 && <span className="label">{money(summary.dailyAccrual, { signed: true })} a day</span>}
                {showBase && <span className="label">≈ {hideBalances ? MASK : formatMoney(valueBase, baseCurrency)}</span>}
            </div>
        </div>
    );
}

// Term progress and the key figures in one band, below the loan chart.
// The rate and interest mode are in the view's subtitle (loanRateLabel).
export function LoanDetails({ loan, transactions, baseCurrency, hideBalances, realizedProfitBase }) {
    const summary = useMemo(() => getLoanSummary(loan, transactions), [loan, transactions]);
    const currency = loan.currency;
    const money = (value, options) => hideBalances ? MASK : formatMoney(value, currency, options);
    const progress = summary.termProgress ?? 0;

    return (
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
            {summary.maturityDate && (
                <div className="flex flex-col" style={{ gap: '8px' }}>
                    <div className="progress" role="progressbar" aria-label="Term elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
                    </div>
                    <div className="flex justify-between hint" style={{ gap: 'var(--space-2)' }}>
                        <span>{formatDate(summary.startDate)}</span>
                        <span className={summary.isMatured && !summary.isClosed ? 'delta-down' : undefined}>
                            {summary.isMatured
                                ? `Matured ${formatDate(summary.maturityDate)}${summary.isClosed ? '' : ' · still accruing'}`
                                : `${summary.daysToMaturity} days left · ${formatDate(summary.maturityDate)}`}
                        </span>
                    </div>
                </div>
            )}

            <StatStrip
                items={[
                    { label: 'Principal', value: money(summary.principal), sub: summary.repaid > 0 ? `${money(summary.repaid)} repaid` : null },
                    {
                        label: 'Interest paid',
                        value: money(summary.paid),
                        sub: currency !== baseCurrency && realizedProfitBase > 0 && !hideBalances ? `≈ ${formatMoney(realizedProfitBase, baseCurrency)}` : null
                    },
                    summary.projection
                        ? { label: 'At maturity', value: money(summary.projection.value), sub: `${money(summary.projection.interest, { signed: true })} interest` }
                        : { label: 'Interest earned', value: money(summary.earned) }
                ]}
            />
            {loan.notes && <p className="hint" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{loan.notes}</p>}
        </div>
    );
}

// Creates a loan (terms + first disbursement) or edits the terms of an existing one.
export function LoanForm({ loan = null, transactions = [], baseCurrency = 'USD', portfolios = [], currentPortfolioId = 'all', onSubmit, onCancel }) {
    const isEdit = !!loan;
    const regularPortfolios = portfolios.filter(p => !p.isWatchlist);
    const showPortfolioSelector = !isEdit && currentPortfolioId === 'all' && regularPortfolios.length > 1;
    const [portfolioId, setPortfolioId] = useState(regularPortfolios[0]?.id || 1);
    const [project, setProject] = useState(loan?.project || '');
    const [name, setName] = useState(loan?.name || '');
    const [amount, setAmount] = useState('');
    const [currency, setCurrency] = useState(loan?.currency || (COMMON_FIAT_CURRENCIES.includes(baseCurrency) ? baseCurrency : 'EUR'));
    const [annualRate, setAnnualRate] = useState(loan?.annualRate ?? '');
    const [rateType, setRateType] = useState(loan?.rateType || 'fixed');
    const [interestMode, setInterestMode] = useState(loan?.interestMode || 'simple');
    const [startDate, setStartDate] = useState(todayKey());
    const [maturityDate, setMaturityDate] = useState(loan?.maturityDate ? loan.maturityDate.split('T')[0] : addMonths(todayKey(), 12));
    const [notes, setNotes] = useState(loan?.notes || '');
    const [deductCash, setDeductCash] = useState(false);
    const [error, setError] = useState('');

    const existingStart = useMemo(() => {
        if (!loan) return null;
        const valuer = createLoanValuer(loan, transactions);
        return valuer.firstTime === null ? null : new Date(valuer.firstTime).toISOString().split('T')[0];
    }, [loan, transactions]);
    const effectiveStart = isEdit ? existingStart : startDate;
    const selectedTerm = monthsBetween(effectiveStart, maturityDate);

    const currencyOptions = useMemo(() => (
        Array.from(new Set([currency, baseCurrency, ...LOAN_CURRENCIES].filter(code => COMMON_FIAT_CURRENCIES.includes(code))))
    ), [currency, baseCurrency]);

    const cashBalance = useMemo(() => (
        calculateAssetAccounting(transactions, currency, baseCurrency).currentBalance
    ), [transactions, currency, baseCurrency]);

    // What the terms produce, so the user can check them before saving.
    const preview = useMemo(() => {
        const rate = parseFloat(annualRate);
        if (!Number.isFinite(rate) || rate < 0) return null;
        const draft = { symbol: 'LOAN:PREVIEW', annualRate: rate, interestMode };
        const previewTransactions = isEdit
            ? transactions.filter(tx => tx.baseCurrency === loan.symbol).map(tx => ({ ...tx, baseCurrency: draft.symbol }))
            : [{ id: 0, type: 'BUY', baseCurrency: draft.symbol, baseAmount: parseFloat(amount) || 0, date: `${startDate}T00:00:00.000Z` }];
        const principal = isEdit ? null : parseFloat(amount);
        if (!isEdit && !(principal > 0)) return null;
        const valuer = createLoanValuer(draft, previewTransactions);
        if (valuer.firstTime === null) return null;
        const maturityTime = maturityDate ? Date.parse(`${maturityDate}T00:00:00.000Z`) : NaN;
        const yearTime = valuer.firstTime + 365 * 86400000;
        const atMaturity = Number.isFinite(maturityTime) ? valuer.stateAt(maturityTime) : null;
        const atYear = valuer.stateAt(yearTime);
        return { atMaturity, yearlyInterest: atYear.earned };
    }, [annualRate, interestMode, amount, startDate, maturityDate, isEdit, loan, transactions]);

    const handleSubmit = (event) => {
        event.preventDefault();
        setError('');
        const rate = parseFloat(annualRate);
        const principal = parseFloat(amount);
        if (!name.trim()) return setError('Give the loan a name.');
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setError('Enter an annual rate between 0 and 100%.');
        if (!isEdit && !(principal > 0)) return setError('Enter the amount lent.');
        if (maturityDate && effectiveStart && maturityDate <= effectiveStart) return setError('Maturity must be after the start date.');

        const terms = {
            name: name.trim(),
            project: project.trim(),
            annualRate: rate,
            rateType,
            interestMode,
            maturityDate: maturityDate ? `${maturityDate}T00:00:00.000Z` : null,
            notes: notes.trim() || null
        };

        if (isEdit) {
            onSubmit(terms);
            return;
        }

        const symbol = createLoanSymbol();
        onSubmit({
            ...terms,
            symbol,
            currency,
            portfolioId: showPortfolioSelector ? portfolioId : undefined
        }, {
            type: 'BUY',
            date: `${startDate}T00:00:00.000Z`,
            baseCurrency: symbol,
            baseAmount: principal,
            quoteAmount: principal,
            quoteCurrency: currency,
            exchange: 'MANUAL',
            originalType: LOAN_QUOTE_TYPE,
            fee: 0,
            feeCurrency: null,
            affectsFiatBalance: deductCash,
            affectsQuoteBalance: deductCash,
            notes: null
        });
    };

    const displayCurrency = isEdit ? loan.currency : currency;

    return (
        <form onSubmit={handleSubmit} className="form-stack">
            {!isEdit && (
                <AmountField
                    id="loan-amount"
                    label="Amount lent"
                    value={amount}
                    onChange={setAmount}
                    autoFocus
                    unit={(
                        <select
                            aria-label="Loan currency"
                            className="amount-unit-select"
                            value={currency}
                            onChange={e => setCurrency(e.target.value)}
                        >
                            {currencyOptions.map(code => <option key={code} value={code}>{code}</option>)}
                        </select>
                    )}
                />
            )}

            <div className="form-list">
                {showPortfolioSelector && (
                    <FormRow label="Portfolio" htmlFor="loan-portfolio">
                        <select id="loan-portfolio" className="form-input" value={portfolioId} onChange={e => setPortfolioId(parseInt(e.target.value))}>
                            {regularPortfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </FormRow>
                )}
                <FormRow label="Name" htmlFor="loan-name">
                    <input id="loan-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Required" required />
                </FormRow>
                <FormRow label="Project" htmlFor="loan-project">
                    <input id="loan-project" className="form-input" value={project} onChange={e => setProject(e.target.value)} placeholder="Optional" />
                </FormRow>
                <FormRow label="Annual rate" htmlFor="loan-rate">
                    <input id="loan-rate" type="number" step="any" min="0" max="100" inputMode="decimal" className="form-input" value={annualRate} onChange={e => setAnnualRate(e.target.value)} placeholder="0" required />
                    <span className="form-suffix">%</span>
                </FormRow>
                <FormRow label="Rate">
                    <Segmented variant="compact" ariaLabel="Rate" value={rateType} onChange={setRateType} options={[{ id: 'fixed', label: 'Fixed' }, { id: 'estimated', label: 'Estimated' }]} />
                </FormRow>
                <FormRow label="Interest">
                    <Segmented variant="compact" ariaLabel="Interest" value={interestMode} onChange={setInterestMode} options={[{ id: 'simple', label: 'Simple' }, { id: 'compound', label: 'Compound' }]} />
                </FormRow>
                {!isEdit && (
                    <FormRow label="Start" htmlFor="loan-start">
                        <input id="loan-start" type="date" required className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    </FormRow>
                )}
                <FormRow label="Maturity" htmlFor="loan-maturity">
                    <input id="loan-maturity" type="date" className="form-input" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} />
                </FormRow>
                {effectiveStart && (
                    <FormRow label="Term">
                        <div className="flex flex-wrap" style={{ gap: '4px 14px', justifyContent: 'flex-end' }}>
                            {TERM_PRESETS.map(months => (
                                <button
                                    key={months}
                                    type="button"
                                    onClick={() => setMaturityDate(addMonths(effectiveStart, months))}
                                    className="chip"
                                    aria-pressed={selectedTerm === months}
                                    aria-label={`${months} months`}
                                >
                                    {months}m
                                </button>
                            ))}
                        </div>
                    </FormRow>
                )}
                {!isEdit && (
                    <SwitchRow
                        checked={deductCash}
                        onChange={setDeductCash}
                        label={`Pay from ${currency} cash`}
                        hint={cashBalance > 0 ? `${formatMoney(cashBalance, currency)} available` : null}
                    />
                )}
                <div className="form-row">
                    <textarea aria-label="Notes" className="form-input" value={notes} onChange={e => setNotes(e.target.value)} rows={notes.includes('\n') ? 3 : 1} placeholder="Notes: collateral, contract, payout schedule" />
                </div>
            </div>

            {preview && (
                <section aria-label={rateType === 'estimated' ? 'Estimated return' : 'Expected return'}>
                    <h3 className="label" style={{ margin: 0 }}>{rateType === 'estimated' ? 'Estimated return' : 'Expected return'}</h3>
                    <KeyValueList
                        rows={[
                            preview.atMaturity && {
                                label: 'At maturity',
                                value: formatMoney(preview.atMaturity.value, displayCurrency),
                                sub: `${formatMoney(preview.atMaturity.unpaid, displayCurrency, { signed: true })} ${isEdit ? 'pending interest' : 'interest'}`
                            },
                            { label: 'First year', value: `${formatMoney(preview.yearlyInterest, displayCurrency, { signed: true })}` }
                        ]}
                    />
                </section>
            )}

            {isEdit && <p className="hint" style={{ margin: 0 }}>The amount and start date are edited from the principal entry in History.</p>}
            {error && <div className="form-error" role="alert">{error}</div>}

            <SubmitButton label={isEdit ? 'Save terms' : 'Add loan'} />
        </form>
    );
}

// Interest payments, repayments and additional principal for one loan.
export function LoanTransactionForm({ loan, existingTx = null, transactions, onSave, onCancel }) {
    const currency = loan.currency;
    const [type, setType] = useState(existingTx?.type && existingTx.type !== 'DEPOSIT' ? existingTx.type : 'INCOME');
    const [date, setDate] = useState(existingTx?.date ? new Date(existingTx.date).toISOString().split('T')[0] : todayKey());
    const [principal, setPrincipal] = useState(existingTx && existingTx.type !== 'INCOME' ? String(existingTx.baseAmount ?? '') : '');
    const [cash, setCash] = useState(existingTx ? String(existingTx.type === 'SELL'
        ? Math.max(0, (existingTx.quoteAmount || 0) - (existingTx.baseAmount || 0))
        : existingTx.quoteAmount ?? '') : '');
    const [cashEdited, setCashEdited] = useState(!!existingTx);
    const [principalEdited, setPrincipalEdited] = useState(!!existingTx);
    const [affectsCash, setAffectsCash] = useState(existingTx ? !!(existingTx.affectsQuoteBalance ?? existingTx.affectsFiatBalance) : true);
    const [notes, setNotes] = useState(existingTx?.notes || '');
    const [error, setError] = useState('');

    // Ledger without the edited entry: what was outstanding on the chosen date.
    const otherTransactions = useMemo(() => (
        existingTx ? transactions.filter(tx => tx.id !== existingTx.id) : transactions
    ), [transactions, existingTx]);
    const position = useMemo(() => getLoanAccruedAt(loan, otherTransactions, `${date}T00:00:00.000Z`), [loan, otherTransactions, date]);

    const suggestedPrincipal = type === 'SELL' ? position.principal : 0;
    const suggestedInterest = position.accrued;
    const principalValue = principalEdited ? principal : (type === 'SELL' ? String(Math.round(suggestedPrincipal * 100) / 100) : principal);
    const cashValue = cashEdited || type === 'BUY' ? cash : String(Math.round(suggestedInterest * 100) / 100);

    const handleSubmit = (event) => {
        event.preventDefault();
        setError('');
        const units = parseFloat(principalValue) || 0;
        const interest = parseFloat(cashValue) || 0;
        if (units < 0 || interest < 0) return setError('Amounts cannot be negative.');
        if (type === 'BUY' && !(units > 0)) return setError('Enter the principal added.');
        if (type === 'INCOME' && !(interest > 0)) return setError('Enter the interest received.');
        if (type === 'SELL') {
            if (!(units > 0) && !(interest > 0)) return setError('Enter the principal returned.');
            if (units > position.principal + 0.005) return setError(`At most ${formatMoney(position.principal, currency)} was outstanding on that date.`);
        }

        const amounts = type === 'INCOME'
            ? { baseAmount: 0, quoteAmount: interest }
            : type === 'SELL'
                ? { baseAmount: units, quoteAmount: units + interest }
                : { baseAmount: units, quoteAmount: units };

        onSave({
            ...(existingTx || {}),
            id: existingTx?.id || Math.random().toString(36).substr(2, 9),
            date: `${date}T00:00:00.000Z`,
            type,
            baseCurrency: loan.symbol,
            ...amounts,
            quoteCurrency: currency,
            exchange: existingTx?.exchange || 'MANUAL',
            originalType: LOAN_QUOTE_TYPE,
            fee: 0,
            feeCurrency: null,
            affectsFiatBalance: affectsCash,
            affectsQuoteBalance: affectsCash,
            portfolioId: existingTx?.portfolioId || loan.portfolioId,
            notes: notes.trim() || null
        });
    };

    const totalReceived = (parseFloat(principalValue) || 0) + (parseFloat(cashValue) || 0);

    const isIncome = type === 'INCOME';
    const amountValue = isIncome ? cashValue : principalValue;
    const setAmountValue = (value) => {
        if (isIncome) {
            setCash(value);
            setCashEdited(true);
        } else {
            setPrincipal(value);
            setPrincipalEdited(true);
        }
    };
    const interestDiffers = cashEdited && Math.abs((parseFloat(cashValue) || 0) - suggestedInterest) > 0.005;

    return (
        <form onSubmit={handleSubmit} className="form-stack">
            <Segmented
                variant="tabs"
                ariaLabel="Entry type"
                value={type}
                onChange={(next) => { setType(next); setPrincipalEdited(false); if (!existingTx) setCashEdited(false); }}
                options={[
                    { id: 'INCOME', label: 'Interest' },
                    { id: 'SELL', label: 'Repayment' },
                    { id: 'BUY', label: 'Add principal' }
                ]}
            />

            <AmountField
                id="loan-tx-amount"
                label={isIncome ? 'Interest received' : type === 'SELL' ? 'Principal returned' : 'Principal added'}
                value={amountValue}
                onChange={setAmountValue}
                unit={currency}
                meta={isIncome ? (
                    <>
                        <span>{formatMoney(suggestedInterest, currency)} accrued on this date</span>
                        {interestDiffers && <button type="button" className="btn-text" style={{ minHeight: 0, fontSize: 'var(--fs-sm)' }} onClick={() => setCashEdited(false)}>Use it</button>}
                    </>
                ) : type === 'SELL' && position.principal > 0 && Math.abs((parseFloat(principalValue) || 0) - position.principal) > 0.005 ? (
                    <button type="button" className="btn-text" style={{ minHeight: 0, fontSize: 'var(--fs-sm)' }} onClick={() => { setPrincipal(String(Math.round(position.principal * 100) / 100)); setPrincipalEdited(true); }}>
                        All {formatMoney(position.principal, currency)}
                    </button>
                ) : null}
            />

            <div className="form-list">
                {type === 'SELL' && (
                    <FormRow
                        label="Interest included"
                        htmlFor="loan-tx-interest"
                        hint={interestDiffers ? `${formatMoney(suggestedInterest, currency)} accrued` : null}
                    >
                        <input id="loan-tx-interest" type="number" step="any" min="0" inputMode="decimal" className="form-input" value={cashValue} onChange={e => { setCash(e.target.value); setCashEdited(true); }} placeholder="0" />
                        <span className="form-suffix">{currency}</span>
                    </FormRow>
                )}
                <FormRow label="Date" htmlFor="loan-tx-date">
                    <input id="loan-tx-date" type="date" required className="form-input" value={date} onChange={e => setDate(e.target.value)} />
                </FormRow>
                <SwitchRow
                    checked={affectsCash}
                    onChange={setAffectsCash}
                    label={type === 'BUY' ? `Pay from ${currency} cash` : `Add to ${currency} cash`}
                />
                <div className="form-row">
                    <textarea aria-label="Note" className="form-input" value={notes} onChange={e => setNotes(e.target.value)} rows={1} placeholder="Add a note" />
                </div>
            </div>

            {type === 'SELL' && totalReceived > 0 && (
                <KeyValueList rows={[{ label: 'Total received', value: formatMoney(totalReceived, currency) }]} />
            )}

            {error && <div className="form-error" role="alert">{error}</div>}
            <SubmitButton />
        </form>
    );
}
