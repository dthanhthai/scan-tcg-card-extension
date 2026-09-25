// Bulbapedia static counterpart index resolver.
// Pure logic only: no Chrome APIs, no network. The per-era bundles
// (data/bulbapedia/<era>/counterpart-index.js) and the merger
// (lib/bulbapedia-index.js) must be loaded before this file in
// popup/scanner contexts; callers pass the records they want to resolve.
// Phase 4: report-only mode — the result is logged and attached to the scan
// result but never changes which card the existing pipeline returns.

function normalizeBulbapediaLookupName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return normalized.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
}

function normalizeBulbapediaLookupCode(value) {
  if (typeof value !== 'string') return null;
  return value.trim().toUpperCase() || null;
}

function normalizeBulbapediaLookupNumber(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9.-]+(?:\/[A-Z0-9.-]+)?$/.test(normalized)) return null;
  return normalized || null;
}

function extractBulbapediaLocalId(cardNumber) {
  return cardNumber ? cardNumber.split('/')[0] : null;
}

// Card-name matching ignores print decorations, because the index stores the
// full page-title name (e.g. "M Houndoom-EX", "Venusaur-EX", "Luxray BREAK")
// while Gemini usually reads the base name ("Houndoom", "Venusaur").
function normalizeBulbapediaCardName(value) {
  if (typeof value !== 'string') return null;
  const stripped = value.normalize('NFKC').trim().toLowerCase()
    .replace(/^(mega|m|primal)[\s-]+/, '')
    .replace(/[\s-]*(ex|gx|break|vmax|vstar|v)$/, '');
  return stripped.replace(/\s+/g, '') || null;
}

// A record is reachable by the set code the index stores and, when the source
// side carries one, by its TCGdex set id as well: the code printed on a card
// ("JTG", "GE") is rarely the one the index stores ("SV09", "DP4"), and callers
// resolve the printed code to a TCGdex id with the shared abbreviation table.
// The two keys are only both added when they differ, so one record never lands
// in the same group twice (which would read as ambiguous).
function buildBulbapediaGroupIndex(records) {
  const groups = new Map();
  const addToGroup = (groupKey, entry) => {
    const group = groups.get(groupKey) || [];
    group.push(entry);
    groups.set(groupKey, group);
  };
  for (const [sourceKey, record] of Object.entries(records || {})) {
    const localId = extractBulbapediaLocalId(record.source?.cardNumber);
    if (!record.source?.language || !record.source?.setCode || !localId) continue;
    const entry = { sourceKey, record };
    const groupKey = `${record.source.language}:${record.source.setCode}:${localId}`;
    addToGroup(groupKey, entry);
    const tcgdexSetId = normalizeBulbapediaLookupCode(record.source.tcgdexSetId);
    if (tcgdexSetId) {
      const tcgdexGroupKey = `${record.source.language}:${tcgdexSetId}:${localId}`;
      if (tcgdexGroupKey !== groupKey) addToGroup(tcgdexGroupKey, entry);
    }
  }
  return groups;
}

let bulbapediaGroupIndexSource = null;
let bulbapediaGroupIndexCache = null;

function getBulbapediaGroupIndex(records) {
  if (records !== bulbapediaGroupIndexSource) {
    bulbapediaGroupIndexSource = records;
    bulbapediaGroupIndexCache = buildBulbapediaGroupIndex(records);
  }
  return bulbapediaGroupIndexCache;
}

function compactBulbapediaCandidate(sourceKey, record, target) {
  return {
    sourceKey,
    sourceSetName: record.source.setName,
    sourceCardNumber: record.source.cardNumber,
    sourceRarity: record.source.rarity,
    tcgdexSetId: target.tcgdexSetId,
    targetSetName: target.setName,
    targetCardNumber: target.cardNumber,
    targetLocalId: target.localId,
    targetCardName: target.cardName,
    targetRarity: target.rarity,
    targetHp: target.hp,
  };
}

// Resolves a scanned card against the static index.
// query: { language: 'ja'|'en', setCode, cardNumber, setName, cardName, cardNameJp, setCodeAliases? }
// Returns { status, sourceKey?, target?, candidates? } and never picks one of
// several candidates silently: 'ambiguous' means multiple physical sets share
// the printed code+number, 'multi-target' means one source has several EN
// printings. Both are report-only outcomes.
function resolveBulbapediaCounterparts(records, query) {
  if (!records || typeof records !== 'object') return { status: 'disabled' };
  const language = query.language === 'en' ? 'en' : 'ja';
  const setCode = normalizeBulbapediaLookupCode(query.setCode);
  const cardNumber = normalizeBulbapediaLookupNumber(query.cardNumber);
  const localId = extractBulbapediaLocalId(cardNumber);
  if (!localId) return { status: 'miss' };
  // The printed code may not be the one the index stores, so the caller's
  // aliases (a TCGdex set id derived from the abbreviation table) are tried too.
  const setCodeCandidates = [setCode, ...(Array.isArray(query.setCodeAliases) ? query.setCodeAliases : [])]
    .map(normalizeBulbapediaLookupCode)
    .filter(Boolean);
  const groupIndex = getBulbapediaGroupIndex(records);
  let group = [];
  for (const code of setCodeCandidates) {
    const candidateGroup = groupIndex.get(`${language}:${code}:${localId}`) || [];
    if (candidateGroup.length > 0) {
      group = candidateGroup;
      break;
    }
  }
  let candidates = cardNumber && cardNumber.includes('/')
    ? group.filter((entry) => entry.record.source.cardNumber === cardNumber)
    : group;
  // Set-code aliases differ between sources (e.g. Gemini may report "NXD"
  // where the index stores "DEX") and Gemini sometimes reads no code at all.
  // When the code lookup misses, the set name plus localId still identifies
  // the record.
  if (candidates.length === 0 && query.setName) {
    const wanted = normalizeBulbapediaLookupName(query.setName);
    candidates = Object.entries(records)
      .filter(([, record]) => record.source?.language === language
        && normalizeBulbapediaLookupName(record.source.setName) === wanted
        && extractBulbapediaLocalId(record.source.cardNumber) === localId)
      .map(([sourceKey, record]) => ({ sourceKey, record }));
    // A set name can be misread (observed: "Next Destinies" for a Dark
    // Explorers card). When the query has a full number, a record whose
    // total differs contradicts the read set, so keep only exact numbers.
    if (cardNumber && cardNumber.includes('/')) {
      candidates = candidates.filter((entry) => entry.record.source.cardNumber === cardNumber);
    }
  }
  // Last resort: the printed number with its total (e.g. "60/108") is the
  // most reliable OCR field. When set code and set name are both unreadable
  // or wrong, a unique number plus a matching card name still identifies the
  // record; the name match keeps cross-era number collisions from matching.
  if (candidates.length === 0 && cardNumber && cardNumber.includes('/')) {
    const byNumber = Object.entries(records)
      .filter(([, record]) => record.source?.language === language && record.source.cardNumber === cardNumber)
      .map(([sourceKey, record]) => ({ sourceKey, record }));
    const wantedNames = new Set([query.cardName, query.cardNameJp].map(normalizeBulbapediaCardName).filter(Boolean));
    if (wantedNames.size > 0) {
      candidates = byNumber.filter((entry) => wantedNames.has(normalizeBulbapediaCardName(entry.record.source.cardName))
        || wantedNames.has(normalizeBulbapediaCardName(entry.record.source.japaneseName)));
    }
  }
  if (candidates.length > 1 && query.setName) {
    const wanted = normalizeBulbapediaLookupName(query.setName);
    const named = candidates.filter((entry) => normalizeBulbapediaLookupName(entry.record.source.setName) === wanted);
    if (named.length > 0) candidates = named;
  }
  // Experimental: when the set name cannot narrow candidates (paired JP sets
  // share printed codes, and Gemini occasionally misreads set names), fall
  // back to the card names read from the card itself. Never eliminates
  // candidates on a bad name — a non-matching name leaves the group intact.
  if (candidates.length > 1 && (query.cardName || query.cardNameJp)) {
    const wantedNames = new Set([query.cardName, query.cardNameJp].map(normalizeBulbapediaCardName).filter(Boolean));
    const namedCards = candidates.filter((entry) => wantedNames.has(normalizeBulbapediaCardName(entry.record.source.cardName))
      || wantedNames.has(normalizeBulbapediaCardName(entry.record.source.japaneseName)));
    if (namedCards.length > 0) candidates = namedCards;
  }
  // Last resort before a miss: the total only exists to separate records that
  // share a set code and local id (e.g. "BW1" is both White Collection 001/053
  // and Black Collection 001/055), so a lone candidate is accepted as-is.
  // Bulbapedia occasionally prints the wrong total for a row (observed: an SM1+
  // SR row says 055/021 where the set prints 051), which would otherwise make
  // that printing unreachable. Runs after the set-name and number fallbacks so
  // they keep priority (a misread set code must not win here).
  if (candidates.length === 0 && group.length === 1) candidates = group;
  if (candidates.length === 0) return { status: 'miss' };
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates: candidates.flatMap((entry) => entry.record.targets.map((target) => compactBulbapediaCandidate(entry.sourceKey, entry.record, target))),
    };
  }
  const { sourceKey, record } = candidates[0];
  if (record.targets.length !== 1) {
    return {
      status: 'multi-target',
      sourceKey,
      candidates: record.targets.map((target) => compactBulbapediaCandidate(sourceKey, record, target)),
    };
  }
  return { status: 'hit', sourceKey, record, target: record.targets[0] };
}

// Validates a resolved EN target against the card TCGdex actually returns.
// Mirrors the precision-first policy: missing metadata cannot reject, only
// present-and-different metadata can.
function validateBulbapediaTarget(target, tcgCard) {
  const reasons = [];
  if (!tcgCard) return { valid: false, reasons: ['no-tcgdex-card'] };
  const expectedId = `${target.tcgdexSetId}-${target.localId}`;
  if (tcgCard.id && tcgCard.id !== expectedId) reasons.push(`id-mismatch:${tcgCard.id}`);
  if (target.hp != null && tcgCard.hp != null && tcgCard.hp !== target.hp) reasons.push(`hp-mismatch:${tcgCard.hp}`);
  // Keep letters from every script so Japanese target names compare too.
  const normalizeName = (name) => (name || '').normalize('NFKC').toLowerCase().replace(/[-\s]?(ex|gx|v|vmax|vstar)$/u, '').replace(/[^\p{L}\p{N}]/gu, '');
  // JA targets carry the English name in cardName and the Japanese name in
  // japaneseName, so compare the name that matches the target language.
  const expectedName = target.language === 'ja' ? (target.japaneseName || target.cardName) : target.cardName;
  if (expectedName && tcgCard.name && normalizeName(tcgCard.name) !== normalizeName(expectedName)) {
    reasons.push(`name-mismatch:${tcgCard.name}`);
  }
  return { valid: reasons.length === 0, reasons };
}

// Compares the resolver outcome with the card the existing pipeline found.
// existingCard is a TCGdex card object (or null when the pipeline found none).
function compareBulbapediaWithExisting(resolution, existingCard) {
  if (resolution.status === 'hit') {
    // JA targets have no TCGdex set ID, so their printing cannot be verified
    // against the card the existing pipeline found. When the caller adopted
    // the synthesized printing, the id matches even though TCGdex cannot.
    if (!resolution.target.tcgdexSetId) {
      if (!existingCard) return 'resolver-only';
      return existingCard.id === `${resolution.target.setCode}-${resolution.target.localId}` ? 'adopted' : 'unverifiable';
    }
    const expectedId = `${resolution.target.tcgdexSetId}-${resolution.target.localId}`;
    if (!existingCard) return 'resolver-only';
    return existingCard.id === expectedId ? 'agrees' : 'disagrees';
  }
  if (resolution.status === 'ambiguous' || resolution.status === 'multi-target') return 'unresolved-ambiguous';
  return existingCard ? 'existing-only' : 'both-miss';
}
