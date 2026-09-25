import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Probes the TCGdex JA set endpoint for every set id given on the command line
// and reports how many cards it actually contains. TCGdex JA often lists a set
// (with an official card count) while returning no cards, which decides whether
// a JA catalog entry can carry a real tcgdexSetId.
//
// Usage: node scripts/bulbapedia/probe-tcgdex-ja.mjs SM1S SM1M ... [--json out.json]
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TCGDEX_API_URL = 'https://api.tcgdex.net/v2';
const REQUEST_DELAY_MS = 120;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function probeSet(setId) {
  try {
    const response = await fetch(`${TCGDEX_API_URL}/ja/sets/${encodeURIComponent(setId)}`);
    if (!response.ok) return { setId, cards: null, error: `HTTP ${response.status}` };
    const data = await response.json();
    return { setId, name: data?.name || null, cards: (data?.cards || []).length };
  } catch (error) {
    return { setId, cards: null, error: error.message };
  }
}

const args = process.argv.slice(2);
const jsonFlagIndex = args.indexOf('--json');
const outputPath = jsonFlagIndex >= 0 ? args[jsonFlagIndex + 1] : null;
const setIds = args.filter((arg, index) => !arg.startsWith('--') && index !== jsonFlagIndex + 1);

const results = [];
for (const setId of setIds) {
  const result = await probeSet(setId);
  results.push(result);
  const marker = result.cards > 0 ? 'has cards' : 'NO cards';
  console.log(`  ${String(result.setId).padEnd(8)} ${String(result.cards ?? result.error).padStart(6)}  ${marker}  ${result.name || ''}`);
  await delay(REQUEST_DELAY_MS);
}
const withCards = results.filter((result) => result.cards > 0).length;
console.log(`\n${withCards}/${results.length} sets have JA cards`);
if (outputPath) {
  await writeFile(resolve(PROJECT_ROOT, outputPath), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`Saved to ${outputPath}`);
}
