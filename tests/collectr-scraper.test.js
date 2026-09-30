import { describe, it, expect } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// Load constants.js + collectr-scraper.js into global scope
loadExtensionScripts('lib/collectr-scraper.js');

// Row builder matching the API shape: prices are dollar strings and the ungraded
// rows carry grade_id "52".
function row(insertionDate, price, productSubType = 'Holofoil', gradeId = '52') {
  return { insertion_date: insertionDate, price, product_sub_type: productSubType, grade_id: gradeId };
}

function body(priceHistory, ungradedTypes = ['Holofoil']) {
  return { data: { ungraded_sub_types: ungradedTypes.map((t) => ({ product_sub_type: t })), price_history: priceHistory } };
}

describe('normalizeCollectrPriceHistory', () => {
  it('reads the ungraded printing, converts dollar strings to cents and sorts ascending', () => {
    // The API answers newest-first.
    const history = normalizeCollectrPriceHistory(body([
      row('2026-09-26', '0.77'),
      row('2026-09-19', '0.62'),
      row('2026-09-05', '0.70'),
    ]));

    expect(history.variant).toBe('Holofoil');
    expect(history.points).toEqual([
      [Date.parse('2026-09-05'), 70],
      [Date.parse('2026-09-19'), 62],
      [Date.parse('2026-09-26'), 77],
    ]);
  });

  it('keeps the last row of a day, the way the page builds its own chart', () => {
    const history = normalizeCollectrPriceHistory(body([
      row('2026-09-26', '0.60'),
      row('2026-09-26', '0.77'),
    ]));

    expect(history.points).toEqual([[Date.parse('2026-09-26'), 77]]);
  });

  it('prefers Normal over Holofoil when the product has both printings', () => {
    const history = normalizeCollectrPriceHistory(body(
      [row('2026-09-26', '0.50', 'Normal'), row('2026-09-26', '1.00', 'Holofoil')],
      ['Holofoil', 'Normal'],
    ));

    expect(history.variant).toBe('Normal');
    expect(history.points).toEqual([[Date.parse('2026-09-26'), 50]]);
  });

  it('falls back to whichever printing the product actually has', () => {
    const history = normalizeCollectrPriceHistory(body(
      [row('2026-09-26', '9.99', '1st Edition Holofoil')],
      ['1st Edition Holofoil'],
    ));

    expect(history.variant).toBe('1st Edition Holofoil');
    expect(history.points).toEqual([[Date.parse('2026-09-26'), 999]]);
  });

  it('ignores graded rows and unusable dates or prices', () => {
    const history = normalizeCollectrPriceHistory(body([
      row('2026-09-26', '0.77'),
      row('2026-09-26', '120.00', 'Holofoil', '12'),
      row('not-a-date', '1.00'),
      row('2026-09-20', 'N/A'),
    ]));

    expect(history.points).toEqual([[Date.parse('2026-09-26'), 77]]);
  });

  it('derives the printing from the history when the product lists no ungraded types', () => {
    const history = normalizeCollectrPriceHistory(body([row('2026-09-26', '0.77', 'Other')], []));

    expect(history.variant).toBe('Other');
    expect(history.points).toEqual([[Date.parse('2026-09-26'), 77]]);
  });

  it('returns null when there is nothing usable', () => {
    expect(normalizeCollectrPriceHistory(null)).toBeNull();
    expect(normalizeCollectrPriceHistory({})).toBeNull();
    expect(normalizeCollectrPriceHistory({ data: {} })).toBeNull();
    expect(normalizeCollectrPriceHistory(body([]))).toBeNull();
    expect(normalizeCollectrPriceHistory(body([row('2026-09-26', '0.77', 'Holofoil', '12')]))).toBeNull();
  });
});
