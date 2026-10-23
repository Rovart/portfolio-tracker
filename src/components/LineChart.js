'use client';

import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildAreaPath, buildLinePath, createScales, getValueDomain } from '@/utils/chart-geometry';
import { scrubEnd, scrubStart, scrubTick } from '@/utils/haptics';

const EMPTY_MARKERS = [];

// Lightweight SVG line chart shared by the portfolio and asset views.
// - Hover (mouse) or a horizontal drag (touch) scrubs: onScrub({ index, point }) / null.
// - Mouse drag or two fingers select a range: onRangeSelect({ start, end, ... }) / null.
// - `stale` dims the current series while a new one loads instead of a skeleton.
// - Changing `transitionKey` (e.g. the range) fades the new series in.
function LineChart({
    data,
    height = 240,
    color = 'var(--foreground)',
    baseline = null,
    markers = EMPTY_MARKERS,
    stale = false,
    showLastPoint = true,
    transitionKey,
    ariaLabel,
    onScrub,
    onRangeSelect
}) {
    const containerRef = useRef(null);
    const pointersRef = useRef(new Map());
    const dragRef = useRef(null);
    const [width, setWidth] = useState(0);
    // Interaction state remembers its series (transitionKey): a new range clears it
    // without an effect, while live updates of the same range keep it.
    const [hover, setHover] = useState(null);
    const [selection, setSelection] = useState(null);
    const gradientId = `line-fill-${useId().replace(/:/g, '')}`;

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const update = () => setWidth(element.clientWidth);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        // Two fingers select a range; keep the page from scrolling meanwhile.
        const blockTwoFingerScroll = event => {
            if (event.touches.length >= 2 && event.cancelable) event.preventDefault();
        };
        element.addEventListener('touchmove', blockTwoFingerScroll, { passive: false });
        return () => {
            observer.disconnect();
            element.removeEventListener('touchmove', blockTwoFingerScroll);
        };
    }, []);

    const geometry = useMemo(() => {
        if (!width || !data?.length) return null;
        const domain = getValueDomain(data.map(point => point.value));
        const scales = createScales({ count: data.length, width, height, domain });
        return { scales, line: buildLinePath(data, scales), area: buildAreaPath(data, scales) };
    }, [data, width, height]);

    const count = data?.length || 0;
    const hoverIndex = hover?.key === transitionKey && hover.index < count ? hover.index : null;
    const activeSelection = selection?.key === transitionKey && selection.end < count ? selection : null;

    // Optional access: the compiler memoizes on these paths, and geometry is null before layout.
    const scales = geometry?.scales ?? null;
    const indexAt = clientX => {
        const rect = containerRef.current.getBoundingClientRect();
        return scales ? scales.indexAt(clientX - rect.left) : 0;
    };

    const showHover = (index) => {
        if (index === hoverIndex) return;
        setHover(index === null ? null : { index, key: transitionKey });
        onScrub?.(index === null ? null : { index, point: data[index] });
    };

    const select = (a, b) => {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        if (start === end) return;
        setSelection({ start, end, key: transitionKey });
        onRangeSelect?.({ startIndex: start, endIndex: end, start: data[start], end: data[end] });
    };

    const clearSelection = () => {
        if (!activeSelection) return;
        setSelection(null);
        onRangeSelect?.(null);
    };

    const handlePointerDown = (event) => {
        if (!geometry) return;
        pointersRef.current.set(event.pointerId, event.clientX);

        if (event.pointerType === 'mouse') {
            if (event.button !== 0) return;
            const index = indexAt(event.clientX);
            dragRef.current = { pointerId: event.pointerId, startIndex: index, moved: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            return;
        }

        if (pointersRef.current.size >= 2) {
            const [first, second] = [...pointersRef.current.values()];
            showHover(null);
            select(indexAt(first), indexAt(second));
            return;
        }

        // A touch scrubs once it moves sideways; a vertical swipe keeps scrolling.
        clearSelection();
    };

    const handlePointerMove = (event) => {
        if (!geometry) return;
        if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, event.clientX);
        const index = indexAt(event.clientX);

        if (event.pointerType !== 'mouse' && pointersRef.current.size >= 2) {
            const [first, second] = [...pointersRef.current.values()];
            select(indexAt(first), indexAt(second));
            return;
        }

        const drag = dragRef.current;
        if (event.pointerType === 'mouse' && drag && (event.buttons & 1)) {
            if (index !== drag.startIndex) {
                drag.moved = true;
                showHover(null);
                select(drag.startIndex, index);
            }
            return;
        }

        if (event.pointerType === 'mouse') {
            if (!activeSelection) showHover(index);
            return;
        }
        if (!pointersRef.current.has(event.pointerId)) return;
        if (hoverIndex === null) scrubStart();
        else if (index !== hoverIndex) scrubTick();
        showHover(index);
    };

    const handlePointerEnd = (event) => {
        pointersRef.current.delete(event.pointerId);
        if (event.pointerType === 'mouse') {
            const drag = dragRef.current;
            dragRef.current = null;
            if (drag && !drag.moved) clearSelection();
            return;
        }
        if (pointersRef.current.size === 0 && hoverIndex !== null) {
            scrubEnd();
            showHover(null);
        }
    };

    const handlePointerLeave = (event) => {
        if (event.pointerType === 'mouse' && !dragRef.current) showHover(null);
    };

    const lastIndex = data?.length ? data.length - 1 : 0;

    return (
        <div
            ref={containerRef}
            className="line-chart no-select"
            style={{ height }}
            role="img"
            aria-label={ariaLabel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onPointerLeave={handlePointerLeave}
        >
            {geometry && (
                <svg width={width} height={height} className={`line-chart-svg${stale ? ' is-stale' : ''}`}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" style={{ stopColor: color, stopOpacity: 0.14 }} />
                            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
                        </linearGradient>
                    </defs>
                    <g key={transitionKey} className="line-chart-series">
                        {Number.isFinite(baseline) && (
                            <line className="line-chart-baseline" x1="0" x2={width} y1={scales.y(baseline)} y2={scales.y(baseline)} />
                        )}
                        <path d={geometry.area} fill={`url(#${gradientId})`} />
                        <path d={geometry.line} fill="none" style={{ stroke: color }} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
                    </g>

                    {activeSelection && (
                        <g>
                            <rect className="line-chart-dim" x="0" y="0" width={scales.x(activeSelection.start)} height={height} />
                            <rect className="line-chart-dim" x={scales.x(activeSelection.end)} y="0" width={Math.max(0, width - scales.x(activeSelection.end))} height={height} />
                            <path
                                d={buildLinePath(data.slice(activeSelection.start, activeSelection.end + 1), scales, activeSelection.start)}
                                fill="none"
                                style={{ stroke: 'var(--foreground)' }}
                                strokeWidth="2"
                                strokeLinejoin="round"
                            />
                            {[activeSelection.start, activeSelection.end].map(index => (
                                <line key={index} className="line-chart-cursor" x1={scales.x(index)} x2={scales.x(index)} y1="0" y2={height} />
                            ))}
                        </g>
                    )}

                    {!activeSelection && markers.map((marker, index) => (
                        <circle
                            key={marker.id ?? `marker-${index}`}
                            className="line-chart-marker"
                            cx={scales.x(marker.x)}
                            cy={scales.y(marker.y)}
                            r="4.5"
                            style={{ stroke: marker.isBuy ? 'var(--success)' : 'var(--danger)' }}
                        >
                            {marker.title && <title>{marker.title}</title>}
                        </circle>
                    ))}

                    {showLastPoint && hoverIndex === null && !activeSelection && (
                        <circle cx={scales.x(lastIndex)} cy={scales.y(data[lastIndex].value)} r="3" style={{ fill: color }} />
                    )}

                    {hoverIndex !== null && (
                        <g pointerEvents="none">
                            <line className="line-chart-cursor" x1={scales.x(hoverIndex)} x2={scales.x(hoverIndex)} y1="0" y2={height} />
                            <circle cx={scales.x(hoverIndex)} cy={scales.y(data[hoverIndex].value)} r="4" strokeWidth="2" style={{ fill: color, stroke: 'var(--background)' }} />
                        </g>
                    )}
                </svg>
            )}
        </div>
    );
}

export default memo(LineChart);

export function ChartPlaceholder({ height = 240, message = null }) {
    return (
        <div className="chart-placeholder no-select" style={{ height }} aria-busy={!message}>
            {message ? <span>{message}</span> : <div className="chart-placeholder-line" />}
        </div>
    );
}
