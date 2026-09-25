#!/usr/bin/env node
// Fetches all JP and EN sets from TCGdex, groups by serie, and prints
// side-by-side comparison to help manually build JP_TO_EN_SET_MAP.
//
// Usage: node scripts/gen-set-mapping.js
// Output: prints suggested mappings + full set list for review.

const TCGDEX_BASE = 'https://api.tcgdex.net/v2';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchAllSets(lang) {
  const sets = await fetchJson(`${TCGDEX_BASE}/${lang}/sets`);
  const detailed = [];
  for (const s of sets) {
    try {
      const detail = await fetchJson(`${TCGDEX_BASE}/${lang}/sets/${s.id}`);
      detailed.push({
        id: detail.id,
        name: detail.name,
        releaseDate: detail.releaseDate || '?',
        cardCount: detail.cardCount?.official ?? '?',
        serieId: detail.serie?.id || '?',
        serieName: detail.serie?.name || '?',
        abbrev: detail.abbreviation?.official || '-',
      });
    } catch (err) {
      console.error(`  [skip] ${lang}/${s.id}: ${err.message}`);
    }
  }
  return detailed;
}

function groupBySerie(sets) {
  const groups = {};
  for (const s of sets) {
    const key = s.serieId;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
  }
  return groups;
}

// Known serie mapping: JP serie ID → EN serie ID
const SERIE_MAP = {
  'SV': 'sv',
  'S': 'swsh',
  'SM': 'sm',
  'XY': 'xy',
  'XYb': 'xy',
  'M': 'me',
  'PMCG': 'base',
  'neo': 'neo',
  'e': 'ecard',
  'ADV': 'ex',
  'PCG': 'dp',
  'L': 'pl',
};

async function main() {
  console.log('Fetching JP sets...');
  const jpSets = await fetchAllSets('ja');
  console.log(`  ${jpSets.length} JP sets`);

  console.log('Fetching EN sets...');
  const enSets = await fetchAllSets('en');
  console.log(`  ${enSets.length} EN sets`);

  const jpBySerie = groupBySerie(jpSets);
  const enBySerie = groupBySerie(enSets);

  console.log('\n');
  console.log('='.repeat(80));
  console.log('SERIE MAPPING (JP → EN)');
  console.log('='.repeat(80));
  for (const [jpSerie, enSerie] of Object.entries(SERIE_MAP)) {
    const jpCount = jpBySerie[jpSerie]?.length || 0;
    const enCount = enBySerie[enSerie]?.length || 0;
    console.log(`  ${jpSerie.padEnd(8)} → ${enSerie.padEnd(8)}  (JP: ${jpCount} sets, EN: ${enCount} sets)`);
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('SIDE-BY-SIDE SET COMPARISON BY SERIE');
  console.log('='.repeat(80));

  for (const [jpSerie, enSerie] of Object.entries(SERIE_MAP)) {
    const jpList = jpBySerie[jpSerie] || [];
    const enList = enBySerie[enSerie] || [];
    if (jpList.length === 0 && enList.length === 0) continue;

    console.log(`\n--- ${jpSerie} (${jpList.length} JP) → ${enSerie} (${enList.length} EN) ---`);
    const maxRows = Math.max(jpList.length, enList.length);
    console.log(
      '  JP'.padEnd(45) + 'release'.padEnd(13) + 'cards'.padEnd(7) +
      ' | ' +
      'EN'.padEnd(45) + 'release'.padEnd(13) + 'cards'.padEnd(7) + 'abbrev'
    );
    console.log('-'.repeat(130));
    for (let i = 0; i < maxRows; i++) {
      const jp = jpList[i];
      const en = enList[i];
      const jpStr = jp ? `${jp.id.padEnd(12)} ${jp.name.substring(0, 30)}` : '';
      const jpDate = jp ? jp.releaseDate : '';
      const jpCount = jp ? String(jp.cardCount) : '';
      const enStr = en ? `${en.id.padEnd(12)} ${en.name.substring(0, 30)}` : '';
      const enDate = en ? en.releaseDate : '';
      const enCount = en ? String(en.cardCount) : '';
      const enAbbrev = en ? en.abbrev : '';
      console.log(
        `  ${jpStr.padEnd(45)}${jpDate.padEnd(13)}${jpCount.padEnd(7)}` +
        ' | ' +
        `${enStr.padEnd(45)}${enDate.padEnd(13)}${enCount.padEnd(7)}${enAbbrev}`
      );
    }
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('CURRENT JP_TO_EN_SET_MAP');
  console.log('='.repeat(80));
  console.log(`  SV8A → sv08.5`);
  console.log(`  SV8  → sv08`);
  console.log(`  M2a  → me02.5`);
  console.log('\nReview the side-by-side list above and add missing mappings.');
  console.log('Format: { JP_CODE: EN_TCGDEX_SET_ID }');
  console.log('Example: { \'M2a\': \'me02.5\', \'SV8\': \'sv08\' }');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
