// PriceCharting (pricecharting.com) price scraper.
//
// PriceCharting renders prices with JavaScript and may show a Cloudflare
// challenge. Uses a minimized window (same as CardRush) to load the search
// page, detect CF challenges, and inject extractPricechartingListings()
// to parse the #games_table.
//
// Depends on constants.js (PRICECHARTING_SEARCH_URL),
// lib/tab-helper.js (openMinimizedTab, closeMinimizedTab, waitForTabLoadGeneric),
// and content-scripts/pricecharting-extractor.js (extractPricechartingListings)
// being loaded first via importScripts() in the service worker.

/**
 * Builds a PriceCharting search URL for a card query.
 * @param {string} query - e.g. "Clefairy 086/080"
 * @returns {string}
 */
function buildPricechartingSearchUrl(query) {
  return `${PRICECHARTING_SEARCH_URL}?q=${encodeURIComponent(query)}&type=prices`;
}

/**
 * Reads the printed local id out of a search query.
 * "Beedrill 5/146" → "5", "Pikachu 028/071" → "028".
 * The "n/m" form wins over a bare number, because a card name can carry digits
 * of its own: "Darkrai LV.38 3/106" must yield "3", not the level, and
 * "Porygon2 25/124" must yield "25", not the "2" in the name.
 * @param {string} query
 * @returns {string|null}
 */
function extractPricechartingQueryLocalId(query) {
  const text = query || '';
  const fractionMatch = text.match(/(\d{1,4})\s*\/\s*\d{1,4}/);
  if (fractionMatch) return fractionMatch[1];
  const match = text.match(/(\d{1,3})(?:\/\d{1,3})?/);
  return match ? match[1] : null;
}

/**
 * Normalizes a product name or set name for comparison: lowercase, letters and
 * digits only, so "Leafeon VSTAR #14" compares as "leafeonvstar14".
 * @param {string} value
 * @returns {string}
 */
function normalizePricechartingText(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
}

/**
 * PriceCharting returns every printing of the card name across sets, so the
 * scanned printing can sit far down the list (observed: the XY Beedrill #5 was
 * 10th of 18 for "Beedrill 5/146"). The first listing drives both the detail
 * enrichment and the price the UI shows, so rank the listings and put the best
 * match first.
 *
 * Ranking, strongest signal first:
 * - card name: two cards can share a number (observed: "Leafeon VSTAR 014/159
 *   Sword & Storm" returned 100 rows and number-only matching picked a Charizard
 *   VSTAR #14 from another set, because Gemini had misread the set name);
 * - printed number: separates printings within the same name;
 * - set: only when the query token matches the listing's set label.
 *
 * A listing that matches nothing keeps its original position.
 *
 * @param {object[]} listings
 * @param {string} query - the search query, e.g. "Beedrill 5/146 XY"
 * @param {string} [setName] - the set token used in the query, e.g. "XY"
 * @param {string} [cardName] - the card name used in the query
 * @returns {object[]}
 */
function rankPricechartingListings(listings, query, setName, cardName) {
  const localId = extractPricechartingQueryLocalId(query);
  const setToken = typeof setName === 'string' ? setName.trim().toLowerCase() : '';
  const wantedName = normalizePricechartingText(cardName);
  if ((!localId && !setToken && !wantedName) || !listings || listings.length < 2) return listings;
  const numberPattern = localId
    ? new RegExp(`#0*${String(Number(localId))}(?!\\d)|-0*${String(Number(localId))}(?!\\d)`)
    : null;
  const ranked = listings.map((listing, index) => {
    const text = `${listing.productName || ''} ${listing.productUrl || ''}`;
    const nameMatch = wantedName ? normalizePricechartingText(listing.productName).includes(wantedName) : false;
    const numberMatch = numberPattern ? numberPattern.test(text) : false;
    const setMatch = setToken ? `${listing.setName || ''}`.toLowerCase().includes(setToken) : false;
    return { listing, index, score: (nameMatch ? 4 : 0) + (numberMatch ? 2 : 0) + (setMatch ? 1 : 0) };
  });
  if (ranked.every((entry) => entry.score === 0)) return listings;
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.listing);
}

/**
 * Fetches PriceCharting search results and returns parsed product listings
 * with ungraded/grade7/grade8 prices in USD.
 *
 * @param {string} query - search keyword, e.g. "Clefairy 086/080"
 * @returns {Promise<{success: boolean, data: {listings: object[], searchUrl: string, cfChallenge?: boolean}, error?: string}>}
 */
async function fetchPricechartingPrice(query, setName, cardName) {
  const searchUrl = buildPricechartingSearchUrl(query);
  console.log('[pricecharting] fetchPricechartingPrice called with query:', query, 'URL:', searchUrl);
  try {
    const listings = await scrapePricechartingViaTab(searchUrl);
    console.log('[pricecharting] got', listings.length, 'listings');
    if (listings.length > 0) {
      const ordered = rankPricechartingListings(listings, query, setName, cardName);
      if (ordered[0] !== listings[0]) console.log('[pricecharting] reordered to the printing matching', query);
      const enriched = await enrichPricechartingWithDetailPrices(ordered);
      return { success: true, data: { listings: enriched, searchUrl } };
    }
  } catch (err) {
    console.log('[pricecharting] error:', err.message);
    if (err.message === 'CF_CHALLENGE_STUCK') {
      return {
        success: false,
        error: 'Cloudflare challenge detected — please manually verify in the opened window',
        data: { listings: [], searchUrl, cfChallenge: true },
      };
    }
    return { success: false, error: err.message, data: { listings: [], searchUrl } };
  }
  console.log('[pricecharting] returning failure: no listings found');
  return { success: false, error: 'No PriceCharting listings found', data: { listings: [], searchUrl } };
}

/**
 * Opens the first listing's product detail page and extracts
 * recent sale data from "Ungraded Sold Listings" table.
 * Falls back gracefully if the detail page can't be loaded or parsed.
 */
async function enrichPricechartingWithDetailPrices(listings) {
  if (!listings.length) return listings;
  const first = listings[0];
  const productUrl = first.productUrl;
  if (!productUrl) return listings;

  console.log('[pricecharting] enriching detail prices for:', productUrl);
  const { tabId, windowId } = await openMinimizedTab(productUrl);
  try {
    await waitForTabLoadGeneric(tabId).catch(() => {});
    await waitForPricechartingCfChallenge(tabId, windowId);
    await waitForResultsRenderPc(tabId);
    // Wait for Ungraded tab + sold-listings table to render
    await new Promise((r) => setTimeout(r, 2000));
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPricechartingDetailSales,
    });
    const detail = (results && results[0] && results[0].result) || {};
    console.log('[pricecharting] detail sales:', detail);
    if (detail.recentSalePrice != null) {
      first.recentSalePrice = detail.recentSalePrice;
      first.recentSaleDate = detail.recentSaleDate;
    }
    if (detail.grade9Price != null) first.grade9Price = detail.grade9Price;
    if (detail.grade10Price != null) first.grade10Price = detail.grade10Price;
    if (detail.imageUrl) first.imageUrl = detail.imageUrl;
  } catch (err) {
    console.log('[pricecharting] detail enrichment failed:', err.message);
  } finally {
    closeMinimizedTab(tabId, windowId);
  }
  return listings;
}

/**
 * Opens a minimized window at searchUrl, waits for CF challenge to clear,
 * extracts listings from the real DOM, then closes the window.
 */
async function scrapePricechartingViaTab(searchUrl) {
  const { tabId, windowId } = await openMinimizedTab(searchUrl);
  let shouldKeepWindow = false;

  try {
    // Tab load may time out if Cloudflare challenge is showing (page never reaches 'complete')
    // Still proceed to CF detection in that case
    await waitForTabLoadGeneric(tabId).catch((err) => {
      console.log('[pricecharting] tab load timed out, checking for CF challenge...');
    });
    await waitForPricechartingCfChallenge(tabId, windowId);
    await waitForResultsRenderPc(tabId);

    // Scroll to trigger lazy-loaded images
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const rows = document.querySelectorAll('#games_table tbody tr');
        rows.forEach((r) => r.scrollIntoView({ block: 'nearest' }));
        window.scrollTo(0, document.body.scrollHeight);
      },
    });
    await new Promise((r) => setTimeout(r, 1000));

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPricechartingListings,
    });
    const listings = (results && results[0] && results[0].result) || [];
    console.log('[pricecharting] extracted listings:', listings.length, listings.slice(0, 2));
    return listings;
  } catch (err) {
    if (err.message === 'CF_CHALLENGE_STUCK') {
      console.log('[pricecharting] CF stuck, waiting for manual checkbox...');
      shouldKeepWindow = true;
      // Wait for user to manually tick the CF checkbox, then retry extraction
      const recovered = await waitForCfRecoveryAndRetry(tabId);
      if (recovered.length > 0) {
        console.log('[pricecharting] recovered after manual CF verification:', recovered.length, 'listings');
        shouldKeepWindow = false;
        return recovered;
      }
    }
    throw err;
  } finally {
    if (!shouldKeepWindow && windowId) {
      chrome.windows.remove(windowId).catch(() => {});
    }
  }
}

/**
 * After CF challenge is stuck and window is restored, polls for up to 120s
 * waiting for the user to manually tick the checkbox. Once CF clears,
 * waits for results to render and extracts listings.
 */
async function waitForCfRecoveryAndRetry(tabId, maxWaitMs = 120000, pollMs = 2000) {
  const maxAttempts = Math.floor(maxWaitMs / pollMs);
  for (let i = 0; i < maxAttempts; i++) {
    let title = '';
    let hasCfChallenge = false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const cfFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
          const cfBox = document.querySelector('#challenge-form, .cf-turnstile, input[name="cf-turnstile-response"]');
          return {
            title: document.title,
            hasCfChallenge: !!cfFrame || !!cfBox,
          };
        },
      });
      const state = (results && results[0] && results[0].result) || {};
      title = state.title || '';
      hasCfChallenge = state.hasCfChallenge || false;
    } catch (err) {
      // tab may have navigated; keep polling
    }
    if (title !== 'Just a moment...' && !hasCfChallenge) {
      console.log('[pricecharting] CF cleared after manual verification, waiting for results...');
      await waitForResultsRenderPc(tabId);
      const extractResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractPricechartingListings,
      });
      return (extractResults && extractResults[0] && extractResults[0].result) || [];
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  console.log('[pricecharting] CF recovery timed out after', maxWaitMs / 1000, 's');
  return [];
}

/**
 * Polls document.title until Cloudflare's "Just a moment..." interstitial
 * has been replaced by the real page. Throws CF_CHALLENGE_STUCK if the
 * challenge requires manual interaction (checkbox/turnstile).
 */
async function waitForPricechartingCfChallenge(tabId, windowId, maxAttempts = 40, delayMs = 500) {
  let windowRestored = false;
  for (let i = 0; i < maxAttempts; i++) {
    let title = '';
    let hasCfChallenge = false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const cfFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
          const cfBox = document.querySelector('#challenge-form, .cf-turnstile, input[name="cf-turnstile-response"]');
          return {
            title: document.title,
            hasCfChallenge: !!cfFrame || !!cfBox,
          };
        },
      });
      const state = (results && results[0] && results[0].result) || {};
      title = state.title || '';
      hasCfChallenge = state.hasCfChallenge || false;
    } catch (err) {
      // tab may not be ready yet; keep polling
    }
    if (title !== 'Just a moment...' && !hasCfChallenge) return;
    // Show window immediately when CF challenge detected so user can tick checkbox
    if (hasCfChallenge && !windowRestored) {
      console.log('[pricecharting] Cloudflare challenge detected, showing window for manual checkbox...');
      await restoreWindowSmall(windowId);
      windowRestored = true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('[pricecharting] Cloudflare challenge did not clear after all attempts');
  throw new Error('CF_CHALLENGE_STUCK');
}

/**
 * Polls until PriceCharting's JS renders results.
 * Detects both search results (#games_table) and product detail pages (#used_price).
 */
async function waitForResultsRenderPc(tabId, maxAttempts = 15, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const table = document.querySelector('#games_table');
          if (table && table.querySelectorAll('tbody tr').length > 0) {
            return { type: 'search', count: table.querySelectorAll('tbody tr').length };
          }
          const usedPrice = document.querySelector('#used_price');
          if (usedPrice && location.pathname.includes('/game/')) {
            return { type: 'detail', count: 1 };
          }
          return { type: 'none', count: 0 };
        },
      });
      const state = (results && results[0] && results[0].result) || { type: 'none', count: 0 };
      if (state.count > 0) {
        console.log(`[pricecharting] found ${state.count} ${state.type} rows after ${i + 1} attempts`);
        return;
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
        hasTable: !!document.querySelector('#games_table'),
        tableRows: document.querySelectorAll('#games_table tbody tr').length,
        allLinks: document.querySelectorAll('a').length,
        gameLinks: document.querySelectorAll('a[href*="/game/"]').length,
        bodyText: document.body ? document.body.textContent.substring(0, 500) : '',
      }),
    });
    console.log('[pricecharting] no results after all attempts. Page state:', debug[0]?.result);
  } catch (err) {
    console.log('[pricecharting] could not get debug info:', err.message);
  }
}
