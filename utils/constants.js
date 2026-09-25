// Shared constants used across the extension (service worker, popup, scanner).
// Loaded as a plain script (no ES module export) so it can be included via
// <script> tags in popup/scanner pages and importScripts() in the service worker.

const TCGDEX_BASE_URL = 'https://api.tcgdex.net/v2';
const CARDRUSH_BASE_URL = 'https://www.cardrush-pokemon.jp';
const CARDRUSH_SEARCH_URL = `${CARDRUSH_BASE_URL}/product-list`;
const TCGPLAYER_SEARCH_URL = 'https://www.tcgplayer.com/search/all/product';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';
const PRICECHARTING_SEARCH_URL = 'https://www.pricecharting.com/search-products';
const COLLECTR_SEARCH_URL = 'https://app.getcollectr.com';

// Maps TCGdex's human-readable rarity string to the short code CardRush uses
// inside the "【XX】" part of a product name.
const TCGDEX_TO_CARDRUSH_RARITY = {
  // Shared
  'Common': 'C',
  'Uncommon': 'U',
  'Rare': 'R',
  'Double rare': 'RR',
  'Triple rare': 'RRR',
  'Super Rare': 'SR',
  'Hyper Rare': 'HR',
  'Ultra Rare': 'UR',
  'MEGA Ultra Rare': 'MUR',
  'Shiny rare': 'S',
  'Promo': 'P',
  // JP-specific
  'Holo Rare': 'R',
  'Holo Rare V': 'RR',
  'Holo Rare VSTAR': 'RRR',
  'Character Rare': 'AR',
  'Character Super Rare': 'SAR',
  'Mega Hyper Rare': 'HR',
  // EN-specific
  'Illustration rare': 'AR',
  'Art Rare': 'AR',
  'Special Art Rare': 'SAR',
  'Special illustration rare': 'SAR',
  'Secret Rare': 'HR',
};

// Chrome message types exchanged between popup/scanner pages and the
// background service worker.
const MESSAGE_TYPES = {
  RECOGNIZE_CARD_CODE: 'RECOGNIZE_CARD_CODE',
  FETCH_CARD_INFO: 'FETCH_CARD_INFO',
  FETCH_CARDRUSH_PRICE: 'FETCH_CARDRUSH_PRICE',
  FETCH_ALL_SETS: 'FETCH_ALL_SETS',
  PRELOAD_SETS: 'PRELOAD_SETS',
  FETCH_EXCHANGE_RATES: 'FETCH_EXCHANGE_RATES',
  FETCH_PRICECHARTING: 'FETCH_PRICECHARTING',
  FETCH_COLLECTR: 'FETCH_COLLECTR',
  FETCH_TCGPLAYER: 'FETCH_TCGPLAYER',
  FIND_JP_VERSION: 'FIND_JP_VERSION',
  FIND_EN_VERSION: 'FIND_EN_VERSION',
};

const STORAGE_KEYS = {
  SCAN_HISTORY: 'scanHistory',
  SETTINGS: 'settings',
  SET_LIST_CACHE: 'setListCache',
  EXCHANGE_RATES_CACHE: 'exchangeRatesCache',
  SNAPSHOT_DATA: 'snapshotData',
};

const MAX_SCAN_HISTORY = 10;
const SET_LIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EXCHANGE_RATES_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Maps printed set codes (what appears on the card) to TCGdex set IDs.
// EN sets often use different IDs (e.g. "me01") than what's printed on cards (e.g. "MEG").
// JP sets typically use the printed code directly as the ID (case-insensitive).
// This covers the most common mismatches; unknown codes fall back to direct lookup.
const SET_CODE_ALIASES = {
  // Mega Evolution (EN)
  'MEG': 'me01', 'MEGEN': 'me01',
  'PFL': 'me02', 'PFLEN': 'me02',
  'POR': 'me03', 'POREN': 'me03',
  'CRI': 'me04', 'CRIEN': 'me04', 'CR1EN': 'me04', 'CR1': 'me04',
  'PBL': 'me05', 'PBLEN': 'me05',
  // Scarlet & Violet (EN)
  'SVI': 'sv01', 'SVIEN': 'sv01',
  'PAL': 'sv02', 'PALEN': 'sv02',
  'OBF': 'sv03', 'OBFEN': 'sv03',
  'PAR': 'sv04', 'PAREN': 'sv04',
  // Scarlet & Violet Promos (EN) — printed as "SVP EN" / "SVPEN" on cards
  'SVP': 'svp', 'SVPEN': 'svp', 'SVP EN': 'svp',
  // Sword & Shield (EN)
  'SSH': 'swsh1', 'SSHEN': 'swsh1',
  'RCL': 'swsh2', 'RClEN': 'swsh2',
  'DAA': 'swsh3', 'DAAEN': 'swsh3',
};

// Where the "regulation mark / set code / card number / rarity" line sits
// on a Pokemon TCG card, as a fraction of the card image's own dimensions
// (0,0 = top-left). Assumes the input image is tightly cropped to just the
// card face (little to no surrounding background/padding) — see
// utils/image-processor.js#preprocessCardImage and scanner/scanner.js's
// crop-guide overlay, both of which use these same values so the on-screen
// guide always matches what actually gets fed to OCR.
//
// Tuned to start low enough (94%) to skip the illustrator credit line just
// above the code line, and narrow enough (35% width) to stop well before
// the black "○○ルール" rule-text bar and/or dense holo-foil texture that
// sits to the right of the code on many cards — testing showed a wider
// crop (45%) let in enough holo speckle to intermittently break OCR even
// with denoising, while 35% reliably leaves the code line legible.
const CARD_CODE_CROP = {
  topFraction: 0.94,
  widthFraction: 0.35,
};

// Hard-coded EN printed abbreviation → TCGdex set ID map.
// Gemini/OCR reads printed abbreviations (e.g. "PBL", "ASC", "SSP") from
// the card. This map resolves them to TCGdex set IDs without needing to
// fetch each set from the API. Generated from TCGdex EN sets (188 entries),
// plus DPP/HSP/SWSHP by hand: those three promo sets are absent from the
// generated list and their abbreviations are the set codes the index stores.
// JP sets do not have abbreviations in TCGdex, so only EN is mapped here.
const EN_ABBREV_TO_SET_ID = {
  'AOR': 'xy7', 'AQ': 'ecard2', 'AR': 'pl4', 'ASC': 'me02.5', 'ASR': 'swsh10',
  'ASR:TG': 'swsh10tg', 'B2': 'base4', 'BCR': 'bw7', 'BKP': 'xy9', 'BKT': 'xy8',
  'BLK': 'sv10.5b', 'BLW': 'bw1', 'BRS': 'swsh9', 'BRS:TG': 'swsh9tg', 'BS': 'base1',
  'BST': 'swsh5', 'BUS': 'sm3', 'BWP': 'bwp', 'CEC': 'sm12', 'CEL': 'cel25',
  'CEL:CC': 'cel25cc', 'CES': 'sm7', 'CG': 'ex14', 'CIN': 'sm4', 'COL': 'col1',
  'CPA': 'swsh3.5', 'CRE': 'swsh6', 'CRI': 'me04', 'CRZ': 'swsh12.5',
  'CRZ:GG': 'swsh12.5gg', 'DAA': 'swsh3', 'DCR': 'dc1', 'DET': 'det1',
  'DEX': 'bw5', 'DF': 'ex15', 'DP': 'dp1', 'DPP': 'dpp', 'DR': 'ex3', 'DRI': 'sv10',
  'DRM': 'sm7.5', 'DRV': 'dv1', 'DRX': 'bw6', 'DS': 'ex11', 'DX': 'ex8',
  'EM': 'ex9', 'EP': 'bw2', 'EVO': 'xy12', 'EVS': 'swsh7', 'EX': 'ecard1',
  'FCO': 'xy10', 'FFI': 'xy3', 'FLF': 'xy2', 'FLI': 'sm6', 'FO': 'base3',
  'FST': 'swsh8', 'FUT20': 'fut2020', 'G1': 'gym1', 'G2': 'gym2', 'GE': 'dp4',
  'GEN': 'g1', 'GRI': 'sm2', 'HIF': 'sm115', 'HL': 'ex5', 'HP': 'ex13',
  'HS': 'hgss1', 'HSP': 'hgssp', 'JTG': 'sv09', 'JU': 'base2', 'KSS': 'xy0', 'LA': 'dp6',
  'LC': 'lc', 'LM': 'ex12', 'LOR': 'swsh11', 'LOR:TG': 'swsh11tg', 'LOT': 'sm8',
  'LTR': 'bw11', 'MA': 'ex4', 'MCD11': '2011bw', 'MCD12': '2012bw',
  'MCD14': '2014xy', 'MCD15': '2015xy', 'MCD16': '2016xy', 'MCD17': '2017sm',
  'MCD18': '2018sm', 'MCD19': '2019sm', 'MCD21': '2021swsh', 'MCD22': '2022swsh',
  'MCD23': '2023sv', 'MCD24': '2024sv', 'MD': 'dp5', 'MEE': 'mee', 'MEG': 'me01',
  'MEP': 'mep', 'MEW': 'sv03.5', 'MFB': 'mfb', 'MT': 'dp2', 'N1': 'neo1',
  'N2': 'neo2', 'N3': 'neo3', 'N4': 'neo4', 'NVI': 'bw3', 'NXD': 'bw4',
  'OBF': 'sv03', 'P1': 'pop1', 'P2': 'pop2', 'P3': 'pop3', 'P4': 'pop4',
  'P5': 'pop5', 'P6': 'pop6', 'P7': 'pop7', 'P8': 'pop8', 'P9': 'pop9',
  'PAF': 'sv04.5', 'PAL': 'sv02', 'PAR': 'sv04', 'PBL': 'me05', 'PFL': 'me02',
  'PGO': 'swsh10.5', 'PHF': 'xy4', 'PK': 'ex16', 'PL': 'pl1', 'PLB': 'bw10',
  'PLF': 'bw9', 'PLS': 'bw8', 'POR': 'me03', 'PRC': 'xy5', 'PRE': 'sv08.5',
  'RCL': 'swsh2', 'RG': 'ex6', 'RM': 'ru1', 'RO': 'base5', 'ROS': 'xy6',
  'RR': 'pl2', 'RS': 'ex1', 'SCR': 'sv07', 'SF': 'dp7', 'SFA': 'sv06.5',
  'SHF': 'swsh4.5', 'SHF:SV': 'swsh4.5sv', 'SI': 'si1', 'SIT': 'swsh12',
  'SIT:TG': 'swsh12tg', 'SK': 'ecard3', 'SLG': 'sm3.5', 'SMP': 'smp',
  'SS': 'ex2', 'SSH': 'swsh1', 'SSP': 'sv08', 'STS': 'xy11', 'SUM': 'sm1',
  'SV': 'pl3', 'SVE': 'sve', 'SVI': 'sv01', 'SVP': 'svp', 'SW': 'dp3', 'SWSHP': 'swshp',
  'TEF': 'sv05', 'TEU': 'sm9', 'TK10A': 'tk-sm-r', 'TK10L': 'tk-sm-l',
  'TK1A': 'tk-ex-latia', 'TK1O': 'tk-ex-latio', 'TK2M': 'tk-ex-m',
  'TK2P': 'tk-ex-p', 'TK3L': 'tk-dp-l', 'TK3M': 'tk-dp-m', 'TK4G': 'tk-hs-g',
  'TK4R': 'tk-hs-r', 'TK5E': 'tk-bw-e', 'TK5Z': 'tk-bw-z', 'TK6N': 'tk-xy-n',
  'TK6S': 'tk-xy-sy', 'TK7A': 'tk-xy-b', 'TK7B': 'tk-xy-w', 'TK8A': 'tk-xy-latia',
  'TK8O': 'tk-xy-latio', 'TK9P': 'tk-xy-p', 'TK9S': 'tk-xy-su', 'TR': 'ex7',
  'TRI': 'hgss4', 'TWM': 'sv06', 'UF': 'ex10', 'UL': 'hgss2', 'UNB': 'sm10',
  'UND': 'hgss3', 'UNM': 'sm11', 'UPR': 'sm5', 'VIV': 'swsh4', 'WHT': 'sv10.5w',
  'XY': 'xy1', 'XYP': 'xyp',
};

// Printed set codes arrive with OCR noise, so the lookup folds them the same way
// the TCGdex client does: a trailing "EN" is dropped, digits that are really
// letters are folded back (1 to I, 0 to O), and dashes are removed.
function normalizePrintedSetCode(value) {
  if (typeof value !== 'string') return null;
  return value.toUpperCase().trim()
    .replace(/\s*EN$/, '')
    .replace(/EN$/, '')
    .replace(/1/g, 'I')
    .replace(/0/g, 'O')
    .replace(/-/g, '') || null;
}

// Resolves a printed abbreviation to its TCGdex EN set id ("JTG" to "sv09"),
// or null when the table does not know it. Used to pick the lookup language and
// to let the index resolver map a printed code onto the set it stores.
function getEnSetIdForPrintedCode(value) {
  const normalized = normalizePrintedSetCode(value);
  return normalized ? (EN_ABBREV_TO_SET_ID[normalized] || null) : null;
}

// DP-era cards print a level next to the name ("Darkrai LV.38"), and the model
// reads it into the card name. The level is not part of the name: Great
// Encounters has Darkrai 3 (LV.38) and Darkrai 4 (LV.40), and TCGdex names both
// "Darkrai", so keeping it breaks the name match and every marketplace query
// built from the name. Only a numeric level is stripped; "LV.X" is a distinct
// card and stays.
function stripPrintedCardLevel(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\blv\.?\s*\d+\s*$/i, '').trim() || value;
}

// Exported for environments that support ES modules (service worker uses
// importScripts, popup/scanner use plain <script> tags, so this is only used
// when running under a module-capable context such as tests).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TCGDEX_BASE_URL,
    CARDRUSH_BASE_URL,
    CARDRUSH_SEARCH_URL,
    TCGPLAYER_SEARCH_URL,
    GEMINI_API_URL,
    TCGDEX_TO_CARDRUSH_RARITY,
    MESSAGE_TYPES,
    STORAGE_KEYS,
    MAX_SCAN_HISTORY,
    SET_LIST_CACHE_TTL_MS,
    CARD_CODE_CROP,
    stripPrintedCardLevel,
    EN_ABBREV_TO_SET_ID,
    normalizePrintedSetCode,
    getEnSetIdForPrintedCode,
  };
}
