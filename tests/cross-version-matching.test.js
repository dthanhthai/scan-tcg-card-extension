import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';
import { resetChromeStorage } from './chrome-mock.js';

// Load constants.js + tcgdex-client.js into global scope
loadExtensionScripts('lib/tcgdex-client.js');

// Helper to create a mock fetch Response
function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

// Helper to set up fetch mock with URL-based routing
function setupFetchMock(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return typeof response === 'function' ? response(url) : mockResponse(response);
      }
    }
    return mockResponse(null, 404);
  });
}

beforeEach(() => {
  resetChromeStorage();
  vi.restoreAllMocks();
});

describe('findCrossVersionCard — main search path (rarity filter)', () => {
  it('narrows candidates by rarity when multiple dexId matches exist', async () => {
    // Simulate: JP SV8a-212 Sylveon ex SAR → EN search "Sylveon ex" → 2 candidates
    //   sv08.5-041 (Double rare → RR) should be excluded
    //   sv08.5-156 (Special illustration rare → SAR) should be matched
    const searchResults = [
      { id: 'sv08.5-041', localId: '041', name: 'Sylveon ex' },
      { id: 'sv08.5-156', localId: '156', name: 'Sylveon ex' },
    ];

    const fullCards = {
      'sv08.5-041': {
        id: 'sv08.5-041', localId: '041', name: 'Sylveon ex',
        dexId: [700], hp: 270, rarity: 'Double rare',
      },
      'sv08.5-156': {
        id: 'sv08.5-156', localId: '156', name: 'Sylveon ex',
        dexId: [700], hp: 270, rarity: 'Special illustration rare',
      },
    };

    setupFetchMock({
      'cards?name=': searchResults,
      'cards/sv08.5-041': fullCards['sv08.5-041'],
      'cards/sv08.5-156': fullCards['sv08.5-156'],
    });

    const result = await findCrossVersionCard(
      'en', 'Sylveon ex', [700], '212', 'findEnVersion',
      'SV8a', null, null, 270, 'SAR',
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBe('sv08.5-156');
    expect(result.data.rarity).toBe('Special illustration rare');
  });

  it('normalizes SIR → SAR when filtering by rarity', async () => {
    // Gemini returns "SIR" for EN card, but TCGdex JP uses "Character Super Rare" → SAR
    const searchResults = [
      { id: 'SV3-087', localId: '087', name: 'ポッポ' },
      { id: 'SV3-118', localId: '118', name: 'ポッポ' },
    ];

    const fullCards = {
      'SV3-087': {
        id: 'SV3-087', localId: '087', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: 'Common',
      },
      'SV3-118': {
        id: 'SV3-118', localId: '118', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: null, // no rarity in TCGdex
      },
    };

    setupFetchMock({
      'cards?name=': searchResults,
      'cards/SV3-087': fullCards['SV3-087'],
      'cards/SV3-118': fullCards['SV3-118'],
    });

    const result = await findCrossVersionCard(
      'ja', 'ポッポ', [16], '207', 'findJpVersion',
      'sv03', 'SV3', null, 60, 'SIR',
    );

    expect(result.success).toBe(true);
    // SV3-087 (Common → C) should be excluded by rarity filter (SIR→SAR ≠ C)
    // SV3-118 (no rarity → kept) should be matched
    expect(result.data.id).toBe('SV3-118');
  });
});

describe('findCrossVersionCard — set scan fallback (rarity filter)', () => {
  it('applies rarity filter in set scan fallback when name search returns 0 results', async () => {
    // Simulate: Gemini returns wrong JP name → search returns 0 results
    // Set scan fallback fetches all cards in SV3, filters by dexId + HP + rarity
    const setCards = {
      cards: [
        { id: 'SV3-087' },
        { id: 'SV3-118' },
        { id: 'SV3-001' },
      ],
    };

    const fullCards = {
      'SV3-087': {
        id: 'SV3-087', localId: '087', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: 'Common',
      },
      'SV3-118': {
        id: 'SV3-118', localId: '118', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: null,
      },
      'SV3-001': {
        id: 'SV3-001', localId: '001', name: '別のカード',
        dexId: [999], hp: 100, rarity: 'Rare',
      },
    };

    setupFetchMock({
      'cards?name=': [], // 0 search results (wrong name)
      'sets/SV3': setCards,
      'cards/SV3-087': fullCards['SV3-087'],
      'cards/SV3-118': fullCards['SV3-118'],
      'cards/SV3-001': fullCards['SV3-001'],
    });

    const result = await findCrossVersionCard(
      'ja', 'ポッピー', [16], '207', 'findJpVersion',
      'sv03', 'SV3', null, 60, 'AR',
    );

    expect(result.success).toBe(true);
    // SV3-087 (Common → C) should be excluded by rarity filter (AR ≠ C)
    // SV3-118 (no rarity → kept) should be matched
    expect(result.data.id).toBe('SV3-118');
  });

  it('returns failure when no set scan candidates match HP', async () => {
    const setCards = {
      cards: [{ id: 'SV3-087' }],
    };

    const fullCards = {
      'SV3-087': {
        id: 'SV3-087', localId: '087', name: 'ポッポ',
        dexId: [16], hp: 50, rarity: 'Common', // HP 50 ≠ source HP 60
      },
    };

    setupFetchMock({
      'cards?name=': [],
      'sets/SV3': setCards,
      'cards/SV3-087': fullCards['SV3-087'],
    });

    const result = await findCrossVersionCard(
      'ja', 'ポッピー', [16], '207', 'findJpVersion',
      'sv03', 'SV3', null, 60, 'AR',
    );

    // Should fail — HP mismatch means the card is not the right variant
    expect(result.success).toBe(false);
  });
});

describe('findCrossVersionCard — dexId search fallback (rarity filter)', () => {
  it('applies rarity filter in dexId search fallback', async () => {
    // When both name search and set scan fail, falls back to dexId search
    const dexSearchResults = [
      { id: 'SV3-087' },
      { id: 'SV3-118' },
    ];

    const fullCards = {
      'SV3-087': {
        id: 'SV3-087', localId: '087', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: 'Common',
      },
      'SV3-118': {
        id: 'SV3-118', localId: '118', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: null,
      },
    };

    setupFetchMock({
      'cards?name=': [], // name search fails
      'sets/': { cards: [] }, // set scan fails (empty)
      'cards?dexId=': dexSearchResults,
      'cards/SV3-087': fullCards['SV3-087'],
      'cards/SV3-118': fullCards['SV3-118'],
    });

    const result = await findCrossVersionCard(
      'ja', 'ポッピー', [16], '207', 'findJpVersion',
      'sv03', 'SV3', null, 60, 'AR',
    );

    expect(result.success).toBe(true);
    // Rarity filter should exclude SV3-087 (Common → C ≠ AR)
    // SV3-118 (no rarity → kept) should be matched
    expect(result.data.id).toBe('SV3-118');
  });
});

describe('findCrossVersionCard — edge cases', () => {
  it('returns failure when no name and no dexId provided', async () => {
    const result = await findCrossVersionCard(
      'en', null, [], null, 'findEnVersion',
      null, null, null, null, null,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No name or dexId');
  });

  it('keeps candidates with no rarity (cannot verify, do not exclude)', async () => {
    // Both candidates have no rarity — rarity filter should not narrow
    const searchResults = [
      { id: 'SV3-087', localId: '087', name: 'ポッポ' },
      { id: 'SV3-118', localId: '118', name: 'ポッポ' },
    ];

    const fullCards = {
      'SV3-087': {
        id: 'SV3-087', localId: '087', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: null,
      },
      'SV3-118': {
        id: 'SV3-118', localId: '118', name: 'ポッポ',
        dexId: [16], hp: 60, rarity: null,
      },
    };

    setupFetchMock({
      'cards?name=': searchResults,
      'cards/SV3-087': fullCards['SV3-087'],
      'cards/SV3-118': fullCards['SV3-118'],
    });

    const result = await findCrossVersionCard(
      'ja', 'ポッポ', [16], '207', 'findJpVersion',
      'sv03', 'SV3', null, 60, 'AR',
    );

    expect(result.success).toBe(true);
    // Both have no rarity → both kept → first one returned
    // (rarity filter does not narrow when all candidates have no rarity)
    expect(result.data.id).toBe('SV3-087');
  });
});

describe('isCardNameMatch', () => {
  it('matches hyphenated TCGdex name against space-separated Gemini name', () => {
    expect(isCardNameMatch('Darkrai-EX', 'Darkrai EX')).toBe(true);
  });

  it('keeps card-type suffixes so different variants do not merge', () => {
    expect(isCardNameMatch('Darkrai-GX', 'Darkrai EX')).toBe(false);
  });

  it('rejects when Gemini omits the suffix', () => {
    expect(isCardNameMatch('Darkrai-EX', 'Darkrai')).toBe(false);
  });

  it('ignores punctuation differences', () => {
    expect(isCardNameMatch('Mr. Mime', 'Mr Mime')).toBe(true);
    expect(isCardNameMatch("Farfetch'd", 'Farfetchd')).toBe(true);
  });

  it('accepts any card when no name hint is provided and rejects empty found name', () => {
    expect(isCardNameMatch('Darkrai-EX', null)).toBe(true);
    expect(isCardNameMatch(null, 'Darkrai EX')).toBe(false);
  });

  it('rejects genuinely different names', () => {
    expect(isCardNameMatch('Zoroark', 'Darkrai EX')).toBe(false);
  });

  it('drops the level a DP-era card prints next to its name', () => {
    expect(isCardNameMatch('Darkrai', 'Darkrai LV.38')).toBe(true);
    expect(isCardNameMatch('Darkrai LV.40', 'Darkrai')).toBe(true);
    expect(isCardNameMatch('ダークライ', 'ダークライ LV.38')).toBe(true);
  });

  it('still keeps LV.X apart from the base name', () => {
    expect(isCardNameMatch('Darkrai LV.X', 'Darkrai')).toBe(false);
  });
});

describe('fetchCardById — name+localId fallback', () => {
  it('finds the card when the printed set code is misread', async () => {
    const searchResults = [
      { id: 'bw5-60', localId: '60', name: 'Umbreon' },
      { id: 'bw5-61', localId: '61', name: 'Umbreon' },
      { id: 'sm8-120', localId: '120', name: 'Umbreon' },
    ];
    const fullCard = { id: 'bw5-60', localId: '60', name: 'Umbreon', hp: 90, set: { id: 'bw5', name: 'Dark Explorers' } };
    setupFetchMock({
      'cards?name=Umbreon': searchResults,
      'cards/bw5-60': fullCard,
    });
    const result = await fetchCardById('en', 'HS', '060', 'HeartGold & SoulSilver', 'Umbreon');
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('bw5-60');
  });

  it('stays a miss when several cards share the name and number', async () => {
    setupFetchMock({
      'cards?name=Umbreon': [
        { id: 'bw5-60', localId: '60', name: 'Umbreon' },
        { id: 'other-60', localId: '60', name: 'Umbreon' },
      ],
    });
    const result = await fetchCardById('en', 'ZZZ', '60', null, 'Umbreon');
    expect(result.success).toBe(false);
  });

  it('does not run the name search when no card name is available', async () => {
    setupFetchMock({});
    const result = await fetchCardById('en', 'ZZZ', '60', null, null);
    expect(result.success).toBe(false);
    const searchCalls = globalThis.fetch.mock.calls.filter(([url]) => url.includes('cards?name='));
    expect(searchCalls).toHaveLength(0);
  });
});

describe('classifyCardCandidate', () => {
  const generations = { id: 'g1-2', name: 'M Venusaur EX', set: { id: 'g1', cardCount: { official: 83 } } };
  const xyBase = { id: 'xy1-2', name: 'M Venusaur EX', set: { id: 'xy1', cardCount: { official: 146 } } };

  it('accepts a candidate whose set total matches the printed total', () => {
    expect(classifyCardCandidate(generations, 'M Venusaur EX', 83)).toBe('hard');
  });

  it('keeps a name match with a different set total as a soft fallback', () => {
    expect(classifyCardCandidate(xyBase, 'M Venusaur EX', 83)).toBe('soft');
  });

  it('rejects a different card name', () => {
    expect(classifyCardCandidate(xyBase, 'Venusaur', 146)).toBe('reject');
  });

  it('accepts when the printed total or the set count is unknown', () => {
    expect(classifyCardCandidate(xyBase, 'M Venusaur EX', null)).toBe('hard');
    expect(classifyCardCandidate({ id: 'x', name: 'M Venusaur EX' }, 'M Venusaur EX', 83)).toBe('hard');
  });
});

describe('fetchCardById — printed total disambiguation', () => {
  it('prefers the set whose official count matches the printed total', async () => {
    const searchResults = [
      { id: 'g1-2', localId: '2', name: 'M Venusaur EX' },
      { id: 'xy1-2', localId: '2', name: 'M Venusaur EX' },
      { id: 'xy12-2', localId: '2', name: 'M Venusaur EX' },
    ];
    setupFetchMock({
      'cards?name=': searchResults,
      'en/sets': [
        { id: 'xy1', name: 'XY' },
        { id: 'xy12', name: 'Evolutions' },
        { id: 'g1', name: 'Generations' },
      ],
      'cards/xy1-2': { id: 'xy1-2', localId: '2', name: 'M Venusaur EX', set: { id: 'xy1', name: 'XY', cardCount: { official: 146 } } },
      'cards/xy12-2': { id: 'xy12-2', localId: '2', name: 'M Venusaur EX', set: { id: 'xy12', name: 'Evolutions', cardCount: { official: 108 } } },
      'cards/g1-2': { id: 'g1-2', localId: '2', name: 'M Venusaur EX', set: { id: 'g1', name: 'Generations', cardCount: { official: 83 } } },
    });
    const result = await fetchCardById('en', 'XY', '2', 'XY Evolutions', 'M Venusaur EX', 83);
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('g1-2');
  });

  it('still returns a name match when no set total matches', async () => {
    setupFetchMock({
      'cards?name=': [{ id: 'xy1-2', localId: '2', name: 'M Venusaur EX' }],
      'en/sets': [{ id: 'xy1', name: 'XY' }],
      'cards/xy1-2': { id: 'xy1-2', localId: '2', name: 'M Venusaur EX', set: { id: 'xy1', name: 'XY', cardCount: { official: 146 } } },
    });
    const result = await fetchCardById('en', 'XY', '2', null, 'M Venusaur EX', 83);
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('xy1-2');
  });
});

describe('fetchCardById — exact set id codes', () => {
  it('does not fuzzy-map a printed code that is already a set id', async () => {
    setupFetchMock({
      'en/sets': [
        { id: 'me05', name: 'Pitch Black' },
        { id: 'tk-bw-e', name: 'BW Trainer Kit' },
      ],
      'cards/me05-120': { id: 'me05-120', localId: '120', name: 'Mega Darkrai ex', set: { id: 'me05', name: 'Pitch Black', cardCount: { official: 84 } } },
    });
    const result = await fetchCardById('en', 'me05', '120', null, 'Mega Darkrai ex');
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('me05-120');
    const attempts = globalThis.fetch.mock.calls.map(([url]) => url);
    expect(attempts.some((url) => url.includes('tk-bw-e'))).toBe(false);
  });
});

describe('matchSetByAbbreviation — cross-language set codes', () => {
  it('skips abbreviation matching when the code is a set id of the other language', async () => {
    setupFetchMock({
      'en/sets': [{ id: 'swsh11', name: 'Lost Origin' }, { id: 'si1', name: 'Southern Islands' }],
      'ja/sets': [{ id: 'S12', name: 'Paradigm Trigger' }],
    });
    const matched = await matchSetByAbbreviation('en', 'S12');
    expect(matched).toBeNull();
  });
});

describe('fetchCardById — sets with no cards', () => {
  it('skips lookups for a set already known to have no cards', async () => {
    await chrome.storage.local.set({ emptySetCache: { 'ja:S2': true } });
    setupFetchMock({ 'ja/sets': [{ id: 'S2', name: 'Rebellion Crash' }] });
    const result = await fetchCardById('ja', 'S2', '099', null, 'Milotic V');
    expect(result.success).toBe(false);
    const cardRequests = globalThis.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/cards/'));
    expect(cardRequests).toHaveLength(0);
  });
});
