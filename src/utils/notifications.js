
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export async function checkPermissions() {
    try {
        if (!Capacitor.isPluginAvailable('LocalNotifications')) {
            if (typeof Notification !== 'undefined') {
                return Notification.permission === 'granted';
            }
            return false;
        }
        const status = await LocalNotifications.checkPermissions();
        return status.display === 'granted' || status.notifications === 'granted';
    } catch (e) {
        console.error('Error checking permissions:', e);
        return false;
    }
}

export async function requestPermissions() {
    try {
        console.log('Requesting notification permissions...');

        // Native path
        if (Capacitor.isNativePlatform()) {
            const status = await LocalNotifications.requestPermissions();
            console.log('Native permission status:', status);
            return status.display === 'granted' || status.notifications === 'granted';
        }

        // Browser fallback
        if (typeof Notification !== 'undefined') {
            console.log('Using browser Notification API fallback...');
            const res = await Notification.requestPermission();
            console.log('Browser permission result:', res);
            return res === 'granted';
        }

        return false;
    } catch (e) {
        console.error('Error requesting permissions:', e);
        return false;
    }
}

export async function scheduleDailyNotifications(timeStr, portfolios) {
    try {
        await cancelAllNotifications();

        if (!timeStr || !portfolios || portfolios.length === 0) return true;

        const [hours, minutes] = timeStr.split(':').map(Number);

        const notifications = portfolios
            .filter(p => p.id && p.id !== 'all')
            .map((p, index) => ({
                id: index + 1,
                title: `Daily Summary: ${p.name}`,
                body: `📈 Tap to see how ${p.name} is performing today!`,
                schedule: {
                    on: { hour: hours, minute: minutes },
                    allowWhileIdle: true,
                    every: 'day'
                },
                extra: { portfolioId: p.id }
            }));

        if (notifications.length > 0) {
            await LocalNotifications.schedule({ notifications });
            console.log(`Scheduled ${notifications.length} daily notifications for ${timeStr}`);
        }

        return true;
    } catch (e) {
        console.error('Error scheduling notifications:', e);
        return false;
    }
}

export async function scheduleTestNotification() {
    try {
        await LocalNotifications.schedule({
            notifications: [{
                id: 999,
                title: 'Portfolio Tracker 🚀',
                body: 'Notifications are working! You will receive daily summaries at your scheduled time.',
                schedule: { at: new Date(Date.now() + 1000) }
            }]
        });
        return true;
    } catch (e) {
        console.error('Test notification failed:', e);
        return false;
    }
}

export async function cancelAllNotifications() {
    try {
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
            await LocalNotifications.cancel(pending);
        }
    } catch (e) {
        console.error('Error canceling notifications:', e);
    }
}
