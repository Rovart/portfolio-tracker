/**
 * App Configuration
 * Central configuration for Monetra Portfolio Tracker
 */

export const APP_CONFIG = {
    // App Information
    name: 'Monetra',
    fullName: 'Monetra - Portfolio Tracker',
    description: 'Simplest way to track your investment portfolio',
    version: '0.1.2',

    // Data Controller / Legal
    legal: {
        dataController: {
            name: 'Roberto Carlos Solis Garcia',
            email: 'enquiriesroberto@myneuronal.com',
        },
        service: 'Monetra - Portfolio Tracker',
        lastUpdated: '2025-12-28',
    },

    // External Links
    links: {
        github: 'https://github.com/Rovart/portfolio-tracker',
        website: 'https://portfolio-tracker-xi-three.vercel.app/',
        privacy: '/privacy',
        terms: '/terms',
    },

    // Features (for reference in privacy policy and documentation)
    features: {
        multiPortfolio: true,
        multiCurrency: true,
        transactionTracking: true,
        csvImportExport: true,
        performanceCharts: true,
        localStorageOnly: true,
        privacyMode: true,
    },

    // Data Storage Info
    storage: {
        type: 'IndexedDB',
        location: 'Local Device Only',
        syncEnabled: false,
    },
};

export default APP_CONFIG;
