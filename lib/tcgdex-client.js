// TCGdex API wrapper. Used by the background service worker.
// Docs: https://tcgdex.dev
// Depends on constants.js (TCGDEX_BASE_URL) being loaded first.

// Maps JP set codes to their EN equivalent TCGdex set IDs.
// JP sets use codes like "SV8", "SV8a" while EN uses "sv08", "sv08.5".
// Pattern: SV{n} → sv0{n}, SV{n}A → sv0{n}.5
// Explicit entries override the auto-generated pattern for edge cases.
const JP_TO_EN_SET_MAP = {
  'SV8A': 'sv08.5',  // Terastal Festival → Prismatic Evolutions (EN)
  'SV8': 'sv08',     // Super Electric Breaker → Surging Sparks (EN, split with SV7a)
  'SV7a': 'sv08',    // Paradise Dragona → Surging Sparks (EN, split with SV8)
  'SV7': 'sv07',     // Stellar Miracle → Stellar Crown (EN)
  'SV6a': 'sv06.5',  // Night Wanderer → Shrouded Fable (EN)
  'SV6': 'sv06',     // Mask of Change → Twilight Masquerade (EN, split with SV5a)
  'SV5a': 'sv06',    // Crimson Haze → Twilight Masquerade (EN, split with SV6)
  'SV5M': 'sv05',    // Cyber Judge → Temporal Forces (EN, split with SV5K)
  'SV5K': 'sv05',    // Wild Force → Temporal Forces (EN, split with SV5M)
  'SV4a': 'sv04.5',  // Shiny Treasure ex → Paldean Fates (EN)
  'SV4M': 'sv04',    // Future Flash → Paradox Rift (EN, split with SV4K + SV3a)
  'SV4K': 'sv04',    // Ancient Roar → Paradox Rift (EN, split with SV4M + SV3a)
  'SV3a': 'sv04',    // Raging Surf → Paradox Rift (EN, split with SV4M + SV4K)
  'SV2a': 'sv03.5',  // Pokemon 151 → 151 (EN)
  'SV3': 'sv03',     // Ruler of the Black Flame → Obsidian Flames (EN, split with SV2P)
  'SV2P': 'sv03',    // Snow Hazard → Obsidian Flames (EN, split with SV3)
  'SV2D': 'sv02',    // Clay Burst → Paldea Evolved (EN, split with SV1a)
  'SV1a': 'sv02',    // Triplet Beat → Paldea Evolved (EN, split with SV2D)
  'SV1S': 'sv01',    // Scarlet ex → Scarlet & Violet (EN, split with SV1V)
  'SV1V': 'sv01',    // Violet ex → Scarlet & Violet (EN, split with SV1S)
  'S12': ['swsh12', 'swsh12.5'], // Paradigm Trigger → Silver Tempest + Crown Zenith main (EN)
  'S12a': 'swsh12.5gg', // VSTAR Universe → Crown Zenith Galarian Gallery (EN)
  'S11': 'swsh11',   // Lost Abyss → Lost Origin (EN)
  'S10b': 'swsh10.5', // Pokémon GO → Pokémon GO (EN) — TCGdex has no S10b card data
  'S11a': ['swsh12', 'swsh12tg'], // Incandescent Arcana → Silver Tempest main + Trainer Gallery (EN)
  'S10a': 'swsh11tg', // Dark Phantasma → Lost Origin Trainer Gallery (EN)
  'S10D': 'swsh10',   // Time Gazer → Astral Radiance (EN, split with S10P) — TCGdex has no S10D card data
  'S10P': 'swsh10',   // Space Juggler → Astral Radiance (EN, split with S10D)
  'S9': 'swsh9',     // Star Birth → Brilliant Stars (EN)
  'S8b': ['swsh9tg', 'swsh11tg'], // VMAX Climax → Brilliant Stars TG + Lost Origin TG (EN)
  'S9a': ['swsh10', 'swsh10tg'], // Battle Region → Astral Radiance main + Trainer Gallery (EN)
  'S8': 'swsh8',     // Fusion Arts → Fusion Strike (EN)
  'S8a': ['cel25', 'cel25cc'], // 25th Anniversary Collection → Celebrations + Classic Collection (EN) — TCGdex has no S8a card data
  'S7R': 'swsh7',    // Blue Sky Stream → Evolving Skies (EN, split with S7D + S6a) — TCGdex has no S7R card data
  'S7D': 'swsh7',    // Towering Perfection → Evolving Skies (EN, split with S7R + S6a)
  'S6a': 'swsh7',    // Eevee Heroes → Evolving Skies (EN, split with S7R + S7D) — TCGdex has no S6a card data
  // NOTE: Eevee Heroes VMAX Special Set (4 cards, e.g. Flareon VMAX 001/004) is a sub-product of S6a, not a separate TCGdex set.
  'S6H': 'swsh6',    // Silver Lance → Chilling Reign (EN, split with S6K + S5a)
  'S6K': 'swsh6',    // Jet Black Geist → Chilling Reign (EN, split with S6H + S5a)
  'S5a': 'swsh6',    // Matchless Fighter → Chilling Reign (EN, split with S6H + S6K) — TCGdex has no S5a card data
  'S5R': 'swsh5',    // Rapid Strike Master → Battle Styles (EN, split with S5I) — TCGdex has no S5R card data
  'S5I': 'swsh5',    // Single Strike Master → Battle Styles (EN, split with S5R)
  'S4a': ['swsh4.5', 'swsh4.5sv'], // Shiny Star V → Shining Fates + Shiny Vault (EN) — TCGdex has no S4a card data
  'S4': 'swsh4',    // Amazing Volt → Vivid Voltage (EN, split with S3a) — TCGdex has no S4 card data
  'S3a': 'swsh4',   // Legendary Heartbeat → Vivid Voltage (EN, split with S4) — TCGdex has no S3a card data
  'S3': 'swsh3',    // Infinity Zone → Darkness Ablaze (EN, split with S2a) — TCGdex has no S3 card data
  'S2a': 'swsh3',   // Explosive Flame Walker → Darkness Ablaze (EN, split with S3) — TCGdex has no S2a card data
  'S2': 'swsh2',    // Rebellion Crash → Rebel Clash (EN, split with S1a) — TCGdex has no S2 card data
  'S1a': 'swsh2',   // VMAX Rising → Rebel Clash (EN, split with S2) — TCGdex has no S1a card data
  'S1W': 'swsh1',   // Sword → Sword & Shield (EN, split with S1H) — TCGdex has no S1W card data
  'S1H': 'swsh1',   // Shield → Sword & Shield (EN, split with S1W) — TCGdex has no S1H card data
  // NOTE: swsh3.5 (Champion's Path) is an EN-only special set with no JP main set counterpart.
  // JP counterpart cards come from starter decks (SD), not main sets.
  // NOTE: Promo cards (EN swshp/SWSHxxx, JP S-P) are NOT mapped here.
  // TCGdex has EN swshp (307 cards) but no JP S-P set.
  // Cross-language promo matching relies on name search + dexId, not set mapping.
  'SM12': 'sm12',    // Alter Genesis → Cosmic Eclipse (EN, split with SM11a + SM11b)
  'SM11a': 'sm12',   // Remix Bout → Cosmic Eclipse (EN, split with SM12 + SM11b)
  'SM11b': 'sm12',   // Dream League → Cosmic Eclipse (EN, split with SM12 + SM11a)
  'SM12a': 'sm12',   // TAG TEAM GX All Stars → Cosmic Eclipse (EN, high-class reprint)
  'SM8b': 'sma',     // GX Ultra Shiny → Hidden Fates Shiny Vault (EN) — may also map to sm115
  'SM11': 'sm11',   // Miracle Twins → Unified Minds (EN) — sm11 likely has more JP sets
  'SM10b': ['sm115', 'sm11'], // Sky Legend → Hidden Fates + Unified Minds (EN)
  'SM10a': 'sm11',  // GG End → Unified Minds (EN)
  'SM10': 'sm10',   // Double Blaze → Unbroken Bonds (EN)
  'SM9b': 'sm10',   // Full Metal Wall → Unbroken Bonds (EN, split with SM10)
  'SM9a': 'sm10',   // Night Unison → Unbroken Bonds (EN, split with SM10 + SM9b)
  'SMP2': 'det1',   // Detective Pikachu → Detective Pikachu (EN) — TCGdex has no SMP2 card data
  'SM9': 'sm9',     // Tag Bolt → Team Up (EN)
  'SM7a': 'sm8',    // Thunderclap Spark → Lost Thunder (EN, split with SM7b + SM8)
  'SM7b': 'sm8',    // Fairy Rise → Lost Thunder (EN, split with SM7a + SM8)
  'SM8': 'sm8',     // Burst Impact → Lost Thunder (EN, split with SM7a + SM7b)
  'SM8a': 'sm9',    // Dark Order → Team Up (EN)
  'SM6': 'sm6',     // Forbidden Light → Forbidden Light (EN)
  'SM5p': 'sm6',    // Ultra Force → Forbidden Light (EN, split with SM6)
  'SM5S': 'sm5',    // Ultra Sun → Ultra Prism (EN, split with SM5M)
  'SM5M': 'sm5',    // Ultra Moon → Ultra Prism (EN, split with SM5S)
  'SM4A': 'sm4',    // Ultra Beast Dimension → Crimson Invasion (EN)
  'SM4S': 'sm4',    // Awakened Heroes → Crimson Invasion (EN, split with SM4A)
  'SM6b': 'sm7',    // Champion Road → Celestial Storm (EN)
  'SM7': 'sm7',     // Sky Splitting Charisma → Celestial Storm (EN, split with SM6b)
  'SM6a': 'sm7.5',  // Dragon Storm → Dragon Majesty (EN)
  'SM3H': 'sm3',    // Fighting Rainbow → Burning Shadows (EN, split with SM3N)
  'SM3N': 'sm3',    // Light Consuming Dark → Burning Shadows (EN, split with SM3H)
  'SM2p': 'sm3',    // New Trials → Burning Shadows (EN)
  'SM2K': 'sm2',    // Islands Await You → Guardians Rising (EN, split with SM2L)
  'SM2L': 'sm2',    // Alolan Moonlight → Guardians Rising (EN, split with SM2K)
  'SM1S': 'sm1',    // Collection Sun → Sun & Moon (EN, split with SM1M)
  'SM1M': 'sm1',    // Collection Moon → Sun & Moon (EN, split with SM1S)
  'XY1a': 'xy1',    // Collection X → XY Base (EN, split with XY1b; TCGdex lacks card data)
  'XY1b': 'xy1',    // Collection Y → XY Base (EN, split with XY1a; TCGdex lacks card data)
  'XY2': 'xy2',     // Wild Blaze → Flashfire (EN; TCGdex lacks card data)
  'XY3': 'xy3',     // Rising Fist → Furious Fists (EN; TCGdex lacks card data)
  'XY4': 'xy4',     // Phantom Gate → Phantom Forces (EN; TCGdex lacks card data)
  'XY5b': 'xy5',    // Tidal Storm → Primal Clash (EN, split with XY5a; TCGdex lacks card data)
  'XY5a': 'xy5',    // Gaia Volcano → Primal Clash (EN, split with XY5b; TCGdex lacks card data)
  'XY6': 'xy6',     // Emerald Break → Roaring Skies (EN; TCGdex lacks card data)
  'XY7': 'xy7',     // Bandit Ring → Ancient Origins (EN; TCGdex lacks card data)
  'XY8a': 'xy8',    // Blue Shock → BREAKthrough (EN, split with XY8b; TCGdex lacks card data)
  'XY8b': 'xy8',    // Red Flash → BREAKthrough (EN, split with XY8a; TCGdex lacks card data)
  'XY9': 'xy9',     // Rage of the Broken Sky → BREAKpoint (EN; TCGdex lacks card data)
  'XY10': 'xy10',   // Awakening Psychic King → Fates Collide (EN; TCGdex lacks card data)
  'XY11b': 'xy11',  // Cruel Traitor → Steam Siege (EN, split with XY11a; TCGdex lacks card data)
  'XY11a': 'xy11',  // Explosive Fighter → Steam Siege (EN, split with XY11b; TCGdex lacks card data)
  'CP1': 'dc1',     // Double Crisis (Concept Pack 1) → Double Crisis (EN)
  'CP6': 'xy12',    // 20th Anniversary → Evolutions (EN; TCGdex lacks card data)
  'BW1': ['bw1', 'bw2'], // Black + White Collection → Black & White + Emerging Powers leftovers (EN; TCGdex has no JP BW sets)
  'BW2': 'bw3',     // Red Collection → Noble Victories (EN; TCGdex has no JP BW sets)
  'BW3': ['bw4', 'bw3'], // Psycho Drive + Hail Blizzard → Next Destinies + select few in Noble Victories (EN)
  'BW4': 'bw5',     // Dark Rush → Dark Explorers (EN)
  'BW5': 'bw6',     // Dragon Blast + Dragon Blade → Dragons Exalted (EN)
  'BW6': 'bw7',     // Freeze Bolt + Cold Flare → Boundaries Crossed (EN)
  'BW7': 'bw8',     // Plasma Gale → Plasma Storm (EN)
  'BW8': 'bw9',     // Spiral Force + Thunder Knuckle → Plasma Freeze (EN)
  'BW9': 'bw10',    // Megalo Cannon → Plasma Blast (EN)
  'DS': 'dv1',      // Dragon Selection → Dragon Vault (EN)
  'SC': 'bw11',     // Shiny Collection → Legendary Treasures Radiant Collection (EN)
  'EB': 'bw11',     // EX Battle Boost → Legendary Treasures (EN)
  'M2a': 'me02.5',   // Mega Dream ex → Ascended Heroes (EN)
  'M5': 'me05',      // Abyss Eye → Pitch Black (EN)
  'M4': 'me04',      // Ninja Spinner → Chaos Rising (EN)
  'M3': 'me03',      // Nihil Zero → Perfect Order (EN)
  'M2': 'me02',      // Inferno X → Phantasmal Flames (EN)
  'M1L': 'me01',     // Mega Brave → Mega Evolution (EN, split with M1S)
  'M1S': 'me01',     // Mega Symphonia → Mega Evolution (EN, split with M1L)
  'SV11B': 'sv10.5b', // Black Bolt → Black Bolt (EN)
  'SV11W': 'sv10.5w', // White Flare → White Flare (EN)
  'SV9a': 'sv10',    // Hot Air Arena → Destined Rivals (EN, split with SV10)
  'SV10': 'sv10',    // Glory of Team Rocket → Destined Rivals (EN, split with SV9a)
  'SV9': 'sv09',     // Battle Partners → Journey Together (EN)
};
// NOTE: JP-only products with no EN counterpart are NOT mapped:
// - SVK (Stellar Miracle Deck Build Box), SVLN/SVLS (Terastal Stella starter
//   decks) are reprint/starter products — their cards reprint originals from
//   already-mapped JP sets (e.g. SVK-004 Radiant Greninja = S9a-026 → swsh10).
//   Cross-language matching finds EN versions via name + dexId.
// - SV-P (SV promos): TCGdex has no JP promo card data. Promo matching relies
//   on name search + dexId.
// - XY Beginning Set (Kalos starter, JP): not in TCGdex at all; EN xy0
//   (Kalos Starter Set) cards match via name + dexId.

// Reverse map: EN TCGdex set ID → array of JP set codes, built from
// JP_TO_EN_SET_MAP. Supports 1-to-many (e.g. EN me01 = JP M1L + M1S).
// Used when finding JP counterparts of EN cards to prefer candidates from
// the correct JP set(s) (e.g. me02.5 → ['M2a'], me01 → ['M1L', 'M1S']).
const EN_TO_JP_SET_MAP = {};
for (const [jp, en] of Object.entries(JP_TO_EN_SET_MAP)) {
  const enIds = Array.isArray(en) ? en : [en];
  for (const enId of enIds) {
    const key = enId.toLowerCase();
    if (!EN_TO_JP_SET_MAP[key]) EN_TO_JP_SET_MAP[key] = [];
    EN_TO_JP_SET_MAP[key].push(jp);
  }
}


// Auto-derives the EN TCGdex set ID from a JP set code using the standard
// Scarlet & Violet naming pattern. Returns null if the code doesn't match.
// Example: "SV7" → "sv07", "SV7A" → "sv07.5", "SV10" → "sv10"
function deriveEnSetIdFromJpCode(jpSetCode) {
  if (!jpSetCode) return null;
  const match = jpSetCode.toUpperCase().match(/^SV(\d+)(A?)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const isHighClass = match[2] === 'A';
  const paddedNum = num < 10 ? `0${num}` : String(num);
  return isHighClass ? `sv${paddedNum}.5` : `sv${paddedNum}`;
}

// Returns an array of EN set IDs for a JP set code, checking the explicit
// map first, then falling back to the auto-derived pattern (single element).
// Returns null if no mapping exists.
// Example: "M2a" → ["me02.5"], "S12" → ["swsh12", "swsh12.5"]
function getEnSetIdsForJpCode(jpSetCode) {
  if (!jpSetCode) return null;
  const upper = jpSetCode.toUpperCase();
  if (JP_TO_EN_SET_MAP[upper]) {
    const val = JP_TO_EN_SET_MAP[upper];
    return Array.isArray(val) ? val : [val];
  }
  const derived = deriveEnSetIdFromJpCode(upper);
  return derived ? [derived] : null;
}

// Convenience wrapper: returns the single EN set ID when the map has exactly
// one entry (the common 1:1 case), or the full array for 1-to-many.
// Returns null if no mapping exists.
function getEnSetIdForJpCode(jpSetCode) {
  const codes = getEnSetIdsForJpCode(jpSetCode);
  if (!codes) return null;
  return codes.length === 1 ? codes[0] : codes;
}

// Returns an array of JP set codes for an EN TCGdex set ID, checking the
// explicit reverse map first. Returns null if no mapping exists.
// Example: "me02.5" → ["M2a"], "me01" → ["M1L", "M1S"]
function getJpSetCodesForEnSetId(enSetId) {
  if (!enSetId) return null;
  const lower = enSetId.toLowerCase();
  return EN_TO_JP_SET_MAP[lower] || null;
}

// Convenience wrapper: returns the single JP set code when the reverse map
// has exactly one entry (the common 1:1 case), or the full array for 1-to-many.
// Returns null if no mapping exists.
// Example: "me02.5" → "M2a", "me01" → ["M1L", "M1S"]
function getJpSetCodeForEnSetId(enSetId) {
  const codes = getJpSetCodesForEnSetId(enSetId);
  if (!codes) return null;
  return codes.length === 1 ? codes[0] : codes;
}

/**
 * Fetch with retry for 503 (service unavailable) errors.
 * TCGdex API can temporarily return 503 under load; retrying after a short
 * delay usually succeeds.
 * @param {string} url - the URL to fetch
 * @param {number} maxRetries - number of retry attempts (default 2)
 * @returns {Promise<Response>} - the fetch Response
 */
async function fetchWithRetry(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url);
    if (response.status !== 503) return response;
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return await fetch(url);
}

/**
 * Maps over an array with bounded concurrency. Processes items in parallel
 * batches to avoid overwhelming the API server.
 * @param {Array} items - the items to process
 * @param {number} concurrency - max parallel operations (default 8)
 * @param {Function} fn - async function called per item
 * @returns {Promise<Array>} - results in original order
 */
async function parallelMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetches set abbreviations for all sets in parallel (bounded concurrency).
 * @param {string} language - "ja" or "en"
 * @param {Array} sets - array of set objects with .id
 * @returns {Promise<object>} - map of { ABBR: setId }
 */
async function fetchAbbreviationsParallel(language, sets) {
  console.log('[tcgdex] fetching abbreviations for', sets.length, 'sets (parallel)...');
  const abbrMap = {};
  await parallelMap(sets, 8, async (set) => {
    try {
      const res = await fetch(`${TCGDEX_BASE_URL}/${language}/sets/${set.id}`);
      if (res.ok) {
        const data = await res.json();
        const abbr = data.abbreviation?.official;
        if (abbr) {
          abbrMap[abbr.toUpperCase()] = set.id;
        }
      }
    } catch (err) {
      // skip individual failures
    }
  });
  return abbrMap;
}

/**
 * Fetch a single card by set code + local id.
 * Tries a few common casing/padding variants before giving up, since OCR
 * output can have inconsistent case (e.g. "m2a" vs "M2a") or missing
 * leading zeros (e.g. "17" vs "017").
 *
 * If setName is provided, falls back to matching the set name against the
 * cached TCGdex set list to find the correct set ID, then retries the card
 * lookup. For EN cards this runs before the raw printed-code candidates
 * because printed codes rarely match TCGdex set IDs.
 *
 * @param {string} language - "ja" or "en"
 * @param {string} setCode - e.g. "M2a"
 * @param {string} localId - e.g. "017"
 * @param {string} [setName] - e.g. "Mega Evolution" (from Gemini, for fallback matching)
 * @param {string} [cardName] - e.g. "Pikachu" (from Gemini, for verifying the matched card)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
// How many name+localId candidates to fetch when narrowing by printed total.
const MAX_NAME_SEARCH_CANDIDATES = 4;

// Classifies a fetched card against the expected name and printed total.
// 'hard' accepts it, 'soft' keeps it as a fallback for a later try, 'reject'
// drops it. Missing metadata cannot reject, matching the project's
// precision-first rule.
function classifyCardCandidate(data, cardName, printedTotal) {
  if (!isCardNameMatch(data?.name, cardName)) return 'reject';
  const officialCount = data?.set?.cardCount?.official;
  if (printedTotal == null || officialCount == null) return 'hard';
  return Number(officialCount) === Number(printedTotal) ? 'hard' : 'soft';
}

const EMPTY_SET_CACHE_KEY = 'emptySetCache';

// TCGdex lists some JA sets with an official card count but returns no cards
// for them (every SWSH-era JA set, for example). Remembering those sets avoids
// running the whole fallback chain (about twenty requests) on every miss.
async function isSetKnownEmpty(language, setId) {
  if (!setId) return false;
  try {
    const cached = (await chrome.storage.local.get(EMPTY_SET_CACHE_KEY))[EMPTY_SET_CACHE_KEY] || {};
    return cached[`${language}:${setId}`] === true;
  } catch (err) {
    console.log('[tcgdex] empty set cache read error:', err.message);
    return false;
  }
}

async function rememberEmptySet(language, setId) {
  if (!setId) return;
  try {
    const cached = (await chrome.storage.local.get(EMPTY_SET_CACHE_KEY))[EMPTY_SET_CACHE_KEY] || {};
    cached[`${language}:${setId}`] = true;
    await chrome.storage.local.set({ [EMPTY_SET_CACHE_KEY]: cached });
    console.log('[tcgdex] remembered set with no cards:', language, setId);
  } catch (err) {
    console.log('[tcgdex] empty set cache write error:', err.message);
  }
}

async function checkSetHasCards(language, setId) {
  try {
    const response = await fetch(`${TCGDEX_BASE_URL}/${language}/sets/${encodeURIComponent(setId)}`);
    if (!response.ok) return true;
    const data = await response.json();
    return Array.isArray(data?.cards) && data.cards.length > 0;
  } catch (err) {
    return true;
  }
}

async function fetchCardById(language, setCode, localId, setName, cardName, printedTotal) {
  console.log('[tcgdex] fetchCardById called:', { language, setCode, localId, setName, cardName, printedTotal });

  const knownSetId = await findSetIdByExactCode(language, setCode);
  if (knownSetId && await isSetKnownEmpty(language, knownSetId)) {
    console.log('[tcgdex] set is known to have no cards:', knownSetId, '- skipping lookups');
    return { success: false, error: `Set ${knownSetId} has no cards in TCGdex ${language}` };
  }

  // A printed number's total ("2/83") must agree with the candidate set's
  // official card count. Without this, a name-only match against the wrong set
  // wins before the right set is tried (observed: Generations 2/83 accepted as
  // XY base 2/146). Candidates whose total disagrees are kept as a fallback.
  let softMatch = null;
  // Set when the printed code mapped to a set. A mapped code that still failed
  // cannot be fixed by refreshing the cache, because re-deriving the mapping
  // repeats the same requests (see fallback 3).
  let abbreviationSetId = null;
  const acceptCandidate = (data, label, cardId) => {
    const verdict = classifyCardCandidate(data, cardName, printedTotal);
    if (verdict === 'hard') {
      console.log(`[tcgdex] found card via ${label}:`, cardId);
      return true;
    }
    if (verdict === 'soft') {
      if (!softMatch) softMatch = data;
      console.log(`[tcgdex] ${label} name matched but set total differs:`, cardId, 'official', data?.set?.cardCount?.official, '!=', printedTotal);
      return false;
    }
    console.log(`[tcgdex] ${label} card name mismatch:`, data?.name, '!=', cardName);
    return false;
  };

  // For EN cards: try abbreviation/alias mapping FIRST, since printed EN codes
  // (e.g. "PBLEN", "SVP EN", "ASCEN") rarely match TCGdex set IDs directly.
  // JP codes usually match directly, so keep raw candidates first for JA.
  if (language === 'en') {
    const matchedByCode = await matchSetByAbbreviation(language, setCode);
    if (matchedByCode) {
      abbreviationSetId = matchedByCode;
      console.log('[tcgdex] EN abbreviation-first: matched "' + setCode + '" -> ' + matchedByCode);
      const abbrCandidates = buildCardIdCandidates(matchedByCode, localId);
      for (const cardId of abbrCandidates) {
        const url = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(cardId)}`;
        console.log('[tcgdex] trying:', url);
        try {
          const response = await fetchWithRetry(url);
          console.log('[tcgdex] response status:', response.status, 'for', cardId);
          if (response.ok) {
            const data = await response.json();
            if (acceptCandidate(data, 'abbreviation-first', cardId)) return { success: true, data };
          }
        } catch (err) {
          console.log('[tcgdex] abbreviation-first error:', err.message);
        }
      }
    }
    // Printed EN codes rarely match TCGdex set IDs, so once the abbreviation
    // mapping also failed, the set name is a better next step than brute
    // forcing the raw printed code. Raw candidates still run below as a net.
    const enSetNameResult = await trySetNameFallback(language, setName, localId, cardName, printedTotal);
    if (enSetNameResult.hard) return { success: true, data: enSetNameResult.hard };
    if (enSetNameResult.soft && !softMatch) softMatch = enSetNameResult.soft;
  }

  // Raw candidates (always tried; for EN this is a fallback after abbreviation)
  const candidates = buildCardIdCandidates(setCode, localId);
  for (const cardId of candidates) {
    const url = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(cardId)}`;
    console.log('[tcgdex] trying:', url);
    try {
      const response = await fetchWithRetry(url);
      console.log('[tcgdex] response status:', response.status, 'for', cardId);
      if (response.ok) {
        const data = await response.json();
        const officialCount = data?.set?.cardCount?.official;
        if (printedTotal != null && officialCount != null && officialCount !== printedTotal) {
          if (!softMatch) softMatch = data;
          console.log('[tcgdex] raw candidate set total differs:', cardId, 'official', officialCount, '!=', printedTotal);
          continue;
        }
        console.log('[tcgdex] found card:', cardId, '- name:', data?.name || 'unknown');
        return { success: true, data };
      }
    } catch (err) {
      console.log('[tcgdex] error for', cardId, ':', err.message);
    }
  }

  // Fallback 1: match setCode against set abbreviations (e.g. "SVPEN" -> "SVP" -> svp)
  // For EN, abbreviation was already tried above; skip to avoid duplicate work.
  if (language !== 'en') {
    const matchedByCode = await matchSetByAbbreviation(language, setCode);
    if (matchedByCode) {
      abbreviationSetId = matchedByCode;
      console.log('[tcgdex] setCode abbreviation fallback: matched "' + setCode + '" -> ' + matchedByCode);
      const abbrCandidates = buildCardIdCandidates(matchedByCode, localId);
      for (const cardId of abbrCandidates) {
        const url = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(cardId)}`;
        console.log('[tcgdex] setCode fallback trying:', url);
        try {
          const response = await fetchWithRetry(url);
          if (response.ok) {
            const data = await response.json();
            if (acceptCandidate(data, 'setCode fallback', cardId)) return { success: true, data };
          }
        } catch (err) {
          console.log('[tcgdex] setCode fallback error:', err.message);
        }
      }
    }
  }

  // Fallback 2: if setName is provided, try matching it against the set list.
  // EN already tried this right after the abbreviation mapping.
  if (language !== 'en') {
    const setNameResult = await trySetNameFallback(language, setName, localId, cardName, printedTotal);
    if (setNameResult.hard) return { success: true, data: setNameResult.hard };
    if (setNameResult.soft && !softMatch) softMatch = setNameResult.soft;
  }

  // Fallback 3: the cache may be stale, so a set released after it was written
  // is missing from it. Only a code that could not be mapped at all can benefit:
  // when a mapping already existed, its candidates 404'd or returned a different
  // card, and re-deriving the same mapping just repeats those requests while
  // refreshing the whole set list (observed: "SWSH" mapped to dp3, every
  // candidate mismatched, and the refresh refetched 220 sets before the
  // name+localId search found the card).
  if (abbreviationSetId) {
    console.log('[tcgdex] skipping the cache refresh: set code already mapped to', abbreviationSetId);
  } else {
    console.log('[tcgdex] all fallbacks failed, refreshing cache and retrying...');
    await refreshSetCache(language);
    const freshMatch = await matchSetByAbbreviation(language, setCode);
    if (freshMatch) {
      console.log('[tcgdex] fresh cache matched "' + setCode + '" -> ' + freshMatch);
      const retryCandidates = buildCardIdCandidates(freshMatch, localId);
      for (const cardId of retryCandidates) {
        const url = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(cardId)}`;
        console.log('[tcgdex] cache-refresh retry trying:', url);
        try {
          const response = await fetchWithRetry(url);
          if (response.ok) {
            const data = await response.json();
            if (acceptCandidate(data, 'cache refresh', cardId)) return { success: true, data };
          }
        } catch (err) {
          console.log('[tcgdex] cache-refresh retry error:', err.message);
        }
      }
    }
  }

  // Fallback 4: old EN sets print set codes that OCR often misreads (e.g.
  // "NXD" and "HS" for a Dark Explorers card), while the printed number and
  // card name stay reliable. Candidates that share the name and localId are
  // fetched and narrowed by the printed total; several survivors stay a miss.
  if (cardName) {
    const searchRes = await searchCardsByName(language, cardName);
    if (searchRes.success && Array.isArray(searchRes.data)) {
      const unpaddedLocalId = /^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId;
      const localIdVariants = new Set([localId, unpaddedLocalId, localId.padStart(3, '0')]);
      const matches = searchRes.data.filter((candidate) => localIdVariants.has(String(candidate.localId)));
      const fetched = [];
      for (const match of matches.slice(0, MAX_NAME_SEARCH_CANDIDATES)) {
        try {
          const response = await fetchWithRetry(`${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(match.id)}`);
          if (response.ok) fetched.push(await response.json());
        } catch (err) {
          console.log('[tcgdex] name+localId search fetch error:', err.message);
        }
      }
      const hard = fetched.find((card) => classifyCardCandidate(card, cardName, printedTotal) === 'hard');
      if (hard) {
        console.log('[tcgdex] found card via name+localId search:', hard.id);
        return { success: true, data: hard };
      }
      const soft = fetched.find((card) => classifyCardCandidate(card, cardName, printedTotal) === 'soft');
      if (soft && !softMatch) softMatch = soft;
      if (!hard && !soft && matches.length > 1) {
        console.log('[tcgdex] name+localId search ambiguous:', matches.map((candidate) => candidate.id).join(', '));
      }
    }
  }

  if (softMatch) {
    console.log('[tcgdex] returning name match with a different set total:', softMatch.id);
    return { success: true, data: softMatch };
  }
  if (knownSetId && !(await checkSetHasCards(language, knownSetId))) {
    await rememberEmptySet(language, knownSetId);
  }
  console.log('[tcgdex] card not found after all fallbacks');
  return { success: false, error: `Card not found for ${setCode}-${localId}` };
}

/**
 * Resolves the set name against the TCGdex set list and retries the card
 * lookup inside that set. Returns `{ hard }` when a card matches, `{ soft }`
 * when a card matches by name but its set total disagrees with the printed
 * number, or `{}` when the set name matches nothing or no card is found.
 * @param {string} language - "ja" or "en"
 * @param {string} setName - e.g. "Dark Explorers" (from Gemini)
 * @param {string} localId - e.g. "107"
 * @param {string} [cardName] - card name from Gemini, used to verify the match
 * @param {number} [printedTotal] - the total printed on the card (e.g. 83)
 * @returns {Promise<{hard?: object, soft?: object}>}
 */
async function trySetNameFallback(language, setName, localId, cardName, printedTotal) {
  if (!setName) return {};
  const matchedSetId = await matchSetByName(language, setName);
  if (!matchedSetId) return {};
  console.log('[tcgdex] setName fallback: matched "' + setName + '" -> ' + matchedSetId);
  const fallbackCandidates = buildCardIdCandidates(matchedSetId, localId);
  let soft = null;
  for (const cardId of fallbackCandidates) {
    const url = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(cardId)}`;
    console.log('[tcgdex] setName fallback trying:', url);
    try {
      const response = await fetchWithRetry(url);
      if (response.ok) {
        const data = await response.json();
        const verdict = classifyCardCandidate(data, cardName, printedTotal);
        if (verdict === 'hard') {
          console.log('[tcgdex] found card via setName fallback:', cardId);
          return { hard: data };
        }
        if (verdict === 'soft') {
          if (!soft) soft = data;
          console.log('[tcgdex] setName fallback name matched but set total differs:', cardId, 'official', data?.set?.cardCount?.official, '!=', printedTotal);
        } else {
          console.log('[tcgdex] setName fallback card name mismatch:', data?.name, '!=', cardName);
        }
      }
    } catch (err) {
      console.log('[tcgdex] setName fallback error:', err.message);
    }
  }
  return soft ? { soft } : {};
}

/**
 * Checks if a found card name matches the Gemini-provided card name.
 * If no cardName hint is provided, always returns true (accept any match).
 * Comparison is case-insensitive and ignores punctuation and whitespace
 * (e.g. "Darkrai-EX" matches "Darkrai EX"), but keeps card-type suffixes
 * so variants like EX and GX are never merged. A printed level is dropped
 * first ("Darkrai LV.38" matches "Darkrai"; "Darkrai LV.X" still does not).
 * @param {string} foundName - card name from TCGdex
 * @param {string} expectedName - card name from Gemini (may be null)
 * @returns {boolean}
 */
function isCardNameMatch(foundName, expectedName) {
  if (!expectedName) return true;
  if (!foundName) return false;
  const normalize = (s) => stripPrintedCardLevel(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return normalize(foundName) === normalize(expectedName);
}

/**
 * Clears cached set data for a language so it gets refreshed on next lookup.
 * Called when a lookup fails to trigger a cache refresh.
 * @param {string} language - "ja" or "en"
 */
async function refreshSetCache(language) {
  console.log('[tcgdex] refreshing cache for', language);
  try {
    const cacheKey = STORAGE_KEYS.SET_LIST_CACHE;
    const existing = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
    delete existing[language];
    await chrome.storage.local.set({ [cacheKey]: existing });
  } catch (err) {
    console.log('[tcgdex] cache clear error:', err.message);
  }
  try {
    const abbrKey = 'setAbbreviationMap';
    const existing = (await chrome.storage.local.get(abbrKey))[abbrKey] || {};
    delete existing[language];
    await chrome.storage.local.set({ [abbrKey]: existing });
  } catch (err) {
    console.log('[tcgdex] abbr cache clear error:', err.message);
  }
  // Also clear per-setCode mapping cache for this language
  try {
    const setCodeKey = 'setCodeMappingCache';
    const existing = (await chrome.storage.local.get(setCodeKey))[setCodeKey] || {};
    const prefix = `${language}:`;
    for (const k of Object.keys(existing)) {
      if (k.startsWith(prefix)) delete existing[k];
    }
    await chrome.storage.local.set({ [setCodeKey]: existing });
    console.log('[tcgdex] setCode mapping cache cleared for', language);
  } catch (err) {
    console.log('[tcgdex] setCode cache clear error:', err.message);
  }
}

/**
 * Matches a set name (from Gemini) against the TCGdex set list to find
 * the correct set ID. Uses cached set list from chrome.storage.local if available.
 * @param {string} language - "ja" or "en"
 * @param {string} setName - e.g. "Mega Evolution"
 * @returns {Promise<string|null>} - the TCGdex set ID, or null if no match
 */
async function matchSetByName(language, setName) {
  if (!setName) return null;
  const normalizedName = setName.toLowerCase().trim();

  // Try cached set list first (no expiry - only refresh on lookup failure)
  let sets = [];
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE);
    const cached = result[STORAGE_KEYS.SET_LIST_CACHE];
    if (cached && cached[language]) {
      sets = cached[language].data;
    }
  } catch (err) {
    console.log('[tcgdex] cache read error:', err.message);
  }

  // If no cache, fetch fresh
  if (!sets || sets.length === 0) {
    const res = await fetchAllSets(language);
    if (res.success) {
      sets = res.data;
      // Cache for future use
      try {
        const cacheKey = STORAGE_KEYS.SET_LIST_CACHE;
        const existing = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
        existing[language] = { data: sets, timestamp: Date.now() };
        await chrome.storage.local.set({ [cacheKey]: existing });
      } catch (err) {
        console.log('[tcgdex] cache write error:', err.message);
      }
    }
  }

  if (!sets || sets.length === 0) return null;

  // Match by name (case-insensitive, exact match)
  for (const set of sets) {
    const setNameLower = (set.name || '').toLowerCase();
    if (setNameLower === normalizedName) {
      return set.id;
    }
  }

  // Fuzzy match: pick the set with the longest name overlap to avoid
  // "Scarlet & Violet" matching sv01 instead of "SVP Black Star Promos"
  let bestMatch = null;
  let bestScore = 0;
  for (const set of sets) {
    const setNameLower = (set.name || '').toLowerCase();
    if (setNameLower.includes(normalizedName) || normalizedName.includes(setNameLower)) {
      const score = Math.min(setNameLower.length, normalizedName.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = set.id;
      }
    }
  }
  return bestMatch;

  return null;
}

/**
 * Matches a printed set code (from Gemini/OCR) against TCGdex set abbreviations.
 * Many EN cards print abbreviated codes (e.g. "ASCEN") that don't match the
 * TCGdex set ID (e.g. "me02.5") but do match the set's official abbreviation
 * (e.g. "ASC"). Uses fuzzy matching to handle partial reads.
 * @param {string} language - "ja" or "en"
 * @param {string} setCode - e.g. "ASCEN"
 * @returns {Promise<string|null>} - the TCGdex set ID, or null
 */
/**
 * Returns the canonical TCGdex set id when the printed code already IS a set id
 * (e.g. "me05", "SWSH1"), or null. Fuzzy abbreviation matching must not run for
 * these, because it can pick an unrelated set (observed: "me05" -> "tk-bw-e").
 * @param {string} language - "ja" or "en"
 * @param {string} setCode - printed code from Gemini
 * @returns {Promise<string|null>}
 */
async function getCachedSets(language) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE);
    const cached = result[STORAGE_KEYS.SET_LIST_CACHE];
    if (cached && cached[language]) return cached[language].data;
  } catch (err) {
    console.log('[tcgdex] set list cache read error:', err.message);
  }
  const res = await fetchAllSets(language);
  return res.success ? res.data : [];
}

async function findSetIdByExactCode(language, setCode) {
  if (!setCode) return null;
  const wanted = setCode.trim().toLowerCase();
  if (!wanted) return null;
  const sets = await getCachedSets(language);
  if (!sets || sets.length === 0) return null;
  const match = sets.find((set) => String(set.id).toLowerCase() === wanted);
  return match ? match.id : null;
}

// A code that belongs to the other language's set list (Gemini sometimes reads
// the counterpart's JP code on an EN card) must not be fuzzy-matched against
// this language's abbreviations.
async function isOtherLanguageSetCode(language, setCode) {
  if (!setCode) return false;
  const otherLanguage = language === 'en' ? 'ja' : 'en';
  const wanted = setCode.trim().toLowerCase();
  if (!wanted) return false;
  const sets = await getCachedSets(otherLanguage);
  return sets.some((set) => String(set.id).toLowerCase() === wanted);
}

async function matchSetByAbbreviation(language, setCode) {

  if (!setCode) return null;
  // EN cards often print a language marker suffix: "SVP EN", "SVPEN", "SVI EN".
  // TCGdex abbreviations don't include "EN", so strip it before matching.
  // OCR also commonly confuses letters with digits: 1<->I, 0<->O, 5<->S.
  const normalizedCode = setCode.toUpperCase().trim()
    .replace(/\s*EN$/, '')
    .replace(/EN$/, '')
    .replace(/1/g, 'I')
    .replace(/0/g, 'O')
    .replace(/-/g, '');

  // Check hard-coded EN abbreviation map first (instant, no API fetch). The
  // table lives in utils/constants.js so the popup and the index resolver can
  // use the same mapping.
  const hardCodedSetId = language === 'en' ? getEnSetIdForPrintedCode(setCode) : null;
  if (hardCodedSetId) {
    console.log('[tcgdex] hard-coded abbrev match:', setCode, '->', hardCodedSetId);
    return hardCodedSetId;
  }

  // A code that is already a TCGdex set id must not go through fuzzy
  // abbreviation matching; that is what mapped "me05" to the BW trainer kit.
  const exactSetId = await findSetIdByExactCode(language, setCode);
  if (exactSetId) {
    console.log('[tcgdex] setCode is already a TCGdex set id:', setCode, '->', exactSetId);
    return exactSetId;
  }
  if (await isOtherLanguageSetCode(language, setCode)) {
    console.log('[tcgdex] setCode belongs to the other language:', setCode, '- skipping abbreviation matching');
    return null;
  }

  // Check per-setCode cache first to avoid re-fetching/re-mapping
  const setCodeCacheKey = 'setCodeMappingCache';
  try {
    const cached = (await chrome.storage.local.get(setCodeCacheKey))[setCodeCacheKey] || {};
    const cacheKey = `${language}:${normalizedCode}`;
    if (cached[cacheKey] !== undefined) {
      console.log('[tcgdex] setCode cache hit:', setCode, '->', cached[cacheKey]);
      return cached[cacheKey];
    }
  } catch (err) {
    console.log('[tcgdex] setCode cache read error:', err.message);
  }

  const matchedSetId = await matchSetByAbbreviationUncached(language, setCode, normalizedCode);

  // Save to cache (including null results to avoid re-querying misses)
  try {
    const cached = (await chrome.storage.local.get(setCodeCacheKey))[setCodeCacheKey] || {};
    cached[`${language}:${normalizedCode}`] = matchedSetId;
    await chrome.storage.local.set({ [setCodeCacheKey]: cached });
    console.log('[tcgdex] setCode cache saved:', setCode, '->', matchedSetId);
  } catch (err) {
    console.log('[tcgdex] setCode cache write error:', err.message);
  }

  return matchedSetId;
}

async function matchSetByAbbreviationUncached(language, setCode, normalizedCode) {
  if (!setCode) return null;

  let sets = [];
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE);
    const cached = result[STORAGE_KEYS.SET_LIST_CACHE];
    if (cached && cached[language]) {
      sets = cached[language].data;
    }
  } catch (err) {
    console.log('[tcgdex] cache read error:', err.message);
  }

  if (!sets || sets.length === 0) {
    const res = await fetchAllSets(language);
    if (res.success) {
      sets = res.data;
      try {
        const cacheKey = STORAGE_KEYS.SET_LIST_CACHE;
        const existing = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
        existing[language] = { data: sets, timestamp: Date.now() };
        await chrome.storage.local.set({ [cacheKey]: existing });
      } catch (err) {
        console.log('[tcgdex] cache write error:', err.message);
      }
    }
  }

  if (!sets || sets.length === 0) return null;

  // Need to fetch each set to get abbreviation (the list endpoint doesn't include it)
  // Try exact match first against set IDs (case-insensitive, hyphen-insensitive)
  for (const set of sets) {
    if (set.id && set.id.toUpperCase().replace(/-/g, '') === normalizedCode) {
      return set.id;
    }
  }

  // Fetch abbreviations for all sets (cached separately, no expiry)
  let abbrMap = null;
  try {
    const result = await chrome.storage.local.get('setAbbreviationMap');
    const cached = result['setAbbreviationMap'];
    if (cached && cached[language]) {
      abbrMap = cached[language].data;
    }
  } catch (err) {
    console.log('[tcgdex] abbr cache read error:', err.message);
  }

  if (!abbrMap) {
    abbrMap = await fetchAbbreviationsParallel(language, sets);
    try {
      const cacheKey = 'setAbbreviationMap';
      const existing = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
      existing[language] = { data: abbrMap, timestamp: Date.now() };
      await chrome.storage.local.set({ [cacheKey]: existing });
    } catch (err) {
      console.log('[tcgdex] abbr cache write error:', err.message);
    }
  }

  // Exact abbreviation match
  if (abbrMap[normalizedCode]) {
    return abbrMap[normalizedCode];
  }

  // Fuzzy: pick the longest abbreviation that is a prefix of the code
  // (most specific match wins). This avoids "SVPEN" matching a short
  // abbreviation like "SV" before the correct "SVP".
  let bestAbbrMatch = null;
  let bestAbbrLen = 0;
  for (const [abbr, setId] of Object.entries(abbrMap)) {
    if (normalizedCode.startsWith(abbr) && abbr.length > bestAbbrLen) {
      bestAbbrMatch = setId;
      bestAbbrLen = abbr.length;
    }
  }
  if (bestAbbrMatch) return bestAbbrMatch;

  // Reverse direction: abbreviation starts with the code (code is a prefix).
  // Rare, but handles cases where the printed code is truncated.
  for (const [abbr, setId] of Object.entries(abbrMap)) {
    if (abbr.startsWith(normalizedCode)) {
      return setId;
    }
  }

  // Fuzzy digit/letter match: extract digits from both and compare.
  // Handles OCR cases like "M24EN" vs "MCD24" — both contain "M" + "24".
  const codeDigits = normalizedCode.replace(/[^0-9]/g, '');
  if (codeDigits.length > 0) {
    let bestDigitMatch = null;
    let bestDigitLen = 0;
    for (const [abbr, setId] of Object.entries(abbrMap)) {
      const abbrDigits = abbr.replace(/[^0-9]/g, '');
      if (abbrDigits === codeDigits && abbr.length > bestDigitLen) {
        bestDigitMatch = setId;
        bestDigitLen = abbr.length;
      }
    }
    if (bestDigitMatch) return bestDigitMatch;
  }

  return null;
}

/**
 * Builds a list of plausible "{setCode}-{localId}" strings to try against
 * the TCGdex API, covering common OCR case/padding mistakes and
 * printed-code -> TCGdex-ID aliases (e.g. "MEG" -> "me01").
 */
function buildCardIdCandidates(setCode, localId) {
  const paddedLocalId = localId.padStart(3, '0');
  const unpaddedLocalId = String(parseInt(localId, 10));

  // Start with the original code + alias if known
  const setCodeVariants = new Set([
    setCode,
    setCode.toLowerCase(),
    setCode.toUpperCase(),
    setCode.charAt(0).toUpperCase() + setCode.slice(1).toLowerCase(),
  ]);

  // Add aliased TCGdex set ID if the printed code is in the alias map
  const upperCode = setCode.toUpperCase();
  if (SET_CODE_ALIASES[upperCode]) {
    setCodeVariants.add(SET_CODE_ALIASES[upperCode]);
    setCodeVariants.add(SET_CODE_ALIASES[upperCode].toLowerCase());
    setCodeVariants.add(SET_CODE_ALIASES[upperCode].toUpperCase());
  }

  const localIdVariants = new Set([localId, paddedLocalId, unpaddedLocalId]);

  const candidates = [];
  for (const set of setCodeVariants) {
    for (const id of localIdVariants) {
      candidates.push(`${set}-${id}`);
    }
  }
  return candidates;
}

/**
 * Search cards by name (fallback when direct ID lookup fails).
 * @param {string} language
 * @param {string} name
 */
async function searchCardsByName(language, name) {
  const url = `${TCGDEX_BASE_URL}/${language}/cards?name=${encodeURIComponent(name)}`;
  console.log('[tcgdex] searchCardsByName:', url);
  try {
    const response = await fetch(url);
    console.log('[tcgdex] search response status:', response.status);
    if (!response.ok) return { success: false, error: `TCGdex search failed: ${response.status}` };
    const data = await response.json();
    console.log('[tcgdex] search found', data?.length || 0, 'results');
    return { success: true, data };
  } catch (err) {
    console.log('[tcgdex] search error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Search cards by dexId (national dex number). Returns minimal card objects.
 * @param {string} language
 * @param {number} dexId
 */
async function searchCardsByDexId(language, dexId) {
  const url = `${TCGDEX_BASE_URL}/${language}/cards?dexId=${dexId}`;
  console.log('[tcgdex] searchCardsByDexId:', url);
  try {
    const response = await fetch(url);
    if (!response.ok) return { success: false, error: `TCGdex dexId search failed: ${response.status}` };
    const data = await response.json();
    console.log('[tcgdex] dexId search found', data?.length || 0, 'results');
    return { success: true, data };
  } catch (err) {
    console.log('[tcgdex] dexId search error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Finds the cross-language version of a card by searching TCGdex by name,
 * pre-filtering by localId (card number) from search results before fetching
 * full details, then confirming via dexId (national dex number).
 *
 * @param {string} language - target locale ('en' or 'ja')
 * @param {string} cardName - card name in the target language
 * @param {Array<number>} [sourceDexId] - dexIds from the source card for confirmation
 * @param {string} [sourceLocalId] - card number from the source card for matching
 * @param {string} [logLabel] - label for console logs (e.g. 'findJpVersion')
 * @param {string} [sourceSetCode] - set code from the source card (e.g. 'SV-P')
 * @param {string} [crossSetCode] - counterpart set code from Gemini (e.g. 'SVP')
 * @param {string} [crossSetName] - counterpart set name from Gemini (e.g. 'SVP Black Star Promos')
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function findCrossVersionCard(language, cardName, sourceDexId, sourceLocalId, logLabel, sourceSetCode, crossSetCode, crossSetName, sourceHp, sourceRarity) {
  if (!cardName && (!sourceDexId || sourceDexId.length === 0)) return { success: false, error: 'No name or dexId provided' };
  console.log(`[tcgdex] ${logLabel}:`, { cardName, sourceDexId, sourceLocalId, sourceSetCode, crossSetCode, crossSetName, sourceRarity });
  let searchRes = { success: false, data: [] };
  if (cardName) {
    searchRes = await searchCardsByName(language, cardName);
  }
  if (!searchRes.success || !searchRes.data || searchRes.data.length === 0) {
    console.log(`[tcgdex] ${logLabel}: no search results for "${cardName}"`);
      const jpCodes = getJpSetCodeForEnSetId(sourceSetCode);
      const enCodes = getEnSetIdForJpCode(sourceSetCode);
      const setCodes = [
        crossSetCode,
        sourceSetCode,
        ...(Array.isArray(enCodes) ? enCodes : enCodes ? [enCodes] : []),
        ...(Array.isArray(jpCodes) ? jpCodes : jpCodes ? [jpCodes] : []),
      ].filter(Boolean);
      for (const sc of setCodes) {
        console.log(`[tcgdex] ${logLabel}: trying set scan fallback for ${sc}`);
        let setRes = await fetchAllSetsCards(language, sc);
        if (!setRes.success) {
          const resolved = await matchSetByAbbreviation(language, sc);
          if (resolved) {
            console.log(`[tcgdex] ${logLabel}: resolved ${sc} -> ${resolved}, retrying`);
            setRes = await fetchAllSetsCards(language, resolved);
          }
        }
        if (setRes.success && setRes.data) {
          const dexMatched = setRes.data.filter((c) => {
            const cDex = c.dexId || [];
            return sourceDexId.some((d) => cDex.includes(d));
          });
          if (dexMatched.length > 0) {
            let matched = dexMatched;
            if (sourceHp != null) {
              const hpMatched = dexMatched.filter((c) => c.hp != null && c.hp === sourceHp);
              if (hpMatched.length > 0) {
                matched = hpMatched;
              } else {
                console.log(`[tcgdex] ${logLabel}: set scan found ${dexMatched.length} dexId matches but none with HP ${sourceHp}, skipping`);
                continue;
              }
            }
            if (sourceRarity && matched.length > 1) {
              const normalizedSourceRarity = sourceRarity === 'SIR' ? 'SAR' : sourceRarity;
              const rarityMatched = matched.filter((c) => {
                const candidateRarity = TCGDEX_TO_CARDRUSH_RARITY[c.rarity];
                if (!candidateRarity) return true;
                const normalizedCandidate = candidateRarity === 'SIR' ? 'SAR' : candidateRarity;
                return normalizedCandidate === normalizedSourceRarity;
              });
              if (rarityMatched.length > 0 && rarityMatched.length < matched.length) {
                console.log(`[tcgdex] ${logLabel}: set scan rarity match (${sourceRarity}) narrowed ${matched.length} → ${rarityMatched.length}`);
                matched = rarityMatched;
              }
            }
            const card = matched[0];
            if (card) {
              console.log(`[tcgdex] ${logLabel}: matched via set scan fallback`, card.id, '-', card.name, 'hp:', card.hp);
              return { success: true, data: card };
            }
          }
        }
      }
    if (sourceDexId && sourceDexId.length > 0) {
      console.log(`[tcgdex] ${logLabel}: trying dexId search fallback`);
      const dexRes = await searchCardsByDexId(language, sourceDexId[0]);
      if (dexRes.success && dexRes.data && dexRes.data.length > 0) {
        const fullCards = await parallelMap(dexRes.data.slice(0, 20), 4, async (c) => {
          try {
            const cardUrl = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(c.id)}`;
            const res = await fetchWithRetry(cardUrl);
            if (res.ok) return await res.json();
          } catch (err) { /* skip */ }
          return null;
        });
        const validCards = fullCards.filter((c) => c && c.id);
        let matched = validCards;
        if (sourceHp != null) {
          const hpMatched = validCards.filter((c) => c.hp != null && c.hp === sourceHp);
          if (hpMatched.length > 0) {
            matched = hpMatched;
          } else {
            console.log(`[tcgdex] ${logLabel}: dexId search found ${validCards.length} matches but none with HP ${sourceHp}`);
            const baseNameMatch = validCards.find((c) => c.name);
            if (baseNameMatch) {
              const baseName = baseNameMatch.name.replace(/\s+(ex|v|vstar|vmax|gx|tag team)\b.*$/i, '').trim();
              console.log(`[tcgdex] ${logLabel}: using base Pokemon name from dexId:`, baseName);
              return { success: true, data: { ...baseNameMatch, name: baseName } };
            }
            return { success: false, error: 'No card with matching HP found' };
          }
        }
        if (sourceRarity && matched.length > 1) {
          const normalizedSourceRarity = sourceRarity === 'SIR' ? 'SAR' : sourceRarity;
          const rarityMatched = matched.filter((c) => {
            const candidateRarity = TCGDEX_TO_CARDRUSH_RARITY[c.rarity];
            if (!candidateRarity) return true;
            const normalizedCandidate = candidateRarity === 'SIR' ? 'SAR' : candidateRarity;
            return normalizedCandidate === normalizedSourceRarity;
          });
          if (rarityMatched.length > 0 && rarityMatched.length < matched.length) {
            console.log(`[tcgdex] ${logLabel}: dexId search rarity match (${sourceRarity}) narrowed ${matched.length} → ${rarityMatched.length}`);
            matched = rarityMatched;
          }
        }
        const card = matched[0];
        if (card) {
          console.log(`[tcgdex] ${logLabel}: matched via dexId search fallback`, card.id, '-', card.name, 'hp:', card.hp);
          return { success: true, data: card };
        }
      }
    }
    return { success: false, error: 'No cross-version found' };
  }
  const allResults = searchRes.data;
  let candidates = allResults;
  if (sourceLocalId) {
    const localIdMatches = allResults.filter((c) => c.localId === sourceLocalId);
    if (localIdMatches.length > 0) {
      candidates = localIdMatches;
    } else {
      const jpCodes = getJpSetCodeForEnSetId(sourceSetCode);
      const enCodes = getEnSetIdForJpCode(sourceSetCode);
      const setCodes = [
        crossSetCode,
        sourceSetCode,
        ...(Array.isArray(enCodes) ? enCodes : enCodes ? [enCodes] : []),
        ...(Array.isArray(jpCodes) ? jpCodes : jpCodes ? [jpCodes] : []),
      ].filter(Boolean);
      console.log(`[tcgdex] ${logLabel}: set matching candidates:`, setCodes);
      for (const sc of setCodes) {
        const setId = sc.toLowerCase().replace(/-/g, '');
        const setMatches = allResults.filter((c) => {
          const cardId = c.id.toLowerCase().replace(/-/g, '');
          return cardId.startsWith(setId);
        });
        if (setMatches.length > 0) {
          console.log(`[tcgdex] ${logLabel}: set match "${sc}" → ${setMatches.length} candidates`);
          candidates = setMatches;
          break;
        }
      }
    }
  }
  const fullCards = await parallelMap(candidates.slice(0, 8), 4, async (c) => {
    try {
      const url = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(c.id)}`;
      const res = await fetchWithRetry(url);
      if (res.ok) return await res.json();
    } catch (err) { /* skip */ }
    return null;
  });
  const validCards = fullCards.filter((c) => c && c.id);
  console.log(`[tcgdex] ${logLabel}: fetched`, validCards.length, 'full cards from', candidates.length, 'candidates');
  let matched = validCards;
  if (sourceDexId && sourceDexId.length > 0) {
    const dexMatched = validCards.filter((c) => {
      const cDex = c.dexId || [];
      return sourceDexId.some((d) => cDex.includes(d));
    });
    if (dexMatched.length > 0) matched = dexMatched;
  }
  if (sourceLocalId && matched.length > 1) {
    const localIdMatched = matched.filter((c) => c.localId === sourceLocalId);
    if (localIdMatched.length > 0) matched = localIdMatched;
  }
  if (sourceRarity && matched.length > 1) {
    // Normalize SIR ↔ SAR (same rarity tier, different naming conventions)
    const normalizedSourceRarity = sourceRarity === 'SIR' ? 'SAR' : sourceRarity;
    const rarityMatched = matched.filter((c) => {
      const candidateRarity = TCGDEX_TO_CARDRUSH_RARITY[c.rarity];
      if (!candidateRarity) return true; // keep candidates with no rarity (can't verify)
      const normalizedCandidate = candidateRarity === 'SIR' ? 'SAR' : candidateRarity;
      return normalizedCandidate === normalizedSourceRarity;
    });
    if (rarityMatched.length > 0 && rarityMatched.length < matched.length) {
      console.log(`[tcgdex] ${logLabel}: rarity match (${sourceRarity}) narrowed ${matched.length} → ${rarityMatched.length}`);
      matched = rarityMatched;
    }
  }
  const card = matched[0];
  if (!card) {
    console.log(`[tcgdex] ${logLabel}: no match after filtering`);
    return { success: false, error: 'No matching card found' };
  }
  console.log(`[tcgdex] ${logLabel}: matched`, card.id, '-', card.name);
  return { success: true, data: card };
}

/**
 * Finds the Japanese version of an EN card by searching TCGdex JP locale
 * by Japanese name, then filtering by dexId (national dex number) to match
 * the correct Pokemon. Fetches full card details for each candidate in parallel.
 *
 * @param {string} cardNameJp - Japanese card name from Gemini (e.g. "オーガポン みどりのめんex")
 * @param {Array<number>} [enDexId] - national dex IDs from the EN card (e.g. [1017])
 * @param {string} [enLocalId] - card number from the EN card (e.g. "017") for preference matching
 * @param {string} [enSetCode] - set code from the EN card (e.g. 'MEW') for set-based fallback
 * @returns {Promise<{success: boolean, data?: object}>} - full JP card object or failure
 */
async function findJpVersion(cardNameJp, enDexId, enLocalId, enSetCode, crossSetCode, crossSetName, enHp, enRarity) {
  return findCrossVersionCard('ja', cardNameJp, enDexId, enLocalId, 'findJpVersion', enSetCode, crossSetCode, crossSetName, enHp, enRarity);
}

/**
 * Finds the English version of a JP card by searching TCGdex EN locale
 * by English name, then filtering by dexId (national dex number) to match
 * the correct Pokemon. Fetches full card details for each candidate in parallel.
 *
 * @param {string} cardNameEn - English card name from Gemini (e.g. "Teal Mask Ogerpon ex")
 * @param {Array<number>} [jpDexId] - national dex IDs from the JP card (e.g. [1017])
 * @param {string} [jpLocalId] - card number from the JP card (e.g. "017") for preference matching
 * @param {string} [jpSetCode] - set code from the JP card (e.g. 'SV-P') for set-based fallback
 * @returns {Promise<{success: boolean, data?: object}>} - full EN card object or failure
 */
async function findEnVersion(cardNameEn, jpDexId, jpLocalId, jpSetCode, crossSetCode, crossSetName, jpHp, jpRarity) {
  return findCrossVersionCard('en', cardNameEn, jpDexId, jpLocalId, 'findEnVersion', jpSetCode, crossSetCode, crossSetName, jpHp, jpRarity);
}

/**
 * Fetch the full list of sets for a language. Used to validate/correct
 * OCR-detected set codes against the known set list.
 * @param {string} language
 */
async function fetchAllSets(language) {
  const url = `${TCGDEX_BASE_URL}/${language}/sets`;
  console.log('[tcgdex] fetchAllSets:', url);
  try {
    const response = await fetch(url);
    console.log('[tcgdex] sets response status:', response.status);
    if (!response.ok) return { success: false, error: `TCGdex sets failed: ${response.status}` };
    const data = await response.json();
    console.log('[tcgdex] sets found:', data?.length || 0);
    return { success: true, data };
  } catch (err) {
    console.log('[tcgdex] sets error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetches all cards in a specific set. Returns minimal card objects
 * (id, localId, name, image) from the set endpoint.
 * @param {string} language
 * @param {string} setCode - e.g. 'SV-P', 'svp'
 * @returns {Promise<{success: boolean, data?: object[]}>}
 */
async function fetchAllSetsCards(language, setCode) {
  const url = `${TCGDEX_BASE_URL}/${language}/sets/${encodeURIComponent(setCode)}`;
  console.log('[tcgdex] fetchAllSetsCards:', url);
  try {
    const response = await fetch(url);
    if (!response.ok) return { success: false, error: `TCGdex set failed: ${response.status}` };
    const data = await response.json();
    const cards = data.cards || [];
    console.log('[tcgdex] set cards found:', cards.length, 'for set', setCode);
    const fullCards = await parallelMap(cards, 8, async (c) => {
      try {
        const cardUrl = `${TCGDEX_BASE_URL}/${language}/cards/${encodeURIComponent(c.id)}`;
        const res = await fetchWithRetry(cardUrl);
        if (res.ok) return await res.json();
      } catch (err) { /* skip */ }
      return null;
    });
    const validCards = fullCards.filter((c) => c && c.id);
    console.log('[tcgdex] set scan: fetched', validCards.length, 'full cards from', cards.length, 'total');
    return { success: true, data: validCards };
  } catch (err) {
    console.log('[tcgdex] set cards error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Preloads set lists + abbreviation maps for both EN and JA into cache.
 * Called on app startup so lookups are instant. No expiry — cache persists
 * until a lookup fails, at which point it refreshes on demand.
 * @param {function} [onProgress] - callback(progress: number, message: string)
 * @returns {Promise<{success: boolean}>}
 */
async function preloadAllSetData(onProgress) {
  const languages = ['en', 'ja'];
  const totalSteps = languages.length * 2;
  let step = 0;

  for (const lang of languages) {
    step++;
    if (onProgress) onProgress(step / totalSteps, `Loading ${lang.toUpperCase()} set list...`);

    // Check if already cached
    let needFetch = false;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE);
      const cached = result[STORAGE_KEYS.SET_LIST_CACHE];
      if (!cached || !cached[lang] || !cached[lang].data || cached[lang].data.length === 0) {
        needFetch = true;
      }
    } catch (err) {
      needFetch = true;
    }

    if (needFetch) {
      console.log('[tcgdex] preloading set list for', lang);
      const res = await fetchAllSets(lang);
      if (res.success) {
        try {
          const cacheKey = STORAGE_KEYS.SET_LIST_CACHE;
          const existing = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
          existing[lang] = { data: res.data, timestamp: Date.now() };
          await chrome.storage.local.set({ [cacheKey]: existing });
        } catch (err) {
          console.log('[tcgdex] preload cache write error:', err.message);
        }
      }
    } else {
      console.log('[tcgdex] set list for', lang, 'already cached');
    }

    step++;
    if (onProgress) onProgress(step / totalSteps, `Loading ${lang.toUpperCase()} abbreviations...`);

    // Check if abbreviations already cached
    let needAbbrFetch = false;
    try {
      const result = await chrome.storage.local.get('setAbbreviationMap');
      const cached = result['setAbbreviationMap'];
      if (!cached || !cached[lang] || !cached[lang].data || Object.keys(cached[lang].data).length === 0) {
        needAbbrFetch = true;
      }
    } catch (err) {
      needAbbrFetch = true;
    }

    if (needAbbrFetch) {
      console.log('[tcgdex] preloading abbreviations for', lang);
      // Get sets from cache (just fetched or already cached)
      let sets = [];
      try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.SET_LIST_CACHE);
        const cached = result[STORAGE_KEYS.SET_LIST_CACHE];
        if (cached && cached[lang]) {
          sets = cached[lang].data;
        }
      } catch (err) {
        // ignore
      }

      if (sets.length > 0) {
        const abbrMap = await fetchAbbreviationsParallel(lang, sets);
        try {
          const cacheKey = 'setAbbreviationMap';
          const existing = (await chrome.storage.local.get(cacheKey))[cacheKey] || {};
          existing[lang] = { data: abbrMap, timestamp: Date.now() };
          await chrome.storage.local.set({ [cacheKey]: existing });
        } catch (err) {
          console.log('[tcgdex] abbr cache write error:', err.message);
        }
      }
    } else {
      console.log('[tcgdex] abbreviations for', lang, 'already cached');
    }
  }

  if (onProgress) onProgress(1, 'Done');
  return { success: true };
}

// Exported for test environments (Node/Vitest). In the browser, these
// functions are loaded via importScripts / <script> tags and are
// available as globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    JP_TO_EN_SET_MAP,
    deriveEnSetIdFromJpCode,
    getEnSetIdForJpCode,
    getJpSetCodeForEnSetId,
    findCrossVersionCard,
    findJpVersion,
    findEnVersion,
    fetchCardById,
    fetchAllSets,
    fetchAllSetsCards,
    searchCardsByName,
    searchCardsByDexId,
    matchSetByAbbreviation,
    preloadAllSetData,
  };
}
