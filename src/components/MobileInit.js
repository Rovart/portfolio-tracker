'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export default function MobileInit() {
    useEffect(() => {
        async function initMobile() {
            if (Capacitor.isNativePlatform()) {
                // Add class to body for mobile-specific CSS
                document.body.classList.add('native-app');

                // Configure status bar
                try {
                    await StatusBar.setStyle({ style: Style.Dark });
                    await StatusBar.setBackgroundColor({ color: '#000000' });
                    await StatusBar.setOverlaysWebView({ overlay: false });
                } catch (e) {
                    console.log('StatusBar plugin not available:', e);
                }
            }
        }
        initMobile();
    }, []);

    return null;
}
