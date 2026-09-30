# Price History Chart Plan

Status: implemented and verified on Chrome and Safari, including a third line
(Collectr) that this plan did not expect. Read
`docs/PRICE_HISTORY_IMPLEMENTATION_NOTES.md` for what was actually built, where
this plan turned out to be wrong, and the live-verification results. The sections
below are kept as the original research, with corrections marked inline.

---

## 1. Goal

Show a monthly price chart for a scanned card, using data from PriceCharting and
TCGPlayer. No paid API, no backend, no third-party service — all data comes from
pages the extension already visits.

---

## 2. Data Sources — Research Summary

### 2.1 PriceCharting — CONFIRMED, FREE, embedded in page

PriceCharting uses Highcharts to draw its price history graph. The chart data is
embedded **directly in the page HTML** as a JavaScript variable:

```javascript
VGPC.chart_data = {
  "loose":     [[timestamp_ms, price_cents], ...],   // Ungraded
  "cib":       [[timestamp_ms, price_cents], ...],   // Grade 7
  "new":       [[timestamp_ms, price_cents], ...],   // Grade 8
  "graded":    [[timestamp_ms, price_cents], ...],   // PSA Graded
  "boxonly":   [[timestamp_ms, price_cents], ...],   // Grade 9.5
  "manualonly":[[timestamp_ms, price_cents], ...]    // Grade 10
};
```

- **Data format**: Array of `[timestamp_ms, price_in_cents]` pairs.
- **Granularity**: Monthly data points.
- **Depth**: Years of history (varies per card, some go back to 2010+).
- **Conditions**: Up to 6 price series per card.
- **Access method**: The extension already opens PriceCharting detail pages and
  injects `extractPricechartingDetailSales`. Just add
  `window.VGPC.chart_data` to what the extractor returns.
- **Cost**: $0 — no API key, no subscription.
- **Risk**: Low — `VGPC.chart_data` is used by many public scrapers and has been
  stable for years. If PriceCharting ever removes it, the chart feature degrades
  gracefully (no chart shown, current prices still work).
- **Source**: Confirmed via StackOverflow (2022) and multiple Apify scrapers that
  all read this same variable.

### 2.2 TCGPlayer — FEASIBLE, FREE, two approaches

TCGPlayer's product detail pages show a price history chart. The data comes from
TCGPlayer's internal API at `mpapi.tcgplayer.com`.

**Approach A: Extract from detail page (preferred)**

The extension already opens TCGPlayer detail pages in hidden tabs
(`enrichTcgplayerWithDetailPrices` in `lib/tcgplayer-scraper.js`). The detail
page renders a price history chart. An injected script could:
- Wait for the chart to render (the enrichment flow already waits for render).
- Read the chart's data from the Highcharts/Recharts instance
  (e.g. `Highcharts.charts[0].series[0].data`).
- Or intercept the XHR response that loads chart data.
- **Cost**: $0 — same tab already opened for enrichment.
- **Risk**: Medium — chart DOM/library may change. If extraction fails, the
  feature degrades gracefully (PriceCharting chart still works).
- **Advantage**: No manifest changes needed. Uses existing tab + cookie context.

**Approach B: Call TCGPlayer's internal API directly (alternative)**

TCGPlayer has an internal endpoint at `mpapi.tcgplayer.com` for price history.
```
GET https://mpapi.tcgplayer.com/v2/product/{productId}/pricehistory?range=month
```

- **Requires manifest change**: current `host_permissions` only covers
  `https://www.tcgplayer.com/*` — would need to add
  `https://mpapi.tcgplayer.com/*`.
- May require cookies from `.tcgplayer.com` domain — works only if user has
  visited TCGPlayer recently.
- Returns JSON with daily/weekly price points per variant (Normal, Foil).
- Ranges: `week`, `month`, `quarter`, `year`.
- **Risk**: Medium-High — undocumented internal API, may change without notice,
  auth requirements unknown.
- **Exact endpoint format not yet verified** — first step would be to inspect
  network requests on a live TCGPlayer detail page to confirm URL and response
  structure.

### 2.3 CardRush — NO historical data

CardRush product pages show only the current price and stock. There is no chart,
no sold history, no API. Cannot extract price history.

### 2.4 Collectr — CORRECTED: historical data DOES exist

**The original conclusion below was wrong.** Collectr's explore product page has an
"Ungraded Price History" chart (1M/3M/6M/1Y) and a separate graded one, fed by

```
GET https://api-v2.getcollectr.com/catalog/products/{productId}?username={anonUsername}&details=true
```

which returns `data.price_history[]` (per printing and grade, ungraded marked
`grade_id: "52"`). Collectr is now the third line on the chart; see the notes for
the auth details and the reason the request has to be issued from the page's MAIN
world.

~~Collectr shows only the current market price. No chart, no sold history. Cannot
extract price history.~~

### 2.5 Third-party APIs — rejected (paid or too limited)

| API | Free tier | History on free? | Why rejected |
|---|---|---|---|
| PriceCharting Official API | Paid subscription | "Historic prices not supported" | No history at any tier |
| PkmnPrices | 500 credits/day, English only | **No** — Pro ($14.99/mo) and above | History behind paywall |
| tcgapi.dev | 100 req/day | **No** — Hobby ($9.99/mo) gets 7d, Starter ($19.99/mo) gets 30d | History behind paywall |
| ReefAPI | 1,000 credits total (one-time, not recurring) | Yes (1 credit/call) | Runs out after ~1,000 lookups, then paid |
| TCGAPIs | 100 eval credits (one-time) | Only on Business plan (£199/mo) | History behind paywall |
| tcgfast.com | Unknown | Trader plan and above | History behind paywall |

**All free tiers are either too limited or don't include price history.** The
scraping approach is the only $0 option.

---

## 3. Architecture

```
Current extension flow (unchanged):
  scanner → service worker → open PriceCharting detail page → inject extractor
                           → open TCGPlayer detail page    → inject extractor

New addition (piggybacks on existing detail page tabs):
  PriceCharting extractor also returns VGPC.chart_data
  TCGPlayer extractor also returns chart data from Highcharts instance
  scanner receives chart data → renders chart in result area
```

### 3.1 PriceCharting integration

The extension already does this:
1. `pricecharting-scraper.js` opens a detail page for the top search result.
2. Injects `extractPricechartingDetailSales` to get `recentSalePrice`, grade
   prices, and image.

New: the same extractor also returns `window.VGPC.chart_data` if it exists.

```
extractPricechartingDetailSales()
  → existing: { recentSalePrice, recentSaleDate, grade9Price, grade10Price, imageUrl }
  → new:      + { chartData: { loose: [...], cib: [...], new: [...], ... } }
```

### 3.2 TCGPlayer integration

The extension already opens the first TCGPlayer result's detail page for
enrichment (`enrichTcgplayerWithDetailPrices` in `lib/tcgplayer-scraper.js`).
The new extractor runs **in the same tab, after the existing enrichment**:

```javascript
// Injected into the already-open TCGPlayer detail page
function extractTcgplayerPriceHistory() {
  // Try reading from Highcharts instance
  if (window.Highcharts && Highcharts.charts) {
    const chart = Highcharts.charts.find(c => c);
    if (chart) {
      return chart.series.map(s => ({
        name: s.name,
        data: s.data.map(p => ({ date: p.x, price: p.y }))
      }));
    }
  }
  return null;
}
```

If extraction fails, the feature silently degrades — no TCGPlayer chart, but
the PriceCharting chart still shows. No manifest change needed.

### 3.3 Data passed to scanner

The service worker returns chart data alongside existing marketplace results:

```javascript
{
  // existing
  pricechartingResults: [...],
  tcgplayerResults: [...],
  // new
  priceHistory: {
    pricecharting: {
      ungraded: [[ts, cents], ...],    // VGPC "loose"
      grade7:   [[ts, cents], ...],    // VGPC "cib"
      grade8:   [[ts, cents], ...],    // VGPC "new"
      graded:   [[ts, cents], ...],    // VGPC "graded"
    },
    tcgplayer: {
      normal:  [{ date, marketPrice, lowPrice, highPrice, salesVolume }, ...],
      foil:    [{ date, marketPrice, lowPrice, highPrice, salesVolume }, ...],
    }
  }
}
```

---

## 4. Chart Rendering

### 4.1 Library choice: Custom Canvas (no dependency)

The extension has zero external JS dependencies (besides Tesseract for OCR). Adding
Chart.js (~70 KB gzipped) just for one chart is disproportionate.

Instead: a minimal custom Canvas renderer (~150-200 lines) that draws:
- X axis: months (labels every 3 months for readability).
- Y axis: price in USD (auto-scaled).
- One or two line series (e.g., Ungraded + Graded, or Normal + Foil).
- Hover tooltip showing date + price.
- Period selector: 6m / 1y / All.

This keeps the extension dependency-free and the code auditable.

If the chart needs grow beyond this (multiple axes, zoom, pan), Chart.js can be
added later.

### 4.2 UI placement

```
┌─────────────────────────────────────────────┐
│ Card result (existing)                       │
│ ┌──────────┐  Pikachu 028/071 SV2a          │
│ │ [TCGdex  ]│  JP · RR                      │
│ │ [ image  ]│  EN: Pikachu 028/165 ✅       │
│ └──────────┘                                 │
├─────────────────────────────────────────────┤
│ 📈 Price History                     [6m|1y|All] │
│ ┌───────────────────────────────────────┐   │
│ │        $12 ┤                          │   │
│ │            │     ╱╲                   │   │
│ │        $8  ┤   ╱    ╲   ╱──          │   │
│ │            │ ╱        ╲╱             │   │
│ │        $4  ┤╱                        │   │
│ │            ├──┬──┬──┬──┬──┬──┬──┬──  │   │
│ │            Jan  Apr  Jul  Oct  Jan    │   │
│ └───────────────────────────────────────┘   │
│ ── PriceCharting (Ungraded)                  │
│ ── TCGPlayer (Normal NM)                     │
├─────────────────────────────────────────────┤
│ Marketplace prices (existing)                │
│ 🔗 CardRush  ¥1,280                         │
│ 🔗 PriceCharting $8.50                       │
│ ...                                          │
└─────────────────────────────────────────────┘
```

- Chart appears **between** the card result and marketplace prices.
- Collapsible — starts collapsed on mobile extension popup, expanded in scanner.
- Shows "No history data" when neither source returned chart data.
- PriceCharting line is blue, TCGPlayer line is red.
- When both have data, they are overlaid on the same chart (both in USD).

### 4.3 Tooltip

On hover (desktop) or tap (mobile): shows a vertical crosshair line with:
```
Oct 2025
PriceCharting: $8.50 (Ungraded)
TCGPlayer:     $9.20 (Normal NM)
```

---

## 5. Implementation Phases

### Phase 1 — PriceCharting chart data extraction (low risk)

**Files changed:**
- `content-scripts/pricecharting-extractor.js`: add `VGPC.chart_data` to both
  `extractPricechartingListings` (detail path) and
  `extractPricechartingDetailSales`.
- `lib/pricecharting-scraper.js`: pass `chartData` through in the enrichment
  response.
- `background/service-worker.js`: include `chartData` in the
  `FETCH_PRICECHARTING` response.

**Test:** Scan a card that has a PriceCharting result with a detail page.
Console-log the `chartData` object. Verify it contains arrays of
`[timestamp, price]` pairs.

### Phase 2 — TCGPlayer price history extraction (medium risk)

**Step 0 — Reconnaissance:** Before writing extraction code, manually inspect a
TCGPlayer detail page's network requests and DOM to determine:
- What chart library TCGPlayer uses (Highcharts? Recharts? Custom?).
- Where the chart data lives (global variable? React state? XHR response?).
- The exact data format (timestamps? date strings? price in dollars or cents?).
This determines whether Approach A (DOM/JS extraction) or Approach B (direct
`mpapi` fetch + manifest change) is more practical.

**Files changed (Approach A — preferred):**
- `content-scripts/tcgplayer-extractor.js`: add `extractTcgplayerPriceHistory`
  function that reads chart data from the detail page.
- `lib/tcgplayer-scraper.js`: call new extractor in `enrichTcgplayerWithDetailPrices`
  after existing enrichment, pass `chartData` through.
- `background/service-worker.js`: include `chartData` in the TCGPlayer response.

**Fallback:** If chart extraction fails (library changed, no chart rendered),
return `tcgplayerHistory: null` — the chart shows PriceCharting data only.

**Test:** Scan a card that has a TCGPlayer result. Console-log the chart data.
Verify it contains dated price points.

### Phase 3 — Chart renderer (no risk to existing features)

**Files changed:**
- New: `utils/price-chart.js` (~150-200 lines): Canvas-based chart renderer.
  - Input: `{ pricecharting: { series, label }, tcgplayer: { series, label } }`.
  - Output: Draws on a `<canvas>` element.
  - Features: auto-scale Y axis, month labels on X, period filter, hover tooltip.
- `assets/shared.css`: Styles for chart container, period selector, legend.

**Test:** Create a test HTML page with sample data. Verify chart renders, tooltip
works, period selector filters correctly.

### Phase 4 — Wire into scanner UI

**Files changed:**
- `scanner/scanner.html`: Add chart container (canvas + controls) between card
  result and marketplace prices.
- `utils/card-lookup.js`: After marketplace results arrive, pass `priceHistory`
  to the chart renderer.
- `scanner/scanner.css` (or `shared.css`): Responsive chart sizing.

**Test:** Full end-to-end: scan card → see chart with PriceCharting and/or
TCGPlayer history lines. Verify chart is collapsible. Verify it shows gracefully
when only one source has data, or neither.

### Phase 5 — Safari verification

- Rebuild Safari (`./safari/build-safari.sh`).
- Verify chart renders in Safari (Canvas API is supported).
- Verify PriceCharting `VGPC.chart_data` extraction works in Safari's
  `chrome.scripting.executeScript`.
- Verify TCGPlayer chart data extraction works in Safari's hidden tab
  (Safari may render the detail page differently).
- If either extraction fails in Safari: degrade gracefully (show whichever
  source works, or "No price history available").

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `VGPC.chart_data` removed/renamed | Low | Chart loses PriceCharting line | Graceful fallback. Variable has been stable 5+ years. |
| TCGPlayer chart library/DOM changes | Medium | Chart loses TCGPlayer line | Graceful fallback to PriceCharting only. Try Approach B (`mpapi` direct fetch) if page extraction breaks. |
| TCGPlayer detail page stops rendering chart | Low | No chart data in DOM | Fallback: add `mpapi.tcgplayer.com` to `host_permissions` and fetch directly. |
| Chart adds latency to scan | Low | UX regression | Chart data is fetched **in parallel** with existing marketplace scraping — no additional wait. |
| Large chart data payload | Low | Memory/storage | PriceCharting data is ~5-20 KB per card. Not cached long-term — only lives during the active scan session. |
| Safari differences | Medium | Chart may not render/fetch | Phase 5 catches this. Canvas API works in Safari. `mpapi` fetch is the only unknown. |

---

## 7. What Users See

### Happy path (both sources have data)
- Chart shows two lines: PriceCharting (blue) and TCGPlayer (red).
- Period selector: 6m / 1y / All.
- Hover shows date + both prices.

### PriceCharting only (TCGPlayer fetch fails or no result)
- Chart shows one blue line.
- Legend says "PriceCharting (Ungraded)".

### TCGPlayer only (PriceCharting has no detail page)
- Chart shows one red line.
- Legend says "TCGPlayer (Normal NM)".

### Neither source has data
- Section shows "No price history available" in gray text.
- No chart rendered.

### Card not found on any marketplace
- No chart section at all (existing behavior unchanged).

---

## 8. Cost

$0. No API keys, no subscriptions, no backend. All data comes from pages the
extension already visits or endpoints already in `host_permissions`.

---

## 9. Files Summary

| File | Change |
|---|---|
| `content-scripts/pricecharting-extractor.js` | Add `VGPC.chart_data` extraction |
| `lib/pricecharting-scraper.js` | Pass `chartData` through |
| `content-scripts/tcgplayer-extractor.js` | Add `extractTcgplayerPriceHistory` function |
| `lib/tcgplayer-scraper.js` | Call new extractor in enrichment flow, pass `chartData` |
| `background/service-worker.js` | Route chart data in message responses |
| New: `utils/price-chart.js` | Canvas chart renderer (~150-200 lines) |
| `utils/card-lookup.js` | Wire chart data to renderer after results arrive |
| `scanner/scanner.html` | Chart container HTML |
| `assets/shared.css` | Chart styles |
| `utils/constants.js` | New message type `FETCH_TCGPLAYER_HISTORY` (optional) |

Estimated new code: ~400-500 lines (chart renderer + data extraction + wiring).
Changes to existing code: ~50-80 lines across extractors and service worker.
