export default function HoldingsList({ holdings, onSelect }) {
    return (
        <div className="flex flex-col gap-4">
            <h2 className="text-xl">Holdings</h2>
            {holdings.map((holding) => (
                <div
                    key={holding.asset}
                    className="card flex justify-between items-center"
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect(holding)}
                >
                    <div className="flex-1 flex flex-col min-w-0">
                        <span className="text-lg font-bold truncate">{holding.asset}</span>
                        <span className="text-xs text-muted truncate">
                            {holding.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} • ${holding.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                    </div>

                    <div className="flex-1 flex flex-col items-end" style={{ textAlign: 'right' }}>
                        <span className="text-lg font-bold">
                            ${holding.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-sm font-medium ${holding.change24h >= 0 ? 'text-success' : 'text-danger'}`}>
                            {holding.dailyPnl >= 0 ? '+' : '-'}${Math.abs(holding.dailyPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({holding.change24h >= 0 ? '+' : ''}{holding.change24h.toFixed(2)}%)
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
}
