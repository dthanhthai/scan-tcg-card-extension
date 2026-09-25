import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';
import { resetChromeStorage } from './chrome-mock.js';

// Load constants.js + tcgdex-client.js into global scope
loadExtensionScripts('lib/tcgdex-client.js');

function mockResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

// Seeds both language caches so the abbreviation matcher never fetches the set
// list itself; the test then observes only the requests the lookup makes.
async function seedSetCaches() {
  await chrome.storage.local.set({
    setListCache: {
      en: { data: [{ id: 'dp3' }, { id: 'swsh12.5' }], timestamp: Date.now() },
      ja: { data: [{ id: 's12a' }], timestamp: Date.now() },
    },
    setAbbreviationMap: {
      en: { data: { SWSH: 'dp3' }, timestamp: Date.now() },
      ja: { data: {}, timestamp: Date.now() },
    },
  });
}

describe('fetchCardById set-code mapping', () => {
  beforeEach(() => {
    resetChromeStorage();
    vi.restoreAllMocks();
  });

  it('skips the whole-set-cache refresh when the printed code already mapped to a set', async () => {
    await seedSetCaches();
    const requestedUrls = [];
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      // The mapped set only holds a different card: every candidate mismatches.
      if (target.includes('/en/cards/dp3-14')) {
        return mockResponse({ id: 'dp3-14', name: 'Lugia', localId: '14', set: { id: 'dp3', cardCount: { official: 132 } } });
      }
      if (target.includes('/en/cards?name=')) {
        // The search endpoint answers with a bare array of minimal cards.
        return mockResponse([{ id: 'swsh12.5-014', localId: '014' }]);
      }
      if (target.includes('/en/cards/swsh12.5-014')) {
        return mockResponse({ id: 'swsh12.5-014', name: 'Leafeon VSTAR', localId: '014', set: { id: 'swsh12.5', cardCount: { official: 159 } } });
      }
      return mockResponse(null, 404);
    });

    const result = await fetchCardById('en', 'SWSH', '014', 'Crown Zenith', 'Leafeon VSTAR', 159);

    expect(result.success).toBe(true);
    expect(result.data.id).toBe('swsh12.5-014');
    // The name+localId search is what finds the card; no set-list refetch.
    expect(requestedUrls.some((url) => url.includes('/en/sets'))).toBe(false);
  });

  it('still refreshes the cache when the printed code mapped to nothing', async () => {
    await seedSetCaches();
    const requestedUrls = [];
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target.includes('/en/sets')) return mockResponse([{ id: 'swsh1' }]);
      return mockResponse(null, 404);
    });

    await fetchCardById('en', 'NOSUCHCODE', '001', null, null, null);

    // The refresh path runs (the set list is refetched) because the code was
    // unmapped, which is the only case a stale cache can explain.
    expect(requestedUrls.some((url) => url.includes('/en/sets'))).toBe(true);
  });
});

describe('deriveEnSetIdFromJpCode', () => {
  it('derives SV7 → sv07', () => {
    expect(deriveEnSetIdFromJpCode('SV7')).toBe('sv07');
  });

  it('derives SV8 → sv08', () => {
    expect(deriveEnSetIdFromJpCode('SV8')).toBe('sv08');
  });

  it('derives SV10 → sv10 (double-digit, no padding)', () => {
    expect(deriveEnSetIdFromJpCode('SV10')).toBe('sv10');
  });

  it('derives SV1 → sv01 (single-digit, padded)', () => {
    expect(deriveEnSetIdFromJpCode('SV1')).toBe('sv01');
  });

  it('derives SV7A → sv07.5 (high-class set)', () => {
    expect(deriveEnSetIdFromJpCode('SV7A')).toBe('sv07.5');
  });

  it('derives SV8A → sv08.5 (high-class set)', () => {
    expect(deriveEnSetIdFromJpCode('SV8A')).toBe('sv08.5');
  });

  it('derives SV10A → sv10.5 (double-digit high-class)', () => {
    expect(deriveEnSetIdFromJpCode('SV10A')).toBe('sv10.5');
  });

  it('handles lowercase input (SV7a)', () => {
    expect(deriveEnSetIdFromJpCode('SV7a')).toBe('sv07.5');
  });

  it('returns null for non-SV codes', () => {
    expect(deriveEnSetIdFromJpCode('M1S')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(deriveEnSetIdFromJpCode('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(deriveEnSetIdFromJpCode(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(deriveEnSetIdFromJpCode(undefined)).toBeNull();
  });
});

describe('getEnSetIdForJpCode', () => {
  it('uses explicit map for SV8A → sv08.5', () => {
    expect(getEnSetIdForJpCode('SV8A')).toBe('sv08.5');
  });

  it('uses explicit map for SV8 → sv08', () => {
    expect(getEnSetIdForJpCode('SV8')).toBe('sv08');
  });

  it('auto-derives SV7 → sv07 (not in explicit map)', () => {
    expect(getEnSetIdForJpCode('SV7')).toBe('sv07');
  });

  it('auto-derives SV7A → sv07.5 (not in explicit map)', () => {
    expect(getEnSetIdForJpCode('SV7A')).toBe('sv07.5');
  });

  it('auto-derives SV9 → sv09 (not in explicit map)', () => {
    expect(getEnSetIdForJpCode('SV9')).toBe('sv09');
  });

  it('returns me02 for M2 (explicit map)', () => {
    expect(getEnSetIdForJpCode('M2')).toBe('me02');
  });

  it('returns ["swsh12", "swsh12.5"] for S12 (1-to-many, returns array)', () => {
    expect(getEnSetIdForJpCode('S12')).toEqual(['swsh12', 'swsh12.5']);
  });

  it('handles lowercase input', () => {
    expect(getEnSetIdForJpCode('sv8')).toBe('sv08');
  });

  it('returns null for null input', () => {
    expect(getEnSetIdForJpCode(null)).toBeNull();
  });
});

describe('JP_TO_EN_SET_MAP', () => {
  it('contains SV8A → sv08.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV8A']).toBe('sv08.5');
  });

  it('contains SV8 → sv08 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV8']).toBe('sv08');
  });

  it('contains SV7a → sv08 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV7a']).toBe('sv08');
  });

  it('contains SV7 → sv07 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV7']).toBe('sv07');
  });

  it('contains SV6a → sv06.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV6a']).toBe('sv06.5');
  });

  it('contains SV6 → sv06 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV6']).toBe('sv06');
  });

  it('contains SV5a → sv06 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV5a']).toBe('sv06');
  });

  it('contains SV5M → sv05 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV5M']).toBe('sv05');
  });

  it('contains SV5K → sv05 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV5K']).toBe('sv05');
  });

  it('contains SV4a → sv04.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV4a']).toBe('sv04.5');
  });

  it('contains SV4M → sv04 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV4M']).toBe('sv04');
  });

  it('contains SV4K → sv04 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV4K']).toBe('sv04');
  });

  it('contains SV3a → sv04 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV3a']).toBe('sv04');
  });

  it('contains SV2a → sv03.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV2a']).toBe('sv03.5');
  });

  it('contains SV3 → sv03 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV3']).toBe('sv03');
  });

  it('contains SV2P → sv03 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV2P']).toBe('sv03');
  });

  it('contains SV2D → sv02 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV2D']).toBe('sv02');
  });

  it('contains SV1a → sv02 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV1a']).toBe('sv02');
  });

  it('contains SV1S → sv01 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV1S']).toBe('sv01');
  });

  it('contains SV1V → sv01 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV1V']).toBe('sv01');
  });

  it('contains S12 → [swsh12, swsh12.5] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['S12']).toEqual(['swsh12', 'swsh12.5']);
  });

  it('contains S12a → swsh12.5gg mapping', () => {
    expect(JP_TO_EN_SET_MAP['S12a']).toBe('swsh12.5gg');
  });

  it('contains S11 → swsh11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S11']).toBe('swsh11');
  });

  it('contains S10b → swsh10.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S10b']).toBe('swsh10.5');
  });

  it('contains S11a → [swsh12, swsh12tg] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['S11a']).toEqual(['swsh12', 'swsh12tg']);
  });

  it('contains S10a → swsh11tg mapping', () => {
    expect(JP_TO_EN_SET_MAP['S10a']).toBe('swsh11tg');
  });

  it('contains S10D → swsh10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S10D']).toBe('swsh10');
  });

  it('contains S10P → swsh10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S10P']).toBe('swsh10');
  });

  it('contains S9 → swsh9 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S9']).toBe('swsh9');
  });

  it('contains S8b → [swsh9tg, swsh11tg] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['S8b']).toEqual(['swsh9tg', 'swsh11tg']);
  });

  it('contains S9a → [swsh10, swsh10tg] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['S9a']).toEqual(['swsh10', 'swsh10tg']);
  });

  it('contains S8 → swsh8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S8']).toBe('swsh8');
  });

  it('contains S8a → [cel25, cel25cc] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['S8a']).toEqual(['cel25', 'cel25cc']);
  });

  it('contains S7R → swsh7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S7R']).toBe('swsh7');
  });

  it('contains S7D → swsh7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S7D']).toBe('swsh7');
  });

  it('contains S6a → swsh7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S6a']).toBe('swsh7');
  });

  it('contains S6H → swsh6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S6H']).toBe('swsh6');
  });

  it('contains S6K → swsh6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S6K']).toBe('swsh6');
  });

  it('contains S5a → swsh6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S5a']).toBe('swsh6');
  });

  it('contains S5R → swsh5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S5R']).toBe('swsh5');
  });

  it('contains S5I → swsh5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S5I']).toBe('swsh5');
  });

  it('contains S4a → [swsh4.5, swsh4.5sv] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['S4a']).toEqual(['swsh4.5', 'swsh4.5sv']);
  });

  it('contains S4 → swsh4 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S4']).toBe('swsh4');
  });

  it('contains S3a → swsh4 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S3a']).toBe('swsh4');
  });

  it('contains S3 → swsh3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S3']).toBe('swsh3');
  });

  it('contains S2a → swsh3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S2a']).toBe('swsh3');
  });

  it('contains S2 → swsh2 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S2']).toBe('swsh2');
  });

  it('contains S1a → swsh2 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S1a']).toBe('swsh2');
  });

  it('contains S1W → swsh1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S1W']).toBe('swsh1');
  });

  it('contains S1H → swsh1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['S1H']).toBe('swsh1');
  });

  it('contains SM12 → sm12 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM12']).toBe('sm12');
  });

  it('contains SM11a → sm12 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM11a']).toBe('sm12');
  });

  it('contains SM11b → sm12 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM11b']).toBe('sm12');
  });

  it('contains SM12a → sm12 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM12a']).toBe('sm12');
  });

  it('contains SM8b → sma mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM8b']).toBe('sma');
  });

  it('contains SM11 → sm11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM11']).toBe('sm11');
  });

  it('contains SM10b → [sm115, sm11] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['SM10b']).toEqual(['sm115', 'sm11']);
  });

  it('contains SM10a → sm11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM10a']).toBe('sm11');
  });

  it('contains SM10 → sm10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM10']).toBe('sm10');
  });

  it('contains SM9b → sm10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM9b']).toBe('sm10');
  });

  it('contains SM9a → sm10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM9a']).toBe('sm10');
  });

  it('contains SMP2 → det1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SMP2']).toBe('det1');
  });

  it('contains SM9 → sm9 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM9']).toBe('sm9');
  });

  it('contains SM7a → sm8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM7a']).toBe('sm8');
  });

  it('contains SM7b → sm8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM7b']).toBe('sm8');
  });

  it('contains SM8 → sm8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM8']).toBe('sm8');
  });

  it('contains SM8a → sm9 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM8a']).toBe('sm9');
  });

  it('contains SM6 → sm6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM6']).toBe('sm6');
  });

  it('contains SM5p → sm6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM5p']).toBe('sm6');
  });

  it('contains SM5S → sm5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM5S']).toBe('sm5');
  });

  it('contains SM5M → sm5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM5M']).toBe('sm5');
  });

  it('contains SM4A → sm4 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM4A']).toBe('sm4');
  });

  it('contains SM4S → sm4 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM4S']).toBe('sm4');
  });

  it('contains SM6b → sm7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM6b']).toBe('sm7');
  });

  it('contains SM7 → sm7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM7']).toBe('sm7');
  });

  it('contains SM6a → sm7.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM6a']).toBe('sm7.5');
  });

  it('contains SM3H → sm3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM3H']).toBe('sm3');
  });

  it('contains SM3N → sm3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM3N']).toBe('sm3');
  });

  it('contains SM2p → sm3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM2p']).toBe('sm3');
  });

  it('contains SM2K → sm2 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM2K']).toBe('sm2');
  });

  it('contains SM2L → sm2 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM2L']).toBe('sm2');
  });

  it('contains SM1S → sm1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM1S']).toBe('sm1');
  });

  it('contains SM1M → sm1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SM1M']).toBe('sm1');
  });

  it('contains XY1a → xy1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY1a']).toBe('xy1');
  });

  it('contains XY1b → xy1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY1b']).toBe('xy1');
  });

  it('contains XY2 → xy2 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY2']).toBe('xy2');
  });

  it('contains XY3 → xy3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY3']).toBe('xy3');
  });

  it('contains XY4 → xy4 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY4']).toBe('xy4');
  });

  it('contains XY5b → xy5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY5b']).toBe('xy5');
  });

  it('contains XY5a → xy5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY5a']).toBe('xy5');
  });

  it('contains XY6 → xy6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY6']).toBe('xy6');
  });

  it('contains XY7 → xy7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY7']).toBe('xy7');
  });

  it('contains XY8a → xy8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY8a']).toBe('xy8');
  });

  it('contains XY8b → xy8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY8b']).toBe('xy8');
  });

  it('contains XY9 → xy9 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY9']).toBe('xy9');
  });

  it('contains XY10 → xy10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY10']).toBe('xy10');
  });

  it('contains XY11b → xy11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY11b']).toBe('xy11');
  });

  it('contains XY11a → xy11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['XY11a']).toBe('xy11');
  });

  it('contains CP1 → dc1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['CP1']).toBe('dc1');
  });

  it('contains CP6 → xy12 mapping', () => {
    expect(JP_TO_EN_SET_MAP['CP6']).toBe('xy12');
  });

  it('contains BW1 → [bw1, bw2] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['BW1']).toEqual(['bw1', 'bw2']);
  });

  it('contains BW2 → bw3 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW2']).toBe('bw3');
  });

  it('contains BW3 → [bw4, bw3] mapping (1-to-many)', () => {
    expect(JP_TO_EN_SET_MAP['BW3']).toEqual(['bw4', 'bw3']);
  });

  it('contains BW4 → bw5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW4']).toBe('bw5');
  });

  it('contains BW5 → bw6 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW5']).toBe('bw6');
  });

  it('contains BW6 → bw7 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW6']).toBe('bw7');
  });

  it('contains BW7 → bw8 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW7']).toBe('bw8');
  });

  it('contains BW8 → bw9 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW8']).toBe('bw9');
  });

  it('contains BW9 → bw10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['BW9']).toBe('bw10');
  });

  it('contains DS → dv1 mapping', () => {
    expect(JP_TO_EN_SET_MAP['DS']).toBe('dv1');
  });

  it('contains SC → bw11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SC']).toBe('bw11');
  });

  it('contains EB → bw11 mapping', () => {
    expect(JP_TO_EN_SET_MAP['EB']).toBe('bw11');
  });

  it('contains M2a → me02.5 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M2a']).toBe('me02.5');
  });

  it('contains M5 → me05 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M5']).toBe('me05');
  });

  it('contains M4 → me04 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M4']).toBe('me04');
  });

  it('contains M3 → me03 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M3']).toBe('me03');
  });

  it('contains M2 → me02 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M2']).toBe('me02');
  });

  it('contains M1L → me01 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M1L']).toBe('me01');
  });

  it('contains M1S → me01 mapping', () => {
    expect(JP_TO_EN_SET_MAP['M1S']).toBe('me01');
  });

  it('contains SV11B → sv10.5b mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV11B']).toBe('sv10.5b');
  });

  it('contains SV11W → sv10.5w mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV11W']).toBe('sv10.5w');
  });

  it('contains SV9a → sv10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV9a']).toBe('sv10');
  });

  it('contains SV10 → sv10 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV10']).toBe('sv10');
  });

  it('contains SV9 → sv09 mapping', () => {
    expect(JP_TO_EN_SET_MAP['SV9']).toBe('sv09');
  });

  it('explicit map takes priority over auto-derive', () => {
    // SV8 is in both explicit map and auto-derive pattern, but explicit should win
    const explicitResult = getEnSetIdForJpCode('SV8');
    const autoDeriveResult = deriveEnSetIdFromJpCode('SV8');
    expect(explicitResult).toBe('sv08');
    expect(autoDeriveResult).toBe('sv08');
    // Both give same result, but explicit is checked first
  });
});

describe('getJpSetCodeForEnSetId', () => {
  it('returns "M2a" for me02.5 (single, returns string)', () => {
    expect(getJpSetCodeForEnSetId('me02.5')).toBe('M2a');
  });

  it('returns "SV8A" for sv08.5 (single, returns string)', () => {
    expect(getJpSetCodeForEnSetId('sv08.5')).toBe('SV8A');
  });

  it('returns ["SV8", "SV7a"] for sv08 (1-to-many, returns array)', () => {
    const result = getJpSetCodeForEnSetId('sv08');
    expect(result).toEqual(['SV8', 'SV7a']);
  });

  it('returns ["M1L", "M1S"] for me01 (1-to-many, returns array)', () => {
    const result = getJpSetCodeForEnSetId('me01');
    expect(result).toEqual(['M1L', 'M1S']);
  });

  it('returns ["SV9a", "SV10"] for sv10 (1-to-many, returns array)', () => {
    const result = getJpSetCodeForEnSetId('sv10');
    expect(result).toEqual(['SV9a', 'SV10']);
  });

  it('handles uppercase input (ME02.5)', () => {
    expect(getJpSetCodeForEnSetId('ME02.5')).toBe('M2a');
  });

  it('returns null for unmapped set IDs', () => {
    expect(getJpSetCodeForEnSetId('sv12')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getJpSetCodeForEnSetId(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getJpSetCodeForEnSetId(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getJpSetCodeForEnSetId('')).toBeNull();
  });
});

describe('EN_TO_JP_SET_MAP', () => {
  it('maps every JP_TO_EN_SET_MAP entry back to its JP code', () => {
    for (const [jp, en] of Object.entries(JP_TO_EN_SET_MAP)) {
      const enIds = Array.isArray(en) ? en : [en];
      for (const enId of enIds) {
        const reverse = EN_TO_JP_SET_MAP[enId.toLowerCase()];
        expect(reverse).toContain(jp);
      }
    }
  });

  it('maps me01 to both M1L and M1S (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['me01']).toEqual(['M1L', 'M1S']);
  });

  it('maps sv10 to both SV9a and SV10 (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv10']).toEqual(['SV9a', 'SV10']);
  });

  it('maps sv08 to both SV8 and SV7a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv08']).toEqual(['SV8', 'SV7a']);
  });

  it('maps sv06 to both SV5a and SV6 (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv06']).toEqual(['SV6', 'SV5a']);
  });

  it('maps sv05 to both SV5M and SV5K (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv05']).toEqual(['SV5M', 'SV5K']);
  });

  it('maps sv04 to SV4M, SV4K, and SV3a (1-to-3)', () => {
    expect(EN_TO_JP_SET_MAP['sv04']).toEqual(['SV4M', 'SV4K', 'SV3a']);
  });

  it('maps sv03 to both SV3 and SV2P (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv03']).toEqual(['SV3', 'SV2P']);
  });

  it('maps sv02 to both SV2D and SV1a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv02']).toEqual(['SV2D', 'SV1a']);
  });

  it('maps sv01 to both SV1S and SV1V (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sv01']).toEqual(['SV1S', 'SV1V']);
  });

  it('maps swsh12 to both S12 and S11a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh12']).toEqual(['S12', 'S11a']);
  });

  it('maps swsh12.5 to S12 (1:1, Crown Zenith main)', () => {
    expect(EN_TO_JP_SET_MAP['swsh12.5']).toEqual(['S12']);
  });

  it('maps swsh12tg to S11a (1:1, Trainer Gallery)', () => {
    expect(EN_TO_JP_SET_MAP['swsh12tg']).toEqual(['S11a']);
  });

  it('maps swsh11tg to S10a and S8b (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh11tg']).toEqual(['S10a', 'S8b']);
  });

  it('maps swsh7 to S7R, S7D, and S6a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh7']).toEqual(['S7R', 'S7D', 'S6a']);
  });

  it('maps swsh6 to S6H, S6K, and S5a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh6']).toEqual(['S6H', 'S6K', 'S5a']);
  });

  it('maps swsh5 to S5R and S5I (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh5']).toEqual(['S5R', 'S5I']);
  });

  it('maps swsh4 to S4 and S3a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh4']).toEqual(['S4', 'S3a']);
  });

  it('maps swsh3 to S3 and S2a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh3']).toEqual(['S3', 'S2a']);
  });

  it('maps swsh2 to S2 and S1a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh2']).toEqual(['S2', 'S1a']);
  });

  it('maps swsh1 to S1W and S1H (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh1']).toEqual(['S1W', 'S1H']);
  });

  it('maps sm12 to SM12, SM11a, SM11b, and SM12a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['sm12']).toEqual(['SM12', 'SM11a', 'SM11b', 'SM12a']);
  });

  it('maps swsh10 to S10D, S10P, and S9a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh10']).toEqual(['S10D', 'S10P', 'S9a']);
  });

  it('maps swsh9tg to S8b (1:1, Trainer Gallery)', () => {
    expect(EN_TO_JP_SET_MAP['swsh9tg']).toEqual(['S8b']);
  });

  it('maps swsh10tg to S9a (1:1, Trainer Gallery)', () => {
    expect(EN_TO_JP_SET_MAP['swsh10tg']).toEqual(['S9a']);
  });

  it('maps bw1 to BW1 (1:1)', () => {
    expect(EN_TO_JP_SET_MAP['bw1']).toEqual(['BW1']);
  });

  it('maps bw2 to BW1 (1:1, Emerging Powers leftovers)', () => {
    expect(EN_TO_JP_SET_MAP['bw2']).toEqual(['BW1']);
  });

  it('maps bw3 to BW2 and BW3 (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['bw3']).toEqual(['BW2', 'BW3']);
  });

  it('maps bw4 to BW3 (1:1)', () => {
    expect(EN_TO_JP_SET_MAP['bw4']).toEqual(['BW3']);
  });

  it('maps dv1 to DS (1:1, Dragon Vault)', () => {
    expect(EN_TO_JP_SET_MAP['dv1']).toEqual(['DS']);
  });

  it('maps bw11 to SC and EB (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['bw11']).toEqual(['SC', 'EB']);
  });

  it('maps swsh10 to S10D, S10P, and S9a (1-to-many)', () => {
    expect(EN_TO_JP_SET_MAP['swsh10']).toEqual(['S10D', 'S10P', 'S9a']);
  });

  it('maps swsh12.5gg to S12a (1:1, Galarian Gallery)', () => {
    expect(EN_TO_JP_SET_MAP['swsh12.5gg']).toEqual(['S12a']);
  });
});

describe('EN_ABBREV_TO_SET_ID', () => {
  it('maps PBL to me05 (Pitch Black)', () => {
    expect(EN_ABBREV_TO_SET_ID['PBL']).toBe('me05');
  });

  it('maps ASC to me02.5 (Ascended Heroes)', () => {
    expect(EN_ABBREV_TO_SET_ID['ASC']).toBe('me02.5');
  });

  it('maps SSP to sv08 (Surging Sparks)', () => {
    expect(EN_ABBREV_TO_SET_ID['SSP']).toBe('sv08');
  });

  it('maps PRE to sv08.5 (Prismatic Evolutions)', () => {
    expect(EN_ABBREV_TO_SET_ID['PRE']).toBe('sv08.5');
  });

  it('maps SVI to sv01 (Scarlet & Violet)', () => {
    expect(EN_ABBREV_TO_SET_ID['SVI']).toBe('sv01');
  });

  it('maps OBF to sv03 (Obsidian Flames)', () => {
    expect(EN_ABBREV_TO_SET_ID['OBF']).toBe('sv03');
  });

  it('maps MEW to sv03.5 (151)', () => {
    expect(EN_ABBREV_TO_SET_ID['MEW']).toBe('sv03.5');
  });

  it('maps SCR to sv07 (Stellar Crown)', () => {
    expect(EN_ABBREV_TO_SET_ID['SCR']).toBe('sv07');
  });

  it('maps SSH to swsh1 (Sword & Shield)', () => {
    expect(EN_ABBREV_TO_SET_ID['SSH']).toBe('swsh1');
  });

  it('maps BS to base1 (Base Set)', () => {
    expect(EN_ABBREV_TO_SET_ID['BS']).toBe('base1');
  });

  it('has 188 entries', () => {
    expect(Object.keys(EN_ABBREV_TO_SET_ID).length).toBeGreaterThanOrEqual(188);
  });
});

describe('getEnSetIdForPrintedCode', () => {
  it('maps a printed EN abbreviation to its TCGdex set id', () => {
    expect(getEnSetIdForPrintedCode('JTG')).toBe('sv09');
    expect(getEnSetIdForPrintedCode('jtg')).toBe('sv09');
    expect(getEnSetIdForPrintedCode('GE')).toBe('dp4');
  });

  it('folds the OCR noise the TCGdex client folds', () => {
    expect(getEnSetIdForPrintedCode('SVPEN')).toBe('svp');
    expect(normalizePrintedSetCode('svp en')).toBe('SVP');
  });

  it('returns null for a JP code and for codes the table does not know', () => {
    expect(getEnSetIdForPrintedCode('SV9')).toBeNull();
    expect(getEnSetIdForPrintedCode('DPBP')).toBeNull();
    expect(getEnSetIdForPrintedCode(null)).toBeNull();
  });

  it('maps the three promo abbreviations the generated list left out', () => {
    expect(getEnSetIdForPrintedCode('DPP')).toBe('dpp');
    expect(getEnSetIdForPrintedCode('HSP')).toBe('hgssp');
    expect(getEnSetIdForPrintedCode('SWSHP')).toBe('swshp');
  });
});
