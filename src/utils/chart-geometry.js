// Pure geometry for the SVG line charts: points are spaced by index (market
// closures leave no gaps) and values map linearly onto the plot height.

export function getValueDomain(values, padding = 0.08) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
    }
    if (!Number.isFinite(min)) return [0, 1];
    const span = max - min || Math.abs(max) * 0.02 || 1;
    return [min - span * padding, max + span * padding];
}

export function createScales({ count, width, height, domain, padX = 6, padTop = 10, padBottom = 10 }) {
    const innerWidth = Math.max(1, width - padX * 2);
    const innerHeight = Math.max(1, height - padTop - padBottom);
    const [min, max] = domain;
    const span = max - min || 1;
    const last = Math.max(1, count - 1);
    return {
        x: index => padX + (count > 1 ? (index / last) * innerWidth : innerWidth / 2),
        y: value => padTop + ((max - value) / span) * innerHeight,
        indexAt: px => Math.max(0, Math.min(count - 1, Math.round(((px - padX) / innerWidth) * last))),
        bottom: height - padBottom
    };
}

const round = value => Math.round(value * 100) / 100;

// `offset` places a slice of the series (e.g. a selected range) at its original index.
export function buildLinePath(points, scales, offset = 0) {
    let path = '';
    for (let i = 0; i < points.length; i++) {
        const value = points[i].value;
        if (!Number.isFinite(value)) continue;
        path += `${path ? 'L' : 'M'}${round(scales.x(offset + i))} ${round(scales.y(value))}`;
    }
    return path;
}

export function buildAreaPath(points, scales) {
    const line = buildLinePath(points, scales);
    if (!line || points.length < 2) return '';
    return `${line}L${round(scales.x(points.length - 1))} ${round(scales.bottom)}L${round(scales.x(0))} ${round(scales.bottom)}Z`;
}
