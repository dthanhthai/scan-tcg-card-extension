import { describe, expect, it } from 'vitest';
import {
  createGoldPairProposals,
  createSetRelationshipAudit,
  filterSourcesBySetNames,
} from '../scripts/bulbapedia/bw-artifacts.mjs';
import { extractRuntimeSetMap } from '../scripts/bulbapedia/runtime-set-map.mjs';

function createTarget(enSetId, overrides = {}) {
  return {
    language: 'en',
    setCode: overrides.setCode || enSetId.toUpperCase(),
    tcgdexSetId: enSetId,
    setName: overrides.setName || enSetId,
    cardNumber: overrides.cardNumber || '1/100',
    localId: overrides.localId || '1',
    rarity: overrides.rarity ?? 'Rare',
    cardName: overrides.cardName || 'Sample Pokémon',
    japaneseName: overrides.japaneseName || 'サンプル',
    cardKind: overrides.cardKind || 'pokemon',
    hp: overrides.hp ?? 100,
    evidence: [{ pageTitle: overrides.pageTitle || 'Sample Card', pageId: 1, revisionId: 2, derivation: 'paired-expansion-template' }],
  };
}

function createRecord(jpSetCode, cardNumber, targets, overrides = {}) {
  return {
    status: 'structured',
    source: {
      language: 'ja',
      setCode: jpSetCode,
      tcgdexSetId: null,
      setName: overrides.setName || jpSetCode,
      cardNumber,
      localId: cardNumber.split('/')[0],
      rarity: overrides.rarity ?? 'R',
      cardName: overrides.cardName || 'Sample Pokémon',
      japaneseName: overrides.japaneseName || 'サンプル',
      cardKind: overrides.cardKind || 'pokemon',
      hp: overrides.hp ?? 100,
    },
    targets,
  };
}

function createSource(printings) {
  return {
    fileName: 'sample.json#1',
    kind: 'card',
    result: {
      success: true,
      error: null,
      data: {
        title: 'Sample Card',
        pageId: 1,
        revisionId: 2,
        revisionTimestamp: '2026-01-01T00:00:00Z',
        cardKind: 'pokemon',
        cardName: 'Sample Pokémon',
        japaneseName: 'サンプル',
        hp: 100,
        printings,
      },
    },
  };
}

describe('filterSourcesBySetNames', () => {
  it('keeps only printings from configured BW JP set names', () => {
    const sources = [createSource([
      { ja: { setName: 'Dark Rush', cardNumber: '001/069', rarity: 'R' }, en: { setName: 'Dark Explorers', cardNumber: '1/108', rarity: 'Rare' } },
      { ja: { setName: 'Collection X', cardNumber: '001/060', rarity: 'C' }, en: { setName: 'XY', cardNumber: '1/146', rarity: 'Common' } },
    ])];
    const filtered = filterSourcesBySetNames(sources, new Set(['Dark Rush']));
    expect(filtered[0].result.data.printings).toEqual([
      { ja: { setName: 'Dark Rush', cardNumber: '001/069', rarity: 'R' }, en: { setName: 'Dark Explorers', cardNumber: '1/108', rarity: 'Rare' } },
    ]);
  });

  it('preserves parser failures for unsupported-source reporting', () => {
    const failure = { fileName: 'bad.json', kind: 'card', result: { success: false, data: null, error: 'Unsupported' } };
    expect(filterSourcesBySetNames([failure], new Set(['Dark Rush']))).toEqual([failure]);
  });
});

describe('createSetRelationshipAudit', () => {
  it('counts observed edges and compares them with the runtime map', () => {
    const index = {
      records: {
        'ja:BW1:001/053': createRecord('BW1', '001/053', [createTarget('bw1')], { setName: 'Black Collection' }),
        'ja:BW1:002/053': createRecord('BW1', '002/053', [createTarget('bw2')], { setName: 'White Collection' }),
        'ja:BW1:003/053': createRecord('BW1', '003/053', [createTarget('bw3')], { setName: 'Black Collection' }),
      },
    };
    const audit = createSetRelationshipAudit(index, { BW1: ['bw1', 'bw2'] });
    expect(audit.relationships).toEqual([
      { jpSetCode: 'BW1', enSetId: 'bw1', cardCount: 1, sourceSetNames: ['Black Collection'], expectedByRuntimeMap: true },
      { jpSetCode: 'BW1', enSetId: 'bw2', cardCount: 1, sourceSetNames: ['White Collection'], expectedByRuntimeMap: true },
      { jpSetCode: 'BW1', enSetId: 'bw3', cardCount: 1, sourceSetNames: ['Black Collection'], expectedByRuntimeMap: false },
    ]);
    expect(audit.setCodes).toEqual([{
      jpSetCode: 'BW1',
      expectedEnSetIds: ['bw1', 'bw2'],
      observedEnSetIds: ['bw1', 'bw2', 'bw3'],
      missingExpectedEnSetIds: [],
      unexpectedObservedEnSetIds: ['bw3'],
      status: 'expanded',
    }]);
  });

  it('reports runtime relationships missing from observed data', () => {
    const audit = createSetRelationshipAudit({ records: {} }, { BW2: 'bw3' });
    expect(audit.setCodes).toEqual([{
      jpSetCode: 'BW2',
      expectedEnSetIds: ['bw3'],
      observedEnSetIds: [],
      missingExpectedEnSetIds: ['bw3'],
      unexpectedObservedEnSetIds: [],
      status: 'missing',
    }]);
  });
});

describe('createGoldPairProposals', () => {
  it('creates one pending proposal for every observed relationship', () => {
    const index = {
      records: {
        'ja:BW1:001/053': createRecord('BW1', '001/053', [createTarget('bw1'), createTarget('bw2')]),
      },
    };
    const proposals = createGoldPairProposals(index);
    expect(proposals.map((proposal) => proposal.relationship)).toEqual(['BW1->bw1', 'BW1->bw2']);
    expect(proposals.every((proposal) => proposal.reviewStatus === 'pending-user-review')).toBe(true);
  });

  it('prefers a Pokémon with HP and complete rarity over a Trainer', () => {
    const index = {
      records: {
        'ja:BW4:001/069': createRecord('BW4', '001/069', [createTarget('bw5', { cardKind: 'trainer', hp: null, rarity: null })], {
          cardKind: 'trainer',
          hp: null,
          rarity: null,
        }),
        'ja:BW4:002/069': createRecord('BW4', '002/069', [createTarget('bw5', { cardNumber: '2/108', localId: '2' })]),
      },
    };
    const proposals = createGoldPairProposals(index);
    expect(proposals[0].source.sourceKey).toBe('ja:BW4:002/069');
    expect(proposals[0].selectionReasons).toEqual(['pokemon-card', 'matching-hp-available', 'both-rarities-present', 'single-target-source']);
  });
});

describe('extractRuntimeSetMap', () => {
  it('extracts the actual map object without executing runtime code', () => {
    const source = "const JP_TO_EN_SET_MAP = { BW1: ['bw1', 'bw2'], BW2: 'bw3' };\n// Reverse map:";
    expect(extractRuntimeSetMap(source)).toEqual({ BW1: ['bw1', 'bw2'], BW2: 'bw3' });
  });

  it('fails when the source does not contain the expected boundary', () => {
    expect(() => extractRuntimeSetMap('const other = {};')).toThrow('JP_TO_EN_SET_MAP boundary not found');
  });
});
