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