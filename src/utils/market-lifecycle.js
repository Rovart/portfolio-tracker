// A single activity source shared by the dashboard and asset details.
const serverState = { active: true, revision: 0 };
let state = serverState;
const listeners = new Set();
let stop;

export const getMarketActivity = () => state;
export const getServerMarketActivity = () => serverState;

export function startMarketActivity(onChange, { windowTarget, documentTarget, nativeApp, onResume }) {
    let stopped = false;
    let nativeActive = true;
    let nativeEventReceived = false;
    let active = !documentTarget.hidden;
    let handle;
    const update = (force = false) => {
        if (stopped) return;
        const next = !documentTarget.hidden && nativeActive;
        if (next === active && !force) return;
        const resumed = next && (!active || force);
        active = next;
        if (resumed) onResume();
        onChange(next, resumed);
    };
    const visible = () => update();
    const connected = () => update(true);
    documentTarget.addEventListener('visibilitychange', visible);
    windowTarget.addEventListener('online', connected);
    onChange(active, false);
    if (nativeApp) {
        Promise.resolve(nativeApp.addListener('appStateChange', event => {
            nativeEventReceived = true;
            nativeActive = event.isActive;
            update();
        })).then(listener => { if (stopped) listener.remove(); else handle = listener; }).catch(() => {});
        Promise.resolve(nativeApp.getState()).then(result => {
            if (!nativeEventReceived) { nativeActive = result.isActive; update(); }
        }).catch(() => {});
    }
    return () => {
        stopped = true;
        documentTarget.removeEventListener('visibilitychange', visible);
        windowTarget.removeEventListener('online', connected);
        handle?.remove();
    };
}

export function subscribeMarketActivity(listener) {
    listeners.add(listener);
    if (listeners.size === 1) {
        let disposed = false;
        let cleanup;
        const configure = async () => {
            const { Capacitor } = await import('@capacitor/core');
            const nativeApp = Capacitor.isNativePlatform() ? (await import('@capacitor/app')).App : null;
            const { clearFxCache } = await import('./fxCache.js');
            if (disposed) return;
            cleanup = startMarketActivity((active, resumed) => {
                state = { active, revision: state.revision + (resumed ? 1 : 0) };
                for (const notify of listeners) notify();
            }, { windowTarget: window, documentTarget: document, nativeApp, onResume: () => clearFxCache({ keepQuotes: true }) });
        };
        configure().catch(() => {});
        stop = () => { disposed = true; cleanup?.(); };
    }
    return () => {
        listeners.delete(listener);
        if (!listeners.size) { stop?.(); stop = null; }
    };
}
