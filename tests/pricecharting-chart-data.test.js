import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './load-scripts.js';

// extractPricechartingDetailSales is injected into the live page in the ISOLATED
// world, where the page's own globals (window.VGPC) are not visible. It therefore
// has to read the chart series out of the inline <script> text in the shared DOM.
loadScript('content-scripts/pricecharting-extractor.js');

// jsdom executes inline scripts typed as JavaScript, which would put VGPC on the
// window and mask the very thing under test. A data-block type keeps the global
// undefined, matching the isolated world the extractor really runs in.
function appendChartScript(assignment) {
  const script = document.createElement('script');
  script.type = 'application/json';
  script.textContent = assignment;
  document.body.appendChild(script);
}

// Builds the "Ungraded Sold Listings" panel the extractor polls for, so the
// async poll breaks on its first attempt instead of waiting out its 4s budget.
function appendUngradedPanel(dateText, priceText) {
  const comparison = document.createElement('div');
  comparison.id = 'price_comparison';
  const panel = document.createElement('div');
  panel.className = 'completed-auctions-used';
  const table = document.createElement('table');
  const row = document.createElement('tr');
  const dateCell = document.createElement('td');
  dateCell.textContent = dateText;
  const priceCell = document.createElement('td');
  priceCell.textContent = priceText;
  row.appendChild(dateCell);
  row.appendChild(priceCell);
  table.appendChild(row);
  panel.appendChild(table);
  comparison.appendChild(panel);
  document.body.appendChild(comparison);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('extractPricechartingDetailSales — chart data', () => {
  it('reads VGPC.chart_data from the inline script', async () => {
    appendChartScript('VGPC.chart_data = {"loose":[[1700000000000,1234],[1702678400000,1500]]};\nVGPC.product = {"id":42};');
    appendUngradedPanel('2024-01-05', '$12.34');

    const result = await extractPricechartingDetailSales();

    expect(result.chartData).toEqual({ loose: [[1700000000000, 1234], [1702678400000, 1500]] });
    expect(result.recentSalePrice).toBe(12.34);
    expect(result.recentSaleDate).toBe('2024-01-05');
  });

  it('keeps the series keys PriceCharting uses for cards', async () => {
    appendChartScript('VGPC.chart_data = {"used":[[1700000000000,999]]};');
    appendUngradedPanel('2024-01-05', '$12.34');

    const result = await extractPricechartingDetailSales();

    expect(result.chartData).toEqual({ used: [[1700000000000, 999]] });
  });

  it('returns null when no chart script is present', async () => {
    appendUngradedPanel('2024-01-05', '$12.34');

    const result = await extractPricechartingDetailSales();

    expect(result.chartData).toBeNull();
  });

  it('returns null when the chart script holds malformed JSON', async () => {
    appendChartScript('VGPC.chart_data = {loose: notJson};');
    appendUngradedPanel('2024-01-05', '$12.34');

    const result = await extractPricechartingDetailSales();

    expect(result.chartData).toBeNull();
  });

  it('carries chartData on the early return when the sold-listings panel never renders', async () => {
    vi.useFakeTimers();
    appendChartScript('VGPC.chart_data = {"used":[[1700000000000,999]]};');

    const pending = extractPricechartingDetailSales();
    await vi.advanceTimersByTimeAsync(4200);
    const result = await pending;

    expect(result.chartData).toEqual({ used: [[1700000000000, 999]] });
    expect(result.recentSalePrice).toBeNull();
  });
});
