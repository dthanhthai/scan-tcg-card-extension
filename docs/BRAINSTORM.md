# Brainstorm — Post v1.0.0 Ideas

Status: brainstorm only, nothing approved or implemented.

---

## A. Scan UX Improvements

### A1. Batch scan mode
After viewing results for card 1, a "Scan Next" button returns to the camera/upload
without losing context (history preserved). Essential at card shows when checking
prices back-to-back.

- Effort: Low
- Impact: High

### A2. Dark mode
Light/dark toggle in Settings. Scanners are often used at conventions with dim
lighting — dark mode reduces glare and makes prices easier to read.

- Effort: Low–Medium
- Impact: Medium

### A3. Copy price summary
A button that copies a plain-text summary like
`Pikachu 028/071 — CardRush ¥1,280 / TCGPlayer $8.50` for pasting into
chat/Discord during a trade.

- Effort: Low
- Impact: Medium

### A4. Notification when scrape finishes
Currently the user must watch the page while 4 marketplaces load. A browser
notification when all price sources have returned lets the user switch tabs.

- Effort: Low
- Impact: Low–Medium

---

## B. Price Data Expansion

### B1. Mercari JP
The most popular second-hand source for JP cards. Mercari blocks scraping
aggressively (login + private API), so start with link-only (open search URL) and
attempt scraping later if feasible.

- Effort: Medium–High
- Impact: High

### B2. eBay (API-based)
Sold listings give real market prices, especially for graded cards. eBay has a
public REST API (Finding API, Browse API) — fetch JSON directly instead of DOM
scraping. Much lighter than the current 4 marketplace scrapers.

- Effort: Medium
- Impact: High

### B3. Yahoo Auctions JP
Supplements CardRush as a JP price source. Same approach as Mercari: start with
link-only.

- Effort: Medium
- Impact: Medium

### B4. Price history chart
Store prices for each card across scans over time and draw a simple trend line.
Requires a storage schema change. Lets users know if a card is trending up or down.

- Effort: Medium
- Impact: Medium

---

## C. Collection Management

### C1. "Add to Collection" button
After scanning, save a card to a personal collection (local storage). Current
history holds only 10 entries and does not represent ownership.

- Effort: Medium
- Impact: High

### C2. Portfolio value dashboard
Total collection value based on the most recent marketplace prices. Auto-refresh
prices when the user opens the dashboard.

- Effort: High
- Impact: High

### C3. Export collection (CSV/JSON)
Export saved cards for spreadsheets or import into other tools (TCGPlayer
collection, Collectr portfolio).

- Effort: Low
- Impact: Medium

### C4. Import from CSV
Import a card list (setCode + number) and batch-lookup prices — useful for users
who already have an inventory.

- Effort: Medium
- Impact: Medium

---

## D. Recognition Improvements

### D1. Multi-model fallback
Currently only `gemini-flash-lite-latest`. Let the user choose a stronger model
(Gemini Pro, GPT-4o) when flash-lite misreads, or auto-retry with a higher-tier
model when confidence is low.

- Effort: Medium
- Impact: Medium

### D2. Confidence score display
Parse or infer confidence from Gemini output and show a high/medium/low badge
beside detected fields so the user knows when to double-check.

- Effort: Low
- Impact: Low–Medium

### D3. Multi-card detection
One photo containing multiple cards → detect and look up all of them. Gemini can
handle this, but the current flow is strictly one image = one card and needs
significant rework.

- Effort: High
- Impact: Medium

---

## E. Platform Expansion

### E1. PWA (link-only, no scrape)
Detailed plan already exists in `docs/PORT_MOBILE.md`. Reuses Gemini + TCGdex +
query logic; opens marketplace links instead of scraping. $0 hosting via GitHub
Pages. Usable on phones at card shows.

- Effort: Medium
- Impact: Very high

### E2. Firefox extension
Manifest V3 Firefox is highly compatible with Chrome. Needs testing of the
`browser.*` namespace and marketplace scrapers. Significant user base expansion.

- Effort: Medium
- Impact: Medium

### E3. Flutter app (link-only)
Also documented in `docs/PORT_MOBILE.md`. Better camera UX than PWA but much
higher effort and requires store distribution.

- Effort: High
- Impact: High

---

## F. Bulbapedia Data Expansion

### F1. EX era (Ruby/Sapphire → Power Keepers)
Pipeline is ready (`era-config.mjs`). Needs Bulbapedia category verification and
review.

- Effort: Medium
- Impact: Low–Medium

### F2. e-Card & Base/Wizards eras
Oldest eras. High-value cards but very different format (no regulation mark,
different set code layout). Parser adjustments needed.

- Effort: High
- Impact: Low

---

## G. Technical / Quality

### G1. i18n UI
UI is English-only. Add at least Japanese (JP card users) and Vietnamese.
`chrome.i18n` API is available.

- Effort: Medium
- Impact: Medium

### G2. Error reporting (opt-in)
Anonymous telemetry: when a scan fails or a marketplace times out, log card info +
error type (never API keys or images) to understand what needs fixing.

- Effort: Medium
- Impact: Medium

### G3. E2E tests with Playwright
Currently only unit tests (533 tests). Add E2E tests that load the real extension
in Chrome, scan fixture images, and verify DOM output.

- Effort: Medium–High
- Impact: Medium

---

## Suggested priorities for v1.1 / v1.2

1. **E1 — PWA mobile** — unlocks the most important use case (price checking at
   card shows on a phone). Plan is already detailed, reuses most existing JS logic,
   $0 hosting.
2. **A1 — Batch scan mode** — small change, large workflow improvement when
   scanning multiple cards in a row. Just a "Scan Next" button after results.
3. **B2 — eBay (API-based)** — adds the world's largest real-market price source
   without DOM scraping (eBay has a REST API). Moderate effort, high value for EN
   and graded cards.
