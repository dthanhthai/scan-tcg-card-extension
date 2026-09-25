// Collectr (app.getcollectr.com) price scraper.
//
// Collectr is a Next.js SPA. The ?query= URL parameter does not trigger
// search rendering in automated windows, so we open the homepage, wait for
// the SPA to load, then type the query into the search input and submit.
//
// Depends on constants.js (COLLECTR_SEARCH_URL) and
// content-scripts/collectr-extractor.js (extractCollectrListings)
// being loaded first via importScripts() in the service worker.

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

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractCollectrListings,
    });
    const raw = (results && results[0] && results[0].result) || { listings: [] };
    const listings = raw.listings || [];
    console.log('[collectr] extracted listings:', listings.length, listings.slice(0, 3).map(l => ({ condition: l.condition, price: l.price, productName: l.productName })));
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
