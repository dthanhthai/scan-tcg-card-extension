import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBulbapediaArtifacts } from './bulbapedia-generator.mjs';
import {
  parseCardPage,
  parseRedirectPage,
  parseSetPage,
  parseWithReport,
} from './bulbapedia-parser.mjs';
import { BULBAPEDIA_PAGE_FIXTURES, TCGDEX_SET_FIXTURE } from './fixture-config.mjs';
import { SET_CATALOG } from './set-catalog.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BULBAPEDIA_FIXTURE_DIRECTORY = resolve(PROJECT_ROOT, 'tests/fixtures/bulbapedia');
const TCGDEX_FIXTURE_DIRECTORY = resolve(PROJECT_ROOT, 'tests/fixtures/tcgdex');
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'data/bulbapedia');
const PAGE_PARSERS = {
  card: parseCardPage,
  redirect: parseRedirectPage,
  set: parseSetPage,
};
const OUTPUT_FILES = {
  index: 'counterpart-index.json',
  manifest: 'source-manifest.json',
  report: 'generation-report.json',
};

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadSource(fixture) {
  const filePath = resolve(BULBAPEDIA_FIXTURE_DIRECTORY, fixture.fileName);
  const apiResponse = await readJson(filePath);
  return {
    fileName: fixture.fileName,
    kind: fixture.kind,
    result: parseWithReport(PAGE_PARSERS[fixture.kind], apiResponse),
  };
}

async function writeArtifact(fileName, artifact) {
  const outputPath = resolve(OUTPUT_DIRECTORY, fileName);
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return outputPath;
}

const sources = await Promise.all(BULBAPEDIA_PAGE_FIXTURES.map(loadSource));
const tcgdexSets = await readJson(resolve(TCGDEX_FIXTURE_DIRECTORY, TCGDEX_SET_FIXTURE.fileName));
const validTcgdexSetIds = new Set(tcgdexSets.map((set) => set.id));
const artifacts = createBulbapediaArtifacts({ sources, setCatalog: SET_CATALOG, validTcgdexSetIds });
await mkdir(OUTPUT_DIRECTORY, { recursive: true });
for (const [artifactName, fileName] of Object.entries(OUTPUT_FILES)) {
  const outputPath = await writeArtifact(fileName, artifacts[artifactName]);
  console.log(`Generated ${artifactName} at ${outputPath}`);
}
