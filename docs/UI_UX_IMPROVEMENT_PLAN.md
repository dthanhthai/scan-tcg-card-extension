# UI/UX Improvement Plan

## 1. Purpose

**Status (2026-09-18): C1-C6 are all implemented.** The Bulbapedia counterpart index they depend on is
shipped. Read §6 for the details of each item.

Collect the user-facing improvements found while integrating the Bulbapedia
cross-version feature. These are deferred on purpose: the data work (era
coverage, review gates) comes first, because most of these items are about
presenting cross-version results that the index does not cover yet.

Revisit this file after the Bulbapedia data phases are complete.

## 2. Already addressed (for context)

- Cross-version Look Up Price buttons now send the counterpart's English name
  to the EN marketplaces instead of a Japanese name read from the card.
- The TCGdex progress label says "Resolving set code..." instead of the
  misleading "Updating card database (please wait...)".
- The JP section renders the exact indexed printing instead of the TCGdex
  `findJpVersion` guess, and works even when the TCGdex source fetch fails.
- When the JP section's Look Up Price finds no CardRush listing, its thumbnail
  falls back to the image of whichever other marketplace (Collectr, TCGPlayer,
  PriceCharting) returned a result — using their already-fetched data, with no
  extra request.

## 3. Deferred items

### C1. Japanese Version section has no image

**Status: Done (2026-09-18).** Two sources: the JA TCGdex card the validation fetch already returned
(`bulbapediaReport.validatedCard`, available for SV/SM/M) via `resolveJpVersionImage`, and, for eras with no
JA artwork, a marketplace image inserted into the section after its Look Up Price runs
(`pickCrossVersionResultImage`: the CardRush listing image first, then another marketplace's result).

**Problem.** The JP section shows the card name, set, and number but no
thumbnail, because TCGdex hosts no JA BW assets.

**Evidence.** Every real BW scan in this project renders an empty image slot in
the JP section.

**Proposal.** Reuse the CardRush listing image, which the Look Up Price flow
already fetches (`listings[].imageUrl`). Using the scanned EN card's image is
cheaper but risks showing the wrong artwork for alternate-art reprints.

**Effort / value.** Medium / high — the section currently looks unfinished.

### C2. Cross-version card shows no provenance

**Status: Done (2026-09-18).** The cross-version section header now carries a badge: `Verified` when the
printing came from the reviewed Bulbapedia index (JP section on a hit, or an adopted validated EN
counterpart), `Unverified` when it came from the TCGdex search path. Implemented in
`resolveCrossVersionProvenance` / `renderCrossVersionBadge` (`utils/card-lookup.js`).

**Problem.** The UI cannot tell whether a cross-version card came from the
reviewed Bulbapedia index or from a TCGdex search guess.

**Evidence.** A TCGdex guess returned `M5-099 メガダークライex` for Dark
Explorers `107/108` before the index took over. The report object already
distinguishes this (`comparison: 'adopted'` vs `'unverifiable'`), but only in
the console.

**Proposal.** Add a small badge to the section header, e.g. `index` for an
adopted indexed printing and `TCGdex` for a search result.

**Effort / value.** Low / high — this is the main trust signal for the feature.

### C3. Main CardRush block picks the wrong listing on EN scans

**Status: Done (2026-09-18).** `pickListingByLocalId` (`utils/card-lookup.js`) now matches the listing's
parsed `cardNumber` local part first. The old matcher only searched `productName + productUrl`, but the
CardRush and Collectr extractors keep the number in a separate `cardNumber` field and put only the card
name in `productName`, so the match never hit and every lookup fell back to `listings[0]`.

**Problem.** For an EN scan whose CardRush keyword comes from the index
(`BW4 072`), the best-listing picker still filters by the EN card number
(`107`), matches nothing, and falls back to `listings[0]`.

**Evidence.** The Darkrai-EX scan returned an arbitrary listing from the
keyword result set instead of the numbered printing.

**Proposal.** When the keyword came from `bulbapediaJpTarget`, pick listings by
`bulbapediaJpTarget.localId`.

**Effort / value.** Low / medium.

### C4. Cross-version cards outside the index are unmarked

**Status: Done (2026-09-18).** Same badge mechanism as C2: a cross-version card that is not a validated
index hit renders the amber `Unverified` badge instead of the green `Verified` badge.

**Problem.** Outside BW the cross-version section still comes from the TCGdex
search path, which is the same path that produced wrong matches.

**Proposal.** Reuse the C2 badge to mark those results as unverified, or hide
them behind a "show anyway" affordance.

**Effort / value.** Low / medium — depends on C2.

### C5. Japanese names leak into EN marketplace queries

**Status: Done (2026-09-18).** The EN marketplace queries now take their name from the index counterpart, then
the resolved cross-version counterpart, then the name read from the card. When the read name is Japanese and
the index has no counterpart, `lookupCardAndPrice` resolves the EN printing (`findEnCounterpart`) *before*
firing PriceCharting/Collectr/TCGPlayer, so they receive the English name. The delay only applies to that
case, so Pokemon scans (English name) keep firing the queries in parallel with the TCGdex fetch.

**Problem.** For a JA scan of a Trainer or Energy card there is no dexId, so
`FIND_EN_VERSION` never runs and `englishCardName` keeps the Japanese name.
TCGPlayer, PriceCharting, and Collectr then receive Japanese queries.

**Proposal.** Prefer the adopted `enVersion` name when available, or delay the
marketplace queries until the counterpart is known. The delay costs one round
trip and was rejected earlier to keep query latency low.

**Effort / value.** Medium / medium.

### C6. Cross-version Look Up Price is slow for indexed printings

**Status: Done (2026-09-18).** The JP section's Look Up Price button carries `data-skip-tcgdex` when the
printing came from the index and its era has no TCGdex JA card (`shouldSkipJpTcgdexLookup`), and
`lookupCardAndPrice` then skips the TCGdex fetch and goes straight to the marketplace queries. Eras
whose JA targets carry a TCGdex set id (SM, SV, M) still fetch, so they keep their TCGdex metadata.

**Problem.** Clicking Look Up Price on the JP section runs the full TCGdex
set-code brute force, even though the index already knows the printing and the
JA fetch is guaranteed to fail.

**Proposal.** Skip the TCGdex attempts when the resolution already identified
the printing; go straight to the marketplace queries.

**Effort / value.** Low / medium — removes the "Resolving set code..." wait.

## 4. Related deferred items (not UI)

- ~~Safari build copies review artifacts~~ **Done (2026-09-23).** The rsync in `safari/build-safari.sh` excluded
  `data/bulbapedia/*/*.json` and `*.txt` but not the `.jsonl` companion of a full validation pass, so eight
  `full-validation.json.jsonl` files (about 5.2 MB) shipped inside the appex. The script now also excludes
  `data/bulbapedia/*.jsonl` and `data/bulbapedia/*/*.jsonl`; the synced Resources dropped from 29.4 MB to
  24.3 MB and `data/` in the appex holds only the `.js` bundles the runtime reads.
- ~~Index bundle size~~ **Done.** The bundles total about 11.4 MB across eight eras
  (DP 0.4, BW 0.8, HGSS 0.3, XY 1.3, SM 2.2, SWSH 2.7, SV 2.9, M 0.8) and are no longer loaded
  with static script tags. `lib/bulbapedia-index.js` injects them on demand from
  `ensureBulbapediaIndexes()` (called before the first lookup) and merges them
  into the language views. Popup/scanner therefore open without parsing the
  index. **Done:** the loader now injects only the era a scan needs, resolved
  from the generated `data/bulbapedia/set-era-map.js` (set code / set name →
  era), and loads every era only when the set is unknown.

## 5. Suggested order when work resumes

Start only after the Bulbapedia data phases (era coverage and review gates) are
complete, so the deferred items are built against the final coverage.

1. C2, then C4 (one badge mechanism covers both).
2. C3 and C6 (small, independent).
3. C1 (needs a render change plus async image handling).
4. C5 (touches query timing, so it needs its own verification pass).

## 6. Status and handoff (2026-03-02)

C1-C6 are all implemented (2026-09-18). The work that blocked them is done: the Bulbapedia counterpart index now
covers eight eras (DP, BW, HGSS, XY, SM, SWSH, SV, M; 20,760 records), loads lazily through
`ensureBulbapediaIndexes()`, and every resolved target carries validation results plus provenance
(source key, page title, revision id, comparison against the pipeline's own guess).

### What each item can use now

| Item | Data available after the index work |
|---|---|
| C1 (JP section image) | For SM/SV/M the JA target has a real TCGdex card, so its image can be shown. BW/HGSS/XY/most SWSH still have no JA artwork. |
| C2 (provenance badge) | `bulbapediaReport.status`, `comparison` (`agrees` / `adopted` / `resolver-only` / `override`), `validation.valid`, and the target's source key. |
| C3 (CardRush listing pick) | The extractor lives in `content-scripts/cardrush-extractor.js`; the listing pick is `pickListingByLocalId` in `utils/card-lookup.js`. |
| C4 (mark unverified cross cards) | Follows directly from C2: anything not from a validated index hit is a guess. |
| C5 (JP names in EN queries) | Unchanged; needs the query built after the counterpart is resolved (see `APP_DOCUMENTATION.md` §7). |
| C6 (fast path for indexed printings) | A validated index hit already identifies the printing, so the TCGdex fallback chain (and its 404s) can be skipped for JA lookups of eras without JA cards. |

### Suggested order

1. C2, then C4 — they share the same data and are the visible payoff.
2. C3 and C6 — independent, small.
3. C1 — needs a decision on which eras to show artwork for.
4. C5 — needs a change to when the marketplace query is built.

### Before starting

- Read `docs/APP_DOCUMENTATION.md` §6, §7, §10.8 and §10.9 for the current lookup flow.
- Read `docs/BULBAPEDIA_INTEGRATION_PLAN.md` for what the index does and does not cover.
- Follow `AGENTS.md` for the dual-browser rules.
- Verify with `npm test` (407 tests today) and `./safari/build-safari.sh`.
- Scan-level checks matter here: scan one EN and one JP card from an indexed era and one from an era the
  index does not cover, and confirm the new UI matches the log.
