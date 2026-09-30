// Injected into a real tcgplayer.com search tab via chrome.scripting.executeScript.
// Runs INSIDE the TCGPlayer search page DOM after JavaScript has rendered
// product listings. Extracts product cards with name, price, and URL.
//
// This file is loaded by the background service worker only to keep the
// function's source in one readable place; the function itself is passed
// directly to chrome.scripting.executeScript({ func: extractTcgplayerListings }).

function extractTcgplayerListings() {
  const listings = [];
  const seen = new Set();

  // TCGPlayer search results link to /product/{id}
  const links = document.querySelectorAll('a[href*="/product/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const idMatch = href.match(/\/product\/(\d+)/);
    if (!idMatch || seen.has(idMatch[1])) continue;
    seen.add(idMatch[1]);

    // Walk up to find the product card container that has price text
    let container = link;
    for (let i = 0; i < 6; i++) {
      const parent = container.parentElement;
      if (!parent) break;
      const parentText = parent.textContent || '';
      if (parentText.includes('$') || parentText.match(/\d+\.\d{2}/)) {
        container = parent;
        break;
      }
      container = parent;
    }

    const text = container.textContent.replace(/\s+/g, ' ').trim();
    const priceMatch = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    const productName = link.textContent.trim().split(/\s{2,}/)[0] || text.substring(0, 80);
    const productUrl = href.startsWith('http') ? href : `https://www.tcgplayer.com${href}`;
    const img = container.querySelector('img');
    const isPlaceholder = (url) => !url || url.startsWith('data:image/gif') || url.startsWith('data:image/png');
    let imageUrl = null;
    if (img) {
      const candidates = [
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.dataset.src,
        img.dataset.lazySrc,
        img.srcset ? img.srcset.split(' ')[0] : null,
        img.src,
      ];
      for (const c of candidates) {
        if (!isPlaceholder(c) && c.startsWith('http')) { imageUrl = c; break; }
      }
    }
    if (!imageUrl && idMatch[1]) {
      imageUrl = `https://tcgplayer-cdn.tcgplayer.com/product/${idMatch[1]}_in_1000x1000.jpg`;
    }
    console.log('[tcgplayer] search image:', { id: idMatch[1], imageUrl: imageUrl || '(placeholder/none)', rawSrc: img ? img.src : null });

    listings.push({ productName, price, productUrl, imageUrl });
  }

  return listings.slice(0, 10);
}

/**
 * Extracts Market Price and Most Recent Sale from a TCGPlayer product detail page.
 * TCGPlayer renders these in a "Price Points" section with label/value pairs.
 * Returns { marketPrice, mostRecentSale, listingPrice } — any may be null.
 */
function extractTcgplayerDetailPrices() {
  const parsePrice = (text) => {
    if (!text) return null;
    const m = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  };

  let marketPrice = null;
  let mostRecentSale = null;
  let listingPrice = null;

  // Find a price for a label by looking for <tr> rows where first <td> is the
  // label and second <td> is the price. This matches TCGPlayer's table
  // structure directly: <tr><td>Market Price</td><td>$0.14</td></tr>
  // Skips "N/A" values to find the actual price in another table.
  const findLabelPrice = (labelPattern) => {
    const rows = document.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;
      const labelText = (cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (!labelPattern.test(labelText) || labelText.length > 40) continue;
      const p = parsePrice(cells[1].textContent);
      if (p != null) return p;
    }
    return null;
  };

  marketPrice = findLabelPrice(/^Market\s*Price\s*:?\s*$/i);
  mostRecentSale = findLabelPrice(/^Most\s*Recent\s*Sale\s*:?\s*$/i);

  const bodyText = document.body ? document.body.textContent : '';

  // Strategy 2: Regex fallback on full body text — find the LAST occurrence
  // (Price Points section usually appears once, but search results text above
  // may also contain "Market Price" with a different value).
  if (marketPrice == null) {
    const matches = [...bodyText.matchAll(/Market\s*Price[\s:]*\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi)];
    if (matches.length > 0) marketPrice = parseFloat(matches[matches.length - 1][1].replace(/,/g, ''));
  }
  if (mostRecentSale == null) {
    const matches = [...bodyText.matchAll(/Most\s*Recent\s*Sale[\s:]*\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi)];
    if (matches.length > 0) mostRecentSale = parseFloat(matches[matches.length - 1][1].replace(/,/g, ''));
  }

  // Listing price = "Add to Cart" button area price
  const addToCart = document.querySelector('[class*="add-to-cart"], [class*="addToCart"], button[class*="cart"]');
  if (addToCart) {
    const container = addToCart.closest('section, div, article') || addToCart.parentElement;
    if (container) {
      const p = parsePrice(container.textContent);
      if (p != null) listingPrice = p;
    }
  }
  // Fallback: look for "Add to Cart" text nearby
  if (listingPrice == null) {
    const m = bodyText.match(/Add\s*to\s*Cart[\s\S]{0,100}?\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
    if (m) listingPrice = parseFloat(m[1].replace(/,/g, ''));
  }

  // Alternative printings/conditions: parse "Market prices for alternative
  // printings and conditions" section. Each row has a condition label
  // (Normal, Holofoil, Reverse Holofoil, etc.) and a market price.
  // Structure (from debug): <tr><td>Normal</td><td>$0.14</td></tr>
  const alternativePrices = [];
  const conditions = ['Normal', 'Holofoil', 'Reverse Holofoil', '1st Edition', '1st Edition Holofoil', 'Unlimited', 'Unlimited Holofoil'];

  // Find all <tr> rows containing a condition label in first <td> and a price
  // in a subsequent <td>. This handles TCGPlayer's table structure directly.
  const rows = document.querySelectorAll('tr');
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const labelText = cells[0].textContent.replace(/\s+/g, ' ').trim();
    if (labelText.length > 40) continue;
    const condMatch = conditions.find((c) => labelText.toLowerCase() === c.toLowerCase());
    if (!condMatch) continue;
    // Find price in subsequent cells
    for (let ci = 1; ci < cells.length; ci++) {
      const p = parsePrice(cells[ci].textContent);
      if (p != null && !alternativePrices.some((a) => a.condition === condMatch)) {
        alternativePrices.push({ condition: condMatch, marketPrice: p });
        break;
      }
    }
  }

  // Extract product image from detail page (larger/more reliable than search)
  let imageUrl = null;
  const isPlaceholder = (url) => !url || url.startsWith('data:image/gif') || url.startsWith('data:image/png');
  // Strategy 1: og:image / twitter:image meta tags (most reliable for SPA pages)
  const ogImage = document.querySelector('meta[property="og:image"]')?.content;
  if (!isPlaceholder(ogImage)) imageUrl = ogImage;
  // Strategy 2: product image containers with lazy-load support
  if (!imageUrl) {
    const detailImg = document.querySelector('img[src*="product/"], .product-image img, [class*="product-image"] img, [class*="product-card"] img, [data-testid*="product-image"] img');
    if (detailImg) {
      const candidates = [
        detailImg.getAttribute('data-src'),
        detailImg.getAttribute('data-lazy-src'),
        detailImg.dataset.src,
        detailImg.dataset.lazySrc,
        detailImg.srcset ? detailImg.srcset.split(' ')[0] : null,
        detailImg.src,
      ];
      for (const c of candidates) {
        if (!isPlaceholder(c) && c.startsWith('http')) { imageUrl = c; break; }
      }
    }
  }
  console.log('[tcgplayer] detail image:', { imageUrl, ogImage });

  return { marketPrice, mostRecentSale, listingPrice, alternativePrices, imageUrl };
}

/**
 * Standalone entry point used by lib/tcgplayer-scraper.js on the TCGPlayer search
 * page. Returns the price history of every product card the page is showing.
 *
 * MUST be injected with { world: 'MAIN' }: the data comes from TCGPlayer's
 * internal API (infinite-api.tcgplayer.com), which answers 403 to anything that is
 * not a browser request from the tcgplayer.com origin — it needs the page's
 * cookies and it needs to be issued from that origin for CORS to allow it. An
 * isolated-world fetch cannot satisfy either.
 *
 * Runs on the search page rather than a detail page on purpose: the lookup picks a
 * listing by card number out of everything the search returned, so the history has
 * to cover every card. Attaching it only to the listing whose detail page happened
 * to be opened left the chart with no TCGPlayer line whenever a later printing won
 * the pick (observed: Glaceon V 175/203, whose alternate art is not the first
 * result).
 *
 * Product ids come from the links already on the page, so this takes no arguments.
 * Returns [{ productId, ok, status?, body? }].
 */
async function extractTcgplayerPriceHistories() {
  // Must cover every listing extractTcgplayerListings can return (10).
  const MAX_PRODUCTS = 10;
  const productIds = [];
  for (const link of document.querySelectorAll('a[href*="/product/"]')) {
    const match = (link.getAttribute('href') || '').match(/\/product\/(\d+)/);
    if (!match || productIds.includes(match[1])) continue;
    productIds.push(match[1]);
    if (productIds.length >= MAX_PRODUCTS) break;
  }
  return Promise.all(productIds.map(async (productId) => {
    // "annual" is the longest range the API offers (the page's 1Y button);
    // shorter periods are filtered locally when the chart is drawn.
    const url = `https://infinite-api.tcgplayer.com/price/history/${productId}?range=annual`;
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return { productId, ok: false, status: response.status };
      return { productId, ok: true, status: response.status, body: await response.json() };
    } catch (err) {
      return { productId, ok: false, error: String((err && err.message) || err) };
    }
  }));
}
