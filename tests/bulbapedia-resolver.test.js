import { describe, expect, it } from 'vitest';
import { loadExtensionScripts, loadScript } from './load-scripts.js';
import { setMessageHandler } from './chrome-mock.js';

loadExtensionScripts(
  'utils/storage.js',
  'data/bulbapedia/dp/counterpart-index.js',
  'data/bulbapedia/bw/counterpart-index.js',
  'data/bulbapedia/hgss/counterpart-index.js',
  'data/bulbapedia/xy/counterpart-index.js',
  'data/bulbapedia/sm/counterpart-index.js',
  'data/bulbapedia/swsh/counterpart-index.js',
  'data/bulbapedia/sv/counterpart-index.js',
  'data/bulbapedia/m/counterpart-index.js',
  'data/bulbapedia/set-era-map.js',
  'lib/bulbapedia-index.js',
  'lib/bulbapedia-resolver.js',
  'lib/tcgplayer-linker.js',
  'utils/card-lookup.js',
);

function createRecord(setCode, setName, cardNumber, targets, overrides = {}) {
  return {
    status: 'structured',
    source: {
      language: 'ja',
      setCode,
      tcgdexSetId: null,
      setName,
      cardNumber,
      localId: cardNumber.split('/')[0],
      rarity: 'R',
      cardName: overrides.cardName || 'Darkrai',
      japaneseName: overrides.japaneseName || 'ダークライ',
      cardKind: 'pokemon',
      hp: 180,
    },
    targets,
  };
}

function createTarget(tcgdexSetId, cardNumber, overrides = {}) {
  return {
    language: 'en',
    setCode: overrides.setCode || tcgdexSetId.toUpperCase(),
    tcgdexSetId,
    setName: overrides.setName || 'Dark Explorers',
    cardNumber,
    localId: cardNumber.split('/')[0],
    rarity: overrides.rarity ?? 'Rare Holo ex',
    cardName: overrides.cardName || 'Darkrai',
    japaneseName: overrides.japaneseName || 'ダークライ',
    cardKind: overrides.cardKind || 'pokemon',
    hp: overrides.hp ?? 180,
    evidence: [{ pageTitle: 'Sample', pageId: 1, revisionId: 1, derivation: 'paired-expansion-template' }],
  };
}

function createEnToJaRecord(setCode, setName, cardNumber, targets, overrides = {}) {
  const record = createRecord(setCode, setName, cardNumber, targets, overrides);
  record.source.language = 'en';
  return record;
}

function createJaTarget(setCode, cardNumber, overrides = {}) {
  const target = createTarget('UNUSED', cardNumber, overrides);
  target.language = 'ja';
  target.setCode = setCode;
  target.tcgdexSetId = null;
  return target;
}

const EN_TO_JA_RECORDS = {
  'en:DEX:DARK_EXPLORERS:107/108': createEnToJaRecord('DEX', 'Dark Explorers', '107/108', [
    createJaTarget('BW4', '072/069', { setName: 'Dark Rush' }),
  ]),
  'en:DEX:DARK_EXPLORERS:108/108': createEnToJaRecord('DEX', 'Dark Explorers', '108/108', [
    createJaTarget('BW4', '073/069', { setName: 'Dark Rush' }),
    createJaTarget('EB', '074/093', { setName: 'EX Battle Boost' }),
  ]),
};

const RECORDS = {
  'ja:BW4:DARK_RUSH:044/069': createRecord('BW4', 'Dark Rush', '044/069', [createTarget('bw5', '63/108')]),
  'ja:BW1:BLACK_COLLECTION:001/053': createRecord('BW1', 'Black Collection', '001/053', [createTarget('bw1', '1/114', { cardName: 'Snivy' })], { cardName: 'Snivy', japaneseName: 'ツタージャ' }),
  'ja:BW1:WHITE_COLLECTION:001/053': createRecord('BW1', 'White Collection', '001/053', [createTarget('bw1', '5/114', { cardName: 'Tepig' })], { cardName: 'Tepig', japaneseName: 'ポカブ' }),
  'ja:EB:EX_BATTLE_BOOST:099/093': createRecord('EB', 'EX Battle Boost', '099/093', [
    createTarget('bw11', 'RC25/RC25', { cardName: 'Reshiram' }),
    createTarget('bw11', '113/113', { cardName: 'Reshiram' }),
  ]),
};

describe('resolveBulbapediaCounterparts', () => {
  it('returns disabled when records are missing', () => {
    expect(resolveBulbapediaCounterparts(null, { language: 'ja', setCode: 'BW4', cardNumber: '044/069' }).status).toBe('disabled');
  });

  it('resolves an exact hit with normalization', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: ' bw4 ', cardNumber: ' 044 / 069 ' });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('ja:BW4:DARK_RUSH:044/069');
    expect(result.target.tcgdexSetId).toBe('bw5');
    expect(result.target.localId).toBe('63');
  });

  it('resolves a hit from localId only when cardNumber has no denominator', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW4', cardNumber: '044' });
    expect(result.status).toBe('hit');
    expect(result.target.cardNumber).toBe('63/108');
  });

  it('reports ambiguous when physical sets share code and number', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/053' });
    expect(result.status).toBe('ambiguous');
    expect(result.candidates.map((candidate) => candidate.sourceSetName).sort()).toEqual(['Black Collection', 'White Collection']);
  });

  it('disambiguates with the set name hint', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/053', setName: 'White Collection' });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('ja:BW1:WHITE_COLLECTION:001/053');
    expect(result.target.cardName).toBe('Tepig');
  });

  it('stays ambiguous when the set name hint matches nothing', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/053', setName: 'Red Collection' });
    expect(result.status).toBe('ambiguous');
  });

  it('experimental: disambiguates by English card name when set name fails', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/053', setName: 'Red Collection', cardName: 'Tepig' });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('ja:BW1:WHITE_COLLECTION:001/053');
  });

  it('experimental: disambiguates by Japanese card name', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/053', cardNameJp: 'ツタージャ' });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('ja:BW1:BLACK_COLLECTION:001/053');
  });

  it('experimental: never eliminates candidates on a non-matching card name', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/053', cardName: 'Pikachu' });
    expect(result.status).toBe('ambiguous');
  });

  it('reports multi-target without picking the first target', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'EB', cardNumber: '099/093' });
    expect(result.status).toBe('multi-target');
    expect(result.candidates).toHaveLength(2);
  });

  it('accepts a lone candidate whose printed total disagrees with the query', () => {
    // Bulbapedia prints 055/021 for one SM1+ SR row where the set prints 051;
    // with a single candidate there is nothing for the total to disambiguate.
    const records = {
      'ja:SM1+:SUN_MOON:055/021': createRecord('SM1+', 'Enhanced Expansion Pack Sun & Moon', '055/021', [createTarget('SM1p', '055/051')]),
    };
    const result = resolveBulbapediaCounterparts(records, { language: 'ja', setCode: 'SM1+', cardNumber: '055/051' });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('ja:SM1+:SUN_MOON:055/021');
  });

  it('still separates candidates that share a set code and local id', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW1', cardNumber: '001/999' });
    expect(result.status).toBe('miss');
  });

  it('misses for unknown sets and en sources', () => {
    expect(resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'SV8', cardNumber: '001/187' }).status).toBe('miss');
    expect(resolveBulbapediaCounterparts(RECORDS, { language: 'en', setCode: 'bw5', cardNumber: '63/108' }).status).toBe('miss');
  });
});

describe('validateBulbapediaTarget', () => {
  const target = createTarget('bw5', '63/108');

  it('accepts a matching TCGdex card', () => {
    expect(validateBulbapediaTarget(target, { id: 'bw5-63', name: 'Darkrai-EX', hp: 180 })).toEqual({ valid: true, reasons: [] });
  });

  it('rejects when the returned card id differs', () => {
    const result = validateBulbapediaTarget(target, { id: 'bw5-64', name: 'Darkrai-EX', hp: 180 });
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(['id-mismatch:bw5-64']);
  });

  it('rejects on HP mismatch but tolerates missing HP', () => {
    expect(validateBulbapediaTarget(target, { id: 'bw5-63', name: 'Darkrai-EX', hp: 170 }).valid).toBe(false);
    expect(validateBulbapediaTarget(target, { id: 'bw5-63', name: 'Darkrai-EX' }).valid).toBe(true);
  });
});

describe('compareBulbapediaWithExisting', () => {
  const hit = resolveBulbapediaCounterparts(RECORDS, { language: 'ja', setCode: 'BW4', cardNumber: '044/069' });

  it('agrees when the existing pipeline found the same card', () => {
    expect(compareBulbapediaWithExisting(hit, { id: 'bw5-63' })).toBe('agrees');
  });

  it('disagrees when the existing pipeline found a different card', () => {
    expect(compareBulbapediaWithExisting(hit, { id: 'bw5-64' })).toBe('disagrees');
  });

  it('reports adopted when the JA target is the synthesized JP printing', () => {
    const jaHit = {
      status: 'hit',
      target: { setCode: 'BW4', localId: '072', tcgdexSetId: null },
    };
    expect(compareBulbapediaWithExisting(jaHit, { id: 'BW4-072' })).toBe('adopted');
    expect(compareBulbapediaWithExisting(jaHit, { id: 'M5-099' })).toBe('unverifiable');
  });

  it('reports resolver-only and existing-only coverage gaps', () => {
    expect(compareBulbapediaWithExisting(hit, null)).toBe('resolver-only');
    expect(compareBulbapediaWithExisting({ status: 'miss' }, { id: 'bw5-63' })).toBe('existing-only');
    expect(compareBulbapediaWithExisting({ status: 'miss' }, null)).toBe('both-miss');
    expect(compareBulbapediaWithExisting({ status: 'ambiguous' }, { id: 'bw1-1' })).toBe('unresolved-ambiguous');
  });
});

describe('bundled BW index integration', () => {
  it('loads the real bundled index and resolves a known pair', () => {
    expect(typeof BULBAPEDIA_BW_INDEX).toBe('object');
    expect(BULBAPEDIA_BW_INDEX.releaseStatus).toBe('pending-user-review');
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
      language: 'ja',
      setCode: 'BW4',
      cardNumber: '044/069',
    });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('ja:BW4:DARK_RUSH:044/069');
    expect(result.target.tcgdexSetId).toBe('bw5');
    expect(result.target.cardNumber).toBe('63/108');
  });

  it('handles the observed paired-set collision: BW6 001/059 with a wrong set name', () => {
    const ambiguous = resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
      language: 'ja',
      setCode: 'BW6',
      cardNumber: '001/059',
      setName: 'Dragon Blast',
    });
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.candidates.map((candidate) => candidate.sourceSetName).sort()).toEqual(['Cold Flare', 'Freeze Bolt']);
    const disambiguated = resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
      language: 'ja',
      setCode: 'BW6',
      cardNumber: '001/059',
      setName: 'Dragon Blast',
      cardName: 'Tangela',
    });
    expect(disambiguated.status).toBe('hit');
    expect(disambiguated.sourceKey).toBe('ja:BW6:COLD_FLARE:001/059');
    expect(disambiguated.target.tcgdexSetId).toBe('bw7');
    expect(disambiguated.target.localId).toBe('5');
  });

  it('resolves an EN source to a JA printing via the enToJa records', () => {
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: 'DEX',
      cardNumber: '107/108',
      setName: 'Dark Explorers',
    });
    expect(result.status).toBe('hit');
    expect(result.target.setCode).toBe('BW4');
    expect(result.target.cardNumber).toBe('072/069');
    expect(result.target.localId).toBe('072');
    expect(result.target.tcgdexSetId).toBeNull();
  });

  it('falls back to setName when the scanned setCode uses a different alias', () => {
    // Gemini reported "NXD" for a Dark Explorers card; the index stores "DEX".
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: 'NXD',
      cardNumber: '107/108',
      setName: 'Dark Explorers',
    });
    expect(result.status).toBe('hit');
    expect(result.target.setCode).toBe('BW4');
  });

  it('resolves by setName when Gemini returns no setCode', () => {
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: null,
      cardNumber: '107/108',
      setName: 'Dark Explorers',
    });
    expect(result.status).toBe('hit');
    expect(result.target.setCode).toBe('BW4');
  });

  it('resolves a JA source by setName when Gemini returns no setCode', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, {
      language: 'ja',
      setCode: null,
      cardNumber: '044/069',
      setName: 'Dark Rush',
    });
    expect(result.status).toBe('hit');
    expect(result.target.tcgdexSetId).toBe('bw5');
  });

  it('resolves by the full card number when the set is unreadable', () => {
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: 'ZZZ',
      cardNumber: '107/108',
      setName: 'Nothing Known',
      cardName: 'Darkrai',
    });
    expect(result.status).toBe('hit');
    expect(result.target.setCode).toBe('BW4');
  });

  it('rejects a number-only match when the card name differs', () => {
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: 'ZZZ',
      cardNumber: '107/108',
      setName: 'Nothing Known',
      cardName: 'Zoroark',
    });
    expect(result.status).toBe('miss');
  });

  it('rejects a setName match whose number total contradicts the read number', () => {
    const result = resolveBulbapediaCounterparts(RECORDS, {
      language: 'ja',
      setCode: 'ZZZ',
      cardNumber: '044/050',
      setName: 'Dark Rush',
      cardName: 'Darkrai',
    });
    expect(result.status).toBe('miss');
  });

  it('resolves the real bundled Umbreon record when Gemini misreads the set', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.enToJa, {
      language: 'en',
      setCode: 'HS',
      cardNumber: '60/108',
      setName: 'HeartGold & SoulSilver',
      cardName: 'Umbreon',
      cardNameJp: 'ブラッキー',
    });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('en:DEX:DARK_EXPLORERS:60/108');
    expect(result.target.setCode).toBe('BW4');
    expect(result.target.localId).toBe('042');
  });

  it('misses when both setCode and setName are missing', () => {
    expect(resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: null,
      cardNumber: '107/108',
    }).status).toBe('miss');
  });

  it('still misses when neither setCode nor setName identifies a record', () => {
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: 'NXD',
      cardNumber: '107/108',
      setName: 'Next Destinies',
    });
    expect(result.status).toBe('miss');
  });

  it('returns multi-target for an EN card reprinted in multiple JA sets', () => {
    const result = resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
      language: 'en',
      setCode: 'DEX',
      cardNumber: '108/108',
      setName: 'Dark Explorers',
    });
    expect(result.status).toBe('multi-target');
    expect(result.candidates).toHaveLength(2);
  });

  it('resolves the real bundled Darkrai enToJa record through the alias fallback', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.enToJa, {
      language: 'en',
      setCode: 'NXD',
      cardNumber: '107/108',
      setName: 'Dark Explorers',
    });
    expect(result.status).toBe('hit');
    expect(result.target.setCode).toBe('BW4');
    expect(result.target.localId).toBe('072');
  });

  it('resolves every bundled record key through its own group path', () => {
    for (const [sourceKey, record] of Object.entries(BULBAPEDIA_BW_INDEX.records)) {
      const result = resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
        language: record.source.language,
        setCode: record.source.setCode,
        cardNumber: record.source.cardNumber,
        setName: record.source.setName,
      });
      expect(result.status).toBe('hit');
      expect(result.sourceKey).toBe(sourceKey);
    }
  });
});

describe('merged multi-era index', () => {
  it('exposes JA and EN views that span every bundled era', () => {
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:BW4:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:L1A:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:XY6:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:SM1S:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:S9:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:SV8A:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).some((key) => key.startsWith('ja:M5:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.en).some((key) => key.startsWith('en:DEX:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.en).some((key) => key.startsWith('en:UL:'))).toBe(true);
    expect(Object.keys(BULBAPEDIA_INDEX.en).some((key) => key.startsWith('en:XY:'))).toBe(true);
  });

  it('keeps the JA view free of EN-source records', () => {
    for (const record of Object.values(BULBAPEDIA_INDEX.ja)) {
      expect(record.source.language).toBe('ja');
    }
    for (const record of Object.values(BULBAPEDIA_INDEX.en)) {
      expect(record.source.language).toBe('en');
    }
  });

  it('resolves a real SM pair through the merged JA view', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_INDEX.ja, {
      language: 'ja',
      setCode: 'SM1S',
      cardNumber: '001/060',
      setName: 'Collection Sun',
    });
    expect(result.status).toBe('hit');
    expect(result.target.tcgdexSetId).toBe('sm1');
  });

  it('resolves a real HGSS pair through the merged JA view', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_INDEX.ja, {
      language: 'ja',
      setCode: 'L1a',
      cardNumber: '004/070',
      setName: 'HeartGold Collection',
    });
    expect(result.status).toBe('hit');
    expect(result.target.tcgdexSetId).toBe('hgss1');
    expect(result.target.localId).toBe('83');
  });

  it('matches base names against decorated print names', () => {
    // The index stores page-title names; Gemini reads the base name.
    expect(normalizeBulbapediaCardName('M Houndoom-EX')).toBe('houndoom');
    expect(normalizeBulbapediaCardName('Mega Houndoom EX')).toBe('houndoom');
    expect(normalizeBulbapediaCardName('Primal Groudon-EX')).toBe('groudon');
    expect(normalizeBulbapediaCardName('Luxray BREAK')).toBe('luxray');
    expect(normalizeBulbapediaCardName('Venusaur-EX')).toBe('venusaur');
    expect(normalizeBulbapediaCardName('Mewtwo')).toBe('mewtwo');
    expect(normalizeBulbapediaCardName('Exeggcute')).toBe('exeggcute');
    expect(normalizeBulbapediaCardName('ダークライEX')).toBe('ダークライ');
    expect(normalizeBulbapediaCardName('MヘルガーEX')).toBe('mヘルガー');
  });

  it('resolves a real EN XY pair whose set code was misread', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_INDEX.en, {
      language: 'en',
      setCode: 'ROS',
      cardNumber: '1/146',
      setName: 'Roaring Skies',
      cardName: 'Venusaur',
    });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('en:XY:XY:1/146');
    expect(result.target.setCode).toBe('XY1A');
  });

  it('does not carry provenance into the runtime bundles', () => {
    for (const record of Object.values(BULBAPEDIA_BW_INDEX.records)) {
      expect(record.targets.every((target) => target.evidence === undefined)).toBe(true);
    }
  });
});

describe('bundled DP index integration', () => {
  it('resolves a known DP6 pair to its Stormfront target', () => {
    expect(typeof BULBAPEDIA_DP_INDEX).toBe('object');
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_DP_INDEX.records, {
      language: 'ja',
      setCode: 'DP6',
      cardNumber: '001/092',
    });
    expect(result.status).toBe('hit');
    expect(result.target.tcgdexSetId).toBe('dp7');
    expect(result.target.cardNumber).toBe('78/100');
  });

  it('resolves a DPt promo through the DP Black Star Promos target', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_DP_INDEX.records, {
      language: 'ja',
      setCode: 'DPT-P',
      cardNumber: '041/DPT-P',
    });
    expect(result.status).toBe('hit');
    expect(result.target.tcgdexSetId).toBe('dpp');
    expect(result.target.localId).toBe('DP50');
  });

  it('stays a miss for the early DP sets, which print no Japanese card number', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_DP_INDEX.records, {
      language: 'ja',
      setCode: 'DP1',
      cardNumber: '103/130',
      setName: 'Space-Time Creation',
    });
    expect(result.status).toBe('miss');
  });

  it('resolves an early DP EN card through its set-only enToJa record', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_DP_INDEX.enToJa, {
      language: 'en',
      setCode: 'DP4',
      cardNumber: '3/106',
      setName: 'Great Encounters',
      cardName: 'Darkrai',
    });
    expect(result.status).toBe('hit');
    expect(result.target.setName).toBe('Moonlit Pursuit');
    expect(result.target.localId).toBeNull();
  });
});

describe('manual lookup without a set name', () => {
  it('uses the indexed set for the source fetch when only the code, number and name are entered', async () => {
    const payloads = [];
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        payloads.push(message.payload);
        return {
          success: true,
          data: { id: 'dp4-3', name: 'Darkrai', localId: '3', dexId: [491], hp: 70, set: { id: 'dp4', name: 'Great Encounters', cardCount: { official: 106 } } },
        };
      }
      return { success: false };
    });
    await lookupCardAndPrice(
      'DPBP', '003', '3/106', '', 'Darkrai', 'en', null,
      null, 'ダークライ', false, null, null, null, null, false,
    );
    expect(payloads[0].setCode).toBe('dp4');
    expect(payloads[0].setName).toBe('Great Encounters');
    expect(payloads[0].localId).toBe('3');
  });
});

describe('printed set code aliases', () => {
  const enView = Object.fromEntries([
    ...Object.entries(BULBAPEDIA_SV_INDEX.records).filter(([, record]) => record.source.language === 'en'),
    ...Object.entries(BULBAPEDIA_SV_INDEX.enToJa),
  ]);

  it('resolves a printed abbreviation through the source TCGdex set id', () => {
    const result = resolveBulbapediaCounterparts(enView, {
      language: 'en',
      setCode: 'JTG',
      cardNumber: '003/159',
      setName: null,
      cardName: '',
      setCodeAliases: ['sv09'],
    });
    expect(result.status).toBe('hit');
    expect(result.sourceKey).toBe('en:SV09:JOURNEY_TOGETHER:003/159');
  });

  it('stays a miss without the alias, which is what the caller derives', () => {
    const result = resolveBulbapediaCounterparts(enView, {
      language: 'en',
      setCode: 'JTG',
      cardNumber: '003/159',
      setName: null,
      cardName: '',
    });
    expect(result.status).toBe('miss');
  });

  it('keeps a direct set-code lookup unambiguous', () => {
    const result = resolveBulbapediaCounterparts(BULBAPEDIA_SV_INDEX.records, {
      language: 'en',
      setCode: 'SV09',
      cardNumber: '003/159',
    });
    expect(result.status).toBe('hit');
  });
});

describe('manual search with a printed set code', () => {
  it('resolves JTG 003/159 through the index without a card name or language hint', async () => {
    setMessageHandler(async (message) => {
      if (message.type !== MESSAGE_TYPES.FETCH_CARD_INFO) return { success: false };
      if (String(message.payload.setCode).toUpperCase() === 'SV9') {
        return { success: true, data: { id: 'SV9-003', name: 'バタフリー', localId: '003', hp: 120, set: { id: 'SV9', name: 'Battle Partners' } } };
      }
      return {
        success: true,
        data: { id: 'sv09-003', name: 'Butterfree', localId: '003', dexId: [12], hp: 120, set: { id: 'sv09', name: 'Journey Together', cardCount: { official: 159 } } },
      };
    });
    const result = await lookupCardAndPrice(
      'JTG', '003', '003/159', '', '', null, null,
      null, null, false, null, null, null, null, false,
    );
    expect(result.bulbapediaReport.status).toBe('hit');
    expect(result.bulbapediaReport.sourceKey).toBe('en:SV09:JOURNEY_TOGETHER:003/159');
    // An English scan validates the JP target it resolved, so the validated card
    // is the Japanese printing (the JP section then renders as Verified).
    expect(result.bulbapediaReport.validatedCard.id).toBe('SV9-003');
    expect(result.jpVersion.name).toBe('バタフリー');
  });

  it('resolves a Journey Together card whose Japanese printing is a deck', async () => {
    // Journey Together 006 (Petilil) pairs with a deck product, so it only has a
    // record because the era also crawls the English categories and lists the
    // deck in `extraSetNames`. Before that this lookup ended in a miss.
    setMessageHandler(async (message) => {
      if (message.type !== MESSAGE_TYPES.FETCH_CARD_INFO) return { success: false };
      if (String(message.payload.setCode).toUpperCase() === 'GSD-RESHIRAM') {
        return { success: true, data: { id: 'GSD-RESHIRAM-007', name: 'チュリネ', localId: '007', hp: 50 } };
      }
      return {
        success: true,
        data: { id: 'sv09-006', name: 'Petilil', localId: '006', dexId: [548], hp: 50, set: { id: 'sv09', name: 'Journey Together', cardCount: { official: 159 } } },
      };
    });
    const result = await lookupCardAndPrice(
      'JTG', '006', '006/159', '', '', null, null,
      null, null, false, null, null, null, null, false,
    );
    expect(result.success).toBe(true);
    expect(result.bulbapediaReport.status).toBe('hit');
    expect(result.bulbapediaReport.sourceKey).toBe('en:SV09:JOURNEY_TOGETHER:006/159');
    expect(result.jpVersion.name).toBe('チュリネ');
  });
});

describe('DP set-only counterpart (fail closed)', () => {
  it('does not ask TCGdex for a JP version when the index knows only the JP set', async () => {
    const calls = [];
    setMessageHandler(async (message) => {
      calls.push(message.type);
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        return {
          success: true,
          data: { id: 'dp4-3', name: 'Darkrai', hp: 70, dexId: [491], localId: '3', set: { id: 'dp4', name: 'Great Encounters' } },
        };
      }
      return { success: false };
    });
    const result = await lookupCardAndPrice(
      'DP', '3', '3/106', 'R', 'Darkrai', 'en', 'Great Encounters',
      null, 'ダークライ', false, null, null, null, null, false,
    );
    expect(calls).not.toContain(MESSAGE_TYPES.FIND_JP_VERSION);
    expect(result.success).toBe(true);
    expect(result.jpVersion).toBeNull();
  });
});

describe('lazy index loader', () => {
  it('resolves without a DOM and keeps the statically loaded eras', async () => {
    const eraCount = await ensureBulbapediaIndexes();
    expect(eraCount).toBe(8);
    expect(Object.keys(BULBAPEDIA_INDEX.ja).length).toBeGreaterThan(1000);
    expect(Object.keys(BULBAPEDIA_INDEX.en).length).toBeGreaterThan(1000);
  });

  it('is idempotent', async () => {
    const first = await ensureBulbapediaIndexes();
    const second = await ensureBulbapediaIndexes();
    expect(second).toBe(first);
  });

  it('reports every era as loaded once the bundles are present', () => {
    expect(getLoadedBulbapediaEras().sort()).toEqual(['bw', 'dp', 'hgss', 'm', 'sm', 'sv', 'swsh', 'xy']);
    expect(areAllBulbapediaErasLoaded()).toBe(true);
  });

  it('loads every era on demand for the miss retry', async () => {
    const eraCount = await ensureAllBulbapediaIndexes();
    expect(eraCount).toBe(8);
  });
});

describe('set-era map', () => {
  it('maps printed JP set codes to their era', () => {
    expect(BULBAPEDIA_SET_ERA_MAP.BW1).toContain('bw');
    expect(BULBAPEDIA_SET_ERA_MAP.XY7).toContain('xy');
    expect(BULBAPEDIA_SET_ERA_MAP.SM1S).toContain('sm');
    expect(BULBAPEDIA_SET_ERA_MAP.S9).toContain('swsh');
    expect(BULBAPEDIA_SET_ERA_MAP.SV8A).toContain('sv');
    expect(BULBAPEDIA_SET_ERA_MAP.M5).toContain('m');
    expect(BULBAPEDIA_SET_ERA_MAP.DPT1).toContain('dp');
  });

  it('maps EN set codes and TCGdex set ids to their era', () => {
    expect(BULBAPEDIA_SET_ERA_MAP.BKT).toContain('xy');
    expect(BULBAPEDIA_SET_ERA_MAP.DEX).toContain('bw');
    expect(BULBAPEDIA_SET_ERA_MAP.XY8).toContain('xy');
    expect(BULBAPEDIA_SET_ERA_MAP.DP7).toContain('dp');
  });

  it('maps set names to their era', () => {
    expect(BULBAPEDIA_SET_ERA_MAP.DARK_RUSH).toContain('bw');
    expect(BULBAPEDIA_SET_ERA_MAP.TERASTAL_FEST_EX).toContain('sv');
    expect(BULBAPEDIA_SET_ERA_MAP.INTENSE_FIGHT_IN_THE_DESTROYED_SKY).toContain('dp');
  });
});

describe('resolveBulbapediaEras', () => {
  const map = { BW4: ['bw'], XY7: ['xy'], DARK_RUSH: ['bw'] };

  it('resolves by set code, case-insensitively', () => {
    expect(resolveBulbapediaEras(map, { setCode: 'bw4' })).toEqual(['bw']);
  });

  it('resolves by set name when the code is unreadable', () => {
    expect(resolveBulbapediaEras(map, { setCode: 'ROS', setName: 'Dark Rush' })).toEqual(['bw']);
  });

  it('unions the eras of the code and the name', () => {
    expect(resolveBulbapediaEras(map, { setCode: 'BW4', setName: 'XY7' }).sort()).toEqual(['bw', 'xy']);
  });

  it('returns null when nothing matches, so the loader loads every era', () => {
    expect(resolveBulbapediaEras(map, { setCode: 'ZZZ', setName: 'Nowhere' })).toBeNull();
    expect(resolveBulbapediaEras(map, {})).toBeNull();
    expect(resolveBulbapediaEras(null, { setCode: 'BW4' })).toBeNull();
    expect(resolveBulbapediaEras(map, null)).toBeNull();
  });
});

describe('runBulbapediaReport', () => {
  it('reports a validated hit when the existing pipeline missed', async () => {
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        return { success: true, data: { id: 'bw5-63', name: 'Darkrai-EX', hp: 180 } };
      }
      return { success: false, error: 'unexpected message' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
        language: 'ja',
        setCode: 'BW4',
        cardNumber: '044/069',
        setName: 'Dark Rush',
      }),
      existingCard: null,
    });
    expect(report.status).toBe('hit');
    expect(report.target.id).toBe('bw5-63');
    expect(report.validation).toEqual({ valid: true, reasons: [] });
    expect(report.validatedCard).toEqual({ id: 'bw5-63', name: 'Darkrai-EX', hp: 180 });
    expect(report.comparison).toBe('resolver-only');
  });

  it('flags validation failures without changing the report outcome', async () => {
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        return { success: true, data: { id: 'bw5-64', name: 'Entei-EX', hp: 180 } };
      }
      return { success: false, error: 'unexpected message' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
        language: 'ja',
        setCode: 'BW4',
        cardNumber: '044/069',
        setName: 'Dark Rush',
      }),
      existingCard: { id: 'bw5-63' },
    });
    expect(report.status).toBe('hit');
    expect(report.validation.valid).toBe(false);
    expect(report.validatedCard).toBeUndefined();
    expect(report.comparison).toBe('agrees');
  });

  it('reports ambiguity without a validation fetch', async () => {
    let fetchCount = 0;
    setMessageHandler(() => {
      fetchCount += 1;
      return { success: false, error: 'should not be called' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
        language: 'ja',
        setCode: 'BW1',
        cardNumber: '001/053',
        setName: null,
      }),
      existingCard: null,
    });
    expect(report.status).toBe('ambiguous');
    expect(report.candidates.length).toBeGreaterThan(1);
    expect(report.comparison).toBe('unresolved-ambiguous');
    expect(fetchCount).toBe(0);
  });

  it('labels a set-only target with its set name and skips the validation fetch', async () => {
    let fetchCount = 0;
    setMessageHandler(() => {
      fetchCount += 1;
      return { success: false, error: 'should not be called' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(BULBAPEDIA_DP_INDEX.enToJa, {
        language: 'en',
        setCode: 'DP4',
        cardNumber: '3/106',
        setName: 'Great Encounters',
        cardName: 'Darkrai',
      }),
      existingCard: null,
    });
    expect(report.status).toBe('hit');
    expect(report.target.id).toBe('Moonlit Pursuit');
    expect(report.target.cardNumber).toBeNull();
    expect(report.validatedCard).toBeUndefined();
    expect(fetchCount).toBe(0);
  });

  it('reports a miss without a validation fetch', async () => {
    let fetchCount = 0;
    setMessageHandler(() => {
      fetchCount += 1;
      return { success: false, error: 'should not be called' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
        language: 'ja',
        setCode: 'SV8',
        cardNumber: '001/187',
        setName: null,
      }),
      existingCard: { id: 'sv08-1' },
    });
    expect(report.status).toBe('miss');
    expect(report.comparison).toBe('existing-only');
    expect(fetchCount).toBe(0);
  });

  it('returns null when no resolution was computed (skipCrossVersion path)', async () => {
    let fetchCount = 0;
    setMessageHandler(() => {
      fetchCount += 1;
      return { success: false, error: 'should not be called' };
    });
    const report = await runBulbapediaReport({ resolution: null, existingCard: null });
    expect(report).toBeNull();
    expect(fetchCount).toBe(0);
  });

  it('never queries CardRush for EN cards, even with a known JP counterpart', () => {
    expect(shouldQueryCardrush(true, 'bw5')).toBe(false);
    expect(shouldQueryCardrush(true, 'ROS')).toBe(false);
    expect(shouldQueryCardrush(false, 'BW4')).toBe(true);
    expect(shouldQueryCardrush(false, '')).toBe(false);
    expect(shouldQueryCardrush(false, null)).toBe(false);
  });

  it('treats a number with a total as non-promo even when Gemini flags promo', () => {
    expect(isPromoCardNumber('60/108', true)).toBe(false);
    expect(isPromoCardNumber('BW93', true)).toBe(true);
    expect(isPromoCardNumber('BW93', false)).toBe(true);
    expect(isPromoCardNumber(null, true)).toBe(true);
    expect(isPromoCardNumber(null, false)).toBe(false);
  });

  it('lets the index override a conflicting pipeline counterpart', () => {
    const indexed = { id: 'bw5-107', name: 'Darkrai-EX' };
    const selection = selectCrossVersionCard(indexed, { id: 'SM4A-003', name: 'Darkrai' });
    expect(selection.card).toBe(indexed);
    expect(selection.overrode).toBe(true);
  });

  it('keeps the pipeline counterpart when it agrees with the index', () => {
    const indexed = { id: 'bw5-107', name: 'Darkrai-EX' };
    const selection = selectCrossVersionCard(indexed, { id: 'bw5-107', name: 'Darkrai-EX' });
    expect(selection.card).toBe(indexed);
    expect(selection.overrode).toBe(false);
  });

  it('falls back to the pipeline counterpart when the index has no validated card', () => {
    const pipeline = { id: 'sv08.5-156', name: 'Sylveon ex' };
    const selection = selectCrossVersionCard(undefined, pipeline);
    expect(selection.card).toBe(pipeline);
    expect(selection.overrode).toBe(false);
    expect(selectCrossVersionCard(undefined, null).card).toBeNull();
  });

  it('exposes the indexed EN set correction for a hit', () => {
    const correction = getIndexedSourceCorrection({
      status: 'hit',
      record: { source: { tcgdexSetId: 'bw5', localId: '60', setName: 'Dark Explorers' } },
    }, 'en');
    expect(correction).toEqual({ setCode: 'bw5', localId: '60', setName: 'Dark Explorers' });
  });

  it('does not expose a correction for JA scans, misses or JA sources', () => {
    const hit = { status: 'hit', record: { source: { tcgdexSetId: 'bw5', localId: '60' } } };
    expect(getIndexedSourceCorrection(hit, 'ja')).toBeNull();
    expect(getIndexedSourceCorrection({ status: 'miss' }, 'en')).toBeNull();
    expect(getIndexedSourceCorrection({ status: 'hit', record: { source: { tcgdexSetId: null, localId: '60' } } }, 'en')).toBeNull();
    expect(getIndexedSourceCorrection(null, 'en')).toBeNull();
  });

  it('builds a TCGdex-shaped JP version from a Bulbapedia JA target', () => {
    const jpVersion = buildBulbapediaJpVersion({
      setCode: 'BW4',
      setName: 'Dark Rush',
      localId: '072',
      cardNumber: '072/069',
      japaneseName: 'ダークライEX',
      cardName: 'Darkrai',
      rarity: 'SR',
    });
    expect(jpVersion.id).toBe('BW4-072');
    expect(jpVersion.name).toBe('ダークライEX');
    expect(jpVersion.englishName).toBe('Darkrai');
    expect(jpVersion.localId).toBe('072');
    expect(jpVersion.set).toEqual({ id: 'BW4', name: 'Dark Rush', cardCount: { official: 69 } });
    expect(jpVersion.image).toBeNull();
    expect(jpVersion.rarity).toBe('SR');
  });

  it('omits the set card count when the target number has no total', () => {
    const jpVersion = buildBulbapediaJpVersion({
      setCode: 'BW4',
      setName: 'Dark Rush',
      localId: '072',
      cardNumber: '072',
      cardName: 'Darkrai',
      rarity: null,
    });
    expect(jpVersion.set.cardCount).toBeUndefined();
    expect(jpVersion.name).toBe('Darkrai');
  });

  it('skips the TCGdex fetch for JA targets that have no tcgdexSetId', async () => {
    let fetchCount = 0;
    setMessageHandler(() => {
      fetchCount += 1;
      return { success: false, error: 'should not be called' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(EN_TO_JA_RECORDS, {
        language: 'en',
        setCode: 'DEX',
        cardNumber: '107/108',
        setName: 'Dark Explorers',
      }),
      existingCard: null,
    });
    expect(report.status).toBe('hit');
    expect(report.target.id).toBe('BW4-072');
    expect(report.validation).toBeUndefined();
    expect(report.validatedCard).toBeUndefined();
    expect(report.comparison).toBe('resolver-only');
    expect(fetchCount).toBe(0);
  });

  it('does not expose validatedCard when the TCGdex fetch fails', async () => {
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        return { success: false, error: 'network down' };
      }
      return { success: false, error: 'unexpected message' };
    });
    const report = await runBulbapediaReport({
      resolution: resolveBulbapediaCounterparts(BULBAPEDIA_BW_INDEX.records, {
        language: 'ja',
        setCode: 'BW4',
        cardNumber: '044/069',
        setName: 'Dark Rush',
      }),
      existingCard: null,
    });
    expect(report.status).toBe('hit');
    expect(report.validation.valid).toBe(false);
    expect(report.validatedCard).toBeUndefined();
  });
});

describe('validateBulbapediaTarget — JA targets', () => {
  it('accepts a JA card matched by its Japanese name', () => {
    const target = {
      language: 'ja',
      tcgdexSetId: 'S11',
      localId: '125',
      cardName: 'Giratina VSTAR',
      japaneseName: 'ギラティナVSTAR',
      hp: null,
    };
    const jaCard = { id: 'S11-125', name: 'ギラティナVSTAR', hp: 280 };
    expect(validateBulbapediaTarget(target, jaCard)).toEqual({ valid: true, reasons: [] });
  });

  it('rejects a JA card with a different Japanese name', () => {
    const target = { language: 'ja', tcgdexSetId: 'S11', localId: '125', cardName: 'Giratina VSTAR', japaneseName: 'ギラティナVSTAR' };
    const jaCard = { id: 'S11-125', name: 'ディアルガVSTAR' };
    expect(validateBulbapediaTarget(target, jaCard).valid).toBe(false);
  });
});
