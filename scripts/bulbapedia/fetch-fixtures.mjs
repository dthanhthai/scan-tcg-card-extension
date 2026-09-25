import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BULBAPEDIA_API_URL,
  BULBAPEDIA_PAGE_FIXTURES,
  EXTRA_PAGE_FIXTURES,
  TCGDEX_JA_SET_FIXTURE,
  TCGDEX_SET_FIXTURE,
} from './fixture-config.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BULBAPEDIA_FIXTURE_DIRECTORY = resolve(PROJECT_ROOT, 'tests/fixtures/bulbapedia');
const TCGDEX_FIXTURE_DIRECTORY = resolve(PROJECT_ROOT, 'tests/fixtures/tcgdex');

function buildPageUrl(pageTitle) {
  const pageUrl = new URL(BULBAPEDIA_API_URL);
  pageUrl.searchParams.set('action', 'query');
  pageUrl.searchParams.set('prop', 'revisions');
  pageUrl.searchParams.set('rvprop', 'ids|timestamp|content');
  pageUrl.searchParams.set('rvslots', 'main');
  pageUrl.searchParams.set('titles', pageTitle);
  pageUrl.searchParams.set('format', 'json');
  pageUrl.searchParams.set('formatversion', '2');
  return pageUrl;
}

async function fetchJson(url, requestName, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${requestName} request failed: ${response.status}`);
  const responseData = await response.json();
  if (responseData.error) throw new Error(`${requestName} API error: ${responseData.error.info}`);
  return responseData;
}

async function writeJsonFixture(directory, fileName, responseData) {
  const outputPath = resolve(directory, fileName);
  await writeFile(outputPath, `${JSON.stringify(responseData, null, 2)}\n`, 'utf8');
  return outputPath;
}

await Promise.all([
  mkdir(BULBAPEDIA_FIXTURE_DIRECTORY, { recursive: true }),
  mkdir(TCGDEX_FIXTURE_DIRECTORY, { recursive: true }),
]);
for (const pageFixture of [...BULBAPEDIA_PAGE_FIXTURES, ...EXTRA_PAGE_FIXTURES]) {
  const responseData = await fetchJson(buildPageUrl(pageFixture.pageTitle), pageFixture.pageTitle, {
    'User-Agent': 'PokemonTcgScanner/1.0 Bulbapedia fixture generator',
  });
  const outputPath = await writeJsonFixture(BULBAPEDIA_FIXTURE_DIRECTORY, pageFixture.fileName, responseData);
  console.log(`Saved ${pageFixture.pageTitle} to ${outputPath}`);
}
const tcgdexSets = await fetchJson(TCGDEX_SET_FIXTURE.url, 'TCGdex EN sets');
const tcgdexOutputPath = await writeJsonFixture(TCGDEX_FIXTURE_DIRECTORY, TCGDEX_SET_FIXTURE.fileName, tcgdexSets);
console.log(`Saved TCGdex EN sets to ${tcgdexOutputPath}`);
const tcgdexJaSets = await fetchJson(TCGDEX_JA_SET_FIXTURE.url, 'TCGdex JA sets');
const tcgdexJaOutputPath = await writeJsonFixture(TCGDEX_FIXTURE_DIRECTORY, TCGDEX_JA_SET_FIXTURE.fileName, tcgdexJaSets);
console.log(`Saved TCGdex JA sets to ${tcgdexJaOutputPath}`);
