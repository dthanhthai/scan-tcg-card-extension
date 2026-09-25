import { describe, it, expect, beforeEach } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';
import { resetChromeStorage, setMessageHandler } from './chrome-mock.js';

// Load constants.js + storage.js + tcgplayer-linker.js + bulbapedia-resolver.js + card-lookup.js
// into global scope. The resolver provides normalizeBulbapediaCardName, which the
// listing selection reuses to compare card names.
loadExtensionScripts('utils/storage.js', 'lib/tcgplayer-linker.js', 'lib/bulbapedia-resolver.js', 'utils/card-lookup.js');

describe('validateCrossVersionMatch', () => {
  describe('dexId matching', () => {
    it('matches when both source and candidate have the same dexId', () => {
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [16], hp: 60 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });

    it('matches when dexId arrays overlap (source has multiple)', () => {
      const source = { dexId: [16, 17], hp: 60 };
      const candidate = { dexId: [16], hp: 60 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });

    it('rejects when source has dexId but candidate has no dexId', () => {
      // This prevents matching a trainer card (no dexId) to a Pokemon card
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [], hp: undefined };
      expect(validateCrossVersionMatch(source, candidate)).toBe(false);
    });

    it('rejects when source has dexId but candidate dexId is different', () => {
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [633], hp: 70 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(false);
    });

    it('passes when source has no dexId (cannot verify)', () => {
      const source = { dexId: [], hp: null };
      const candidate = { dexId: [16], hp: 60 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });

    it('passes when both have no dexId', () => {
      const source = { dexId: [], hp: null };
      const candidate = { dexId: [], hp: null };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });
  });

  describe('HP matching', () => {
    it('matches when both source and candidate have the same HP', () => {
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [16], hp: 60 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });

    it('rejects when source has HP but candidate has no HP', () => {
      // This prevents matching a trainer card (no HP) to a Pokemon card
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [16], hp: undefined };
      expect(validateCrossVersionMatch(source, candidate)).toBe(false);
    });

    it('rejects when HP values differ (normal vs ex variant)', () => {
      const source = { dexId: [700], hp: 270 }; // Sylveon ex
      const candidate = { dexId: [700], hp: 90 }; // Sylveon (normal)
      expect(validateCrossVersionMatch(source, candidate)).toBe(false);
    });

    it('passes when source has no HP (cannot verify)', () => {
      const source = { dexId: [16], hp: null };
      const candidate = { dexId: [16], hp: 60 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });
  });

  describe('combined dexId + HP validation', () => {
    it('rejects trainer card when source is a Pokemon (no dexId, no HP)', () => {
      // Real-world case: EN Pidgey (dexId [16], hp 60) vs JP trainer card SV3-108
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [], hp: undefined }; // trainer card
      expect(validateCrossVersionMatch(source, candidate)).toBe(false);
    });

    it('accepts correct counterpart (Pidgey EN → Pidgey JP)', () => {
      const source = { dexId: [16], hp: 60 };
      const candidate = { dexId: [16], hp: 60 };
      expect(validateCrossVersionMatch(source, candidate)).toBe(true);
    });

    it('rejects same Pokemon but wrong variant (ex vs normal)', () => {
      const source = { dexId: [700], hp: 270 }; // Sylveon ex
      const candidate = { dexId: [700], hp: 90 }; // Sylveon normal
      expect(validateCrossVersionMatch(source, candidate)).toBe(false);
    });
  });
});

describe('pickListingByLocalId', () => {
  it('returns null for an empty or missing list', () => {
    expect(pickListingByLocalId([], '072')).toBeNull();
    expect(pickListingByLocalId(null, '072')).toBeNull();
  });

  it('returns the only listing without matching', () => {
    const only = { productName: 'Darkrai', cardNumber: '999/999' };
    expect(pickListingByLocalId([only], '072')).toBe(only);
  });

  it('matches the parsed CardRush cardNumber instead of the product name', () => {
    const listings = [
      { productName: 'ダークライEX', cardNumber: '071/069', price: 500, stock: 1, condition: 'NM' },
      { productName: 'ダークライEX', cardNumber: '072/069', price: 900, stock: 1, condition: 'NM' },
    ];
    expect(pickListingByLocalId(listings, '072').cardNumber).toBe('072/069');
  });

  it('matches Collectr listings by their cardNumber too', () => {
    const listings = [
      { productName: 'Sylveon ex', cardNumber: '041/100' },
      { productName: 'Sylveon ex', cardNumber: '212/187' },
    ];
    expect(pickListingByLocalId(listings, '212').cardNumber).toBe('212/187');
  });

  it('falls back to the first listing when nothing matches', () => {
    const listings = [
      { productName: 'A', cardNumber: '001/100' },
      { productName: 'B', cardNumber: '002/100' },
    ];
    expect(pickListingByLocalId(listings, '072')).toBe(listings[0]);
  });

  it('falls back to the product name text for listings without a parsed number', () => {
    const listings = [
      { productName: 'Other card', productUrl: 'https://x/999' },
      { productName: 'ダークライEX 072/069', productUrl: 'https://x/1' },
    ];
    expect(pickListingByLocalId(listings, '072').productUrl).toBe('https://x/1');
  });

  it('falls back to the first listing when there is no local id', () => {
    const listings = [{ productName: 'A' }, { productName: 'B' }];
    expect(pickListingByLocalId(listings, null)).toBe(listings[0]);
  });

  it('ignores zero padding when comparing parsed numbers', () => {
    const listings = [
      { productName: 'Zeraora VMAX', cardNumber: '41/159' },
      { productName: 'Zeraora VMAX', cardNumber: '54/159' },
    ];
    expect(pickListingByLocalId(listings, '054').cardNumber).toBe('54/159');
    expect(pickListingByLocalId(listings, '54').cardNumber).toBe('54/159');
  });

  it('tries the unpadded form in the text fallback too', () => {
    const listings = [
      { productName: 'Other card', productUrl: 'https://x/999' },
      { productName: 'Zeraora VMAX #54', productUrl: 'https://x/1' },
    ];
    expect(pickListingByLocalId(listings, '054').productUrl).toBe('https://x/1');
  });

  it('prefers a card-name match over the first listing when no number matches', () => {
    // CardRush's search is fuzzy: "S8b 110" returns every printing of the set,
    // with 204/184 first. Without a name match a sold-out card would show
    // another card's price.
    const listings = [
      { productName: 'タイレーツ', cardNumber: '204/184', price: 380 },
      { productName: 'シャワーズ', cardNumber: '189/184', price: 2080 },
      { productName: 'ザングース', cardNumber: '110/184', price: 150 },
    ];
    expect(pickListingByLocalId(listings, '999', 'ザングース').cardNumber).toBe('110/184');
  });

  it('prefers a number match over a name-only match', () => {
    const listings = [
      { productName: 'Sylveon ex', cardNumber: '041/100' },
      { productName: 'Sylveon ex', cardNumber: '212/187' },
    ];
    expect(pickListingByLocalId(listings, '212', 'Sylveon ex').cardNumber).toBe('212/187');
  });

  it('matches names that carry a suffix or extra listing text', () => {
    const listings = [
      { productName: 'Other card', cardNumber: '001/100' },
      { productName: 'リーフィアVSTAR 014/159', cardNumber: '002/100' },
    ];
    expect(pickListingByLocalId(listings, '999', 'リーフィアVSTAR').productName).toBe('リーフィアVSTAR 014/159');
  });

  it('ignores a short name match unless it is exact', () => {
    const listings = [
      { productName: 'Other card', cardNumber: '001/100' },
      { productName: 'Haunter', cardNumber: '002/100' },
    ];
    // "Hau" must not match "Haunter" by containment, so the first listing wins.
    expect(pickListingByLocalId(listings, '999', 'Hau')).toBe(listings[0]);
    expect(pickListingByLocalId(listings, '999', 'Haunter')).toBe(listings[1]);
  });

  it('still falls back to the first listing when neither number nor name matches', () => {
    const listings = [
      { productName: 'Alpha', cardNumber: '001/100' },
      { productName: 'Beta', cardNumber: '002/100' },
    ];
    expect(pickListingByLocalId(listings, '999', 'Gamma')).toBe(listings[0]);
  });
});

describe('buildEnMarketNumber', () => {
  it('prefers the counterpart card number when it has one', () => {
    expect(buildEnMarketNumber({ cardNumber: '054/159', localId: '054' }, '041/172')).toBe('054/159');
  });

  it('builds the number from a TCGdex counterpart', () => {
    expect(buildEnMarketNumber({ localId: '54', set: { cardCount: { official: 159 } } }, '041/172')).toBe('54/159');
  });

  it('keeps the scanned number without a counterpart or set total', () => {
    expect(buildEnMarketNumber(null, '041/172')).toBe('041/172');
    expect(buildEnMarketNumber({ localId: '54' }, '041/172')).toBe('041/172');
  });
});

describe('extractLocalIdFromNumber', () => {
  it('reads the part before the slash', () => {
    expect(extractLocalIdFromNumber('054/159')).toBe('054');
    expect(extractLocalIdFromNumber('SWSH044')).toBe('SWSH044');
    expect(extractLocalIdFromNumber(null)).toBeNull();
  });
});

describe('shouldSkipJpTcgdexLookup', () => {
  it('skips for an indexed JP printing whose era has no TCGdex JA card', () => {
    expect(shouldSkipJpTcgdexLookup('index', { tcgdexSetId: null })).toBe(true);
  });

  it('does not skip when the indexed JA target has a TCGdex set id (SM/SV/M)', () => {
    expect(shouldSkipJpTcgdexLookup('index', { tcgdexSetId: 'sv08.5' })).toBe(false);
  });

  it('does not skip a TCGdex guess or a missing version', () => {
    expect(shouldSkipJpTcgdexLookup('guess', {})).toBe(false);
    expect(shouldSkipJpTcgdexLookup('index', null)).toBe(false);
  });
});

describe('buildBulbapediaJpVersion', () => {
  it('carries the target TCGdex set id so the JP lookup can decide to skip TCGdex', () => {
    const jp = buildBulbapediaJpVersion({
      setCode: 'BW4', localId: '072', cardNumber: '072/069',
      japaneseName: 'ダークライEX', cardName: 'Darkrai', setName: 'Dark Rush', rarity: 'SR',
      tcgdexSetId: null,
    });
    expect(jp.tcgdexSetId).toBeNull();
    expect(jp.set.id).toBe('BW4');
    expect(jp.localId).toBe('072');
  });

  it('returns null when the index knows the JP set but not the card number', () => {
    expect(buildBulbapediaJpVersion({
      setCode: 'DP4', localId: null, cardNumber: null,
      japaneseName: 'ダークライ', cardName: 'Darkrai', setName: 'Moonlit Pursuit', rarity: 'Rare Holo',
      tcgdexSetId: null,
    })).toBeNull();
  });
});

describe('lookupCardAndPrice skipTcgdex (C6)', () => {
  beforeEach(() => {
    resetChromeStorage();
  });

  it('skips the TCGdex fetch and still queries CardRush for an indexed JP printing', async () => {
    const calls = [];
    setMessageHandler(async (message) => {
      calls.push(message.type);
      if (message.type === MESSAGE_TYPES.FETCH_CARDRUSH_PRICE) {
        return {
          success: true,
          data: {
            listings: [{ productName: 'ダークライEX', cardNumber: '072/069', price: 1200, stock: 2, condition: 'NM', productUrl: 'https://x/1' }],
            searchUrl: 'https://x/s',
            cfChallenge: false,
          },
        };
      }
      return { success: false };
    });

    const result = await lookupCardAndPrice(
      'BW4', '072', '072/069', 'SR', 'Darkrai', 'ja', 'Dark Rush',
      null, null, true, null, null, null, null, true,
    );

    expect(calls).not.toContain(MESSAGE_TYPES.FETCH_CARD_INFO);
    expect(calls).toContain(MESSAGE_TYPES.FETCH_CARDRUSH_PRICE);
    expect(result.success).toBe(true);
    expect(result.bestListing.cardNumber).toBe('072/069');
  });

  it('still fetches TCGdex when skipTcgdex is not set', async () => {
    const calls = [];
    setMessageHandler(async (message) => {
      calls.push(message.type);
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) return { success: false, error: 'not found' };
      if (message.type === MESSAGE_TYPES.FETCH_CARDRUSH_PRICE) {
        return { success: true, data: { listings: [], searchUrl: null, cfChallenge: false } };
      }
      return { success: false };
    });

    await lookupCardAndPrice(
      'BW4', '072', '072/069', 'SR', 'Darkrai', 'ja', 'Dark Rush',
      null, null, true, null, null, null, null, false,
    );

    expect(calls).toContain(MESSAGE_TYPES.FETCH_CARD_INFO);
  });
});

describe('buildCardrushKeyword', () => {
  it('uses the set code and local id for a normal printing', () => {
    expect(buildCardrushKeyword({ setCode: 'S12a', localId: '258' })).toBe('S12a 258');
  });

  it('uses the Japanese name for a deck printing that has no printed code', () => {
    expect(buildCardrushKeyword({
      setCode: 'BREAK', localId: '002', japaneseName: 'MフシギバナEX', nameOnly: true,
    })).toBe('MフシギバナEX 002');
  });

  it('falls back to the set code when the name or the flag is missing', () => {
    expect(buildCardrushKeyword({ setCode: 'BREAK', localId: '002', nameOnly: true })).toBe('BREAK 002');
    expect(buildCardrushKeyword({ setCode: 'BREAK', localId: '002', japaneseName: 'MフシギバナEX' })).toBe('BREAK 002');
  });
});

describe('sendMessageSafely', () => {
  it('turns a rejected message into an unsuccessful response instead of throwing', async () => {
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection'); };
    try {
      // A rejected message must not escape: it would abort the lookup and leave
      // the scanner button stuck on "Searching...".
      await expect(sendMessageSafely({ type: 'FETCH_CARD_INFO' })).resolves.toEqual({
        success: false,
        error: 'Could not establish connection',
      });
    } finally {
      chrome.runtime.sendMessage = original;
    }
  });
});

describe('hasJapaneseScript', () => {
  it('detects kana and kanji', () => {
    expect(hasJapaneseScript('ダークライEX')).toBe(true);
    expect(hasJapaneseScript('リザードンex')).toBe(true);
    expect(hasJapaneseScript('ピカチュウ')).toBe(true);
  });

  it('rejects English and empty names', () => {
    expect(hasJapaneseScript('Darkrai-EX')).toBe(false);
    expect(hasJapaneseScript('')).toBe(false);
    expect(hasJapaneseScript(null)).toBe(false);
  });
});

describe('stripPrintedCardLevel', () => {
  it('drops the level a DP-era card prints next to its name', () => {
    expect(stripPrintedCardLevel('Darkrai LV.38')).toBe('Darkrai');
    expect(stripPrintedCardLevel('Darkrai LV. 40')).toBe('Darkrai');
    expect(stripPrintedCardLevel('Darkrai LV38')).toBe('Darkrai');
    expect(stripPrintedCardLevel('ダークライ LV.38')).toBe('ダークライ');
  });

  it('keeps LV.X, which is a distinct card', () => {
    expect(stripPrintedCardLevel('Darkrai LV.X')).toBe('Darkrai LV.X');
  });

  it('keeps a name that merely ends in the letters lv', () => {
    expect(stripPrintedCardLevel('Selv5')).toBe('Selv5');
  });

  it('passes a missing name through', () => {
    expect(stripPrintedCardLevel(null)).toBeNull();
    expect(stripPrintedCardLevel(undefined)).toBeUndefined();
  });
});

describe('lookupCardAndPrice language inference', () => {
  it('treats a known EN printed code as English when no hint is given', async () => {
    const languages = [];
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) languages.push(message.payload.language);
      return { success: false };
    });
    await lookupCardAndPrice('JTG', '003', '003/159', '', 'Butterfree', null, null, null, null, false, null, null, null, null, false);
    expect(languages[0]).toBe('en');
  });

  it('keeps the Japanese default for a code the EN table does not know', async () => {
    const languages = [];
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) languages.push(message.payload.language);
      return { success: false };
    });
    await lookupCardAndPrice('SV9', '003', '003/100', '', 'バタフリー', null, null, null, null, false, null, null, null, null, false);
    expect(languages[0]).toBe('ja');
  });
});

describe('lookupCardAndPrice EN query name (C5)', () => {
  beforeEach(() => {
    resetChromeStorage();
  });

  it('resolves the English name before firing the EN queries when the read name is Japanese', async () => {
    const queries = {};
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        return {
          success: true,
          data: { id: 'bw4-72', name: 'ダークライEX', localId: '072', dexId: [491], hp: 170, set: { id: 'bw4', name: 'Dark Rush' } },
        };
      }
      if (message.type === MESSAGE_TYPES.FIND_EN_VERSION) {
        return {
          success: true,
          data: { id: 'bw5-104', name: 'Darkrai-EX', localId: '104', dexId: [491], hp: 170, set: { id: 'bw5', name: 'Dark Explorers' } },
        };
      }
      if (message.type === MESSAGE_TYPES.FETCH_PRICECHARTING) {
        queries.pricecharting = message.payload.query;
        return { success: true, data: { listings: [], searchUrl: null } };
      }
      if (message.type === MESSAGE_TYPES.FETCH_COLLECTR) {
        queries.collectr = message.payload.query;
        return { success: true, data: { listings: [], searchUrl: null } };
      }
      if (message.type === MESSAGE_TYPES.FETCH_TCGPLAYER) {
        queries.tcgplayer = message.payload.query;
        return { success: true, data: { listings: [], searchUrl: null } };
      }
      if (message.type === MESSAGE_TYPES.FETCH_CARDRUSH_PRICE) {
        return { success: true, data: { listings: [], searchUrl: null, cfChallenge: false } };
      }
      return { success: false };
    });

    const result = await lookupCardAndPrice(
      'BW4', '072', '072/069', 'SR', 'ダークライEX', 'ja', 'Dark Rush',
      null, null, false, null, null, null, null, false,
    );

    expect(result.enVersion.name).toBe('Darkrai-EX');
    expect(queries.pricecharting).toContain('Darkrai-EX');
    expect(queries.collectr).toContain('Darkrai-EX');
    expect(queries.tcgplayer).toContain('Darkrai-EX');
    expect(queries.pricecharting).not.toMatch(/[ぁ-んァ-ヶ一-龯]/);
  });

  it('strips a printed level before the TCGdex fetch and the marketplace queries', async () => {
    const payloads = {};
    setMessageHandler(async (message) => {
      if (message.type === MESSAGE_TYPES.FETCH_CARD_INFO) {
        payloads.cardInfo = message.payload;
        return {
          success: true,
          data: { id: 'dp4-3', name: 'Darkrai', localId: '3', dexId: [491], hp: 70, set: { id: 'dp4', name: 'Great Encounters', cardCount: { official: 106 } } },
        };
      }
      if (message.type === MESSAGE_TYPES.FETCH_PRICECHARTING) {
        payloads.pricecharting = message.payload.query;
        return { success: true, data: { listings: [], searchUrl: null } };
      }
      if (message.type === MESSAGE_TYPES.FETCH_COLLECTR) {
        payloads.collectr = message.payload.query;
        return { success: true, data: { listings: [], searchUrl: null } };
      }
      if (message.type === MESSAGE_TYPES.FETCH_TCGPLAYER) {
        payloads.tcgplayer = message.payload.query;
        return { success: true, data: { listings: [], searchUrl: null } };
      }
      return { success: false };
    });

    await lookupCardAndPrice(
      'DPt', '3', '3/106', 'R', 'Darkrai LV.38', 'en', 'Great Encounters',
      null, 'ダークライ LV.38', false, null, null, null, null, false,
    );

    expect(payloads.cardInfo.cardName).toBe('Darkrai');
    expect(payloads.pricecharting).toBe('Darkrai 3/106 Great Encounters');
    expect(payloads.tcgplayer).not.toContain('LV.38');
  });
});

describe('resolveJpVersionImage (C1)', () => {
  it('uses the JP version image when the printing has one', () => {
    expect(resolveJpVersionImage({ image: 'https://img/sv1v-1' }, null)).toBe('https://img/sv1v-1/high.webp');
  });

  it('falls back to the validated JA TCGdex card image for SV/SM/M', () => {
    const report = { validatedCard: { image: 'https://img/sv1v-1' } };
    expect(resolveJpVersionImage({ image: null }, report)).toBe('https://img/sv1v-1/high.webp');
  });

  it('returns an empty string when neither has an image (BW/HGSS/XY)', () => {
    expect(resolveJpVersionImage({ image: null }, { validatedCard: { image: null } })).toBe('');
    expect(resolveJpVersionImage({ image: null }, null)).toBe('');
    expect(resolveJpVersionImage(null, null)).toBe('');
  });
});

describe('pickCrossVersionResultImage (C1)', () => {
  it('prefers the CardRush listing image', () => {
    const result = {
      bestListing: { imageUrl: 'https://cardrush/img.jpg' },
      collectrListing: { imageUrl: 'https://collectr/img.jpg' },
    };
    expect(pickCrossVersionResultImage(result)).toBe('https://cardrush/img.jpg');
  });

  it('falls back to another marketplace image when CardRush has no listing', () => {
    const result = {
      bestListing: null,
      collectrListing: null,
      tcgplayerPrice: null,
      pricechartingListing: { imageUrl: 'https://pricecharting/img.jpg' },
    };
    expect(pickCrossVersionResultImage(result)).toBe('https://pricecharting/img.jpg');
  });

  it('ignores missing and placeholder images', () => {
    expect(pickCrossVersionResultImage({ bestListing: null })).toBeNull();
    expect(pickCrossVersionResultImage({})).toBeNull();
    expect(pickCrossVersionResultImage(null)).toBeNull();
    expect(pickCrossVersionResultImage({ bestListing: { imageUrl: 'data:image/gif;base64,xx' } })).toBeNull();
    expect(pickCrossVersionResultImage({ bestListing: { imageUrl: 'data:image/png;base64,xx' }, collectrListing: { imageUrl: 'data:image/png;base64,yy' } })).toBeNull();
  });
});

describe('pickPricechartingSetToken', () => {
  it('prefers the index EN set name over the name Gemini read', () => {
    // Reported case: Gemini read "Sword & Storm" for a Crown Zenith card; the
    // index's EN source knows the real set.
    expect(pickPricechartingSetToken({
      indexSetName: 'Crown Zenith', setNameHint: 'Sword & Storm', setCode: 'SWSH', isEnCard: true,
    })).toBe('Crown Zenith');
  });

  it('falls back to the set name Gemini read', () => {
    expect(pickPricechartingSetToken({ indexSetName: null, setNameHint: 'XY', setCode: 'XY', isEnCard: true })).toBe('XY');
  });

  it('uses the printed code only for EN scans', () => {
    expect(pickPricechartingSetToken({ indexSetName: null, setNameHint: null, setCode: 'XY', isEnCard: true })).toBe('XY');
    expect(pickPricechartingSetToken({ indexSetName: null, setNameHint: null, setCode: 'XY1B', isEnCard: false })).toBeNull();
  });

  it('never uses a Japanese-script set name', () => {
    expect(pickPricechartingSetToken({ indexSetName: 'ダークラッシュ', setNameHint: 'ダークラッシュ', setCode: 'BW4', isEnCard: true })).toBe('BW4');
    expect(pickPricechartingSetToken({ indexSetName: 'ダークラッシュ', setNameHint: null, setCode: 'BW4', isEnCard: false })).toBeNull();
  });
});

describe('scrollIntoViewIfPossible', () => {
  it('scrolls with the given block alignment', () => {
    const calls = [];
    const element = { scrollIntoView: (options) => calls.push(options) };
    scrollIntoViewIfPossible(element);
    scrollIntoViewIfPossible(element, 'nearest');
    expect(calls).toEqual([
      { block: 'start', behavior: 'smooth' },
      { block: 'nearest', behavior: 'smooth' },
    ]);
  });

  it('does nothing when the element or the API is missing', () => {
    expect(() => scrollIntoViewIfPossible(null)).not.toThrow();
    expect(() => scrollIntoViewIfPossible({})).not.toThrow();
  });
});

describe('resolveCrossVersionProvenance', () => {
  it('marks a JP section from a Bulbapedia hit as index', () => {
    const result = { jpVersion: { id: 'S11-125' }, bulbapediaReport: { status: 'hit' } };
    expect(resolveCrossVersionProvenance(result)).toBe('index');
  });

  it('marks a JP section from a TCGdex search as guess', () => {
    const result = { jpVersion: { id: 'M5-099' }, bulbapediaReport: { status: 'miss' } };
    expect(resolveCrossVersionProvenance(result)).toBe('guess');
  });

  it('marks a JP section as guess when there is no report', () => {
    expect(resolveCrossVersionProvenance({ jpVersion: { id: 'M5-099' } })).toBe('guess');
  });

  it('marks an EN section adopted from the validated index card as index', () => {
    const result = {
      enVersion: { id: 'swsh1-142' },
      bulbapediaReport: { status: 'hit', validatedCard: { id: 'swsh1-142' } },
    };
    expect(resolveCrossVersionProvenance(result)).toBe('index');
  });

  it('marks an EN section as guess when the index target failed validation', () => {
    const result = {
      enVersion: { id: 'swsh1-999' },
      bulbapediaReport: { status: 'hit', validation: { valid: false } },
    };
    expect(resolveCrossVersionProvenance(result)).toBe('guess');
  });

  it('returns null when no cross-version card is shown', () => {
    expect(resolveCrossVersionProvenance({ bulbapediaReport: { status: 'miss' } })).toBeNull();
    expect(resolveCrossVersionProvenance(null)).toBeNull();
  });
});

describe('renderCrossVersionBadge', () => {
  it('renders the verified index badge with an SVG info icon tooltip', () => {
    const html = renderCrossVersionBadge('index');
    expect(html).toContain('cross-version-badge-verified');
    expect(html).toContain('>Verified<');
    expect(html).toContain('cross-version-badge-info');
    expect(html).toContain('cross-version-badge-icon');
    expect(html).toContain('data-tooltip="Matched in the reviewed Bulbapedia index"');
    // The tooltip is also the accessible name, since the icon is decorative.
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Matched in the reviewed Bulbapedia index"');
  });

  it('renders the unverified badge for a guess with an SVG info icon tooltip', () => {
    const html = renderCrossVersionBadge('guess');
    expect(html).toContain('cross-version-badge-guess');
    expect(html).toContain('>Unverified<');
    expect(html).toContain('cross-version-badge-icon');
    expect(html).toContain('data-tooltip=');
  });

  it('renders nothing when there is no provenance', () => {
    expect(renderCrossVersionBadge(null)).toBe('');
  });
});

describe('renderProgressSteps', () => {
  it('splits the steps into an API column and a Marketplaces column', () => {
    const html = renderProgressSteps({});
    expect((html.match(/progress-column"/g) || []).length).toBe(2);
    expect(html).toContain('>API<');
    expect(html).toContain('>Marketplaces<');
  });

  it('keeps every step, with API steps before marketplace steps', () => {
    const html = renderProgressSteps({});
    const apiIndex = html.indexOf('Bulbapedia counterpart');
    const marketIndex = html.indexOf('CardRush price');
    expect(html).toContain('TCGdex metadata');
    expect(html).toContain('PriceCharting price');
    expect(html).toContain('Collectr price');
    expect(apiIndex).toBeGreaterThan(-1);
    expect(marketIndex).toBeGreaterThan(apiIndex);
  });

  it('applies the state and detail of each step', () => {
    const html = renderProgressSteps({ cardrush: { status: 'done' }, tcgplayer: { status: 'error', detail: 'Failed' } });
    expect(html).toContain('progress-step progress-done');
    expect(html).toContain('progress-step progress-error');
    expect(html).toContain('Failed');
    expect((html.match(/progress-pending/g) || []).length).toBe(4);
  });
});

describe('parsePrintedTotal', () => {
  it('reads the total from a printed number', () => {
    expect(parsePrintedTotal('2/83')).toBe(83);
    expect(parsePrintedTotal('107/108')).toBe(108);
    expect(parsePrintedTotal('072/069')).toBe(69);
  });

  it('returns null when there is no numeric total', () => {
    expect(parsePrintedTotal('BW93')).toBeNull();
    expect(parsePrintedTotal('RC1/RC32')).toBeNull();
    expect(parsePrintedTotal(null)).toBeNull();
  });
});
