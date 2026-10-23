'use client';

// Selection ticks while scrubbing a chart. Native only: the web has no
// equivalent worth the noise, so every call is a silent no-op there.
let hapticsPromise = null;
let lastTick = 0;
const MIN_TICK_INTERVAL_MS = 35;

function loadHaptics() {
    if (!hapticsPromise) {
        hapticsPromise = (async () => {
            try {
                const { Capacitor } = await import('@capacitor/core');
                if (!Capacitor.isNativePlatform()) return null;
                const { Haptics } = await import('@capacitor/haptics');
                return Haptics;
            } catch {
                return null;
            }
        })();
    }
    return hapticsPromise;
}

export function scrubStart() {
    loadHaptics().then(haptics => haptics?.selectionStart().catch(() => {}));
}

export function scrubTick() {
    const now = Date.now();
    if (now - lastTick < MIN_TICK_INTERVAL_MS) return;
    lastTick = now;
    loadHaptics().then(haptics => haptics?.selectionChanged().catch(() => {}));
}

export function scrubEnd() {
    loadHaptics().then(haptics => haptics?.selectionEnd().catch(() => {}));
}
