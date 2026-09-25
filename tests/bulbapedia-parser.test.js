import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractPageSnapshot,
  parseCardPage,
  parseRedirectPage,
  parseSetPage,
  parseWithReport,
} from '../scripts/bulbapedia/bulbapedia-parser.mjs';

const FIXTURE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/bulbapedia');

function loadFixture(fileName) {
  return JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, fileName), 'utf8'));
}

const blendEnergyFixture = loadFixture('blend-energy-grpd.json');
const darkExplorersFixture = loadFixture('dark-explorers-set.json');
const darkraiFixture = loadFixture('darkrai-ex.json');
const exBattleBoostRedirectFixture = loadFixture('ex-battle-boost-redirect.json');
const megaHoundoomFixture = loadFixture('m-houndoom-ex.json');
const plasmaEnergyFixture = loadFixture('plasma-energy.json');
const professorJuniperFixture = loadFixture('professor-juniper.json');

describe('extractPageSnapshot', () => {
  it('extracts revision-pinned page metadata and wikitext', () => {
    const snapshot = extractPageSnapshot(darkraiFixture);
    expect(snapshot.title).toBe('Darkrai-EX (Dark Explorers 63)');
    expect(snapshot.pageId).toBe(150074);
    expect(snapshot.revisionId).toBeGreaterThan(0);
    expect(snapshot.revisionTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.wikitext).toContain('{{PokémoncardInfobox');
  });
});

describe('parseCardPage', () => {
  it('prefers the page title name for Mega printings', () => {
    const card = parseCardPage(megaHoundoomFixture);
    expect(card.cardName).toBe('M Houndoom-EX');
    expect(card.japaneseName).toBe('MヘルガーEX');
  });

  it('extracts Pokémon metadata', () => {
    const card = parseCardPage(darkraiFixture);
    expect(card.cardKind).toBe('pokemon');
    expect(card.cardName).toBe('Darkrai-EX');
    expect(card.japaneseName).toBe('ダークライEX');
    expect(card.hp).toBe(180);
    expect(card.image).toBe('DarkraiEXDarkExplorers63.jpg');
    expect(card.reprintCount).toBe(3);
  });

  it('extracts the Darkrai regular EN and JP printing pair', () => {
    const card = parseCardPage(darkraiFixture);
    expect(card.printings).toContainEqual({
      en: { setName: 'Dark Explorers', cardNumber: '63/108', rarity: 'Rare Holo ex' },
      ja: { setName: 'Dark Rush', cardNumber: '044/069', rarity: 'R' },
    });
  });

  it('extracts the Darkrai Full Art EN and JP printing pair', () => {
    const card = parseCardPage(darkraiFixture);
    expect(card.printings).toContainEqual({
      en: { setName: 'Dark Explorers', cardNumber: '107/108', rarity: 'Rare Ultra' },
      ja: { setName: 'Dark Rush', cardNumber: '072/069', rarity: 'SR' },
    });
  });

  it('extracts the Darkrai EX Battle Boost reprint pair', () => {
    const card = parseCardPage(darkraiFixture);
    expect(card.printings).toContainEqual({
      en: { setName: 'Legendary Treasures', cardNumber: '88/113', rarity: 'Rare Holo ex' },
      ja: { setName: 'EX Battle Boost', cardNumber: '072/093', rarity: null },
    });
  });

  it('keeps incomplete promo relationships for later review', () => {
    const card = parseCardPage(darkraiFixture);
    expect(card.printings).toContainEqual({
      en: { setName: 'BW Black Star Promos', cardNumber: 'BW46', rarity: null },
      ja: { setName: 'BW-P Promotional cards', cardNumber: null, rarity: null },
    });
  });

  it('supports Trainer card templates without dexId or HP', () => {
    const card = parseCardPage(professorJuniperFixture);
    expect(card.cardKind).toBe('trainer');
    expect(card.cardName).toBe('Professor Juniper');
    expect(card.japaneseName).toBe('アララギ博士');
    expect(card.hp).toBeNull();
    expect(card.printings).toContainEqual({
      en: { setName: 'Black & White', cardNumber: '101/114', rarity: 'Uncommon' },
      ja: { setName: 'Black Collection', cardNumber: '053/053', rarity: 'U' },
    });
  });

  it('extracts Trainer deck-only and Full Art relationships', () => {
    const card = parseCardPage(professorJuniperFixture);
    expect(card.printings).toContainEqual({
      en: { setName: 'Dark Explorers', cardNumber: '98/108', rarity: 'Uncommon' },
      ja: { setName: 'Reshiram-EX Battle Strength Deck', cardNumber: '015/018', rarity: null },
    });
    expect(card.printings).toContainEqual({
      en: { setName: 'Plasma Freeze', cardNumber: '116/116', rarity: 'Rare Ultra' },
      ja: { setName: 'Thunder Knuckle', cardNumber: '055/051', rarity: 'SR' },
    });
  });

  it('supports Energy pages with a wrongtitle prefix', () => {
    const card = parseCardPage(blendEnergyFixture);
    expect(card.cardKind).toBe('energy');
    expect(card.cardName).toBe('Blend Energy GRPD');
    expect(card.printings).toContainEqual({
      en: { setName: 'Dragons Exalted', cardNumber: '117/124', rarity: 'Uncommon' },
      ja: { setName: 'Dragon Blast', cardNumber: '050/050', rarity: 'U' },
    });
  });

  it('extracts nested Energy release relationships', () => {
    const card = parseCardPage(plasmaEnergyFixture);
    expect(card.cardKind).toBe('energy');
    expect(card.cardName).toBe('Plasma Energy');
    expect(card.printings).toContainEqual({
      en: { setName: 'Plasma Storm', cardNumber: '127/135', rarity: 'Uncommon' },
      ja: { setName: 'Plasma Gale', cardNumber: '067/070', rarity: 'U' },
    });
    expect(card.printings).toContainEqual({
      en: { setName: 'Plasma Blast', cardNumber: '91/101', rarity: 'Uncommon' },
      ja: { setName: 'Megalo Cannon', cardNumber: '076/076', rarity: 'U' },
    });
  });
});

describe('parseSetPage', () => {
  it('extracts EN and JP set sections from Dark Explorers', () => {
    const set = parseSetPage(darkExplorersFixture);
    expect(set.title).toBe('Dark Explorers (TCG)');
    expect(set.pageId).toBeGreaterThan(0);
    expect(set.revisionId).toBeGreaterThan(0);
    expect(set.setNames).toContain('Dark Explorers');
    expect(set.setNames).toContain('Dark Rush');
  });

  it('extracts Darkrai entries from both set lists', () => {
    const set = parseSetPage(darkExplorersFixture);
    const darkraiNumbers = set.cards
      .filter((card) => card.cardName === 'Darkrai')
      .map((card) => card.cardNumber);
    expect(darkraiNumbers).toContain('63/108');
    expect(darkraiNumbers).toContain('107/108');
    expect(darkraiNumbers).toContain('044/069');
    expect(darkraiNumbers).toContain('072/069');
  });
});

describe('parseRedirectPage', () => {
  it('extracts the canonical EX Battle Boost target', () => {
    const redirect = parseRedirectPage(exBattleBoostRedirectFixture);
    expect(redirect.title).toBe('EX Battle Boost (TCG)');
    expect(redirect.pageId).toBeGreaterThan(0);
    expect(redirect.revisionId).toBeGreaterThan(0);
    expect(redirect.targetTitle).toBe('Legendary Treasures (TCG)');
  });
});

describe('parseWithReport', () => {
  it('returns a structured failure without partial production data', () => {
    const unknownTemplateResponse = {
      query: {
        pages: [{
          pageid: 1,
          title: 'Unknown Card',
          revisions: [{
            revid: 1,
            timestamp: '2026-01-01T00:00:00Z',
            slots: { main: { content: '{{UnknownCardTemplate}}' } },
          }],
        }],
      },
    };
    expect(parseWithReport(parseCardPage, unknownTemplateResponse)).toEqual({
      success: false,
      data: null,
      error: 'Unsupported Bulbapedia card page: Unknown Card',
    });
  });

  it('reports malformed API responses', () => {
    expect(parseWithReport(parseCardPage, { error: { info: 'request failed' } })).toEqual({
      success: false,
      data: null,
      error: 'Bulbapedia response must contain exactly one existing page',
    });
  });
});
