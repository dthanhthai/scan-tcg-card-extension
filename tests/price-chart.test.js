import { describe, it, expect } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// constants.js first, then price-chart.js — the order scanner.html uses.
loadExtensionScripts('utils/price-chart.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-26');
const daysAgo = (days) => NOW - days * DAY_MS;

// Shapes as the scrapers emit them: both in [timestampMs, priceCents].
const pricechartingChartData = {
  used: [[Date.parse('2026-07-01'), 62], [Date.parse('2026-08-01'), 66], [Date.parse('2026-09-01'), 74]],
  new: [[Date.parse('2026-07-01'), 1100]],
};
const tcgplayerChartData = {
  variant: 'Holofoil',
  points: [[Date.parse('2026-08-30'), 67], [Date.parse('2026-09-06'), 74]],
};

describe('buildPriceChartSeries', () => {
  it('draws PriceCharting Ungraded and the TCGPlayer printing', () => {
    const series = buildPriceChartSeries(pricechartingChartData, tcgplayerChartData);

    expect(series.map((entry) => entry.label)).toEqual([
      'PriceCharting (Ungraded)',
      'TCGPlayer (Holofoil)',
    ]);
    expect(series[0].points).toBe(pricechartingChartData.used);
    expect(series[1].points).toBe(tcgplayerChartData.points);
    expect(series[0].color).not.toBe(series[1].color);
  });

  it('adds Collectr as a third line, after TCGPlayer', () => {
    const collectrChartData = { variant: 'Holofoil', points: [[Date.parse('2026-09-26'), 77]] };

    const series = buildPriceChartSeries(pricechartingChartData, tcgplayerChartData, collectrChartData);

    expect(series.map((entry) => entry.label)).toEqual([
      'PriceCharting (Ungraded)',
      'TCGPlayer (Holofoil)',
      'Collectr (Holofoil)',
    ]);
    expect(new Set(series.map((entry) => entry.color)).size).toBe(3);
  });

  it('draws Collectr on its own when the other marketplaces have no data', () => {
    const series = buildPriceChartSeries(null, null, { variant: null, points: [[1, 100]] });

    expect(series.map((entry) => entry.label)).toEqual(['Collectr']);
  });

  it('labels TCGPlayer without a variant when the API omitted one', () => {
    const series = buildPriceChartSeries(null, { variant: null, points: [[1, 100]] });

    expect(series).toHaveLength(1);
    expect(series[0].label).toBe('TCGPlayer');
  });

  it('ignores a PriceCharting payload without the Ungraded series', () => {
    // Cards key Ungraded as "used"; a payload with only graded series must not be
    // drawn under the Ungraded label.
    const series = buildPriceChartSeries({ new: [[1, 100]] }, null);

    expect(series).toEqual([]);
  });

  it('returns nothing when neither source has data', () => {
    expect(buildPriceChartSeries(null, null)).toEqual([]);
    expect(buildPriceChartSeries({}, { points: [] })).toEqual([]);
  });
});

describe('filterPointsByPeriod', () => {
  const points = [
    [daysAgo(0), 100],
    [daysAgo(92), 90],
    [daysAgo(184), 80],
    [daysAgo(365), 70],
  ];

  it('keeps only the points inside the window', () => {
    expect(filterPointsByPeriod(points, 90, NOW).map((point) => point[1])).toEqual([100]);
    expect(filterPointsByPeriod(points, 180, NOW).map((point) => point[1])).toEqual([100, 90]);
    expect(filterPointsByPeriod(points, 365, NOW)).toHaveLength(4);
  });

  it('keeps everything when no period is selected', () => {
    expect(filterPointsByPeriod(points, 0, NOW)).toHaveLength(4);
    expect(filterPointsByPeriod(points, undefined, NOW)).toHaveLength(4);
  });

  it('does not mutate the input and tolerates a missing series', () => {
    const kept = filterPointsByPeriod(points, 90, NOW);

    expect(points).toHaveLength(4);
    expect(kept).not.toBe(points);
    expect(filterPointsByPeriod(null, 90, NOW)).toEqual([]);
  });
});

describe('computeYBounds', () => {
  it('rounds the axis to a nice step around the data', () => {
    // 62..74 cents → a step of 5 → 60..75.
    expect(computeYBounds([{ points: [[0, 62], [1, 74]] }])).toEqual({ min: 60, max: 75, ticks: [60, 65, 70, 75] });
  });

  it('widens a flat series so the line is not pinned to the axis', () => {
    const bounds = computeYBounds([{ points: [[0, 100], [1, 100]] }]);

    expect(bounds.min).toBeLessThan(100);
    expect(bounds.max).toBeGreaterThan(100);
  });

  it('spans every series', () => {
    const bounds = computeYBounds([
      { points: [[0, 62], [1, 74]] },
      { points: [[0, 1100]] },
    ]);

    expect(bounds.max).toBeGreaterThanOrEqual(1100);
  });

  it('returns null when there is no data', () => {
    expect(computeYBounds([])).toBeNull();
    expect(computeYBounds([{ points: [] }])).toBeNull();
  });
});

describe('formatUsdFromCents', () => {
  it('renders cents as dollars', () => {
    expect(formatUsdFromCents(119)).toBe('$1.19');
    expect(formatUsdFromCents(4039)).toBe('$40.39');
    expect(formatUsdFromCents(0)).toBe('$0.00');
  });
});

describe('formatAxisCents', () => {
  it('keeps the cents while they still matter, drops them once they are noise', () => {
    // A cheap card's axis needs the cents ($0.60 .. $0.75); a $40 axis does not.
    expect(formatAxisCents(400)).toBe('$4.00');
    expect(formatAxisCents(120)).toBe('$1.20');
    expect(formatAxisCents(4039)).toBe('$40');
  });
});

describe('date labels', () => {
  it('reads dates in UTC so a midnight point never slips a day', () => {
    // Both sources store a date at UTC midnight; local getters would render
    // 2026-09-01 as Aug 31 anywhere behind UTC.
    expect(formatChartMonth(Date.parse('2026-09-01'))).toBe("Sep '26");
    expect(formatChartDate(Date.parse('2026-09-01'))).toBe('Sep 1, 2026');
    expect(formatChartMonth(Date.parse('2026-01-15'))).toBe("Jan '26");
  });
});

describe('listMonthStarts', () => {
  it('lists the UTC month boundaries inside the window', () => {
    expect(listMonthStarts(Date.parse('2026-04-01'), Date.parse('2026-09-26'))).toEqual([
      Date.parse('2026-04-01'),
      Date.parse('2026-05-01'),
      Date.parse('2026-06-01'),
      Date.parse('2026-07-01'),
      Date.parse('2026-08-01'),
      Date.parse('2026-09-01'),
    ]);
  });

  it('skips a boundary before the window and one after it', () => {
    // A window that starts mid-month must not label the month it starts in, and
    // must not label a month it never reaches.
    expect(listMonthStarts(Date.parse('2026-04-04'), Date.parse('2026-06-13'))).toEqual([
      Date.parse('2026-05-01'),
      Date.parse('2026-06-01'),
    ]);
  });

  it('returns nothing when the window holds no boundary', () => {
    // A card released this month, viewed over 3M, can span less than one month.
    expect(listMonthStarts(Date.parse('2026-09-05'), Date.parse('2026-09-26'))).toEqual([]);
  });

  it('rolls over into the next year', () => {
    expect(listMonthStarts(Date.parse('2025-11-15'), Date.parse('2026-02-02'))).toEqual([
      Date.parse('2025-12-01'),
      Date.parse('2026-01-01'),
      Date.parse('2026-02-01'),
    ]);
  });
});

describe('mergeSnapPoints', () => {
  it('unions every series and sorts ascending, so the hover can land on either source', () => {
    // The real case: PriceCharting monthly (day 1) and TCGPlayer weekly.
    const monthly = { key: 'pricecharting', points: [[0, 1], [100, 2]] };
    const weekly = { key: 'tcgplayer', points: [[40, 1], [80, 2], [100, 3]] };

    expect(mergeSnapPoints([monthly, weekly])).toEqual([0, 40, 80, 100]);
  });

  it('drops a timestamp shared by both series', () => {
    expect(mergeSnapPoints([{ points: [[5, 1]] }, { points: [[5, 2]] }])).toEqual([5]);
  });

  it('handles no series', () => {
    expect(mergeSnapPoints([])).toEqual([]);
  });
});

describe('pickNearestTimestampIndex', () => {
  const timestamps = [0, 100, 200];

  it('finds the closest timestamp', () => {
    expect(pickNearestTimestampIndex(timestamps, 140)).toBe(1);
    expect(pickNearestTimestampIndex(timestamps, 190)).toBe(2);
    expect(pickNearestTimestampIndex(timestamps, -50)).toBe(0);
  });

  it('returns -1 without timestamps', () => {
    expect(pickNearestTimestampIndex([], 10)).toBe(-1);
    expect(pickNearestTimestampIndex(null, 10)).toBe(-1);
  });
});

describe('interpolatePriceAt', () => {
  const points = [[0, 100], [100, 200], [200, 300]];

  it('returns the sample itself on a sample', () => {
    expect(interpolatePriceAt(points, 100)).toBe(200);
  });

  it('walks the line between the two samples that bracket the moment', () => {
    // This is what lets every dot sit on the crosshair instead of on its own day.
    expect(interpolatePriceAt(points, 50)).toBe(150);
    expect(interpolatePriceAt(points, 150)).toBe(250);
    expect(interpolatePriceAt(points, 25)).toBe(125);
  });

  it('returns null once the series has ended instead of stretching it to the other', () => {
    // The blue line stopping in August must not keep a dot in September just to
    // stay level with the red one.
    expect(interpolatePriceAt(points, -1)).toBeNull();
    expect(interpolatePriceAt(points, 201)).toBeNull();
    expect(interpolatePriceAt(points, 9999)).toBeNull();
    // The exact end points are still inside the series.
    expect(interpolatePriceAt(points, 0)).toBe(100);
    expect(interpolatePriceAt(points, 200)).toBe(300);
  });

  it('handles a single point and an empty series', () => {
    // A one-point series only has a value at its own moment.
    expect(interpolatePriceAt([[5, 42]], 5)).toBe(42);
    expect(interpolatePriceAt([[5, 42]], 6)).toBeNull();
    expect(interpolatePriceAt([], 100)).toBeNull();
    expect(interpolatePriceAt(null, 100)).toBeNull();
  });
});
