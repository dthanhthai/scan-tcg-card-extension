# PWA Backend Plan — Local Price Server

Status: plan only, not approved, nothing implemented.

Companion to `docs/PWA_PLAN.md`. That plan delivers the PWA with marketplace
**links only**. This plan adds an optional local backend that gives the PWA
**live scraped prices and price history** when the user's desktop is running
the server.

---

## 1. Goal

A Node.js server that runs on the user's desktop machine and scrapes the four
marketplaces (CardRush, PriceCharting, Collectr, TCGPlayer) using a headless
browser. The PWA connects to it over the local network and receives real prices
and price history charts, exactly like the Chrome/Safari extension does today.

**When the server is off** (or unreachable), the PWA falls back to marketplace
links — no degradation of the existing PWA functionality.

**What this adds to the PWA:**

- Live marketplace prices (CardRush, PriceCharting, Collectr, TCGPlayer).
- Price history charts (PriceCharting `VGPC.chart_data`, TCGPlayer
  `infinite-api`, Collectr `api-v2`).
- Exchange-rate conversions on scraped prices (JPY/USD to VND).

**What it does NOT do:**

- No cloud hosting — the server runs on the user's own machine.
- No user accounts or authentication (localhost/LAN only).
- No Gemini API proxying — the PWA calls Gemini directly (CORS-friendly).
- No TCGdex proxying — the PWA calls TCGdex directly (CORS-friendly).
- No persistent price database — prices live for the duration of one request.

---

## 2. Architecture

```
Phone (card show WiFi)                  Desktop (same WiFi)
┌─────────────────────────┐            ┌───────────────────────────────┐
│  PWA (GitHub Pages)     │            │  pwa-server/                  │
│                         │            │  ├── server.js    (Express)   │
│  Camera → Gemini → ...  │            │  ├── scraper.js   (Puppeteer) │
│                         │            │  ├── extractors/  (copied)    │
│  POST /lookup ──────────┼── HTTP ──> │  │   ├── cardrush.js          │
│                         │            │  │   ├── pricecharting.js      │
│  ← JSON prices + chart ─┼────────── │  │   ├── collectr.js           │
│                         │            │  │   └── tcgplayer.js          │
│  Render prices + chart  │            │  └── lib/         (adapted)   │
│                         │            │      ├── cardrush-scraper.js   │
│  (server offline?       │            │      ├── pricecharting-...js   │
│   → show links instead) │            │      ├── collectr-scraper.js   │
└─────────────────────────┘            │      └── tcgplayer-scraper.js  │
                                       │                               │
                                       │  Puppeteer (persistent)       │
                                       │  └── Chromium instance        │
                                       │      ├── page pool (4 slots)  │
                                       │      └── reused across scans  │
                                       └───────────────────────────────┘
```

### 2.1 Why Puppeteer (headless browser) is required

All four marketplaces need a real browser to render content:

| Marketplace | Why plain `fetch` fails |
|---|---|
| CardRush | Cloudflare JS challenge blocks raw HTTP — a real browser is required to pass the challenge (see `lib/cardrush-scraper.js` header comment) |
| PriceCharting | `VGPC.chart_data` is embedded in an inline `<script>` that only exists after server-side rendering; the detail page needs a real DOM to parse it |
| Collectr | SPA (Next.js); the API sits behind a CloudFront WAF that 403s non-browser clients (`Request blocked`) |
| TCGPlayer | SPA; `infinite-api.tcgplayer.com` returns 403 without browser cookies/origin; the MAIN-world fetch in the extension relies on the page's session |

The Chrome extension solves this by opening real browser tabs
(`openMinimizedTab` in `lib/tab-helper.js`, 200x150 `chrome.windows.create`).
The backend replaces those with Puppeteer pages — same principle, headless.

### 2.2 Option B: Persistent browser + page pool (primary)

Launch Puppeteer once when the server starts. Keep the `Browser` instance alive.
Each marketplace scrape opens a new `Page`, extracts data, then closes the page.

```
Server start
  └── puppeteer.launch({ headless: true })
        └── browser instance (persistent, ~200 MB RAM)

POST /lookup
  ├── browser.newPage() → CardRush page → inject extractor → close page
  ├── browser.newPage() → PriceCharting page → inject extractor → close page
  ├── browser.newPage() → Collectr page → inject extractor → close page
  └── browser.newPage() → TCGPlayer page → inject extractor → close page
  (all 4 in parallel, same as the extension)
```

**Advantages:**
- Fast: no cold start per request (~1-2s per marketplace vs ~3-5s).
- Mirrors the extension's architecture (persistent browser, ephemeral tabs).
- Cookies persist across requests (Cloudflare clearance survives).
- Single Chromium process — predictable memory.

**Page pool:** limit to 4 concurrent pages (one per marketplace). If a second
`/lookup` arrives while the first is running, it queues. This prevents memory
spikes from multiple simultaneous scrapes.

### 2.3 Option A: Puppeteer per request (fallback)

If Option B causes stability issues (memory leaks, zombie Chromium), fall back
to launching a fresh `puppeteer.launch()` per `/lookup` request and closing it
after.

**Tradeoff:** slower (~3-5s cold start per request), no cookie persistence
(Cloudflare challenge runs every time), but simpler lifecycle.

This is a fallback — implement Option B first, switch to A only if B proves
unstable.

---

## 3. Code Reuse from Extension

### 3.1 Extractors — copy as-is (100% reuse)

The `content-scripts/*-extractor.js` files are pure DOM-extraction functions
injected into marketplace pages. They have zero Chrome API dependencies — they
read the DOM and return plain objects. Puppeteer's `page.evaluate(fn)` is the
exact equivalent of `chrome.scripting.executeScript({ func })`.

| Extension file | Backend copy | Lines |
|---|---|---|
| `content-scripts/cardrush-extractor.js` | `pwa-server/extractors/cardrush.js` | 104 |
| `content-scripts/pricecharting-extractor.js` | `pwa-server/extractors/pricecharting.js` | 344 |
| `content-scripts/collectr-extractor.js` | `pwa-server/extractors/collectr.js` | 103 |
| `content-scripts/tcgplayer-extractor.js` | `pwa-server/extractors/tcgplayer.js` | 215 |

**Total: 766 lines, copy with no changes.** The same extractor functions that
run inside Chrome tabs will run inside Puppeteer pages.

### 3.2 Scrapers — adapt Chrome APIs to Puppeteer (~70% reuse)

Each `lib/*-scraper.js` file orchestrates: build URL, open tab, wait for load,
inject extractor, read result, close tab. The adaptation replaces Chrome tab
APIs with Puppeteer page APIs:

| Chrome API | Puppeteer equivalent |
|---|---|
| `openMinimizedTab(url)` | `browser.newPage()` + `page.goto(url)` |
| `waitForTabLoadGeneric(tabId)` | `page.goto(url, { waitUntil: 'networkidle2' })` |
| `chrome.scripting.executeScript({ func })` | `page.evaluate(func)` |
| `chrome.scripting.executeScript({ func, world: 'MAIN' })` | `page.evaluate(func)` (Puppeteer always runs in MAIN world) |
| `closeMinimizedTab(tabId, windowId)` | `page.close()` |
| `readInjectionResult(results)` | Direct return value (no `InjectionResult` wrapper) |

The scraper logic (URL building, retry, result normalization, query
construction) stays the same. Only the tab lifecycle changes.

| Extension file | Backend file | Adaptation |
|---|---|---|
| `lib/cardrush-scraper.js` (242 lines) | `pwa-server/lib/cardrush-scraper.js` | Replace `openMinimizedTab` / `chrome.scripting.executeScript` / `closeMinimizedTab` with Puppeteer. Keep `buildCardrushSearchUrl`, keyword fallback, CF detection. |
| `lib/pricecharting-scraper.js` (381 lines) | `pwa-server/lib/pricecharting-scraper.js` | Replace tab lifecycle. Keep query building, detail-page enrichment, `VGPC.chart_data` extraction. |
| `lib/collectr-scraper.js` (266 lines) | `pwa-server/lib/collectr-scraper.js` | Replace tab lifecycle. Keep SPA wait logic, MAIN-world fetch for history. |
| `lib/tcgplayer-scraper.js` (295 lines) | `pwa-server/lib/tcgplayer-scraper.js` | Replace tab lifecycle. Keep detail enrichment, MAIN-world `infinite-api` fetch for history. |

### 3.3 Constants — copy as-is

`utils/constants.js` provides `CARDRUSH_BASE_URL`, `CARDRUSH_SEARCH_URL`,
marketplace URL patterns, rarity maps, and `PRICE_CHART_PREFERRED_PRINTINGS`.
Copy the relevant constants; Node.js can `require()` them directly.

### 3.4 Summary

| Category | Lines | Reuse |
|---|---|---|
| Extractors (copy as-is) | 766 | 100% |
| Scrapers (adapt tab → Puppeteer) | 1184 | ~70% logic reused |
| Constants | ~50 relevant | 100% |
| New code (server, API, orchestration) | ~300-400 | — |

---

## 4. API Design

### 4.1 Endpoints

```
GET  /health
  Response: { "status": "ok", "version": "1.0.0" }
  Purpose: PWA connectivity check.

POST /lookup
  Request body: {
    "cardName": "Pikachu",
    "cardNameJp": "ピカチュウ",
    "setCode": "SV2a",
    "setName": "Pokemon Card 151",
    "cardNumber": "028/071",
    "language": "ja",
    "isPromo": false,
    "rarityCode": "RR"
  }
  Response: {
    "cardrush": {
      "success": true,
      "data": {
        "listings": [...],
        "searchUrl": "https://cardrush-pokemon.jp/product-list?keyword=..."
      }
    },
    "pricecharting": {
      "success": true,
      "data": {
        "listings": [...],
        "searchUrl": "https://www.pricecharting.com/search-products?q=..."
      }
    },
    "collectr": {
      "success": true,
      "data": {
        "listings": [...],
        "searchUrl": "https://www.getcollectr.com/?query=..."
      }
    },
    "tcgplayer": {
      "success": true,
      "data": {
        "listings": [...],
        "searchUrl": "https://www.tcgplayer.com/search/..."
      }
    },
    "priceHistory": {
      "pricecharting": { "used": [[timestampMs, priceCents], ...], ... } | null,
      "tcgplayer": { "variant": "Holofoil", "points": [[timestampMs, priceCents], ...] } | null,
      "collectr": { "variant": "Holofoil", "points": [[timestampMs, priceCents], ...] } | null
    }
  }
```

### 4.2 Query construction

The backend builds marketplace search queries using the **same rules** as the
extension's `card-lookup.js`:

- CardRush: `{setCode} {localId}` (JP card), with fallback to broader keywords.
- PriceCharting: `{enName} {number}/{total} {setPcToken}` (EN card or EN
  counterpart); promo: `{enName} {localId} {setPcToken}`.
- Collectr: `{enName} {number}/{total}`; promo: `{enName} {localId}`.
- TCGPlayer: `{enName} {number}/{total}`; promo: `{enName} {localId}`.

The backend receives the card fields from the PWA and constructs queries
server-side. It does **not** need TCGdex or Bulbapedia data — the PWA handles
card identification and counterpart resolution itself, then sends the resolved
fields to the backend for price lookup.

### 4.3 Parallel scraping

All 4 marketplaces are scraped in parallel (4 Puppeteer pages simultaneously),
same as the extension. Price history data is extracted in the same pages —
PriceCharting's `VGPC.chart_data` and TCGPlayer's `infinite-api` fetch happen
during the existing detail-page enrichment step, not as separate requests.

### 4.4 Response format compatibility

The response shape mirrors the extension's internal `handleMessage` return
values, so the PWA can reuse the same result-rendering logic for both the
backend response and the link-only fallback. The `listings` arrays contain the
same fields the extractors already return (price, stock, condition, productUrl,
imageUrl, etc.).

---

## 5. Server Implementation

### 5.1 Directory structure

```
pwa-server/                            ← new folder in the monorepo
├── package.json                       ← express, puppeteer dependencies
├── server.js                          ← Express app, CORS, /health, /lookup
├── scraper.js                         ← Puppeteer lifecycle, page pool, orchestration
├── query-builder.js                   ← Build marketplace search URLs from card fields
├── extractors/                        ← Copied from content-scripts/ (as-is)
│   ├── cardrush.js
│   ├── pricecharting.js
│   ├── collectr.js
│   └── tcgplayer.js
└── lib/                               ← Adapted from lib/ (Puppeteer instead of Chrome tabs)
    ├── cardrush-scraper.js
    ├── pricecharting-scraper.js
    ├── collectr-scraper.js
    └── tcgplayer-scraper.js
```

### 5.2 Dependencies

| Package | Purpose | Size |
|---|---|---|
| `express` | HTTP server, routing, JSON parsing | ~200 KB |
| `puppeteer` | Headless Chromium for marketplace scraping | ~280 MB (Chromium download, one-time) |
| `cors` | CORS middleware (allow PWA origin) | ~5 KB |

No other dependencies. The server is deliberately minimal.

### 5.3 Puppeteer lifecycle

```javascript
// server.js (simplified)
const puppeteer = require('puppeteer');

let browser = null;
const MAX_CONCURRENT_PAGES = 4;
let activePages = 0;

async function startBrowser() {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

async function acquirePage(url) {
  // Queue if at max concurrent pages
  while (activePages >= MAX_CONCURRENT_PAGES) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  activePages++;
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  return page;
}

async function releasePage(page) {
  await page.close().catch(() => {});
  activePages--;
}
```

### 5.4 CORS

The PWA is hosted on `https://dthanhthai.github.io` (HTTPS). The backend runs
on `http://localhost:3456` (HTTP). This is **mixed content** (HTTPS page
fetching HTTP resource), but browsers make a **localhost exception** — fetches
to `localhost` / `127.0.0.1` are allowed from HTTPS pages.

```javascript
app.use(cors({
  origin: [
    'https://dthanhthai.github.io',
    'http://localhost:8080',  // local PWA dev
  ],
  methods: ['GET', 'POST'],
}));
```

### 5.5 LAN access (phone → desktop)

When the PWA runs on a phone and the server runs on a desktop, the phone must
reach the desktop's LAN IP (e.g. `http://192.168.1.100:3456`).

**Mixed content with LAN IP:** unlike `localhost`, a fetch from an HTTPS page
to `http://192.168.1.x` **is blocked** by browsers. Solutions:

| Solution | Effort | Trade-off |
|---|---|---|
| **A. Self-signed HTTPS on the server** | Low | `mkcert` generates a local CA + cert. Phone must trust the CA once. Server runs HTTPS on LAN. |
| **B. PWA uses HTTP for local dev** | Low | Run PWA locally (not GitHub Pages) over HTTP. No mixed content issue. Loses PWA install + service worker. |
| **C. Tunnel (ngrok / Cloudflare Tunnel)** | Medium | Exposes server to the internet. HTTPS automatic. Overkill for LAN. |

**Recommended: Solution A.** `mkcert` is a one-time setup:
```bash
brew install mkcert
mkcert -install                      # trust the local CA
mkcert 192.168.1.100 localhost       # generate cert + key
# server.js reads the cert files and listens with https.createServer()
```

The PWA settings page stores the server URL (e.g.
`https://192.168.1.100:3456`). The phone trusts the `mkcert` CA by installing
the root cert profile (iOS: Settings → Profile; Android: Settings → Security →
Install certificate).

**Alternative for simplicity:** if the user only uses the PWA on the same
desktop (not on phone over LAN), `localhost` works without any certificate
setup.

---

## 6. PWA Integration

### 6.1 Settings

The PWA settings page (`pwa/js/settings.js`) adds:

```
Backend Server
┌──────────────────────────────────┐
│ Server URL: [https://192.168.1.x:3456] │
│ [Test Connection]  ● Connected   │
└──────────────────────────────────┘
```

- Server URL stored in localStorage (default: empty = disabled).
- "Test Connection" pings `GET /health`.
- Status indicator: green dot = connected, gray = disconnected / not configured.

### 6.2 Connectivity check

```javascript
// pwa/js/backend-client.js
const HEALTH_TIMEOUT_MS = 3000;

async function isBackendAvailable() {
  const serverUrl = getServerUrl();
  if (!serverUrl) return false;
  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
```

Checked once on PWA launch and before each lookup. If the server goes offline
mid-session, the next lookup falls back to links automatically.

### 6.3 Lookup flow (with backend)

```
User scans card
  │
  ├── PWA: Gemini → fields (same as PWA plan)
  ├── PWA: TCGdex → metadata, images (same as PWA plan)
  ├── PWA: Bulbapedia → counterpart (same as PWA plan)
  ├── PWA: Exchange rates (same as PWA plan)
  │
  ├── if backend available:
  │     POST /lookup { cardName, setCode, cardNumber, ... }
  │     ← { cardrush, pricecharting, collectr, tcgplayer, priceHistory }
  │     Render live prices + price history chart
  │
  └── if backend unavailable:
        Render marketplace links (existing PWA behavior)
```

The backend call runs **in parallel** with TCGdex/Bulbapedia (the slow part of
the backend is marketplace scraping, ~5-10s; TCGdex/Bulbapedia is ~1-2s). The
UI shows incremental progress: card info appears first, then prices fill in
when the backend responds.

### 6.4 Result rendering (dual mode)

The PWA result renderer supports two modes:

**Link mode** (no backend):
```
CardRush     🔗 Search →
PriceCharting 🔗 Search →
Collectr     🔗 Search →
TCGPlayer    🔗 Search →
```

**Price mode** (backend connected):
```
CardRush      ¥1,280  (₫234,000)   🔗
PriceCharting $8.50   (₫215,000)   🔗
Collectr      $9.20   (₫232,000)   🔗
TCGPlayer     $7.99   (₫202,000)   🔗

Price History
[chart with 3 lines: PriceCharting, TCGPlayer, Collectr]
```

Both modes show the marketplace search URL as a tappable link, so the user can
always visit the marketplace page directly.

### 6.5 Price history chart (reuse)

The PWA reuses `utils/price-chart.js` (the Canvas renderer already implemented
for the extension). The backend returns the same data shapes:
- PriceCharting: `{ used: [[ts, cents], ...], ... }`
- TCGPlayer: `{ variant, points: [[ts, cents], ...] }`
- Collectr: `{ variant, points: [[ts, cents], ...] }`

No adaptation needed — `buildPriceChartSeries` and `createPriceChart` work with
the same input in the PWA.

---

## 7. Cloudflare and Anti-Bot Handling

### 7.1 Current extension behavior

The extension opens real browser windows (200x150) that pass Cloudflare's JS
challenge automatically. If a CAPTCHA appears (rare), the extension shows the
window and waits for the user to solve it (`restoreWindowSmall` in
`lib/tab-helper.js`).

### 7.2 Backend behavior

Puppeteer headless also passes the JS challenge in most cases. If Cloudflare
detects headless and blocks:

| Strategy | Effort | Effect |
|---|---|---|
| `puppeteer-extra` + `stealth` plugin | Low (npm install) | Patches headless fingerprints. Works for most JS challenges. |
| `headless: 'shell'` (new headless mode) | None | Newer Puppeteer headless mode that is harder to fingerprint. |
| `headless: false` (visible browser) | None | Last resort — user sees the browser and solves CAPTCHAs manually. |

**Plan:** start with `headless: true` + `puppeteer-extra-plugin-stealth`. If a
marketplace consistently blocks, add a `/status` endpoint that reports which
marketplaces are blocked, and the PWA shows links for blocked ones while
showing prices for the rest.

### 7.3 CardRush Cloudflare specifics

CardRush is the most aggressive (Cloudflare JS challenge on every visit). The
extension handles this with a real browser tab. In Puppeteer:
- First request to CardRush triggers the challenge (~3-5s).
- Cloudflare sets a `cf_clearance` cookie after passing.
- Subsequent requests in the same browser instance reuse the cookie (no
  re-challenge).
- Option B (persistent browser) benefits most: the cookie survives across
  lookups.

---

## 8. Running the Server

### 8.1 First-time setup

```bash
cd pwa-server
npm install                          # install express, puppeteer, cors
# Puppeteer auto-downloads Chromium (~280 MB, one-time)
```

### 8.2 Start

```bash
npm start                            # starts on http://localhost:3456
# or
node server.js                       # same thing
```

Console output:
```
Puppeteer browser launched (headless)
Server listening on http://localhost:3456
Server listening on https://0.0.0.0:3456 (LAN)
```

### 8.3 Stop

`Ctrl+C` — closes Puppeteer browser and Express server.

### 8.4 Optional: run as background service

```bash
# macOS: launchd plist (optional, for always-on)
# Linux: systemd unit (optional)
# Or just: nohup node server.js &
```

This is optional — most users will start/stop manually.

---

## 9. Phased Implementation

### BE Phase 1 — Server skeleton (0.5 day)

- Create `pwa-server/` directory.
- `package.json` with `express`, `puppeteer`, `cors`.
- `server.js`: Express app, CORS config, `GET /health`, `POST /lookup` stub.
- Puppeteer browser launch on startup, graceful shutdown on `SIGINT`.
- Page pool with `MAX_CONCURRENT_PAGES = 4`.

**Verify:** `npm start` launches server. `curl http://localhost:3456/health`
returns `{ "status": "ok" }`. Puppeteer browser starts and stops cleanly.

### BE Phase 2 — Port 4 marketplace scrapers (1.5 days)

- Copy `content-scripts/*-extractor.js` → `pwa-server/extractors/`.
- Write `query-builder.js`: extract the query-building logic from
  `utils/card-lookup.js` (CardRush keyword, PriceCharting query, Collectr
  query, TCGPlayer query).
- Adapt `lib/cardrush-scraper.js` → Puppeteer: `page.goto` + `page.evaluate`
  + Cloudflare wait.
- Adapt `lib/pricecharting-scraper.js` → Puppeteer: search page + detail page
  enrichment.
- Adapt `lib/collectr-scraper.js` → Puppeteer: SPA wait + `page.evaluate` in
  MAIN world (Puppeteer always runs in MAIN world, so the Collectr API fetch
  works directly).
- Adapt `lib/tcgplayer-scraper.js` → Puppeteer: search + detail enrichment.
- Wire all 4 into `POST /lookup`, run in parallel with `Promise.allSettled`.

**Verify:** `curl -X POST http://localhost:3456/lookup -H 'Content-Type: application/json' -d '{"cardName":"Pikachu","setCode":"SV2a","cardNumber":"028/071","language":"ja"}'`
returns listings from all 4 marketplaces.

### BE Phase 3 — Price history extraction (0.5 day)

- PriceCharting: in the detail-page step, also parse `VGPC.chart_data` from
  the inline `<script>` DOM text (same technique as
  `extractPricechartingDetailSales` already does).
- TCGPlayer: in the detail-page step, also run `page.evaluate()` to fetch
  `https://infinite-api.tcgplayer.com/price/history/{productId}?range=annual`.
- Collectr: in the search-page step, also run `page.evaluate()` to fetch
  `https://api-v2.getcollectr.com/catalog/products/{id}?username=00000000-0000-0000-0000-000000000000&details=true`.
- Normalize all three to the same format the extension uses.
- Include `priceHistory` in the `/lookup` response.

**Verify:** response includes `priceHistory.pricecharting`,
`priceHistory.tcgplayer`, and `priceHistory.collectr` with timestamp/price
arrays.

### BE Phase 4 — PWA integration (1 day)

- `pwa/js/backend-client.js`: connectivity check, `POST /lookup` wrapper,
  timeout handling.
- `pwa/js/settings.js`: add server URL input, test connection button, status
  indicator.
- `pwa/js/card-lookup.js`: if backend available, call `/lookup` in parallel
  with TCGdex/Bulbapedia; render live prices instead of links.
- `pwa/js/results.js`: dual-mode rendering (prices vs. links).
- Copy `utils/price-chart.js` into PWA and wire the chart section (same as
  extension's `renderPriceHistorySection` + `mountPriceHistoryChart`).
- Fallback: if `/lookup` fails or times out (15s), show links.

**Verify:** on phone, configure server URL → scan card → see live prices and
price history chart. Disconnect server → scan card → see marketplace links.

---

## 10. Puppeteer Adapter Pattern

Each adapted scraper follows the same pattern. Example for CardRush:

```javascript
// pwa-server/lib/cardrush-scraper.js
const { extractCardrushListings } = require('../extractors/cardrush');

async function scrapeCardrush(browser, searchUrl) {
  const page = await browser.newPage();
  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for Cloudflare challenge to clear (same logic as extension)
    const isChallenged = await page.evaluate(
      () => document.title.includes('Just a moment')
    );
    if (isChallenged) {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    }

    // Inject the same extractor function used by the extension
    const listings = await page.evaluate(extractCardrushListings);
    return { success: true, data: { listings, searchUrl } };
  } catch (error) {
    return { success: false, error: error.message, data: { listings: [], searchUrl } };
  } finally {
    await page.close().catch(() => {});
  }
}
```

This pattern — `page.goto` → wait → `page.evaluate(extractorFn)` → close —
replaces the extension's `openMinimizedTab` → `waitForTabLoad` →
`chrome.scripting.executeScript({ func })` → `closeMinimizedTab`.

The extractor function is **identical** — no changes needed.

---

## 11. What the PWA Gains with the Backend

| Capability | PWA alone | PWA + Backend |
|---|---|---|
| Live marketplace prices | No (links only) | **Yes** |
| Price history chart | No | **Yes** (PriceCharting + TCGPlayer + Collectr) |
| Exchange-rate conversions on prices | No (no prices to convert) | **Yes** |
| Works without desktop server | **Yes** (links) | **Yes** (falls back to links) |
| Works at card show without WiFi | **Yes** (cached app, Gemini needs internet) | No (needs server) |
| Card identification (Gemini/OCR) | **Yes** | **Yes** (unchanged, PWA handles it) |
| TCGdex metadata | **Yes** | **Yes** (unchanged) |
| Bulbapedia counterpart | **Yes** | **Yes** (unchanged) |

---

## 12. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Puppeteer Chromium download too large (280 MB) | Certain | One-time download. Document in setup instructions. Consider `puppeteer-core` + user's existing Chrome to skip the download. |
| Cloudflare blocks headless Puppeteer | Medium | `puppeteer-extra-plugin-stealth`. Fallback to `headless: false` (visible browser) for manual CAPTCHA. Fallback to links for blocked marketplaces. |
| High memory usage (~200-400 MB) | Medium | Page pool limits concurrency. Server can be stopped when not needed. Document minimum RAM. |
| Mixed content (HTTPS PWA → HTTP LAN) | Certain for LAN | `mkcert` self-signed HTTPS. `localhost` is exempt. |
| LAN IP changes (DHCP) | Medium | User updates server URL in PWA settings. Or: server broadcasts via mDNS/Bonjour (future enhancement). |
| Marketplace DOM/API changes | Medium | Same risk as the extension. Extractors are shared — a fix in the extension fixes the backend too. |
| Phone not on same WiFi as desktop | N/A | Expected. PWA falls back to links. |

---

## 13. Cost

| Component | Cost |
|---|---|
| Node.js runtime | $0 (pre-installed on most dev machines) |
| Puppeteer + Chromium | $0 (open source, ~280 MB disk) |
| Express | $0 |
| Server hosting | $0 (user's own machine) |
| Bandwidth | $0 (LAN traffic) |
| Development | Time only |

---

## 14. Timeline Estimate

| Phase | Scope | Est. |
|---|---|---|
| BE 1. Server skeleton | Express, Puppeteer, health check, page pool | 0.5 day |
| BE 2. Port 4 scrapers | Adapt scrapers + extractors to Puppeteer | 1.5 days |
| BE 3. Price history | Extract chart data from 3 marketplaces | 0.5 day |
| BE 4. PWA integration | Backend client, dual-mode rendering, chart | 1 day |
| **Backend total** | | **3.5 days** |

Combined with PWA plan (~6 days):

| Component | Est. |
|---|---|
| PWA (from `PWA_PLAN.md`) | ~6 days |
| Backend (this plan) | ~3.5 days |
| **Total** | **~9.5 days** |

The PWA can be built and deployed first (fully functional with links), then the
backend can be added incrementally. They are independent — the backend phases
do not block the PWA phases.

---

## 15. Future Enhancements (out of scope for v1)

- **mDNS / Bonjour discovery:** PWA auto-discovers the server on the local
  network instead of requiring a manual URL.
- **WebSocket for real-time progress:** instead of a single POST response,
  stream marketplace results as they complete (CardRush first, then
  PriceCharting, etc.).
- **Browser reuse with user's Chrome profile:** use `puppeteer-core` +
  `executablePath` pointing to the user's Chrome, preserving all cookies and
  logins. Eliminates Cloudflare challenges entirely.
- **Docker image:** package the server + Chromium in a Docker container for
  one-command setup.
- **Queue UI:** a `/status` page showing active scrapes, page pool usage, and
  marketplace health.
