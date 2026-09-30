import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';
import { resetChromeStorage } from './chrome-mock.js';

// constants.js first, then price-chart.js — the order scanner.html uses, since the
// chart reads its remembered preferences from STORAGE_KEYS.
loadExtensionScripts('utils/price-chart.js');

// jsdom has no canvas backend, so getContext returns null and the draw path would
// throw. The chart only needs the calls to exist.
function stubCanvasContext() {
  const drawn = [];
  const context = new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return (text) => ({ width: String(text).length * 6 });
      if (prop === 'fillText') return (text) => { drawn.push(String(text)); };
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  HTMLCanvasElement.prototype.getContext = () => context;
  return drawn;
}

let drawnText = [];
// Every container a test built, so each one's chart is unmounted afterwards:
// mountPriceHistoryChart keeps its state per container.
let containers = [];

const series = [
  // Ascending, the way every normalizer emits them, so the last point is the newest.
  { key: 'pricecharting', label: 'PriceCharting (Ungraded)', color: '#4c9aff', points: [[Date.now() - 86400000, 110], [Date.now(), 119]] },
  { key: 'tcgplayer', label: 'TCGPlayer (Holofoil)', color: '#e0334d', points: [[Date.now(), 74]] },
  { key: 'collectr', label: 'Collectr (Holofoil)', color: '#a78bfa', points: [[Date.now(), 77]] },
];

function buildContainer() {
  const container = document.createElement('div');
  container.innerHTML = renderPriceHistorySection(series, 'Black Kyurem ex');
  document.body.appendChild(container);
  containers.push(container);
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
  containers = [];
  drawnText = stubCanvasContext();
  // The remembered period and hidden lines live in storage, which is what every
  // mount reads, so each test starts from the defaults.
  resetChromeStorage();
});

afterEach(() => {
  for (const container of containers) unmountPriceHistoryChart(container);
});

describe('renderPriceHistorySection', () => {
  it('renders nothing when neither source has data', () => {
    expect(renderPriceHistorySection([], 'Black Kyurem ex')).toBe('');
    expect(renderPriceHistorySection(null)).toBe('');
    expect(renderPriceHistorySection(undefined, 'x')).toBe('');
  });

  it('renders the header, one button per period, the canvas and the legend', () => {
    const container = document.createElement('div');
    container.innerHTML = renderPriceHistorySection(series, 'Black Kyurem ex');

    expect(container.querySelector('.price-history h4').textContent).toBe('Price History');
    const buttons = [...container.querySelectorAll('.price-history-period')];
    expect(buttons.map((button) => button.textContent)).toEqual(['3M', '6M', '1Y']);
    expect(buttons.map((button) => button.dataset.days)).toEqual(['90', '180', '365']);
    // 6M opens by default, until a mount applies what was remembered.
    expect(buttons[1].classList.contains('active')).toBe(true);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    const canvas = container.querySelector('.price-history-canvas');
    expect(canvas.getAttribute('aria-label')).toBe('Price history for Black Kyurem ex');
    expect([...container.querySelectorAll('.price-history-legend-item')].map((item) => item.textContent))
      .toEqual(['PriceCharting (Ungraded)', 'TCGPlayer (Holofoil)', 'Collectr (Holofoil)']);
  });

  it('renders the legend entries as pressed toggle buttons', () => {
    const container = document.createElement('div');
    container.innerHTML = renderPriceHistorySection(series, 'Black Kyurem ex');

    const items = [...container.querySelectorAll('.price-history-legend-item')];
    expect(items.map((item) => item.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(items.map((item) => item.dataset.key)).toEqual(['pricecharting', 'tcgplayer', 'collectr']);
    expect(items.map((item) => item.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
    expect(items[0].getAttribute('type')).toBe('button');
  });

  it('puts an info icon before the legend that explains the toggles', () => {
    const container = document.createElement('div');
    container.innerHTML = renderPriceHistorySection(series, 'Black Kyurem ex');

    const legend = container.querySelector('.price-history-legend');
    const hint = legend.querySelector('.price-history-hint');
    // The tooltip text has to be reachable without hovering.
    expect(hint.getAttribute('role')).toBe('img');
    expect(hint.getAttribute('aria-label')).toMatch(/hide or show that line/);
    expect(hint.getAttribute('data-tooltip')).toBe(hint.getAttribute('aria-label'));
    // The icon comes first, the toggle buttons follow it.
    expect(legend.firstElementChild).toBe(hint);
    expect(legend.querySelectorAll('.price-history-legend-item')).toHaveLength(3);
  });

  it('spells the numbers out for a screen reader, since a canvas is opaque', () => {
    const container = document.createElement('div');
    container.innerHTML = renderPriceHistorySection(series, 'Black Kyurem ex');

    const summary = container.querySelector('.price-history-summary');
    expect(summary.classList.contains('sr-only')).toBe(true);
    expect(summary.textContent).toContain('Price history for Black Kyurem ex');
    expect(summary.textContent).toContain('PriceCharting (Ungraded): $1.19 on');
    expect(summary.textContent).toContain('TCGPlayer (Holofoil): $0.74 on');
    expect(summary.textContent).toContain('Collectr (Holofoil): $0.77 on');
  });

  it('labels the canvas even without a card name', () => {
    const container = document.createElement('div');
    container.innerHTML = renderPriceHistorySection(series);

    expect(container.querySelector('.price-history-canvas').getAttribute('aria-label')).toBe('Price history');
  });
});

describe('mountPriceHistoryChart', () => {
  it('draws on mount and switches the period when a button is clicked', async () => {
    const container = buildContainer();

    await mountPriceHistoryChart(container, series);

    expect(container.querySelector('.price-history-canvas').width).toBeGreaterThan(0);
    const buttons = [...container.querySelectorAll('.price-history-period')];
    buttons[2].click();
    expect(buttons[2].classList.contains('active')).toBe(true);
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].classList.contains('active')).toBe(false);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('is a no-op without a section or without series', async () => {
    const empty = document.createElement('div');
    document.body.appendChild(empty);

    await expect(mountPriceHistoryChart(empty, series)).resolves.toBeUndefined();
    await expect(mountPriceHistoryChart(buildContainer(), [])).resolves.toBeUndefined();
  });

  it('adds at most one shared resize listener however many charts are mounted', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const countResize = () => addSpy.mock.calls.filter(([type]) => type === 'resize').length;
    const before = countResize();

    await mountPriceHistoryChart(buildContainer(), series);
    await mountPriceHistoryChart(buildContainer(), series);
    await mountPriceHistoryChart(buildContainer(), series);

    // One listener redraws every mounted chart, so it is attached once for the page
    // rather than once per chart.
    expect(countResize() - before).toBeLessThanOrEqual(1);
    addSpy.mockRestore();
  });

  it('keeps a chart per container, so a cross-version block does not take over the main one', async () => {
    const main = buildContainer();
    await mountPriceHistoryChart(main, series);
    await mountPriceHistoryChart(buildContainer(), series);
    // The first chart has to still be alive: hovering it must redraw.
    drawnText.length = 0;

    main.querySelector('.price-history-canvas').dispatchEvent(
      new MouseEvent('mousemove', { clientX: 120, clientY: 40, bubbles: true }),
    );

    expect(drawnText.length).toBeGreaterThan(0);
  });

  it('redraws on resize so the canvas follows its CSS box', async () => {
    const container = buildContainer();
    await mountPriceHistoryChart(container, series);

    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
  });

  it('toggles a source line off and back on from its legend button', async () => {
    const container = buildContainer();
    await mountPriceHistoryChart(container, series);
    const collectr = container.querySelector('.price-history-legend-item[data-key="collectr"]');

    collectr.click();
    expect(collectr.getAttribute('aria-pressed')).toBe('false');
    expect(collectr.classList.contains('is-off')).toBe(true);

    collectr.click();
    expect(collectr.getAttribute('aria-pressed')).toBe('true');
    expect(collectr.classList.contains('is-off')).toBe(false);
  });

  it('applies a toggle to every chart on the page', async () => {
    const main = buildContainer();
    const crossVersion = buildContainer();
    await mountPriceHistoryChart(main, series);
    await mountPriceHistoryChart(crossVersion, series);

    main.querySelector('.price-history-legend-item[data-key="collectr"]').click();

    expect(crossVersion.querySelector('.price-history-legend-item[data-key="collectr"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('says all lines are hidden rather than claiming there is no history', async () => {
    const container = buildContainer();
    await mountPriceHistoryChart(container, series);
    // Clear in place: the stub closure pushes into this same array.
    drawnText.length = 0;

    for (const item of container.querySelectorAll('.price-history-legend-item')) item.click();

    expect(drawnText).toContain('All lines hidden');
  });

  it('opens on the remembered period and hidden lines', async () => {
    await chrome.storage.local.set({ priceChartPrefs: { periodDays: 365, hiddenKeys: ['collectr'] } });
    const container = buildContainer();

    await mountPriceHistoryChart(container, series);

    const periods = [...container.querySelectorAll('.price-history-period')];
    expect(periods[2].classList.contains('active')).toBe(true);
    expect(periods[1].classList.contains('active')).toBe(false);
    const collectr = container.querySelector('.price-history-legend-item[data-key="collectr"]');
    expect(collectr.getAttribute('aria-pressed')).toBe('false');
    expect(collectr.classList.contains('is-off')).toBe(true);
  });

  it('remembers a change for the next scan', async () => {
    const first = buildContainer();
    await mountPriceHistoryChart(first, series);

    first.querySelectorAll('.price-history-period')[2].click();
    first.querySelector('.price-history-legend-item[data-key="tcgplayer"]').click();

    // A later scan mounts a fresh container and must open the way the last one was left.
    const second = buildContainer();
    await mountPriceHistoryChart(second, series);

    expect(second.querySelectorAll('.price-history-period')[2].classList.contains('active')).toBe(true);
    expect(second.querySelector('.price-history-legend-item[data-key="tcgplayer"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores a remembered period that no longer matches a button', async () => {
    await chrome.storage.local.set({ priceChartPrefs: { periodDays: 999 } });
    const container = buildContainer();

    await mountPriceHistoryChart(container, series);

    expect(container.querySelectorAll('.price-history-period')[1].classList.contains('active')).toBe(true);
  });
});
