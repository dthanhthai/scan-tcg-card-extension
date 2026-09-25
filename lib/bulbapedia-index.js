// Loads and merges the per-era Bulbapedia indexes.
//
// The era bundles are large (about 11 MB in total), so popup/scanner no longer
// load them with static script tags. `ensureBulbapediaIndexes(query)` injects
// only the era bundle(s) the scan needs, resolved from the generated
// `data/bulbapedia/set-era-map.js` (set code / set name -> era), and falls back
// to every era when the set is unknown. Tests and any page that still includes
// the bundles statically keep working, because the same views are built at load
// time from whatever era indexes are already defined.
const BULBAPEDIA_ERA_IDS = ['dp', 'bw', 'hgss', 'xy', 'sm', 'swsh', 'sv', 'm'];

const BULBAPEDIA_ERA_INDEX_GETTERS = {
  dp: () => (typeof BULBAPEDIA_DP_INDEX !== 'undefined' ? BULBAPEDIA_DP_INDEX : null),
  bw: () => (typeof BULBAPEDIA_BW_INDEX !== 'undefined' ? BULBAPEDIA_BW_INDEX : null),
  hgss: () => (typeof BULBAPEDIA_HGSS_INDEX !== 'undefined' ? BULBAPEDIA_HGSS_INDEX : null),
  xy: () => (typeof BULBAPEDIA_XY_INDEX !== 'undefined' ? BULBAPEDIA_XY_INDEX : null),
  sm: () => (typeof BULBAPEDIA_SM_INDEX !== 'undefined' ? BULBAPEDIA_SM_INDEX : null),
  swsh: () => (typeof BULBAPEDIA_SWSH_INDEX !== 'undefined' ? BULBAPEDIA_SWSH_INDEX : null),
  sv: () => (typeof BULBAPEDIA_SV_INDEX !== 'undefined' ? BULBAPEDIA_SV_INDEX : null),
  m: () => (typeof BULBAPEDIA_M_INDEX !== 'undefined' ? BULBAPEDIA_M_INDEX : null),
};

const BULBAPEDIA_SET_ERA_MAP_PATH = 'data/bulbapedia/set-era-map.js';

// records holds every structured relationship. Eras whose JA targets have
// TCGdex ids (SM, SV) also produce structured EN-source records, so the EN view
// merges those with the marketplace-only enToJa section (used by eras like BW
// whose JA sets are absent from TCGdex).
const BULBAPEDIA_INDEX = { ja: {}, en: {} };

const bulbapediaEraLoadPromises = new Map();
const bulbapediaFailedEras = new Set();
let bulbapediaSetEraMap = null;
let bulbapediaSetEraMapPromise = null;

function pickBulbapediaEntriesByLanguage(source, language) {
  return Object.fromEntries(
    Object.entries(source).filter(([, record]) => record.source?.language === language),
  );
}

// Eras are only ever added, so the loaded count is enough to tell whether the
// merged views need rebuilding. Rebuilding on every lookup would replace the
// view objects and invalidate the resolver's group-index cache each time.
let bulbapediaRebuiltEraCount = -1;

function rebuildBulbapediaIndex() {
  const eraIndexes = BULBAPEDIA_ERA_IDS
    .map((eraId) => BULBAPEDIA_ERA_INDEX_GETTERS[eraId]())
    .filter(Boolean);
  if (eraIndexes.length === bulbapediaRebuiltEraCount) return eraIndexes.length;
  bulbapediaRebuiltEraCount = eraIndexes.length;
  BULBAPEDIA_INDEX.ja = Object.assign(
    {},
    ...eraIndexes.map((eraIndex) => pickBulbapediaEntriesByLanguage(eraIndex.records || {}, 'ja')),
  );
  BULBAPEDIA_INDEX.en = Object.assign(
    {},
    ...eraIndexes.map((eraIndex) => ({
      ...pickBulbapediaEntriesByLanguage(eraIndex.records || {}, 'en'),
      ...(eraIndex.enToJa || {}),
    })),
  );
  return eraIndexes.length;
}

function canInjectBulbapediaScripts() {
  return typeof document !== 'undefined' && typeof chrome !== 'undefined' && !!chrome.runtime?.getURL;
}

function injectBulbapediaScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(path);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${path}`));
    document.head.appendChild(script);
  });
}

// The map file is a few KB, so it is always loaded before an era bundle.
function ensureBulbapediaSetEraMap() {
  if (bulbapediaSetEraMap) return Promise.resolve(bulbapediaSetEraMap);
  if (typeof BULBAPEDIA_SET_ERA_MAP !== 'undefined') {
    bulbapediaSetEraMap = BULBAPEDIA_SET_ERA_MAP;
    return Promise.resolve(bulbapediaSetEraMap);
  }
  if (!canInjectBulbapediaScripts()) return Promise.resolve(null);
  if (!bulbapediaSetEraMapPromise) {
    bulbapediaSetEraMapPromise = injectBulbapediaScript(BULBAPEDIA_SET_ERA_MAP_PATH)
      .then(() => {
        bulbapediaSetEraMap = typeof BULBAPEDIA_SET_ERA_MAP !== 'undefined' ? BULBAPEDIA_SET_ERA_MAP : null;
        return bulbapediaSetEraMap;
      })
      .catch((error) => {
        console.warn('[bulbapedia] set-era map failed to load:', error.message);
        return null;
      });
  }
  return bulbapediaSetEraMapPromise;
}

function normalizeBulbapediaSetCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() || null : null;
}

function normalizeBulbapediaSetName(value) {
  if (typeof value !== 'string') return null;
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || null;
}

// Era ids for a scan query, or null when the set is unknown. A null result makes
// the loader inject every era, which is what it did before the map existed.
function resolveBulbapediaEras(map, query) {
  if (!map || !query) return null;
  const eras = new Set();
  for (const key of [normalizeBulbapediaSetCode(query.setCode), normalizeBulbapediaSetName(query.setName)]) {
    if (key && map[key]) map[key].forEach((eraId) => eras.add(eraId));
  }
  return eras.size > 0 ? [...eras] : null;
}

function getLoadedBulbapediaEras() {
  return BULBAPEDIA_ERA_IDS.filter((eraId) => !!BULBAPEDIA_ERA_INDEX_GETTERS[eraId]());
}

// True when every era bundle is loaded. A resolution miss while this is false
// may be caused by the narrowed load (a misread set code), so the caller logs it
// instead of silently losing the counterpart. See the diagnostic in
// `utils/card-lookup.js`.
function areAllBulbapediaErasLoaded() {
  return getLoadedBulbapediaEras().length === BULBAPEDIA_ERA_IDS.length;
}

function ensureBulbapediaEraLoaded(eraId) {
  if (BULBAPEDIA_ERA_INDEX_GETTERS[eraId]() || bulbapediaFailedEras.has(eraId)) return Promise.resolve();
  if (!bulbapediaEraLoadPromises.has(eraId)) {
    bulbapediaEraLoadPromises.set(eraId, injectBulbapediaScript(`data/bulbapedia/${eraId}/counterpart-index.js`)
      .catch((error) => {
        console.warn('[bulbapedia] era bundle failed to load:', eraId, error.message);
        bulbapediaFailedEras.add(eraId);
      }));
  }
  return bulbapediaEraLoadPromises.get(eraId);
}

// Injects every remaining era. Used to retry a resolution miss that the
// narrowed load may have caused (a misread set code). The bundles are
// independent scripts, so they are injected at once: loading them one at a time
// made the first scan of an unindexed card (11.8 MB in total) look like a hang.
function ensureAllBulbapediaIndexes() {
  if (!canInjectBulbapediaScripts()) return Promise.resolve(rebuildBulbapediaIndex());
  return Promise.all(BULBAPEDIA_ERA_IDS.map((eraId) => ensureBulbapediaEraLoaded(eraId)))
    .then(() => rebuildBulbapediaIndex());
}

// Resolves once the era bundles the scan needs are available and merged. Safe to
// call before each lookup: already-loaded eras are skipped.
function ensureBulbapediaIndexes(query) {
  const missing = BULBAPEDIA_ERA_IDS.filter((eraId) => !BULBAPEDIA_ERA_INDEX_GETTERS[eraId]() && !bulbapediaFailedEras.has(eraId));
  if (missing.length === 0 || !canInjectBulbapediaScripts()) return Promise.resolve(rebuildBulbapediaIndex());
  return ensureBulbapediaSetEraMap().then((map) => {
    const eras = resolveBulbapediaEras(map, query) || BULBAPEDIA_ERA_IDS;
    return Promise.all(eras.map((eraId) => ensureBulbapediaEraLoaded(eraId)))
      .then(() => rebuildBulbapediaIndex());
  });
}

rebuildBulbapediaIndex();
