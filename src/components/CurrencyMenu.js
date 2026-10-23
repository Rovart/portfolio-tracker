'use client';

import { ChevronDown } from 'lucide-react';
import PopoverMenu from './PopoverMenu';

// English names to match the rest of the interface ("Euro", "US Dollar").
const currencyNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'currency' })
    : null;

function currencyName(code) {
    try {
        return currencyNames?.of(code) || '';
    } catch {
        return '';
    }
}

// The display-currency picker in the dashboard header.
export default function CurrencyMenu({ currencies, value, onChange }) {
    const options = currencies.map(code => ({
        id: code,
        label: (
            <span className="currency-option">
                <span className="currency-option-code">{code}</span>
                <span className="currency-option-name">{currencyName(code)}</span>
            </span>
        )
    }));

    return (
        <PopoverMenu
            options={options}
            value={value}
            onChange={onChange}
            label="Display currency"
            title={`Display currency: ${currencyName(value) || value}`}
            triggerClassName="currency-button"
            menuClassName="is-currency"
            trigger={(
                <>
                    {value}
                    <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" className="currency-button-chevron" />
                </>
            )}
        />
    );
}
