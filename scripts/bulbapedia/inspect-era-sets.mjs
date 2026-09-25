import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardPage, parseWithReport } from './bulbapedia-parser.mjs';

// Reports the distinct JA and EN set names found in a crawled era cache.
// Used to build SET_CATALOG entries from real page data instead of guesses.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function inspectEraSets(eraId) {
  const manifest = JSON.parse(await readFile(resolve(PROJECT_ROOT, `.cache/bulbapedia/${eraId}/crawl-manifest.json`), 'utf8'));
  const ja = new Map();
  const en = new Map();
  const failed = new Map();
  for (const batch of manifest.batches) {
    const response = JSON.parse(await readFile(resolve(PROJECT_ROOT, `.cache/bulbapedia/${eraId}/pages`, batch.fileName), 'utf8'));
    for (const page of response.query?.pages || []) {
      const result = parseWithReport(parseCardPage, { query: { pages: [page] } });
      if (!result.success) {
        failed.set(result.error, (failed.get(result.error) || 0) + 1);
        continue;
      }
      for (const printing of result.data.printings) {
        if (printing.ja?.setName) ja.set(printing.ja.setName, (ja.get(printing.ja.setName) || 0) + 1);
        if (printing.en?.setName) en.set(printing.en.setName, (en.get(printing.en.setName) || 0) + 1);
      }
    }
  }
  console.log('=== JA set names');
  for (const [name, count] of [...ja.entries()].sort()) console.log(`  ${count}\t${name}`);
  console.log('=== EN set names');
  for (const [name, count] of [...en.entries()].sort()) console.log(`  ${count}\t${name}`);
  if (failed.size > 0) {
    console.log('=== parse failures');
    for (const [error, count] of failed) console.log(`  ${count}\t${error}`);
  }
}

await inspectEraSets(process.argv[2] || 'bw');
