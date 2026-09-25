function filterSourcesBySetNames(sources, eraSetNames) {
  return sources.map((source) => {
    if (!source.result.success || source.kind !== 'card') return source;
    // A jointly released Japanese pair carries the combined expansion name with
    // the per-printing set in setNameAlt ({{TCG|Black Bolt/White Flare|White Flare}}),
    // so either name can be the one this era lists.
    const printings = source.result.data.printings.filter((printing) => eraSetNames.has(printing.ja?.setName)
      || eraSetNames.has(printing.ja?.setNameAlt));
    return {
      ...source,
      result: { ...source.result, data: { ...source.result.data, printings } },
    };
  });
}

function normalizeExpectedSetIds(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((setId) => setId.toLowerCase()).sort();
}

function collectObservedRelationships(index) {
  const relationships = new Map();
  for (const record of Object.values(index.records)) {
    for (const target of record.targets) {
      const relationshipKey = `${record.source.setCode}->${target.tcgdexSetId}`;
      const relationship = relationships.get(relationshipKey) || {
        jpSetCode: record.source.setCode,
        enSetId: target.tcgdexSetId,
        cardCount: 0,
        sourceSetNames: new Set(),
      };
      relationship.cardCount += 1;
      relationship.sourceSetNames.add(record.source.setName);
      relationships.set(relationshipKey, relationship);
    }
  }
  return relationships;
}

function determineAuditStatus(missingExpectedEnSetIds, unexpectedObservedEnSetIds, observedEnSetIds) {
  if (observedEnSetIds.length === 0) return 'missing';
  if (missingExpectedEnSetIds.length === 0 && unexpectedObservedEnSetIds.length === 0) return 'exact';
  if (missingExpectedEnSetIds.length === 0) return 'expanded';
  if (unexpectedObservedEnSetIds.length === 0) return 'partial';
  return 'divergent';
}

function createSetRelationshipAudit(index, runtimeSetMap) {
  const observed = collectObservedRelationships(index);
  const expectedByCode = Object.fromEntries(Object.entries(runtimeSetMap).map(([code, value]) => [code, normalizeExpectedSetIds(value)]));
  const relationships = [...observed.values()]
    .map((relationship) => ({
      jpSetCode: relationship.jpSetCode,
      enSetId: relationship.enSetId,
      cardCount: relationship.cardCount,
      sourceSetNames: [...relationship.sourceSetNames].sort(),
      expectedByRuntimeMap: (expectedByCode[relationship.jpSetCode] || []).includes(relationship.enSetId),
    }))
    .sort((left, right) => left.jpSetCode.localeCompare(right.jpSetCode) || left.enSetId.localeCompare(right.enSetId));
  const observedCodes = new Set(relationships.map((relationship) => relationship.jpSetCode));
  const allCodes = [...new Set([...Object.keys(expectedByCode), ...observedCodes])].sort();
  const setCodes = allCodes.map((jpSetCode) => {
    const expectedEnSetIds = expectedByCode[jpSetCode] || [];
    const observedEnSetIds = relationships.filter((relationship) => relationship.jpSetCode === jpSetCode).map((relationship) => relationship.enSetId).sort();
    const missingExpectedEnSetIds = expectedEnSetIds.filter((setId) => !observedEnSetIds.includes(setId));
    const unexpectedObservedEnSetIds = observedEnSetIds.filter((setId) => !expectedEnSetIds.includes(setId));
    return {
      jpSetCode,
      expectedEnSetIds,
      observedEnSetIds,
      missingExpectedEnSetIds,
      unexpectedObservedEnSetIds,
      status: determineAuditStatus(missingExpectedEnSetIds, unexpectedObservedEnSetIds, observedEnSetIds),
    };
  });
  return { schemaVersion: 1, relationships, setCodes };
}

function scoreProposal(record, target) {
  const selectionReasons = [];
  let selectionScore = 0;
  if (record.source.cardKind === 'pokemon') {
    selectionReasons.push('pokemon-card');
    selectionScore += 4;
  }
  if (record.source.hp != null && target.hp != null && record.source.hp === target.hp) {
    selectionReasons.push('matching-hp-available');
    selectionScore += 3;
  }
  if (record.source.rarity && target.rarity) {
    selectionReasons.push('both-rarities-present');
    selectionScore += 2;
  }
  if (record.targets.length === 1) {
    selectionReasons.push('single-target-source');
    selectionScore += 1;
  }
  return { selectionReasons, selectionScore };
}

function compactProposalSide(side) {
  return {
    language: side.language,
    setCode: side.setCode,
    tcgdexSetId: side.tcgdexSetId,
    setName: side.setName,
    cardNumber: side.cardNumber,
    localId: side.localId,
    rarity: side.rarity,
    cardName: side.cardName,
    japaneseName: side.japaneseName,
    cardKind: side.cardKind,
    hp: side.hp,
  };
}

function createProposalCandidate(sourceKey, record, target) {
  const score = scoreProposal(record, target);
  return {
    relationship: `${record.source.setCode}->${target.tcgdexSetId}`,
    reviewStatus: 'pending-user-review',
    selectionScore: score.selectionScore,
    selectionReasons: score.selectionReasons,
    source: { sourceKey, ...compactProposalSide(record.source) },
    target: { ...compactProposalSide(target), evidence: target.evidence },
  };
}

function createGoldPairProposals(index) {
  const candidatesByRelationship = new Map();
  for (const [sourceKey, record] of Object.entries(index.records)) {
    for (const target of record.targets) {
      const candidate = createProposalCandidate(sourceKey, record, target);
      const candidates = candidatesByRelationship.get(candidate.relationship) || [];
      candidates.push(candidate);
      candidatesByRelationship.set(candidate.relationship, candidates);
    }
  }
  return [...candidatesByRelationship.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candidates]) => candidates.sort((left, right) => right.selectionScore - left.selectionScore || left.source.sourceKey.localeCompare(right.source.sourceKey))[0]);
}

export {
  createGoldPairProposals,
  createSetRelationshipAudit,
  filterSourcesBySetNames,
};
