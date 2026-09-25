import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Prints one sample card pair per set relationship so the user can compare
// artwork during the review gate. Includes the Bulbapedia page that shows
// both printings and the TCGdex art URL for the EN side.
//
// Usage: node scripts/bulbapedia/print-gold-pairs.mjs <era> [--new]
//   --new  only the relationships that are not in review-decisions.json yet,
//          which is what a re-review after a regeneration needs to look at.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ONLY_NEW = process.argv.includes('--new');

function createWikiUrl(pageTitle) {
  return `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
}

// The evidence page is the card's hub page (where both printings were found),
// which is also the best available link for the JP artwork because TCGdex has
// no JA cards for these eras.
function createWikiSearchUrl(source) {
  const query = `${source.cardName} ${source.setName} ${source.cardNumber}`;
  return `https://bulbapedia.bulbagarden.net/w/index.php?search=${encodeURIComponent(query)}`;
}

// TCGdex art paths depend on the card, not on a rule: the series segment is the
// set's `serie.id` (sv03 and svp are both under `sv`), Japanese ids are
// upper-cased (`ja/SV/SV9/006`), and some Japanese cards have no image at all
// (`MC-057`, a Start Deck 100 card, returns `image: undefined`). So read the
// card's own `image` field and cache it per set id + local id. Bulbapedia pads
// numbers that TCGdex does not (or the other way round, per set), so both forms
// are tried, the same way `fetchCardById` does at runtime.
const imageCache = new Map();

function localIdVariants(localId) {
  const raw = String(localId);
  return [...new Set([raw, String(Number(raw)), raw.padStart(3, '0')])].filter((value) => value && value !== 'NaN');
}

async function fetchCardImage(target) {
  const setId = String(target.tcgdexSetId || '');
  if (!setId || !target.localId) return null;
  const language = target.language === 'ja' ? 'ja' : 'en';
  const cacheKey = `${language}:${setId}:${target.localId}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
  let image = null;
  for (const variant of localIdVariants(target.localId)) {
    try {
      const response = await fetch(`https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(setId)}-${encodeURIComponent(variant)}`);
      if (response.ok) {
        image = (await response.json()).image || null;
        if (image) break;
      }
    } catch (err) {
      image = null;
    }
  }
  imageCache.set(cacheKey, image);
  return image;
}

async function createArtUrl(target) {
  if (!target.tcgdexSetId) return '(no TCGdex set)';
  const image = await fetchCardImage(target);
  return image ? `${image}/high.webp` : `(no TCGdex image for ${target.tcgdexSetId}-${target.localId})`;
}

async function printGoldPairs(eraId) {
  const dataDirectory = resolve(PROJECT_ROOT, `data/bulbapedia/${eraId}`);
  const index = JSON.parse(await readFile(resolve(dataDirectory, 'counterpart-index.json'), 'utf8'));
  const proposals = JSON.parse(await readFile(resolve(dataDirectory, 'gold-pair-proposals.json'), 'utf8'));
  let selectedProposals = proposals.proposals;
  if (ONLY_NEW) {
    const decisions = JSON.parse(await readFile(resolve(dataDirectory, 'review-decisions.json'), 'utf8'));
    const approved = new Set(decisions.goldPairApprovals.approvedRelationships);
    selectedProposals = selectedProposals.filter((proposal) => !approved.has(proposal.relationship));
  }
  const counts = {};
  for (const record of Object.values(index.records)) {
    for (const target of record.targets) {
      const key = `${record.source.setCode}->${target.tcgdexSetId}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  console.log(`==================== ${eraId.toUpperCase()} (${selectedProposals.length} relationships${ONLY_NEW ? ', not yet approved' : ''})`);
  for (let proposalIndex = 0; proposalIndex < selectedProposals.length; proposalIndex += 1) {
    const proposal = selectedProposals[proposalIndex];
    const record = index.records[proposal.source.sourceKey];
    const source = record.source;
    const target = record.targets[0];
    const pageTitle = target.evidence?.[0]?.pageTitle || '';
    console.log(`${proposalIndex + 1}. ${proposal.relationship}  (${counts[proposal.relationship]} cards)`);
    console.log(`   JP: ${source.setCode} ${source.cardNumber}  ${source.setName}  - ${source.cardName} / ${source.japaneseName}  hp ${source.hp ?? '-'}`);
    console.log(`   EN: ${target.setCode} ${target.cardNumber}  ${target.setName} (${target.tcgdexSetId})  - ${target.cardName}  hp ${target.hp ?? '-'}`);
    console.log(`   art EN (exact printing): ${await createArtUrl(target)}`);
    console.log(`   card page: ${createWikiUrl(pageTitle)}`);
    console.log(`   JP search: ${createWikiSearchUrl(source)}`);
  }
}

await printGoldPairs(process.argv[2] || 'bw');
