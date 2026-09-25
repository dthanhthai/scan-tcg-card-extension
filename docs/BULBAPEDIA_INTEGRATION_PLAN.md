# Bulbapedia Integration Plan

## 1. Goal

Integrate Bulbapedia data to improve the accuracy of Japanese-to-English and English-to-Japanese Pokémon TCG counterpart matching, especially for eras or products with incomplete TCGdex coverage.

The primary objective is higher **precision** without reducing the stability of the current pipeline. When Bulbapedia evidence is insufficient, the app must keep the existing TCGdex/Gemini fallback rather than select a risky candidate.

## 2. Design Principles

1. Do not call Bulbapedia during each scan in the initial phases.
2. Use the MediaWiki API during development to generate a static index bundled with the extension.
3. Keep TCGdex as the primary runtime metadata source.
4. Use Bulbapedia to supplement set relationships, card numbers, printings, reprints, and bilingual names missing from TCGdex.
5. Do not assume all community-maintained data is correct; every record must include provenance and verification status.
6. Prefer skipping an uncertain candidate over returning the wrong card.
7. Do not replace the entire pipeline at once. Every phase must include tests, a review gate, and a rollback path.
8. A card may have multiple counterparts or reprints; the schema must not force every relationship to be one-to-one.
9. Do not add Bulbapedia to `host_permissions` when the extension only uses a static index.
10. Every runtime change must work in both Chrome and Safari.

## 3. Scope

### 3.1. Included

- JP set ↔ EN set relationships.
- Exact JP set/card number ↔ EN set/card number relationships.
- JP and EN rarity for each printing.
- EN names, JP names, and aliases required for search.
- Regular, Full Art, Secret, Promo, deck-only, and reprint relationships.
- Provenance containing page title, page ID, revision ID, and derivation method.
- Reports for valid, conflicting, incomplete, and review-required records.
- An exact-match fast path before the existing fallbacks.

### 3.2. Initially Excluded

- Replacing TCGdex with Bulbapedia.
- Parsing Bulbapedia directly in the browser extension runtime.
- Bundling or hotlinking all Bulbapedia images.
- Automatically accepting mappings inferred only from prose.
- Image similarity or perceptual hashing in the initial phases.
- Expanding every era in a single release.

## 4. Target Architecture

```text
Bulbapedia MediaWiki API
        |
        | development-time fetch
        v
Raw response cache / test fixtures
        |
        | parser + normalizer + validator
        v
Generated source manifest + review report
        |
        | publish only records that pass quality gates
        v
Compact static counterpart index
        |
        | bundled with shared extension source
        v
Recognition result: language + setCode + cardNumber + rarity
        |
        +-- exact local counterpart found
        |       |
        |       v
        |   TCGdex direct fetch + validation
        |
        +-- exact local counterpart missing/rejected
                |
                v
        Existing Gemini/TCGdex search and fallback paths
```

The static index does not depend on Chrome APIs, so Chrome and Safari can share it. Bulbapedia only participates in data generation and updates; it is not on the critical path of a scan.

## 5. Proposed MediaWiki Data Sources

| API operation | Purpose |
|---|---|
| `action=parse&prop=wikitext` | Read infoboxes, expansion templates, card lists, and release information |
| `action=parse&prop=categories` | Confirm set, promo, rarity, and printing categories |
| `action=query&generator=categorymembers` | Enumerate card pages belonging to a set |
| `action=query&prop=revisions` | Store revision IDs for traceability and incremental updates |
| Redirect resolution | Normalize pages such as EX Battle Boost → Legendary Treasures |
| Interlanguage links | Obtain corresponding JP page names when available |
| `prop=images`/`imageinfo` | Support an optional future artwork phase |

The parser must not depend on prose when the same information is available in a structured template. Prose may only create an `inferred` record and must never enable exact direct lookup.

## 6. Proposed Data Schema

### 6.1. Counterpart Record

```json
{
  "source": {
    "language": "ja",
    "setCode": "BW4",
    "setName": "Dark Rush",
    "cardNumber": "044/069",
    "rarity": "R"
  },
  "targets": [
    {
      "language": "en",
      "tcgdexSetId": "bw5",
      "setName": "Dark Explorers",
      "cardNumber": "63/108",
      "localId": "63",
      "rarity": "Rare Holo ex",
      "printing": "regular"
    }
  ],
  "evidence": {
    "pageTitle": "Darkrai-EX (Dark Explorers 63)",
    "pageId": 0,
    "revisionId": 0,
    "derivation": "paired-expansion-template"
  },
  "status": "structured"
}
```

The example uses placeholder `pageId` and `revisionId` values. The generator must store the real API values.

### 6.2. Confidence Status

| Status | Meaning | Runtime policy |
|---|---|---|
| `reviewed` | Confirmed from a card pair or manual review | Eligible for exact lookup |
| `structured` | Parsed from one structured expansion template and passed every invariant | Eligible only after the pilot quality gate passes |
| `inferred` | Derived from set relationships, prose, or card rosters | Candidate hint or report only |
| `conflict` | Sources or templates produce conflicting results | Never used at runtime |
| `incomplete` | Missing a set, number, or target TCGdex ID | Never used at runtime |

### 6.3. Key and Normalization

Primary lookup key:

```text
{language}:{normalizedSetCode}:{normalizedFullCardNumber}
```

Rarity should not be part of the primary key because a full card number usually identifies the printing, but rarity must be stored for validation. If one key has multiple targets, the resolver must return an array instead of silently overwriting a record.

Minimum normalization rules:

- Preserve leading zeroes in full card numbers.
- Derive a separate `localId` for TCGdex lookup.
- Match set codes case-insensitively while preserving original values for display.
- Do not merge different-artwork rarities only because they belong to the same rarity tier.
- Do not merge promo numbers with main-set numbers.

## 7. Implementation Phases

### Phase 0 — Baseline and Gold Dataset

#### Goal

Measure the current pipeline before integration and create a gold dataset for regression detection.

#### Work

- Document the current direct lookup, main name search, set scan fallback, and dexId fallback flows.
- Collect JP/EN pairs previously confirmed by the user.
- Add representative cases for:
  - Regular Pokémon cards.
  - Full Art and Secret cards.
  - The same Pokémon and HP with different artwork.
  - Trainer cards without dexId or HP.
  - Promo cards.
  - Reprints.
  - One source card with multiple EN printings.
- Audit existing BW mappings and classify bulk set-level mappings as `inferred` until card-level evidence exists.
- Record the baseline candidate, search path, card ID, and match or rejection reason.

#### Tests and Verification

- `npm test` must pass before the next phase begins.
- The gold dataset must reproduce current results.
- Every ambiguity class above must have at least one fixture.

#### Exit Gate

- The user approves the gold-case list.
- Production behavior remains unchanged.

### Phase 1 — Development-Time Bulbapedia API Spike

#### Goal

Prove that the required data can be fetched and parsed reliably without integrating it into the app.

#### Work

- Create a minimal MediaWiki fetcher using existing Node capabilities; do not add a dependency unless necessary.
- Fetch a small sample containing:
  - One set page.
  - One regular Pokémon card.
  - One Full Art card.
  - One Trainer card.
  - One card with promo or reprint information.
  - One redirect page.
- Cache responses as test fixtures so tests do not depend on network access.
- Parse required templates rather than rendered HTML.
- Store page title, page ID, and revision ID.
- Fail closed when a template is not recognized.

#### Tests and Verification

- Parser tests run entirely offline from fixtures.
- The Darkrai-EX fixture must extract at least:
  - Dark Rush `044/069` ↔ Dark Explorers `63/108`.
  - Dark Rush `072/069` ↔ Dark Explorers `107/108`.
  - EX Battle Boost `072/093` ↔ Legendary Treasures `88/113`.
- A redirect test must resolve the correct canonical page.
- API errors or unknown templates must produce a report and no production mapping.

#### Exit Gate

- Parser output is manually checked against the source page.
- Runtime lookup and host permissions remain unchanged.

### Phase 2 — Generator, Schema, and Quality Gates

#### Goal

Create a reproducible pipeline from API responses to a static index.

#### Work

- Separate four layers:
  1. Fetch and cache.
  2. Parse raw templates.
  3. Normalize and validate.
  4. Generate a compact index and review report.
- Create a source manifest containing the API endpoint, page IDs, revision IDs, and schema version.
- Generate report counts for:
  - Successfully parsed records.
  - Reviewed records.
  - Ambiguous records.
  - Conflicts.
  - Missing TCGdex targets.
  - Unsupported templates.
- Sort output deterministically so identical input produces an identical diff.
- Never overwrite a source key that has multiple targets.
- Validate that target set IDs exist in the TCGdex EN or JA set list.

#### Required Invariants

- A source must contain language, set, and full card number.
- An exact target must contain target language, target set, and full card number.
- `localId` must be derived consistently from the full card number.
- Source data must retain leading zeroes.
- Every production record must contain provenance.
- `conflict`, `incomplete`, and `inferred` records must not appear in the exact runtime index.
- Regenerating from identical fixtures and revisions must not produce unexpected changes.

#### Exit Gate

- All generator tests pass.
- The generated report is easy to review before data is published.
- Matching behavior remains unchanged.

### Phase 3 — BW Data Pilot

#### Goal

Use BW as the first era because TCGdex JA has no card data for it.

#### Work

- Enumerate card pages for each BW set and subset through categories and set pages.
- Generate card-level relationships for `BW1`–`BW9`, `DS`, `SC`, and `EB`.
- Keep deck-only cards and `BW-P` in the review queue when no exact target exists.
- Compare Bulbapedia set relationships with `JP_TO_EN_SET_MAP`; produce an audit diff without automatically changing the map.
- Put conflicting or multiple-target records in a separate report.
- Classify user-supplied card pairs as `reviewed` gold records.

#### Tests and Verification

- Include a fixture for every structured template form found in BW.
- Require at least one user-confirmed pair for each set relationship before using that relationship in production.
- Check Pokémon, Trainer, Secret/Full Art, Promo, and reprint cases separately.
- Manually review a random sample of `structured` records before enabling the full group.
- Gold-dataset precision must be 100%; uncertain records may miss but must never return the wrong card.

#### Exit Gate

- The user approves the BW report and conflict list.
- Publish only `reviewed` records or `structured` records that passed the quality gate.

### Phase 4 — Safe Exact Local Resolver Integration

#### Goal

Add a Bulbapedia-derived exact lookup without breaking the existing fallbacks.

#### Work

- Create a pure-logic resolver that reads the static counterpart index.
- Run the resolver before Gemini cross-version guesses and broad TCGdex searches.
- When an exact target exists:
  1. Fetch the target directly from TCGdex when available.
  2. Validate available name, dexId, HP, rarity, and printing metadata.
  3. Accept or reject it with an explicit reason.
- When no record exists or validation fails, run the current pipeline unchanged.
- Begin in report-only mode and compare local-resolver and existing-resolver results.
- Enable active mode only after report-only results show no regression.
- Never use `inferred` records for direct lookup.
- Experimental: when paired JP sets share a printed code+card number and the Gemini `setName` cannot disambiguate, the resolver falls back to matching `cardName`/`cardNameJp` against the record's card names. Added after a real scan where Gemini read `setName: "Dragon Blast"` on a Cold Flare card. Experimental because a wrong card name matching a sibling record could produce a wrong hit; still gated by TCGdex validation in active mode. Revisit before enabling.

#### Tests and Verification

- Exact mapping succeeds.
- Multiple targets are ranked explicitly rather than implicitly selecting the first item.
- A missing index entry falls back to the existing pipeline.
- A rejected exact candidate falls back to the existing pipeline.
- Exact Trainer mapping works without dexId or HP.
- Existing tests for all three cross-version fallback paths continue to pass.
- `npm test` passes.
- Representative scans pass in Chrome.
- `./safari/build-safari.sh` succeeds and the same cards pass in Safari.

#### Rollback

- Disable the local resolver so the static index is not read at runtime.
- The TCGdex/Gemini pipeline does not need to be reverted because this phase only adds an upstream fast path.

#### Exit Gate

- The gold dataset has no wrong matches.
- Chrome and Safari return the same counterpart for the same input.

### Phase 5 — Exact Counterparts in Marketplace Search

#### Goal

Improve CardRush, TCGPlayer, PriceCharting, and Collectr query accuracy with exact sets and card numbers.

#### Work

- For high-confidence counterparts, pass the exact set, card number, rarity, and printing to marketplace queries.
- Do not change the source-language card query when counterpart lookup fails.
- Compare listings before and after the change to ensure the correct printing is not filtered out.
- Preserve existing marketplace-specific fallbacks.
- For EN→JP lookups, Bulbapedia targets have no TCGdex JA card data, so a TCGdex fetch is impossible. Instead, resolve the JP printing's set code and card number directly into the CardRush keyword (e.g. `BW4 044`); the JP marketplace does not require TCGdex metadata. This can replace the dexId-fallback guess that currently risks matching a different JP printing. The keyword is used by the JP Version section's own JA lookup; EN scans themselves never query CardRush.

#### Implementation Status (controlled activation — JP→EN only)

Resolution now runs once at the top of `lookupCardAndPrice` (pure, before marketplace queries fire). A `hit` has two effects:

1. **EN-marketplace query precision.** TCGPlayer and Collectr queries switch to the resolved target's `cardName + cardNumber` (e.g. `Darkrai 107/108` instead of `Darkrai-EX 072/069`). CardRush keeps the JP source keyword (already exact) and PriceCharting keeps the source number because its JP listings are the correct printing for the scanned card — verified in a real scan where `Darkrai-EX 072/069` returned the `pokemon-japanese-dark-rush/darkrai-ex-72` listing.
2. **Counterpart adoption.** `runBulbapediaReport` exposes `validatedCard` only when the TCGdex validation fetch confirms the target. `lookupCardAndPrice` adopts it as `enVersion` only when the existing pipeline found no EN version and the scanned card is Japanese. This makes the English Version section render for BW scans (whose EN cards were previously unreachable) and enables the existing Look Up Price button to run a clean EN marketplace lookup.

Fail-closed guarantees: `ambiguous`/`multi-target`/`miss` never modify queries or produce a `validatedCard`; a failed validation fetch exposes no `validatedCard`; `skipCrossVersion` skips resolution entirely.

**EN→JP direction (implemented).** The generator now emits an `enToJa` section holding the reverse records whose only gap is `missing-target-tcgdex-set-id` (TCGdex has no JA cards for these eras). These records cannot drive TCGdex validation, but they carry the JP physical set code and card number plus the EN set the index knows. Resolution tolerates set-code aliases: when the printed code misses (Gemini reported `NXD` where the index stores `DEX`), the resolver falls back to normalized set name + localId. `runBulbapediaReport` skips the validation fetch for `tcgdexSetId`-less targets, so they can never be adopted as `jpVersion` — the enToJa section is marketplace-only. The runtime bundle strips evidence fields (kept in the JSON for review).

**CardRush stays JP-only.** CardRush is queried only for Japanese scans with a resolvable set code (`shouldQueryCardrush`). An earlier version queried it for EN scans through the resolved JP printing, but that mixed a JP marketplace price into an EN card result, so it was removed. EN cards still reach the JP printing's prices from the JP Version section, whose Look Up Price button runs its own JA lookup with the exact `BW4 072`-style keyword.

**JP version display (EN scans).** When an EN scan resolves a unique JA target, the cross-version section renders that exact printing instead of the TCGdex `findJpVersion` guess. Observed wrong match: Dark Explorers `107/108` returned `M5-099 メガダークライex` through the name/dexId/rarity fallbacks instead of Dark Rush `072/069` — the same class of error the index exists to remove. `buildBulbapediaJpVersion` synthesizes a TCGdex-shaped object (JP name, set code, set name, derived card count) so the section and its Look Up Price button work without TCGdex metadata; the button then queries CardRush with the exact `BW4 072` keyword.

Observed on a real Darkrai-EX scan: TCGPlayer went from `marketPrice: 0` (wrong listing for JP number `072/069`) to `marketPrice: 789.99` on the correct `Darkrai 107/108` query. Note the query name comes from the Bulbapedia target (`Darkrai`, without the `-EX` suffix); the number is specific enough for TCGPlayer. Using `validatedCard.name` instead would require delaying marketplace queries until after the validation fetch and was rejected to preserve parallel query latency.

#### Tests and Verification

- Regular and Full Art cards for the same Pokémon are not mixed.
- A reprint from another set does not replace the primary result when the exact printing is known.
- Trainer and Promo queries return the correct set and number.
- `runBulbapediaReport` tests lock the adoption contract: `validatedCard` present on valid hit, absent on validation failure, absent on failed TCGdex fetch, and no report at all when `resolution` is null (`skipCrossVersion`).
- Test all four marketplaces in Chrome and Safari, including Safari permission prompts.

#### Exit Gate

- Primary listings are more accurate than the baseline without reducing fallback coverage.

### Phase 6 — Reduce Dependence on Gemini Knowledge

#### Goal

Let Gemini focus on reading visible card data instead of recalling JP↔EN mappings.

#### Work

- Keep `crossSetCode` and `crossCardNumber` as fallbacks during the transition.
- Prefer the exact local index when Gemini conflicts with it.
- Log conflicts with enough provenance for review without automatically modifying data.
- After coverage is sufficient, shorten the hard-coded mapping list in the prompt as a separate change.
- Do not modify the prompt in the same change that first enables the local resolver.

#### Implementation Status

The index now outranks the pipeline's cross-version search. `selectCrossVersionCard` in `utils/card-lookup.js` picks the validated index card whenever the pipeline found a different one, and logs the override with provenance:

```js
[bulbapedia] index overrides pipeline counterpart:
  { pipeline: 'SM4A-003', index: 'bw5-107', sourceKey: 'ja:BW4:DARK_RUSH:072/069', comparison: 'disagrees' }
```

Agreement and index-miss cases keep the previous behavior, so the TCGdex and Gemini fallbacks still run unchanged. Only a card that passed TCGdex validation can override, and multi-target or ambiguous records never produce one.

Gemini's `crossSetCode` / `crossCardNumber` remain active fallbacks and are still used whenever the index misses, which is every era except BW today.

#### Prompt shortening (done, after coverage)

The index covered all seven eras shipped at that point (BW, HGSS, XY, SM, SWSH, SV, M), which is exactly the set of mappings the prompt used to carry, so the hard-coded JP→EN list was removed from `GEMINI_CARD_CODE_PROMPT`. The prompt now keeps the counterpart concept and three examples, states that main-set numbering usually matches while high-class and promo sets may differ, and tells the model that the app resolves set mappings from its own bundled data. The `crossSetCode` / `crossSetName` / `crossCardNumber` fields and the "provide the set even without the number" rule are unchanged, so the model can still supply a fallback.

Verification limits: there is no vision A/B fixture set in the repository, so the change was verified by (a) asserting the prompt still requests every JSON field and no longer contains the mapping list, (b) the index resolving those same counterparts in tests, and (c) the pipeline's own cross-version search remaining in place as a fallback. A scan-level A/B on a real JP and EN card is still worth doing manually.

#### Tests and Verification

- Recognition quality for `setCode`, `cardNumber`, `rarityCode`, name, and language does not decline.
- A Gemini conflict cannot override a `reviewed` record.
- Gemini fallback continues to work when the local index misses.

#### Exit Gate

- A/B fixtures show fewer incorrect cross-number predictions without lower recognition accuracy.

### Phase 7 — Expand One Era at a Time

Treat each era as an independent change set that repeats the Phase 3 process:

1. XY, because TCGdex JA also lacks substantial data.
2. Sun & Moon.
3. Sword & Shield.
4. Scarlet & Violet.
5. Promo, deck, and special products within each era.

Every era requires its own report, gold samples, conflict review, and tests. Do not generate and enable every era in one release.

#### Implementation Status

The pipeline is era-parameterized (`scripts/bulbapedia/era-config.mjs`), and two eras shipped together at the user's request: **HGSS** and **XY**, both including their subsets and promo sets.

| Era | JA→EN records | EN→JA (marketplace only) | Incomplete | Conflicts | Ambiguous |
|---|---|---|---|---|---|
| BW | 1,030 | 1,030 | 1,039 | 0 | 0 |
| HGSS | 354 | 356 | 440 | 1 | 0 |
| XY | 1,452 | 1,458 | 1,917 | 3 | 0 |
| SM | 4,721 | 164 | 1,505 | 4 | 0 |
| SWSH | 4,296 | 1,326 | 2,088 | 0 | 0 |
| SV | 5,661 | 83 | 486 | 1 | 0 |
| M | 1,757 | 57 | 351 | 1 | 0 |
| DP | 509 | 1,074 | 1,761 | 2 | 0 |

The table above is a snapshot from each era's first release. **2026-09-23:** the six early DP sets needed
marketplace-only records whose JA target has no card number, so `enToJa` also accepts that shape now. Regenerating
the five affected shipped eras added 41 such records and changed no exact record: `hgss` 356 → 357, `xy` 1,582 →
1,613, `sm` 181 → 184, `swsh` 1,627 → 1,628, `sv` 340 → 345 (current totals: 20,760 exact records + 6,288
`enToJa`, 11.7 MB of bundles). Every era's gold-pair proposals are byte-identical, so the artwork approvals still
apply; each `review-decisions.json` carries a dated note. The runtime fails closed on these records instead of
letting TCGdex guess (see the DP shipped note below).

XY also covers **Expansion Pack 20th Anniversary (CP6)** ↔ **Evolutions (xy12)**, 104 records, added after a real scan showed that Generations-style EN sets pair with a JP product rather than a JP expansion.

**Sun & Moon (shipped).** SM is the first era where TCGdex JA actually carries cards (30 of 34 sets; the "+" sets live under their `p` ids, e.g. Shining Legends -> `SM3p`), so most records are structured in both directions and validation works against JA cards too. Three fixes came out of the review: Hidden Fates prints its Shiny Vault under the main set name, so `SET_CATALOG_NUMBER_RULES` maps the `SV` number prefix to the separate `sma` set (94 records); `Facing a New Trial` (SM2p) and `Detective Pikachu` (SMP2) were added as subsets; and one wrong pairing (Unbroken Bonds 47 Kingler -> SM10-026, which is Krabby) is dropped through the new `data/bulbapedia/<era>/exclusions.json`. SM1p is not covered because Bulbapedia's `Sun & Moon cards` category mixes several products.

**Sword & Shield (shipped).** Only 14 of 30 SWSH sets carry JA cards in TCGdex, so most EN->JA records there are marketplace-only like BW. Two fixes came out of the review: the sample validator now tries padded and unpadded numbers (Bulbapedia prints `036/202`, TCGdex uses `swsh1-36`), and six sub-sets that Bulbapedia prints inside their parent set got number rules (`TG` -> the Trainer Gallery sets, `GG` -> Crown Zenith Galarian Gallery, `SV` -> Shining Fates Shiny Vault), re-pointing 312 records. Two JP sets were left uncovered: `S2a Explosive Walker` collided with XY11a's set name in the catalog, and `S5a` appeared to have no Bulbapedia category. Both shipped on 2026-09-19 — see "Deferred data gaps" below: `S2a` is `Category:Explosive Walker cards` (XY11a is really `Fever-Burst Fighter`), `S5a` is `Peerless Fighters`.

**Scarlet & Violet (shipped).** TCGdex JA carries cards for all 26 SV sets, so SV behaves like SM (structured in both directions). Review found one Bulbapedia/TCGdex numbering disagreement (`Ruler of the Black Flame 141/108 Basic Fire Energy` -> `Paldea Evolved 230/197`, which TCGdex numbers as Forretress ex); validation rejects it, so it never reaches the UI. SV also ships the lazy index loader, since six eras total about 10 MB.

**Mega Evolution (shipped).** The newest era (2025+) was added at the user's request after a real scan of `M5-099` produced a wrong JP guess. TCGdex JA carries cards for every M set, so it behaves like SM/SV. Bulbapedia names the JP set `M3` "Nihil Zero" and `M6` "Storm Emeralda", which is why those categories needed a prefix search to find. M6 has no EN set yet (only `MEP` promos), so those records pair with promos or stay incomplete.

**Printed total as a set signal.** `fetchCardById` now compares the total printed on the card ("2/83") with the candidate set's `cardCount.official`. A name match against the wrong set is kept only as a fallback (`classifyCardCandidate` returns `hard`/`soft`/`reject`), so a misread set code no longer wins over the right set. Observed case: `M Venusaur EX 2/83` was accepted as XY base `xy1-2` (146 cards) until the total check moved it to Generations `g1-2` (83 cards).

Review gate results: the user confirmed all 13 HGSS and 29 XY relationship pairs against artwork. Live TCGdex cross-checks now flag 0 of 36 BW samples, 0 of 25 HGSS samples, and 0 of 56 XY samples.

The parser reads a card's name from the page title rather than the infobox `cardname`, because Mega, Primal, and BREAK printings carry their prefix only in the title (`M Houndoom-EX` with `cardname = Houndoom`). Before that fix, 5 of 56 XY samples failed validation by name. The fix also restores the `-EX` suffix that the infobox omits (`Darkrai` → `Darkrai-EX`), which improves the EN marketplace queries built from index targets. The record set is unchanged by the fix — only name fields — so the user's relationship approval still applies.

A key finding changed the design: TCGdex JA **lists** the HGSS and XY sets but contains **no cards** for them (`/ja/sets/L1a` returns an empty card list). Their JA catalog entries therefore keep `tcgdexSetId: null`, exactly like BW. That keeps EN→JA candidates in the marketplace-only `enToJa` section and keeps JA→EN records validatable against TCGdex EN.

Runtime loading changed accordingly: each era bundles to `data/bulbapedia/<era>/counterpart-index.js` defining `BULBAPEDIA_<ERA>_INDEX`, and `lib/bulbapedia-index.js` merges them into `BULBAPEDIA_INDEX.ja` / `.en`. The bundles drop `evidence` (provenance stays in the JSON review artifacts), the per-record `status` and the per-side `cardKind` (nothing in the runtime reads either), and `bundle-index.mjs` refuses to bundle if any record is not `structured`. That keeps all eight eras at **11.4 MB** total (was 13.0 MB before the trim); the largest single era is 2.9 MB and the smallest 0.29 MB, and the lazy loader only fetches the era a scan needs.

#### Known limitations

- Deck products were excluded: XY Beginning Set, XY Trainer Kits, M Master Deck Build Boxes, HS Trainer Kit. They are mostly reprints, which would add multi-target records without new coverage. Add their categories to `era-config.mjs` if wanted later.
- Promo sets (L-P, XY-P) pair some JP promos with EN sets through the card hub pages, so a few relationships point at unexpected EN printings (e.g. `XY-P 040/XY-P Spheal` → `PRC 46/160`). The user verified the reviewed samples; the pairing source is the release-information table, not prose.

#### Deferred data gaps (optional, later — user decision 2026-03-02)

Four known coverage gaps were left open on purpose, and a fifth (`S3`) was found later by a real scan; a sixth (`SM1D`, the Sun & Moon Starter Set) surfaced while closing `SM1p`. None of them affect the eras that are already shipped. **All six shipped on 2026-09-19:**

| Gap | Why it was missing | Status |
|---|---|---|
| **Generations (g1)** | Bulbapedia pairs most Generations printings with the JP deck product **BREAK Starter Pack** (`Category:BREAK Starter Pack cards`, 77 pages), e.g. Generations `2/83 M Venusaur-EX` ↔ `002/072` | **Shipped 2026-09-19** (65 records). Deck products print no set code, so the CardRush keyword switches from `"${setCode} ${localId}"` (`BREAK 002` returns unrelated listings) to a name-based keyword (`MフシギバナEX 002`): the catalog sets `printsNoSetCode: true`, `bulbapedia-generator.mjs` carries it into both index sides, `bundle-index.mjs` keeps it in the runtime bundle, and `buildCardrushKeyword()` (`utils/card-lookup.js`) uses the Japanese name for those printings. The JP Version button passes the flag through `data-name-keyword` / `data-jp-name` because that flow skips the index. The 11 Trainer reprints in the deck stay unpaired: their English printings are in unsupported eras (Base Set, Neo Genesis, EX Sandstorm, Dark Explorers). |
| **SWSH `S2a` (Explosive Walker)** | The JP set name collided with XY11a in `SET_CATALOG` | **Shipped 2026-09-19** (86 records). The real cause turned out to be elsewhere: Bulbapedia's `Category:Explosive Walker cards` is S2a's category (71 members, all Darkness Ablaze/Champion's Path), while XY11a is actually **Fever-Burst Fighter** (`Category:Fever-Burst Fighter cards`). The category moved to the `swsh` era as `S2a`, XY11a got its own category, and the catalog now keys both names separately — no era-aware disambiguation was needed. |
| **SWSH `S5a`** | "No Bulbapedia category" — a naming mismatch | **Shipped 2026-09-19** (96 records). Bulbapedia calls the set **Peerless Fighters** (双璧のファイター); `Category:Peerless Fighters cards` exists. Its cards split across two EN sets (Chilling Reign 72, Evolving Skies 24), which is expected: EN expansions combine several JP sets. |
| **SWSH `S3` (Infinity Zone)** | Not a known gap: the set was simply absent from the `swsh` config, and only a real scan exposed it (EN `Darkness Ablaze 117/189 Eternatus VMAX` missed the index, and its JA `S3 065/100` counterpart resolved nothing) | **Shipped 2026-09-19** (119 records). Bulbapedia's `Category:Infinity Zone cards` pairs Infinity Zone with Darkness Ablaze, Champion's Path and the SWSH Black Star Promos. TCGdex JA lists `S3` with an official count but no cards, so the catalog entry keeps `tcgdexSetId: null`. |
| **SM `SM1p` (Sun & Moon subset)** | Diagnosed as "Bulbapedia's `Sun & Moon cards` category mixes several products" | **Shipped 2026-09-19** (40 records). The diagnosis was off: the category to crawl is `Category:Enhanced Expansion Pack Sun & Moon cards`, and the set name the parser reads from `{{TCG|Enhanced Expansion Pack Sun & Moon\|Sun & Moon}}` is its first parameter, `Enhanced Expansion Pack Sun & Moon`. TCGdex JA carries SM1p cards (51), so the catalog keeps `tcgdexSetId: 'SM1p'`. Its English printings live in Guardians Rising and the SM Black Star Promos. |
| **SM `SM1D` (Sun & Moon Starter Set)** | Found while closing `SM1p`: the English Sun & Moon rows pair with this deck, and the deck was absent from the era | **Shipped 2026-09-19** (17 records). A deck product (no printed set code), so it carries `printsNoSetCode: true` like the BREAK Starter Pack. Its other 42 rows are JP-only on Bulbapedia (`jpdeck=... \| jpcardno=...` with no `expansion=`), which the row-based pairing cannot match; about 2,250 such rows exist across the seven eras, and pairing them across rows would turn many records into `multi-target`, which the UI does not display. Those cards stay covered by the TCGdex cross-version search instead. |
| **EN cards whose JP printing is a deck product** (found 2026-09-23 by a real scan of `JTG 006/159`) | The era crawls JP **set** categories, and Bulbapedia files these pages under the deck's category instead | **Fixed 2026-09-23 for `sv` (phase 1) and for `sm`, `swsh`, `m` (phase 2).** Measured on `sv` / Journey Together: `Category:Journey Together cards` has 157 members, 57 of them absent from `Category:Battle Partners cards`, and all 57 print their JP printing from a deck (`Start Deck 100 Battle Collection` 20, the `Generations Start Deck *` sets, `ex Start Decks` 10, `V Starter Decks` 9, `SV-P Promotional cards` 8, ...); all 193 JP printings carry a number, so they are pairable. `SV9` therefore holds 131 of 159 EN-source records, and `Journey Together 6/159` (Petilil, JP `Generations Start Deck Reshiram ex & Amoonguss ex 007/175`) has no record at all, so an English scan falls back to TCGdex and shows Unverified. `sm`, `swsh` and `m` crawl JP categories too and very likely share the gap. Fixing it means crawling the EN categories for those eras, adding the deck products to `SET_CATALOG` with `printsNoSetCode: true`, then regenerating and re-reviewing. |

The `xy` era also carried a silent bug from the S2a collision: its config pointed XY11a at the S2a
category, so XY11a produced **0 records** (the generator rejects cross-era pairings, so the crawled pages
only showed up as `missing-target-set-identifier` in the report). XY11a now crawls
`Category:Fever-Burst Fighter cards` and pairs with Steam Siege: 59 records, sample review 60/60 OK
(2026-09-19), bundled.

**`sv` phase 1 shipped 2026-09-23** (the row above). Three parts, and the third is the one that is easy to miss:
the 12 affected English categories were added to `SV_SET_CATEGORIES`, their 25 deck products went into
`SET_CATALOG.ja` with `printsNoSetCode: true` (Start Deck 100 Battle Collection uses TCGdex's real `MC` id - 774
cards - so its pairs validate against TCGdex; the rest are marketplace-only), and those deck names were listed in
the era's new **`extraSetNames`** field, because `filterSourcesBySetNames` keeps a printing only when its
`ja.setName` is listed and a deck has no category of its own. Without that field the first generate produced
**zero** new records from 273 freshly crawled pages. Measured result: 2081 -> 2354 pages, 6127 -> 6507 records,
345 -> 667 `enToJa`, sample review 265 checked / 0 flagged, full pass 6384 checked / 16 flagged (0.25%: 11 transient TCGdex 503 that re-checked clean, 4 Bulbapedia Japanese-name typos, 1 page-level HP - no wrong pairing, none from the new records), conflicts 1 -> 18 (two product lines repeat numbers
across their member decks and are dropped fail-closed). Totals after this change: 21,140 records + 6,610 `enToJa`
across the eight eras, 12.1 MB of bundles. The user approved the 37 new relationships after reviewing them as 14
product rows with artwork. `sm` (60 pages), `swsh` (221) and `m` (101) have the same structural gap and need the
same three-part pass.

**`sm`, `swsh` and `m` phase 2 shipped 2026-09-23**, using `node scripts/bulbapedia/measure-en-gap.mjs <era>` to
measure first (it reports the English categories to add and the Japanese products those pages print, split into
"already in SET_CATALOG.ja" and "still to add"; it retries with backoff because Bulbapedia answers with an HTML
error page when it throttles). The same three parts applied: 19 English categories (4 / 11 / 4), 28 deck products in
`SET_CATALOG.ja` (4 / 17 / 13 - none exists on TCGdex, so all are marketplace-only with `printsNoSetCode`, and only
the products with 3+ occurrences were kept), and their names in each era's `extraSetNames`. Measured result: `sm`
2148 -> 2208 pages and 4813 -> 4889 records (181 -> 260 `enToJa`), `swsh` 2206 -> 2422 pages and 4595 -> 4758
records (1627 -> 1849), `m` 798 -> 897 pages and 1756 -> 1789 records (57 -> 101). Sample reviews `swsh` 274 / 0,
`sm` 247 / 1, `m` 73 / 1 - the single flags are known artifacts (the Basic Metal Energy naming and the MEP coverage
gap). Conflicts came only from the `V Starter Sets` line product (23 in `swsh`, 2 in `m`), whose `001/023` belongs
to three different cards, and the generator drops those keys fail-closed. Some of the new pairings are cross-era by
nature, because the same page lists a reprint deck (`XY Beginning Set` -> Kalos Starter Set, `Battle Strength
Decks` -> Black & White, `National Beginning Set` -> Boundaries Crossed). Totals after both phases: 21,412 records +
6,951 `enToJa` across the eight eras, 12.4 MB of bundles.

#### Remaining eras

Shipped so far: **DP, BW, HGSS, XY, SM, SWSH, SV, M** (20,760 records). Sun & Moon, Sword & Shield, and Scarlet & Violet landed after this section was first written; TCGdex JA does carry cards for SM/SV (and for part of SWSH), so those eras produce structured records in both directions. Diamond & Pearl landed 2026-09-23; it is the only era crawled from its English categories, and it is covered in both directions like BW (TCGdex JA has no DP set, so its EN→JA side is `enToJa`).

**The EX series, the e-card series, and the Wizards/Base sets are still deferred by user decision (2026-03-02).** They are out of scope for now because they are far outside the collection being scanned. Adding one later follows the same pipeline (verify categories, probe TCGdex JA coverage, add catalog entries, crawl, generate, review, bundle) with these expectations:

- TCGdex JA has no cards for those eras, so every EN→JA candidate becomes marketplace-only (`enToJa`), exactly like BW.
- Bulbapedia's JP naming for very old products is less standardized (`Expansion Pack`, `Miracle of the Desert`, `Gift Box`, half decks), so the category list and `SET_CATALOG` work is larger than for SM/SV.
- Counterpart relationships are weaker there: fewer reprints and fewer cross-language pairs, so the index would cover less of each era and the review gate would lean more on the sample checks.
- A few of those sets are partially reachable through the eras already shipped (for example the `L-P`/`DPt-P` promos appear as printings on pages we already crawl), so some coverage may arrive for free as Bulbapedia adds printings.

#### Diamond & Pearl — reconnaissance (2026-09-22, before starting)

> **Shipped 2026-09-23.** The reconnaissance below was right about the categories, the catalog and the `tcgdexSetId: null` entries, but **wrong about the JA→EN records**: it assumed the English category pages "carry both printings, so they produce the JA→EN records that can actually be verified". They carry both *set names*, not both *card numbers* — Bulbapedia prints no `jpcardno` for the six early DP sets, so no `ja` source key exists for them. Actual result: **509 exact records + 1,074 `enToJa`** from 1,347 crawled pages, covering `DP6` Intense Fight in the Destroyed Sky → Stormfront, `DPt1`-`DPt4` → Platinum / Rising Rivals / Supreme Victors / Platinum: Arceus, and the `DP-P`/`DPt-P` promos. The six early sets (`DP1`-`DP5`: Space-Time Creation, Secret of the Lakes, Shining Darkness, Dawn Dash/Moonlit Pursuit, Cry from the Mysterious/Temple of Anger) produce **zero exact records**, and their Japanese card numbers do not exist on Bulbapedia at all (card pages omit `jpcardno`; set pages list `None`).
>
> **Follow-up the same day, after a real scan.** Those six sets were still reachable from an English scan through the TCGdex name search, which returned a *wrong* printing: EN `Great Encounters 3/106 Darkrai` came back as `SM5S-031` (Ultra Sun Prism Star), because TCGdex has no card for any DP set and the search fell through to a name+dexId+rarity match in another era once its set filter matched nothing. Two changes fixed it: the generator now also keeps an EN→JA candidate whose JA target has a **set but no card number** (561 cases, `enToJa` 513 → 1,074), and `utils/card-lookup.js` fails closed on such a hit — `buildBulbapediaJpVersion` returns null without a `localId` and the three `findJpVersion` searches are skipped, so the section shows no Japanese Version instead of a wrong card. The 509 exact records are unchanged. Full pass: 498 checked, 24 flagged (4.82%), every flag a TCGdex naming artifact rather than a wrong pairing. Details in `data/bulbapedia/dp/review-decisions.json` and `AGENTS.md`.

Verified so the first session can go straight to the config work:

| Set | Bulbapedia category | Members | TCGdex EN |
|---|---|---|---|
| Diamond & Pearl | `Category:Diamond & Pearl cards` | 125 | `dp1` (130) |
| Mysterious Treasures | `Category:Mysterious Treasures cards` | 124 | `dp2` (123) |
| Secret Wonders | `Category:Secret Wonders cards` | 132 | `dp3` (132) |
| Great Encounters | `Category:Great Encounters cards` | 106 | `dp4` (106) |
| Majestic Dawn | `Category:Majestic Dawn cards` | 100 | `dp5` (100) |
| Legends Awakened | `Category:Legends Awakened cards` | 146 | `dp6` (146) |
| Stormfront | `Category:Stormfront cards` | 106 | `dp7` (100) |
| Platinum | `Category:Platinum cards` | 133 | `pl1` (127) |
| Rising Rivals | `Category:Rising Rivals cards` | 120 | `pl2` (111) |
| Supreme Victors | `Category:Supreme Victors cards` | 153 | `pl3` (147) |
| Arceus | `Category:Arceus cards` | 111 | `pl4` (99) |
| DP promos (EN) | `Category:DP Black Star Promotional cards` | 53 | `dpp` (56) |

Japanese-only products, all present as categories: Space-Time Creation (121), Miracle of the Desert (53),
Dawn Dash (70), Shining Darkness (119), Cry from the Mysterious (65), Temple of Anger (65), Intense Fight in the
Destroyed Sky (92), Bonds to the End of Time (89), Beat of the Frontier (99), Advent of Arceus (90),
`Category:DP-P Promotional cards` (103) and `Category:DPt-P Promotional cards` (41).

Consequences for the pipeline:

- **TCGdex EN carries every set this era needs**, so the Japanese-source records get verified English targets and
  become structured records — the same shape as BW, not the marketplace-only shape.
- **TCGdex JA has no DP set at all**, so every English-source candidate becomes marketplace-only (`enToJa`) and the
  `ja` catalog entries carry `tcgdexSetId: null`, again like BW (`'Black Collection': { setCode: 'BW1', tcgdexSetId: null }`).
- Start from the eleven English categories plus the English promo category: their pages carry both printings, so
  they produce the JA→EN records that can actually be verified. **Correction after the crawl (2026-09-23):** they
  carry both *set names* but usually no `jpcardno`, so only the printings from `DP6` onward plus the promos can be
  keyed. The early-set cards stay reachable from an English scan through an `enToJa` record whose JA target has
  the set but no number, which the runtime treats as fail-closed (see the shipped note above). The Japanese-only
  categories add cards with no English counterpart (the `missing-target-printing` class), so they can wait.
- **An English category entry still carries the Japanese `setName`.** `filterSourcesBySetNames` keeps a printing
  only when `ja.setName` is one of the era's names, so `era-config.mjs` lists the English `categoryTitle` next to
  the Japanese set it pairs with (`'Category:Diamond & Pearl cards'` → `'Space-Time Creation'`). The second
  Japanese promo set (`DPt-P`) needed its own entry, because its printings appear on the Platinum-era pages and
  the filter would otherwise drop them. Deck products and English sets outside the era (POP Series, the EX sets)
  stay out through the catalog, like the other eras.
- Expected size: roughly 1,200-1,800 records from a crawl of about 1,100-2,000 pages, i.e. a medium era.

### Phase 8 — Optional Enhancements

Implement these only after the card-level index is stable.

#### Selected (user decision, 2026-03-02)

- **Incremental refresh by revision ID.** Shipped: `node scripts/bulbapedia/crawl-era.mjs <era> --incremental` queries revision ids in batches and re-fetches content only for new or changed pages (`selectPagesToFetch`). Verified on the M era: 798 pages, 0 content fetches when nothing changed, and the artifacts stay byte-identical. This matters because the M and SV eras are still releasing sets and a full re-crawl is 800-2,100 pages per era.

#### Keeping an era fresh

Run this periodically (about once a week) and whenever a new set is announced, for each era that is
still releasing cards (`m`, `sv`, and later `sm`/`swsh` if Bulbapedia revises them):

```bash
node scripts/bulbapedia/crawl-era.mjs m --incremental   # re-fetch only new or changed pages
npm run bulbapedia:generate-era -- m                    # regenerate that era's artifacts
npm run bulbapedia:bundle-era -- m                      # re-bundle (needs review-decisions.json approved)
```

Notes:

- The crawl takes seconds when nothing changed, because only revision ids are queried. Artifacts stay
  byte-identical in that case, so nothing downstream needs to move.
- Regeneration is per era; other eras do not need to be touched.
- If the new data adds relationships, review the new pairs before bundling: regenerate the gold-pair
  checklist (`node scripts/bulbapedia/print-gold-pairs.mjs <era>`) and confirm the new pairs, then update
  `review-decisions.json` and bundle.
- Run `node scripts/bulbapedia/sample-review.mjs <era>` after a refresh to re-check targets against live
  TCGdex.

#### Deferred as optional (user decision, 2026-03-02)

- **Name-alias index for OCR and Gemini normalization.** Dropped after checking the data: Bulbapedia's `jtrans` romaji is abbreviated (`MFushigibanaEX` for Mega Venusaur ex) and rarely matches what Gemini returns, while the resolver already matches both the English `cardName` and the kana `japaneseName`. Revisit only if scans show real name variants that fail to match while the set and number do.
- **Artwork group IDs** (image metadata + illustrator) — a verification layer on top of the pairing the parser already derives; needs extra parsed fields for limited gain.
- **Perceptual image hashes** — the strongest artwork check, but it needs runtime image fetching and hashing plus a licensing review before images are bundled or cached.
- **UI provenance and confidence when multiple counterparts exist** — overlaps with the UI/UX plan items C2 and C4, so it belongs there rather than in the data pipeline.

Image usage requires a separate review of licensing, extension size, and distribution before images are bundled or cached.

## 8. Candidate Ranking Rules

Proposed signal order:

1. `reviewed` exact set and full card number.
2. `structured` exact set and full card number that passed the quality gate.
3. Exact printing or artwork relationship.
4. Matching dexId and HP when metadata exists.
5. Matching normalized rarity.
6. Matching name, class, and form.
7. Set-level candidate hint.
8. Existing broad name or dexId fallback.

Release dates and card rosters must not promote an `inferred` mapping to an exact match. Those signals may only support ranking or review.

## 9. Overall Test Strategy

### Unit Tests

- Wikitext template parser.
- Redirect resolver.
- Card-number and set-code normalization.
- Confidence and status classification.
- Conflict and multiple-target handling.
- Static index resolver.
- Existing three-path cross-version consistency.

### Fixture Tests

- Use saved API responses from specific revisions.
- Do not call Bulbapedia during the default `npm test` run.
- Make network refresh a separate command that does not run in CI or unit tests.

### Regression Tests

- Gold JP/EN card pairs confirmed by the user.
- Known wrong-match cases. Observed in a real scan log: EN Beedrill XY `5/146` matched `SM4A-003` via the dexId fallback instead of its true JP counterpart (Collection X), because Gemini misread `cardNameJp` (`スオバー` instead of `スピアー`) and TCGdex JA lacks XY-era data. Same Pokémon and HP, different printing — exactly the ambiguity class the index exists to eliminate.
- Trainer and Energy cards without dexId.
- Same Pokémon and HP with different artwork.
- Same artwork with different sets or card numbers.
- Missing TCGdex JP cards.

### Browser Verification

Required from Phase 4 onward:

- Reload Chrome and scan representative cards.
- Sync and build Safari, then scan the same cards.
- Confirm the console has no new API or permission errors.
- Confirm there is no Bulbapedia permission prompt because runtime does not call Bulbapedia.

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Incorrect community data | Provenance, status, user-reviewed gold data, and a precision-first policy |
| Template changes | Offline fixtures, fail-closed behavior, and unsupported-template reports |
| One card has multiple printings | Target arrays, explicit ranking, and no overwriting |
| Stale data | Revision IDs and incremental audits |
| API rate limits or availability | Development-only fetching, local caching, low concurrency, and no runtime dependency |
| Static index becomes too large | Store only runtime fields and split by era if needed |
| Browser permissions or CORS | No runtime Bulbapedia calls and no added host permission |
| Card-number normalization errors | Preserve full numbers and leading zeroes, backed by invariant tests |
| Correct set but wrong printing | Treat set relationships as hints; require card-level evidence for exact lookup |
| Licensing or attribution | Review Bulbapedia and image licensing before distributing generated data or images |

## 11. Evaluation Metrics

Track these metrics separately for each era:

- Number of parsed source card keys.
- Percentage of `reviewed`, `structured`, `inferred`, `conflict`, and `incomplete` records.
- Exact lookup hit rate.
- Exact lookup validation rejection rate.
- Fallback rate.
- Wrong-match rate on the gold dataset.
- Ambiguous-candidate rate.
- Primary marketplace result accuracy on confirmed samples.

The primary release condition is a zero wrong-match rate on the gold dataset. Lower coverage is acceptable during the initial rollout.

## 12. Recommended Change Sequence

Each item should be an independent change set:

1. Baseline and gold fixtures.
2. API fixtures and parser spike.
3. Generator, schema, and report.
4. BW static-data pilot.
5. Local resolver in report-only mode.
6. Enable the BW exact resolver.
7. Marketplace query improvements.
8. Gemini prompt simplification.
9. Expand one era at a time.
10. Alias, artwork, and image enhancements.

Do not combine the parser, complete generated dataset, runtime matching, and Gemini prompt changes in one release.

## 13. Decisions Requiring User Approval

Before Phase 1:

- Store raw API fixtures in the repository or only minimized fixtures?
- Commit generated data to the repository?

Before Phase 3:

- Which BW card pairs should form the gold dataset?
- Automatically enable `structured` records after sample validation, or manually review every record?

Before Phase 4:

- How many representative scans should report-only mode collect before activation?
- When Bulbapedia and Gemini conflict, notify the user in the UI or only log the conflict?

Before Phase 8:

- Use or distribute Bulbapedia images?
- Accept a larger extension package for artwork hashes or indexes?

## 14. Definition of Done

The Bulbapedia integration is complete when:

- The static index is reproducible and contains provenance.
- Bulbapedia is not on the runtime network path.
- The exact resolver only uses records that passed the quality gate.
- Existing TCGdex/Gemini fallbacks still work when the index misses or rejects a candidate.
- Ambiguity never silently selects the first candidate.
- The gold dataset has zero wrong matches.
- The full unit test suite passes.
- Representative scans pass in Chrome and Safari.
- Every supported era has a clear coverage and conflict report.
- Application documentation is updated after production behavior is enabled.

## Related Documents

- `docs/UI_UX_IMPROVEMENT_PLAN.md` — deferred UI/UX items for the
  cross-version feature (provenance badge, JP section image, query timing).
  Revisit after the Bulbapedia data phases are complete.
