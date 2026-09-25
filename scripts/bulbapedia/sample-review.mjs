import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ERA_ID = process.argv[2] || 'bw';
// --all validates every record instead of a couple of samples per
// relationship, so the review gate can rely on a measured mismatch rate
// rather than a long manual checklist.
const VALIDATE_ALL = process.argv.includes('--all');
const DATA_DIRECTORY = resolve(PROJECT_ROOT, `data/bulbapedia/${ERA_ID}`);
const TCGDEX_API_URL = 'https://api.tcgdex.net/v2';
const SAMPLES_PER_RELATIONSHIP = 2;
const RANDOM_SEED = 20260301;
const REQUEST_DELAY_MS = 100;
// A full pass makes thousands of calls to a free API, so a single slow response
// must not end the run: each request gets its own timeout and retries, and a
// failure becomes a flag instead of an uncaught exception.
const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_RETRIES = 2;

function createSeededRandom(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Mirrors the runtime resolver's name handling: NFKC folds full-width forms
// (Bulbapedia prints "Ｎのゾロア" where TCGdex prints "Nのゾロア"), and keeping
// letters from every script lets Japanese names compare instead of collapsing
// to an empty string on one side only.
function normalizeCardName(name) {
  return (name || '')
    .normalize('NFKC')
    .toLowerCase()
    // TCGdex disambiguates same-named cards with a trailing parenthesis
    // ("博士の研究（オーリム博士）" for Professor's Research, "ボスの指令（ゲーチス）"
    // for Boss's Orders) while Bulbapedia keeps the shared name. NFKC has already
    // folded the full-width brackets by this point.
    .replace(/[([][^)\]]*[)\]]\s*$/, '')
    .replace(/[-\s]?(ex|gx|v|vmax|vstar)$/u, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function fetchTcgdexCard(language, setId, localId) {
  // Bulbapedia pads numbers for some eras ("036/202") while TCGdex does not,
  // so try both forms before reporting an error.
  const rawLocalId = String(localId).split('/')[0];
  const variants = [...new Set([rawLocalId, String(Number(rawLocalId)), rawLocalId.padStart(3, '0')])]
    .filter((value) => value && value !== 'NaN');
  for (const variant of variants) {
    for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
      try {
        const response = await fetch(`${TCGDEX_API_URL}/${language}/cards/${setId}-${encodeURIComponent(variant)}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) return response.json();
        if (response.status === 404) break;
        if (attempt === REQUEST_RETRIES) return { error: `HTTP ${response.status}` };
      } catch (error) {
        if (attempt === REQUEST_RETRIES) {
          return { error: `fetch-failed:${error.cause?.code || error.name}` };
        }
      }
      await delay(500);
    }
  }
  // A 404 after every variant is usually a number the set really does not have,
  // but TCGdex also answers 404 during short outages: one full pass collected
  // 262 such flags that all disappeared on a re-run. Wait, then ask once more
  // before reporting a flag that would send someone chasing a phantom row.
  await delay(2000);
  try {
    const response = await fetch(`${TCGDEX_API_URL}/${language}/cards/${setId}-${encodeURIComponent(variants[0])}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return response.json();
  } catch {
    // fall through to the 404 below
  }
  return { error: 'HTTP 404' };
}

async function main() {
  const index = JSON.parse(await readFile(resolve(DATA_DIRECTORY, 'counterpart-index.json'), 'utf8'));
  const proposalsFile = JSON.parse(await readFile(resolve(DATA_DIRECTORY, 'gold-pair-proposals.json'), 'utf8'));
  const approvedSourceKeys = new Set(proposalsFile.proposals.map((proposal) => proposal.source.sourceKey));
  const recordsByRelationship = new Map();
  for (const [sourceKey, record] of Object.entries(index.records)) {
    for (const target of record.targets) {
      const relationship = `${record.source.setCode}->${target.tcgdexSetId}`;
      const records = recordsByRelationship.get(relationship) || [];
      records.push({ sourceKey, record, target });
      recordsByRelationship.set(relationship, records);
    }
  }
  const random = createSeededRandom(RANDOM_SEED);
  const results = [];
  // `--json <path>` also drives a .jsonl next to it and the progress log, so a
  // long pass can be watched and its results kept even if the run is interrupted.
  const jsonIndex = process.argv.indexOf('--json');
  const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : null;
  const progressPath = jsonPath ? `${jsonPath}.jsonl` : null;
  // Optional `--relationship <jpSetCode->enSetId>` limits the run to one
  // relationship, which is how a cluster of wrong rows gets checked end to end.
  const relationshipIndex = process.argv.indexOf('--relationship');
  const relationshipFilter = relationshipIndex >= 0 ? process.argv[relationshipIndex + 1] : null;
  const selectedRelationships = [...recordsByRelationship.entries()]
    .filter(([relationship]) => !relationshipFilter || relationship === relationshipFilter)
    .sort();
  if (relationshipFilter && selectedRelationships.length === 0) {
    console.error(`No relationship matches "${relationshipFilter}".`);
    process.exit(1);
  }
  for (const [relationship, records] of selectedRelationships) {
    const unapproved = records.filter((entry) => !approvedSourceKeys.has(entry.sourceKey));
    const pool = unapproved.length > 0 ? unapproved : records;
    const shuffled = [...pool].sort(() => random() - 0.5);
    const samples = VALIDATE_ALL ? shuffled : shuffled.slice(0, SAMPLES_PER_RELATIONSHIP);
    for (const sample of samples) {
      const tcgCard = await fetchTcgdexCard(sample.target.language || 'en', sample.target.tcgdexSetId, String(sample.target.localId).split('/')[0]);
      await delay(REQUEST_DELAY_MS);
      const checks = [];
      if (tcgCard.error) {
        checks.push(`tcgdex-error:${tcgCard.error}`);
      } else {
        // JA targets carry the English name in cardName and the Japanese name in
        // japaneseName, so compare the name that matches the target language.
        const expectedName = (sample.target.language === 'ja' ? sample.target.japaneseName : sample.target.cardName)
          || sample.target.cardName;
        const namesMatch = normalizeCardName(tcgCard.name) === normalizeCardName(expectedName);
        if (!namesMatch) checks.push(`name-mismatch:${tcgCard.name}`);
        if (sample.target.hp != null && tcgCard.hp != null && tcgCard.hp !== sample.target.hp) {
          checks.push(`hp-mismatch:${tcgCard.hp}`);
        }
      }
      results.push({
        relationship,
        sourceKey: sample.sourceKey,
        jp: `${sample.record.source.setName} ${sample.record.source.cardNumber} ${sample.record.source.cardName} (${sample.record.source.japaneseName}) hp:${sample.record.source.hp} ${sample.record.source.rarity}`,
        en: `${sample.target.setName} ${sample.target.cardNumber} ${sample.target.cardName} hp:${sample.target.hp} ${sample.target.rarity}`,
        tcgdex: tcgCard.error ? tcgCard.error : `${tcgCard.id} ${tcgCard.name} hp:${tcgCard.hp} ${tcgCard.rarity}`,
        checks,
      });
      if (progressPath && results.length % 10 === 0) {
        await appendFile(progressPath, `${results.slice(-10).map((entry) => JSON.stringify(entry)).join('\n')}\n`);
      }
      if (results.length % 250 === 0) {
        const flaggedSoFar = results.filter((entry) => entry.checks.length > 0).length;
        console.log(`[review] ${results.length} checked, ${flaggedSoFar} flagged`);
      }
    }
  }
  const flagged = results.filter((result) => result.checks.length > 0);
  for (const result of (VALIDATE_ALL ? flagged.slice(0, 40) : results)) {
    const status = result.checks.length === 0 ? 'OK ' : 'FLAG';
    console.log(`${status} ${result.relationship} | ${result.sourceKey}`);
    console.log(`     JP: ${result.jp}`);
    console.log(`     EN: ${result.en}`);
    console.log(`     TCGdex: ${result.tcgdex}${result.checks.length ? ` | ${result.checks.join(', ')}` : ''}`);
  }
  const rate = results.length ? ((flagged.length / results.length) * 100).toFixed(2) : '0.00';
  console.log(`\nSeed: ${RANDOM_SEED} | Mode: ${VALIDATE_ALL ? 'all' : 'sample'} | Checked: ${results.length} | Flagged: ${flagged.length} (${rate}%)`);
  if (VALIDATE_ALL && flagged.length > 40) console.log(`(only the first 40 flags are printed)`);
  // The JSON keeps every result, not just the printed first 40 flags, so a full
  // pass can be triaged without running it again.
  if (jsonPath) {
    const payload = {
      era: ERA_ID,
      mode: VALIDATE_ALL ? 'all' : 'sample',
      seed: RANDOM_SEED,
      checked: results.length,
      flagged: flagged.length,
      rate: Number(rate),
      results,
    };
    await writeFile(jsonPath, `${JSON.stringify(payload, null, 1)}\n`);
    console.log(`Wrote ${jsonPath}`);
  }
}

await main();
