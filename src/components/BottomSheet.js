'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Module-level registry of open sheets so back-gesture handlers (Capacitor)
// can close the topmost sheet without any browser-history involvement.
const sheetStack = [];

export function closeTopSheet() {
    const top = sheetStack[sheetStack.length - 1];
    if (top) {
        top();
        return true;
    }
    return false;
}

export function hasOpenSheet() {
    return sheetStack.length > 0;
}

// Shared bottom sheet: slides up, drags down to dismiss (grabber + header),
// closes on backdrop tap. Registers itself so back gestures close it first.
export default function BottomSheet({ title, subtitle, onClose, children, maxWidth = 640 }) {
    const backdropRef = useRef(null);
    const sheetRef = useRef(null);
    const dragState = useRef({ active: false, startY: 0, startTime: 0, dy: 0 });
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const DISMISS_DISTANCE = 130;   // px dragged before it dismisses on release
    const DISMISS_VELOCITY = 0.55;  // px/ms flick velocity that dismisses regardless of distance

    useEffect(() => {
        const close = () => onCloseRef.current?.();
        sheetStack.push(close);
        return () => {
            const idx = sheetStack.indexOf(close);
            if (idx !== -1) sheetStack.splice(idx, 1);
        };
    }, []);

    const setSheetTransform = (dy) => {
        if (sheetRef.current) {
            sheetRef.current.style.transform = dy > 0 ? `translateY(${dy}px)` : 'translateY(0)';
        }
        if (backdropRef.current) {
            const progress = Math.min(Math.max(dy, 0) / 400, 1);
            backdropRef.current.style.opacity = String(1 - progress * 0.6);
        }
    };

    const handleDragStart = (e) => {
        // Never hijack taps on interactive controls
        if (e.target.closest('button, select, input, textarea, a')) return;
        dragState.current = { active: true, startY: e.clientY, startTime: Date.now(), dy: 0 };
        if (sheetRef.current) sheetRef.current.style.transition = 'none';
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
    };

    const handleDragMove = (e) => {
        const s = dragState.current;
        if (!s.active) return;
        let dy = e.clientY - s.startY;
        if (dy < 0) dy = dy / 4; // damped upward resistance
        s.dy = dy;
        setSheetTransform(dy);
    };

    const handleDragEnd = () => {
        const s = dragState.current;
        if (!s.active) return;
        s.active = false;
        const elapsed = Math.max(Date.now() - s.startTime, 1);
        const velocity = s.dy / elapsed;

        if (sheetRef.current) {
            sheetRef.current.style.transition = 'transform 260ms var(--ease-drawer)';
        }

        if (s.dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
            if (sheetRef.current) sheetRef.current.style.transform = 'translateY(100%)';
            if (backdropRef.current) backdropRef.current.style.opacity = '0';
            setTimeout(() => onCloseRef.current?.(), 200);
        } else {
            setSheetTransform(0);
        }
    };

    return (
        <div
            ref={backdropRef}
            className="animate-overlay"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.6)'
            }}
        >
            <div
                ref={sheetRef}
                className="animate-sheet"
                style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: `${maxWidth}px`,
                    maxHeight: '92dvh',
                    backgroundColor: 'var(--background-elevated)',
                    display: 'flex',
                    flexDirection: 'column',
                    borderTopLeftRadius: '20px',
                    borderTopRightRadius: '20px',
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-overlay)',
                    border: '1px solid var(--border)',
                    borderBottom: 'none',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)'
                }}
            >
                {/* Draggable header: grabber + title + close */}
                <div
                    onPointerDown={handleDragStart}
                    onPointerMove={handleDragMove}
                    onPointerUp={handleDragEnd}
                    onPointerCancel={handleDragEnd}
                    style={{ flexShrink: 0, cursor: 'grab', touchAction: 'none', padding: '8px 16px 10px 20px', borderBottom: '1px solid var(--border)' }}
                >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                        <div style={{ width: '36px', height: '4px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.16)' }} />
                    </div>
                    <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)' }}>
                        <div className="flex flex-col min-w-0" style={{ gap: '1px' }}>
                            <span className="modal-title truncate">{title}</span>
                            {subtitle && <span className="label truncate">{subtitle}</span>}
                        </div>
                        <button type="button" onClick={onClose} aria-label="Close" className="icon-button">
                            <X size={18} />
                        </button>
                    </div>
                </div>
                <div
                    className="flex-1 overflow-y-auto"
                    style={{ minHeight: 0, padding: 'var(--space-5) var(--space-5) var(--space-6)', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
