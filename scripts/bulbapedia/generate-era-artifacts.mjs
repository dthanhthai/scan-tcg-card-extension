import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBulbapediaArtifacts } from './bulbapedia-generator.mjs';
import { parseCardPage, parseWithReport } from './bulbapedia-parser.mjs';
import {
  createGoldPairProposals,
  createSetRelationshipAudit,
  filterSourcesBySetNames,
} from './bw-artifacts.mjs';
import { getEraConfig } from './era-config.mjs';
import { TCGDEX_JA_SET_FIXTURE, TCGDEX_SET_FIXTURE } from './fixture-config.mjs';
import { extractRuntimeSetMap } from './runtime-set-map.mjs';
import { SET_CATALOG } from './set-catalog.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TCGDEX_FIXTURE_PATH = resolve(PROJECT_ROOT, 'tests/fixtures/tcgdex', TCGDEX_SET_FIXTURE.fileName);
const TCGDEX_JA_FIXTURE_PATH = resolve(PROJECT_ROOT, 'tests/fixtures/tcgdex', TCGDEX_JA_SET_FIXTURE.fileName);
const RUNTIME_SET_MAP_PATH = resolve(PROJECT_ROOT, 'lib/tcgdex-client.js');
const OUTPUT_FILES = {
  index: 'counterpart-index.json',
  manifest: 'source-manifest.json',
  report: 'generation-report.json',
  relationshipAudit: 'set-relationship-audit.json',
  goldPairProposals: 'gold-pair-proposals.json',
};

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadCachedSources(cacheDirectory, crawlManifest) {
  const sources = [];
  for (const batch of crawlManifest.batches) {
    const response = await readJson(resolve(cacheDirectory, 'pages', batch.fileName));
    for (const page of response.query?.pages || []) {
      sources.push({
        fileName: `${batch.fileName}#${page.pageid}`,
        kind: 'card',
        result: parseWithReport(parseCardPage, { query: { pages: [page] } }),
      });
    }
  }
  return sources.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function selectEraRuntimeMap(runtimeSetMap, jpSetCodes) {
  const eraSetCodes = new Set(jpSetCodes);
  return Object.fromEntries(Object.entries(runtimeSetMap).filter(([setCode]) => eraSetCodes.has(setCode)));
}

async function writeArtifact(outputDirectory, fileName, artifact) {
  const outputPath = resolve(outputDirectory, fileName);
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return outputPath;
}

// Turns the cached era pages into reviewable artifacts: the runtime index, a
// provenance manifest, the quality report, a runtime-map audit, and gold-pair
// proposals for the user review gate.
async function generateEraArtifacts(eraId) {
  const config = getEraConfig(eraId);
  const cacheDirectory = resolve(PROJECT_ROOT, `.cache/bulbapedia/${eraId}`);
  const outputDirectory = resolve(PROJECT_ROOT, `data/bulbapedia/${eraId}`);
  const crawlManifest = await readJson(resolve(cacheDirectory, 'crawl-manifest.json'));
  const cachedSources = await loadCachedSources(cacheDirectory, crawlManifest);
  // A printing is kept only when its Japanese set name is listed here. Deck
  // products reached through the English categories have no category entry of
  // their own, so an era can list their names explicitly (see `extraSetNames`
  // in era-config.mjs).
  const eraSetNames = new Set([
    ...config.setCategories.map((category) => category.setName),
    ...(config.extraSetNames || []),
  ]);
  const sources = filterSourcesBySetNames(cachedSources, eraSetNames);
  const tcgdexSets = await readJson(TCGDEX_FIXTURE_PATH);
  const tcgdexJaSets = await readJson(TCGDEX_JA_FIXTURE_PATH);
  const validTcgdexSetIds = new Set([...tcgdexSets, ...tcgdexJaSets].map((set) => set.id));
  const exclusionsPath = resolve(outputDirectory, 'exclusions.json');
  let excludedSourceKeys = new Set();
  try {
    const exclusions = JSON.parse(await readFile(exclusionsPath, 'utf8'));
    excludedSourceKeys = new Set((exclusions.sourceKeys || []).map((entry) => entry.sourceKey));
    console.log(`Excluding ${excludedSourceKeys.size} source key(s) from ${exclusionsPath}`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const artifacts = createBulbapediaArtifacts({ sources, setCatalog: SET_CATALOG, validTcgdexSetIds, excludedSourceKeys });
  const runtimeSetMapSource = await readFile(RUNTIME_SET_MAP_PATH, 'utf8');
  const runtimeSetMap = selectEraRuntimeMap(
    extractRuntimeSetMap(runtimeSetMapSource),
    config.setCategories.map((category) => category.jpSetCode),
  );
  const relationshipAudit = createSetRelationshipAudit(artifacts.index, runtimeSetMap);
  const proposals = createGoldPairProposals(artifacts.index);
  const index = {
    schemaVersion: artifacts.index.schemaVersion,
    releaseStatus: 'pending-user-review',
    records: artifacts.index.records,
    enToJa: artifacts.index.enToJa,
  };
  const report = {
    ...artifacts.report,
    crawl: {
      categoryMemberships: crawlManifest.categoryMemberships,
      uniquePages: crawlManifest.uniquePages,
      batchCount: crawlManifest.batches.length,
    },
    reviewGate: {
      policy: 'hybrid',
      proposalSelection: 'after-audit',
      status: 'pending-user-approval',
      requiredRelationshipApprovals: proposals.length,
      conflictCount: artifacts.report.conflicts.length,
      ambiguousRecordCount: artifacts.report.ambiguousRecords.length,
    },
  };
  const goldPairProposals = {
    schemaVersion: 1,
    reviewPolicy: 'hybrid',
    selectionPolicy: 'after-audit',
    approvalStatus: 'pending-user-review',
    proposals,
  };
  await mkdir(outputDirectory, { recursive: true });
  const outputArtifacts = { index, manifest: artifacts.manifest, report, relationshipAudit, goldPairProposals };
  for (const [artifactName, fileName] of Object.entries(OUTPUT_FILES)) {
    const outputPath = await writeArtifact(outputDirectory, fileName, outputArtifacts[artifactName]);
    console.log(`Generated ${artifactName} at ${outputPath}`);
  }
  return { index, report, relationshipAudit, goldPairProposals };
}

export { generateEraArtifacts };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateEraArtifacts(process.argv[2] || 'bw').catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
