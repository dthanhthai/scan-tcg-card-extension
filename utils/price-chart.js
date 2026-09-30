// Price history chart: a dependency-free Canvas renderer for a scanned card's
// price series (see docs/PRICE_HISTORY_PLAN.md §4.1 — no chart library is added
// for one chart).
//
// Both sources are already normalized by the scrapers to [timestampMs,
// priceCents], ascending:
//   pricechartingChartData: { used: [[ts, cents], ...], cib: [...], ... }  (a map)
//   tcgplayerChartData:     { variant: 'Holofoil', points: [[ts, cents], ...] }
//
// buildPriceChartSeries flattens those into the list this module draws. The pure
// helpers hold all of the logic and are unit-tested; createPriceChart only draws
// and tracks the hover.
//
// Dates are read through the UTC getters on purpose: both sources store a date at
// UTC midnight, so local getters would push a point back into the previous day —
// and for a first-of-month point, into the previous month — in any timezone
// behind UTC.

const CHART_DAY_MS = 24 * 60 * 60 * 1000;

// The periods the selector offers. "All" is deliberately absent: PriceCharting
// history starts at the set's release and TCGPlayer's API has no unbounded range.
const CHART_PERIODS = [
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
];

// 6M opens by default: long enough to show a trend, short enough that a recent
// release is not squashed into two points.
const CHART_DEFAULT_PERIOD_DAYS = 180;

// Minimum horizontal gap between month labels, so "Sep '26" labels never collide.
const CHART_MONTH_LABEL_GAP = 64;

const CHART_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const CHART_STYLE = {
  pricecharting: '#4c9aff',
  tcgplayer: '#e0334d',
  // Violet rather than green: with a red line already on the chart, a third red-ish
  // or green-ish line would be the pair red-green colour blindness cannot separate.
  collectr: '#a78bfa',
  text: '#9a9ca8',
  grid: '#33353f',
  crosshair: '#5a5d6b',
  tooltipBackground: 'rgba(36, 38, 47, 0.96)',
  tooltipBorder: '#33353f',
};

// The marketplaces that report one line each, in the order they are drawn.
const CHART_VARIANT_SOURCES = [
  { key: 'tcgplayer', label: 'TCGPlayer' },
  { key: 'collectr', label: 'Collectr' },
];

/**
 * Flattens the scraped chart payloads into the series list the renderer draws.
 * PriceCharting's `used` series is the Ungraded one — the same printing the
 * marketplace block quotes — so it is the line that gets drawn.
 * @param {object|null} pricechartingChartData - map of PriceCharting series
 * @param {{variant: string, points: number[][]}|null} tcgplayerChartData
 * @param {{variant: string, points: number[][]}|null} collectrChartData
 * @returns {{key: string, label: string, color: string, points: number[][]}[]} empty when no source has data
 */
function buildPriceChartSeries(pricechartingChartData, tcgplayerChartData, collectrChartData) {
  const series = [];
  const ungraded = pricechartingChartData && pricechartingChartData.used;
  if (Array.isArray(ungraded) && ungraded.length > 0) {
    series.push({
      key: 'pricecharting',
      label: 'PriceCharting (Ungraded)',
      color: CHART_STYLE.pricecharting,
      points: ungraded,
    });
  }
  const byKey = { tcgplayer: tcgplayerChartData, collectr: collectrChartData };
  for (const source of CHART_VARIANT_SOURCES) {
    const chartData = byKey[source.key];
    if (!chartData || !Array.isArray(chartData.points) || chartData.points.length === 0) continue;
    series.push({
      key: source.key,
      label: chartData.variant ? `${source.label} (${chartData.variant})` : source.label,
      color: CHART_STYLE[source.key],
      points: chartData.points,
    });
  }
  return series;
}

/**
 * Keeps the points inside the selected period.
 * @param {number[][]} points - [timestampMs, priceCents] ascending
 * @param {number} days - window length; 0 or falsy keeps everything
 * @param {number} nowMs - reference "today"
 * @returns {number[][]}
 */
function filterPointsByPeriod(points, days, nowMs) {
  if (!Array.isArray(points)) return [];
  if (!days) return points.slice();
  const cutoff = nowMs - days * CHART_DAY_MS;
  return points.filter((point) => point[0] >= cutoff);
}

/**
 * Builds a rounded Y axis around the data: a "nice" step (1, 2 or 5 times a power
 * of ten) so the labels are whole numbers instead of raw extremes.
 * @param {{points: number[][]}[]} series - already period-filtered
 * @param {number} [tickCount]
 * @returns {{min: number, max: number, ticks: number[]}|null} cents, or null when there is no data
 */
function computeYBounds(series, tickCount = 4) {
  let min = Infinity;
  let max = -Infinity;
  for (const entry of series) {
    for (const point of entry.points) {
      if (point[1] < min) min = point[1];
      if (point[1] > max) max = point[1];
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) {
    min = Math.max(0, min - 1);
    max += 1;
  }
  const roughStep = (max - min) / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) ticks.push(Math.round(value));
  return { min: niceMin, max: niceMax, ticks };
}

/**
 * @param {number} cents
 * @returns {string} e.g. "$1.19"
 */
function formatUsdFromCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compact money for the Y axis labels: whole dollars once the amounts are large
 * enough that the cents are noise.
 * @param {number} cents
 * @returns {string} e.g. "$4", "$1.20"
 */
function formatAxisCents(cents) {
  const dollars = cents / 100;
  return dollars >= 10 ? `$${Math.round(dollars)}` : `$${dollars.toFixed(2)}`;
}

/**
 * @param {number} timestampMs
 * @returns {string} e.g. "Sep '26"
 */
function formatChartMonth(timestampMs) {
  const date = new Date(timestampMs);
  return `${CHART_MONTH_NAMES[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(-2)}`;
}

/**
 * @param {number} timestampMs
 * @returns {string} e.g. "Sep 26, 2026"
 */
function formatChartDate(timestampMs) {
  const date = new Date(timestampMs);
  return `${CHART_MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/**
 * UTC first-of-month timestamps inside [firstMs, lastMs].
 *
 * Month labels are placed on these rather than on data points: PriceCharting
 * samples monthly (so its points already sit on the 1st) while TCGPlayer samples
 * weekly, so labelling sampled indices would put "Sep '26" on a different day for
 * each source — and never on the month it names.
 *
 * @param {number} firstMs
 * @param {number} lastMs
 * @returns {number[]}
 */
function listMonthStarts(firstMs, lastMs) {
  const start = new Date(firstMs);
  let month = start.getUTCMonth();
  let timestamp = Date.UTC(start.getUTCFullYear(), month, 1);
  if (timestamp < firstMs) {
    month += 1;
    timestamp = Date.UTC(start.getUTCFullYear(), month, 1);
  }
  const starts = [];
  while (timestamp <= lastMs) {
    starts.push(timestamp);
    month += 1;
    timestamp = Date.UTC(start.getUTCFullYear(), month, 1);
  }
  return starts;
}

/**
 * Every sample timestamp from every series, deduplicated and ascending. The hover
 * snaps to this union, so the crosshair always lands on a real data point: the
 * monthly PriceCharting point when the cursor is near a month boundary, a weekly
 * TCGPlayer point in between.
 * @param {{points: number[][]}[]} series
 * @returns {number[]}
 */
function mergeSnapPoints(series) {
  const timestamps = new Set();
  for (const entry of series) {
    for (const point of entry.points) timestamps.add(point[0]);
  }
  return [...timestamps].sort((a, b) => a - b);
}

/**
 * Index of the timestamp closest to `targetMs`.
 * @param {number[]} timestamps - ascending
 * @param {number} targetMs
 * @returns {number} -1 when the list is empty
 */
function pickNearestTimestampIndex(timestamps, targetMs) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return -1;
  let best = 0;
  let bestDistance = Math.abs(timestamps[0] - targetMs);
  for (let index = 1; index < timestamps.length; index++) {
    const distance = Math.abs(timestamps[index] - targetMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * The series' price at `timestampMs`, linearly between the two samples that
 * bracket it. Returns null when the moment falls outside the series' range: a
 * line that has already ended (PriceCharting's monthly history stops at the last
 * month, TCGPlayer's weekly one runs on) must not grow a dot past its own end just
 * to line up with the other source.
 * @param {number[][]} points - [timestampMs, priceCents] ascending
 * @param {number} timestampMs
 * @returns {number|null} cents, or null when the series does not cover the moment
 */
function interpolatePriceAt(points, timestampMs) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (timestampMs < first[0] || timestampMs > last[0]) return null;
  if (timestampMs === first[0]) return first[1];
  if (timestampMs === last[0]) return last[1];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (timestampMs > current[0]) continue;
    const span = current[0] - previous[0];
    if (span <= 0) return current[1];
    const ratio = (timestampMs - previous[0]) / span;
    return Math.round(previous[1] + ratio * (current[1] - previous[1]));
  }
  return last[1];
}

/**
 * Sizes the canvas backing store to the device pixel ratio and returns the
 * drawing box in CSS pixels, which is the space every other function works in.
 * @param {HTMLCanvasElement} canvas
 * @returns {{width: number, height: number}}
 */
function fitCanvasToDisplaySize(canvas) {
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const width = canvas.clientWidth || canvas.width || 300;
  const height = canvas.clientHeight || canvas.height || 160;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

/**
 * Binds a chart to a canvas. Returns a controller:
 *   setSeries(series)   replaces the data and redraws
 *   setPeriodDays(days) changes the window (0 = everything) and redraws
 *   setHiddenKeys(keys) hides the series carrying those keys and redraws
 *   destroy()           removes the hover listeners
 * @param {HTMLCanvasElement} canvas
 * @returns {{setSeries: Function, setPeriodDays: Function, setHiddenKeys: Function, destroy: Function}}
 */
function createPriceChart(canvas) {
  let series = [];
  let periodDays = 0;
  let hiddenKeys = new Set();
  let hoverIndex = -1;
  let geometry = null;

  // Three different reasons for an empty chart, three different messages: every
  // line switched off, no sale inside the window, or no history at all.
  const emptyMessage = () => {
    if (series.length > 0 && series.every((entry) => hiddenKeys.has(entry.key))) return 'All lines hidden';
    return series.some((entry) => entry.points.length > 0) ? 'No data in this period' : 'No price history available';
  };

  const draw = () => {
    const context = canvas.getContext('2d');
    const { width, height } = fitCanvasToDisplaySize(canvas);
    context.clearRect(0, 0, width, height);
    const visible = series
      .filter((entry) => !hiddenKeys.has(entry.key))
      .map((entry) => ({ ...entry, points: filterPointsByPeriod(entry.points, periodDays, Date.now()) }))
      .filter((entry) => entry.points.length > 0);
    geometry = null;
    if (visible.length === 0) {
      context.fillStyle = CHART_STYLE.text;
      context.font = '13px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(emptyMessage(), width / 2, height / 2);
      return;
    }
    const bounds = computeYBounds(visible);
    const padding = { top: 12, right: 10, bottom: 24, left: 46 };
    const plot = {
      left: padding.left,
      right: width - padding.right,
      top: padding.top,
      bottom: height - padding.bottom,
    };
    plot.width = plot.right - plot.left;
    plot.height = plot.bottom - plot.top;
    const firstMs = Math.min(...visible.map((entry) => entry.points[0][0]));
    const lastMs = Math.max(...visible.map((entry) => entry.points[entry.points.length - 1][0]));
    const span = Math.max(1, lastMs - firstMs);
    const toX = (timestampMs) => plot.left + ((timestampMs - firstMs) / span) * plot.width;
    const toY = (cents) => plot.bottom - ((cents - bounds.min) / Math.max(1, bounds.max - bounds.min)) * plot.height;
    geometry = { plot, firstMs, lastMs, toX, toY, snapPoints: mergeSnapPoints(visible) };
    drawGrid(context, bounds, plot);
    drawMonthLabels(context, firstMs, lastMs, plot, toX);
    for (const entry of visible) drawSeriesLine(context, entry, toX, toY);
    if (hoverIndex >= 0) drawHover(context, visible, hoverIndex, width);
  };

  const drawHover = (context, visible, index, width) => {
    // The crosshair snaps to a real sample of one of the sources, and every dot is
    // placed where that crosshair meets the series' own line — so no dot floats off
    // to the side. The price is interpolated between the samples around it.
    const snapPoints = geometry.snapPoints;
    const anchorMs = snapPoints[Math.min(index, snapPoints.length - 1)];
    const x = geometry.toX(anchorMs);
    context.strokeStyle = CHART_STYLE.crosshair;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, geometry.plot.top);
    context.lineTo(x, geometry.plot.bottom);
    context.stroke();
    const rows = [];
    for (const entry of visible) {
      const price = interpolatePriceAt(entry.points, anchorMs);
      if (price == null) continue;
      // The dot sits on the crosshair, so its price is interpolated whenever the
      // series has no sample at that exact moment. Mark those, or the tooltip
      // reads as a price that was actually recorded.
      const exact = entry.points.some((point) => point[0] === anchorMs);
      context.fillStyle = entry.color;
      context.beginPath();
      context.arc(x, geometry.toY(price), 3.5, 0, Math.PI * 2);
      context.fill();
      rows.push({ color: entry.color, text: `${exact ? '' : '≈'}${formatUsdFromCents(price)} ${entry.label}` });
    }
    drawTooltip(context, formatChartDate(anchorMs), rows, x, width);
  };

  const onMouseMove = (event) => {
    if (!geometry) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const timestampMs = geometry.firstMs
      + ((x - geometry.plot.left) / Math.max(1, geometry.plot.width)) * (geometry.lastMs - geometry.firstMs);
    const next = pickNearestTimestampIndex(geometry.snapPoints, timestampMs);
    if (next !== hoverIndex) {
      hoverIndex = next;
      draw();
    }
  };

  const onMouseLeave = () => {
    if (hoverIndex === -1) return;
    hoverIndex = -1;
    draw();
  };

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  return {
    setSeries: (next) => { series = next || []; hoverIndex = -1; draw(); },
    setPeriodDays: (days) => { periodDays = days || 0; hoverIndex = -1; draw(); },
    setHiddenKeys: (keys) => { hiddenKeys = new Set(keys || []); hoverIndex = -1; draw(); },
    destroy: () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}

/**
 * Horizontal gridlines plus their money labels.
 */
function drawGrid(context, bounds, plot) {
  context.font = '11px system-ui, sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (const tick of bounds.ticks) {
    const y = plot.bottom - ((tick - bounds.min) / Math.max(1, bounds.max - bounds.min)) * plot.height;
    context.strokeStyle = CHART_STYLE.grid;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillStyle = CHART_STYLE.text;
    context.fillText(formatAxisCents(tick), plot.left - 6, y);
  }
}

/**
 * Month labels under the axis, one per month boundary that fits, with the first
 * and last nudged inside the plot so a label is never clipped. A window shorter
 * than a month has no boundary in it, so it falls back to its own two ends.
 */
function drawMonthLabels(context, firstMs, lastMs, plot, toX) {
  const monthStarts = listMonthStarts(firstMs, lastMs);
  const ticks = monthStarts.length > 0 ? monthStarts : [firstMs, lastMs];
  context.font = '11px system-ui, sans-serif';
  context.fillStyle = CHART_STYLE.text;
  context.textBaseline = 'top';
  let lastLabelX = -Infinity;
  for (const timestamp of ticks) {
    const x = Math.min(Math.max(toX(timestamp), plot.left), plot.right);
    if (x - lastLabelX < CHART_MONTH_LABEL_GAP) continue;
    const label = formatChartMonth(timestamp);
    const halfWidth = context.measureText(label).width / 2;
    context.textAlign = x - halfWidth < plot.left ? 'left' : x + halfWidth > plot.right ? 'right' : 'center';
    context.fillText(label, x, plot.bottom + 6);
    lastLabelX = x;
  }
}

/**
 * One polyline per series. A series with a single point in range is drawn as a
 * dot, since a line needs two.
 */
function drawSeriesLine(context, entry, toX, toY) {
  context.strokeStyle = entry.color;
  context.fillStyle = entry.color;
  context.lineWidth = 2;
  context.lineJoin = 'round';
  if (entry.points.length === 1) {
    context.beginPath();
    context.arc(toX(entry.points[0][0]), toY(entry.points[0][1]), 3, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  entry.points.forEach((point, index) => {
    const x = toX(point[0]);
    const y = toY(point[1]);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

/**
 * The hover card: the date plus one row per series, flipped to the left when it
 * would run off the right edge.
 */
function drawTooltip(context, dateLabel, rows, anchorX, canvasWidth) {
  context.font = '12px system-ui, sans-serif';
  const lineHeight = 16;
  const padding = 8;
  const width = Math.max(context.measureText(dateLabel).width, ...rows.map((row) => context.measureText(row.text).width + 12)) + padding * 2;
  const height = lineHeight * (rows.length + 1) + padding * 2;
  const left = anchorX + 12 + width > canvasWidth ? anchorX - 12 - width : anchorX + 12;
  const top = 8;
  context.fillStyle = CHART_STYLE.tooltipBackground;
  context.strokeStyle = CHART_STYLE.tooltipBorder;
  context.lineWidth = 1;
  context.beginPath();
  context.rect(left, top, width, height);
  context.fill();
  context.stroke();
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillStyle = CHART_STYLE.text;
  context.fillText(dateLabel, left + padding, top + padding);
  rows.forEach((row, index) => {
    const y = top + padding + lineHeight * (index + 1);
    context.fillStyle = row.color;
    context.fillRect(left + padding, y + 4, 8, 8);
    context.fillStyle = CHART_STYLE.text;
    context.fillText(row.text, left + padding + 14, y);
  });
}

/**
 * Builds the chart section markup: header, period selector, canvas and legend.
 * Returns '' when there is no series, so the caller can insert the result
 * unconditionally and get no section at all.
 * @param {{key: string, label: string, color: string, points: number[][]}[]} series
 * @param {string} [cardName] - used for the canvas label
 * @returns {string}
 */
function renderPriceHistorySection(series, cardName) {
  if (!Array.isArray(series) || series.length === 0) return '';
  const periods = CHART_PERIODS.map((period) => {
    const isDefault = period.days === CHART_DEFAULT_PERIOD_DAYS;
    return `<button type="button" class="price-history-period${isDefault ? ' active' : ''}" data-days="${period.days}" aria-pressed="${isDefault}">${period.label}</button>`;
  }).join('');
  const legend = series
    .map((entry) => `<button type="button" class="price-history-legend-item" data-key="${entry.key}" aria-pressed="true"><i class="price-history-swatch" style="background:${entry.color}" aria-hidden="true"></i><span class="price-history-legend-label">${entry.label}</span></button>`)
    .join('');
  const label = cardName ? `Price history for ${cardName}` : 'Price history';
  // A canvas is opaque to a screen reader, so the numbers are spelled out beside
  // it: each source's latest value and the day it belongs to.
  const summary = series
    .map((entry) => {
      const last = entry.points[entry.points.length - 1];
      return `${entry.label}: ${formatUsdFromCents(last[1])} on ${formatChartDate(last[0])}`;
    })
    .join('. ');
  // Same info-icon contract as the cross-version badge: role="img" + aria-label
  // carry the text for screen readers, data-tooltip drives the visible tooltip.
  const hint = 'Click a name to hide or show that line on the chart.';
  return `
    <div class="price-history">
      <div class="price-history-header">
        <h4>Price History</h4>
        <div class="price-history-periods" role="group" aria-label="Price history period">${periods}</div>
      </div>
      <canvas class="price-history-canvas" role="img" aria-label="${label}"></canvas>
      <p class="price-history-summary sr-only">${label}. ${summary}.</p>
      <div class="price-history-legend" role="group" aria-label="Toggle price lines"><span class="price-history-hint" role="img" aria-label="${hint}" data-tooltip="${hint}"><svg class="price-history-hint-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3" /><rect x="7.3" y="7" width="1.4" height="4" rx="0.7" fill="currentColor" /><circle cx="8" cy="4.8" r="0.95" fill="currentColor" /></svg></span>${legend}</div>
    </div>`;
}

// The charts mounted for the results currently on screen. The main result and each
// cross-version result can show one at the same time, so this cannot be a single
// slot: mounting a second chart must not tear down the first.
//
// Entries whose container has left the page are dropped on the next mount or
// resize. That is what keeps a long session — where every cross-version lookup
// replaces a block — from accumulating controllers and resize work.
const mountedPriceCharts = new Set();
let isPriceChartResizeAttached = false;

// The period and the hidden lines are a viewing preference, not a property of the
// card, so they are remembered across scans and shared by every chart on the page:
// toggling Collectr off in one block takes it off in the other too.
let priceChartPrefs = { periodDays: CHART_DEFAULT_PERIOD_DAYS, hiddenKeys: [] };

// Storage is the source of truth, so a mount starts from the defaults and applies
// whatever is stored. A stored period that no longer matches a button is ignored,
// so removing a period cannot leave the chart stuck on it.
async function loadPriceChartPrefs() {
  priceChartPrefs = { periodDays: CHART_DEFAULT_PERIOD_DAYS, hiddenKeys: [] };
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.PRICE_CHART_PREFS);
    const prefs = stored && stored[STORAGE_KEYS.PRICE_CHART_PREFS];
    if (!prefs) return;
    if (CHART_PERIODS.some((period) => period.days === prefs.periodDays)) priceChartPrefs.periodDays = prefs.periodDays;
    if (Array.isArray(prefs.hiddenKeys)) priceChartPrefs.hiddenKeys = prefs.hiddenKeys;
  } catch (err) {
    // A failed read just means the defaults.
  }
}

// A preference that failed to save is not worth failing a scan over.
function savePriceChartPrefs() {
  chrome.storage.local.set({ [STORAGE_KEYS.PRICE_CHART_PREFS]: { ...priceChartPrefs } }).catch(() => {});
}

// Reflects the preference in the buttons: the period row and the legend, which
// doubles as the per-source toggle row.
function syncPriceChartButtons(mounted) {
  for (const button of mounted.periodButtons) {
    const isActive = (Number(button.dataset.days) || 0) === priceChartPrefs.periodDays;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
  for (const button of mounted.legendButtons) {
    const isHidden = priceChartPrefs.hiddenKeys.includes(button.dataset.key);
    button.classList.toggle('is-off', isHidden);
    button.setAttribute('aria-pressed', String(!isHidden));
  }
}

function applyPriceChartPrefs() {
  for (const mounted of mountedPriceCharts) {
    mounted.chart.setPeriodDays(priceChartPrefs.periodDays);
    mounted.chart.setHiddenKeys(priceChartPrefs.hiddenKeys);
    syncPriceChartButtons(mounted);
  }
}

function prunePriceCharts() {
  for (const mounted of mountedPriceCharts) {
    if (mounted.canvas.isConnected) continue;
    mounted.chart.destroy();
    mountedPriceCharts.delete(mounted);
  }
}

function redrawPriceCharts() {
  prunePriceCharts();
  for (const mounted of mountedPriceCharts) mounted.chart.setPeriodDays(priceChartPrefs.periodDays);
}

// Attached on the first mount rather than at load: this file is also evaluated in
// the unit tests, which run without a window.
function ensurePriceChartResizeListener() {
  if (isPriceChartResizeAttached) return;
  window.addEventListener('resize', redrawPriceCharts);
  isPriceChartResizeAttached = true;
}

/**
 * Removes the chart mounted in `container`, if any.
 * @param {HTMLElement} container
 */
function unmountPriceHistoryChart(container) {
  for (const mounted of mountedPriceCharts) {
    if (mounted.container !== container) continue;
    mounted.chart.destroy();
    mountedPriceCharts.delete(mounted);
  }
}

/**
 * Draws the series into the section built by renderPriceHistorySection and makes
 * the period buttons and the legend toggles work. A no-op when the section is
 * absent (no chart data).
 *
 * Async because the remembered period and hidden lines are read before the first
 * draw, so the chart never flashes the defaults first. Call it only once the
 * container is visible: the canvas takes its size from its CSS box, and a hidden
 * element has none.
 *
 * @param {HTMLElement} container - the element holding the rendered result
 * @param {{key: string, label: string, color: string, points: number[][]}[]} series
 * @returns {Promise<void>}
 */
async function mountPriceHistoryChart(container, series) {
  const canvas = container.querySelector('.price-history-canvas');
  if (!canvas || !Array.isArray(series) || series.length === 0) return;
  await loadPriceChartPrefs();
  prunePriceCharts();
  unmountPriceHistoryChart(container);
  ensurePriceChartResizeListener();
  const mounted = {
    container,
    canvas,
    chart: createPriceChart(canvas),
    periodButtons: [...container.querySelectorAll('.price-history-period')],
    legendButtons: [...container.querySelectorAll('.price-history-legend-item')],
  };
  for (const button of mounted.periodButtons) {
    button.addEventListener('click', () => {
      priceChartPrefs.periodDays = Number(button.dataset.days) || 0;
      applyPriceChartPrefs();
      savePriceChartPrefs();
    });
  }
  for (const button of mounted.legendButtons) {
    button.addEventListener('click', () => {
      const key = button.dataset.key;
      const hiddenKeys = new Set(priceChartPrefs.hiddenKeys);
      if (hiddenKeys.has(key)) hiddenKeys.delete(key);
      else hiddenKeys.add(key);
      priceChartPrefs.hiddenKeys = [...hiddenKeys];
      applyPriceChartPrefs();
      savePriceChartPrefs();
    });
  }
  mountedPriceCharts.add(mounted);
  mounted.chart.setSeries(series);
  applyPriceChartPrefs();
}
