// Collectr (app.getcollectr.com) price scraper.
//
// Collectr is a Next.js SPA. The ?query= URL parameter does not trigger
// search rendering in automated windows, so we open the homepage, wait for
// the SPA to load, then type the query into the search input and submit.
//
// Depends on constants.js (COLLECTR_SEARCH_URL) and
// content-scripts/collectr-extractor.js (extractCollectrListings,
// extractCollectrPriceHistories) being loaded first via importScripts() in the
// service worker.

// Collectr marks the ungraded rows of a price history with this grade id; the
// page's own chart filters on the same value.
const COLLECTR_UNGRADED_GRADE_ID = '52';

/**
 * Normalizes the raw product body from Collectr's API
 * (api-v2.getcollectr.com/catalog/products/{id}?details=true) into the shape the
 * chart renderer uses.
 *
 * The body holds { data: { ungraded_sub_types: [{ product_sub_type }],
 * price_history: [{ product_sub_type, grade_id, insertion_date, price }] } }.
 * The chart draws a single line, so one printing wins: Normal, then Holofoil,
 * then Reverse Holofoil, then whatever the product actually has — the same order
 * the TCGPlayer normalizer uses.
 *
 * The page's own transform keys the series by day and lets the last row win, so
 * this does the same instead of emitting two points for one day.
 *
 * @param {object|null} raw - the parsed API body
 * @returns {{variant: string, points: number[][]}|null} points are
 *   [timestampMs, priceCents] ascending, or null when nothing is usable
 */
function normalizeCollectrPriceHistory(raw) {
  const data = raw && raw.data;
  const history = data && Array.isArray(data.price_history) ? data.price_history : null;
  if (!history || history.length === 0) return null;
  const ungradedTypes = Array.isArray(data.ungraded_sub_types)
    ? data.ungraded_sub_types.map((entry) => entry.product_sub_type).filter(Boolean)
    : [];
  const variant = PRICE_CHART_PREFERRED_PRINTINGS.find((name) => ungradedTypes.includes(name))
    || ungradedTypes[0]
    || history.filter((row) => row.grade_id === COLLECTR_UNGRADED_GRADE_ID).map((row) => row.product_sub_type)[0]
    || null;
  if (!variant) return null;
  const byDay = new Map();
  for (const row of history) {
    if (row.product_sub_type !== variant) continue;
    if (row.grade_id !== COLLECTR_UNGRADED_GRADE_ID) continue;
    const timestamp = Date.parse(row.insertion_date);
    const price = parseFloat(row.price);
    if (Number.isNaN(timestamp) || Number.isNaN(price)) continue;
    byDay.set(timestamp, Math.round(price * 100));
  }
  if (byDay.size === 0) return null;
  const points = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  return { variant, points };
}

/**
 * Asks the already-open Collectr tab for every product's price history. The
 * injected function has to run in the page's MAIN world — see
 * extractCollectrPriceHistories in content-scripts/collectr-extractor.js.
 * @param {number} tabId
 * @returns {Promise<Map<string, {variant: string, points: number[][]}>>} keyed by product id
 */
async function fetchCollectrPriceHistoriesFromTab(tabId) {
  const byProductId = new Map();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: extractCollectrPriceHistories,
    });
    const payloads = readInjectionResult(results);
    if (!Array.isArray(payloads)) {
      console.log('[collectr] price history unavailable: no payload, got', JSON.stringify(results && results[0]));
      return byProductId;
    }
    for (const payload of payloads) {
      if (!payload || !payload.ok) {
        const detail = payload ? (payload.status || payload.error) : 'no payload';
        console.log('[collectr] price history unavailable for', payload ? payload.productId : '?', detail);
        continue;
      }
      const history = normalizeCollectrPriceHistory(payload.body);
      if (history) byProductId.set(payload.productId, history);
      else console.log('[collectr] price history had no usable series for', payload.productId, JSON.stringify(payload.body).slice(0, 200));
    }
  } catch (err) {
    console.log('[collectr] price history fetch failed:', err.message);
  }
  return byProductId;
}

/**
 * Fetches Collectr search results (via a visible window) and returns
 * parsed product listings with prices in USD.
 *
 * @param {string} query - search keyword, e.g. "pikachu 028/071"
 * @returns {Promise<{success: boolean, data: {listings: object[], searchUrl: string}, error?: string}>}
 */
async function fetchCollectrPrice(query) {
  const searchUrl = `${COLLECTR_SEARCH_URL}/?query=${encodeURIComponent(query)}`;
  try {
    const listings = await scrapeCollectrViaTab(query);
    if (listings.length > 0) {
      return { success: true, data: { listings, searchUrl } };
    }
  } catch (err) {
    return { success: false, error: err.message, data: { listings: [], searchUrl } };
  }
  return { success: false, error: 'No Collectr listings found', data: { listings: [], searchUrl } };
}

async function scrapeCollectrViaTab(query) {
  const searchUrl = `${COLLECTR_SEARCH_URL}/?query=${encodeURIComponent(query)}`;
  const win = await chrome.windows.create({
    url: searchUrl,
    type: 'normal',
    state: 'normal',
    width: 200,
    height: 150,
    focused: false,
  });
  const tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
  const windowId = win.id;
  if (!tabId) {
    await chrome.windows.remove(windowId).catch(() => {});
    throw new Error('Failed to create Collectr window');
  }
  try {
    await waitForTabLoadGeneric(tabId);
    await waitForCollectrSpaReady(tabId);
    await waitForCollectrResults(tabId);

    // Both injections only read the page, so they run together: the history fetch
    // then costs max(...) instead of adding its own duration to the listings
    // extraction, which sits on the critical path of the whole lookup.
    const [results, histories] = await Promise.all([
      chrome.scripting.executeScript({
        target: { tabId },
        func: extractCollectrListings,
      }),
      fetchCollectrPriceHistoriesFromTab(tabId),
    ]);
    const raw = (results && results[0] && results[0].result) || { listings: [] };
    const listings = raw.listings || [];
    console.log('[collectr] extracted listings:', listings.length, listings.slice(0, 3).map(l => ({ condition: l.condition, price: l.price, productName: l.productName })));
    if (raw.unpricedTexts && raw.unpricedTexts.length > 0) {
      console.log('[collectr] cards whose text carried no price:', raw.unpricedTexts);
    }

    // The chart draws whichever listing the lookup later picks, and that pick
    // happens in card-lookup, so every listing gets its own history attached here.
    for (const listing of listings) {
      const match = (listing.productUrl || '').match(/\/product\/(\d+)/);
      const history = match ? histories.get(match[1]) : null;
      if (!history) continue;
      listing.chartData = history;
      // A search card can render without a price. The history ends at today, so its
      // last point is the current market price and beats showing "No price found." —
      // it also matches what Collectr's own product page quotes.
      if (listing.price == null) {
        const last = history.points[history.points.length - 1];
        listing.price = last[1] / 100;
        listing.priceFromHistory = true;
      }
    }
    console.log('[collectr] chart series:', listings
      .map((listing) => (listing.chartData ? `${listing.chartData.variant}:${listing.chartData.points.length}` : 'none'))
      .join(', '));
    console.log('[collectr] prices:', listings.map((listing) => `${listing.price}${listing.priceFromHistory ? ' (from history)' : ''}`).join(', '));
    return listings;
  } finally {
    chrome.windows.remove(windowId).catch(() => {});
  }
}

async function waitForCollectrSpaReady(tabId, maxAttempts = 15, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const inputs = document.querySelectorAll('input');
          return Array.from(inputs).map((i) => ({
            placeholder: i.placeholder || '',
            type: i.type || '',
            name: i.name || '',
          }));
        },
      });
      const inputs = (results && results[0] && results[0].result) || [];
      if (inputs.length > 0) {
        console.log(`[collectr] SPA ready after ${i + 1} attempts, inputs:`, inputs);
        return;
      }
    } catch (err) {
      // tab may not be ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('[collectr] SPA not ready after all attempts');
}

async function waitForCollectrResults(tabId, maxAttempts = 15, delayMs = 1000) {
  let emptyStreak = 0;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const productCards = document.querySelectorAll('div.product-card').length;
          const bodyText = document.body ? document.body.textContent.toLowerCase() : '';
          const hasNoResults = bodyText.includes('no results') || bodyText.includes('no products found');
          return { productCards, hasNoResults };
        },
      });
      const counts = (results && results[0] && results[0].result) || {};
      if (counts.productCards > 0) {
        console.log(`[collectr] found ${counts.productCards} product cards after ${i + 1} attempts`, counts);
        return;
      }
      if (counts.hasNoResults) {
        emptyStreak++;
        if (emptyStreak >= 2) {
          console.log(`[collectr] no results found after ${i + 1} attempts (stable)`);
          return;
        }
      } else {
        emptyStreak = 0;
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
      func: () => {
        const links = Array.from(document.querySelectorAll('a')).slice(0, 30).map((a) => a.getAttribute('href') || '');
        const inputs = Array.from(document.querySelectorAll('input')).map((i) => `${i.type}:"${i.placeholder}"="${i.value}"`);
        // Find elements with price-like text ($ or decimal)
        const priceElements = [];
        const allElements = document.querySelectorAll('div, span, p, a, button');
        for (const el of allElements) {
          if (priceElements.length >= 10) break;
          const text = el.textContent || '';
          if (text.length < 200 && text.length > 5 && (text.includes('$') || text.match(/\d+\.\d{2}/))) {
            priceElements.push(`<${el.tagName.toLowerCase()} href="${el.getAttribute('href') || ''}" role="${el.getAttribute('role') || ''}" class="${(el.className || '').substring(0, 50)}"> ${text.trim().substring(0, 80)}`);
          }
        }
        // Also check for clickable divs (role=button, onclick, etc.)
        const clickableDivs = [];
        const clickables = document.querySelectorAll('[role="button"], [role="link"], [onclick]');
        for (const el of clickables) {
          if (clickableDivs.length >= 10) break;
          clickableDivs.push(`<${el.tagName.toLowerCase()} role="${el.getAttribute('role') || ''}" href="${el.getAttribute('href') || ''}"> ${el.textContent.trim().substring(0, 80)}`);
        }
        return {
          title: document.title,
          url: location.href,
          allLinks: document.querySelectorAll('a').length,
          productLinks: document.querySelectorAll('a[href*="/explore/product/"]').length,
          anyProductLinks: document.querySelectorAll('a[href*="/product/"]').length,
          sampleHrefs: links,
          inputs,
          priceElements,
          clickableDivs,
          bodyText: document.body ? document.body.textContent.substring(0, 2000) : '',
        };
      },
    });
    console.log('[collectr] DEBUG priceElements:', JSON.stringify(debug[0]?.result?.priceElements, null, 2));
    console.log('[collectr] DEBUG clickableDivs:', JSON.stringify(debug[0]?.result?.clickableDivs, null, 2));
    console.log('[collectr] DEBUG inputs:', JSON.stringify(debug[0]?.result?.inputs, null, 2));
    console.log('[collectr] no results. Full state:', debug[0]?.result);
  } catch (err) {
    console.log('[collectr] could not get debug info:', err.message);
  }
}
