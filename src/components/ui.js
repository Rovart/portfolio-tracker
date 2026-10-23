'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { changeTone, formatMoney, formatPercent, MASK, splitMoney } from '@/utils/format';

function prefersReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Tweens a figure from its previous value instead of jumping to the new one.
export function useAnimatedNumber(target, duration = 320) {
    const [state, setState] = useState({ target, from: target, value: target });
    if (state.target !== target) {
        const from = Number.isFinite(state.value) && Number.isFinite(target) ? state.value : target;
        setState({ target, from, value: from });
    }

    const { from } = state;
    useEffect(() => {
        if (from === target || !Number.isFinite(target)) return;
        const reduced = prefersReducedMotion();
        const start = performance.now();
        let frame;
        const step = now => {
            const progress = reduced ? 1 : Math.min(1, (now - start) / duration);
            const value = progress === 1 ? target : from + (target - from) * (1 - (1 - progress) ** 3);
            setState(current => current.target === target ? { ...current, value } : current);
            if (progress < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [from, target, duration]);

    return state.value;
}

// Text options with an underline that slides to the selection.
// variant: 'tabs' (full width over a hairline), 'fill' (full width) or 'compact' (inline).
export function Segmented({ options, value, onChange, ariaLabel, variant = 'fill', activeColor, className = '', style }) {
    const rootRef = useRef(null);
    const indicatorRef = useRef(null);
    const activeIndex = options.findIndex(option => option.id === value);

    useLayoutEffect(() => {
        const root = rootRef.current;
        const indicator = indicatorRef.current;
        if (!root || !indicator) return;
        const place = () => {
            const label = root.querySelectorAll('.segmented-label')[activeIndex];
            if (!label) {
                indicator.style.width = '0px';
                return;
            }
            const rootBox = root.getBoundingClientRect();
            const labelBox = label.getBoundingClientRect();
            indicator.style.width = `${labelBox.width}px`;
            indicator.style.transform = `translateX(${labelBox.left - rootBox.left}px)`;
        };
        place();
        // Slide only after the first placement, so it never animates in from the left edge.
        // (A data attribute React does not manage, so re-renders keep it.)
        const frame = requestAnimationFrame(() => { indicator.dataset.ready = 'true'; });
        const observer = new ResizeObserver(place);
        observer.observe(root);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, [activeIndex, options.length]);

    return (
        <div
            ref={rootRef}
            role="radiogroup"
            aria-label={ariaLabel}
            className={`segmented${variant === 'tabs' ? ' is-tabs' : variant === 'compact' ? ' is-compact' : ''} ${className}`}
            style={activeColor ? { ...style, '--segmented-active': activeColor } : style}
        >
            {options.map(option => (
                <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={option.id === value}
                    className="segmented-option"
                    onClick={() => onChange(option.id)}
                >
                    <span className="segmented-label">{option.label}</span>
                </button>
            ))}
            <span ref={indicatorRef} className="segmented-indicator" aria-hidden="true" />
        </div>
    );
}

export function SwitchRow({ checked, onChange, label, hint }) {
    return (
        <button type="button" role="switch" aria-checked={checked} className="form-row" onClick={() => onChange(!checked)}>
            <span className="flex flex-col flex-1 min-w-0" style={{ gap: '2px' }}>
                <span>{label}</span>
                {hint && <span className="hint">{hint}</span>}
            </span>
            <span className={`switch${checked ? ' is-on' : ''}`} aria-hidden="true" />
        </button>
    );
}

// A settings-style row: label on the left, the control right-aligned.
export function FormRow({ label, htmlFor, children, hint }) {
    return (
        <div className="form-row">
            <label className="form-row-label flex flex-col" htmlFor={htmlFor} style={{ gap: '2px' }}>
                <span>{label}</span>
                {hint && <span className="hint">{hint}</span>}
            </label>
            <div className="form-row-control">{children}</div>
        </div>
    );
}

// The large, borderless amount at the top of an entry form.
export function AmountField({ id, value, onChange, unit, meta, autoFocus = false, label }) {
    return (
        <div className="amount-field">
            <label htmlFor={id} className="label">{label}</label>
            <div className="amount-input-row">
                <input
                    id={id}
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    className="amount-input"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder="0"
                    autoFocus={autoFocus}
                    size={Math.max(1, String(value || '0').length)}
                />
                {unit && <span className="amount-unit">{unit}</span>}
            </div>
            <div className="amount-meta">{meta}</div>
        </div>
    );
}

export function KeyValueList({ rows, twoColumn = false }) {
    return (
        <dl className={`kv-list${twoColumn ? ' is-two-column' : ''}`}>
            {rows.filter(Boolean).map(row => (
                <div key={row.label} className="kv-row">
                    <dt>{row.label}</dt>
                    <dd className={row.tone || undefined}>
                        {row.value}
                        {row.sub && <span className={`kv-sub${row.subTone ? ` ${row.subTone}` : ''}`}>{row.sub}</span>}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

// A few key figures side by side in one compact band. An item with onClick
// becomes a button (e.g. to cycle what it shows).
export function StatStrip({ items }) {
    const visible = items.filter(Boolean);
    if (visible.length === 0) return null;
    return (
        <div className="stat-strip">
            {visible.map(item => {
                const content = (
                    <>
                        <span className="stat-strip-label">{item.label}</span>
                        <span className={`stat-strip-value${item.tone ? ` ${item.tone}` : ''}`}>{item.value}</span>
                        {item.sub && <span className={`stat-strip-sub${item.subTone ? ` ${item.subTone}` : ''}`}>{item.sub}</span>}
                    </>
                );
                return item.onClick ? (
                    <button key={item.id || item.label} type="button" className="stat-strip-item" onClick={item.onClick} aria-label={item.ariaLabel}>
                        {content}
                    </button>
                ) : (
                    <div key={item.id || item.label} className="stat-strip-item">{content}</div>
                );
            })}
        </div>
    );
}

// Integer part prominent, decimals and currency receding.
export function Money({ value, currency, signed = false, hidden = false, className = '' }) {
    if (hidden) return <span className={className}>{MASK}</span>;
    const { major, minor } = splitMoney(value, currency, { signed });
    return (
        <span className={className}>
            {major}
            {minor && <span className="minor">{minor}</span>}
        </span>
    );
}

export function AnimatedMoney({ value, ...props }) {
    const animated = useAnimatedNumber(value);
    return <Money value={animated} {...props} />;
}

export function Delta({ value, percent, currency, hidden = false, className = '' }) {
    const tone = changeTone(Number.isFinite(value) ? value : percent);
    const pct = Number.isFinite(percent) ? formatPercent(percent) : null;
    return (
        <span className={`${tone} ${className}`}>
            {hidden || !Number.isFinite(value) ? pct : `${formatMoney(value, currency, { signed: true })}${pct ? ` (${pct})` : ''}`}
        </span>
    );
}

export function Stat({ label, value, sub, align = 'left', valueClassName = '' }) {
    return (
        <div className="flex flex-col min-w-0" style={{ alignItems: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', textAlign: align, gap: '2px' }}>
            <span className="label">{label}</span>
            <span className={`stat-value ${valueClassName}`}>{value}</span>
            {sub && <span className="hint">{sub}</span>}
        </div>
    );
}
