import { describe, it, expect } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// Load constants.js + pricecharting-scraper.js into global scope
loadExtensionScripts('lib/pricecharting-scraper.js');

// Listing shape returned by the extractor (fields trimmed to what matters here).
const xyBeedrill5 = { productName: 'Beedrill #5', productUrl: 'https://pc/pokemon-xy/beedrill-5', setName: 'Pokemon XY' };
const chaosBeedrillEx3 = { productName: 'Beedrill ex #3', productUrl: 'https://pc/pokemon-chaos-rising/beedrill-ex-3', setName: 'Pokemon Chaos Rising' };
const jpCollectionY3 = { productName: 'Beedrill #003', productUrl: 'https://pc/pokemon-japanese-collection-y/beedrill-003', setName: 'Pokemon Japanese Collection Y' };
const astralRadianceV161 = { productName: 'Beedrill V #161', productUrl: 'https://pc/pokemon-astral-radiance/beedrill-v-161', setName: 'Pokemon Astral Radiance' };

describe('extractPricechartingQueryLocalId', () => {
  it('reads the printed local id', () => {
    expect(extractPricechartingQueryLocalId('Beedrill 5/146')).toBe('5');
    expect(extractPricechartingQueryLocalId('Beedrill 003/060 Collection Y')).toBe('003');
  });

  it('returns null when the query has no number', () => {
    expect(extractPricechartingQueryLocalId('Pikachu')).toBeNull();
    expect(extractPricechartingQueryLocalId(null)).toBeNull();
  });

  it('prefers the printed n/m number over a digit carried by the name', () => {
    expect(extractPricechartingQueryLocalId('Darkrai LV.38 3/106 Great Encounters')).toBe('3');
    expect(extractPricechartingQueryLocalId('Porygon2 25/124')).toBe('25');
  });

  it('still reads a bare promo number', () => {
    expect(extractPricechartingQueryLocalId('Paradise Resort 224 SVP Black Star Promos')).toBe('224');
  });
});

describe('rankPricechartingListings', () => {
  it('prefers the same card name over another card that shares the number', () => {
    // Reported case: Gemini misread the set as "Sword & Storm", the search
    // returned 100 rows, and number-only matching picked a Charizard VSTAR #14
    // from the Japanese VSTAR Universe set.
    const charizardVstar14 = { productName: 'Charizard VSTAR #14', productUrl: 'https://pc/pokemon-japanese-vstar-universe/charizard-vstar-14', setName: 'Pokemon Japanese VSTAR Universe' };
    const leafeonVstar14 = { productName: 'Leafeon VSTAR #14', productUrl: 'https://pc/pokemon-crown-zenith/leafeon-vstar-14', setName: 'Pokemon Crown Zenith' };
    const ordered = rankPricechartingListings(
      [charizardVstar14, leafeonVstar14],
      'Leafeon VSTAR 014/159 Sword & Storm',
      'Sword & Storm',
      'Leafeon VSTAR',
    );
    expect(ordered[0]).toBe(leafeonVstar14);
  });

  it('prefers the printing that matches the number and the set', () => {
    // Cross-version case: the JP printing must win over another set's #3.
    const ordered = rankPricechartingListings([chaosBeedrillEx3, jpCollectionY3], 'Beedrill 003/060 Collection Y', 'Collection Y');
    expect(ordered[0]).toBe(jpCollectionY3);
  });

  it('ranks a number match above a set-only match', () => {
    const setOnly = { productName: 'Beedrill ex #9', productUrl: 'https://pc/pokemon-xy/beedrill-ex-9', setName: 'Pokemon XY' };
    const ordered = rankPricechartingListings([setOnly, xyBeedrill5], 'Beedrill 5/146 XY', 'XY');
    expect(ordered[0]).toBe(xyBeedrill5);
  });

  it('moves the matching printing to the front and keeps the rest', () => {
    const ordered = rankPricechartingListings([astralRadianceV161, chaosBeedrillEx3, xyBeedrill5], 'Beedrill 5/146 XY', 'XY');
    expect(ordered[0]).toBe(xyBeedrill5);
    expect(ordered).toHaveLength(3);
    expect(ordered.slice(1)).toEqual(expect.arrayContaining([astralRadianceV161, chaosBeedrillEx3]));
  });

  it('does not treat a longer number as a match', () => {
    // "#161" must not match the query number 1. No set token or card name, so
    // only the number decides and the order must stay as it came.
    const listings = [astralRadianceV161, xyBeedrill5];
    expect(rankPricechartingListings(listings, 'Beedrill 1/146', null)).toEqual(listings);
  });

  it('picks the exact number when a longer one shares the prefix', () => {
    const one = { productName: 'Beedrill #1', productUrl: 'https://pc/pokemon-xy/beedrill-1', setName: 'Pokemon XY' };
    const sixteen = { productName: 'Beedrill #16', productUrl: 'https://pc/pokemon-xy/beedrill-16', setName: 'Pokemon XY' };
    expect(rankPricechartingListings([sixteen, one], 'Beedrill 1/146 XY', 'XY')[0]).toBe(one);
  });

  it('matches a zero-padded query number against an unpadded listing', () => {
    const padded = { productName: 'Pikachu #28', productUrl: 'https://pc/pokemon-xy/pikachu-28', setName: 'Pokemon XY' };
    const other = { productName: 'Pikachu #4', productUrl: 'https://pc/pokemon-xy/pikachu-4', setName: 'Pokemon XY' };
    expect(rankPricechartingListings([other, padded], 'Pikachu 028/071', null)[0]).toBe(padded);
  });

  it('keeps the original order when nothing matches or the input is too small', () => {
    const listings = [astralRadianceV161, chaosBeedrillEx3];
    expect(rankPricechartingListings(listings, 'Beedrill 999/146 XY', 'XY')).toEqual(listings);
    expect(rankPricechartingListings([astralRadianceV161], 'Beedrill 5/146', null)).toEqual([astralRadianceV161]);
    expect(rankPricechartingListings([], 'Beedrill 5/146', null)).toEqual([]);
  });
});

describe('normalizePricechartingText', () => {
  it('keeps only letters and digits, lowercased', () => {
    expect(normalizePricechartingText('Leafeon VSTAR #14')).toBe('leafeonvstar14');
    expect(normalizePricechartingText('Sword & Storm')).toBe('swordstorm');
    expect(normalizePricechartingText(null)).toBe('');
  });
});
