// Toggle this to switch between Symbol and Short Name
const DISPLAY_NAME = false; // true = Name, false = Symbol

export default function HoldingsList({ holdings, onSelect, loading, hideBalances, baseCurrency }) {
    return (
        <div className="flex flex-col gap-1">
            <h2 className="text-xl">Holdings</h2>
            {holdings.map((holding) => (
                <div
                    key={holding.asset}
                    className="card flex justify-between items-center"
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect(holding)}
                >
                    <div className="flex-1 flex flex-col min-w-0 pr-2">
                        <span className="text-base sm:text-lg font-bold truncate">
                            {DISPLAY_NAME ? holding.name : holding.asset}
                        </span>
                        <span className="text-[10px] sm:text-xs text-muted truncate">
                            {loading ? (
                                <span className="inline-block w-24 h-3 bg-white-10 rounded animate-pulse" />
                            ) : (
                                <>
                                    {hideBalances ? '••••' : holding.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} | {holding.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {baseCurrency === 'USD' ? '$' : baseCurrency}
                                </>
                            )}
                        </span>
                    </div>

                    <div className="flex flex-col items-end shrink-0" style={{ textAlign: 'right' }}>
                        <span className="text-base sm:text-lg font-bold">
                            {loading ? (
                                <div className="w-24 sm:w-32 h-6 bg-white-10 rounded animate-pulse ml-auto" />
                            ) : (
                                hideBalances ? '••••••' : `${holding.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency === 'USD' ? '$' : baseCurrency}`
                            )}
                        </span>
                        <span className={`text-[10px] sm:text-sm font-medium ${holding.change24h >= 0 ? 'text-success' : 'text-danger'}`}>
                            {loading ? (
                                <div className="w-16 sm:w-20 h-4 bg-white-10 rounded animate-pulse mt-1 ml-auto" />
                            ) : (
                                <>
                                    {hideBalances ? '' : `${holding.dailyPnl >= 0 ? '+' : '-'}${Math.abs(holding.dailyPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${baseCurrency === 'USD' ? '$' : baseCurrency} `}
                                    ({holding.change24h >= 0 ? '+' : ''}{holding.change24h.toFixed(2)}%)
                                </>
                            )}
                        </span>
                    </div>
                </div>
            ))}
            {holdings.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-10 opacity-60">
                    <p className="text-sm">No assets yet.</p>
                    <p className="text-[10px] uppercase tracking-widest font-bold">Start adding assets</p>
                </div>
            )}
        </div>
    );
}
