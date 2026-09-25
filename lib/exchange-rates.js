// Exchange rate fetcher using open.er-api.com (free, no API key).
// Runs in the service worker (imported via importScripts). Fetches rates
// for JPY and USD, caches them in chrome.storage.local for 6 hours.
// Depends on constants.js (STORAGE_KEYS, EXCHANGE_RATES_TTL_MS) and
// storage.js (getCachedExchangeRates, cacheExchangeRates).

const EXCHANGE_RATE_API_BASE = 'https://open.er-api.com/v6/latest';

/**
 * Returns cached exchange rates if fresh, otherwise fetches new rates from
 * open.er-api.com. Returns an object like { JPY: { USD: 0.0067, VND: 170.5 },
 * USD: { JPY: 149.2, VND: 25400 } }.
 *
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function fetchExchangeRates() {
  const cached = await getCachedExchangeRates();
  if (cached) {
    console.log('[exchange-rates] using cached rates:', cached);
    return { success: true, data: cached };
  }

  try {
    const [jpyRes, usdRes] = await Promise.all([
      fetch(`${EXCHANGE_RATE_API_BASE}/JPY`),
      fetch(`${EXCHANGE_RATE_API_BASE}/USD`),
    ]);
    console.log('[exchange-rates] JPY response status:', jpyRes.status);
    console.log('[exchange-rates] USD response status:', usdRes.status);

    if (!jpyRes.ok || !usdRes.ok) {
      console.log('[exchange-rates] API error, JPY ok:', jpyRes.ok, 'USD ok:', usdRes.ok);
      return { success: false, error: 'Exchange rate API error' };
    }

    const jpyData = await jpyRes.json();
    const usdData = await usdRes.json();
    console.log('[exchange-rates] JPY rates:', jpyData.rates);
    console.log('[exchange-rates] USD rates:', usdData.rates);

    const rates = {
      JPY: { USD: jpyData.rates.USD, VND: jpyData.rates.VND },
      USD: { JPY: usdData.rates.JPY, VND: usdData.rates.VND },
    };

    await cacheExchangeRates(rates);
    console.log('[exchange-rates] fetched and cached:', rates);
    return { success: true, data: rates };
  } catch (err) {
    console.log('[exchange-rates] fetch failed:', err.message);
    return { success: false, error: `Exchange rate fetch failed: ${err.message}` };
  }
}
