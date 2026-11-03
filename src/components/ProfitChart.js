'use client';

import { memo, useCallback, useMemo } from 'react';
import LineChart, { ChartPlaceholder } from './LineChart';
import { downsampleChartData } from '@/utils/chart-data';
import { getPeriodChange, toReturnSeries } from '@/utils/portfolio-history';

const HEIGHT = 280;

// The portfolio over the selected timeframe, as its total value or as the gain net of
// deposits. While a new timeframe loads the previous curve stays visible (dimmed)
// rather than flashing a skeleton. Callbacks carry the total value and the change
// for the selected mode, calculated before sampling so cash-flow times stay exact.
function ProfitChart({ data, mode = 'value', loading, timeframe, onScrub, onRangeSelect }) {
    const chartData = useMemo(() => {
        const indexed = data.map((point, sourceIndex) => ({ ...point, sourceIndex }));
        return downsampleChartData(mode === 'return' ? toReturnSeries(indexed) : indexed);
    }, [data, mode]);
    const handleScrub = useCallback((scrub) => {
        if (!scrub) return onScrub?.(null);
        const index = chartData[scrub.index].sourceIndex;
        onScrub?.({ ...scrub, point: data[index], change: getPeriodChange(data, mode, 0, index) });
    }, [data, chartData, mode, onScrub]);
    const handleRangeSelect = useCallback((range) => {
        if (!range) return onRangeSelect?.(null);
        const startIndex = chartData[range.startIndex].sourceIndex;
        const endIndex = chartData[range.endIndex].sourceIndex;
        onRangeSelect?.({
            ...range,
            start: data[startIndex],
            end: data[endIndex],
            change: getPeriodChange(data, mode, startIndex, endIndex)
        });
    }, [data, chartData, mode, onRangeSelect]);

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
