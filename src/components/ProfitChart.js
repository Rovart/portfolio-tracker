'use client';

import { memo, useCallback, useMemo } from 'react';
import LineChart, { ChartPlaceholder } from './LineChart';
import { downsampleChartData } from '@/utils/chart-data';
import { getPeriodReturn, toReturnSeries } from '@/utils/portfolio-history';

const HEIGHT = 280;

// The portfolio over the selected timeframe, as its total value or as the gain net of
// deposits. While a new timeframe loads the previous curve stays visible (dimmed)
// rather than flashing a skeleton. Scrub and range callbacks always carry the total
// value and the gain net of deposits for the span shown, whichever line is drawn.
function ProfitChart({ data, mode = 'value', loading, timeframe, onScrub, onRangeSelect }) {
    const chartData = useMemo(() => downsampleChartData(mode === 'return' ? toReturnSeries(data) : data), [data, mode]);
    const totals = useMemo(() => (
        mode === 'return' ? chartData.map(point => ({ ...point, value: point.total })) : chartData
    ), [chartData, mode]);
    const handleScrub = useCallback((scrub) => {
        onScrub?.(scrub && { ...scrub, point: totals[scrub.index], change: getPeriodReturn(totals, 0, scrub.index) });
    }, [totals, onScrub]);
    const handleRangeSelect = useCallback((range) => {
        onRangeSelect?.(range && {
            ...range,
            start: totals[range.startIndex],
            end: totals[range.endIndex],
            change: getPeriodReturn(totals, range.startIndex, range.endIndex)
        });
    }, [totals, onRangeSelect]);

    if (chartData.length === 0) {
        return loading
            ? <ChartPlaceholder height={HEIGHT} />
            : <ChartPlaceholder height={HEIGHT} message="Add a transaction to see your portfolio history" />;
    }

    const first = chartData[0];
    // Colour describes the line drawn: a rising line is never red.
    const trendUp = chartData[chartData.length - 1].value >= first.value;

    return (
        <LineChart
            data={chartData}
            height={HEIGHT}
            color={trendUp ? 'var(--success)' : 'var(--danger)'}
            baseline={first.value}
            stale={loading}
            transitionKey={`${timeframe}-${mode}`}
            ariaLabel={mode === 'return' ? 'Portfolio return over time' : 'Portfolio value over time'}
            onScrub={handleScrub}
            onRangeSelect={handleRangeSelect}
        />
    );
}

export default memo(ProfitChart);
