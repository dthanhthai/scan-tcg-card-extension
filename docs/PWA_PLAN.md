# PWA Plan — Pokemon TCG Card Scanner

Status: plan only, not approved, nothing implemented.

Supersedes the PWA section in `PORT_MOBILE.md` with a concrete, code-level plan
based on the actual v1.0.0 codebase.

---

## 1. Goal

A Progressive Web App that lets users scan Pokemon TCG cards on a phone at card
shows. It reuses the extension's recognition and metadata logic, generates
marketplace search links instead of scraping, and costs $0 to host and run.

**What it does:**
- Camera capture or image upload on phone.
- Gemini Vision recognition (user's own API key).
- Tesseract.js local OCR fallback (no API key needed).
- TCGdex metadata, images, and cross-language matching.
- Bulbapedia counterpart index (Verified/Unverified badge).
- Exchange-rate conversion (JPY/USD → VND).
- Marketplace search links for CardRush, PriceCharting, Collectr, TCGPlayer.
- Scan history (local, unlimited).
- Works offline after first load (except API calls).

**What it does NOT do (standalone):**
- No live price scraping (impossible without browser tabs / a backend).
  See `docs/PWA_BACKEND_PLAN.md` for the optional local backend that adds
  live prices and price history when the user's desktop server is running.
- No tab snapshot (not a browser extension).

---

## 2. Architecture Comparison

```
EXTENSION                              PWA
──────────────────                     ──────────────────
popup/scanner page                     Single-page app
      │                                      │
      │ chrome.runtime.sendMessage           │ direct function call
      ▼                                      ▼
service worker (broker)                (no broker needed)
      │                                      │
      ├── Gemini API (fetch)           ├── Gemini API (fetch)        ✓ same
      ├── TCGdex API (fetch)           ├── TCGdex API (fetch)        ✓ same
      ├── Exchange rate (fetch)        ├── Exchange rate (fetch)     ✓ same
      ├── Marketplace scrapers         ├── Marketplace LINKS only    ✗ different
      │   (chrome.tabs + injected JS)  │   (open URL in new tab)
      └── chrome.storage.local         └── localStorage / IndexedDB  ✗ replaced
```

The extension uses `chrome.runtime.sendMessage` as a message bus between pages and
the service worker, which is the only context allowed to call cross-origin APIs.
In a PWA there is no extension sandbox — the page calls APIs directly. This
eliminates the entire service worker broker, all `MESSAGE_TYPES`, and the
`sendMessageSafely` wrapper.

---

## 3. Code Reuse Audit

### 3.1 Copy as-is (pure logic, zero Chrome APIs)

| File | Lines | Notes |
|---|---|---|
| `utils/constants.js` | 218 | Strip `module.exports` guard, keep all constants/maps |
| `utils/card-code-parser.js` | 147 | OCR text → structured fields. Pure regex/string |
| `utils/image-processor.js` | 227 | Canvas crop + Otsu threshold. Uses standard Canvas API |
| `lib/bulbapedia-resolver.js` | 237 | Index resolution. Pure logic |
| `lib/tcgplayer-linker.js` | 6 | URL builder |

**Total: 835 lines, copy with no changes.**

### 3.2 Copy with thin adapter (replace `chrome.storage` only)

| File | Lines | Chrome dependency | PWA replacement |
|---|---|---|---|
| `lib/gemini-vision.js` | 200 | `getGeminiSettings()` reads `chrome.storage.local` | Read from localStorage |
| `lib/tcgdex-client.js` | 1426 | Set cache reads/writes via `chrome.storage.local` | localStorage + in-memory Map |
| `lib/exchange-rates.js` | 53 | Cache via `chrome.storage.local` | localStorage |
| `lib/bulbapedia-index.js` | 174 | `chrome.runtime.getURL` for script injection | Relative URL + dynamic `<script>` |

**Total: 1853 lines. Each file needs 5–15 lines changed (storage calls only).**

### 3.3 Rewrite / new (Chrome APIs too deep)

| Extension file | PWA replacement | Reason |
|---|---|---|
| `utils/storage.js` (112 lines) | New `pwa/js/storage.js` (~80 lines) | Every function calls `chrome.storage.local`. Rewrite to localStorage/IndexedDB. Same interface. |
| `utils/card-lookup.js` (1520 lines) | New `pwa/js/card-lookup.js` (~600 lines) | Orchestration calls `sendMessageSafely` for every API. Replace with direct function calls. Drop all marketplace scraper rendering (DOM injection, tab management). Add marketplace link generation instead. **Most of the rendering logic is reusable; only the API call pattern changes.** |
| `scanner/scanner.js` (697 lines) | New `pwa/js/scanner.js` (~400 lines) | Drop snapshot/hash routing/chrome.storage. Add camera capture via `<input capture>` or getUserMedia. Keep field editing, crop guide, OCR flow. |
| `popup/popup.js` (351 lines) | Merged into scanner | PWA has no popup — one full-screen page. History rendering is reusable. |
| `background/service-worker.js` | Eliminated | No broker needed. |
| `lib/cardrush-scraper.js` | Eliminated | Cannot scrape in PWA. |
| `lib/pricecharting-scraper.js` | Eliminated | Cannot scrape in PWA. |
| `lib/collectr-scraper.js` | Eliminated | Cannot scrape in PWA. |
| `lib/tcgplayer-scraper.js` | Eliminated | Cannot scrape in PWA. |
| `content-scripts/*-extractor.js` | Eliminated | Cannot inject in PWA. |
| `lib/tab-helper.js` | Eliminated | No tabs/windows. |

### 3.4 Summary

| Category | Lines | % of extension logic |
|---|---|---|
| Copy as-is | 835 | 18% |
| Copy + thin adapter | 1853 | 40% |
| Rewrite (but reuses design) | ~1080 new | — |
| Eliminated (scrapers, broker) | ~2400 dropped | — |

**~58% of the extension's core logic transfers directly.** The rewritten parts
follow the same data flow, just without the message bus.

---

## 4. Data Budget

| Asset | Size (raw) | Size (gzip) | Load strategy |
|---|---|---|---|
| Bulbapedia SV index | 3.2 MB | ~400 KB | On-demand (most scans) |
| Bulbapedia SWSH index | 2.9 MB | ~350 KB | On-demand |
| Bulbapedia SM index | 2.3 MB | ~280 KB | On-demand |
| Bulbapedia XY index | 1.3 MB | ~160 KB | On-demand |
| Other 4 eras combined | 2.7 MB | ~320 KB | On-demand |
| set-era-map.js | ~15 KB | ~3 KB | Eager (tiny) |
| Tesseract core WASM | ~3.5 MB | ~1.5 MB | On-demand (only if no Gemini key) |
| Tesseract eng traineddata | ~4 MB | ~4 MB | On-demand |
| App shell (HTML+CSS+JS) | ~100 KB | ~30 KB | Eager, cached by SW |

**Typical first scan with Gemini key:** ~30 KB app + 3 KB map + 400 KB SV index
= **~430 KB**. Subsequent scans from the same era: 0 KB (cached).

**Without Gemini key (Tesseract fallback):** add ~5.5 MB one-time Tesseract
download on first OCR scan.

GitHub Pages gzips automatically, and the service worker caches everything after
the first load, so repeat visits are instant.

---

## 5. PWA Structure

```
pwa/                              ← new folder in the monorepo
├── index.html                    ← single page, all views
├── manifest.webmanifest          ← PWA manifest (name, icons, theme)
├── sw.js                         ← service worker: offline cache
├── css/
│   └── app.css                   ← adapted from assets/shared.css
├── js/
│   ├── app.js                    ← routing (hash-based), view switching
│   ├── scanner.js                ← camera, upload, paste, field edit, OCR
│   ├── card-lookup.js            ← orchestration (direct calls, no broker)
│   ├── results.js                ← result rendering + marketplace links
│   ├── history.js                ← scan history (localStorage)
│   ├── settings.js               ← API key, image quality, preferences
│   ├── storage.js                ← localStorage/IndexedDB wrapper
│   ├── marketplace-links.js      ← NEW: build search URLs for 4 sites
│   ├── lib/                      ← copied from extension lib/
│   │   ├── gemini-vision.js
│   │   ├── tcgdex-client.js
│   │   ├── exchange-rates.js
│   │   ├── bulbapedia-index.js
│   │   └── bulbapedia-resolver.js
│   └── utils/                    ← copied from extension utils/
│       ├── constants.js
│       ├── card-code-parser.js
│       └── image-processor.js
├── data/
│   └── bulbapedia/               ← symlink or copy of era bundles
│       ├── set-era-map.js
│       ├── sv/counterpart-index.js
│       ├── swsh/counterpart-index.js
│       └── ... (8 eras)
├── assets/
│   └── icons/                    ← reuse extension icons
└── vendor/
    └── tesseract/                ← optional: OCR fallback
```

**Monorepo, not separate repo.** Shared logic lives in the extension root and is
copied (or symlinked) into `pwa/` at build time. This avoids forking and keeps one
source of truth for Gemini prompts, set maps, and the Bulbapedia index.

---

## 6. Key Decisions

### 6.1 No build tool (zero-config)

The extension itself has no bundler — plain `<script>` tags and `importScripts`.
The PWA follows the same approach: plain JS files served as static assets. No
Vite, no Webpack, no npm install needed to develop or deploy.

Tradeoff: no tree-shaking, no minification, no TypeScript. But the total JS is
small (~100 KB app + libs), and gzip handles the rest. If the codebase grows, a
bundler can be added later without changing the source.

### 6.2 Hosting: GitHub Pages

The repo is already on GitHub. Enable Pages on a `gh-pages` branch (or a `pwa/`
subfolder on `main`). URL: `https://dthanhthai.github.io/scan-tcg-card-extension/`.

Cost: $0. HTTPS included (required for camera + service worker). Custom domain
optional later.

### 6.3 Camera input

Two options, starting with the simpler one:

**Option A (MVP):** `<input type="file" accept="image/*" capture="environment">`
- Opens rear camera, user takes a photo, returns a file.
- Works on both Android and iOS, every browser.
- No permission prompt beyond the standard camera dialog.
- One tap to capture, image goes straight to recognition.

**Option B (later):** `navigator.mediaDevices.getUserMedia` live preview
- Continuous camera feed, user taps a shutter button.
- Better UX for scanning multiple cards.
- Needs explicit camera permission.
- More code, more battery usage.
- Can be added in a later phase without changing the recognition pipeline.

### 6.4 Marketplace behavior

The PWA generates search URLs and opens them in a new browser tab. It does NOT
scrape live prices. The result page shows:

```
┌──────────────────────────────────┐
│ Pikachu 028/071 SV2a  JP  RR    │
│ [TCGdex image]                   │
│                                  │
│ EN: Pikachu 028/165  ✅ Verified │
│                                  │
│ 🔗 CardRush    (JP prices)      │  ← tappable link
│ 🔗 PriceCharting                │
│ 🔗 Collectr                     │
│ 🔗 TCGPlayer                    │
│                                  │
│ [📷 Scan Next]                   │
└──────────────────────────────────┘
```

The query construction rules are identical to the extension (reused from
`card-lookup.js`). The new `marketplace-links.js` builds the URLs:

| Marketplace | Normal card | Promo card |
|---|---|---|
| CardRush | `cardrush.jp/product-list?keyword={setCode}+{localId}` | Same |
| PriceCharting | `pricecharting.com/search?q={name}+{number}/{total}+{set}` | `{name}+{localId}` |
| Collectr | `getcollectr.com/?query={name}+{number}/{total}` | `{name}+{localId}` |
| TCGPlayer | `tcgplayer.com/search?q={name}+{number}/{total}` | `{name}+{localId}` |

### 6.5 Bulbapedia index loading

Same lazy strategy as the extension: load `set-era-map.js` first (3 KB), resolve
which era the scanned set code belongs to, then load only that era's
`counterpart-index.js`. Cached by the PWA service worker — second scan is instant.

The index files are plain JS that define a global variable (e.g.
`BULBAPEDIA_SV_INDEX`). In the PWA they are loaded the same way: inject a
`<script>` tag pointing at the file's relative URL. `bulbapedia-index.js` already
does this — just replace `chrome.runtime.getURL(path)` with a plain relative path.

### 6.6 CORS

All three APIs the PWA calls directly are CORS-friendly:

| API | CORS | Verified |
|---|---|---|
| Gemini (`generativelanguage.googleapis.com`) | Yes, `Access-Control-Allow-Origin: *` | Yes, the extension popup already calls it from a page context (`testGeminiApi` in popup.js) |
| TCGdex (`api.tcgdex.net`) | Yes, public API with CORS headers | Yes, used by many browser-based projects |
| Exchange rates (`open.er-api.com`) | Yes, `Access-Control-Allow-Origin: *` | Yes, designed for browser use |

No proxy or backend needed.

---

## 7. Phased Implementation

### Phase 1 — App shell and settings (1 day)

- Create `pwa/` directory structure.
- `index.html`: single-page skeleton with view containers (scanner, results, history, settings).
- `manifest.webmanifest`: app name, icons, theme color, display standalone.
- `sw.js`: cache app shell + static JS + CSS on install. Network-first for API calls.
- `css/app.css`: port from `assets/shared.css`, add mobile-first responsive layout.
- `js/app.js`: hash-based view routing (`#scanner`, `#results`, `#history`, `#settings`).
- `js/settings.js`: Gemini API key input/save/test/clear, image quality selector.
- `js/storage.js`: localStorage wrapper matching the extension's interface (`getSettings`, `saveSettings`, `getScanHistory`, `addScanEntry`, cache functions).
- Copy `utils/constants.js` (strip module.exports).

**Verify:** PWA installable on phone via "Add to Home Screen". Settings persist
after closing and reopening. Service worker caches the shell.

### Phase 2 — Camera and field editing (1 day)

- `js/scanner.js`: camera capture via `<input capture>`, gallery pick, image paste.
- Port the crop-guide overlay from `scanner/scanner.css`.
- Port editable fields (card name, set code, set name, card number, rarity, language, promo toggle).
- Port copy buttons per field.
- Port the image preview stage.
- Copy `utils/image-processor.js` and `utils/card-code-parser.js`.

**Verify:** User can photograph a card or pick from gallery. Fields are editable.
Crop guide shows the bottom-left region.

### Phase 3 — Gemini recognition (0.5 day)

- Copy `lib/gemini-vision.js`, replace `getGeminiSettings()` → read from localStorage.
- Wire scanner.js: after image capture, send to Gemini, populate fields.
- Handle no-key state (show message, skip to manual entry).
- Resize image before sending (reuse the extension's quality settings).

**Verify:** Scan a real JP and EN card. Fields populate correctly. Works without
a key (shows "no API key" message, fields stay empty for manual input).

### Phase 4 — Tesseract OCR fallback (0.5 day)

- Copy `vendor/tesseract/` into `pwa/vendor/tesseract/`.
- Copy `lib/ocr-engine.js`, adapt path resolution.
- When no Gemini key: run Tesseract on the cropped bottom-left region, parse with
  `card-code-parser.js`, fill set code + card number + rarity.

**Verify:** Scan a card without a Gemini key. Set code and card number are
detected (less accurate than Gemini but functional).

### Phase 5 — TCGdex + Bulbapedia + cross-language (1 day)

- Copy `lib/tcgdex-client.js`, replace storage calls.
- Copy `lib/exchange-rates.js`, replace storage calls.
- Copy `lib/bulbapedia-index.js`, replace `chrome.runtime.getURL` with relative paths.
- Copy `lib/bulbapedia-resolver.js` as-is.
- Copy `data/bulbapedia/` era bundles + `set-era-map.js`.
- Write `js/card-lookup.js`: orchestrate Gemini → TCGdex → Bulbapedia → exchange rates.
  Call functions directly instead of `sendMessageSafely`.

**Verify:** Scan a JP card → TCGdex metadata + image appears. EN counterpart
shows with Verified badge. Exchange rates convert JPY → VND.

### Phase 6 — Results + marketplace links (1 day)

- Write `js/marketplace-links.js`: build search URLs for all 4 marketplaces,
  using the same normal/promo/deck rules as the extension.
- Write `js/results.js`: render card metadata, TCGdex image, cross-language
  section, marketplace link buttons.
- Each marketplace button opens the search URL in a new tab (`window.open`).
- Add "Scan Next" button that returns to the scanner view.
- Port the result layout and thumbnail overlay from `assets/shared.css`.

**Verify:** Full flow: scan → detect → lookup → see TCGdex image + counterpart +
4 marketplace links. Tap each link → correct search page opens. "Scan Next"
resets the scanner for the next card.

### Phase 7 — History (0.5 day)

- Write `js/history.js`: render scan history from localStorage.
- Show card image thumbnail, name, set code, number, timestamp.
- Tap an entry → re-run lookup (same as extension's `openHistoryLookup`).
- No limit (localStorage has ~5 MB, each entry is ~1 KB).
- Clear history button in settings.

**Verify:** Scan 3 cards. History shows all 3. Tap one → results appear.
Clear history → list empties.

### Phase 8 — Deploy to GitHub Pages (0.5 day)

- Add a build script (`scripts/build-pwa.mjs`) that:
  1. Copies shared libs and utils into `pwa/js/lib/` and `pwa/js/utils/`.
  2. Copies `data/bulbapedia/` era bundles into `pwa/data/bulbapedia/`.
  3. Copies icons into `pwa/assets/icons/`.
  4. Optionally copies `vendor/tesseract/` if OCR fallback is included.
  5. Writes `build/pwa/` with the complete, deployable PWA.
- Add `"build:pwa": "node scripts/build-pwa.mjs"` to package.json.
- Set up GitHub Pages to serve from `build/pwa/` (or use a GitHub Action that
  builds on push and deploys to `gh-pages` branch).
- Add link to the PWA in the main `README.md`.

**Verify:** Open `https://dthanhthai.github.io/scan-tcg-card-extension/` on a
phone. Install to home screen. Full scan flow works. Service worker caches the
app for offline launch.

---

## 8. What the PWA Gains Over the Extension

| Capability | Extension | PWA |
|---|---|---|
| Use on phone at card shows | No | **Yes** |
| Live marketplace prices | Yes (scraped) | No (links only) |
| Camera capture | Tab snapshot only | **Native camera** |
| Install without developer mode | No | **Yes (Add to Home Screen)** |
| Works on Android | No | **Yes** |
| Works on iOS | Safari + Xcode only | **Yes (any browser)** |
| Offline app launch | N/A | **Yes (service worker)** |
| Batch scan UX | No (must re-upload) | **Yes ("Scan Next" button)** |
| Hosting cost | N/A | **$0 (GitHub Pages)** |

**The PWA is not a replacement for the extension.** It is a companion for mobile
use. Users who want live scraped prices use the desktop extension. Users at card
shows who want fast card identification and marketplace links use the PWA.

With the optional local backend (`docs/PWA_BACKEND_PLAN.md`), the PWA can also
show live prices and price history charts when the user's desktop server is
running on the same network.

---

## 9. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gemini CORS blocked in future | Low (currently allows `*`) | Fallback to Tesseract. Gemini has no reason to block browsers — their API is designed for it. |
| TCGdex CORS blocked in future | Very low (public API) | Cache aggressively. TCGdex is a community project that encourages browser use. |
| Bulbapedia index too large for mobile | Medium | Already lazy-loaded per era. Typical scan loads only 1 era (~400 KB gzipped). Service worker caches it. |
| Camera quality insufficient | Low | Gemini handles angled/blurry photos well. Tesseract needs clearer images but the crop + Otsu threshold helps. |
| iOS Safari PWA limitations | Medium | Camera works via `<input capture>`. Service worker works. No push notifications (not needed). IndexedDB works. Main limitation: no background sync, but the PWA does not need it. |

---

## 10. Non-goals (explicitly out of scope for the standalone PWA)

- No live price scraping in the standalone PWA (see
  `docs/PWA_BACKEND_PLAN.md` for the optional local backend that adds this).
- No user accounts or server-side storage.
- No shared Gemini API key (each user provides their own).
- No push notifications.
- No cross-device sync.
- No App Store / Play Store distribution (it is a website).

---

## 11. Cost

| Component | Cost |
|---|---|
| GitHub Pages hosting | $0 |
| Custom domain (optional) | $0 (use `.github.io` subdomain) |
| Backend | $0 (none) |
| Gemini API | User's own key (free tier sufficient) |
| TCGdex | $0 |
| Exchange rates | $0 |
| Development | Time only |

---

## 12. Timeline Estimate

| Phase | Scope | Est. |
|---|---|---|
| 1. App shell + settings | Structure, routing, storage, SW | 1 day |
| 2. Camera + fields | Capture, edit, crop guide | 1 day |
| 3. Gemini recognition | Port prompt, wire to fields | 0.5 day |
| 4. Tesseract fallback | OCR engine, parser | 0.5 day |
| 5. TCGdex + Bulbapedia | Metadata, cross-language, index | 1 day |
| 6. Results + links | Render, marketplace URLs, "Scan Next" | 1 day |
| 7. History | List, re-lookup, clear | 0.5 day |
| 8. Deploy | Build script, GitHub Pages, README | 0.5 day |
| **Total** | | **~6 days** |

Phases 3+4 (recognition) and 5 (data) are the riskiest — they involve the most
adaptation from Chrome APIs to plain browser APIs. Everything else is
straightforward HTML/CSS/JS.
