'use client';

export default function QuoteTime({ fetchedAt, marketTime, isStale }) {
    const time = marketTime ? Date.parse(marketTime) : fetchedAt;
    if (!Number.isFinite(time) || time <= 0) return null;
    const date = new Date(time);
    return <span className="text-muted" style={{ fontSize: '0.65rem' }} title={`${marketTime ? 'Market quote' : 'Retrieved'}: ${date.toLocaleString()}`}>
        {isStale ? 'Saved · ' : ''}{marketTime ? 'Quote' : 'Updated'} {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>;
}
