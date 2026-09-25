import { BULBAPEDIA_API_URL, TCGDEX_JA_SET_FIXTURE, TCGDEX_SET_FIXTURE } from './fixture-config.mjs';
import { SET_CATALOG_NUMBER_RULES } from './set-catalog.mjs';

const SCHEMA_VERSION = 2;

function normalizeSetCode(value) {
  if (typeof value !== 'string') return null;
  return value.trim().toUpperCase() || null;
}

function normalizeCardNumber(value) {
  if (typeof value !== 'string') return null;
  const normalizedValue = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9.-]+(?:\/[A-Z0-9.-]+)?$/.test(normalizedValue)) return null;
  return normalizedValue || null;
}

function normalizeSetName(value) {
  if (typeof value !== 'string') return null;
  const normalizedValue = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return normalizedValue.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
}

function extractLocalId(cardNumber) {
  return cardNumber ? cardNumber.split('/')[0] : null;
}

function resolveSetIdentifier(setCatalog, language, setName, cardNumber, setNameAlt) {
  if (!setName) return null;
  // A jointly released Japanese pair is one Bulbapedia expansion with a
  // per-printing display name ({{TCG|Black Bolt/White Flare|White Flare}}) while
  // the catalog keeps the two sets apart, so the display name is the usable one.
  // Only a display name the catalog knows is used: the same template also carries
  // prose ("the Japanese expansion with the same name").
  const names = setNameAlt && setCatalog[language]?.[setNameAlt] ? [setName, setNameAlt] : [setName];
  const rules = SET_CATALOG_NUMBER_RULES[language] || [];
  for (const name of names) {
    const numberRule = rules.find((rule) => rule.setName === name
      && cardNumber && cardNumber.toUpperCase().startsWith(rule.numberPrefix));
    if (numberRule) return { setCode: numberRule.setCode, tcgdexSetId: numberRule.tcgdexSetId, setName: name };
    const entry = setCatalog[language]?.[name];
    if (entry) return { ...entry, setName: name };
  }
  return null;
}

function buildCardSide(card, printing, language, setCatalog) {
  if (!printing) return null;
  const identifier = resolveSetIdentifier(setCatalog, language, printing.setName, printing.cardNumber, printing.setNameAlt);
  const cardNumber = normalizeCardNumber(printing.cardNumber);
  return {
    language,
    setCode: normalizeSetCode(identifier?.setCode),
    tcgdexSetId: identifier?.tcgdexSetId || null,
    setName: identifier?.setName || printing.setName || null,
    cardNumber,
    localId: extractLocalId(cardNumber),
    rarity: printing.rarity || null,
    cardName: card.cardName || null,
    japaneseName: card.japaneseName || null,
    cardKind: card.cardKind || null,
    hp: card.hp ?? null,
    // Only carried when set: the flag tells the runtime that this printing has
    // no printed set code, so marketplace queries must use the card name.
    ...(identifier?.printsNoSetCode ? { printsNoSetCode: true } : {}),
  };
}

function buildEvidence(card) {
  return {
    pageTitle: card.title,
    pageId: card.pageId,
    revisionId: card.revisionId,
    derivation: 'paired-expansion-template',
  };
}

function findCandidateReasons(source, target, validTcgdexSetIds) {
  const reasons = [];
  if (!source?.setCode) reasons.push('missing-source-set-identifier');
  if (!source?.cardNumber) reasons.push('missing-source-card-number');
  if (!target) return [...reasons, 'missing-target-printing'];
  if (!target.setCode) reasons.push('missing-target-set-identifier');
  if (!target.cardNumber) reasons.push('missing-target-card-number');
  if (!target.tcgdexSetId) reasons.push('missing-target-tcgdex-set-id');
  if (target.tcgdexSetId && !validTcgdexSetIds.has(target.tcgdexSetId)) reasons.push('unknown-target-tcgdex-set-id');
  return reasons;
}

function buildSourceKey(source) {
  const normalizedSetName = normalizeSetName(source?.setName);
  if (!source?.setCode || !normalizedSetName || !source?.cardNumber) return null;
  return `${source.language}:${source.setCode}:${normalizedSetName}:${source.cardNumber}`;
}

function buildDirectionalCandidate(card, printing, sourceLanguage, setCatalog, validTcgdexSetIds) {
  const targetLanguage = sourceLanguage === 'ja' ? 'en' : 'ja';
  const source = buildCardSide(card, printing[sourceLanguage], sourceLanguage, setCatalog);
  const target = buildCardSide(card, printing[targetLanguage], targetLanguage, setCatalog);
  const reasons = findCandidateReasons(source, target, validTcgdexSetIds);
  return {
    sourceKey: buildSourceKey(source),
    status: reasons.length === 0 ? 'structured' : 'incomplete',
    source,
    target,
    evidence: buildEvidence(card),
    reasons,
  };
}

function buildDirectionalCandidates(card, setCatalog, validTcgdexSetIds, excludedSourceKeys) {
  const candidates = [];
  for (const printing of card.printings) {
    if (printing.ja) candidates.push(buildDirectionalCandidate(card, printing, 'ja', setCatalog, validTcgdexSetIds));
    if (printing.en) candidates.push(buildDirectionalCandidate(card, printing, 'en', setCatalog, validTcgdexSetIds));
  }
  return candidates.filter((candidate) => !candidate.sourceKey || !excludedSourceKeys.has(candidate.sourceKey));
}

function compareNullableValues(leftValue, rightValue) {
  return leftValue == null || rightValue == null || leftValue === rightValue;
}

function hasSourceConflict(leftSource, rightSource) {
  const fields = ['language', 'setCode', 'setName', 'cardNumber', 'rarity', 'cardName', 'japaneseName', 'cardKind', 'hp'];
  return fields.some((field) => !compareNullableValues(leftSource[field], rightSource[field]));
}

function hasTargetConflict(leftTarget, rightTarget) {
  const fields = ['language', 'setCode', 'tcgdexSetId', 'setName', 'cardNumber', 'rarity', 'cardName', 'japaneseName', 'cardKind', 'hp'];
  return fields.some((field) => !compareNullableValues(leftTarget[field], rightTarget[field]));
}

function buildTargetKey(target) {
  return `${target.language}:${target.setCode}:${normalizeSetName(target.setName)}:${target.cardNumber}`;
}

function compareEvidence(leftEvidence, rightEvidence) {
  return leftEvidence.pageTitle.localeCompare(rightEvidence.pageTitle)
    || leftEvidence.pageId - rightEvidence.pageId
    || leftEvidence.revisionId - rightEvidence.revisionId;
}

function addEvidence(target, evidence) {
  const evidenceKey = JSON.stringify(evidence);
  if (!target.evidence.some((item) => JSON.stringify(item) === evidenceKey)) target.evidence.push(evidence);
  target.evidence.sort(compareEvidence);
}

function addStructuredCandidate(records, conflictKeys, conflicts, candidate) {
  if (conflictKeys.has(candidate.sourceKey)) return;
  const existingRecord = records.get(candidate.sourceKey);
  if (existingRecord && hasSourceConflict(existingRecord.source, candidate.source)) {
    records.delete(candidate.sourceKey);
    conflictKeys.add(candidate.sourceKey);
    conflicts.push({ sourceKey: candidate.sourceKey, reason: 'conflicting-source-metadata' });
    return;
  }
  const record = existingRecord || { status: 'structured', source: candidate.source, targets: [] };
  const targetKey = buildTargetKey(candidate.target);
  const existingTarget = record.targets.find((target) => buildTargetKey(target) === targetKey);
  if (existingTarget && hasTargetConflict(existingTarget, candidate.target)) {
    records.delete(candidate.sourceKey);
    conflictKeys.add(candidate.sourceKey);
    conflicts.push({ sourceKey: candidate.sourceKey, reason: 'conflicting-target-metadata' });
    return;
  }
  if (existingTarget) {
    addEvidence(existingTarget, candidate.evidence);
  } else {
    record.targets.push({ ...candidate.target, evidence: [candidate.evidence] });
  }
  record.targets.sort((left, right) => buildTargetKey(left).localeCompare(buildTargetKey(right)));
  records.set(candidate.sourceKey, record);
}

function sortByJson(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

// Reasons that make an EN-source candidate marketplace-only instead of an exact
// record. A JA target without a TCGdex set id is one; the card number may be
// missing as well, because Bulbapedia prints no jpcardno for the early DP sets,
// where the source page knows the Japanese set but not the number. Keeping that
// record lets the runtime stop guessing the JP printing from TCGdex, which has
// no card for those sets at all. Reasons are compared in the order
// findCandidateReasons pushes them.
const EN_TO_JA_REASON_SETS = [
  ['missing-target-tcgdex-set-id'],
  ['missing-target-card-number', 'missing-target-tcgdex-set-id'],
];

function isEnToJaCandidate(candidate) {
  if (candidate.source?.language !== 'en') return false;
  return EN_TO_JA_REASON_SETS.some((reasonSet) => reasonSet.length === candidate.reasons.length
    && reasonSet.every((reason, index) => candidate.reasons[index] === reason));
}

function buildIndex(candidates) {
  const records = new Map();
  const conflictKeys = new Set();
  const conflicts = [];
  const structuredCandidates = candidates
    .filter((candidate) => candidate.status === 'structured')
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey) || buildTargetKey(left.target).localeCompare(buildTargetKey(right.target)));
  for (const candidate of structuredCandidates) addStructuredCandidate(records, conflictKeys, conflicts, candidate);
  const sortedRecords = [...records.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  // EN→JA targets never have a TCGdex set ID (TCGdex lacks the JA BW sets), so
  // they cannot be exact lookup records. They still carry the JP physical set
  // code, and usually the card number, which is what a marketplace keyword
  // needs.
  const enToJaRecords = new Map();
  const enToJaCandidates = candidates
    .filter(isEnToJaCandidate)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey) || buildTargetKey(left.target).localeCompare(buildTargetKey(right.target)));
  for (const candidate of enToJaCandidates) addStructuredCandidate(enToJaRecords, conflictKeys, conflicts, candidate);
  const sortedEnToJa = [...enToJaRecords.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return {
    index: {
      schemaVersion: SCHEMA_VERSION,
      records: Object.fromEntries(sortedRecords),
      enToJa: Object.fromEntries(sortedEnToJa),
    },
    conflicts: conflicts.sort(sortByJson),
  };
}

function compactIncompleteRecord(candidate) {
  return {
    sourceKey: candidate.sourceKey,
    source: candidate.source ? {
      language: candidate.source.language,
      setCode: candidate.source.setCode,
      setName: candidate.source.setName,
      cardNumber: candidate.source.cardNumber,
    } : null,
    target: candidate.target ? {
      language: candidate.target.language,
      setCode: candidate.target.setCode,
      tcgdexSetId: candidate.target.tcgdexSetId,
      setName: candidate.target.setName,
      cardNumber: candidate.target.cardNumber,
    } : null,
    pageTitle: candidate.evidence.pageTitle,
    reasons: [...candidate.reasons].sort(),
  };
}

function buildManifest(sources, validTcgdexSetIds) {
  const manifestSources = sources
    .filter((source) => source.result.success)
    .map((source) => ({
      fileName: source.fileName,
      kind: source.kind,
      pageTitle: source.result.data.title,
      pageId: source.result.data.pageId,
      revisionId: source.result.data.revisionId,
      revisionTimestamp: source.result.data.revisionTimestamp,
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  return {
    schemaVersion: SCHEMA_VERSION,
    sources: manifestSources,
    sourceApi: BULBAPEDIA_API_URL,
    targetSetCatalog: {
      languages: [TCGDEX_SET_FIXTURE.language, TCGDEX_JA_SET_FIXTURE.language],
      sourceUrls: [TCGDEX_SET_FIXTURE.url, TCGDEX_JA_SET_FIXTURE.url],
      setCount: validTcgdexSetIds.size,
    },
  };
}

function buildSourceSummaries(sources) {
  const successfulSources = sources.filter((source) => source.result.success);
  return {
    redirects: successfulSources
      .filter((source) => source.kind === 'redirect')
      .map((source) => ({ pageTitle: source.result.data.title, targetTitle: source.result.data.targetTitle }))
      .sort(sortByJson),
    setPages: successfulSources
      .filter((source) => source.kind === 'set')
      .map((source) => ({
        pageTitle: source.result.data.title,
        pageId: source.result.data.pageId,
        revisionId: source.result.data.revisionId,
        setNames: [...source.result.data.setNames].sort(),
        cardCount: source.result.data.cards.length,
      }))
      .sort(sortByJson),
    unsupportedSources: sources
      .filter((source) => !source.result.success)
      .map((source) => ({ fileName: source.fileName, kind: source.kind, error: source.result.error }))
      .sort(sortByJson),
  };
}

function buildReport(sources, candidates, index, conflicts) {
  const summaries = buildSourceSummaries(sources);
  const incompleteRecords = candidates
    .filter((candidate) => candidate.status === 'incomplete')
    .map(compactIncompleteRecord)
    .sort(sortByJson);
  const ambiguousRecords = Object.entries(index.records)
    .filter(([, record]) => record.targets.length > 1)
    .map(([sourceKey, record]) => ({ sourceKey, targetCount: record.targets.length }));
  const publishedTargets = Object.values(index.records).reduce((total, record) => total + record.targets.length, 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: {
      sourceFiles: sources.length,
      cardPages: sources.filter((source) => source.kind === 'card' && source.result.success).length,
      setPages: summaries.setPages.length,
      redirectPages: summaries.redirects.length,
      directionalCandidates: candidates.length,
      publishedRecords: Object.keys(index.records).length,
      publishedTargets,
      enToJaRecords: Object.keys(index.enToJa || {}).length,
      statuses: {
        structured: Object.keys(index.records).length,
        inferred: 0,
        incomplete: incompleteRecords.length,
        conflict: conflicts.length,
      },
    },
    ambiguousRecords,
    conflicts,
    incompleteRecords,
    redirects: summaries.redirects,
    setPages: summaries.setPages,
    unsupportedSources: summaries.unsupportedSources,
  };
}

function createBulbapediaArtifacts({ sources, setCatalog, validTcgdexSetIds, excludedSourceKeys = new Set() }) {
  const sortedSources = [...sources].sort((left, right) => left.fileName.localeCompare(right.fileName));
  const cards = sortedSources.filter((source) => source.kind === 'card' && source.result.success);
  const candidates = cards.flatMap((source) => buildDirectionalCandidates(source.result.data, setCatalog, validTcgdexSetIds, excludedSourceKeys));
  const { index, conflicts } = buildIndex(candidates);
  return {
    index,
    manifest: buildManifest(sortedSources, validTcgdexSetIds),
    report: buildReport(sortedSources, candidates, index, conflicts),
  };
}

export {
  createBulbapediaArtifacts,
  normalizeCardNumber,
  normalizeSetCode,
  normalizeSetName,
};
