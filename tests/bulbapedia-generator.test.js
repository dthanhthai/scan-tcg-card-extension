import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseCardPage,
  parseRedirectPage,
  parseSetPage,
  parseWithReport,
} from '../scripts/bulbapedia/bulbapedia-parser.mjs';
import {
  createBulbapediaArtifacts,
  normalizeCardNumber,
  normalizeSetCode,
  normalizeSetName,
} from '../scripts/bulbapedia/bulbapedia-generator.mjs';
import { BULBAPEDIA_PAGE_FIXTURES } from '../scripts/bulbapedia/fixture-config.mjs';
import { SET_CATALOG } from '../scripts/bulbapedia/set-catalog.mjs';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BULBAPEDIA_FIXTURE_DIRECTORY = join(TEST_DIRECTORY, 'fixtures/bulbapedia');
const TCGDEX_SET_FIXTURE_PATH = join(TEST_DIRECTORY, 'fixtures/tcgdex/en-sets.json');
const GENERATED_DATA_DIRECTORY = join(TEST_DIRECTORY, '../data/bulbapedia');
const PAGE_PARSERS = {
  card: parseCardPage,
  redirect: parseRedirectPage,
  set: parseSetPage,
};

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function loadParsedSources() {
  return BULBAPEDIA_PAGE_FIXTURES.map((fixture) => ({
    fileName: fixture.fileName,
    kind: fixture.kind,
    result: parseWithReport(PAGE_PARSERS[fixture.kind], loadJson(join(BULBAPEDIA_FIXTURE_DIRECTORY, fixture.fileName))),
  }));
}

function loadTcgdexSetIds() {
  return new Set(loadJson(TCGDEX_SET_FIXTURE_PATH).map((set) => set.id));
}

function createSyntheticCardSource(overrides = {}) {
  const sourceNumber = overrides.sourceNumber || '001/050';
  const targetNumber = overrides.targetNumber || '1/100';
  return {
    fileName: overrides.fileName || 'synthetic.json',
    kind: 'card',
    result: {
      success: true,
      error: null,
      data: {
        title: overrides.title || 'Synthetic Card',
        pageId: overrides.pageId || 1,
        revisionId: overrides.revisionId || 1,
        revisionTimestamp: '2026-01-01T00:00:00Z',
        cardKind: 'pokemon',
        cardName: overrides.cardName || 'Darkrai',
        japaneseName: 'ダークライEX',
        hp: 180,
        printings: [{
          ja: { setName: 'Dark Rush', cardNumber: sourceNumber, rarity: overrides.sourceRarity || 'R' },
          en: { setName: 'Dark Explorers', cardNumber: targetNumber, rarity: overrides.targetRarity || 'Rare Holo ex' },
        }],
      },
    },
  };
}

// Bulbapedia prints no jpcardno for the early DP sets, so the page knows the
// Japanese set but not the card number (real case: Great Encounters 3 Darkrai).
function createSyntheticNumberlessSource() {
  return {
    fileName: 'synthetic-no-jp-number.json',
    kind: 'card',
    result: {
      success: true,
      error: null,
      data: {
        title: 'Darkrai (Great Encounters 3)',
        pageId: 35627,
        revisionId: 4334840,
        revisionTimestamp: '2026-01-01T00:00:00Z',
        cardKind: 'pokemon',
        cardName: 'Darkrai',
        japaneseName: 'ダークライ',
        hp: 70,
        printings: [{
          ja: { setName: 'Moonlit Pursuit', cardNumber: null, rarity: 'Rare Holo' },
          en: { setName: 'Great Encounters', cardNumber: '3/106', rarity: 'Rare Holo' },
        }],
      },
    },
  };
}

describe('Bulbapedia normalization', () => {
  it('normalizes set codes without changing separators', () => {
    expect(normalizeSetCode(' bw-p ')).toBe('BW-P');
  });

  it('preserves leading zeroes in full card numbers', () => {
    expect(normalizeCardNumber(' 044 / 069 ')).toBe('044/069');
  });

  it('normalizes alphanumeric promo numbers', () => {
    expect(normalizeCardNumber('bw46')).toBe('BW46');
  });

  it('normalizes physical set names for collision-free keys', () => {
    expect(normalizeSetName(' Black & White Collection ')).toBe('BLACK_WHITE_COLLECTION');
  });
});

describe('createBulbapediaArtifacts', () => {
  it('generates five structured JP to EN records from Phase 1 fixtures', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(Object.keys(artifacts.index.records)).toEqual([
      'ja:BW1:BLACK_COLLECTION:053/053',
      'ja:BW4:DARK_RUSH:044/069',
      'ja:BW4:DARK_RUSH:072/069',
      'ja:BW8:THUNDER_KNUCKLE:055/051',
      'ja:EB:EX_BATTLE_BOOST:072/093',
    ]);
    expect(artifacts.report.summary.publishedRecords).toBe(5);
    expect(artifacts.report.summary.statuses.structured).toBe(5);
  });

  it('generates the exact Darkrai regular counterpart', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.index.records['ja:BW4:DARK_RUSH:044/069']).toMatchObject({
      status: 'structured',
      source: {
        language: 'ja',
        setCode: 'BW4',
        setName: 'Dark Rush',
        cardNumber: '044/069',
        localId: '044',
        rarity: 'R',
      },
      targets: [{
        language: 'en',
        setCode: 'DEX',
        tcgdexSetId: 'bw5',
        setName: 'Dark Explorers',
        cardNumber: '63/108',
        localId: '63',
        rarity: 'Rare Holo ex',
      }],
    });
  });

  it('stores provenance for every published target', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    const target = artifacts.index.records['ja:BW4:DARK_RUSH:044/069'].targets[0];
    expect(target.evidence).toEqual([{
      pageTitle: 'Darkrai-EX (Dark Explorers 63)',
      pageId: 150074,
      revisionId: expect.any(Number),
      derivation: 'paired-expansion-template',
    }]);
  });

  it('reports incomplete reverse, promo, and deck-only relationships', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.report.summary.statuses.incomplete).toBeGreaterThan(0);
    expect(artifacts.report.incompleteRecords.some((record) => record.reasons.includes('missing-target-tcgdex-set-id'))).toBe(true);
    expect(artifacts.report.incompleteRecords.some((record) => record.reasons.includes('missing-target-printing'))).toBe(true);
    expect(artifacts.report.incompleteRecords.some((record) => record.reasons.includes('missing-source-set-identifier'))).toBe(true);
  });

  it('keeps an EN source as a marketplace-only record when its JA printing has no card number', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: [createSyntheticNumberlessSource()],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(Object.keys(artifacts.index.records)).toEqual([]);
    expect(Object.keys(artifacts.index.enToJa)).toEqual(['en:DP4:GREAT_ENCOUNTERS:3/106']);
    expect(artifacts.index.enToJa['en:DP4:GREAT_ENCOUNTERS:3/106'].targets[0]).toMatchObject({
      language: 'ja',
      setCode: 'DP4',
      setName: 'Moonlit Pursuit',
      cardNumber: null,
      localId: null,
    });
  });

  it('still rejects a JA target whose set is unknown', () => {
    const source = createSyntheticNumberlessSource();
    source.result.data.printings[0].ja.setName = 'Nowhere Pack';
    const artifacts = createBulbapediaArtifacts({
      sources: [source],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(Object.keys(artifacts.index.enToJa)).toEqual([]);
  });

  it('includes all source revisions in a stable manifest', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.manifest.schemaVersion).toBe(2);
    expect(artifacts.manifest.sources).toHaveLength(4);
    expect(artifacts.manifest.sources.map((source) => source.fileName)).toEqual([
      'dark-explorers-set.json',
      'darkrai-ex.json',
      'ex-battle-boost-redirect.json',
      'professor-juniper.json',
    ]);
    expect(artifacts.manifest.sources.every((source) => source.revisionId > 0)).toBe(true);
  });

  it('includes set and redirect summaries in the review report', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.report.setPages).toContainEqual(expect.objectContaining({
      pageTitle: 'Dark Explorers (TCG)',
      setNames: expect.arrayContaining(['Dark Explorers', 'Dark Rush']),
    }));
    expect(artifacts.report.redirects).toContainEqual({
      pageTitle: 'EX Battle Boost (TCG)',
      targetTitle: 'Legendary Treasures (TCG)',
    });
  });

  it('does not publish targets with unknown TCGdex set IDs', () => {
    const invalidCatalog = structuredClone(SET_CATALOG);
    invalidCatalog.en['Dark Explorers'].tcgdexSetId = 'missing-set';
    const artifacts = createBulbapediaArtifacts({
      sources: [createSyntheticCardSource()],
      setCatalog: invalidCatalog,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.index.records).toEqual({});
    expect(artifacts.report.incompleteRecords.some((record) => record.reasons.includes('unknown-target-tcgdex-set-id'))).toBe(true);
  });

  it('preserves multiple valid targets and reports ambiguity', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: [
        createSyntheticCardSource({ fileName: 'a.json', pageId: 1, targetNumber: '63/108' }),
        createSyntheticCardSource({ fileName: 'b.json', pageId: 2, targetNumber: '107/108' }),
      ],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.index.records['ja:BW4:DARK_RUSH:001/050'].targets).toHaveLength(2);
    expect(artifacts.report.ambiguousRecords).toEqual([{
      sourceKey: 'ja:BW4:DARK_RUSH:001/050',
      targetCount: 2,
    }]);
  });

  it('removes conflicting source records from the published index', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: [
        createSyntheticCardSource({ fileName: 'a.json', pageId: 1, cardName: 'Darkrai' }),
        createSyntheticCardSource({ fileName: 'b.json', pageId: 2, cardName: 'Cresselia' }),
      ],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.index.records).toEqual({});
    expect(artifacts.report.conflicts).toEqual([
      { sourceKey: 'en:DEX:DARK_EXPLORERS:1/100', reason: 'conflicting-source-metadata' },
      { sourceKey: 'ja:BW4:DARK_RUSH:001/050', reason: 'conflicting-source-metadata' },
    ]);
  });

  it('removes conflicting target records from the published index', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: [
        createSyntheticCardSource({ fileName: 'a.json', pageId: 1, targetRarity: 'Rare Holo ex' }),
        createSyntheticCardSource({ fileName: 'b.json', pageId: 2, targetRarity: 'Rare Ultra' }),
      ],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.index.records).toEqual({});
    expect(artifacts.report.conflicts).toEqual([
      { sourceKey: 'en:DEX:DARK_EXPLORERS:1/100', reason: 'conflicting-source-metadata' },
      { sourceKey: 'ja:BW4:DARK_RUSH:001/050', reason: 'conflicting-target-metadata' },
    ]);
  });

  it('enforces runtime index invariants', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    for (const [sourceKey, record] of Object.entries(artifacts.index.records)) {
      expect(sourceKey).toBe(`${record.source.language}:${record.source.setCode}:${normalizeSetName(record.source.setName)}:${record.source.cardNumber}`);
      expect(record.status).toBe('structured');
      expect(record.source.localId).toBe(record.source.cardNumber.split('/')[0]);
      expect(record.targets.length).toBeGreaterThan(0);
      for (const target of record.targets) {
        expect(target.localId).toBe(target.cardNumber.split('/')[0]);
        expect(target.tcgdexSetId).toBeTruthy();
        expect(target.evidence.length).toBeGreaterThan(0);
        expect(target.evidence.every((evidence) => evidence.pageId > 0 && evidence.revisionId > 0)).toBe(true);
      }
    }
  });

  it('produces identical artifacts regardless of source order', () => {
    const sources = loadParsedSources();
    const options = { setCatalog: SET_CATALOG, validTcgdexSetIds: loadTcgdexSetIds() };
    const forward = createBulbapediaArtifacts({ ...options, sources });
    const reversed = createBulbapediaArtifacts({ ...options, sources: [...sources].reverse() });
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it('matches the committed generated artifacts', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: loadParsedSources(),
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(loadJson(join(GENERATED_DATA_DIRECTORY, 'counterpart-index.json'))).toEqual(artifacts.index);
    expect(loadJson(join(GENERATED_DATA_DIRECTORY, 'source-manifest.json'))).toEqual(artifacts.manifest);
    expect(loadJson(join(GENERATED_DATA_DIRECTORY, 'generation-report.json'))).toEqual(artifacts.report);
  });

  it('reports unsupported parser sources without publishing them', () => {
    const artifacts = createBulbapediaArtifacts({
      sources: [{
        fileName: 'unsupported.json',
        kind: 'card',
        result: { success: false, data: null, error: 'Unsupported template' },
      }],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: loadTcgdexSetIds(),
    });
    expect(artifacts.index.records).toEqual({});
    expect(artifacts.report.unsupportedSources).toEqual([{
      fileName: 'unsupported.json',
      kind: 'card',
      error: 'Unsupported template',
    }]);
  });
});

describe('jointly released Japanese pairs', () => {
  // Bulbapedia models the pair as one expansion with a per-printing display
  // name, while the catalog and TCGdex keep Black Bolt (SV11B) and White Flare
  // (SV11W) apart. Without the display name every record of both sets stays
  // incomplete and the runtime falls back to a TCGdex guess.
  const COMBINED_PAGE = [
    '{{PokémoncardInfobox',
    '|cardname=Whimsicott ex',
    '|jname=エルフーンex',
    '|type=Grass',
    '|hp=230',
    '}}',
    '{{PokémoncardInfobox/Expansion|type=Grass|expansion={{TCG|White Flare}}|rarity={{rar|Double Rare}}|cardno=005/086|jpexpansion={{TCG|Black Bolt/White Flare|White Flare}}|jprarity={{rar|RR}}|jpcardno=005/086}}',
    '{{PokémoncardInfobox/Footer|type=Grass|species=Whimsicott}}',
  ].join('\n');

  function parseInlinePage(wikitext) {
    const page = {
      title: 'Whimsicott ex (White Flare 5)',
      pageid: 1,
      revisions: [{ revid: 2, timestamp: '2026-01-01T00:00:00Z', slots: { main: { content: wikitext } } }],
    };
    return {
      fileName: 'inline.json',
      kind: 'card',
      result: parseWithReport(parseCardPage, { query: { pages: [page] } }),
    };
  }

  function buildArtifacts(wikitext) {
    return createBulbapediaArtifacts({
      sources: [parseInlinePage(wikitext)],
      setCatalog: SET_CATALOG,
      validTcgdexSetIds: new Set([...loadTcgdexSetIds(), 'SV11B', 'SV11W', 'sv10.5b', 'sv10.5w']),
    });
  }

  it('resolves both sides through the display name', () => {
    const artifacts = buildArtifacts(COMBINED_PAGE);
    expect(Object.keys(artifacts.index.records)).toEqual([
      'en:SV11W:WHITE_FLARE:005/086',
      'ja:SV11W:WHITE_FLARE:005/086',
    ]);
    expect(artifacts.index.records['en:SV11W:WHITE_FLARE:005/086']).toMatchObject({
      status: 'structured',
      source: { language: 'en', setCode: 'SV11W', tcgdexSetId: 'sv10.5w', setName: 'White Flare', cardNumber: '005/086' },
      targets: [{ language: 'ja', setCode: 'SV11W', tcgdexSetId: 'SV11W', setName: 'White Flare', cardNumber: '005/086' }],
    });
  });

  it('keeps prose out of the set name', () => {
    // The same template also carries "the Japanese expansion with the same name".
    const prosePage = COMBINED_PAGE.replace('|White Flare}}', '|the Japanese expansion with the same name}}');
    const artifacts = buildArtifacts(prosePage);
    expect(artifacts.index.records).toEqual({});
    expect(artifacts.report.incompleteRecords[0].reasons).toContain('missing-target-tcgdex-set-id');
  });
});
