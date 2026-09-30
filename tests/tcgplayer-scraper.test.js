import { describe, it, expect } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// Load constants.js + bulbapedia-resolver.js + listing-picker.js +
// tcgplayer-scraper.js into global scope. Both the resolver (for the name
// comparison the picker uses) and the picker are shared with the service worker,
// whose importScripts list has the same three files.
loadExtensionScripts('lib/bulbapedia-resolver.js', 'lib/listing-picker.js', 'lib/tcgplayer-scraper.js');

// Bucket builder matching the real API shape: prices are dollar strings and
// there is one entry per printing.
function bucket(date, variants) {
  return { date, variants };
}

function entry(variant, marketPrice, averageSalesPrice = null, quantity = '1') {
  return { variant, marketPrice, averageSalesPrice, quantity };
}

// Verbatim shape from a live response (Black Kyurem ex, product 589874).
const blackKyuremEx = {
  count: 3,
  result: [
    bucket('2026-09-26', [entry('Holofoil', '0.74', '0.67', '8')]),
    bucket('2026-09-23', [entry('Holofoil', '0.66', '0.69', '9')]),
    bucket('2026-07-01', [entry('Holofoil', '0.62', '0.62', '22')]),
  ],
};

describe('pickTcgplayerListingToEnrich', () => {
  // The real case: a search for "Glaceon V 175/203" whose alternate art is not the
  // first result. The lookup picks the alternate art, so the detail page opened has
  // to be that one — enriching the first result showed its price under "Listing
  // Price" and threw the detail data away.
  const regularArt = { productName: 'Glaceon V', productUrl: 'https://www.tcgplayer.com/product/246746/pokemon-evolving-skies-glaceon-v-175-203' };
  const alternateArt = { productName: 'Glaceon V (Alternate Art Full)', productUrl: 'https://www.tcgplayer.com/product/246747/pokemon-evolving-skies-glaceon-v-alternate-art-full-175-203' };

  it('opens the detail page of the printing the lookup will pick', () => {
    expect(pickTcgplayerListingToEnrich([regularArt, alternateArt], '175', 'Glaceon V (Alternate Art Full)'))
      .toBe(alternateArt);
  });

  it('falls back to the first listing when the target matches nothing', () => {
    expect(pickTcgplayerListingToEnrich([regularArt, alternateArt], '999', 'Some Other Card'))
      .toBe(regularArt);
  });

  it('falls back to the first listing when no target was passed', () => {
    expect(pickTcgplayerListingToEnrich([regularArt, alternateArt], null, null)).toBe(regularArt);
  });
});

describe('normalizeTcgplayerPriceHistory', () => {
  it('reads the variant, converts dollar strings to cents and sorts ascending', () => {
    // The API answers newest-first, the chart needs oldest-first.
    const history = normalizeTcgplayerPriceHistory(blackKyuremEx);

    expect(history.variant).toBe('Holofoil');
    expect(history.points).toEqual([
      [Date.parse('2026-07-01'), 62],
      [Date.parse('2026-09-23'), 66],
      [Date.parse('2026-09-26'), 74],
    ]);
  });

  it('uses marketPrice, not averageSalesPrice', () => {
    const history = normalizeTcgplayerPriceHistory(blackKyuremEx);

    expect(history.points[2][1]).toBe(74);
    expect(history.points[2][1]).not.toBe(67);
  });

  it('prefers Normal over Holofoil when the product has both printings', () => {
    const history = normalizeTcgplayerPriceHistory({
      result: [bucket('2026-09-26', [entry('Holofoil', '1.00'), entry('Normal', '0.50')])],
    });

    expect(history.variant).toBe('Normal');
    expect(history.points).toEqual([[Date.parse('2026-09-26'), 50]]);
  });

  it('falls back to whichever printing the product actually has', () => {
    const history = normalizeTcgplayerPriceHistory({
      result: [bucket('2026-09-26', [entry('1st Edition Holofoil', '9.99')])],
    });

    expect(history.variant).toBe('1st Edition Holofoil');
    expect(history.points).toEqual([[Date.parse('2026-09-26'), 999]]);
  });

  it('skips buckets where the chosen printing or the price is unusable', () => {
    const history = normalizeTcgplayerPriceHistory({
      result: [
        bucket('2026-09-26', [entry('Normal', '1.00')]),
        bucket('2026-09-25', [entry('Holofoil', '2.00')]),
        bucket('2026-09-24', [entry('Normal', 'N/A')]),
        bucket('not-a-date', [entry('Normal', '3.00')]),
      ],
    });

    expect(history.variant).toBe('Normal');
    expect(history.points).toEqual([[Date.parse('2026-09-26'), 100]]);
  });

  it('returns null when there is nothing usable', () => {
    expect(normalizeTcgplayerPriceHistory(null)).toBeNull();
    expect(normalizeTcgplayerPriceHistory(undefined)).toBeNull();
    expect(normalizeTcgplayerPriceHistory('history')).toBeNull();
    expect(normalizeTcgplayerPriceHistory({})).toBeNull();
    expect(normalizeTcgplayerPriceHistory({ result: [] })).toBeNull();
    expect(normalizeTcgplayerPriceHistory({ result: [bucket('2026-09-26', [])] })).toBeNull();
    expect(normalizeTcgplayerPriceHistory({ result: [bucket('2026-09-26', [entry('Normal', 'N/A')])] })).toBeNull();
  });
});
