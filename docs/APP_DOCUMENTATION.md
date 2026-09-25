# Pokemon TCG Card Scanner — Application Documentation

This document describes the current Chrome extension implementation, including its architecture, supported features, data flow, recognition pipeline, marketplace search logic, cross-language matching, and result rendering.

> If this document and the code differ, the current code is the source of truth. The main lookup flow is implemented in `utils/card-lookup.js`.

## 1. Overview

The extension identifies Japanese and English Pokémon TCG cards from images, retrieves metadata from TCGdex, searches multiple marketplaces, converts prices, and finds counterpart cards in the other language.

Primary data sources:

| Source | Purpose | Currency |
|---|---|---|
| Gemini Vision | Identifies card information from images | — |
| Tesseract.js | OCR fallback when no Gemini API key is configured | — |
| TCGdex | Metadata, sets, rarity, images, dexId, HP, and fallback prices | — |
| CardRush | Primary marketplace for Japanese cards | JPY |
| PriceCharting | Raw, graded, and recent-sale prices | USD |
| Collectr | Product prices | USD |
| TCGPlayer | Listings, Market Price, Most Recent Sale, and printing prices | USD |
| open.er-api.com | JPY, USD, and VND exchange rates | JPY, USD, VND |

## 2. Supported Features

### 2.1. Input Methods

- Upload an image from the popup or scanner.
- Drag and drop an image into the scanner.
- Paste an image from the clipboard.
- Capture a snapshot of the current tab from the popup.
- Use the snapshot keyboard shortcut:
  - Windows/Linux: `Ctrl+Shift+S`.
  - macOS: `Command+Shift+S`.
- Select the card area within a snapshot before recognition.

The snapshot flow is latency-sensitive, so it is ordered for speed: the service worker captures the visible
tab, then writes the payload and opens the scanner tab **in parallel**, and the scanner page shows the red
capture overlay immediately (before reading and decoding the image) and polls briefly for the payload in
case the write lands after the page has loaded. Dragging is only enabled once the image is drawn.
- Run a manual search from the popup.

The current scanner UI does not provide a direct camera flow. Its supported inputs are images, clipboard data, and tab snapshots.

### 2.2. Recognition and Editing

- Gemini Vision is the primary detector when an API key is configured.
- Local Tesseract.js OCR is the fallback when no API key is configured.
- Detected fields are editable before lookup:
  - Card Name.
  - Set Code.
  - Set Name.
  - Card Number.
  - Rarity.
  - Language (a compact dropdown sharing its row with the Promo checkbox).
  - Promo (a checkbox, auto-set from Gemini's `isPromo` field).
- The text fields each have a copy action.
- The preview line above the fields reports what the detector read: the OCR text for Tesseract, a readable
  `key: value` summary for Gemini (the full JSON stays on hover and in the console), or the manual input.
- When the setting `autoLookup` is on (default), the lookup starts by itself once the fields are filled, so a
  scan needs no second click; it is skipped when the number or the set code/name is missing, so the "could not
  read" hint stays visible. Settings → Scanning turns it off.
- Japanese and English cards are supported.
- Supported card-number forms include `017/193`, `018/017`, `074/SV-P`, and local numbers such as `074`.

### 2.3. Results

- Displays TCGdex metadata and images when available.
- Displays prices from four marketplaces.
- Converts JPY and USD values to VND, and displays other relevant conversions.
- Shows separate progress for TCGdex, CardRush, PriceCharting, Collectr, and TCGPlayer.
- Opens an image overlay when a thumbnail is clicked.
- Opens marketplace product pages in a new tab.
- Keeps one primary result and up to four alternatives for each marketplace, for up to five results including the primary result.
- Stores up to 10 recent scans. Each history entry is a real link or button: entries with a CardRush product page open it, the rest re-run the lookup in the scanner through the `#manual` flow (they do not keep enough data to re-render a result in the popup).
- Finds and prices a cross-language counterpart.

## 3. Architecture

### 3.1. Chrome Extension Structure

- Chrome Manifest V3.
- Popup entry point: `popup/popup.html`.
- Scanner tab: `scanner/scanner.html`.
- Settings tab: `settings/settings.html`.
- Background service worker: `background/service-worker.js`.
- Vanilla HTML, CSS, and JavaScript UI.
- Local persistence through `chrome.storage.local`.

### 3.2. Layer Diagram

```text
Popup / Scanner / Settings
        |
        | chrome.runtime.sendMessage
        v
Background service worker
        |
        +-- Gemini Vision API
        +-- TCGdex API
        +-- Exchange-rate API
        +-- Browser-tab marketplace scrapers
                |
                +-- CardRush extractor
                +-- PriceCharting extractor
                +-- Collectr extractor
                +-- TCGPlayer extractor
```

The popup and scanner use `utils/card-lookup.js` for orchestration and rendering. Cross-origin requests are routed through the service worker with `MESSAGE_TYPES`.

Counterpart resolution is local: `lib/bulbapedia-index.js` loads the bundled per-era indexes on demand and
`lib/bulbapedia-resolver.js` resolves the exact counterpart from them, so no Bulbapedia request is ever made
from the extension. TCGdex and the marketplaces are only consulted after the index has been tried.

### 3.3. Important Files

| File | Responsibility |
|---|---|
| `manifest.json` | Permissions, host permissions, popup, icons, service worker, and keyboard shortcut |
| `background/service-worker.js` | Message routing and snapshot shortcut handling |
| `utils/card-lookup.js` | Lookup orchestration, query construction, result selection, conversion, and rendering |
| `lib/gemini-vision.js` | Gemini prompt, API request, and structured output parsing |
| `lib/ocr-engine.js` | Tesseract worker and local OCR |
| `utils/image-processor.js` | Image cropping and preprocessing for OCR |
| `utils/card-code-parser.js` | Converts OCR text into set, card number, and rarity fields |
| `lib/tcgdex-client.js` | TCGdex lookup, set aliases, abbreviation matching, printed-total checks, and cross-language matching |
| `lib/bulbapedia-index.js` | Builds the language views from the per-era Bulbapedia indexes and loads them on demand (`ensureBulbapediaIndexes`) |
| `lib/bulbapedia-resolver.js` | Pure exact-counterpart resolver (`hit` / `ambiguous` / `multi-target` / `miss`) plus target validation |
| `data/bulbapedia/<era>/` | Generated counterpart index: JSON (review artifact, with provenance), JS bundle (runtime, no provenance), and `review-decisions.json` |
| `scripts/bulbapedia/` | Development-only crawl, generate, review, and bundle tooling for the index (never shipped to the browser) |
| `lib/cardrush-scraper.js` | CardRush browser-tab scraper |
| `lib/pricecharting-scraper.js` | PriceCharting search and detail scraper |
| `lib/collectr-scraper.js` | Collectr SPA scraper |
| `lib/tcgplayer-scraper.js` | TCGPlayer search and detail scraper |
| `content-scripts/*-extractor.js` | DOM extraction inside marketplace page contexts |
| `lib/exchange-rates.js` | Exchange-rate fetching and caching |
| `utils/storage.js` | History, settings, set cache, and exchange-rate cache |
| `assets/shared.css` | Shared result, marketplace, cross-language, and overlay styles |

## 4. Gemini Vision

### 4.1. Output Schema

Gemini is instructed to return JSON with these fields:

```json
{
  "setCode": "M2a",
  "setName": "MEGA Dream ex",
  "cardNumber": "017/193",
  "rarityCode": "RR",
  "cardName": "Pikachu",
  "cardNameJp": "ピカチュウ",
  "language": "ja",
  "isPromo": false,
  "crossSetCode": null,
  "crossSetName": null,
  "crossCardNumber": null
}
```

Field behavior:

- `cardName`: the English card name, including for a Japanese source card.
- `cardNameJp`: the Japanese card name, including for an English source card.
- `language`: `ja` or `en`.
- `isPromo`: whether Gemini considers the source a promo card.
- `crossSetCode`, `crossSetName`, and `crossCardNumber`: hints for a counterpart in the other language.

The model sometimes emits a malformed escape (observed: a truncated `\u30b` inside `cardNameJp`), which makes
`JSON.parse` throw `Bad Unicode escape` and used to drop the whole scan to the Tesseract fallback.
`parseGeminiTextOutput` retries once with `repairJsonEscapes`, which drops only the backslash of an invalid
escape (consuming valid escapes in pairs, so `\\` is never touched). The affected field keeps the raw
characters, and the rest of the scan proceeds normally.

### 4.2. Promo Detection

Gemini is instructed to consider:

- Promo set codes such as `SV-P`, `SVP`, `SM-P`, `SMP`, and `BPR`.
- McDonald's, celebration, and other special promotional cards.
- A small `PROMO` logo in the bottom-left area near the card number and rarity.
- The common use of a single local number instead of a numeric `{number}/{setTotal}` form.

`isPromo` is used to format marketplace queries. Separately, a TCGdex set name containing `promo` is used when formatting the displayed card number.

### 4.3. Image Data and API Key

- Gemini receives a base64-encoded JPEG image.
- The image is sent to the Google Gemini API when Gemini recognition is used.
- The API key is stored in the extension's `chrome.storage.local` storage.
- Settings can save, test, show, hide, and clear the key.
- If no key exists, Gemini recognition returns the `NO_API_KEY` sentinel and the scanner switches to local OCR.

## 5. OCR Fallback

Tesseract OCR is used when no Gemini API key is configured.

OCR flow:

1. Crop the bottom-left card-code area.
2. Preprocess the crop with canvas operations.
3. Run OCR with a whitelist for Latin characters, digits, slash, and hyphen.
4. Correct selected common OCR errors.
5. Parse the card number, set code, and rarity.
6. Compare the detected set code with known TCGdex sets and apply conservative Levenshtein correction.

The parser uses the card number as its primary anchor. Supported OCR examples include:

```text
H M2a 017/193 RR
H SV2D 069/071 U
F S12 077/098 RRR
H SV-P 161/SV-P P
```

## 6. Main Lookup Flow

The main function is `lookupCardAndPrice(...)` in `utils/card-lookup.js`.

### 6.1. Input Normalization

```text
cardLocalId = the portion before `/` in cardNumberFull
```

Examples:

| Input | `cardLocalId` |
|---|---|
| `027/182` | `027` |
| `074/SV-P` | `074` |
| `074` | `074` |

Promo status for query construction is determined by:

```text
isPromoCard = cardNumberFull exists ? cardNumberFull does not contain `/`
                                    : Gemini isPromo === true
```

A printed number with a total (`60/108`) is never a promo number, so it overrides a wrong Gemini `isPromo`
flag that would otherwise drop the total. A value such as `074/SV-P` keeps the slash, so only the local
number is used for the marketplace queries.

### 6.2. Language Selection

- An `en` hint selects the English locale first.
- Other cases default to the Japanese locale first.
- If TCGdex fails and no explicit language hint exists, the other locale is attempted.
- CardRush is skipped when the card is identified as English.

### 6.3. Parallel Work

Before the marketplace queries are built, the lookup resolves the scanned card against the bundled
Bulbapedia index (§10.8). The index bundles are loaded on demand at this point (`ensureBulbapediaIndexes`),
so the first lookup of a page pays for loading them and later lookups do not.

After the extension has a usable English card name, it starts these marketplace requests in parallel:

- CardRush (Japanese scans only).
- PriceCharting.
- Collectr.
- TCGPlayer.

The TCGdex metadata lookup may continue while marketplace requests are running. This reduces total lookup time compared with sequential requests.

### 6.4. Why the marketplaces do not wait for TCGdex (decided 2026-09-19)

The TCGdex API is the authoritative source, so running it first and building the marketplace queries from its
resolved card would give more trustworthy queries. It was deliberately **not** done:

- The marketplace scrapers are the slow part of a lookup (a real window, a Cloudflare challenge, then a detail
  page for the enrichment). They dominate the total time, so the TCGdex fetch is currently free — it overlaps
  them. Gating the marketplaces on it would add its whole duration to every scan.
- TCGdex is not always fast. Observed: Gemini read `SWSH` for a Crown Zenith card, the abbreviation matched
  `dp3`, six card fetches 404'd or returned the wrong card, the set cache was refreshed, and only the
  `name + localId` search found `swsh12.5-014` — seconds of work. Waiting for that would have been a visible
  regression.
- The same trust was obtained for free from the **local** Bulbapedia index, which is resolved before any
  network call: for an EN scan its matched record's source side is the scanned EN card, so its set name is
  authoritative (`pickPricechartingSetToken` prefers it, §7.1). The scraper then ranks the search rows by card
  name, printed number, and set (§12.2), so a misread set name no longer produces a wrong pick.

**When to revisit:** if scans keep picking the wrong marketplace printing even though the row ranking had the
correct row available (i.e. the misread data never entered the results), gating the queries on the TCGdex
result becomes the remaining option — accept the added latency, and keep CardRush parallel because it only
needs the set code and local id.

## 7. Marketplace Search Query Logic

This section is the most important reference when changing search behavior. For flow diagrams of the same logic
(query construction, index resolution, listing selection, cross-version sections), see
[`SEARCH_LOGIC.md`](SEARCH_LOGIC.md).

### 7.1. General Rules

```text
cardLocalId = the first portion of the card number
fullCardNumber = promo ? cardLocalId : (cardNumberFull or cardLocalId)
```

PriceCharting uses:

```text
{English card name} {fullCardNumber} {set token}
```

The set token is picked in this order (`pickPricechartingSetToken`):
1. the set name from the index's own EN source — authoritative and local, available before any network call
   (observed: Gemini read `Sword & Storm` for a Crown Zenith `014/159`, and the index knew `Crown Zenith`);
2. the set name Gemini read;
3. the printed set code, **for EN scans only** — a Japanese set code such as `XY1B` means nothing to
   PriceCharting.

A Japanese-script set name is never used. PriceCharting searches a
card name across every set, so without the token the scanned printing ranks far down the results (observed: the
XY Beedrill `5/146` was 10th of 18, and the cross-version `Beedrill 003/060` sat below unrelated Beedrill ex
cards). The token and the card name are also sent to the scraper, which ranks the search rows by them (the
name matters most: a misread set name can return a hundred rows, and the printed number alone can land on a
different card that shares it, e.g. Charizard VSTAR `#14` for a Leafeon VSTAR `014/159`).

Collectr and TCGPlayer use:

```text
{English card name} {fullCardNumber}
```

...unless the scan is Japanese and the Bulbapedia index resolved an exact English counterpart. Those two
marketplaces only sell the English printing, so they then use the counterpart's own name and number:

```text
{Bulbapedia target card name} {Bulbapedia target card number}      e.g. "Darkrai 107/108"
```

The EN name used by PriceCharting, Collectr and TCGPlayer is resolved before the queries are built: the
index counterpart name first, then the cross-version counterpart (`findEnCounterpart`), then the name read
from the card. When the read name is Japanese (a Trainer/Energy card, which has no dexId) and the index has
no counterpart, the cross-version search runs *before* the three EN queries so they never receive a Japanese
name; that delay applies only to this case. PriceCharting keeps the source card number (its JP listings are
the correct printing) but uses the resolved English name.

CardRush is a Japanese marketplace, so it is queried only for Japanese scans:

```text
{resolved set code} {cardLocalId}
```

An English scan never queries CardRush (`shouldQueryCardrush`); it reaches the Japanese printing's prices
through the JP Version section's Look Up Price button, which runs its own Japanese lookup with the exact
indexed set code and number (e.g. `S11 125`).

### 7.2. Queries by Card Type

| Card type | Input | CardRush | PriceCharting | Collectr | TCGPlayer |
|---|---|---|---|---|---|
| Normal EN | Armarouge ex, PAR, `027/182` | Skipped for EN | `Armarouge ex 027/182 PAR` | `Armarouge ex 027/182` | `Armarouge ex 027/182` |
| Normal JP | Roaring Moon ex, SV4K, `054/066` | `SV4K 054` | `Roaring Moon ex 054/066` | `Roaring Moon ex 054/066` | `Roaring Moon ex 054/066` |
| Promo JP | Pikachu, SV-P, `074/SV-P`, `isPromo=true` | `SV-P 074` | `Pikachu 074` | `Pikachu 074` | `Pikachu 074` |
| Promo with a single number | Pikachu, SV-P, `074` | `SV-P 074` | `Pikachu 074` | `Pikachu 074` | `Pikachu 074` |
| Deck JP, no printed code | M Venusaur-EX, BREAK, `002/072` | `MフシギバナEX 002` | `M Venusaur-EX 002/072` | `M Venusaur-EX 002/072` | `M Venusaur-EX 002/072` |
| EN scan with an index hit | Beedrill, XY, `5/146` | Skipped for EN | `Beedrill 5/146 XY` | EN counterpart `5/60` | EN counterpart `5/60` |
| JP scan with an index hit | Zeraora VMAX, S12a, `041/172` | `S12a 041` | source number `041/172` | EN counterpart `054/159` | EN counterpart `054/159` |
| JP scan, no index record | Zeraora VMAX, `054/100`, Japanese name | `S99 054` | source number `054/100` | resolved EN card `54/159` | resolved EN card `54/159` |

### 7.3. Why the Rules Differ

- CardRush searches Japanese cards effectively with a set code and local ID.
- PriceCharting, Collectr, and TCGPlayer use the English card name.
- For a normal card, `/setTotal` reduces ambiguity when several sets contain the same Pokémon and local number.
- For a promo card, suffixes such as `/SV-P` can reduce search accuracy on Collectr and TCGPlayer, so only the local number is used.
- PriceCharting also gets the set token (§7.1) because it searches a name across every set, and the scraper ranks the
  returned rows by card name, then printed number, then set label (§12.2).
- A deck printing has no printed set code, so CardRush is queried by the Japanese card name instead
  (`printsNoSetCode`, §7.4). A placeholder code such as `BREAK 002` returns unrelated listings.
- When the Bulbapedia index resolves a counterpart, Collectr and TCGPlayer use that counterpart's English name and
  number, while PriceCharting keeps the scanned printing's number because its Japanese listings are the correct
  printing for a Japanese card.
- `resolveEnMarketTarget` (`utils/card-lookup.js`) picks that counterpart: the index target when there is one,
  otherwise the TCGdex card resolved for a Japanese scan (the C5 path). `buildEnMarketNumber` builds its number —
  the target's `cardNumber`, or `{localId}/{set.cardCount.official}` for a TCGdex card — and
  `extractLocalIdFromNumber` gives the local id used to select the listing, so the query and the selection always
  agree. Without a counterpart both fall back to the scanned values.
- `pickListingByLocalId` compares parsed numbers numerically as well as literally, because sources disagree on zero
  padding (`074` vs `74`), and tries both forms in its text fallback. The name it is given is the one the query
  used — the Japanese name for CardRush, the counterpart's English name for Collectr and TCGPlayer.

### 7.4. Resolved Set Code

When TCGdex returns a card, the CardRush query uses `card.set.id` instead of the raw detected set code. If TCGdex data is unavailable, the original set code is used.

The exception is a deck printing. The index carries `printsNoSetCode: true` for those (BREAK Starter Pack, Sun &
Moon Starter Set), and `buildCardrushKeyword()` then builds `{Japanese card name} {localId}` instead of
`{setCode} {localId}`. The JP Version section's Look Up Price button passes the same flag through
`data-name-keyword` / `data-jp-name`, because that flow skips the index.

### 7.5. Fallback When TCGdex Cannot Find the Card

When TCGdex cannot find the card, `lookupCardAndPrice` still returns the marketplace results it already
fetched in parallel — the same queries built in §7.1 — with `card: null`. CardRush keeps
`{resolvedSetCode} {cardLocalId}` and the EN marketplaces keep their name-based queries.

Promo inference relies on a card number without a slash. Gemini's `isPromo` value is passed to
`lookupCardAndPrice`, not to a separate fallback function.

## 8. Manual Search Syntax

The popup supports the language suffix `JP`, `JA`, or `EN`.

Primary accepted formats:

```text
M2a-017
M2a 017
s10b 028/071
017/193 M2a
017/193
Pikachu 028/071
Pikachu 028/071 s10b
Pikachu s10b 028/071
Pikachu 028/071 EN
```

The popup parses the query, stores it temporarily in `chrome.storage.local`, and opens the scanner with the `#manual` hash.

The current popup parser accepts alphanumeric set-code tokens. For set codes containing a hyphen, such as `SV-P`, scan an image and edit the scanner fields directly if the popup parser does not accept the input.

## 9. TCGdex Lookup

### 9.1. Card Lookup

TCGdex uses locale-specific endpoints:

```text
https://api.tcgdex.net/v2/{language}/cards/{setId}-{localId}
```

Supporting mechanisms include:

- Printed set-code aliases, especially for English codes such as `PAR -> sv04`.
- Set-abbreviation matching.
- Cached set lists to reduce repeated requests.
- Set-name and card-name fallback when a direct ID is insufficient.
- Zero-padded local IDs.

The last step of the chain refetches the whole set list and abbreviation map (220+ sets) once, which can rescue
a **stale cache** — a set released after the cache was written. That refresh only runs when the printed code
could not be mapped to any set: when a mapping existed, its candidates already 404'd or returned a different
card, and re-deriving the same mapping would just repeat those requests. Observed before this guard: `SWSH`
mapped to `dp3`, every candidate mismatched, and the refresh refetched 220 sets before the `name + localId`
search found the card.

### 9.2. Metadata Used by the Application

- `id`.
- `localId`.
- `name`.
- `rarity`.
- `image`.
- `set.id`, `set.name`, and `set.cardCount.official`.
- `dexId`.
- `hp`.

Human-readable TCGdex rarity names are converted to short codes such as `RR`, `SAR`, `AR`, and `P` through `TCGDEX_TO_CARDRUSH_RARITY`.

## 10. Cross-Language Matching

### 10.1. Purpose

- For an English card, find a Japanese counterpart.
- For a Japanese card, find an English counterpart.
- Display a larger image, metadata, and a separate **Look Up Price** button.
- Set `skipCrossVersion=true` during cross-card pricing to prevent recursion.

### 10.2. Gemini Cross-Version Fields

Gemini Vision is prompted to identify the counterpart card in the other language by matching the **same artwork** (same illustration, same pose, same character, same background). If the illustration differs, it is not a counterpart even for the same Pokemon.

Gemini returns three cross-version fields:
- `crossSetCode`: the counterpart's set code (e.g. "SSP" for EN, "SV-P" for JP).
- `crossSetName`: the counterpart's set name.
- `crossCardNumber`: the counterpart's card number (may differ for high-class and promo sets).

The prompt keeps the counterpart concept and three examples (same artwork, different totals, promo numbering) but no longer carries a hard-coded JP-to-EN mapping list: the bundled index resolves those mappings instead, and `crossSetCode` / `crossCardNumber` remain as fallbacks for eras the index does not cover. Recognition is verified to still return every field of the schema below.

### 10.3. Matching Order

1. **Bulbapedia index first.** Resolve the scanned card against the bundled index (§10.8). A unique target that passes validation is used as the counterpart, and for Japanese scans it becomes the English Version card (§10.9). The steps below only run when the index misses, is ambiguous, or fails validation.
2. If Gemini provides both `crossSetCode` and `crossCardNumber`, try a direct TCGdex lookup.
3. Accept a direct result only when:
   - `dexId` values are compatible when both cards have dex IDs.
   - HP values match when both cards have HP.
4. If the direct lookup is invalid or unavailable, search the target locale by card name.
5. Prefer candidates with the same local ID when available.
6. If the local ID does not match, prefer candidates from the counterpart or source set.
7. Fetch full details for a limited candidate set.
8. Filter by `dexId` when available.
9. Filter by `rarity` using `TCGDEX_TO_CARDRUSH_RARITY` to map both source and candidate rarities to a shared short code (e.g. JP "Character Super Rare" and EN "Special illustration rare" both map to "SAR").
10. If the name search returns no results, scan cards in the counterpart or source set.
11. If needed, fall back to searching by dexId.

### 10.4. JP-to-EN Set Mapping

JP and EN TCGdex set IDs follow different patterns:
- JP main sets: `SV8`, `SV7`, `SV6`...
- EN main sets: `sv08`, `sv07`, `sv06`...
- JP high-class sets (suffix "a"): `SV8a`, `SV7a`...
- EN high-class sets: `sv08.5`, `sv07.5`...

The extension uses two mechanisms to map JP set codes to EN set IDs:
1. **Explicit map** (`JP_TO_EN_SET_MAP`): hardcoded entries for verified edge cases.
2. **Auto-derive** (`deriveEnSetIdFromJpCode`): pattern-based derivation for Scarlet & Violet sets:
   - `SV{n}` → `sv0{n}` (e.g. SV7 → sv07, SV10 → sv10)
   - `SV{n}A` → `sv0{n}.5` (e.g. SV7A → sv07.5, SV8A → sv08.5)

The explicit map is checked first; auto-derive is the fallback. This avoids hardcoding every set while still supporting edge cases.

### 10.5. Rarity Matching

When multiple candidates share the same `dexId` and set, rarity is used as a tiebreaker. Both JP and EN TCGdex rarity strings are mapped to a shared short code via `TCGDEX_TO_CARDRUSH_RARITY`:

| JP rarity | EN rarity | Short code |
|---|---|---|
| Character Super Rare | Special illustration rare | SAR |
| Character Rare | Illustration rare | AR |
| Holo Rare V | Double rare | RR |
| Holo Rare VSTAR | Triple rare | RRR |
| Mega Hyper Rare | Secret Rare | HR |

The source card's rarity is taken from Gemini's `rarityCode` field when TCGdex returns `rarity: "None"` (common for JP high-class sets).

### 10.6. HP as a Matching Guard

HP prevents incorrect variant matches, such as matching a normal Pokémon to its `ex` version:

- If source HP is known and no set-scan or dexId candidate has the same HP, the extension does not select an arbitrary first result.
- A fallback may derive the base Pokémon name for marketplace searches when the correct variant cannot be confirmed.

### 10.7. Promo Counterparts

Japanese and English promo counterparts may use different card numbers. Gemini may therefore provide a counterpart set while leaving `crossCardNumber` as `null`. The extension then falls back to name, set, dexId, HP, and rarity matching.

### 10.8. Bulbapedia Exact Counterpart Index

The primary counterpart source is a card-level index generated from Bulbapedia during development. Bulbapedia is never called at runtime; the extension only reads the bundled data, so no extra host permission is required.

- **Coverage**: eight eras (`dp`, `bw`, `hgss`, `xy`, `sm`, `swsh`, `sv`, `m`), 21,412 published records (plus 6,951
  `enToJa` entries that carry a Japanese set code, and usually a card number, but no TCGdex set, so they serve
  marketplace keywords only). The DP era is covered from `DP6` Intense Fight in the Destroyed Sky onward plus its
  promos; the six early DP sets (Space-Time Creation, Secret of the Lakes, Shining Darkness, Dawn Dash/Moonlit
  Pursuit, Cry from the Mysterious/Temple of Anger) have no Japanese card number on Bulbapedia, so their `enToJa`
  entries name the Japanese set without a number and the runtime fails closed on them (§10.9) rather than letting
  TCGdex guess a printing from another era. 41 promo/subset printings in the other eras are in the same shape
  (`XY-P`, `SM-P`, `S-P`, `SV-P`, `L-P`, Shiny Treasure ex) and behave the same way.
- **Record shape**: a source side (language, set code, set name, card number, names, rarity, HP) plus one or more targets with the same fields, each with provenance (page title, page id, revision id). Multi-target records are kept, never collapsed.
- **Two sections per era**: `records` holds structured relationships (both directions when TCGdex JA has cards, as in SM/SV/M) and `enToJa` holds marketplace-only reverse records used when TCGdex has no Japanese cards (DP, BW, HGSS, XY, most of SWSH).
- **Key format**: `{language}:{setCode}:{normalizedSetName}:{cardNumber}`. The physical set name is part of the key because paired Japanese products reuse the same printed code and number (e.g. `BW1` Black Collection vs White Collection, `BW6` Cold Flare vs Freeze Bolt).
- **Resolution order** (`resolveBulbapediaCounterparts`): set code + local id group (the group index is keyed by the set code the record stores **and** by its source-side TCGdex set id, and the caller passes the printed code resolved through the shared abbreviation table as `setCodeAliases`, so a card printed `JTG` still finds the record stored as `SV09`), then the full card number, then the set name, then the card name (experimental, ignores print decorations such as `M`/`Primal`/`EX`/`BREAK`), then the full number plus card name as a last resort for misread set codes. The outcome is `hit`, `ambiguous`, `multi-target`, or `miss`; it never silently picks one of several candidates.
- **Loading**: the bundles total about 12.4 MB, so `lib/bulbapedia-index.js` injects them on demand and merges them into `BULBAPEDIA_INDEX.ja` / `.en`. Popup and scanner never load the index at startup. `ensureBulbapediaIndexes({ setCode, setName })` injects only the era the scan belongs to, resolved from the generated `data/bulbapedia/set-era-map.js`; when the set code and name are both unknown it falls back to every era. A resolution *miss* while the index is still narrowed is retried once after loading every era (`ensureAllBulbapediaIndexes`), because the set code may have been misread into another era's code. The caller re-reads `BULBAPEDIA_INDEX` after that load, since `rebuildBulbapediaIndex()` replaces the language views.
- **Review gate**: each era carries `review-decisions.json`; the bundler refuses to publish without approval, and `exclusions.json` drops records whose pairing was found wrong.

### 10.9. Validation, Adoption, and Conflict Policy

- **Source fetch (English scans)**: the index supplies the TCGdex set of the scanned card itself, so a misread printed code or an empty set name cannot derail it: `getIndexedSourceCorrection` puts the index's `{setCode, localId, setName}` into the first `FETCH_CARD_INFO` call. It needs the resolver to have hit first, which a wrong code plus an empty set name still allows through the last-resort path (full printed number plus card name). A bare local id without the `/total` cannot be rescued that way, because a number alone is ambiguous across sets.
- **Validation**: a target that has a TCGdex set id is fetched in the target's own language, and the returned card must match the expected id and name. The name comparison uses `japaneseName` for Japanese targets and keeps letters from every script. Missing metadata cannot reject a candidate — only present-and-different metadata can.
- **Adoption (Japanese scans)**: a validated target becomes the English Version card. When the pipeline's own search disagrees with the index, the index wins (`selectCrossVersionCard`) and the override is logged with the pipeline id, the index id, the source key, and the comparison result.
- **Display (English scans)**: the indexed Japanese printing is rendered directly through a synthesized card object, so the Japanese Version section works even though TCGdex has no Japanese card for those eras. Its Look Up Price button queries CardRush with the indexed set code and number (e.g. `S11 125`).
- **Display (English scans), set known but number unknown**: an `enToJa` record may name the Japanese set without a card number (the six early DP sets). `buildBulbapediaJpVersion` returns null without a `localId`, and the three `findJpVersion` searches are skipped, because TCGdex has no card for those sets and its name search can only return a different printing (observed: EN `Great Encounters 3/106 Darkrai` came back as `SM5S-031`). The section then shows no Japanese Version rather than a wrong card.
- **English marketplace queries**: TCGPlayer and Collectr switch to the resolved English counterpart's name and number when one exists (§7.1).
- **Fast JP price lookup**: when the JP section renders an indexed printing whose era has no TCGdex JA card, its Look Up Price button sets `data-skip-tcgdex`, so `lookupCardAndPrice` skips the TCGdex fetch (guaranteed to fail) and goes straight to the marketplace queries. Eras with a TCGdex JA card (SM, SV, M) still fetch.
- **CardRush-empty image fallback**: the JP section's Look Up Price fills an empty thumbnail from the CardRush listing image, and when CardRush has no listing it uses the image of whichever other marketplace (Collectr, TCGPlayer, PriceCharting) returned a result. No extra request is made — those marketplaces are already queried in parallel.
- **Provenance badge**: the cross-version section header shows `Verified` when the displayed printing came from a reviewed index hit (JP section on a `hit`, or an adopted validated EN counterpart) and `Unverified` when it came from the TCGdex search path. Computed by `resolveCrossVersionProvenance` / `renderCrossVersionBadge` in `utils/card-lookup.js`.
- **Fail-closed**: `ambiguous`, `multi-target`, `miss`, and validation failures never change a query or the displayed counterpart.

## 11. Marketplace Scraper Behavior

### 11.1. CardRush

- Uses a real browser tab or window because Cloudflare's JavaScript challenge blocks plain `fetch` requests.
- Waits for the page and challenge, injects `extractCardrushListings`, and reads the rendered DOM.
- Keeps the window open if manual Cloudflare verification is required.
- Is skipped for English cards.
- Only real search results are extracted. CardRush renders "recently viewed"/recommendation carousels at the bottom of every page whose links also point at `/product/`; the extractor skips links inside such a section (matched by section id/class or heading) and only keeps a lenient listing when its price parses, so a no-results search reports empty instead of showing history tiles.
- Supports both Japanese and English page rendering:
  - Price: `円(税込)`, `円(tax included)`, or bare yen amount.
  - Stock: `在庫数` (JP) or `Quantity in stock` (EN).
  - Condition: `状態A-`/`状態B` (JP) or `[Condition A-]`/`[Condition B]`/`[Condition C]` (EN).
  - Product name: `【SAR】{212/187}` (JP) or `[SAR] { 212 / 187 }` (EN).
  - Card number whitespace is normalized (e.g. `212 / 187` → `212/187`).

### 11.2. PriceCharting

- Opens a minimized window.
- Handles Cloudflare challenges.
- Scrolls search rows to trigger lazy-loaded images.
- Extracts ungraded, grade 7, and grade 8 values from the search table.
- Uses `img.photo` for search thumbnails and upgrades `/60.jpg` or `/60.webp` URLs to `/240` images.
- Enriches the **first search listing** from its detail page with:
  - Recent sale.
  - Grade 9 price.
  - Grade 10 price.
  - Detail image.
- Supports the case where a search redirects directly to a product detail page.

### 11.3. Collectr

- Collectr is a Next.js SPA.
- The scraper opens a small window, waits for the SPA and product cards to render, and injects its extractor.
- The search URL is retained so users can reopen the search page.

### 11.4. TCGPlayer

- TCGPlayer is a React SPA and may not render in a hidden tab.
- The scraper adjusts the page visibility state when needed.
- The search extractor returns up to 10 unique product IDs.
- If a lazy-loaded image URL is unavailable, it constructs a thumbnail URL from the product ID:

```text
https://tcgplayer-cdn.tcgplayer.com/product/{productId}_in_1000x1000.jpg
```

- The first search listing is enriched from its detail page with:
  - Market Price.
  - Most Recent Sale.
  - Listing Price.
  - Alternative-printing prices.
  - Detail image when available.

## 12. Primary Results and Top Five

### 12.1. Retained Listing Arrays

The lookup result retains up to five search listings for each marketplace:

- `cardrushAllListings`.
- `pricechartingAllListings`.
- `collectrAllListings`.
- `tcgplayerAllListings`.

### 12.2. Current Primary Selection

| Marketplace | Primary selection |
|---|---|
| CardRush | `pickListingByLocalId`, using the local card number, then the Japanese card name |
| PriceCharting | `rankPricechartingListings`: ranks the search rows so the scanned printing comes first — card name (4) beats printed number (2) beats set label (1); keeps the search order when nothing matches |
| Collectr | `pickListingByLocalId`, using the counterpart's local number, then the English card name |
| TCGPlayer | `pickListingByLocalId`, using the counterpart's local number, then the English card name |

`pickListingByLocalId` first compares the listing's parsed `cardNumber` local part (`"212/187"` →
`212`) with the wanted local id. CardRush and Collectr listings carry that field, while their
`productName` holds only the card name, so the parsed number is the reliable match. When a listing has
no parsed number, the product name and URL are searched with these patterns:

```text
#{localId}
 {localId} 
-{localId}
/{localId}
{localId}/
```

When no listing matches the number, the card name decides. The name is normalized (NFKC, lowercased, without a
trailing `EX`/`GX`/`VMAX`/`VSTAR` suffix or spaces) and an exact match — or a containment match of at least four
characters — wins over the first listing. CardRush's search is fuzzy: a query for one printing returns every
printing in the set (observed: `S8b 110` returned 23 different numbers with `204/184` first), so without the name
step a sold-out card showed another card's price.

If neither the number nor the name matches, the first listing is selected.

This is a heuristic and is not yet full confidence-based matching by set and card variant.

### 12.3. Top-Five Rendering

The primary result is rendered separately in the marketplace block. Then:

1. `renderAlternativesList` removes any listing with the primary result's `productUrl`.
2. It takes up to four remaining listings.
3. The list is a collapsed `<details>` labelled `Other results (n)`, so it is secondary to the picked listing
   but still keyboard- and screen-reader-accessible.
4. Each row displays a thumbnail, name, price, and right chevron.
5. Clicking a row opens the product detail page in a new tab.
6. Clicking a thumbnail prevents navigation and opens the image overlay.

Therefore, “top five” means:

```text
1 primary + up to 4 alternatives = up to 5 unique product URLs
```

The primary result is not repeated in **Other results**.

After a lookup, `scrollIntoViewIfPossible` brings the freshly rendered block into view, because results sit
below the capture/OCR sections on the scanner page. The main result uses `block: 'start'`; the cross-version
Look Up Price result (and its "not found" message) uses `block: 'nearest'`, so it scrolls only when out of
view and keeps the section header, badge, and printing info visible.

### 12.4. Known Limitations

- Search engines may return several cards with the same Pokémon name and local number from different sets.
- A full `{number}/{setTotal}` query improves search precision, but primary selection currently matches only the local number.
- PriceCharting and TCGPlayer enrich the first scraper result. If downstream matching selects a different primary result, that selected result may not contain the detail enrichment applied to the first result.
- Full Option C confidence scoring by set, full number, language, and variant has not yet been implemented.
- The Bulbapedia index covers eight eras (`dp`, `bw`, `hgss`, `xy`, `sm`, `swsh`, `sv`, `m`). The EX series, the e-card series, and the Wizards/Base sets are not covered. DP (shipped 2026-09-23) is partial by construction: Bulbapedia prints no Japanese card number for its six early sets, so only `DP6` onward and the `DP-P`/`DPt-P` promos have exact records, while the early sets carry `enToJa` entries that name the Japanese set without a number and therefore show no Japanese Version (fail closed, §10.9). 24 of its targets carry a TCGdex naming variant (`LV.X` dropped, form/cloak suffixes added, SP `4` vs `E4`) so they stay fail-closed at runtime. All known gaps shipped on 2026-09-19: SWSH `S2a`, `S5a`, `S3` (86 + 96 + 119 records; `S3` was found by a real scan), Generations ↔ BREAK Starter Pack (65), SM `SM1p` and the SM Sun & Moon Starter Set (40 + 17), and XY11a was fixed (it used to point at S2a's Bulbapedia category, so it had no records). See the integration plan for details.
- The Japanese Version section has no artwork when the era's JA set is absent from TCGdex (BW, HGSS, XY, most of SWSH), because the printing is rendered from index data only.
- A handful of index records are dropped through `exclusions.json` when Bulbapedia's pairing was found wrong, and one SV record (`Ruler of the Black Flame 141/108` → `Paldea Evolved 230/197`) fails TCGdex validation and is therefore never adopted.

## 13. Price Display and Conversion

- CardRush source prices are in JPY.
- PriceCharting, Collectr, and TCGPlayer source prices are in USD.
- Exchange rates are retrieved from `open.er-api.com` with JPY and USD base currencies.
- Exchange rates are cached for six hours.
- The UI displays the original price and relevant USD or VND conversions.
- If the exchange-rate request fails, source prices can still display, but conversions may be unavailable.

## 14. Image Behavior

Image priority varies by result block, but the extension generally prefers a valid marketplace image before using a TCGdex fallback.

`data:image/gif` and `data:image/png` placeholders are rejected as valid marketplace images.

- Main scanned-card thumbnail: 80 px wide.
- Cross-language card thumbnail: 80 px wide.
- Japanese Version thumbnail (C1): the index-synthesized JP printing has no image, so the JA TCGdex card the validation fetch returned is used when its era has one (SV/SM/M). Eras without JA artwork (BW/HGSS/XY/most SWSH) start empty and are filled after the section's Look Up Price runs: the CardRush listing image first, then another marketplace's result image when CardRush has no listing.
- Small marketplace thumbnail: 48 × 48 px.
- PriceCharting search images are upgraded from a 60 px URL to a 240 px URL.
- Alternative and cross-result thumbnails support the image overlay.

## 15. Storage and Caching

| Key | Contents | TTL or limit |
|---|---|---|
| `scanHistory` | Recent scans | Maximum 10 |
| `settings` | Gemini key, image quality, and `autoLookup` (the scanner treats only an explicit `false` as off, so existing installs default to on) | No TTL |
| `setListCache` | TCGdex set lists | 7 days |
| `exchangeRatesCache` | JPY, USD, and VND rates | 6 hours |
| `setAbbreviationMap` | Set abbreviation mapping | Managed by the TCGdex client |
| `setCodeMappingCache` | Set-code mapping | Managed by the TCGdex client |
| `emptySetCache` | Sets TCGdex lists but serves with no cards (all SWSH-era JA sets, for example) | Managed by the TCGdex client; avoids the full fallback chain on every miss |
| `snapshotData` | Temporary snapshot (multi-MB image data URL) | Written to `chrome.storage.session` when available — in memory, no disk write — and removed after scanner consumption; falls back to `storage.local` |
| `uploadImageData` | Temporary uploaded image | Removed after scanner consumption |
| `manualSearchData` | Temporary manual-search input | Used to open the scanner flow |

Settings can clear scan history and TCGdex caches.

The Bulbapedia counterpart index is bundled with the extension (`data/bulbapedia/<era>/counterpart-index.js`)
and loaded on demand, not stored in `chrome.storage`. The review artifacts (`counterpart-index.json`,
`review-decisions.json`, `exclusions.json`) ship alongside it but are never read at runtime.

## 16. Message Protocol

Primary messages from UI pages to the service worker:

UI pages send these through `sendMessageSafely()` (`utils/card-lookup.js`), which turns a rejected
`chrome.runtime.sendMessage` — a service worker that cannot be reached — into `{ success: false }`. Every
caller already handles that shape, so a dead service worker degrades the lookup instead of throwing out of it
and leaving the scanner button on "Searching...".

| Message | Purpose |
|---|---|
| `RECOGNIZE_CARD_CODE` | Gemini recognition |
| `FETCH_CARD_INFO` | TCGdex card lookup |
| `FETCH_CARDRUSH_PRICE` | CardRush search and scraping |
| `FETCH_PRICECHARTING` | PriceCharting search and scraping. Payload: `{ query, setName, cardName }` — `setName` is the set token also used in the query, and both let the scraper rank the rows |
| `FETCH_COLLECTR` | Collectr search and scraping |
| `FETCH_TCGPLAYER` | TCGPlayer search and scraping |
| `FETCH_ALL_SETS` | Retrieves a locale-specific set list |
| `PRELOAD_SETS` | Preloads set and abbreviation data |
| `FETCH_EXCHANGE_RATES` | Retrieves exchange rates |
| `FIND_JP_VERSION` | Finds a Japanese counterpart |
| `FIND_EN_VERSION` | Finds an English counterpart |

Response convention:

```js
{ success: true, data: ... }
{ success: false, error: "...", data: ... }
```

## 17. Permissions and Network Access

Extension permissions:

- `storage` and `unlimitedStorage`.
- `tabs`.
- `scripting`.
- `activeTab`.
- `commands`.

Host permissions:

- `www.cardrush-pokemon.jp`.
- `api.tcgdex.net`.
- `generativelanguage.googleapis.com`.
- `open.er-api.com`.
- `www.pricecharting.com`.
- `app.getcollectr.com`.
- `www.tcgplayer.com`.

There is deliberately **no** Bulbapedia host permission: the counterpart index is generated during
development and bundled with the extension.

Marketplace extractors are injected with `chrome.scripting.executeScript({ func })`. Each injected function must be self-contained because sibling functions in the same source file are not automatically available in the page context.

## 18. Important Rules for Future Changes

1. Resolve the Bulbapedia index before any TCGdex search, and never let an `ambiguous`, `multi-target`, or failed-validation result change a query or the displayed counterpart.
2. CardRush is Japanese-only. Preserve `{setCode} {localId}` (never the full card number), and never query it for an English scan.
3. For PriceCharting, Collectr, and TCGPlayer:
   - Normal card: use `{name} {number}/{total}` when available.
   - Promo card: use `{name} {localId}`.
   - Japanese card with a resolved English counterpart: TCGPlayer and Collectr use the counterpart's name and number; PriceCharting keeps the scanned card's number.
4. Do not strip a real suffix such as `ex`, `V`, `VSTAR`, `VMAX`, or `GX` after the official counterpart has been identified.
5. Use a base Pokémon name only as a fallback when the correct counterpart variant cannot be confirmed.
6. Validate direct cross-language matches with dexId and HP to avoid matching a normal card to an `ex` card.
7. Keep `skipCrossVersion=true` during cross-card price lookup to prevent recursion.
8. Remove the primary result from **Other results** by `productUrl`.
9. When changing thumbnail handlers, test the main result, alternatives, and cross-language results.
10. An injected extractor function must not call an external helper unless that helper is injected with it.
11. Test query-format changes in scan, manual, and cross-language flows.
12. Run `npm test` (and `./safari/build-safari.sh` when runtime files changed) after touching lookup, index, or rendering logic.

## 19. Recommended Test Matrix

| Case | Expected behavior |
|---|---|
| EN normal `Armarouge ex 027/182` | The three USD marketplaces use the full number; CardRush is skipped |
| JP normal `Roaring Moon ex 054/066` | CardRush uses `SV4K 054`; the three other marketplaces use the full number |
| JP promo `Pikachu SV-P 074` | CardRush uses `SV-P 074`; the three other marketplaces use `Pikachu 074` |
| Gemini omits the counterpart number | Cross-language search falls back to name, set, dexId, and HP |
| Gemini returns a wrong counterpart set/code | The Bulbapedia index still resolves the exact counterpart when the number and name identify one record |
| EN card with an indexed Japanese counterpart | The JP Version section shows the indexed printing and CardRush is skipped for the main scan |
| JP card with a validated indexed target | The English Version uses the TCGdex card; TCGPlayer and Collectr query the English number |
| JP card whose era has no TCGdex JA cards (BW/HGSS/XY/most SWSH) | The JP Version still renders the synthesized printing; Look Up Price queries CardRush with the indexed set code |
| Gemini flags `isPromo` on a card printed with a total | The printed total is kept and the promo flag is ignored |
| Printed set code is already a TCGdex set id (`me05`, `swsh1`) | No fuzzy abbreviation attempts; the card is fetched directly |
| JA set TCGdex lists without cards (`S2`) | The lookup fails fast from `emptySetCache` instead of running the fallback chain |
| Gemini returns an incorrect counterpart number | The direct result is rejected when dexId or HP does not match |
| Marketplace primary is result 1 | **Other results** begins with the next unique result |
| Marketplace primary is result 2–5 | The primary result is not repeated in alternatives |
| TCGPlayer image is lazy-loaded | The product-ID CDN fallback displays an image |
| PriceCharting alternatives | `img.photo` displays and the overlay uses a 240 px image |
| Cross-language alternatives | Thumbnail click opens the overlay; row click opens the detail page |
| No Gemini key | The scanner switches to Tesseract OCR |
| Exchange-rate API fails | Source prices remain available; conversion may be absent |

## 20. Verification After Changes

1. Reload the unpacked extension at `chrome://extensions`.
2. Run a syntax check for each modified JavaScript file:

```bash
node -c path/to/file.js
```

3. Test at least one normal card, one promo card, and one cross-language lookup.
4. Check the generated query log:

```text
[card-lookup] search queries (parallel): ...
```

5. Confirm that the primary result is not repeated in **Other results**.
6. Test thumbnail overlays and product detail links.
7. Confirm that lookup buttons are re-enabled after success or failure.
8. Run the unit suite (`npm test`) and, when runtime files changed, `./safari/build-safari.sh`.
