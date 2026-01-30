// Commodity symbol to name mapping
export const COMMODITY_NAMES = {
    'GC=F': 'Gold',
    'SI=F': 'Silver',
    'HG=F': 'Copper',
    'CL=F': 'Crude Oil',
    'NG=F': 'Natural Gas',
    'BZ=F': 'Brent Oil',
    'ZW=F': 'Wheat',
    'ZC=F': 'Corn',
    'ZS=F': 'Soybeans',
    'KC=F': 'Coffee',
    'CT=F': 'Cotton',
    'SB=F': 'Sugar',
    'CC=F': 'Cocoa',
    // Without =F suffix
    'GC': 'Gold',
    'SI': 'Silver',
    'HG': 'Copper',
    'CL': 'Crude Oil',
    'NG': 'Natural Gas',
    'BZ': 'Brent Oil',
    'ZW': 'Wheat',
    'ZC': 'Corn',
    'ZS': 'Soybeans',
    'KC': 'Coffee',
    'CT': 'Cotton',
    'SB': 'Sugar',
    'CC': 'Cocoa'
};

/**
 * Get display name for an asset
 * @param {string} symbol - Asset symbol (e.g., 'GC=F', 'AAPL')
 * @param {string} name - Original name from data source
 * @returns {string} Display name
 */
export function getAssetDisplayName(symbol, name) {
    if (!symbol) return name || 'Unknown';
    
    // Check if it's a commodity
    const commodityName = COMMODITY_NAMES[symbol];
    if (commodityName) {
        return commodityName;
    }
    
    // Return original name or symbol
    return name || symbol;
}

/**
 * Check if symbol is a commodity
 * @param {string} symbol - Asset symbol
 * @returns {boolean}
 */
export function isCommodity(symbol) {
    if (!symbol) return false;
    return !!COMMODITY_NAMES[symbol];
}

/**
 * Format symbol for display by trimming currency/exchange suffixes
 * - ETH-USD -> ETH
 * - 03452.HK -> 03452
 * - AAPL -> AAPL (unchanged)
 * @param {string} symbol - Asset symbol
 * @param {string} name - Asset name (for numeric tickers)
 * @returns {string} Formatted display symbol
 */
export function formatSymbol(symbol, name) {
    if (!symbol) return name || 'Unknown';
    
    // Check if it's a commodity first
    if (isCommodity(symbol)) {
        return COMMODITY_NAMES[symbol];
    }
    
    // Handle Yahoo Finance currency pairs (EURUSD=X, etc.)
    if (symbol.endsWith('=X')) {
        const base = symbol.replace('=X', '');
        // For pairs like EURUSD=X, extract first 3 chars
        if (base.length >= 6) {
            return base.substring(0, 3);
        }
        return base;
    }
    
    // Split by - or . to separate base from currency/exchange
    const parts = symbol.split(/[-\.]/);
    
    if (parts.length > 1) {
        const base = parts[0];
        const suffix = parts[parts.length - 1];
        
        // Check if suffix looks like a currency (3 chars, all letters)
        const isCurrency = suffix.length === 3 && /^[A-Z]{3}$/i.test(suffix);
        
        // Check if suffix looks like an exchange (2 chars, all letters, or known exchanges)
        const knownExchanges = ['HK', 'DE', 'MI', 'PA', 'AS', 'MC', 'L', 'TO', 'T', 'SS', 'SZ', 'BO', 'NS'];
        const isExchange = knownExchanges.includes(suffix.toUpperCase()) || 
                          (suffix.length === 2 && /^[A-Z]{2}$/i.test(suffix));
        
        if (isCurrency || isExchange) {
            // If base is purely numeric, use name if available
            if (/^\d+$/.test(base) && name) {
                return name;
            }
            return base;
        }
    }
    
    // If symbol is purely numeric and has a name, use the name
    if (/^\d+$/.test(symbol) && name) {
        return name;
    }
    
    return symbol;
}