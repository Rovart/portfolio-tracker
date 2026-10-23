// Locale-aware number formatting shared by every screen, so amounts always show
// two decimals, a real currency symbol and a typographic sign.

export const MASK = '••••••';

const formatters = new Map();

function getFormatter(locale, options) {
    const key = `${locale || ''}|${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, options);
        formatters.set(key, formatter);
    }
    return formatter;
}

// Intl accepts any three-letter code; anything else (USDT, 1INCH…) is shown as a suffix.
function isCurrencyCode(currency) {
    return /^[A-Z]{3}$/.test(String(currency || ''));
}

function moneyOptions(currency, { signed, decimals }) {
    const digits = decimals ?? 2;
    return {
        ...(isCurrencyCode(currency) ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' } : {}),
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        // Spanish and Polish skip the separator below 10,000 ("3643,82 €" next to "10.289,73 €").
        useGrouping: 'always',
        signDisplay: signed ? 'exceptZero' : 'auto'
    };
}

function withSuffix(text, currency) {
    return isCurrencyCode(currency) || !currency ? text : `${text} ${currency}`;
}

export function formatMoney(value, currency, { signed = false, decimals, locale } = {}) {
    if (!Number.isFinite(value)) return '—';
    const code = String(currency || '').toUpperCase();
    return withSuffix(getFormatter(locale, moneyOptions(code, { signed, decimals })).format(value), code);
}

// Company-sized figures in the locale's own short scale ("3,9 B $", "62 mil M $", "$62.4B").
export function formatCompactMoney(value, currency, { locale } = {}) {
    if (!Number.isFinite(value)) return '—';
    const code = String(currency || '').toUpperCase();
    const options = {
        ...(isCurrencyCode(code) ? { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' } : {}),
        notation: 'compact',
        maximumFractionDigits: 1
    };
    return withSuffix(getFormatter(locale, options).format(value), code);
}

// Unit prices keep enough precision for low-priced assets (0.000123 $).
export function formatPrice(value, currency, { locale } = {}) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const decimals = abs === 0 || abs >= 1 ? 2 : Math.min(8, Math.max(4, 1 - Math.floor(Math.log10(abs)) + 2));
    return formatMoney(value, currency, { decimals, locale });
}

// { major, minor } lets the integer part stand out and the decimals and symbol recede.
export function splitMoney(value, currency, { signed = false, locale } = {}) {
    if (!Number.isFinite(value)) return { major: '—', minor: '' };
    const code = String(currency || '').toUpperCase();
    const parts = getFormatter(locale, moneyOptions(code, { signed })).formatToParts(value);
    const decimalIndex = parts.findIndex(part => part.type === 'decimal');
    const lastNumberIndex = parts.reduce((last, part, index) => ['integer', 'group', 'fraction', 'decimal'].includes(part.type) ? index : last, -1);
    const cut = decimalIndex >= 0 ? decimalIndex : lastNumberIndex + 1;
    // A currency symbol in front stays with the integer; one after it recedes with the decimals.
    const major = parts.slice(0, cut).map(part => part.value).join('');
    const minor = parts.slice(cut).map(part => part.value).join('');
    return { major, minor: !isCurrencyCode(code) && code ? `${minor} ${code}` : minor };
}

export function formatPercent(value, { signed = true, decimals = 2, minDecimals = decimals, locale } = {}) {
    if (!Number.isFinite(value)) return '—';
    return getFormatter(locale, {
        style: 'percent',
        minimumFractionDigits: minDecimals,
        maximumFractionDigits: decimals,
        signDisplay: signed ? 'exceptZero' : 'auto'
    }).format(value / 100);
}

export function formatQuantity(value, { maxDecimals = 8, locale } = {}) {
    if (!Number.isFinite(value)) return '—';
    return getFormatter(locale, { maximumFractionDigits: maxDecimals, useGrouping: 'always' }).format(value);
}

export function formatDate(date, { withTime = false, withYear = true, locale } = {}) {
    const time = typeof date === 'number' ? date : Date.parse(date);
    if (!Number.isFinite(time)) return '—';
    return new Date(time).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        ...(withYear ? { year: 'numeric' } : {}),
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
    });
}

export function changeTone(value) {
    if (!Number.isFinite(value) || value === 0) return 'delta-flat';
    return value > 0 ? 'delta-up' : 'delta-down';
}
