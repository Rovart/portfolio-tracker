export function getIconSources(symbol, type) {
    if (!symbol || /[\\/]/.test(symbol) || symbol.includes('..')) return [];
    // Clean symbol logic - remove trailing =X, =F, .X, =, .
    let cleanSym = symbol.toUpperCase().replace(/[=.](X|F)?$/, '').replace(/[=.]+$/, '');

    // Check if it's a crypto trading pair (e.g., ETH-EUR, BTC-USD)
    // Extract base symbol for crypto pairs
    let baseCryptoSym = null;
    if (cleanSym.includes('-')) {
        const parts = cleanSym.split('-');
        // The first part is typically the crypto (ETH-EUR -> ETH)
        baseCryptoSym = parts[0];
    }

    // Common cryptocurrencies for detection
    const COMMON_CRYPTO = [
        'BTC', 'ETH', 'SOL', 'USDT', 'USDC', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT',
        'MATIC', 'LINK', 'LTC', 'UNI', 'AVAX', 'SHIB', 'ATOM', 'TRX', 'ETC', 'XLM',
        'NEAR', 'APT', 'ARB', 'OP', 'FIL', 'ALGO', 'VET', 'ICP', 'AAVE', 'MKR',
        'GRT', 'SNX', 'CRV', 'LDO', 'SAND', 'MANA', 'AXS', 'FLOW', 'CHZ', 'ENJ',
        'XMR', 'DASH', 'ZEC', 'BCH', 'EOS', 'NEO', 'IOTA', 'COMP', 'YFI', 'SUSHI',
        'PEPE', 'WIF', 'BONK', 'FLOKI', 'RENDER', 'FET', 'INJ', 'SUI', 'SEI', 'TIA'
    ];

    // Determine if this is a crypto asset
    const isCrypto = type === 'CRYPTOCURRENCY' || type === 'crypto' ||
        COMMON_CRYPTO.includes(cleanSym) ||
        (baseCryptoSym && COMMON_CRYPTO.includes(baseCryptoSym));

    // Use base symbol for crypto lookups if it's a trading pair
    const cryptoLookupSym = baseCryptoSym || cleanSym;

    // Sources
    const fmpUrl = `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;
    const cryptoUrl = `https://assets.coincap.io/assets/icons/${cryptoLookupSym.toLowerCase()}@2x.png`;
    const cryptoCompareUrl = `https://www.cryptocompare.com/media/37746238/${cryptoLookupSym.toLowerCase()}.png`;

    return isCrypto ? [cryptoUrl, cryptoCompareUrl] : [fmpUrl, cryptoUrl];
}
