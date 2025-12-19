'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export default function PullToRefresh({ onRefresh, children, disabled = false }) {
    const [pulling, setPulling] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const containerRef = useRef(null);
    const startY = useRef(0);
    const currentY = useRef(0);
    const startedAtTop = useRef(false); // Track if touch started at top

    const THRESHOLD = 80; // Distance needed to trigger refresh
    const MAX_PULL = 120; // Maximum visual pull distance

    const handleTouchStart = useCallback((e) => {
        // Don't allow pull if disabled
        if (disabled) return;

        // Only allow pull if we're exactly at the top of the page
        const isAtTop = window.scrollY <= 0;
        startedAtTop.current = isAtTop;

        if (isAtTop) {
            startY.current = e.touches[0].clientY;
            setPulling(true);
        }
    }, [disabled]);

    const handleTouchMove = useCallback((e) => {
        // Must have started at top AND still be at top
        if (!pulling || refreshing || !startedAtTop.current) return;

        // If user scrolled away from top, cancel the pull
        if (window.scrollY > 0) {
            setPullDistance(0);
            setPulling(false);
            return;
        }

        currentY.current = e.touches[0].clientY;
        const delta = currentY.current - startY.current;

        // Only pull down, not up
        if (delta > 0) {
            // Apply resistance to make it feel more natural
            const distance = Math.min(delta * 0.5, MAX_PULL);
            setPullDistance(distance);

            // Prevent default scroll when pulling
            if (distance > 10) {
                e.preventDefault();
            }
        } else {
            // User is scrolling up, cancel the pull
            setPullDistance(0);
        }
    }, [pulling, refreshing]);

    const handleTouchEnd = useCallback(async () => {
        if (!pulling) return;

        if (pullDistance >= THRESHOLD && !refreshing) {
            setRefreshing(true);
            setPullDistance(50); // Hold at a smaller distance while refreshing

            try {
                await onRefresh();
            } catch (e) {
                console.error('Refresh failed:', e);
            }

            setRefreshing(false);
        }

        setPulling(false);
        setPullDistance(0);
    }, [pulling, pullDistance, refreshing, onRefresh]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener('touchstart', handleTouchStart, { passive: true });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        container.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
        };
    }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

    const progress = Math.min(pullDistance / THRESHOLD, 1);
    const rotation = progress * 180;

    return (
        <div ref={containerRef} style={{ minHeight: '100%' }}>
            {/* Pull indicator */}
            <div
                style={{
                    position: 'fixed',
                    top: `calc(env(safe-area-inset-top, 0px) + ${pullDistance - 40}px)`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 1000,
                    opacity: pullDistance > 10 ? 1 : 0,
                    transition: pulling ? 'none' : 'all 0.3s ease-out',
                    pointerEvents: 'none'
                }}
            >
                <div
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255,255,255,0.1)'
                    }}
                >
                    {refreshing ? (
                        <div
                            style={{
                                width: 18,
                                height: 18,
                                border: '2px solid rgba(255,255,255,0.2)',
                                borderTopColor: 'white',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite'
                            }}
                        />
                    ) : (
                        <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                                transform: `rotate(${rotation}deg)`,
                                transition: pulling ? 'none' : 'transform 0.3s ease-out'
                            }}
                        >
                            <path d="M12 5v14M5 12l7-7 7 7" />
                        </svg>
                    )}
                </div>
            </div>

            {/* Content with pull offset */}
            <div
                style={{
                    transform: `translateY(${pullDistance}px)`,
                    transition: pulling ? 'none' : 'transform 0.3s ease-out'
                }}
            >
                {children}
            </div>
        </div>
    );
}
