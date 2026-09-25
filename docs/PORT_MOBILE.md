# Mobile Porting Plan

This document captures the full discussion of how to bring the SnappaCard scanner
to mobile devices for use at card shows. It covers the existing Chrome Extension
limitations, the PWA option, the Flutter option, the no-backend marketplace
scraping approach via WebView, cost analysis, and a phased implementation plan.

The document is reference material only. No code has been implemented yet.

---

## 1. Background and Goal

The existing product is a Chrome Extension that scans Pokémon TCG cards (EN and JP),
recognizes card fields with Gemini Vision, looks up metadata via TCGdex, and scrapes
live prices from four marketplaces:

- CardRush (JP prices)
- PriceCharting (USD reference)
- Collectr (USD aggregator)
- TCGPlayer (USD market)

The extension relies on desktop Chrome APIs that do not exist on mobile:

- `chrome.runtime.sendMessage`
- `chrome.storage.local`
- `chrome.tabs`
- `chrome.windows`
- `chrome.scripting`
- `chrome.tabs.captureVisibleTab`
- Hidden/minimized marketplace tabs for DOM scraping

The goal is to enable scanning and price checking on a phone at card shows, with the
lowest practical cost and maintenance burden.

---

## 2. Options Considered

### Option 1 — Run the existing extension on mobile

Standard Chrome on Android does not support desktop Chrome Web Store extensions.
Some Chromium browsers on Android support extensions, but compatibility for
`chrome.windows`, hidden tabs, and `chrome.scripting` is unreliable.

Safari Web Extensions on iOS exist from iOS 15, but:

- Requires packaging as an iOS app.
- Requires Apple Developer Program enrollment.
- Background execution is limited.
- Hidden/minimized marketplace windows are not practical on iOS.
- App Store review may scrutinize marketplace scraping behavior.

**Conclusion:** Possible for experimentation, but not recommended as the primary
mobile product.

### Option 2 — Frontend-only PWA (Option C)

A Progressive Web App installed via "Add to Home Screen" that:

- Captures card images with the phone camera.
- Calls Gemini directly using a user-provided API key.
- Calls TCGdex directly.
- Generates correct marketplace search links.
- Stores scan history locally.
- Does not scrape live prices inside the app.

This is the lowest-cost option and works on both Android and iPhone through the
browser, but it cannot replicate the marketplace scrapers without a backend.

### Option 3 — Flutter app (no backend, link-only)

A native cross-platform app that:

- Uses the device camera natively.
- Calls Gemini and TCGdex directly.
- Generates marketplace search links.
- Stores history locally.
- Opens marketplace searches in the external browser or an in-app WebView.

This provides better camera UX and a more app-like experience than a PWA, at the
cost of more development effort and store distribution considerations.

### Option 4 — Flutter app with in-app WebView scraping (no backend)

An extension of Option 3 that also attempts to extract live prices from marketplace
pages using embedded WebViews and JavaScript injection, replicating the desktop
extension's scraper logic on-device without a backend server.

This is technically possible but introduces significant stability and maintenance
risks, especially on iOS. See Section 6 for details.

### Option 5 — PWA or Flutter with a backend

A backend service (Playwright/Puppeteer + Chromium) performs marketplace scraping
server-side and returns aggregated JSON to the mobile client. This is the most
stable scraping approach but introduces server hosting, maintenance, and API key
protection costs.

This document focuses on Options 2, 3, and 4 (no-backend variants). Option 5 is
documented as a future migration path.

---

## 3. PWA Option (Frontend-Only, No Backend)

### 3.1 Architecture

```
Phone
  └── PWA (installed via Add to Home Screen)
       ├── Camera / image upload
       ├── Gemini API (user-provided key)
       ├── Tesseract.js local OCR fallback
       ├── TCGdex API
       ├── Marketplace search link generator
       └── Local history (IndexedDB / localStorage)
```

### 3.2 What can be reused from the extension

- Scanner UI (HTML/CSS/JS).
- Gemini prompt and output schema.
- Card-number parsing.
- Promo detection logic.
- Marketplace query construction rules.
- TCGdex lookup and cross-language matching.
- Cross-version result rendering.
- Shared CSS and image overlay.

### 3.3 What must be replaced

| Extension API | PWA replacement |
|---|---|
| `chrome.runtime.sendMessage` | `fetch('/api/...')` or direct API calls |
| `chrome.storage.local` | IndexedDB or localStorage |
| `chrome.tabs` / `chrome.windows` | Not available |
| `chrome.scripting` | Not available (requires backend) |
| Extension popup | Mobile web page |
| `chrome.tabs.captureVisibleTab` | `<input type="file" capture="environment">` |

### 3.4 Camera input

The simplest stable approach:

```html
<input type="file" accept="image/*" capture="environment">
```

This opens the rear camera on both Android and iPhone. A live camera stream via
`navigator.mediaDevices.getUserMedia` is also possible but uses more battery.

### 3.5 Marketplace behavior

The PWA generates search URLs and opens them in a new browser tab. It does not
scrape live prices. Example output for a normal card:

```
CardRush      → https://www.cardrush-pokemon.jp/product-list?keyword=SV4K%20054
PriceCharting → https://www.pricecharting.com/search-products?q=Roaring%20Moon%20ex%20054%2F066&type=prices
Collectr      → https://app.getcollectr.com/?query=Roaring%20Moon%20ex%20054%2F066
TCGPlayer     → https://www.tcgplayer.com/search/all/product?q=Roaring%20Moon%20ex%20054%2F066&view=grid
```

### 3.6 Hosting and costs

| Component | Cost |
|---|---:|
| Static hosting (Cloudflare Pages, Vercel, Netlify, GitHub Pages) | $0 |
| Default domain (`*.pages.dev`, `*.vercel.app`, etc.) | $0 |
| Backend | $0 |
| Database | $0 |
| TCGdex | $0 |
| Marketplace search links | $0 |
| PWA installation (Add to Home Screen) | $0 |
| Gemini | User's own API key and quota |
| Custom domain (optional, later) | Small annual fee |

The PWA can operate at **$0/month** if each user provides their own Gemini API key.

### 3.7 Limitations

- No live price aggregation inside the app.
- Cannot inject scripts into marketplace pages.
- Cannot bypass CORS or Cloudflare from the browser.
- No shared Gemini API key protection.
- No cross-device history sync.
- HTTPS is required for camera and service worker APIs (localhost excepted during
  development).

### 3.8 CORS note

The PWA can call Gemini and TCGdex directly only if those services allow
cross-origin browser requests. Marketplace links are not affected because the app
only opens URLs; it does not read responses.

---

## 4. Flutter Option (No Backend, Link-Only)

### 4.1 Architecture

```
┌───────────────────────────────┐
│ Flutter Mobile App            │
│                               │
│ Camera / Image Picker         │
│ Crop and resize               │
│ Editable detected fields      │
│ Results and history           │
└───────────────┬───────────────┘
                │
       ┌────────┼─────────┐
       ▼        ▼         ▼
    Gemini    TCGdex   Exchange rates
       │
       ▼
 Structured card information
                │
                ▼
 Marketplace URL generator
                │
   ┌────────────┼────────────┐
   ▼            ▼            ▼
CardRush  PriceCharting  Collectr / TCGPlayer
```

### 4.2 Suitability

Flutter is well suited for this use case because:

- The official `camera` plugin supports Android (SDK 24+) and iOS (13.0+).
- One codebase covers both platforms.
- Native camera UX is better than a PWA `<input capture>`.
- Local storage (SQLite, Isar, Hive, shared_preferences) is robust.
- No website, domain, or hosting is required for a private app.
- Marketplace search URLs can be opened via `url_launcher`.

Reference: <https://pub.dev/packages/camera>

### 4.3 What can be reused (as design, not as code)

The extension is JavaScript; Flutter is Dart. Code cannot be copied directly, but
the following logic can be ported:

- Gemini prompt and JSON schema.
- Promo detection rules.
- Card-number normalization.
- Marketplace query rules (normal vs promo).
- TCGdex set aliases and locale fallback.
- Cross-language matching strategy (set, localId, dexId, HP).
- Scan history model.
- Result layout concept.

### 4.4 What must be rewritten

| Extension | Flutter |
|---|---|
| HTML | Flutter widgets |
| CSS | Flutter theme and widgets |
| JavaScript | Dart |
| `chrome.storage.local` | SQLite / Isar / Hive / shared_preferences |
| `chrome.runtime.sendMessage` | Dart services and repositories |
| Browser popup | Flutter screens |
| `chrome.tabs.create` | `url_launcher` |
| File upload input | `camera` plugin / `image_picker` |
| Image overlay | Flutter dialog or fullscreen viewer |

### 4.5 Proposed project structure

```
lib/
├── app/
│   ├── app.dart
│   ├── routes.dart
│   └── theme.dart
├── features/
│   ├── scanner/
│   │   ├── scan_screen.dart
│   │   ├── review_screen.dart
│   │   └── scan_controller.dart
│   ├── card_lookup/
│   │   ├── result_screen.dart
│   │   ├── card_lookup_service.dart
│   │   └── tcgdex_service.dart
│   ├── marketplaces/
│   │   ├── marketplace_query_service.dart
│   │   └── marketplace_link_service.dart
│   ├── cross_version/
│   │   └── cross_version_service.dart
│   ├── history/
│   │   ├── history_screen.dart
│   │   └── history_repository.dart
│   └── settings/
│       └── settings_screen.dart
├── models/
│   ├── detected_card.dart
│   ├── tcgdex_card.dart
│   ├── counterpart_hint.dart
│   └── scan_history_entry.dart
└── shared/
    ├── network/
    ├── storage/
    └── widgets/
```

### 4.6 Data models

```dart
class DetectedCard {
  final String? cardName;
  final String? cardNameJapanese;
  final String? setCode;
  final String? setName;
  final String? cardNumber;
  final String? rarityCode;
  final CardLanguage language;
  final bool isPromo;
  final CounterpartHint? counterpart;
}
```

```dart
class MarketplaceLink {
  final Marketplace marketplace;
  final String query;
  final Uri searchUri;
}
```

```dart
class ScanHistoryEntry {
  final String cardId;
  final String cardName;
  final String cardNumber;
  final String setCode;
  final String? imageUrl;
  final DateTime scannedAt;
}
```

### 4.7 Marketplace query service

The query rules must match `utils/card-lookup.js` in the extension:

```dart
class MarketplaceQueryService {
  MarketplaceQueries buildQueries(DetectedCard card) {
    final String localId =
        card.cardNumber?.split('/').first ?? '';

    final String marketplaceNumber =
        card.isPromo ? localId : card.cardNumber ?? localId;

    return MarketplaceQueries(
      cardRush: '${card.setCode} $localId',
      priceCharting: '${card.cardName} $marketplaceNumber',
      collectr: '${card.cardName} $marketplaceNumber',
      tcgPlayer: '${card.cardName} $marketplaceNumber',
    );
  }
}
```

Rules summary:

| Marketplace | Normal card | Promo card |
|---|---|---|
| CardRush | `{setCode} {localId}` | `{setCode} {localId}` |
| PriceCharting | `{name} {number}/{total}` | `{name} {localId}` |
| Collectr | `{name} {number}/{total}` | `{name} {localId}` |
| TCGPlayer | `{name} {number}/{total}` | `{name} {localId}` |

CardRush always uses set code plus local ID. The other three use the full card
number for normal cards and local ID only for promo cards.

### 4.8 Gemini API key handling

Without a backend, each user must provide their own Gemini API key. The key should
be stored using `flutter_secure_storage`:

- Android: platform keystore.
- iOS: Keychain.

Do not hardcode a shared API key in the app binary. APK and IPA files can be
reverse-engineered to extract embedded keys.

### 4.9 TCGdex integration

Flutter can call TCGdex directly via HTTP:

```
GET https://api.tcgdex.net/v2/{language}/cards/{setId}-{localId}
```

Port from the extension:

- `SET_CODE_ALIASES`.
- Set abbreviation cache.
- Direct card lookup.
- Name search.
- Set scan.
- dexId matching.
- HP guard.
- Cross-language fallback.

Local caching (memory + database) reduces network requests.

### 4.10 OCR fallback options

| Option | Description | Recommendation |
|---|---|---|
| Gemini only | Simplest, most accurate for holo/angled photos | Recommended for MVP |
| Google ML Kit on-device | Local text recognition, no API key needed | Evaluate after MVP |
| Tesseract native | Closest to extension's Tesseract.js | Low priority; plugin quality uncertain |

### 4.11 Screens

- **Scan screen:** camera preview, card guide, flash toggle, capture button, gallery
  picker, recent scan shortcut.
- **Review screen:** captured image, editable card fields, explicit promo toggle,
  language selector, "Look Up Card" button.
- **Result screen:** TCGdex image, card metadata, four marketplace buttons,
  cross-language card, "Scan Next", save/favorite.
- **History screen:** recent scans, search/filter, reopen card, remove entry.
- **Settings screen:** Gemini API key, test key, image quality, OCR/Gemini
  preference, clear history, clear TCGdex cache.

### 4.12 Distribution and costs

| Component | Cost |
|---|---:|
| Flutter SDK | $0 |
| Backend | $0 |
| Domain | $0 |
| Database server | $0 |
| Android APK sideload | $0 |
| Google Play Console registration | $25 one time |
| Apple Developer Program | $99 per year |
| Gemini | User's own key and quota |
| TCGdex | $0 |
| Marketplace links | $0 |

For personal Android use, an APK can be built and installed with no store fees. For
iPhone distribution via TestFlight or App Store, the Apple Developer Program
membership is required.

### 4.13 Flutter vs PWA comparison

| Criterion | Flutter | PWA |
|---|---|---|
| Backend required for link-only version | No | No |
| Domain / hosting | Not required | Required (often free) |
| Camera UX | Better | Adequate |
| Add to Home Screen | Not applicable | Yes |
| Store installation | Usually | No |
| Android sideload | Easy | Not needed |
| iPhone private installation | Less convenient | Easy via Safari |
| App Store fee | $99/year (iOS) | None |
| Play Store fee | $25 one time | None |
| Offline local storage | Strong | Good |
| Native performance | Better | Adequate |
| Code reuse from extension | Low (logic only, rewrite in Dart) | Higher (same JS/HTML) |
| Development effort | Higher | Lower |
| Updates | Store release or reinstall | Automatic deployment |
| Marketplace scraping without backend | Possible via WebView (unstable) | Not available |

---

## 5. Flutter with In-App WebView Scraping (No Backend)

### 5.1 Concept

Instead of only opening marketplace search links, the Flutter app embeds a
`webview_flutter` WebView, loads the marketplace search page, waits for JavaScript
rendering, injects extraction JavaScript, and returns structured JSON to Dart.

This replicates the desktop extension's scraper flow on-device without a backend
server.

Reference: <https://pub.dev/packages/webview_flutter>

### 5.2 Architecture

```
Flutter app
    ↓
Open marketplace search URL in WebView
    ↓
Wait for JavaScript / SPA render
    ↓
Inject JavaScript into WebView
    ↓
Read product name, price, image, URL
    ↓
Return JSON to Dart
    ↓
Display primary + alternatives
```

Conceptual extraction:

```dart
await webViewController.loadRequest(searchUrl);

final Object result = await webViewController.runJavaScriptReturningResult(
  '''
  JSON.stringify(
    Array.from(document.querySelectorAll('.product-card'))
      .slice(0, 5)
      .map(card => ({
        name: card.querySelector('.name')?.textContent?.trim(),
        price: card.querySelector('.price')?.textContent?.trim(),
        url: card.querySelector('a')?.href,
        imageUrl: card.querySelector('img')?.src
      }))
  )
  ''',
);
```

### 5.3 CORS note

Flutter's native HTTP client is not subject to browser CORS restrictions. However,
marketplaces do not expose simple JSON APIs. They return Cloudflare challenge pages,
server-rendered HTML without product data, or SPAs that require JavaScript
execution. WebView is needed to run JavaScript like a real browser.

### 5.4 Per-marketplace feasibility

| Marketplace | No-backend feasibility | Difficulty | Main issue |
|---|---|---:|---|
| CardRush | Possible via WebView | High | Cloudflare challenge |
| PriceCharting | Possible via WebView | Medium-high | Cloudflare, search + detail enrichment |
| Collectr | Possible via WebView | High | Next.js SPA, async rendering |
| TCGPlayer | Possible via WebView | High | React SPA, visibility / render timing |

### 5.5 CardRush flow

```
Load CardRush search URL
    ↓
Cloudflare auto-pass?
    ├── Yes → extract listings
    └── No  → show WebView for user to tick checkbox
                    ↓
              persist Cloudflare cookie
                    ↓
              extract listings
```

Cookies can be retained in the WebView to reduce repeated verification.

### 5.6 PriceCharting flow

1. Load search URL.
2. Wait for `#games_table`.
3. Scroll to trigger lazy-loaded images.
4. Extract search rows (prefer `img.photo`).
5. Load primary product detail page.
6. Extract recent sale, grade 9/10 prices, and large image.
7. Upgrade thumbnail `/60.jpg` to `/240.jpg`.

### 5.7 Collectr flow

1. Load search URL.
2. Wait for SPA readiness.
3. May need to type query into search input and dispatch keyboard events.
4. Wait for product cards.
5. Extract listings.

### 5.8 TCGPlayer flow

1. Load search URL.
2. Wait for product links.
3. Extract up to 10 results.
4. Select primary by card number.
5. Load primary detail page.
6. Wait for Market Price and Most Recent Sale.
7. Extract detail prices.
8. Use product ID for thumbnail fallback.

### 5.9 Hidden WebView limitations

Running WebViews invisibly is unreliable:

**Android:**
- Non-visible WebViews may render slowly.
- JavaScript timers may be throttled.
- Device RAM constraints.
- Android may stop background activity.
- Cloudflare may require user interaction.

**iOS:**
- Background execution is strictly limited.
- Non-visible WKWebView may not render like a foreground browser.
- App may be suspended when backgrounded.
- Multiple WebViews consume significant RAM.
- Cloudflare interaction is harder to automate reliably.

### 5.10 Recommended UX

Instead of hidden WebViews, show a visible lookup screen:

```
Checking marketplace prices…
[CardRush       Loading]
[PriceCharting  Waiting]
[Collectr       Waiting]
[TCGPlayer      Waiting]
```

When Cloudflare verification is needed:

```
CardRush requires verification
[Open verification]
```

The user confirms in the WebView, then the app continues extraction.

### 5.11 Sequential execution

Do not open four WebViews simultaneously. Run marketplaces sequentially or at most
two at a time on Android after measuring memory:

```
1. CardRush search
2. PriceCharting search + detail
3. Collectr search
4. TCGPlayer search + detail
```

Trade-off: lookup may take several seconds to tens of seconds. If Cloudflare
intervenes, user interaction is required.

### 5.12 Caching

Local caching is essential for UX:

```
normalized marketplace query
        ↓
cache valid (< 30–60 min)?
    ├── Yes → show immediately
    └── No  → run WebView scraper
```

Cache: query, listing names, prices, product URLs, image URLs, timestamp.

Benefits: fewer Cloudflare requests, lower wait time, less battery and data usage,
avoid re-scraping the same card.

### 5.13 On-demand lookup

Do not auto-scrape all four marketplaces after every scan. Provide a button:

```
[Fetch Live Prices]
```

Or let the user pick sources:

```
[CardRush] [PriceCharting] [Collectr] [TCGPlayer]
```

### 5.14 Fallback states

Each marketplace must have three states:

| State | Behavior |
|---|---|
| Success | Show primary + alternatives |
| Verification required | Show "Open Verification" button |
| Failed / timed out | Show "Open Search Page" link |

A single marketplace failure must not block the entire lookup.

### 5.15 Security

- Restrict WebView to whitelisted marketplace domains.
- Do not inject extractors on non-whitelisted domains.
- Do not inject into login or payment pages.
- Do not store marketplace credentials.
- Do not automate checkout.
- Use external browser for checkout.
- Clear sensitive WebView data when appropriate.
- Do not log cookies or session tokens.

### 5.16 Proposed structure

```
lib/
├── marketplaces/
│   ├── marketplace_scraper.dart
│   ├── marketplace_result.dart
│   ├── marketplace_queue.dart
│   ├── cardrush/
│   │   ├── cardrush_query.dart
│   │   └── cardrush_extractor.dart
│   ├── pricecharting/
│   │   ├── pricecharting_query.dart
│   │   └── pricecharting_extractor.dart
│   ├── collectr/
│   │   ├── collectr_query.dart
│   │   └── collectr_extractor.dart
│   └── tcgplayer/
│       ├── tcgplayer_query.dart
│       └── tcgplayer_extractor.dart
└── webview/
    ├── marketplace_webview.dart
    ├── webview_cookie_store.dart
    └── javascript_bridge.dart
```

Shared interface:

```dart
abstract interface class MarketplaceScraper {
  Future<MarketplaceSearchResult> search(CardSearchInput input);
}
```

### 5.17 App Store and Play Store considerations

Using a WebView to display websites is normal. However, an app that heavily
automates multiple marketplace pages carries risks:

- Marketplaces change their DOM.
- Marketplaces change anti-bot behavior.
- Website terms may restrict automated access.
- Store review may ask about behavior and domain access.
- Users seeing frequent verification pages may rate the UX poorly.

These are maintenance and distribution risks, not hard technical limits.

---

## 6. Phased Implementation Plan

### Phase 1 — Project foundation

- Create Flutter project for Android and iOS.
- Add navigation and app theme.
- Define immutable data models.
- Add secure settings storage.
- Add local history storage.
- Add HTTP client.

**Verify:** App builds on Android and iOS. Settings and history persist after
restart.

### Phase 2 — Camera and review flow

- Add rear-camera preview.
- Add capture action.
- Add gallery picker.
- Add image rotation and resizing.
- Add card guide overlay.
- Build editable review form.
- Add explicit promo toggle.

**Verify:** User can photograph a card and edit all fields.

### Phase 3 — Gemini recognition

- Port the current Gemini prompt.
- Send resized JPEG.
- Parse structured JSON.
- Populate review fields.
- Handle missing or invalid fields.
- Add API key test.

**Verify:** Normal and promo cards fill the expected fields. Key is stored in
secure storage.

### Phase 4 — TCGdex

- Port direct lookup.
- Add set aliases.
- Add locale fallback.
- Add card image.
- Add local set cache.
- Add cross-language matching.
- Preserve dexId and HP validation.

**Verify:** Extension test cards return equivalent TCGdex results.

### Phase 5 — Marketplace links (link-only)

- Port normal/promo query rules.
- Build encoded URLs for all four marketplaces.
- Skip CardRush for EN-only cards if not needed.
- Open links externally via `url_launcher`.
- Store generated queries with history.

**Verify:**

```
Armarouge ex 027/182
→ full number on three USD sites

Pikachu SV-P 074
→ Pikachu 074 on three sites
→ SV-P 074 on CardRush
```

### Phase 6 — Card-show UX

- Add "Scan Next".
- Preserve last settings.
- Add loading states.
- Add network retry.
- Add offline history access.
- Cache recent TCGdex results.
- Optimize image size and memory.

**Verify:** Multiple cards can be scanned consecutively without restarting the app.

### Phase 7 — WebView scraping (optional, Android first)

- Start with PriceCharting only.
- Load search URL in WebView.
- Extract top results.
- Load primary detail.
- Extract prices and thumbnails.
- Add per-marketplace timeout.
- Add fallback to search link on failure.
- Add local cache.

**Verify:** PriceCharting returns primary + alternatives for known test cards on a
real Android device.

### Phase 8 — Additional marketplaces via WebView

- TCGPlayer search + detail.
- CardRush with Cloudflare verification UI and cookie persistence.
- Collectr SPA search.
- Sequential queue.
- Per-source retry and fallback.

**Verify:** Each marketplace returns results or falls back to a search link
gracefully.

### Phase 9 — iOS WebView compatibility

- Test WKWebView behavior.
- Test Cloudflare.
- Test background/visibility behavior.
- Adjust extractors for mobile DOM differences.
- Test App Store packaging.

**Verify:** Scraping works on a real iPhone, or degrades gracefully to search
links.

### Phase 10 — Offline OCR (optional)

- Evaluate ML Kit on actual holo cards.
- Add bottom-left crop.
- Port card-code parser.
- Use Gemini when OCR confidence is low or lookup fails.

**Verify:** OCR fills set code and card number for clear photos without Gemini.

---

## 7. Cost Summary

### No-backend (link-only)

| Component | PWA | Flutter |
|---|---:|---:|
| Hosting / domain | $0 (free tier) | $0 (not needed) |
| Backend | $0 | $0 |
| Database | $0 | $0 |
| Gemini | User's key | User's key |
| TCGdex | $0 | $0 |
| Marketplace links | $0 | $0 |
| Android distribution | $0 | $0 (APK sideload) |
| Google Play account | $0 | $25 one time |
| Apple Developer Program | $0 | $99/year |
| App Store / Play Store review | None | Required for store distribution |

### With backend (future)

| Component | Cost |
|---|---:|
| Backend server (Railway, Render, Fly.io, VPS) | Monthly fee |
| Chromium / Playwright runtime | Higher RAM/CPU cost |
| Shared Gemini API key | Developer pays for all users |
| Domain (optional) | Small annual fee |
| Database (optional) | Free tier or monthly fee |
| Maintenance | Ongoing (DOM changes, Cloudflare, browser updates) |

---

## 8. Recommendations

### For personal Android use at card shows

> Build a Flutter MVP. Install via APK. Use a personal Gemini key. Call TCGdex
> directly. Generate marketplace search links. Optionally add WebView scraping for
> PriceCharting first, then other marketplaces.

This gives the best camera UX with no backend, no domain, and no hosting fee.

### For personal iPhone use

> A PWA is the simplest path. Open in Safari, Add to Home Screen, use camera,
> Gemini, TCGdex, and marketplace links. No Apple Developer Program fee required.

### For a polished public product on both platforms

> Flutter through the stores provides the strongest mobile experience, but
> requires more development work and introduces store distribution costs ($99/year
> Apple, $25 one-time Google).

### For full in-app live prices

> Either a PWA or Flutter will eventually need a backend or ongoing WebView
> automation maintenance. A backend with Playwright is more stable but has
> recurring server and maintenance costs. On-device WebView scraping avoids server
> costs but is less stable, especially on iOS.

### Decision rule

| Use case | Recommended option |
|---|---|
| Personal Android use | Flutter APK, link-only, add WebView scraping later |
| Personal iPhone use | PWA, link-only |
| Quick cross-platform prototype | PWA, link-only |
| Public polished Android + iOS app | Flutter via stores, link-only |
| Full live prices, stable | Flutter or PWA + backend scraper |
| Full live prices, no server cost | Flutter + on-device WebView scraping (best-effort) |

---

## 9. Key Constraints and Caveats

- Flutter does not run the existing Chrome Extension code unchanged. All
  `chrome.*` APIs must be replaced.
- Marketplace scrapers are not part of the no-backend MVP. They are an optional
  best-effort enhancement via WebView.
- Embedding a shared Gemini API key in a distributed app is insecure. The safe
  no-backend model is user-provided keys stored locally.
- On-device WebView scraping does not eliminate scraper maintenance. It moves
  browser automation from a server to the phone.
- iOS WKWebView background execution and Cloudflare handling are less reliable
  than Android.
- Marketplace DOM changes require app updates if scraping is enabled.
- Store review may scrutinize apps that heavily automate third-party websites.
- The query rules (normal vs promo, CardRush set code + local ID) must match
  `utils/card-lookup.js` exactly in any mobile port.
- Cross-language matching must preserve the current TCGdex logic (set, localId,
  dexId, HP).

---

## 10. Reference Files in the Extension

| File | Role |
|---|---|
| `utils/card-lookup.js` | Main lookup orchestration, query building, primary selection, rendering |
| `lib/gemini-vision.js` | Gemini prompt, structured recognition, `isPromo` |
| `lib/tcgdex-client.js` | TCGdex API, set aliases, cross-language matching |
| `lib/pricecharting-scraper.js` | PriceCharting tab orchestration and detail enrichment |
| `content-scripts/pricecharting-extractor.js` | PriceCharting DOM extraction |
| `scanner/scanner.js` | Scanner UI flow, recognition and lookup requests |
| `scanner/scanner.html` | Upload, drag/drop, paste, snapshot, editable fields |
| `assets/shared.css` | Shared UI styles, marketplace result styles, overlays |
| `docs/APP_DOCUMENTATION.md` | Full technical documentation of the extension |
| `README.md` | Project overview and usage guide |
