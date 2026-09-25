// Parses raw OCR text (from the bottom-left crop) into structured card data:
// { setCode, localId, cardNumber, rarityCode }.
//
// Expected input examples (what Tesseract returns from the bottom-left
// region, after char-whitelisting removes Japanese glyphs):
//   "H M2a 017/193 RR"
//   "H SV2D 069/071 U"
//   "F S12 077/098 RRR"
//   "H SV4a 350/190 SAR"
//   "H SV-P 161/SV-P P"     <- promo: set total is not numeric

const CARD_NUMBER_REGEX = /(\d{1,3})\/(\d{1,3}|[A-Za-z]{1,3}-[A-Za-z0-9]{1,3})/;

// Ordered longest-first so e.g. "SAR" isn't matched as "A" + "R" leftovers,
// and "RRR" isn't mistaken for "RR".
const RARITY_CODES = [
  'MUR', 'SAR', 'SSR', 'CSR', 'CHR', 'RRR',
  'SR', 'RR', 'AR', 'HR', 'UR', 'TR', 'PR',
  'R', 'U', 'C', 'N', 'P', 'K', 'A', 'S',
];

// Matches a token made of an uppercase letter followed by any mix of
// letters/digits/hyphen, e.g. M2a, SV2D, SV4a, S12, SM10a, swsh3, SV-P.
const SET_CODE_TOKEN_REGEX = /\b([A-Za-z][A-Za-z0-9-]{1,6})\b/g;

// Single-letter regulation marks that precede the set code and must not be
// mistaken for it (A through H are the marks used since XY era).
const REGULATION_MARK_REGEX = /^[A-H]$/;

/**
 * Parses OCR text into { setCode, localId, cardNumber, rarityCode }.
 * Returns null if no card number (the most reliable anchor) is found.
 *
 * @param {string} ocrText - raw text returned by Tesseract
 * @returns {{setCode: string|null, localId: string, cardNumber: string, rarityCode: string|null}|null}
 */
function parseCardCode(ocrText) {
  const cleaned = correctOcrErrors(ocrText);

  const numberMatch = cleaned.match(CARD_NUMBER_REGEX);
  if (!numberMatch) return null;

  const localId = numberMatch[1].padStart(3, '0');
  const setTotal = numberMatch[2];
  const cardNumber = `${localId}/${setTotal}`;

  const beforeNumber = cleaned.substring(0, numberMatch.index);
  const afterNumber = cleaned.substring(numberMatch.index + numberMatch[0].length);

  const rarityCode = findRarityCode(afterNumber) || findRarityCode(beforeNumber);
  const setCode = findSetCode(beforeNumber);

  return { setCode, localId, cardNumber, rarityCode };
}

function findRarityCode(text) {
  for (const code of RARITY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  }
  return null;
}

/**
 * Finds the set code among the tokens that appear before the card number.
 * The regulation mark (single letter A-H) is excluded. When multiple
 * candidates remain, the one closest to the card number (i.e. the last
 * token before it) is used, since the regulation mark always comes first.
 */
function findSetCode(textBeforeNumber) {
  const candidates = [...textBeforeNumber.matchAll(SET_CODE_TOKEN_REGEX)]
    .map((m) => m[1])
    .filter((token) => !REGULATION_MARK_REGEX.test(token))
    .filter((token) => !/^illus$/i.test(token)); // drop "Illus." from the illustrator line if it leaked in

  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/**
 * Applies fixes for common Tesseract misreads before parsing.
 * These are conservative, context-limited substitutions to avoid
 * corrupting otherwise-correct text.
 */
function correctOcrErrors(text) {
  let corrected = text;

  // Standalone lowercase L is almost always a misread "1".
  corrected = corrected.replace(/\bl\b/g, '1');

  // A letter O immediately followed by a digit is almost always "0"
  // (e.g. "O17" -> "017").
  corrected = corrected.replace(/\bO(?=\d)/g, '0');

  // Collapse repeated whitespace so downstream regexes are simpler.
  corrected = corrected.replace(/\s+/g, ' ').trim();

  return corrected;
}

/**
 * Validates/corrects a detected set code against a known list of set IDs
 * (fetched from TCGdex, see lib/tcgdex-client.js#fetchAllSets). If the
 * exact code isn't found, returns the closest match by edit distance
 * (only if it's close enough to be plausible), otherwise returns the
 * original code unchanged.
 *
 * @param {string} setCode
 * @param {string[]} knownSetCodes
 * @returns {string}
 */
function correctSetCodeAgainstKnownList(setCode, knownSetCodes) {
  if (!setCode || !knownSetCodes || knownSetCodes.length === 0) return setCode;

  const lowerSetCode = setCode.toLowerCase();
  const exact = knownSetCodes.find((id) => id.toLowerCase() === lowerSetCode);
  if (exact) return exact;

  let best = null;
  let bestDistance = Infinity;
  for (const id of knownSetCodes) {
    const distance = levenshteinDistance(lowerSetCode, id.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }

  // Only accept the fuzzy match if it's a small, plausible correction
  // (at most 1 character different for short codes, 2 for longer ones).
  const maxAllowedDistance = setCode.length <= 3 ? 1 : 2;
  return bestDistance <= maxAllowedDistance ? best : setCode;
}

function levenshteinDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[a.length][b.length];
}
