import { describe, it, expect, beforeEach } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// Load cardrush-extractor.js into global scope
loadExtensionScripts('content-scripts/cardrush-extractor.js');

// Helper to create a minimal DOM element with text content and optional img
function createElement(tag, text, imgSrc = null, href = null) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (imgSrc) {
    const img = document.createElement('img');
    img.src = imgSrc;
    el.appendChild(img);
  }
  if (href) el.setAttribute('href', href);
  return el;
}

// Helper to build a product list item matching CardRush DOM structure.
// The <a> tag wraps the text; img is a sibling inside the <li>.
function buildProductItem(productId, text, imgSrc = null) {
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.setAttribute('href', `/product/${productId}`);
  link.textContent = text || '';
  li.appendChild(link);
  if (imgSrc) {
    const img = document.createElement('img');
    img.src = imgSrc;
    li.appendChild(img);
  }
  return li;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractCardrushListings — Japanese format', () => {
  it('parses JP product with rarity, card number, and price', () => {
    const li = buildProductItem('12345', 'ニンフィアex【SAR】{212/187} [SV8a] 5,000円(税込) 在庫数3 状態A');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings).toHaveLength(1);
    expect(listings[0].productName).toBe('ニンフィアex');
    expect(listings[0].rarity).toBe('SAR');
    expect(listings[0].cardNumber).toBe('212/187');
    expect(listings[0].setCode).toBe('SV8a');
    expect(listings[0].price).toBe(5000);
    expect(listings[0].stock).toBe(3);
    expect(listings[0].condition).toBe('A');
    expect(listings[0].productUrl).toBe('https://www.cardrush-pokemon.jp/product/12345');
  });

  it('parses JP product with 状態A- condition', () => {
    const li = buildProductItem('111', 'カード【R】{001/100} [SV1] 1,000円(税込) 在庫数1 状態A-');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].condition).toBe('A-');
  });

  it('parses JP product with 状態B condition', () => {
    const li = buildProductItem('222', 'カード【R】{001/100} [SV1] 500円(税込) 在庫数1 状態B');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].condition).toBe('B');
  });

  it('parses JP product with PSA graded condition', () => {
    const li = buildProductItem('333', 'カード【SR】{050/100} [SV1] 10,000円(税込) 在庫数1 PSA');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].condition).toBe('PSA');
  });

  it('detects SALE tag in JP product', () => {
    const li = buildProductItem('444', 'カード【R】{001/100} [SV1] 1,000円(税込) 在庫数1 SALE');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].isOnSale).toBe(true);
  });

  it('parses bare yen price without (税込)', () => {
    const li = buildProductItem('555', 'カード【R】{001/100} [SV1] 800円 在庫数2');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].price).toBe(800);
  });
});

describe('extractCardrushListings — English format', () => {
  it('parses EN product with rarity, card number, and price', () => {
    const li = buildProductItem('67890', 'Sylveon ex [SAR] { 212 / 187 } [SV8a] 5,000円(tax included) Quantity in stock: 3 [Condition A]');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings).toHaveLength(1);
    expect(listings[0].productName).toBe('Sylveon ex');
    expect(listings[0].rarity).toBe('SAR');
    expect(listings[0].cardNumber).toBe('212/187'); // whitespace normalized
    expect(listings[0].setCode).toBe('SV8a');
    expect(listings[0].price).toBe(5000);
    expect(listings[0].stock).toBe(3);
    expect(listings[0].condition).toBe('A');
  });

  it('parses EN product with [Condition A-]', () => {
    const li = buildProductItem('777', 'Card [R] { 001 / 100 } [SV1] 1,000円(tax included) Quantity in stock: 1 [Condition A-]');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].condition).toBe('A-');
  });

  it('parses EN product with [Condition B]', () => {
    const li = buildProductItem('888', 'Card [R] { 001 / 100 } [SV1] 500円(tax included) Quantity in stock: 1 [Condition B]');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].condition).toBe('B');
  });

  it('parses EN product with [Condition C]', () => {
    const li = buildProductItem('999', 'Card [R] { 001 / 100 } [SV1] 300円(tax included) Quantity in stock: 1 [Condition C]');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].condition).toBe('C');
  });
});

describe('extractCardrushListings — deduplication', () => {
  it('deduplicates products by product ID', () => {
    const li1 = buildProductItem('12345', 'カード1【R】{001/100} [SV1] 1,000円(税込) 在庫数1');
    const li2 = buildProductItem('12345', 'カード2【R】{002/100} [SV1] 2,000円(税込) 在庫数1');
    document.body.appendChild(li1);
    document.body.appendChild(li2);

    const listings = extractCardrushListings();

    expect(listings).toHaveLength(1); // deduplicated by product ID
  });
});

describe('extractCardrushListings — lenient fallback', () => {
  it('includes product with price but no strict format match', () => {
    // No 【RARITY】{number/total} [setCode] pattern, but has price
    const li = buildProductItem('111', 'Some random product name 1,500円(税込) 在庫数2');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings).toHaveLength(1);
    expect(listings[0].price).toBe(1500);
    expect(listings[0].rarity).toBeNull();
    expect(listings[0].cardNumber).toBeNull();
    expect(listings[0].setCode).toBeNull();
  });
});

describe('extractCardrushListings — recently viewed / recommendation sections', () => {
  it('ignores product links inside a section whose heading says recently viewed', () => {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = '最近チェックした商品';
    section.appendChild(heading);
    section.appendChild(buildProductItem('51076', 'ニンフィアex'));
    section.appendChild(buildProductItem('62013', 'ロケット団のファイヤーex'));
    document.body.appendChild(section);

    const real = buildProductItem('12345', 'カード【R】{096/081} [XY7] 800円(税込) 在庫数2');
    document.body.appendChild(real);

    const listings = extractCardrushListings();

    expect(listings).toHaveLength(1);
    expect(listings[0].productUrl).toBe('https://www.cardrush-pokemon.jp/product/12345');
  });

  it('ignores product links inside a container marked as recently viewed', () => {
    const section = document.createElement('div');
    section.className = 'recently-viewed-items';
    section.appendChild(buildProductItem('51076', 'ニンフィアex 500円(税込)'));
    document.body.appendChild(section);

    expect(extractCardrushListings()).toHaveLength(0);
  });

  it('ignores a product link with no parsed price (history tile)', () => {
    document.body.appendChild(buildProductItem('51076', 'ニンフィアex'));

    expect(extractCardrushListings()).toHaveLength(0);
  });

  it('keeps a lenient listing when it has a price', () => {
    document.body.appendChild(buildProductItem('51076', 'ニンフィアex 1,500円(税込) 在庫数1'));

    const listings = extractCardrushListings();

    expect(listings).toHaveLength(1);
    expect(listings[0].price).toBe(1500);
  });
});

describe('extractCardrushListings — card number whitespace normalization', () => {
  it('normalizes "212 / 187" to "212/187" in EN format', () => {
    const li = buildProductItem('123', 'Card [R] { 212 / 187 } [SV1] 1,000円(tax included) Quantity in stock: 1 [Condition A]');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].cardNumber).toBe('212/187');
  });

  it('preserves "212/187" in JP format (no spaces)', () => {
    const li = buildProductItem('456', 'カード【R】{212/187} [SV1] 1,000円(税込) 在庫数1');
    document.body.appendChild(li);

    const listings = extractCardrushListings();

    expect(listings[0].cardNumber).toBe('212/187');
  });
});
