// TCGPlayer (tcgplayer.com) price scraper.
//
// TCGPlayer is a React SPA that may not render results in hidden tabs
// (checks document.visibilityState). We override the visibility API
// after page load to force rendering, then extract product cards.
//
// Depends on constants.js (TCGPLAYER_SEARCH_URL) and
// content-scripts/tcgplayer-extractor.js (extractTcgplayerListings)
// being loaded first via importScripts() in the service worker.

/**
 * Fetches TCGPlayer search results (via a hidden tab) and returns
 * parsed product listings with prices in USD.
 *
 * @param {string} query - search keyword, e.g. "Pikachu 028/071"
 * @returns {Promise<{success: boolean, data: {listings: object[], searchUrl: string}, error?: string}>}
 */
async function fetchTcgplayerPrice(query) {
  const searchUrl = `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(query)}&view=grid`;
  try {
    const listings = await scrapeTcgplayerViaTab(searchUrl);
    if (listings.length > 0) {
      // Enrich first listing with detail-page prices (Market Price, Most Recent Sale)
      const enriched = await enrichTcgplayerWithDetailPrices(listings);
      return { success: true, data: { listings: enriched, searchUrl } };
    }
  } catch (err) {
    return { success: false, error: err.message, data: { listings: [], searchUrl } };
  }
  return { success: false, error: 'No TCGPlayer listings found', data: { listings: [], searchUrl } };
}

/**
 * Opens the first listing's product detail page and extracts
 * Market Price and Most Recent Sale. Falls back gracefully if
 * the detail page can't be loaded or parsed.
 */
async function enrichTcgplayerWithDetailPrices(listings) {
  if (!listings.length) return listings;
  const first = listings[0];
  const productUrl = first.productUrl;
  if (!productUrl) return listings;

  const { tabId, windowId } = await openMinimizedTab(productUrl);
  try {
    await waitForTabLoadGeneric(tabId);
    await waitForTcgplayerDetailRender(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractTcgplayerDetailPrices,
    });
    const detail = (results && results[0] && results[0].result) || {};
    console.log('[tcgplayer] detail prices:', { marketPrice: detail.marketPrice, mostRecentSale: detail.mostRecentSale, listingPrice: detail.listingPrice, alternativeCount: detail.alternativePrices ? detail.alternativePrices.length : 0, alternativePrices: detail.alternativePrices });
    // Merge detail prices into the first listing
    first.marketPrice = detail.marketPrice != null ? detail.marketPrice : null;
    first.mostRecentSale = detail.mostRecentSale != null ? detail.mostRecentSale : null;
    first.alternativePrices = detail.alternativePrices || [];
    // listingPrice from search = first.price (Add to Cart)
    first.listingPrice = first.price;
    // Prefer detail page image (larger, more reliable); fallback to search image
    if (detail.imageUrl) first.imageUrl = detail.imageUrl;
  } catch (err) {
    console.log('[tcgplayer] detail enrichment failed:', err.message);
    first.marketPrice = null;
    first.mostRecentSale = null;
    first.listingPrice = first.price;
  } finally {
    closeMinimizedTab(tabId, windowId);
  }
  return listings;
}

/**
 * Polls until TCGPlayer product detail page renders price points.
 * Looks for "Market Price" or "Most Recent Sale" text in the DOM.
 */
async function waitForTcgplayerDetailRender(tabId, maxAttempts = 20, delayMs = 1000) {
  let visibilityInjected = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (!visibilityInjected) {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
          },
        });
        visibilityInjected = true;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = document.body ? document.body.textContent : '';
          const hasMarket = /Market\s*Price/i.test(text);
          const hasRecentSale = /Most\s*Recent\s*Sale/i.test(text);
          const hasAddToCart = /Add\s*to\s*Cart/i.test(text);
          const hasAlternative = /alternative\s+printings/i.test(text);
          let saleHasPrice = false;
          const rows = document.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) continue;
            const label = (cells[0].textContent || '').trim();
            if (/Most\s*Recent\s*Sale/i.test(label)) {
              const val = (cells[1].textContent || '').trim();
              if (/\$/.test(val) && !/N\/A/i.test(val)) saleHasPrice = true;
            }
          }
          return { hasMarket, hasRecentSale, hasAddToCart, hasAlternative, saleHasPrice };
        },
      });
      const state = (results && results[0] && results[0].result) || {};
      if (state.hasMarket && state.hasRecentSale && state.hasAlternative && state.saleHasPrice) {
        console.log(`[tcgplayer] detail page ready after ${i + 1} attempts`, state);
        return;
      }
      if (state.hasAddToCart && i > 5) {
        console.log(`[tcgplayer] detail page has Add to Cart but no price points after ${i + 1} attempts`, state);
        return;
      }
    } catch (err) {
      // tab may not be ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('[tcgplayer] detail page render timed out');
}

async function scrapeTcgplayerViaTab(searchUrl) {
  const { tabId, windowId } = await openMinimizedTab(searchUrl);
  try {
    await waitForTabLoadGeneric(tabId);
    await waitForTcgplayerResults(tabId);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractTcgplayerListings,
    });
    const listings = (results && results[0] && results[0].result) || [];
    console.log('[tcgplayer] extracted listings:', listings.length, listings.slice(0, 2));
    return listings;
  } finally {
    closeMinimizedTab(tabId, windowId);
  }
}

/**
 * Polls until TCGPlayer's JS renders product links (a[href*="/product/"])
 * or until "0 results" text appears (search completed with no results).
 */
async function waitForTcgplayerResults(tabId, maxAttempts = 25, delayMs = 1000) {
  let zeroResultStreak = 0;
  let visibilityInjected = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (!visibilityInjected) {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
          },
        });
        visibilityInjected = true;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const links = document.querySelectorAll('a[href*="/product/"]').length;
          const bodyText = document.body ? document.body.textContent : '';
          // Only trust "0 results" if the search results container has rendered
          // (SPA may show "0 results" in filters/sidebar before actual results load)
          const resultsContainer = document.querySelector('[class*="search-results"], [class*="results-grid"], [data-testid*="results"], .search-results-container');
          const hasZeroResults = resultsContainer && links === 0 && /0\s+results/i.test(bodyText);
          return { links, hasZeroResults };
        },
      });
      const state = (results && results[0] && results[0].result) || {};
      if (state.links > 0) {
        console.log(`[tcgplayer] found ${state.links} product links after ${i + 1} attempts`);
        return;
      }
      if (state.hasZeroResults && state.links === 0) {
        zeroResultStreak++;
        if (zeroResultStreak >= 5) {
          console.log(`[tcgplayer] search completed with 0 results after ${i + 1} attempts (stable)`);
          return;
        }
      } else {
        zeroResultStreak = 0;
      }
    } catch (err) {
      // tab may not be ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Debug: log page state when no results found
  try {
    const debug = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        url: location.href,
        allLinks: document.querySelectorAll('a').length,
        productLinks: document.querySelectorAll('a[href*="/product/"]').length,
        bodyText: document.body ? document.body.textContent.substring(0, 500) : '',
      }),
    });
    console.log('[tcgplayer] no results after all attempts. Page state:', debug[0]?.result);
  } catch (err) {
    console.log('[tcgplayer] could not get debug info:', err.message);
  }
}
