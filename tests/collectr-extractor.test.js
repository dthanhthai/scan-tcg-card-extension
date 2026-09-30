import { describe, it, expect, beforeEach } from 'vitest';
import { loadScript } from './load-scripts.js';

// extractCollectrListings runs in the Collectr page's DOM.
loadScript('content-scripts/collectr-extractor.js');

// Markup copied from a live search card (Glaceon V, product 246747): the name has
// its own parentheses and the price is in the account's currency, here VND.
function buildCard({ name, priceText, withNameElement = true }) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.innerHTML = `
    <div class="relative w-full h-fit ratio-card overflow-hidden"><img src="https://public.getcollectr.com/public-assets/products/product_246747.jpg" /></div>
    ${withNameElement ? `<span class="mt-3 text-lg mb-1 leading-tight font-bold line-clamp-2 text-card-foreground">${name}</span>` : ''}
    <div class="leading-tight"><span class="text-xs">Evolving Skies</span><span class="text-xs">Ultra Rare</span><span class="text-xs">•175/203</span><span class="text-xs">Holofoil</span><span class="text-xs">${priceText}</span></div>`;
  document.body.appendChild(card);
  return card;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractCollectrListings', () => {
  it('reads the product name from the card element, parentheses and all', () => {
    buildCard({ name: 'Glaceon V (Alternate Art Full)', priceText: '₫4,069,164' });

    const { listings } = extractCollectrListings();

    expect(listings).toHaveLength(1);
    // The old text regex needed "(JP)"/"(EN)" after the name, so this came out as a
    // 60-character cut of the whole card text instead.
    expect(listings[0].productName).toBe('Glaceon V (Alternate Art Full)');
  });

  it('reports no price for a card priced in another currency', () => {
    // Dollars only: treating ₫4,069,164 as dollars would be badly wrong.
    buildCard({ name: 'Glaceon V (Alternate Art Full)', priceText: '₫4,069,164' });

    const { listings, unpricedTexts } = extractCollectrListings();

    expect(listings[0].price).toBeNull();
    expect(unpricedTexts).toHaveLength(1);
    expect(unpricedTexts[0].cardText).toContain('₫4,069,164');
  });

  it('reads a dollar price when the account is in dollars', () => {
    buildCard({ name: 'Black Kyurem ex', priceText: '$0.77' });

    const { listings } = extractCollectrListings();

    expect(listings[0].price).toBe(0.77);
    expect(listings[0].productName).toBe('Black Kyurem ex');
  });

  it('falls back to the card text when the card has no name element', () => {
    buildCard({ name: 'Glaceon V', priceText: '$1.00', withNameElement: false });

    const { listings } = extractCollectrListings();

    expect(listings[0].productName.length).toBeGreaterThan(0);
    expect(listings[0].price).toBe(1);
  });
});
