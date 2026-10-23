'use client';

import { ListFilter } from 'lucide-react';
import PopoverMenu from './PopoverMenu';

export default function SortMenu({ options, value, onChange, label = 'Sort holdings' }) {
    const selectedLabel = options.find(option => option.id === value)?.label;
    return (
        <PopoverMenu
            options={options}
            value={value}
            onChange={onChange}
            label={label}
            title={`${label}: ${selectedLabel || ''}`}
            trigger={<ListFilter size={17} strokeWidth={1.8} aria-hidden="true" />}
        />
    );
}
