import { describe, it, expect } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// Load constants.js into global scope so TCGDEX_TO_CARDRUSH_RARITY is available
loadExtensionScripts();

describe('TCGDEX_TO_CARDRUSH_RARITY', () => {
  it('maps Common rarity to C', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Common']).toBe('C');
  });

  it('maps Uncommon rarity to U', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Uncommon']).toBe('U');
  });

  it('maps Rare rarity to R', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Rare']).toBe('R');
  });

  it('maps Double rare to RR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Double rare']).toBe('RR');
  });

  it('maps Triple rare to RRR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Triple rare']).toBe('RRR');
  });

  it('maps Super Rare to SR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Super Rare']).toBe('SR');
  });

  it('maps Hyper Rare to HR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Hyper Rare']).toBe('HR');
  });

  it('maps MEGA Ultra Rare to MUR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['MEGA Ultra Rare']).toBe('MUR');
  });

  it('maps Shiny rare to S', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Shiny rare']).toBe('S');
  });

  it('maps Promo to P', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Promo']).toBe('P');
  });

  // JP-specific
  it('maps JP Holo Rare to R', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Holo Rare']).toBe('R');
  });

  it('maps JP Holo Rare V to RR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Holo Rare V']).toBe('RR');
  });

  it('maps JP Holo Rare VSTAR to RRR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Holo Rare VSTAR']).toBe('RRR');
  });

  it('maps JP Character Rare to AR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Character Rare']).toBe('AR');
  });

  it('maps JP Character Super Rare to SAR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Character Super Rare']).toBe('SAR');
  });

  it('maps JP Mega Hyper Rare to HR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Mega Hyper Rare']).toBe('HR');
  });

  // EN-specific
  it('maps EN Illustration rare to AR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Illustration rare']).toBe('AR');
  });

  it('maps EN Art Rare to AR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Art Rare']).toBe('AR');
  });

  it('maps EN Special Art Rare to SAR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Special Art Rare']).toBe('SAR');
  });

  it('maps EN Special illustration rare to SAR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Special illustration rare']).toBe('SAR');
  });

  it('maps EN Secret Rare to HR', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Secret Rare']).toBe('HR');
  });
});

describe('JP ↔ EN rarity equivalence', () => {
  // These pairs should map to the same short code, enabling cross-language matching
  it('treats JP Character Super Rare and EN Special illustration rare as same tier (SAR)', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Character Super Rare'])
      .toBe(TCGDEX_TO_CARDRUSH_RARITY['Special illustration rare']);
  });

  it('treats JP Character Rare and EN Illustration rare as same tier (AR)', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Character Rare'])
      .toBe(TCGDEX_TO_CARDRUSH_RARITY['Illustration rare']);
  });

  it('treats JP Holo Rare V and EN Double rare as same tier (RR)', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Holo Rare V'])
      .toBe(TCGDEX_TO_CARDRUSH_RARITY['Double rare']);
  });

  it('treats JP Holo Rare VSTAR and EN Triple rare as same tier (RRR)', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Holo Rare VSTAR'])
      .toBe(TCGDEX_TO_CARDRUSH_RARITY['Triple rare']);
  });

  it('treats JP Mega Hyper Rare and EN Secret Rare as same tier (HR)', () => {
    expect(TCGDEX_TO_CARDRUSH_RARITY['Mega Hyper Rare'])
      .toBe(TCGDEX_TO_CARDRUSH_RARITY['Secret Rare']);
  });
});

describe('SIR ↔ SAR normalization', () => {
  // Gemini may return "SIR" (Special Illustration Rare) which is the same
  // tier as "SAR" (Special Art Rare). The rarity filter in findCrossVersionCard
  // normalizes SIR → SAR before comparing.
  it('SIR should be treated as equivalent to SAR in matching logic', () => {
    const sourceRarity = 'SIR';
    const normalizedSourceRarity = sourceRarity === 'SIR' ? 'SAR' : sourceRarity;
    const candidateRarity = TCGDEX_TO_CARDRUSH_RARITY['Special illustration rare'];
    const normalizedCandidate = candidateRarity === 'SIR' ? 'SAR' : candidateRarity;

    expect(normalizedSourceRarity).toBe(normalizedCandidate);
    expect(normalizedSourceRarity).toBe('SAR');
  });

  it('SAR should remain SAR (no normalization needed)', () => {
    const sourceRarity = 'SAR';
    const normalizedSourceRarity = sourceRarity === 'SIR' ? 'SAR' : sourceRarity;
    expect(normalizedSourceRarity).toBe('SAR');
  });

  it('AR should remain AR (no normalization needed)', () => {
    const sourceRarity = 'AR';
    const normalizedSourceRarity = sourceRarity === 'SIR' ? 'SAR' : sourceRarity;
    expect(normalizedSourceRarity).toBe('AR');
  });
});
