// CardRush (cardrush-pokemon.jp) price scraper.
//
// IMPORTANT: cardrush-pokemon.jp is protected by Cloudflare's JS challenge.
// A plain fetch() (even with host_permissions) always receives the
// "Just a moment..." challenge page instead of real content, because a raw
// HTTP request cannot execute JavaScript. host_permissions only grants CORS
// access — it does NOT bypass Cloudflare.
//
// Fix: open a real (hidden) browser tab at the search URL. A real tab runs
// JavaScript, so it passes Cloudflare's automatic JS challenge (no user
// interaction needed in the common case, resolves in ~3-5s). Once the
// challenge clears, we inject extractCardrushListings() (defined in
// content-scripts/cardrush-extractor.js) into that tab to read the real DOM,
// then close the tab.
//
// Depends on constants.js (CARDRUSH_BASE_URL, CARDRUSH_SEARCH_URL) and
// content-scripts/cardrush-extractor.js (extractCardrushListings) being
// loaded first via importScripts() in the service worker.

/**
 * Builds the CardRush search URL for a raw keyword.
 * Example: "s10b 028" → ?keyword=s10b%20028
 */
function buildCardrushSearchUrl(keyword) {
  return `${CARDRUSH_SEARCH_URL}?keyword=${encodeURIComponent(keyword || '')}`;
}

/**
 * Fetches CardRush search results (via a hidden tab, see module doc above)
 * and returns parsed product listings. Falls back to looser search
 * keywords if the exact search returns nothing.
 *
 * @param {string} keyword - raw search keyword, e.g. "s10b 028"
 * @returns {Promise<{success: boolean, data: {listings: object[], searchUrl: string}, error?: string}>}
 */
async function fetchCardrushPrice(keyword) {
  console.log('[cardrush] fetchCardrushPrice called with keyword:', keyword);
  const attempts = [
    buildCardrushSearchUrl(keyword),
  ].filter(Boolean);

  let lastSearchUrl = attempts[0];
  let lastError = null;
  let cfDetected = false;

  for (const url of attempts) {
    lastSearchUrl = url;
    console.log('[cardrush] trying URL:', url);
    try {
      const listings = await scrapeCardrushViaTab(url);
      console.log('[cardrush] got', listings.length, 'listings from', url);
      if (listings.length > 0) {
        return { success: true, data: { listings, searchUrl: url } };
      }
    } catch (err) {
      lastError = err.message;
      console.log('[cardrush] error for', url, ':', err.message);
      if (err.message === 'CF_CHALLENGE_STUCK') {
        cfDetected = true;
      }
    }
  }

  if (cfDetected) {
    return {
      success: false,
      error: 'Cloudflare challenge detected — please manually verify in the opened window',
      data: { listings: [], searchUrl: lastSearchUrl, cfChallenge: true },
    };
  }

  console.log('[cardrush] returning failure, lastError:', lastError);
  return {
    success: false,
    error: lastError || 'No CardRush listings found',
    data: { listings: [], searchUrl: lastSearchUrl },
  };
}

/**
 * Opens a hidden tab at searchUrl, waits for Cloudflare's JS challenge to
 * clear, extracts listings from the real DOM, then closes the tab.
 */
async function scrapeCardrushViaTab(searchUrl) {
  const { tabId, windowId } = await openMinimizedTab(searchUrl);
  let shouldKeepWindow = false;

  try {
    await waitForTabLoadGeneric(tabId).catch((err) => {
      console.log('[cardrush] tab load timed out, checking for CF challenge...');
    });
    await waitForCloudflareChallenge(tabId, windowId);
    await waitForCardrushResults(tabId);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractCardrushListings,
    });
    const listings = (results && results[0] && results[0].result) || [];
    console.log('[cardrush] extracted listings:', listings.length, listings.slice(0, 2));
    return listings;
  } catch (err) {
    if (err.message === 'CF_CHALLENGE_STUCK') {
      console.log('[cardrush] CF stuck, waiting for manual checkbox...');
      shouldKeepWindow = true;
      // Wait for user to manually tick the CF checkbox, then retry extraction
      const recovered = await waitForCfRecoveryAndRetryCardrush(tabId);
      if (recovered.length > 0) {
        console.log('[cardrush] recovered after manual CF verification:', recovered.length, 'listings');
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
async function waitForCfRecoveryAndRetryCardrush(tabId, maxWaitMs = 120000, pollMs = 2000) {
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
      console.log('[cardrush] CF cleared after manual verification, waiting for results...');
      await waitForCardrushResults(tabId);
      const extractResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractCardrushListings,
      });
      return (extractResults && extractResults[0] && extractResults[0].result) || [];
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  console.log('[cardrush] CF recovery timed out after', maxWaitMs / 1000, 's');
  return [];
}

/**
 * Polls document.title until Cloudflare's "Just a moment..." interstitial
 * has been replaced by the real page. Gives up silently after maxAttempts
 * (caller will just get an empty listings array and fall back to a link).
 */
async function waitForCloudflareChallenge(tabId, windowId, maxAttempts = 40, delayMs = 500) {
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
      console.log('[cardrush] Cloudflare challenge detected, showing window for manual checkbox...');
      await restoreWindowSmall(windowId);
      windowRestored = true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('[cardrush] Cloudflare challenge did not clear after all attempts');
  throw new Error('CF_CHALLENGE_STUCK');
}

/**
 * Polls until CardRush's page renders product links after Cloudflare clears.
 */
async function waitForCardrushResults(tabId, maxAttempts = 15, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.querySelectorAll('a[href*="/product/"]').length,
      });
      const count = (results && results[0] && results[0].result) || 0;
      if (count > 0) {
        console.log(`[cardrush] found ${count} product links after ${i + 1} attempts`);
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
        bodyText: document.body ? document.body.textContent.substring(0, 500) : '',
        linkCount: document.querySelectorAll('a').length,
        productLinkCount: document.querySelectorAll('a[href*="/product/"]').length,
      }),
    });
    console.log('[cardrush] no results after all attempts. Page state:', debug[0]?.result);
  } catch (err) {
    console.log('[cardrush] could not get debug info:', err.message);
  }
}
