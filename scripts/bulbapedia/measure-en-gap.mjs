import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardPage, parseWithReport } from './bulbapedia-parser.mjs';
import { SET_CATALOG } from './set-catalog.mjs';

// Measures the coverage gap of an era that crawls Japanese set categories.
//
// Bulbapedia only files a page under a Japanese set category when its JP
// printing is that expansion, so every English card whose JP printing is a deck
// or another product is invisible to the crawl and has no index record. This
// reports, per era, the English categories that would have to be added, and the
// Japanese products those pages print (split into "already in SET_CATALOG.ja"
// and "still to add"), which is the three-part change the SV era went through.
//
// Usage: node scripts/bulbapedia/measure-en-gap.mjs <era> [era ...]

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API_URL = 'https://bulbapedia.bulbagarden.net/w/api.php';
const ALL_ERAS = ['dp', 'bw', 'hgss', 'xy', 'sm', 'swsh', 'sv', 'm'];
const REQUEST_DELAY_MS = 200;
const MAX_ATTEMPTS = 4;

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

// Bulbapedia answers with an HTML error page when it throttles, so a response is
// only usable when it is ok *and* parses as JSON; both failures retry with a
// growing backoff.
async function requestJson(params) {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let lastError = 'unknown';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'PokemonTcgScanner/1.0 gap probe' } });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await wait(1000 * (attempt + 1));
  }
  throw new Error(`Bulbapedia request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

async function collectCategoryMembers(categoryTitle) {
  const members = [];
  let continuation = null;
  do {
    const data = await requestJson({
      action: 'query', list: 'categorymembers', cmtitle: categoryTitle, cmnamespace: '0',
      cmlimit: 'max', format: 'json', formatversion: '2',
      ...(continuation ? { cmcontinue: continuation } : {}),
    });
    members.push(...(data.query?.categorymembers || []).map((member) => member.title));
    continuation = data.continue?.cmcontinue || null;
    await wait(REQUEST_DELAY_MS);
  } while (continuation);
  return members;
}

function loadBundledIndex(era) {
  const source = readFileSync(resolve(PROJECT_ROOT, 'data/bulbapedia', era, 'counterpart-index.js'), 'utf8');
  return JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
}

async function collectCrawledPages(era) {
  const manifest = JSON.parse(await readFile(resolve(PROJECT_ROOT, '.cache/bulbapedia', era, 'crawl-manifest.json'), 'utf8'));
  const pages = new Set();
  for (const batch of manifest.batches) {
    const response = JSON.parse(await readFile(resolve(PROJECT_ROOT, '.cache/bulbapedia', era, 'pages', batch.fileName), 'utf8'));
    for (const page of response.query?.pages || []) pages.add(page.title);
  }
  return pages;
}

// Which era owns an English set: the one with the most records mentioning it. A
// set is otherwise measured against the wrong crawl (an SV promo reprinted in an
// M set makes the whole M set look "missing" from the SV crawl).
function buildEraOwnership() {
  const ownership = new Map();
  for (const era of ALL_ERAS) {
    let index;
    try {
      index = loadBundledIndex(era);
    } catch (error) {
      continue;
    }
    const counts = new Map();
    const bump = (name) => counts.set(name, (counts.get(name) || 0) + 1);
    for (const record of Object.values(index.records)) {
      if (record.source.language === 'en' && record.source.setName) bump(record.source.setName);
      for (const target of record.targets) if (target.language === 'en' && target.setName) bump(target.setName);
    }
    for (const record of Object.values(index.enToJa)) if (record.source.setName) bump(record.source.setName);
    for (const [name, count] of counts) {
      const current = ownership.get(name);
      if (!current || count > current.count) ownership.set(name, { era, count });
    }
  }
  return ownership;
}

async function measureEra(era, ownership) {
  const crawled = await collectCrawledPages(era);
  const englishSets = [...ownership.entries()].filter(([, value]) => value.era === era).map(([name]) => name).sort();
  const missing = [];
  for (const setName of englishSets) {
    for (const title of await collectCategoryMembers(`Category:${setName} cards`)) {
      if (!crawled.has(title)) missing.push({ title, setName });
    }
  }
  const products = new Map();
  const perSet = new Map();
  for (let index = 0; index < missing.length; index += 20) {
    const batch = missing.slice(index, index + 20);
    const data = await requestJson({
      action: 'query', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main',
      titles: batch.map((entry) => entry.title).join('|'), format: 'json', formatversion: '2',
    });
    const pagesByTitle = new Map((data.query?.pages || []).map((page) => [page.title, page]));
    for (const entry of batch) {
      perSet.set(entry.setName, (perSet.get(entry.setName) || 0) + 1);
      const page = pagesByTitle.get(entry.title);
      if (!page) continue;
      const result = parseWithReport(parseCardPage, { query: { pages: [page] } });
      if (!result.success) continue;
      for (const printing of result.data.printings) {
        if (!printing.ja?.setName) continue;
        const key = printing.ja.setName + (printing.ja.cardNumber ? '' : ' [no number]');
        products.set(key, (products.get(key) || 0) + 1);
      }
    }
    await wait(REQUEST_DELAY_MS);
  }
  const toAdd = [...products.entries()].filter(([name]) => !SET_CATALOG.ja[name.replace(' [no number]', '')]).sort((a, b) => b[1] - a[1]);
  console.log(`\n===== ${era.toUpperCase()}: ${missing.length} English pages missing from the crawl | ${perSet.size} English sets | ${toAdd.length} Japanese products not in SET_CATALOG.ja`);
  console.log('--- English categories to add ---');
  for (const [setName, count] of [...perSet.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(4)}  Category:${setName} cards`);
  }
  console.log('--- Japanese products to add (3+ occurrences) ---');
  for (const [name, count] of toAdd.filter(([, count]) => count >= 3)) {
    console.log(`   ${String(count).padStart(4)}  ${name}`);
  }
  const small = toAdd.filter(([, count]) => count < 3);
  console.log(`   (plus ${small.length} products with 1-2 occurrences, ${small.reduce((total, [, count]) => total + count, 0)} printings)`);
}

const eras = process.argv.slice(2).filter((value) => ALL_ERAS.includes(value));
if (eras.length === 0) {
  console.error(`Usage: node scripts/bulbapedia/measure-en-gap.mjs <era> [era ...]\nKnown eras: ${ALL_ERAS.join(', ')}`);
  process.exit(1);
}
const ownership = buildEraOwnership();
for (const era of eras) await measureEra(era, ownership);
