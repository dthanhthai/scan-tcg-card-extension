import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEraConfig } from './era-config.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function getEraPaths(eraId) {
  getEraConfig(eraId);
  const dataDirectory = resolve(PROJECT_ROOT, `data/bulbapedia/${eraId}`);
  return {
    indexPath: resolve(dataDirectory, 'counterpart-index.json'),
    decisionsPath: resolve(dataDirectory, 'review-decisions.json'),
    outputPath: resolve(dataDirectory, 'counterpart-index.js'),
    globalName: `BULBAPEDIA_${eraId.toUpperCase()}_INDEX`,
  };
}

// The runtime bundle drops provenance so the index stays small; the full
// records with evidence remain in counterpart-index.json for review. cardKind
// is dropped too: nothing in utils/, lib/, scanner/, popup/, settings/,
// background/ or content-scripts/ reads it, and it costs about 0.8 MB across
// the eras.
function compactRecordSide(side) {
  return {
    language: side.language,
    setCode: side.setCode,
    tcgdexSetId: side.tcgdexSetId,
    setName: side.setName,
    cardNumber: side.cardNumber,
    localId: side.localId,
    rarity: side.rarity,
    cardName: side.cardName,
    japaneseName: side.japaneseName,
    hp: side.hp,
    // Kept because the runtime needs it to build a name-based CardRush keyword
    // for deck printings. Only set when true, so the bundle stays lean.
    ...(side.printsNoSetCode ? { printsNoSetCode: true } : {}),
  };
}

// The enToJa section feeds marketplace keywords, so it drops the
// validation-only fields. tcgdexSetId is kept on the source side though: that is
// the scanned EN card, and `getIndexedSourceCorrection` retries the source fetch
// with the indexed set when the printed code was misread. Targets never have one
// (that is what makes the record marketplace-only), so only the source grows.
function pickSide(side) {
  return {
    language: side.language,
    setCode: side.setCode,
    setName: side.setName,
    cardNumber: side.cardNumber,
    localId: side.localId,
    rarity: side.rarity,
    cardName: side.cardName,
    japaneseName: side.japaneseName,
    ...(side.tcgdexSetId ? { tcgdexSetId: side.tcgdexSetId } : {}),
    ...(side.printsNoSetCode ? { printsNoSetCode: true } : {}),
  };
}

async function bundleEra(eraId) {
  const paths = getEraPaths(eraId);
  const index = JSON.parse(await readFile(paths.indexPath, 'utf8'));
  const decisions = JSON.parse(await readFile(paths.decisionsPath, 'utf8'));
  if (decisions.status !== 'approved-for-phase-4') {
    console.error(`Refusing to bundle: review-decisions.json status is "${decisions.status}", expected "approved-for-phase-4".`);
    process.exit(1);
  }
  const recordCount = Object.keys(index.records || {}).length;
  if (recordCount === 0) {
    console.error('Refusing to bundle: index has no records.');
    process.exit(1);
  }
  const enToJa = Object.fromEntries(
    Object.entries(index.enToJa || {}).map(([sourceKey, record]) => [sourceKey, {
      source: pickSide(record.source),
      targets: record.targets.map(pickSide),
    }]),
  );
  // Every published record is "structured" (the reports show inferred: 0), so
  // the per-record status is constant and nothing at runtime reads it. Fail
  // loudly instead of dropping a status that would carry information.
  const nonStructured = [...Object.entries(index.records || {}), ...Object.entries(index.enToJa || {})]
    .filter(([, record]) => record.status !== 'structured')
    .map(([sourceKey, record]) => `${sourceKey} (${record.status})`);
  if (nonStructured.length > 0) {
    console.error(`Refusing to bundle: ${nonStructured.length} record(s) are not "structured":`);
    for (const entry of nonStructured.slice(0, 5)) console.error(`  ${entry}`);
    process.exit(1);
  }
  const records = Object.fromEntries(
    Object.entries(index.records || {}).map(([sourceKey, record]) => [sourceKey, {
      source: compactRecordSide(record.source),
      targets: record.targets.map(compactRecordSide),
    }]),
  );
  const runtimeIndex = { schemaVersion: index.schemaVersion, releaseStatus: index.releaseStatus, records, enToJa };
  const source = `const ${paths.globalName} = ${JSON.stringify(runtimeIndex)};\n`;
  await writeFile(paths.outputPath, source, 'utf8');
  console.log(`Bundled ${recordCount} records + ${Object.keys(enToJa).length} enToJa records as ${paths.globalName} at ${paths.outputPath}`);
  return runtimeIndex;
}

export { bundleEra };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bundleEra(process.argv[2] || 'bw').catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
