// Chrome storage helpers. Shared by popup, scanner, and settings pages.
// Depends on constants.js being loaded first (STORAGE_KEYS, MAX_SCAN_HISTORY).

async function getScanHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SCAN_HISTORY);
  return result[STORAGE_KEYS.SCAN_HISTORY] || [];
}

async function addScanEntry(entry) {
  if (!entry || !entry.cardId) return getScanHistory();
  const history = await getScanHistory();
  history.unshift(entry);
  if (history.length > MAX_SCAN_HISTORY) history.length = MAX_SCAN_HISTORY;
  await chrome.storage.local.set({ [STORAGE_KEYS.SCAN_HISTORY]: history });
  return history;
}

async function clearScanHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SCAN_HISTORY]: [] });
}

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return result[STORAGE_KEYS.SETTINGS] || { defaultLanguage: 'ja' };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

// A snapshot payload is a multi-MB image data URL that only has to survive from
// the capture to the scanner page, so chrome.storage.session (in memory, cleared
// when the browser closes) avoids the disk write storage.local would do. Where
// the API is missing or the payload exceeds the session quota, fall back to
// storage.local.
function getSnapshotStorage() {
  return (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
}

async function setSnapshotData(dataUrl) {
  try {
    await getSnapshotStorage().set({ [STORAGE_KEYS.SNAPSHOT_DATA]: dataUrl });
  } catch (err) {
    console.warn('[storage] snapshot write to session failed, using local:', err.message);
    await chrome.storage.local.set({ [STORAGE_KEYS.SNAPSHOT_DATA]: dataUrl });
  }
}

// Reads and clears the snapshot in one step, since it is only consumed once.
async function takeSnapshotData() {
  const store = getSnapshotStorage();
  const result = await store.get(STORAGE_KEYS.SNAPSHOT_DATA);
  await store.remove(STORAGE_KEYS.SNAPSHOT_DATA).catch(() => {});
  if (result[STORAGE_KEYS.SNAPSHOT_DATA]) return result[STORAGE_KEYS.SNAPSHOT_DATA];
  // The write may have fallen back to storage.local.
  const fallback = await chrome.storage.local.get(STORAGE_KEYS.SNAPSHOT_DATA);
  return fallback[STORAGE_KEYS.SNAPSHOT_DATA] || null;
}

async function getCachedSets() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE);
  const cache = result[STORAGE_KEYS.SET_LIST_CACHE];
  if (!cache) return null;
  // Per-language format (written by tcgdex-client.js): { ja: { data, timestamp }, en: { data, timestamp } }
  if (cache.ja || cache.en) {
    const allIds = new Set();
    for (const lang of ['ja', 'en']) {
      const langCache = cache[lang];
      if (langCache && langCache.data) {
        const isExpired = Date.now() - langCache.timestamp > SET_LIST_CACHE_TTL_MS;
        if (!isExpired) {
          langCache.data.forEach((s) => allIds.add(s.id || s));
        }
      }
    }
    if (allIds.size > 0) return [...allIds];
  }
  // Flat format (legacy, written by cacheSets): { _flat: { updatedAt, sets } }
  if (cache._flat) {
    const isExpired = Date.now() - cache._flat.updatedAt > SET_LIST_CACHE_TTL_MS;
    if (!isExpired) return cache._flat.sets;
  }
  // Very old flat format: { updatedAt, sets }
  if (cache.updatedAt && cache.sets) {
    const isExpired = Date.now() - cache.updatedAt > SET_LIST_CACHE_TTL_MS;
    if (!isExpired) return cache.sets;
  }
  return null;
}

async function cacheSets(sets) {
  const existing = (await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE))[STORAGE_KEYS.SET_LIST_CACHE] || {};
  existing._flat = { updatedAt: Date.now(), sets };
  await chrome.storage.local.set({
    [STORAGE_KEYS.SET_LIST_CACHE]: existing,
  });
}

async function getCachedExchangeRates() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.EXCHANGE_RATES_CACHE);
  const cache = result[STORAGE_KEYS.EXCHANGE_RATES_CACHE];
  if (!cache) return null;
  const isExpired = Date.now() - cache.updatedAt > EXCHANGE_RATES_TTL_MS;
  if (isExpired) return null;
  return cache.rates;
}

async function cacheExchangeRates(rates) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.EXCHANGE_RATES_CACHE]: { updatedAt: Date.now(), rates },
  });
}
