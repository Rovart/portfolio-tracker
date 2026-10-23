'use client';

import { memo, useCallback, useMemo } from 'react';
import LineChart, { ChartPlaceholder } from './LineChart';
import { downsampleChartData } from '@/utils/chart-data';
import { getPeriodReturn } from '@/utils/portfolio-history';

const HEIGHT = 280;

// Portfolio value over the selected timeframe. While a new timeframe loads the
// previous curve stays visible (dimmed) rather than flashing a skeleton.
// Scrub and range callbacks carry the gain net of deposits for the span shown.
function ProfitChart({ data, loading, timeframe, onScrub, onRangeSelect }) {
    const chartData = useMemo(() => downsampleChartData(data), [data]);
    const handleScrub = useCallback((scrub) => {
        onScrub?.(scrub && { ...scrub, change: getPeriodReturn(chartData, 0, scrub.index) });
    }, [chartData, onScrub]);
    const handleRangeSelect = useCallback((range) => {
        onRangeSelect?.(range && { ...range, change: getPeriodReturn(chartData, range.startIndex, range.endIndex) });
    }, [chartData, onRangeSelect]);

    if (chartData.length === 0) {
        return loading
            ? <ChartPlaceholder height={HEIGHT} />
            : <ChartPlaceholder height={HEIGHT} message="Add a transaction to see your portfolio history" />;
    }

    const first = chartData[0];
    // Colour follows the gain, not deposits.
    const trendUp = getPeriodReturn(chartData).diff >= 0;

    return (
        <LineChart
            data={chartData}
            height={HEIGHT}
            color={trendUp ? 'var(--success)' : 'var(--danger)'}
            baseline={first.value}
            stale={loading}
            transitionKey={timeframe}
            ariaLabel="Portfolio value over time"
            onScrub={handleScrub}
            onRangeSelect={handleRangeSelect}
        />
    );
}

export default memo(ProfitChart);
