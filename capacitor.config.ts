import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.portfolio.tracker',
  appName: 'Portfolio Tracker',
  webDir: 'out',
  server: {
    // For development, point to local Next.js server
    // url: 'http://localhost:3000',
    // cleartext: true
  },
  ios: {
    contentInset: 'automatic'
  },
  android: {
    backgroundColor: '#0a0a0a'
  }
};

export default config;
