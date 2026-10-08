'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ListFilter } from 'lucide-react';

export default function SortMenu({ options, value, onChange, label = 'Sort holdings' }) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const rootRef = useRef(null);
    const buttonRef = useRef(null);
    const itemRefs = useRef([]);
    const selectedLabel = options.find(option => option.id === value)?.label;

    useEffect(() => {
        if (!open) return;

        const selectedIndex = options.findIndex(option => option.id === value);
        itemRefs.current[Math.max(0, selectedIndex)]?.focus();

        const onPointerDown = event => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, options, value]);

    const handleMenuKeyDown = event => {
        const index = itemRefs.current.indexOf(document.activeElement);
        let nextIndex;
        if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
        else if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = options.length - 1;
        else return;
        event.preventDefault();
        itemRefs.current[nextIndex]?.focus();
    };

    return (
        <div
            ref={rootRef}
            className="sort-control"
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
        >
            <button
                ref={buttonRef}
                type="button"
                className="sort-button"
                aria-label={label}
                title={`${label}: ${selectedLabel || ''}`}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen(previous => !previous)}
                onKeyDown={event => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    setOpen(true);
                }}
            >
                <ListFilter size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {open && (
                <div id={menuId} role="menu" aria-label={label} className="sort-menu" onKeyDown={handleMenuKeyDown}>
                    {options.map((option, index) => (
                        <button
                            key={option.id}
                            ref={element => { itemRefs.current[index] = element; }}
                            type="button"
                            role="menuitemradio"
                            aria-checked={value === option.id}
                            className="sort-menu-item"
                            onClick={() => {
                                onChange(option.id);
                                setOpen(false);
                                buttonRef.current?.focus();
                            }}
                        >
                            {option.label}
                            {value === option.id && <Check size={15} aria-hidden="true" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
