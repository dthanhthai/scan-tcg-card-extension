# Price History — Implementation Notes

Spec: `docs/PRICE_HISTORY_PLAN.md`. Scope of the current work: **Phases 1–2**
(the two extraction steps). Phases 3–5 (renderer, scanner UI, Safari pass) not
started.

## Status

| Phase | State |
|---|---|
| 1 — PriceCharting extraction | Implemented, unit-tested, **verified against a live scan** |
| 2 — TCGPlayer extraction | Implemented, unit-tested, **verified against a live scan** |
| 3 — Canvas renderer | Implemented, unit-tested, **visually verified on a demo page** |
| 4 — Scanner UI | Implemented, unit-tested, **verified against a live scan** |
| 5 — Safari pass | **Verified on a live Safari session** — all three lines render |
| + Collectr third line | Implemented, unit-tested, **verified against a live scan** |
| + Per-source line toggles | Implemented and unit-tested, **verified against a live scan** |
| + Fixes from real-card scans | All applied, **verified — all three lines draw** |
| + Shared listing picker (worker + scanner) | Applied, **verified — the picked printing is the one enriched** |

Nothing is committed yet.

Live log after both phases, on Black Kyurem ex (SSP 048/191):

```
[pricecharting] chart series: boxonly:23, cib:23, graded:23, manualonly:23, new:23, used:23
[tcgplayer] chart series: Holofoil:52
```

## Shared decisions

- **No `service-worker.js` change for either source.** `handleMessage` returns
  the scraper's object wholesale, so chart data rides along on
  `data.listings[0]`. The plan listed this file as changed; it is not.
- **Both sources hand the renderer cents** as `[[timestampMs, priceCents], ...]`,
  even though TCGPlayer's API reports dollars. One unit keeps the renderer simple.
- **Failure is silent.** A shape change, a 403 or a missing id yields `null` and
  the chart draws whatever source did work.
- **Chart data is not written to scan history** (`addScanEntry` stores only a
  small entry), so it lives for the duration of one lookup.

---

# Phase 1 — PriceCharting

## Verified facts (live scan, 2026-09-26)

- `VGPC.chart_data` **is** present on Pokemon card detail pages, embedded in an
  inline `<script>`, and the parser reads it correctly.
- Card series keys: `used`, `cib`, `new`, `graded`, `boxonly`, `manualonly` —
  **not** `loose`. This supersedes the key list in plan §2.1 and §3.3, which was
  observed on a video game page.
- Observed shape: 23 monthly points per series on a Nov-2024 set (history starts
  at the set's release date), values `[timestamp_ms, price_cents]`.
- Scan log: `[pricecharting] chart series: boxonly:23, cib:23, graded:23,
  manualonly:23, new:23, used:23`.

## Deviations from the plan (Phase 1)

1. **Chart data is read from the inline script text in the DOM, not from
   `window.VGPC`.** `chrome.scripting.executeScript` runs in the ISOLATED world,
   where the page's own globals are not visible, so `window.VGPC` is `undefined`
   inside the injected extractor. Reading the `<script>` text works in both
   Chrome and Safari and needs no manifest change. `world: 'MAIN'` would also
   work but requires Safari 17+, loses the `chrome.*` APIs, and puts the page CSP
   in charge — rejected here.
2. **No chart read in the sync detail path of `extractPricechartingListings`.**
   Enrichment always runs for `listings[0]` and overwrites, so adding it there
   would be dead code and would force a second copy of the parser into another
   injected function (sibling calls are unavailable in the injected context, and
   `tests/extractor-injection.test.js` enforces that).
3. **Log shape changed.** `[pricecharting] detail sales:` no longer prints the
   (large) chart payload; a compact `[pricecharting] chart series:` line reports
   the series keys and point counts instead.

## Things to know (Phase 1)

- `pricechartingChartData` is a map of series keyed by PriceCharting's own names,
  e.g. `{ used: [[tsMs, cents], ...], new: [...] }`.
- `normalizePricechartingChartData` drops series that are not non-empty arrays of
  `[number, number]` pairs and returns `null` when nothing is usable.

---

# Phase 2 — TCGPlayer

## Verified facts (reconnaissance, 2026-09-26)

- The chart is **not** fed from the DOM or from a chart library the extension
  could read. It comes from TCGPlayer's internal API.
- Endpoint: `GET https://infinite-api.tcgplayer.com/price/history/{productId}?range=...`
  (base URL from `VITE_TCGPLAYER_INFINITE_API_URL`; the client is axios with
  `withCredentials: true`). A `/detailed` variant exists but carries
  condition/language fields the chart does not need.
- `range` values the page uses: `month` (1M), `quarter` (3M), `semi-annual`
  (6M), `annual` (1Y). There is no "all" value; `annual` is the longest.
- Granularity follows the range: `quarter` returned 30 buckets ≈ 3 days each.
- **The API answers 403 to anything that is not a browser request from the
  tcgplayer.com origin** — plain `curl` fails on both `infinite-api` and `mpapi`
  (AWS ELB 403). Cookies and browser headers are required.
- Live payload shape (product 589874, Black Kyurem ex):

```json
{ "count": 30,
  "result": [ { "date": "2026-09-26",
                "variants": [ { "averageSalesPrice": "0.67", "marketPrice": "0.74",
                                "quantity": "8", "variant": "Holofoil" } ] } ] }
```

- Buckets are **newest-first**; prices are **dollar strings**, not numbers and
  not cents; each bucket holds one entry per printing. A holo-only card reports
  `Holofoil` alone — there is no `Normal` entry to fall back on.

## Deviations from the plan (Phase 2)

1. **The data is fetched from the API in the page's MAIN world, not read from
   the detail page DOM.** The plan offered "read the chart instance / intercept
   the XHR" (Approach A) or "call `mpapi` directly + change the manifest"
   (Approach B). Neither works: the chart instance is unreachable (isolated
   world, and the state lives in a Module-Federation Vuex store), and a
   service-worker fetch fails both CORS and the 403. Injecting a `fetch` into
   the open product tab satisfies cookies, origin and CORS at once, and needs
   **no manifest change** (`world: 'MAIN'` is already used by this codebase for
   the visibility override, so it is a proven pattern here).
2. **`range=annual` is requested once** and shorter periods are filtered when the
   chart is drawn, so the renderer can offer 3M/6M/1Y from a single request. The
   plan's "All" cannot be served: the API has no unbounded range.
3. **One printing is drawn**, chosen `Normal` → `Holofoil` → `Reverse Holofoil` →
   whatever exists, and the chosen name is kept so the legend can label the line.

## Things to know (Phase 2)

- `extractTcgplayerPriceHistory` is injected with `world: 'MAIN'` and reads the
  product id from `location.pathname`, so it takes no arguments.
- `fetchTcgplayerPriceHistoryFromTab` accepts both `results[0].result` and
  `results[0]` because Safari resolves the injected value directly instead of
  wrapping it in an InjectionResult.
- `tcgplayerChartData` is `{ variant, points }` where `points` is
  `[[timestampMs, priceCents], ...]` ascending — deliberately different from the
  Phase 1 map shape, because it is a single line.

---

# Phase 3 — Canvas renderer

`utils/price-chart.js`, no dependency added. Split deliberately:

- **Pure helpers** hold all the logic and are unit-tested in Node:
  `buildPriceChartSeries`, `filterPointsByPeriod`, `computeYBounds`,
  `formatUsdFromCents`, `formatAxisCents`, `formatChartMonth`, `formatChartDate`,
  `pickLabelIndices`, `pickNearestPointIndex`.
- **`createPriceChart(canvas)`** only draws and tracks hover. Returns
  `{ setSeries, setPeriodDays, destroy }`.

## Decisions

1. **Dates are formatted with the UTC getters.** Both sources store a date at UTC
   midnight, so local getters would render a first-of-month point as the last day
   of the previous month for any timezone behind UTC. Covered by a test.
2. **`buildPriceChartSeries` is strict about `used`.** PriceCharting's `used`
   series is Ungraded; if that key is missing the line is dropped rather than
   falling back to a graded series, which would be drawn under a lying label.
3. **"All" is gone**, as planned: the selector is 3M / 6M / 1Y
   (`CHART_PERIODS`, 90/180/365 days). Neither source can serve an unbounded
   range.
4. **Period filtering happens at draw time**, not at fetch time, so switching
   period never re-requests anything.
5. **The tooltip is drawn on the canvas**, so Phase 4 only has to supply a
   `<canvas>` and a period selector — no extra DOM for the crosshair.
6. **Y axis rounds to a nice step** (1/2/5 × a power of ten) and widens a flat
   series, so a single-price card is not pinned to the axis.
7. **A series with one point in range draws a dot**, not a zero-length line.
8. **Month labels sit on UTC month boundaries, and every hover dot sits on the
   crosshair.** The first version labelled the sampled indices of the series with
   the most points while the hover snapped to `series[0]`; with PriceCharting
   monthly and TCGPlayer weekly those are different days, so the labels read
   `Apr 4, May 9, Jun 13, ...` while the crosshair stopped on `Apr 1, May 1, ...`.
   Labels now come from `listMonthStarts` (thinned to a 64px gap, edges nudged
   inside the plot; a window shorter than a month falls back to its own ends), and
   the crosshair snaps to `mergeSnapPoints(visible)` — every sample of every
   source.
9. **The hover places each dot where the crosshair meets that series' line**,
   using `interpolatePriceAt`. Snapping the crosshair to one source left the other
   source's dot a few days to the side, which reads as misaligned. The trade-off,
   accepted deliberately: the tooltip price can be a value interpolated between
   two samples rather than a price that was actually recorded. Three variants were
   compared side by side (`union`, `aligned`, `guides`) and `aligned` was chosen;
   the other two and the temporary `hoverMode` option were removed.
   `pickLabelIndices` and `pickFinestSeries` went with them.
10. **A series gets no dot once its own data has ended.** `interpolatePriceAt`
   returns null outside the series' range instead of holding its last value.
   PriceCharting's monthly history stops at its last month while TCGPlayer's
   weekly one runs on, so stretching the ended line to the crosshair grew a dot
   past the end of the blue line (reported from a screenshot). The tooltip row goes
   with the dot: keeping it would print a price for a date that source has no data
   for. The same applies at the left edge, where TCGPlayer's `range=annual` starts
   after PriceCharting's history.
11. **The canvas is 220px tall** (was 180px) — the labels and two lines needed the
   room.
12. **The legend is the per-source toggle row.** Each entry is a real `<button>`
   carrying `aria-pressed`, and clicking it hides that line and its dots. A second
   row of three buttons would repeat the same three labels, and the legend already
   carries the colours, so it doubles as the state display (dimmed + struck through
   when off). Hiding a line also drops its samples from `mergeSnapPoints`, so the
   crosshair stops snapping to a line that is not on screen (measured: 119 snap
   positions with all three lines, 33 with Collectr hidden, 7 with TCGPlayer hidden
   as well). Hiding all three reads "All lines hidden" rather than claiming the
   card has no history. The toggles reset on the next scan — they are not
   persisted.
13. **An ⓘ hint leads the legend.** It follows the cross-version badge's contract
   (`role="img"` + `aria-label` + `data-tooltip`), so the text is reachable without
   hovering, and the CSS for both icons is now one grouped rule so the two cannot
   drift apart visually. It sits first in the legend row and its tooltip opens
   below, over the marketplace blocks.

## Verification

- 29 unit tests in `tests/price-chart.test.js` plus 10 jsdom tests in
  `tests/price-chart-mount.test.js`.
- The hover was checked without a browser through a canvas stub: across 64 hover
  positions, all 60 dots landed exactly on the crosshair (0 off-line), and past
  PriceCharting's last month the dot count drops to 1 with a single tooltip row.
- Draw path exercised without a browser through a canvas stub, which confirmed
  the call sequence (grid, date labels, both polylines, crosshair, empty state)
  and that `destroy()` removes the listeners.
- Visual check on a throwaway page at `/tmp/price-chart-demo` (not in the repo)
  with synthetic data shaped like the real scan: 23 monthly PriceCharting points
  and 52 weekly TCGPlayer points.

---

# Phase 4 — Scanner UI

## Where it lives

`#resultArea` in `scanner/scanner.html` is empty; everything inside it is built by
`renderCardResult()` in `utils/card-lookup.js`. The chart section is inserted
between `.result-header` (the card) and `.price-sources` (the marketplaces), which
is where the plan's mockup puts it.

## Preferences

The period and the hidden lines are a **viewing preference, not a property of the
card**, so they are remembered across scans in `chrome.storage.local` under
`STORAGE_KEYS.PRICE_CHART_PREFS` and shared by every chart on the page — hiding
Collectr in one block hides it in the other too. That also removed all per-chart
state: the mounted entries only carry their controller, canvas and buttons.

- **Storage is the source of truth.** A mount starts from the defaults and applies
  whatever is stored, so a stored period that no longer matches a button (say a
  period was removed) is ignored rather than leaving the chart stuck on it.
- **The mount is async** so the read lands before the first draw: the chart never
  flashes 6M and then jump to the remembered period. `card-lookup` awaits it at both
  call sites.
- **`price-chart.js` now depends on `constants.js`** for the storage key, so the
  tests load it through `loadExtensionScripts` in the same order `scanner.html`
  does. Loading it alone still works — `loadPriceChartPrefs` catches the missing
  `STORAGE_KEYS` — but the preference would silently never apply, which is exactly
  what a test caught.
- A preference that fails to save is swallowed: it is not worth failing a scan over.

## Decisions

1. **The section markup lives in `utils/price-chart.js`**, not in `card-lookup.js`:
   `renderPriceHistorySection(series, cardName)` returns the HTML and
   `mountPriceHistoryChart(container, series)` wires it up. `renderCardResult`
   therefore only gained three lines. It also keeps both functions testable
   without loading the whole lookup pipeline.
2. **Mounted after `container.classList.remove('hidden')`.** The canvas takes its
   size from its CSS box, and a hidden element has none, so mounting earlier would
   draw at the fallback 300×160 and never resize.
3. **Not collapsible.** The plan suggested collapsing on mobile, but the popup
   never renders a result — `renderCardResult` is only called from `scanner.js` —
   so there is no context that needs a collapsed default.
4. **The cross-version block gets a chart too** (added on request, superseding the
   original "leave it alone"). It renders its own `price-sources` HTML, so it now
   builds the same section through `buildResultChartSeries(result, label)` — one
   helper for both blocks, which also keeps the `[chart] <label> series:` log in one
   place.
5. **Several charts can be mounted at once.** The main result and each cross-version
   result each keep a chart, so the mount state moved from a single slot to a `Set`
   of `{ container, canvas, chart, periodDays }`. One shared `resize` listener
   redraws them all, attached on the first mount (this file is also evaluated by the
   node tests, which have no `window`). Entries whose canvas has left the page are
   pruned on the next mount or resize, which is what stops a long session — where
   every cross-version lookup replaces a block — from accumulating controllers.

   This replaced an earlier design with one slot and a listener per chart: mounting
   the cross-version chart would have torn down the main result's chart.

## Files

| File | Change |
|---|---|
| `utils/price-chart.js` | `CHART_DEFAULT_PERIOD_DAYS`, `renderPriceHistorySection`, `mountPriceHistoryChart`, `unmountPriceHistoryChart` |
| `utils/card-lookup.js` | `buildResultChartSeries`, insert `priceHistoryHtml`, call `mountPriceHistoryChart` (main and cross-version) |
| `scanner/scanner.html` | `<script src="../utils/price-chart.js">` |
| `assets/shared.css` | `.price-history*` styles |
| `tests/price-chart-mount.test.js` | 15 jsdom tests for the section markup, the mount, chart independence and the remembered preferences |

A11y: the period buttons are real `<button>`s carrying `aria-pressed`, the canvas
has `role="img"` with an `aria-label` naming the card, and the global
`:focus-visible` ring is left alone.

---

# Collectr price history (added after the plan)

The plan's §2.4 concluded Collectr has no historical data ("shows only the current
market price, no chart"). **That was wrong** — the explore product page has an
"Ungraded Price History" chart with 1M/3M/6M/1Y, and the card page also has a
"Graded Price History" one.

## Verified from the bundles (2026-09-27)
- Endpoint, from `app_layout-*.js`:
  `GET https://api-v2.getcollectr.com/catalog/products/{productId}?username={anonUsername}&details=true`
  (`details=false` is the inventory variant and does not carry the history).
- Auth, from the axios interceptor: `Authorization` is filled from the JS-readable
  `collectrToken` cookie, and `{anonUsername}` falls back to
  `00000000-0000-0000-0000-000000000000`, so anonymous access is supported.
- Response shape, from the chunk that builds the chart:
  `data.ungraded_sub_types[].product_sub_type` and
  `data.price_history[]` with `product_sub_type`, `grade_id` (`"52"` = ungraded),
  `insertion_date` and `price`. The page's transform keys by day and lets the last
  row win.
- The API sits behind a **CloudFront WAF** that answers 403 to every path for a
  non-browser client (`Request blocked`), including nonsense paths — so `curl`
  cannot even tell a real path from a fake one.

## Verified against a live scan (2026-09-27)

- The anonymous branch **does** return the history, so no session token is needed
  and none is read. Log:
  `[collectr] chart series: Holofoil:364, Holofoil:304, Holofoil:305`.
- The payload shape inferred from the bundles was correct — the normalizer needed
  no adjustment on the first run.
- Collectr's series is **daily**, so it carries far more points than the other two:
  ~364 for a card a year old, against 52 weekly for TCGPlayer and 23 monthly for
  PriceCharting. The line is correspondingly noisier; if it ever reads as clutter,
  downsampling this one source is the lever.

## Decisions

1. **Fetched in the page's MAIN world**, same reasoning as TCGPlayer: the request   has to come from the app origin to satisfy CORS and the WAF. No manifest change.
2. **Anonymous on purpose.** No session token is read, sent or logged — and the
   live scan confirmed the anonymous branch returns the history, so the cookie
   token path is not needed at all. If it is ever needed, it must never log the
   token.
3. **No new tab.** The extension already opens a Collectr window for the search, so
   the history rides along in that same tab; product ids come from the cards
   already on the page, so the injected function takes no arguments.
4. **Every listing gets its history attached**, not just the first: the lookup
   picks a listing in `card-lookup` (by card number), long after the scraper has
   returned, so the scraper cannot know which one will win.
5. **Violet (`#a78bfa`) for the third line.** With a red line already on the chart,
   green would be the pair red-green colour blindness cannot separate.
6. **Preferred printing order matches TCGPlayer**: Normal → Holofoil → Reverse
   Holofoil → whatever the product has, falling back to deriving it from the
   history rows when `ungraded_sub_types` is empty.


---

# Phase 5 — Safari pass

## Done without a browser

- `./safari/build-safari.sh` succeeds. The `.appex` carries `utils/price-chart.js`,
  the `scanner.html` script tag, the `assets/shared.css` styles, `set-era-map.js`
  and one `counterpart-index.js` per era (checked all eight), so nothing new had
  to be added to the build script or the Xcode project — every changed folder is
  referenced straight from the repo root.
- No risky JS API in the new code: the only post-ES2019 call is `flatMap`
  (Safari 12+). No `.at()`, `structuredClone`, `replaceAll`, `Object.hasOwn` or
  `??=`.
- Both extractions already degrade independently, as the plan required: a failure
  drops one line and leaves the other, and a total failure draws
  "No price history available".

## Still unverified on Safari

None — a live Safari session rendered both lines, so `world: 'MAIN'` returning a
promise does work there. The notes below are kept as the diagnostic map if it
ever regresses.

1. **`world: 'MAIN'` returning a promise.** Confirmed working on Safari (macOS 26).
   The codebase already injected into the MAIN world for TCGPlayer's visibility
   override, but that injection is synchronous and returns nothing, so awaiting a
   promise from MAIN was new here.
2. Parsing `VGPC.chart_data` out of the DOM (isolated world) — confirmed.
3. Canvas rendering and the period buttons — confirmed.

## If TCGPlayer history is missing on Safari

The log now distinguishes the failure modes on purpose:

- `[tcgplayer] price history unavailable: no payload, got {...}` — the browser did
  not await the injected promise. Fix: have the injected function write the JSON
  into a hidden element and poll for it from the isolated world instead of
  returning it.
- `...: 403` — the API refused the request (cookies or WAF).
- `[tcgplayer] price history had no usable series: ...` — the payload arrived but
  the shape changed.


---

# Reference

## PriceCharting label mapping

| VGPC key | Label | Existing detail-page cell |
|---|---|---|
| `used` | Ungraded | `#used_price` |
| `cib` | Grade 7 | `#complete_price` |
| `new` | Grade 8 | `#new_price` |
| `graded` | Grade 9.5 | `#graded_price` |
| `manualonly` | Grade 10 | `#manual_only_price` |
| `boxonly` | Box Only | (no cell in the extractor) |

The chart's primary line should be `used` (Ungraded).

## Period selector

The plan asked for 6m / 1y / All. Only 3M / 6M / 1Y are actually available:
PriceCharting gives monthly points bounded by the set's release, and TCGPlayer
is fetched with `range=annual`. Offer 3M / 6M / 1Y and drop "All".

## Environment

- The Chrome extension is loaded from `build/chrome/`, so `npm run build:chrome`
  is required after every source change before reloading (documented in
  `AGENTS.md`).

# Fixes found by scanning real cards

All applied and **verified by a live scan**: the chart now draws all three lines
(PriceCharting, TCGPlayer, Collectr) on Glaceon V 175/203, the card that exposed
every one of them.

0. **One listing picker, shared by the scanner and the service worker.**
   `pickListingByLocalId` moved out of `utils/card-lookup.js` into
   `lib/listing-picker.js`, which the worker now imports alongside
   `lib/bulbapedia-resolver.js` (its name comparison) and both pages load. The
   scanner passes `localId`/`cardName` in the `FETCH_TCGPLAYER` payload, and
   `pickTcgplayerListingToEnrich` opens the detail page of the printing the lookup
   will actually pick.

   Why it matters: the worker used to enrich `listings[0]` while the scanner picked
   by card number, so on Glaceon V it opened the **regular** art's detail page
   (market price $63.64), read it, and discarded it — the picked alternate art
   showed "Listing Price" from the search card instead of "Market Price". Two
   versions of the same rule would have re-created the bug, so the rule was moved
   rather than copied.

   The pick degrades to number-only matching when `normalizeBulbapediaCardName` is
   absent (`typeof` guard), which is why the resolver is in the worker's
   `importScripts` list — a test caught the picker silently choosing the first
   listing when the test forgot to load it.

   Verified on Glaceon V 175/203: `[tcgplayer] detail prices` went from
   `marketPrice: 63.64` (the regular art, read and discarded) to `156.66` with
   `mostRecentSale: 147.9` — the alternate art the lookup actually picks, matching
   both Collectr's price and the last point of the TCGPlayer chart line.
1. **PriceCharting's zero prices are dropped.** It writes a `0` for months with no
   sales (its own chart starts on one). Keeping them pulled the Y axis down to 0
   and squashed every other line into the top of the plot — which is what made the
   Collectr line look absent on Glaceon V. Zero is "no data", not a $0.00 card.
2. **TCGPlayer history is fetched on the search page, for every listing.** It used
   to come from the detail page of `listings[0]` only, but the lookup picks a
   listing by card number out of the whole search result — so when a later printing
   won the pick, the picked listing had no `chartData` and the chart silently lost
   its TCGPlayer line (observed on Glaceon V 175/203, whose alternate art is not the
   first result). The history API is reachable from any tcgplayer.com page, so it
   now runs on the search page like Collectr's does, in parallel with the listings
   extraction and covering up to 10 products. `card-lookup` needed no change: it
   already read the chart data off the picked listing.
3. **Collectr prices are dollars only, on purpose.** Collectr renders in the
   account's chosen currency, so a card can read `₫4,069,164`. Treating that as
   dollars would be badly wrong, so a card without a `$` price falls back to the
   API's latest point (USD). This is now a documented rule rather than an accident
   of the regex.
4. **Collectr's search card can have no price at all**, in which case the fallback
   above supplies one from the API's last point — which matched Collectr's own
   product page ($0.77 vs the card's $0.71 on Black Kyurem).
5. **Diagnostics have to live in the service worker.** Logs written inside an
   injected function go to the marketplace tab's console, which is not where a scan
   is debugged from — a diagnostic placed there was invisible and cost a round trip.
   The Collectr extractor therefore reports `unpricedTexts` back through its return
   value instead.
6. **The chart logs what it received.** `[chart] series:` in the scanner prints each
   series with its point count, date range and value range. The scrapers log what
   they sent; this is the other end, and it is what located the missing TCGPlayer
   line.
7. **The chart spells its numbers out for a screen reader.** A canvas is opaque to
   assistive tech, so the section carries an `.sr-only` paragraph with each source's
   latest value and the day it belongs to — `PriceCharting (Ungraded): $132.25 on
   Sep 1, 2026`, and so on. `.sr-only` did not exist in `assets/shared.css` before.
8. **Collectr's product name is read from the card's own element.** The old regex
   required the name to be followed by `(JP)`/`(EN)`, so a name carrying its own
   parentheses — `Glaceon V (Alternate Art Full)` — fell through to a 60-character
   cut of the whole card text. That broke name matching in `pickListingByLocalId`
   for every Collectr listing and showed garbage in the "other results" list. It now
   reads `span.text-card-foreground` (falling back to `span.line-clamp-2`, then the
   old regex), pinned by `tests/collectr-extractor.test.js` against markup copied
   from a live card.

# Post-review fixes

Found in a review pass after the feature was verified, and all applied.

1. **The Collectr line could vanish silently.** `extractCollectrListings` returns up
   to 10 listings and `pickListingByLocalId` picks out of that whole list, but the
   history fetch only covered the first 5 products — so a listing picked from 6–10
   arrived with no `chartData` and the line disappeared with nothing in the log.
   The cap is now 10, matching the extractor.
2. **The Collectr history fetch was on the critical path.** It ran after the
   listings extraction, and `card-lookup` awaits Collectr inside `Promise.all`, so
   its duration added to the whole lookup. Both injections only read the page, so
   they now run together and the cost is `max(...)` instead of a sum.
3. **Interpolated prices are marked `≈`.** The dot sits on the crosshair, so a
   series without a sample at that exact moment shows a value read off the line.
   The tooltip prefixes those with `≈`; exact samples stay plain.
   Caveat measured afterwards: because Collectr's daily series (365 points)
   dominates the snap union, the monthly PriceCharting and weekly TCGPlayer rows
   carry `≈` on nearly every hover, which makes the marker close to always-on.
   **Kept deliberately** after weighing the three options — dropping it, or
   narrowing it to a threshold — because a wrong or missing marker is worse than a
   noisy one, and the marker is the only thing distinguishing an interpolated value
   from a recorded one. The threshold variant was rejected as an arbitrary number
   that, with monthly data, would behave almost like always-on anyway.
4. **`docs/PRICE_HISTORY_PLAN.md` corrected.** Its status line claimed nothing was
   implemented and §2.4 claimed Collectr had no history. The status now points at
   these notes and §2.4 carries the correction inline.

# Open

- Nothing is committed yet.
- The Safari permission prompts for marketplace domains are unchanged and
  pre-existing (see `AGENTS.md`).
- Collectr's daily series is not downsampled: the three lines are noisy next to
  each other, but the chart was reviewed and reads fine, so the extra complexity
  was not taken.
