// Injected into a real app.getcollectr.com tab via chrome.scripting.executeScript.
// Runs INSIDE the Collectr SPA's DOM context after the search URL has loaded
// and results have rendered. Extracts product cards from the DOM.
//
// Collectr renders results as <div class="product-card ..."> (NOT <a> tags),
// so we select by class and parse the text content for name, set, number, price.

function extractCollectrListings() {
  const listings = [];
  const seen = new Set();
  // Cards whose text carried no price, reported back to the service worker: logs
  // written here go to the Collectr tab's console, which is not where the scan is
  // debugged from.
  const unpricedTexts = [];

  const cards = document.querySelectorAll('div.product-card');
  for (const card of cards) {
    const text = card.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const priceMatch = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    // Dollars only, on purpose. Collectr renders prices in the account's chosen
    // currency, so a card can read "₫4,069,164" — a number that must NOT be
    // mistaken for dollars, since everything else the extension shows is USD. A
    // card without a "$" price falls back to the API's latest point in
    // lib/collectr-scraper.js.
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
    if (price == null && unpricedTexts.length < 3) {
      // Two ways a price goes missing: the card renders before its price arrives,
      // or the price sits beside the card instead of inside it. Both texts say
      // which, and the parent text would carry a price in the second case. The
      // markup is included so the card's element structure can be read off it,
      // which is also what a product name has to be picked out of.
      unpricedTexts.push({
        cardText: text.substring(0, 200),
        parentText: (card.parentElement ? card.parentElement.textContent : '').replace(/\s+/g, ' ').trim().substring(0, 200),
        html: card.innerHTML.substring(0, 700),
      });
    }
    const numberMatch = text.match(/(\d{1,3}\/\d{1,3})/);
    const cardNumber = numberMatch ? numberMatch[1] : '';

    // The card has its own name element. The text regex below only matched names
    // followed by "(JP)"/"(EN)", so a name carrying its own parentheses — "Glaceon V
    // (Alternate Art Full)" — fell through to a 60-character cut of the whole card
    // text, which then never matched the card name during listing selection.
    const nameEl = card.querySelector('span.text-card-foreground') || card.querySelector('span.line-clamp-2');
    const elementName = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
    const nameMatch = text.match(/^([A-Za-z][A-Za-z0-9\s.'\-]+?)\s*\((?:JP|EN)\)/);
    const productName = elementName || (nameMatch ? nameMatch[1].trim() : text.substring(0, 60));

    let productUrl = location.href;
    const innerLink = card.querySelector('a[href*="/explore/product/"], a[href*="/product/"]');
    if (innerLink) {
      productUrl = innerLink.href;
    } else {
      const img = card.querySelector('img[src*="product_"]');
      if (img) {
        const srcMatch = img.src.match(/product_(\d+)/);
        if (srcMatch) {
          productUrl = `https://app.getcollectr.com/explore/product/${srcMatch[1]}`;
        }
      }
    }

    const cardImg = card.querySelector('img');
    const imageUrl = cardImg ? cardImg.src : null;
    console.log('[collectr] image:', { productUrl, imageUrl });

    const conditionMatch = text.match(/(Normal|Holofoil|Reverse Holofoil|Reverse Holo)/i);
    const condition = conditionMatch ? conditionMatch[1] : null;

    const key = `${productName}-${cardNumber}-${price}-${condition}`;
    if (seen.has(key)) continue;
    seen.add(key);

    listings.push({
      productName,
      cardNumber,
      price,
      productUrl,
      condition,
      imageUrl,
    });
  }

  return { listings: listings.slice(0, 10), unpricedTexts };
}

/**
 * Standalone entry point used by lib/collectr-scraper.js on the Collectr search
 * page. Returns the price history of every product card the page is showing.
 *
 * MUST be injected with { world: 'MAIN' }: the data comes from Collectr's own API
 * (api-v2.getcollectr.com), which sits behind a CloudFront WAF that answers 403 to
 * anything that is not a browser request from the app origin — plain curl cannot
 * reach it at all. Issuing the request from the Collectr page itself supplies the
 * origin, the headers and the cookies the WAF expects.
 *
 * Anonymous access is enough and deliberate: the page's own client falls back to
 * the nil UUID as the username, so no session token is read, sent or logged here.
 *
 * Product ids come from the cards already on the page, so this takes no arguments.
 * Returns [{ productId, ok, status?, body? }].
 */
async function extractCollectrPriceHistories() {
  const ANONYMOUS_USERNAME = '00000000-0000-0000-0000-000000000000';
  // Must cover every listing extractCollectrListings can return (10): the lookup
  // picks a listing by card number out of that whole list, so a smaller cap here
  // would silently leave the picked one without a chart.
  const MAX_PRODUCTS = 10;
  const productIds = [];
  for (const card of document.querySelectorAll('div.product-card')) {
    const link = card.querySelector('a[href*="/explore/product/"], a[href*="/product/"]');
    const img = card.querySelector('img[src*="product_"]');
    const match = (link ? link.getAttribute('href') : '').match(/\/product\/(\d+)/)
      || (img ? (img.getAttribute('src') || '').match(/product_(\d+)/) : null);
    if (!match || productIds.includes(match[1])) continue;
    productIds.push(match[1]);
    if (productIds.length >= MAX_PRODUCTS) break;
  }
  return Promise.all(productIds.map(async (productId) => {
    const url = `https://api-v2.getcollectr.com/catalog/products/${productId}?username=${ANONYMOUS_USERNAME}&details=true`;
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return { productId, ok: false, status: response.status };
      return { productId, ok: true, status: response.status, body: await response.json() };
    } catch (err) {
      return { productId, ok: false, error: String((err && err.message) || err) };
    }
  }));
}
