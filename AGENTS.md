# Project Guidelines — Pokemon TCG Card Scanner Extension

## Language

- All source code, code comments, identifiers, and documentation files must be written in English.
- Conversation with the user may use the user's preferred language.

## Critical: Dual-Browser Awareness (Chrome + Safari)

This extension runs on **both Chrome and Safari** from a single shared codebase. Every code change must be verified to work on both browsers.

### After any code change

| Step | Chrome | Safari |
|---|---|---|
| Reload | `chrome://extensions` → reload | `./safari/build-safari.sh` → open new `.app` |
| Test | Scan card, check console | Scan card, check console (right-click → Inspect Element) |
| Hotkey | `Ctrl+Shift+S` / `Cmd+Shift+S` | `Cmd+Shift+S` (may not work on older Safari — use popup Snapshot button) |

### Safari-specific caveats

- `commands` in `manifest.json` may not be supported on all Safari versions — always provide a UI fallback (popup button).
- `chrome.scripting.executeScript` and `chrome.tabs.create` work in Safari but may behave differently — test scrapers (CardRush, PriceCharting) on Safari after changes.
- Cloudflare challenge handling may differ between Chrome and Safari.
- The Xcode project references the repo-root folders (`assets`, `background`, `lib`, `popup`, `scanner`, `settings`, `utils`, `content-scripts`, `vendor`, `manifest.json`) directly, so those need no sync. `data/` is different: it ships from the rsync'd `safari/.../Resources/data` copy (the folder reference points there), which excludes the dev-only JSON/JSONL/txt artifacts under `data/bulbapedia` — run `./safari/build-safari.sh` after changing anything under `data/`.
- `data/` was missing from the Xcode project until it was added as a folder reference; without it `ensureBulbapediaIndexes()` 404s and the whole Bulbapedia counterpart feature is silently unavailable on Safari.
- Safari extension requires the `.app` to be running for the extension to appear in Safari Settings → Extensions.
- The marketplace scrapers open **real 200x150 normal windows** (`openMinimizedTab`), so `chrome.windows.getCurrent()` can return one of them. Anything that captures or focuses a window (the snapshot hotkey) must use `pickCaptureWindow()` from `lib/tab-helper.js` instead.
- **Safari prompts for permission each time the extension opens a marketplace tab** (CardRush, PriceCharting, Collectr, TCGPlayer). The user must click **Allow** for each domain the first time. Chrome does not prompt because `host_permissions` in `manifest.json` grants access at install time. Safari may not honor `host_permissions` the same way — test all 4 scrapers on Safari after changes and document any permission prompts the user must accept.

### When NOT to worry about Safari

- Pure logic changes in `lib/`, `utils/` that don't touch Chrome APIs — these are shared 1:1.
- Test-only changes in `tests/` — tests run in Node/Vitest, not in the browser.

## Critical: Fallback Consistency

The cross-language matching in `lib/tcgdex-client.js` (`findCrossVersionCard`) has **three matching paths** that must stay consistent when adding or changing filters:

1. **Main search path** — search by card name, then filter by dexId, localId, rarity, HP.
2. **Set scan fallback** — when name search returns 0 results, scan all cards in the target set, then filter by dexId, HP, rarity.
3. **DexId search fallback** — when name search returns 0 results and a dexId is available, search by dexId, then filter by HP, rarity.

When adding a new filter (e.g. rarity, HP, set mapping), **apply it to all three paths**, not just the main one. Otherwise, cards that fall through to a fallback path will bypass the new filter and produce incorrect matches.

### Filters applied in each path (current state)

| Filter | Main search | Set scan fallback | DexId search fallback |
|---|---|---|---|
| Set code / JP_TO_EN_SET_MAP | Yes | Yes (uses set code directly) | No (searches by dexId) |
| DexId | Yes | Yes | Yes (search key) |
| LocalId | Yes | No | No |
| HP | No (only in direct lookup validation) | Yes | Yes |
| Rarity (SIR↔SAR normalized) | Yes | Yes | Yes |

When changing a filter, update the corresponding test in `tests/cross-version-matching.test.js` to cover all 3 paths.

### Rarity normalization

Gemini and TCGdex use different rarity naming conventions. The `TCGDEX_TO_CARDRUSH_RARITY` map in `utils/constants.js` bridges JP and EN rarities to a shared short code. Additionally:
- `SIR` (Special Illustration Rare) and `SAR` (Special Art Rare) are the same tier — normalize before comparing.
- Candidates with no rarity field are kept (cannot verify, do not exclude).

## Gemini Vision

- Gemini runs first, reads card text from the image.
- TCGdex provides metadata (HP, dexId, rarity, images) — these are authoritative over Gemini.
- Gemini's `rarityCode` is used as fallback when TCGdex returns `rarity: "None"` (common for JP high-class sets).
- Gemini's `crossSetCode` / `crossCardNumber` enable a fast direct lookup path, but are validated against dexId and HP before acceptance.
- If Gemini returns a wrong JP name, the name search fails and the set scan fallback handles matching.

## JP-to-EN Set Mapping

`JP_TO_EN_SET_MAP` in `lib/tcgdex-client.js` maps JP set codes to EN TCGdex set IDs. An auto-derive function (`deriveEnSetIdFromJpCode`) handles the standard Scarlet & Violet pattern (`SV{n}` → `sv0{n}`, `SV{n}A` → `sv0{n}.5`). The explicit map overrides auto-derive for edge cases.

`EN_TO_JP_SET_MAP` is the reverse map (auto-built from `JP_TO_EN_SET_MAP`), used when finding JP counterparts of EN cards. `getJpSetCodeForEnSetId()` looks up the reverse map.

### ⚠️ Hard-coded set mappings — known limitation

The explicit map is **hard-coded** and only covers sets added manually:

```js
const JP_TO_EN_SET_MAP = {
  'SV8A': 'sv08.5',
  'SV8': 'sv08',
  'M2a': 'me02.5',
};
```

**When a new set pair is not in this map, cross-language matching may fail** because the set filter cannot narrow candidates to the correct counterpart set. The auto-derive function only covers the `SV{n}` / `SV{n}A` pattern — non-Scarlet & Violet sets (e.g. `M2a`, `S6K`, `MEW`) must be added manually.

**When to add a new entry:**
- A user reports a wrong cross-language match.
- The log shows `set matching candidates: [...]` without the correct JP/EN set code.
- The set code does not match the `SV{n}` / `SV{n}A` pattern.

**When adding a new entry, always:**
1. Add to `JP_TO_EN_SET_MAP` (JP code → EN TCGdex set ID).
2. `EN_TO_JP_SET_MAP` updates automatically.
3. Add a test in `tests/set-mapping.test.js`.
4. Run `npm test`.

## Direct Lookup Validation

When Gemini provides `crossSetCode` + `crossCardNumber`, the extension fetches the counterpart card directly. Before accepting, it validates:
- If source has `dexId`, candidate **must** also have `dexId` and it must match.
- If source has `hp`, candidate **must** also have `hp` and it must match.

This prevents accepting a trainer card (no dexId/HP) when the source is a Pokemon card.

## English marketplace name and number

For a Japanese scan, Collectr and TCGPlayer must search the English printing: `resolveEnMarketTarget`
(`utils/card-lookup.js`) takes the index target when the index resolved one, otherwise the TCGdex card from the C5
path. `buildEnMarketNumber` builds that counterpart's number and `extractLocalIdFromNumber` gives the local id the
listing selection uses, so the query and the selection always agree — passing the scanned local id instead made the
selection miss and fall back to the first listing. CardRush keeps the scanned local id (it sells the Japanese
printing) and PriceCharting keeps the scanned number plus the set token. Pass the same name the query used to
`pickListingByLocalId` as well: after the number it ranks by card name, because CardRush's search is fuzzy (a query
for one printing returns every printing in the set) and a number-only match showed another card's price when the
wanted printing was sold out.

## Marketplace query timing (deliberate)

The marketplace scrapers fire in parallel with the TCGdex fetch, and a marketplace query is never gated on the
TCGdex result. The scrapers are the slow part of a lookup, so TCGdex currently overlaps them for free; gating
would add its full duration to every scan (observed TCGdex runs of several seconds when Gemini misread the set
code). Trust comes from the **local** Bulbapedia index instead: an EN scan's matched record carries the scanned
EN card as its source, so `pickPricechartingSetToken` takes the set name from there, and
`rankPricechartingListings` picks the right row by card name, printed number, and set. See
`docs/APP_DOCUMENTATION.md` §6.4 before changing this ordering.

## CardRush Extractor

CardRush pages may render in Japanese or English. The extractor in `content-scripts/cardrush-extractor.js` supports both:
- Price: `円(税込)`, `円(tax included)`, or bare yen.
- Stock: `在庫数` (JP) or `Quantity in stock` (EN).
- Condition: `状態A-`/`状態B` (JP) or `[Condition A-]`/`[Condition B]`/`[Condition C]` (EN).
- Product name: `【SAR】{212/187}` (JP) or `[SAR] { 212 / 187 }` (EN).
- Only real search results are extracted: product links inside a "recently viewed"/recommendation section (by section id/class or heading) are skipped, and a lenient listing is only kept when its price parses. Otherwise a no-results search page returned its history tiles as fake listings.
- **The injected function must be self-contained.** `chrome.scripting.executeScript({ func })` serializes only the
  function it is given, so a helper defined beside it in the same file is `undefined` inside the marketplace page
  and every call throws. While the "recently viewed" helper lived at top level, extraction silently returned `[]`
  on pages that did have results (the link-count poll passed first, so the log read "found 59 product links" then
  "extracted listings: 0") and the CardRush block showed "No card found" for cards that were on sale. Keep such
  helpers nested inside the injected function; `tests/extractor-injection.test.js` fails if an injected extractor
  calls a sibling top-level function.

## UI conventions

- Icon-only buttons (📋 copy, ⚙ settings, 🔍 search, the badge ⓘ) need an `aria-label`; `title` alone is not
  enough. The badge's decorative SVG uses `role="img"` + `aria-label` on its wrapper so the tooltip text is
  exposed.
- Status areas (`#statusArea` in popup/scanner, `#apiKeyStatus` in settings) carry `role="status"` so progress
  and results are announced.
- Keyboard focus is shown by the global `:focus-visible` ring in `assets/shared.css`; never hide it. Do not
  programmatically focus a field after a scan, though: a focused text input always draws that ring, and on a
  field the model just filled it reads as an error. Enter runs the lookup from anywhere instead — the scanner's
  Enter handler is on `document`, not on the field or the section.
- Clickable rows should be real links or buttons, not `<li>` elements with a click handler (the popup history
  renders an `<a>` when a product URL exists).
- Never leave a button disabled: a handler that shows "Searching..." must restore the button on every path,
  including a failure. The scanner's Look Up button and the cross-version Look Up Price buttons `.catch()` the
  lookup promise and show `Lookup failed: ...`, and `sendMessageSafely()` in `utils/card-lookup.js` degrades a
  rejected `chrome.runtime.sendMessage` (dead service worker) to `{ success: false }` so it cannot abort a
  lookup. `onLookupClick` also ignores a second call while one is running, so the auto look-up and a click
  cannot start two lookups.

## Build / Test

During development the Chrome extension loads directly from source files via `chrome://extensions` (Developer mode): reload the extension and re-scan. For a clean package, `npm run build:chrome` writes `build/chrome/` (only the runtime entries: `manifest.json`, `assets`, `background`, `content-scripts`, `data`, `lib`, `popup`, `scanner`, `settings`, `utils`, `vendor`; the development-only JSON/txt under `data/bulbapedia` are skipped) — load that folder with **Load unpacked**. `build/` is gitignored.

`design/` holds source artwork that the extension never loads at runtime (for example the wide
`logo-wide.png` that the square `assets/icons/logo_square.png` was cropped from). It is kept in the repo so
icons can be re-exported, and it must stay out of both builds: `scripts/build-extension.mjs` copies only
`RUNTIME_ENTRIES`, and `safari/build-safari.sh` excludes `design` from its rsync. The Xcode project
references `assets` straight from the repo root, so an asset dropped into `assets/` ships inside the
`.appex` even when nothing references it — put unused artwork in `design/` instead.

### Safari Build

The Safari port lives in `safari/` (Xcode project generated by `xcrun safari-web-extension-converter`). Core logic is shared — no code duplication.

```bash
./safari/build-safari.sh   # sync + build macOS .app
```

The script:
1. rsync extension source → `safari/.../Resources/` (excludes node_modules, tests, docs, `data/bulbapedia/**/*.json|jsonl|txt`, etc.). Only `data/` is consumed from this copy — every other folder is referenced straight from the repo root.
2. xcodebuild → `.app` (ad-hoc signed)
3. Writes two gitignored outputs: the packaged `build/safari/PokemonTcgScanner.app` and an unpacked
   `build/safari/extension/` folder (the runtime entries only, same as the Chrome build)

`npm run build:safari` runs the same script. Safari → Develop → **Add Temporary Extension** takes the
extension folder itself — select `build/safari/extension`, not the folder holding the `.app`.

The built `.appex` must contain `data/bulbapedia/set-era-map.js` and one `counterpart-index.js` per era; check with
`ls "$APPEX/Contents/Resources/data/bulbapedia"` after a build if the Bulbapedia feature looks disabled on Safari.

To test: open `.app`, then Safari → Settings → Extensions → enable.

To distribute: copy `.app` to friend's Mac, they run `xattr -cr /path/to/PokemonTcgScanner.app`, double-click, enable in Safari.

### Releases

```bash
npm run release:package   # build + zip the release artifacts into build/release/
```

`scripts/package-release.mjs` writes two gitignored zips: the unpacked extension (one zip serves Chrome
"Load unpacked" and Safari "Add Temporary Extension", because both builds are identical) and the `.app`
zipped with `ditto` so the bundle layout survives. Build the Safari app first, or the script skips the app
zip. Attach both files to a GitHub Release; they never enter git history, so the repo stays at source size
and the committed tree can never drift from the source.

### Unit Tests

The project uses [Vitest](https://vitest.dev/) for unit testing critical logic. Tests live in `tests/`.

```bash
npm test                     # run all tests once
npm run test:watch           # run in watch mode
npm run bulbapedia:fixtures       # refresh revision-pinned Bulbapedia and TCGdex fixtures
npm run bulbapedia:generate       # regenerate the fixture-based index, source manifest, and review report
npm run bulbapedia:crawl-era -- <era>         # crawl one era's categories into .cache/bulbapedia/<era> (rate-limited)
node scripts/bulbapedia/crawl-era.mjs <era> --incremental   # refresh only new/changed pages (revision-id check)
npm run bulbapedia:generate-era -- <era>      # regenerate one era's artifacts from the cached crawl
npm run bulbapedia:bundle-era -- <era>        # wrap the approved index as a loadable script (requires review-decisions.json approval)
npm run bulbapedia:set-era-map                # rebuild data/bulbapedia/set-era-map.js (set code / name -> era) after any era changes
node scripts/bulbapedia/measure-en-gap.mjs <era>      # measure the English-category gap of a JP-category era (English sets + Japanese deck products to add)
npm run bulbapedia:sample-review-era -- <era> # seeded random-sample cross-check of targets against live TCGdex
node scripts/bulbapedia/print-gold-pairs.mjs <era> [--new]   # per-relationship sample pairs with art URLs for the review gate (--new: only relationships not in review-decisions.json)
node scripts/bulbapedia/inspect-era-sets.mjs <era>    # list the set names found in a crawled era (used to build SET_CATALOG)
```

Eras live in `scripts/bulbapedia/era-config.mjs` (`dp`, `bw`, `hgss`, `xy`, `sm`, `swsh`, `sv`, `m`) and each one keeps its own
cache, artifacts, and review decision:

```
.cache/bulbapedia/<era>/        # raw crawls (categories + page batches)
data/bulbapedia/<era>/          # counterpart-index.json, reports, review-decisions.json, counterpart-index.js
```

Adding an era: verify its Bulbapedia categories exist, add them to `era-config.mjs`, add the JA and EN
set names to `scripts/bulbapedia/set-catalog.mjs`, crawl, run `inspect-era-sets.mjs` to confirm no set
name is missing from the catalog, generate, review the gold pairs with the user, then bundle, then run
`npm run bulbapedia:set-era-map` so the runtime can load the new era's bundle on demand.

Shipped eras: `dp`, `bw`, `hgss`, `xy`, `sm`, `swsh`, `sv`, `m`. The EX series, the e-card series and the
Wizards/Base sets are still out of scope (user decision) — see the plan's "Remaining eras" section before
starting one.

Data gaps (plan's "Deferred data gaps" table has the details):
- SWSH `S2a`, `S5a` and `S3` shipped 2026-09-19 (86 + 96 + 119 records). Bulbapedia names them
  `Category:Explosive Walker cards` (S2a), `Category:Peerless Fighters cards` (S5a) and
  `Category:Infinity Zone cards` (S3). `S3` was never in the config — a real scan found it.
- XY11a was a fixed bug, not a gap: the `xy` config used to point it at S2a's category, so it had 0 records.
  It is really `Fever-Burst Fighter` (`Category:Fever-Burst Fighter cards`) and is bundled again.
- Generations ↔ BREAK Starter Pack shipped 2026-09-19 (65 records). The deck prints no set code, so
  `printsNoSetCode: true` flows from `set-catalog.mjs` through the generator and the bundler into the index, and
  `buildCardrushKeyword()` queries CardRush by the Japanese card name (`MフシギバナEX 002`).
- SM `SM1p` (Enhanced Expansion Pack Sun & Moon) and `SM1D` (Sun & Moon Starter Set) shipped 2026-09-19 (40 + 17
  records). The `SM1p` category is `Category:Enhanced Expansion Pack Sun & Moon cards` — the parser reads the
  set name from the template's *first* parameter, so the catalog key is `Enhanced Expansion Pack Sun & Moon`.
  `SM1D` is a deck and carries `printsNoSetCode: true`.
- SV `White Flare` (SV11W) and `Black Bolt` (SV11B) shipped 2026-09-22 (162 + 161 records, plus 20 cross-set and
  5 promo pairs). The category config and the crawl already had both sets; three other layers were wrong: the `en`
  catalog map had no entry for either set, the parser read the combined Japanese expansion name
  (`{{TCG|Black Bolt/White Flare|White Flare}}`) instead of the per-printing display name, and
  `filterSourcesBySetNames` dropped every printing whose `ja.setName` was not the era's set name. The display name
  is only used when the catalog knows it, because the same template also carries prose ("the Japanese expansion
  with the same name"). One sample flag is open by design: `en:SV11W:WHITE_FLARE:112/086` carries Bulbapedia's
  `バニプッチ` for Vanillish (TCGdex says `バニリッチ`); the pairing matches on card name, number and HP, so the
  record is kept rather than excluded.
- All seven known gaps are closed. Bulbapedia off-by-one rows are dropped through each era's
  `exclusions.json`: Guardians Rising 36 Alomomola and Burning Shadows 168 Basic Darkness Energy (`sm`),
  Ruler of the Black Flame 141/108 Basic Fire Energy (`sv`), and Fusion Strike 281/264 + 282/264 (`swsh`).
  2026-09-22, from the full validation pass: Sun & Moon 93 Ribombee (TCGdex SM1S-043 is Kangaskhan, Ribombee is
  SM1S-042) plus Guardians Rising 168 and Crimson Invasion 124 Basic Energy (their Japanese sets hold 61 cards in
  total, so local id 062 does not exist) were added to the `sm` list.
- Card names go through `stripHtmlTags` in `bulbapedia-parser.mjs`, because Bulbapedia marks the second half of a
  Z-move name with `<small>` ("ヒコウZ <small>エアスラッシュ</small>") and the tag otherwise travels into the index and
  from there into the marketplace queries.
- `MEP Black Star Promos` cannot be verified against TCGdex above local id 089: the API answers with a stub (or
  404) for those ids, which is why `M6 080/076 Kyogre -> MEP 117` and 14 more MEP records stay open. That is a
  TCGdex coverage gap, not a wrong row - do not drop those records over it. The same stub pattern appears on a few
  other cards (`swsh1-036`, `SM2K-062`) and on TCGdex's EN record for `xy12-109`, whose name is still Japanese.
- The DP era shipped 2026-09-23 (509 exact records + 1,074 `enToJa`, bundled). It is the only era crawled from
  its **English** categories: Bulbapedia's DP card pages carry both printings while TCGdex has no Japanese DP
  set, so `era-config.mjs` lists the English `categoryTitle` but the **Japanese** `setName` the English set pairs
  with (the generator's per-era printing filter keys on `ja.setName`), and the English name lives in
  `SET_CATALOG.en`. Only 7 of the 13 configured set codes produce **exact** records: Bulbapedia prints no
  `jpcardno` for the six early sets (`DP1` Space-Time Creation, `DP2` Secret of the Lakes, `DP3` Shining
  Darkness, `DP4` Dawn Dash/Moonlit Pursuit, `DP5` Cry from the Mysterious/Temple of Anger), and those numbers
  exist nowhere on Bulbapedia (the card pages omit `jpcardno`; the set pages list `None`), so a `ja` source key
  can never be built for them. Those cards are covered the other way round instead: `enToJa` also accepts an
  EN→JA candidate whose JA target has a set but **no card number**, which is what the runtime needs to stop
  guessing. Covered exactly: `DP6` Intense Fight → Stormfront, `DPt1`-`DPt4` → Platinum/Rising
  Rivals/Supreme Victors/Platinum: Arceus (Bulbapedia's name for the Arceus set), and the `DP-P`/`DPt-P` promos.
  Deck products and English sets outside the era (POP Series, the EX sets) stay out through the catalog, like the
  other eras. Two `conflicting-source-metadata` rows are dropped fail-closed (Bulbapedia duplicate numbers: Beat
  of the Frontier `038/100` and Advent of Arceus `010/090`; the set lists confirm Electivire FB and Burmy own
  them, so the Electivire FB and Burmy rows are lost with the wrong ones). 24 of the 498 checked targets are
  TCGdex naming artifacts (`LV.X` dropped on some sets, form/cloak suffixes added, SP `4` vs `E4`), left
  fail-closed at runtime by user decision - see `data/bulbapedia/dp/review-decisions.json`.
- **An `enToJa` record whose JA target has no card number must fail closed.** TCGdex has no card for those sets,
  so its name search can only return a different printing: a real scan of EN `Great Encounters 3/106 Darkrai`
  came back as `SM5S-031` (Ultra Sun Prism Star), because the search fell through to a name+dexId+rarity match in
  another era once its set filter matched nothing. `utils/card-lookup.js` therefore treats such a hit as
  `indexKnowsJpSetWithoutNumber`: `buildBulbapediaJpVersion` returns null without a `localId`, and all three
  `findJpVersion` searches are skipped. The section then shows no Japanese Version rather than a wrong card.
  Adding a card number is what would let it render again, so never invent one. The five eras regenerated on
  2026-09-23 (`hgss` +1, `xy` +31, `sm` +3, `swsh` +1, `sv` +5) carry 41 more such records, all promo or subset
  printings (`XY-P`, `SM-P`, `S-P`, `SV-P`, `L-P`, Shiny Treasure ex); every exact record and every gold-pair
  proposal stayed byte-identical, so their artwork approvals still stand.
  Verified on real Chrome scans 2026-09-23: EN `Great Encounters 3/106` (read as `Darkrai LV.38`) and `4/106`
  (LV.40) each resolved to `dp4-3` / `dp4-4`, PriceCharting enriched `darkrai-3` / `darkrai-4` (the printed
  number, not the level, tells them apart), TCGPlayer returned a listing, and the log showed
  `JP version search skipped: the index knows the JP set but not its card number` before the `hit` report.
  Also verified on **Safari** 2026-09-23: a manual `JTG 003/159` returned the right card with the Japanese
  Version **Verified**, which covers the shared `utils/constants.js` table, the resolver alias, the language
  inference, the indexed source fetch and the parallel era loader in that browser too. A camera/snapshot scan and
  the DP-era bundles are still only verified on Chrome.
- **Eras that crawl JP set categories miss the EN pages whose JP printing is a deck or another product - fixed for
  `sv` (phase 1) and for `sm`, `swsh`, `m` (phase 2) on 2026-09-23.** Bulbapedia only files a page under a
  Japanese set category when its JP printing is that expansion, so 273 English `sv` pages had no record at all
  (Journey Together 52, Obsidian Flames 49, Prismatic Evolutions 34, Stellar Crown 34, Scarlet & Violet 27, ...);
  `Journey Together 6/159` (Petilil, JP `Generations Start Deck Reshiram ex & Amoonguss ex 007/175`) was one. The
  fix has three parts: the 12 affected **English categories** are in `SV_SET_CATEGORIES`, their 25 **deck products**
  are in `SET_CATALOG.ja` with `printsNoSetCode: true` (Start Deck 100 Battle Collection uses TCGdex's real `MC` id,
  774 cards, so its pairs validate; the rest are marketplace-only), and those deck names are listed in the era's new
  **`extraSetNames`** field. That last part is essential: `filterSourcesBySetNames` keeps a printing only when its
  `ja.setName` is listed, and a deck has no category of its own, so the first generate with only the English
  categories produced **zero** new records. Result: 2081 -> 2354 crawled pages, 6127 -> 6507 records, 345 -> 667
  `enToJa`. Sample review 265 checked / 0 flagged; the full pass after the change was 6384 checked / 16 flagged
  (0.25%), all known artifacts and none from the new records: 11 transient TCGdex 503s that re-checked clean, 4
  Bulbapedia Japanese-name typos (Dedenne, Wash Rotom, Vanillish x2) and 1 page-level HP. Conflicts went 1 -> 18
  because two product *lines* repeat numbers across their member decks
  (`ex Starter Sets` 001/023 is both Alomomola and Shroomish; `Stellar Tera Type Starter Sets` 001/022 is both
  Mantine and Vulpix) - the generator drops those fail-closed, and their non-colliding numbers still ship records.
  The user approved the 37 new relationships on 2026-09-23 after reviewing them as 14 product rows with artwork.
  **Phase 2 (2026-09-23) did the same three parts for `sm`, `swsh` and `m`**: 19 more English categories (4 / 11 / 4)
  and 28 more deck products in `SET_CATALOG.ja` (4 / 17 / 13, none of them on TCGdex, all `printsNoSetCode` with
  their names in the era's `extraSetNames`). Measured: `sm` 2148 -> 2208 pages, 4813 -> 4889 records, 181 -> 260
  `enToJa`; `swsh` 2206 -> 2422 pages, 4595 -> 4758 records, 1627 -> 1849; `m` 798 -> 897 pages, 1756 -> 1789
  records, 57 -> 101. Sample reviews: `swsh` 274 / 0, `sm` 247 / 1 and `m` 73 / 1, both known artifacts (the Basic
  Metal Energy naming, and the MEP coverage gap that must not be dropped). Conflicts grew only from the `V Starter
  Sets` line product (23 in `swsh`, 2 in `m`): its `001/023` belongs to three different cards (Celebi V, Shellder,
  Vulpix), so the generator drops those keys fail-closed. Note that some of those pairings are cross-era by nature
  (a reprint deck on the same page, e.g. `XY Beginning Set` -> Kalos Starter Set, `Battle Strength Decks` -> Black
  & White) - that is the Bulbapedia data, not a wrong row. Measure with
  `node scripts/bulbapedia/measure-en-gap.mjs <era>` before touching another era.
  Measure before starting `sm`/`swsh`/`m`: the same 3-part change applies, and `print-gold-pairs.mjs` now reads the
  card's own TCGdex `image` field for the review links (deriving the path from the set id 404s: `sv03` and `svp`
  both live under `sv`, and `MC` cards have no Japanese image at all).
- **An index miss is slow.** `utils/card-lookup.js` retries a miss with every era loaded
  (`ensureAllBulbapediaIndexes`), and the TCGdex fallback then set-scans a whole Japanese set when the English name
  finds nothing (132 cards for `SV9`, 8 at a time), because TCGdex JA names are Japanese. Nothing deadlocks: the
  loader catches every failure, the service worker answers `{success: false}` on error, and a lookup always settles
  (locked by a test in `tests/bulbapedia-resolver.test.js`). 2026-09-23: the bundles are now injected **in
  parallel** instead of one after another (11.8 MB in total) and the progress step reports `Loading every set...`
  while that happens. The set scan is still the slow part, and it only disappears once the card is in the index
  (see the coverage gap above).
- Every era now has a `fullValidationReview` block in its `review-decisions.json` (from the 2026-09-22 `--all`
  passes, plus dp's 2026-09-23 pass). Read it before touching a flagged relationship: it lists what was fixed and
  what is a known source or API artifact.
- The sample validator normalizes names with NFKC, drops a trailing parenthesis and keeps letters from every script
  (`scripts/bulbapedia/sample-review.mjs`). NFKC stops Japanese names collapsing to an empty string on one side only
  (`Ｎのゾロア` vs `Nのゾロア`), and the parenthesis covers TCGdex disambiguating same-named cards
  (`博士の研究（オーリム博士）` for Professor's Research, `ボスの指令（ゲーチス）` for Boss's Orders) and a trailing
  bracket (`ナッシー[Exeggutor]`). It takes
  `--relationship <jpSetCode->enSetId>` with `--all` to validate one relationship end to end (how the two Fusion
  Strike rows were found), and `--json <path>` for a full pass, which writes every result plus a `.jsonl` beside it
  and logs progress. Each request has a 15 s timeout and two retries, because a single slow response used to end a
  full run: a 6,277-record pass died after 55 minutes on `UND_ERR_HEADERS_TIMEOUT`. A 404 after every padding variant
  is re-asked once after a short wait before it is reported, because TCGdex also answers 404 during short outages:
  the `swsh` pass collected 262 such flags in one burst and every one of those relationships re-checked clean.
- A catalog `tcgdexSetId` that points at the wrong set is worse than a missing one, because the runtime then links
  the wrong card. Check it against TCGdex before trusting a flag cluster: `Shiny Treasure ex` pointed at TCGdex JA
  `SV4a`, which is actually Raging Surf, so every high-numbered target 404'd (18 flags) and the ones that resolved
  returned a different card. `tcgdexSetId: null` is the correct value when TCGdex lacks the set, and it moves those
  records to the `enToJa` map (marketplace keyword only).
- `bundle-index.mjs` drops `evidence`, the per-record `status` and the per-side `cardKind` from the runtime
  bundles (nothing in the runtime reads the last two, and it saves about 2.3 MB across the eras). It refuses to
  bundle when a record is not `structured`, so dropping the status stays lossless. The JSON review artifacts
  keep every field. It **keeps `tcgdexSetId` on an `enToJa` source side** (about 0.13 MB across the eras): that is
  the scanned EN card, and the runtime needs its set to correct a misread printed code (see below). `enToJa`
  targets never have one, which is exactly what makes those records marketplace-only.

For an English scan the index supplies the source fetch's set, so the scanned set code and set name are only
hints: `getIndexedSourceCorrection` feeds `{setCode, localId, setName}` from the index's source side into the
**first** `FETCH_CARD_INFO` call. That matters twice. The model misreads DP-era codes (`DPBP` is the `DPBP#`
label printed next to the number; it used to fuzzy-match `dp1` and burn six requests before the setName fallback),
and a manual lookup often has no set name at all (the scanner's form requires the card number but the set name is
a separate optional field). When the code is wrong and the name is empty, the resolver still hits through its last
resort - the full printed number plus the card name (`3/106` + `Darkrai`) - and the correction then fetches the
right printing. A bare local id without the `/total` cannot be rescued that way, because a number alone is
ambiguous across sets. If the number, the name and the code are all wrong, nothing resolves it: that is the
fail-closed outcome, not a bug.

A manual search (`popup.js` → `#manual` → the scanner form) carries no language hint, and `lookupCardAndPrice`
defaulted to Japanese - so an English card typed as `JTG 003/159` was queried in JA first and the reviewed
counterpart was never found (a real report: the JP section showed the right card but as **Unverified**, after a
132-card set scan). Two things now fix that, and both are needed:
- `EN_ABBREV_TO_SET_ID` lives in `utils/constants.js` (not `lib/tcgdex-client.js`), so the popup, the scanner and
  the resolver share it. `getEnSetIdForPrintedCode('JTG')` → `sv09`; a JP code (`SV9`, `M2a`) is not in the table,
  which keeps the JA default right. The generated 188 entries left out the three promo sets whose abbreviations are
  the set codes the index stores, so `DPP` → `dpp`, `HSP` → `hgssp` and `SWSHP` → `swshp` were added by hand
  (2026-09-23); without them a manual `DPP DP01` was queried in JA first and never matched.
- the language is inferred from the set code when there is no hint (a known EN abbreviation means English), and the
  resolver receives that id as `setCodeAliases`, matching the group keyed by the source's `tcgdexSetId`.

Adding the card name (and an explicit `EN` suffix) still works as a manual hint: `Butterfree JTG 003/159 EN`. The
name alone is not enough - without the alias the resolver cannot bridge `JTG` → `SV09`, and a number-only match is
not a safe fallback: 38.7% of EN-source card numbers are duplicated across the index (`003/159` alone has two
records), which is exactly why the last-resort path requires a name.

TCGdex JA lists the HGSS and XY sets but contains **no cards** for them, and it has no DP set at all, so
their JA catalog entries keep `tcgdexSetId: null` (same as BW). That makes EN→JA candidates "marketplace only"
(`enToJa`) and keeps the JA→EN records validatable against TCGdex EN.

A printed code that is already a TCGdex set id (e.g. `me05`, `SWSH1`) skips fuzzy abbreviation
matching (`findSetIdByExactCode`), because the fuzzy path mapped `me05` to the BW trainer kit and
cached that wrong mapping. Hard-coded printed abbreviations (`NXD`, `DEX`, ...) are still checked first.

Counterpart validation fetches the target in the target's own language (`target.language`), and the
name check compares `japaneseName` for JA targets. The name normalizer keeps letters from every script
(`[^\p{L}\p{N}]`), so Japanese names compare instead of collapsing to an empty string.

`crawl-era.mjs --incremental` queries page revision ids in batches and re-fetches content only for pages
that are new or changed (`selectPagesToFetch`), which keeps a full era refresh cheap while sets are still
releasing. The artifacts stay byte-identical when nothing changed.

Keeping an era fresh (run about weekly, and when a new set is announced — `m`, `sv` are still releasing):

```bash
node scripts/bulbapedia/crawl-era.mjs <era> --incremental   # seconds when nothing changed
npm run bulbapedia:generate-era -- <era>                    # regenerate that era only
npm run bulbapedia:sample-review-era -- <era>               # re-check targets against live TCGdex
npm run bulbapedia:bundle-era -- <era>                      # re-bundle (needs review-decisions.json)
npm run bulbapedia:set-era-map                              # refresh the set code / name -> era map
```

If the refresh adds relationships, review the new pairs first: `node scripts/bulbapedia/print-gold-pairs.mjs <era>`,
confirm them, then update `data/bulbapedia/<era>/review-decisions.json` before bundling.

TCGdex lists some JA sets (every SWSH-era set, for example) with an official count but no cards, so a
miss there used to burn the whole fallback chain. `isSetKnownEmpty` / `rememberEmptySet` cache those sets
in `chrome.storage` under `emptySetCache`, and `fetchCardById` returns immediately for them.

Card identity uses the printed total: `fetchCardById` compares the total printed on the card
("2/83") with the candidate set's `cardCount.official` (`classifyCardCandidate` -> `hard`/`soft`/`reject`),
so a misread set code cannot win over the set whose count matches.

Card names come from the Bulbapedia **page title**, not the infobox `cardname`, because Mega/Primal/BREAK
printings carry their prefix only in the title (`M Houndoom-EX` with `cardname = Houndoom`) and the title
also keeps the `-EX` suffix. The resolver therefore normalizes print decorations away
(`normalizeBulbapediaCardName` strips leading `M`/`Mega`/`Primal` and trailing `EX`/`GX`/`BREAK`/`V`),
so a base-name read from Gemini still matches the decorated record name.

A printed **level** is dropped from every name the pipeline compares or queries (`stripPrintedCardLevel` in
`utils/constants.js`, applied at the top of `lookupCardAndPrice` and inside `isCardNameMatch`). DP-era cards print
it next to the name (`Darkrai LV.38`) and the model reads it in, which broke both the TCGdex name match
(`Darkrai != Darkrai LV.38` on every candidate, so the scan lost its card metadata) and every marketplace query
built from the name. A real scan of EN `Great Encounters 3/106` also showed the level poisoning the
PriceCharting query (`Darkrai LV.38 3/106 …`), where `extractPricechartingQueryLocalId` read the `38` out of
`LV.38` and enriched the wrong row (`gorebyss-38`); the extractor now prefers the `n/m` form over a bare number,
which also fixes card names that carry digits (`Porygon2 25/124`). Only a numeric level is stripped - `LV.X` is
a distinct card and stays, so those printings still cannot be told apart by name alone.

Test files and what they cover:

| File | Coverage |
|---|---|
| `tests/rarity-mapping.test.js` | TCGDEX_TO_CARDRUSH_RARITY mapping, JP↔EN equivalence, SIR↔SAR normalization |
| `tests/set-mapping.test.js` | JP_TO_EN_SET_MAP, deriveEnSetIdFromJpCode, getEnSetIdForJpCode, getEnSetIdForPrintedCode (printed abbreviation → TCGdex EN set id) |
| `tests/cross-version-matching.test.js` | findCrossVersionCard rarity filter across all 3 fallback paths (main search, set scan, dexId search) |
| `tests/direct-lookup-validation.test.js` | validateCrossVersionMatch (dexId/HP strict check), pickListingByLocalId (C3 CardRush/Collectr listing pick), shouldSkipJpTcgdexLookup + lookupCardAndPrice skipTcgdex (C6), hasJapaneseScript + lookupCardAndPrice EN query name (C5), resolveJpVersionImage + pickCrossVersionResultImage (C1 JP section image, CardRush first then other marketplaces), resolveCrossVersionProvenance + renderCrossVersionBadge (C2/C4 badge), renderProgressSteps |
| `tests/cardrush-extractor.test.js` | extractCardrushListings JP + EN formats, deduplication, lenient fallback |
| `tests/tab-helper.test.js` | pickCaptureWindow (hotkey snapshot must not capture a hidden scraper window) |
| `tests/pricecharting-scraper.test.js` | extractPricechartingQueryLocalId, orderPricechartingListingsByNumber (exact printing first) |
| `tests/bulbapedia-parser.test.js` | Offline parsing of revision-pinned set, Pokémon, Trainer, promo/reprint, and redirect fixtures |
| `tests/bulbapedia-generator.test.js` | Normalization, TCGdex target validation, provenance, conflicts, deterministic output, and generated artifact invariants |

Test infrastructure:
- `tests/chrome-mock.js` — in-memory stubs for `chrome.storage.local` and `chrome.runtime`.
- `tests/load-scripts.js` — loads extension script files (which use top-level `const`) into global scope via `vm.runInThisContext`.
- `tests/setup.js` — global setup, loads Chrome mocks.
- `tests/fixtures/bulbapedia/` — raw MediaWiki API snapshots; default tests never refresh them from the network.
- `tests/fixtures/tcgdex/en-sets.json`, `ja-sets.json` — raw set catalogs; generated target IDs must exist in one of them.
- `data/bulbapedia/` — deterministic counterpart index, source manifest, and review report generated from committed fixtures. Each era under `data/bulbapedia/<era>/` holds `counterpart-index.json` (review artifact, includes provenance), `counterpart-index.js` (runtime bundle without evidence), and `review-decisions.json` (review-gate approval).
- `lib/bulbapedia-index.js` — builds `BULBAPEDIA_INDEX.ja` / `.en` and exposes `ensureBulbapediaIndexes(query)`, which injects only the era bundle(s) the scan needs (about 12.4 MB across all eight eras, so popup/scanner never load them with static script tags). The era is resolved from the generated `data/bulbapedia/set-era-map.js` (set code / set name -> era, rebuilt with `npm run bulbapedia:set-era-map`); an unknown set loads every era, which is the safe fallback. Call `await ensureBulbapediaIndexes({ setCode, setName })` before resolving; already-loaded eras are skipped (tests load the bundles statically). A *resolution* miss while the index is still narrowed is retried once with every era loaded (`ensureAllBulbapediaIndexes`), because the set code may have been misread into another era's code; `utils/card-lookup.js` re-reads `BULBAPEDIA_INDEX` after that load, since `rebuildBulbapediaIndex()` replaces the language views.
- `scripts/bulbapedia/` — development-only fixture fetcher, parser, normalizer, validator, and generator; no extension runtime dependency.
- `lib/bulbapedia-resolver.js` — pure resolver used by `utils/card-lookup.js`; returns `hit`/`ambiguous`/`multi-target`/`miss` and never silently picks a candidate. On a validated `hit` (TCGdex confirms id/name/hp), the caller may adopt the TCGdex card as `enVersion` and use the target's name+number for TCGPlayer/Collectr queries; CardRush and PriceCharting keep the source printing's query. A record is grouped by the set code it stores **and** by the TCGdex set id its source side carries (only when the two differ, so a record never lands in one group twice and reads as ambiguous), and the caller passes `setCodeAliases` - the printed code resolved through `getEnSetIdForPrintedCode` - because the code printed on a card (`JTG`) is rarely the one the index stores (`SV09`).
- `utils/card-lookup.js` — CardRush is JP-only: `shouldQueryCardrush` skips it for EN scans (they reach JP prices via the JP Version section's Look Up Price button).
- `vitest.config.js` — uses `environmentMatchGlobs` to run CardRush extractor tests in `jsdom` (needs DOM), all others in `node`.

## Key Files

| File | Role |
|---|---|
| `lib/tcgdex-client.js` | TCGdex API, cross-language matching, set mapping |
| `lib/gemini-vision.js` | Gemini Vision API, card recognition prompt |
| `utils/card-lookup.js` | Lookup orchestration, direct lookup validation, result rendering |
| `docs/SEARCH_LOGIC.md` | Flow diagrams of the search logic (read before changing query or selection behavior) |
| `utils/constants.js` | Rarity mapping, set aliases, message types |
| `background/service-worker.js` | Message routing to TCGdex/Gemini/scrapers |
| `content-scripts/cardrush-extractor.js` | CardRush DOM extraction (JP + EN) |
| `safari/build-safari.sh` | Sync + build Safari macOS .app into `build/safari/` |
| `scripts/build-extension.mjs` | Build a loadable extension folder (`--out build/chrome`, `--out build/safari/extension`) |
