// Background service worker: the only place in the extension that talks to
// api.tcgdex.net directly (fetch) and to cardrush-pokemon.jp (via a hidden
// tab, see lib/cardrush-scraper.js for why a plain fetch doesn't work).
//
// Popup and scanner pages never fetch cross-origin themselves; they send a
// chrome.runtime.sendMessage({ type, payload }) and get back
// { success, data?, error? }.

importScripts(
  '../utils/constants.js',
  '../utils/storage.js',
  '../lib/tcgdex-client.js',
  '../lib/gemini-vision.js',
  '../lib/exchange-rates.js',
  '../lib/tab-helper.js',
  '../content-scripts/cardrush-extractor.js',
  '../lib/cardrush-scraper.js',
  '../content-scripts/pricecharting-extractor.js',
  '../lib/pricecharting-scraper.js',
  '../content-scripts/collectr-extractor.js',
  '../lib/collectr-scraper.js',
  '../content-scripts/tcgplayer-extractor.js',
  '../lib/tcgplayer-scraper.js'
);

// Reported with each snapshot: a small value means this hotkey paid for waking
// the (MV3, short-lived) service worker.
const serviceWorkerStartedAt = Date.now();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // keep the message channel open for the async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'snapshot') return;
  const startedAt = Date.now();
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => []);
    const win = pickCaptureWindow(windows) || await chrome.windows.getCurrent();
    console.log('[hotkey] capture window', win.id, `${win.width}x${win.height}`, win.state, 'focused', win.focused,
      '| normal windows', windows.length, '| service worker up', Date.now() - serviceWorkerStartedAt, 'ms');
    const captureStartedAt = Date.now();
    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 85 });
    if (!dataUrl || dataUrl.length < 100) return;
    const capturedAt = Date.now();
    // The scanner page polls for the payload, so the write and the new tab run
    // in parallel instead of one after the other. Each branch logs its own time
    // so a slow snapshot can be attributed to the store or to the tab creation.
    const parallelStartedAt = Date.now();
    await Promise.all([
      setSnapshotData(dataUrl)
        .then(() => console.log('[hotkey] storage write', Date.now() - parallelStartedAt, 'ms')),
      chrome.tabs.create({ url: chrome.runtime.getURL('scanner/scanner.html') + '#snapshot' })
        .then(() => console.log('[hotkey] tab created', Date.now() - parallelStartedAt, 'ms')),
    ]);
    console.log('[hotkey] snapshot ready in', Date.now() - startedAt, 'ms (capture', capturedAt - captureStartedAt,
      'ms, store + open tab', Date.now() - capturedAt, 'ms, payload', Math.round(dataUrl.length / 1024), 'KB)');
  } catch (err) {
    console.error('[hotkey] snapshot failed:', err.message);
  }
});

async function handleMessage(message) {
  const { type, payload } = message || {};
  switch (type) {
    case MESSAGE_TYPES.RECOGNIZE_CARD_CODE:
      return recognizeCardWithGemini(payload.imageBase64);

    case MESSAGE_TYPES.FETCH_CARD_INFO:
      return fetchCardById(payload.language, payload.setCode, payload.localId, payload.setName, payload.cardName, payload.printedTotal);

    case MESSAGE_TYPES.FETCH_CARDRUSH_PRICE:
      return fetchCardrushPrice(payload.keyword);

    case MESSAGE_TYPES.FETCH_ALL_SETS:
      return fetchAllSets(payload.language);

    case MESSAGE_TYPES.PRELOAD_SETS:
      return preloadAllSetData();

    case MESSAGE_TYPES.FETCH_EXCHANGE_RATES:
      return fetchExchangeRates();

    case MESSAGE_TYPES.FETCH_PRICECHARTING:
      return fetchPricechartingPrice(payload.query, payload.setName, payload.cardName);

    case MESSAGE_TYPES.FETCH_COLLECTR:
      return fetchCollectrPrice(payload.query);

    case MESSAGE_TYPES.FETCH_TCGPLAYER:
      return fetchTcgplayerPrice(payload.query);

    case MESSAGE_TYPES.FIND_JP_VERSION:
      return findJpVersion(payload.cardNameJp, payload.enDexId, payload.enLocalId, payload.enSetCode, payload.crossSetCode, payload.crossSetName, payload.enHp, payload.enRarity);

    case MESSAGE_TYPES.FIND_EN_VERSION:
      return findEnVersion(payload.cardNameEn, payload.jpDexId, payload.jpLocalId, payload.jpSetCode, payload.crossSetCode, payload.crossSetName, payload.jpHp, payload.jpRarity);

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}
