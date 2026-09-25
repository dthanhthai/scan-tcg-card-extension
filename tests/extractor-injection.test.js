import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScript } from './load-scripts.js';

// chrome.scripting.executeScript({ func }) serializes only the function it is
// given, so an injected extractor has to be self-contained: a call to a sibling
// top-level function from the same file is undefined in the marketplace page and
// throws. That silently produced zero CardRush listings on pages that did have
// results (the page count check passed, then extraction returned []).
//
// The map mirrors the `func:` references in lib/*-scraper.js. Add an entry when a
// new extractor is injected.
const INJECTED_EXTRACTORS = {
  'content-scripts/cardrush-extractor.js': ['extractCardrushListings'],
  'content-scripts/collectr-extractor.js': ['extractCollectrListings'],
  'content-scripts/pricecharting-extractor.js': ['extractPricechartingListings', 'extractPricechartingDetailSales'],
  'content-scripts/tcgplayer-extractor.js': ['extractTcgplayerListings', 'extractTcgplayerDetailPrices'],
};

function topLevelFunctionNames(source) {
  return [...source.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\(/gm)].map((match) => match[1]);
}

// Only real calls count: a sibling name mentioned in a comment or a docstring is
// harmless. Full-line comments are dropped first, then the name must be followed
// by an opening parenthesis.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('injected extractors are self-contained', () => {
  for (const [file, injectedNames] of Object.entries(INJECTED_EXTRACTORS)) {
    it(`${file} only references what it defines`, () => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      loadScript(file);
      const declared = topLevelFunctionNames(source);
      for (const name of injectedNames) {
        expect(declared, `${name} is declared`).toContain(name);
        const serialized = stripComments(globalThis[name].toString());
        const siblings = declared.filter((candidate) => candidate !== name);
        const referenced = siblings.filter((candidate) => new RegExp(`\\b${candidate}\\s*\\(`).test(serialized));
        expect(referenced, `${name} must not call sibling function(s) that are missing in the page`).toEqual([]);
      }
    });
  }
});
