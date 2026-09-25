# Pokemon TCG Card Scanner - Chrome Extension

> **Historical document.** This is the original plan written before the extension supported Safari, the
> Bulbapedia counterpart index, and the PriceCharting/Collectr marketplaces. It is kept for design history and is
> **not** a description of the current product. For the current behavior see [`README.md`](README.md) and
> [`docs/APP_DOCUMENTATION.md`](docs/APP_DOCUMENTATION.md).

## Overview

A Chrome extension that scans Pokemon TCG cards (Japanese + English) via camera or image upload, identifies the card code, and fetches real-time pricing from **cardrush-pokemon.jp** (JP) and **TCGPlayer** (EN).

**Primary recognition: Gemini Vision API** (free tier). The user's card photo is sent to Google's Gemini Flash model with a structured prompt asking it to read the card code. This handles holo/foil textures, dark backgrounds, and tilted cards far better than local OCR.

**Fallback: local OCR** (Tesseract.js). When no Gemini API key is configured, the extension falls back to the existing Tesseract.js pipeline (crop bottom-left → preprocess → OCR). This keeps the extension usable offline / without an API key.

---

## Card Code Format

The bottom-left corner of every Pokemon TCG card has this format:

```
Illus. 5ban Graphics          <-- illustrator line (ignore)
H  M2a  017/193  RR          <-- data line (this is what we read)
│   │      │      │
│   │      │      └─ Rarity code: RR, SR, SAR, U, C, etc.
│   │      └──────── Card number: {local_id}/{set_total}
│   └─────────────── Set code (expansion mark): M2a, SV2D, S12
└─────────────────── Regulation mark: single letter H, G, F, etc.
```

All characters in the data line are **Latin + digits + slash**.

### Why Gemini Vision over local OCR

Local OCR (Tesseract.js) was the initial approach. It works on clean, flat card scans but **fails consistently on**:
- Holo/foil textured cards (speckle noise destroys character segmentation)
- Photos with card not tightly cropped (extra background shifts the fixed crop region)
- Dark translucent bar backgrounds under the code line
- Tilted or slightly rotated cards

Gemini Vision solves all of these because it understands what a Pokemon card looks like and can locate + read the code regardless of surface texture, angle, or framing.

**Cost**: Gemini Flash free tier is completely free for image understanding (text output). A single card scan uses ~300 input tokens (prompt) + ~1000 image tokens + ~50 output tokens. At paid rates this would be < $0.001 per scan, but on the free tier it costs nothing.

### Verified End-to-End Pipeline (real data)

```
Step 1: Gemini reads card photo
        → prompt asks for setCode, cardNumber, rarityCode as JSON
        → response: { "setCode": "M2a", "cardNumber": "017/193", "rarityCode": "RR" }

Step 2: Construct TCGdex card ID = "M2a" + "-" + "017" = "M2a-017"
        → GET https://api.tcgdex.net/v2/ja/cards/M2a-017
        → response.name = "オーガポン みどりのめんex"
        → response.set.cardCount.official = 193

Step 3: Build CardRush search keyword
        = response.name + "【" + rarityCode + "】" + "{017/193}"
        = "オーガポンみどりのめんex【RR】{017/193}"
        → GET https://www.cardrush-pokemon.jp/product-list?keyword={encoded}
        → parse HTML → price = 180円, stock = 16枚
```

---

## Tech Stack

| Component       | Technology                                                              |
| --------------- | ----------------------------------------------------------------------- |
| Extension       | Chrome Manifest V3                                                      |
| Card ID (primary) | Gemini Vision API (free tier, `gemini-flash-lite-latest`, REST, no SDK needed) |
| Card ID (fallback) | Tesseract.js v5 (`eng` model, WASM, ~2MB) — used when no API key     |
| Card DB         | TCGdex REST API (free, no key, `ja` + `en`)                            |
| JP Pricing      | cardrush-pokemon.jp (HTML scrape via browser tab)                       |
| EN Pricing      | TCGPlayer (link only, no scrape)                                        |
| UI              | Vanilla HTML/CSS/JS                                                     |
| Storage         | `chrome.storage.local`                                                  |

---

## File Structure

```
scan-tcg-card-extension/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── scanner/
│   ├── scanner.html
│   ├── scanner.css
│   └── scanner.js
├── settings/
│   ├── settings.html
│   ├── settings.css
│   └── settings.js
├── background/
│   └── service-worker.js
├── lib/
│   ├── tcgdex-client.js
│   ├── gemini-vision.js        ← NEW: Gemini Vision API wrapper (called from service worker)
│   ├── ocr-engine.js           ← FALLBACK: Tesseract.js wrapper (used when no API key)
│   ├── cardrush-scraper.js
│   └── tcgplayer-linker.js
├── utils/
│   ├── image-processor.js
│   ├── card-code-parser.js
│   ├── storage.js
│   └── constants.js
└── assets/
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## Implementation Details Per File

### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Pokemon TCG Card Scanner",
  "version": "1.0.0",
  "description": "Scan Pokemon TCG cards and check prices on CardRush (JP) and TCGPlayer (EN)",
  "permissions": ["storage", "tabs", "scripting"],
  "host_permissions": [
    "https://www.cardrush-pokemon.jp/*",
    "https://api.tcgdex.net/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "assets/icons/icon16.png",
      "48": "assets/icons/icon48.png",
      "128": "assets/icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "icons": {
    "16": "assets/icons/icon16.png",
    "48": "assets/icons/icon48.png",
    "128": "assets/icons/icon128.png"
  }
}
```

Notes:
- `wasm-unsafe-eval` is required for Tesseract.js WASM execution in extension pages (fallback OCR).
- `host_permissions` includes:
  - `cardrush-pokemon.jp` — price scraping via browser tab
  - `api.tcgdex.net` — card metadata lookup
  - `generativelanguage.googleapis.com` — **Gemini Vision API** calls from the service worker
- The scanner page sends the card image (as base64) to the service worker via `chrome.runtime.sendMessage`. The service worker then calls the Gemini API. This keeps the API key in the service worker only (not exposed in page JS).
- Tesseract.js is loaded from local files bundled in the extension (not CDN), because extensions cannot load external scripts.

---

### `background/service-worker.js`

**Purpose**: Handles all cross-origin network requests (CardRush scraping, TCGdex API). The popup and scanner pages communicate with it via `chrome.runtime.sendMessage`.

**Message protocol** (all messages are `{ type, payload }`, all responses are `{ success, data?, error? }`):

```
Message type: "RECOGNIZE_CARD_CODE"          ← NEW (Gemini Vision)
  payload: { imageBase64: "<base64 JPEG string>" }
  response: { success: true, data: { setCode: "M2a", cardNumber: "017/193", rarityCode: "RR" } }
  action: POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent
          with inline image + structured prompt
  notes: Reads the API key from chrome.storage.local (STORAGE_KEYS.SETTINGS → geminiApiKey).
         If no API key is configured, returns { success: false, error: "NO_API_KEY" } so the
         scanner page knows to fall back to local OCR.

Message type: "FETCH_CARD_INFO"
  payload: { setCode: "M2a", localId: "017", language: "ja" }
  response: { success: true, data: { <TCGdex card object> } }
  action: GET https://api.tcgdex.net/v2/{language}/cards/{setCode}-{localId}

Message type: "FETCH_CARDRUSH_PRICE"
  payload: { cardNameJp: "オーガポンみどりのめんex", rarityCode: "RR", cardNumber: "017/193" }
  response: { success: true, data: { listings: [...], searchUrl: "..." } }
  action: GET https://www.cardrush-pokemon.jp/product-list?keyword={encoded}
           then parse HTML → extract listings

Message type: "FETCH_ALL_SETS"
  payload: { language: "ja" }
  response: { success: true, data: [ { id: "M2a", name: "MEGAドリームex" }, ... ] }
  action: GET https://api.tcgdex.net/v2/{language}/sets
```

**Implementation logic for `service-worker.js`**:

```javascript
importScripts(
  '../utils/constants.js',
  '../lib/tcgdex-client.js',
  '../lib/gemini-vision.js',           // ← NEW
  '../content-scripts/cardrush-extractor.js',
  '../lib/cardrush-scraper.js'
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keeps the message channel open for async response
});

async function handleMessage({ type, payload }) {
  switch (type) {
    case "RECOGNIZE_CARD_CODE":          // ← NEW
      return recognizeCardWithGemini(payload.imageBase64);
    case "FETCH_CARD_INFO":
      return fetchCardInfo(payload);
    case "FETCH_CARDRUSH_PRICE":
      return fetchCardrushPrice(payload);
    case "FETCH_ALL_SETS":
      return fetchAllSets(payload);
    default:
      return { success: false, error: "Unknown message type" };
  }
}
```

**`recognizeCardWithGemini`**: reads API key from storage, calls Gemini API with the card image, parses the JSON response. See `lib/gemini-vision.js` section below for full details.
**`fetchCardInfo`**: calls TCGdex, returns card object.
**`fetchCardrushPrice`**: calls CardRush, parses HTML, returns listings array.
**`fetchAllSets`**: calls TCGdex sets endpoint, caches in `chrome.storage.local` for 24h.

---

### `lib/tcgdex-client.js`

**Purpose**: TCGdex API wrapper. Used by the service worker.

**Endpoints used**:

| Purpose       | Method | URL                                                     | Response type |
| ------------- | ------ | ------------------------------------------------------- | ------------- |
| Get card      | GET    | `https://api.tcgdex.net/v2/{lang}/cards/{setCode}-{localId}` | Single card object |
| Search cards  | GET    | `https://api.tcgdex.net/v2/{lang}/cards?name={name}`    | Array of card briefs |
| Get set       | GET    | `https://api.tcgdex.net/v2/{lang}/sets/{setId}`         | Set object with card list |
| List all sets | GET    | `https://api.tcgdex.net/v2/{lang}/sets`                 | Array of set briefs |

**Card object shape** (fields we use from the response):

```javascript
// GET https://api.tcgdex.net/v2/ja/cards/M2a-017
{
  "id": "M2a-017",                          // unique card ID
  "localId": "017",                          // number within set
  "name": "オーガポン みどりのめんex",         // card name in requested language
  "rarity": "Double rare",                   // human-readable rarity string
  "image": "https://assets.tcgdex.net/ja/M/M2a/017",  // card image URL (append /high.webp for high-res)
  "set": {
    "id": "M2a",                             // set code
    "name": "MEGAドリームex",                 // set name
    "cardCount": { "official": 193 }          // total cards in set
  },
  "hp": 210,
  "types": ["Grass"],
  "category": "Pokemon"                      // "Pokemon" | "Trainer" | "Energy"
}
```

**Image URL pattern**: `https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}/high.webp`

**Lookup logic**:

```
1. Try GET /v2/{lang}/cards/{setCode}-{localId}
2. If 404 and localId has no leading zeros, try with zero-padded (e.g. "17" → "017")
3. If 404, try GET /v2/{lang}/cards/{setCode}-{localId} with opposite case (e.g. "m2a" → "M2a")
4. If still 404, return { success: false, error: "Card not found" }
```

---

### `lib/gemini-vision.js` ← NEW

**Purpose**: Sends a card photo to the Gemini Vision API and returns the structured card code. Runs in the **service worker** (imported via `importScripts`), NOT in the scanner page — this keeps the API key out of page-level JS.

**API endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key={API_KEY}`

**Model choice**: `gemini-flash-lite-latest` — cheapest Flash model that supports image understanding on the free tier. Can be upgraded to `gemini-2.5-flash` or newer if needed (same API shape).

**Request format** (REST, no SDK):

```javascript
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

const GEMINI_CARD_CODE_PROMPT = `You are a Pokemon TCG card code reader. Look at this Pokemon TCG card image and find the card code printed at the bottom-left of the card.

The code line format is: [RegulationMark] [SetCode] [CardNumber]/[SetTotal] [RarityCode]
Examples: "H M2a 017/193 RR", "H SV2D 069/071 U", "F S12 077/098 RRR", "H SV-P 161/SV-P P"

Return ONLY a JSON object with these fields (no markdown, no explanation):
{"setCode": "M2a", "cardNumber": "017/193", "rarityCode": "RR"}

Rules:
- setCode: the expansion code (e.g. M2a, SV2D, S12, SM10a, SV-P, swsh3). NOT the regulation mark letter.
- cardNumber: the full number including slash (e.g. "017/193"). Keep leading zeros.
- rarityCode: the rarity abbreviation (e.g. RR, SR, SAR, U, C, RRR, AR, HR, P).
- If you cannot read any field, set it to null.
- Do NOT guess — only return what you can actually read from the card.`;
```

**Implementation**:

```javascript
async function recognizeCardWithGemini(imageBase64) {
  // 1. Read API key from storage
  const settings = await getGeminiSettings();
  if (!settings.geminiApiKey) {
    return { success: false, error: 'NO_API_KEY' };
  }

  // 2. Build request body
  const requestBody = {
    contents: [{
      parts: [
        { text: GEMINI_CARD_CODE_PROMPT },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageBase64   // raw base64 string, no data: prefix
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0,           // deterministic — we want exact text reading
      maxOutputTokens: 1024,     // card code JSON is very short
    }
  };

  // 3. Call Gemini API
  const url = `${GEMINI_API_URL}?key=${settings.geminiApiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return { success: false, error: `Gemini API error ${response.status}: ${errorBody}` };
  }

  // 4. Parse response
  const result = await response.json();
  const textOutput = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) {
    return { success: false, error: 'Gemini returned no text output' };
  }

  // 5. Extract JSON from response (Gemini may wrap it in ```json ... ``` markdown)
  const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { success: false, error: `Could not parse Gemini response as JSON: ${textOutput}` };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      data: {
        setCode: parsed.setCode || null,
        cardNumber: parsed.cardNumber || null,
        rarityCode: parsed.rarityCode || null,
      }
    };
  } catch (parseError) {
    return { success: false, error: `JSON parse error: ${parseError.message}` };
  }
}

// Helper: reads the geminiApiKey from chrome.storage.local
async function getGeminiSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return result[STORAGE_KEYS.SETTINGS] || {};
}
```

**Key design decisions**:
- `temperature: 0` — we want deterministic, exact text reading, not creative output.
- `maxOutputTokens: 1024` — the JSON response is ~50 tokens; this leaves plenty of margin but caps cost.
- The prompt explicitly says "no markdown, no explanation" and "ONLY a JSON object" to minimize parsing issues.
- The JSON extraction uses a regex `\{[\s\S]*\}` to handle cases where Gemini wraps the JSON in markdown code fences.
- The `NO_API_KEY` error string is a sentinel — the scanner page checks for this to fall back to OCR.

**Image preparation** (done in the scanner page before sending to service worker):

```javascript
// In scanner.js — convert canvas to base64 JPEG for Gemini
function canvasToBase64Jpeg(canvas, quality = 0.85) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}
```

The scanner sends the **full card image** (not the cropped bottom-left) to Gemini. Gemini can locate the code on its own — no cropping/preprocessing needed. JPEG quality 0.85 balances size (~100-200KB for a card photo) vs readability.

**Future optimization — 2-crop mode**: Instead of sending the full image (~1867 tokens), crop the top region (card name, ~133 tokens) and bottom-left region (card code, ~233 tokens) and send both in a single API call (~366 tokens total, ~5x fewer tokens). Saves ~200-500ms per scan. Not implemented yet because: (1) token cost is negligible with `gemini-flash-lite-latest`, (2) cropping risks missing context on different card layouts (JP vs EN), (3) accuracy is higher with the full image. Revisit if switching to a more expensive model or if token limits become an issue.

---

### `lib/ocr-engine.js` (FALLBACK — used when no Gemini API key)

**Purpose**: Wraps Tesseract.js. Called from `scanner/scanner.js` (runs in scanner tab, not service worker). Only used when the user has not configured a Gemini API key.

**Tesseract.js setup for Chrome extension** (must bundle locally, no CDN):

1. Install: `npm install tesseract.js` (or download from GitHub releases)
2. Copy these files into `vendor/tesseract/`:
   - `tesseract.min.js` (main library)
   - `worker.min.js` (web worker script)
   - `tesseract-core-simd.wasm.js` (WASM loader)
3. In `scanner.html`, load via `<script src="../vendor/tesseract/tesseract.min.js"></script>`
4. Configure worker paths to use extension-local files:

```javascript
async function createOcrWorker() {
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd.wasm.js'),
    langPath: chrome.runtime.getURL('vendor/tesseract/lang-data'),
    cacheMethod: 'none',
  });
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/- .',
    tessedit_pageseg_mode: '7',
  });
  return worker;
}
```

- `char_whitelist`: Only Latin + digits + `/` + `-` + space + `.` — prevents Japanese character false positives.
- `pageseg_mode: 7`: Treats image as a single text line (the card code is one line).

**OCR execution**:

```javascript
async function recognizeCardCode(worker, preprocessedCanvas) {
  const { data } = await worker.recognize(preprocessedCanvas);
  return data.text.trim();
}
```

---

### `utils/image-processor.js` (FALLBACK — used only with Tesseract OCR path)

**Purpose**: Crops and enhances the bottom-left region of a card image for OCR. All processing uses `<canvas>` API, no external libraries. **Not used in the Gemini Vision path** — Gemini receives the full card image and locates the code itself.

**Step-by-step processing**:

```javascript
function preprocessCardImage(sourceCanvas) {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  // Step 1: Crop bottom-left 60% width, bottom 12% height
  // This region contains: regulation mark, set code, card number, rarity
  const cropX = 0;
  const cropY = Math.floor(srcH * 0.88);
  const cropW = Math.floor(srcW * 0.6);
  const cropH = srcH - cropY;

  // Step 2: Create output canvas at 2x scale for better OCR
  const outW = cropW * 2;
  const outH = cropH * 2;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext('2d');

  // Draw cropped region scaled up
  ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  // Step 3: Grayscale conversion, 3x3 box blur (smooths holo/texture
  // speckle before thresholding), Otsu adaptive threshold (finds the
  // brightness cutoff that best separates this crop's own light/dark
  // pixels, rather than assuming a fixed value), then auto-invert if the
  // result comes out majority-black (i.e. the card prints light text on a
  // dark translucent bar instead of dark text on a light background —
  // common on holo/textured card art). See the real implementation in
  // utils/image-processor.js for computeOtsuThreshold()/boxBlur3x3().
  // A FIXED threshold (e.g. always 128) was tried first and failed badly
  // on cards with a dark background band under the code line — it turned
  // the crop into a near-solid black, speckled mess Tesseract read as
  // nothing. Otsu + auto-invert fixed this without needing to know in
  // advance which polarity a given card uses.
}
```

Notes:
- Crop region uses `CARD_CODE_CROP` from `utils/constants.js` (topFraction 0.94, widthFraction 0.35) — tuned to skip the illustrator credit line above the code and stop well before the black rule-text bar (e.g. "exルール") and/or dense holo-foil texture to its right. Assumes the source image is tightly cropped to the card face; large surrounding background/padding throws off these fixed percentages. A wider crop (0.45) was tried first and let in enough holo speckle to intermittently break OCR on textured cards even after denoising — 0.35 was the narrowest width that still reliably fit the longest real card codes (e.g. `SV4a 350/190 SAR`, `SV-P 161/SV-P P`) while excluding most of that noise.
- 3x upscaling improves Tesseract accuracy on small text.
- Denoising is a 5x5+ median filter (radius 3), not a box blur — a box blur left enough card-texture/holo speckle behind to still confuse Tesseract's line segmentation even when the text remained visually legible in the blurred image. Median filtering (replace each pixel with its neighborhood's median) suppresses that speckle far more effectively. Verified empirically: box blur failed on synthetic holo-noise test images, median radius=2 succeeded ~50% of the time, radius=3 succeeded ~90%.
- Threshold is computed per-image via Otsu's method, not a fixed constant — see the caveat above.

---

### `utils/card-code-parser.js`

**Purpose**: Parses raw OCR text into structured card data `{ setCode, localId, cardNumber, rarityCode }`.

**Input examples** (what Tesseract returns from the bottom-left region):

```
"H M2a 017/193 RR"
"H SV2D 069/071 U"
"F S12 077/098 RRR"
"H SV4a 350/190 SAR"
"Illus. 5ban Graphics H M2a 017/193 RR"
"H SV-P 161/SV-P P"
```

**Parser logic**:

```javascript
const CARD_NUMBER_REGEX = /(\d{2,3})\/(\d{2,3})/;
const RARITY_CODES = ['MUR', 'SAR', 'SSR', 'CSR', 'CHR', 'RRR', 'SR', 'RR', 'AR', 'HR', 'UR', 'TR', 'PR', 'R', 'U', 'C', 'N', 'P', 'K', 'A', 'S'];
const SET_CODE_REGEX = /\b([A-Z][A-Za-z0-9-]{1,5})\b/g;

function parseCardCode(ocrText) {
  // 1. Extract card number (most reliable anchor)
  const numberMatch = ocrText.match(CARD_NUMBER_REGEX);
  if (!numberMatch) return null;
  const localId = numberMatch[1];       // e.g. "017"
  const setTotal = numberMatch[2];       // e.g. "193"
  const cardNumber = `${localId}/${setTotal}`;

  // 2. Extract rarity (search from longest codes first to avoid partial matches)
  let rarityCode = null;
  // Look for rarity AFTER the card number in the string
  const afterNumber = ocrText.substring(ocrText.indexOf(cardNumber) + cardNumber.length);
  for (const code of RARITY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(afterNumber)) {
      rarityCode = code;
      break;
    }
  }

  // 3. Extract set code (appears BEFORE card number, AFTER regulation mark)
  // Get text between start and card number
  const beforeNumber = ocrText.substring(0, ocrText.indexOf(numberMatch[0]));
  // Find all potential set codes, take the last one (regulation mark is first)
  const setCandidates = [...beforeNumber.matchAll(SET_CODE_REGEX)]
    .map(m => m[1])
    .filter(s => s.length >= 2 && !/^[A-H]$/.test(s)); // exclude single-letter regulation marks
  const setCode = setCandidates.length > 0 ? setCandidates[setCandidates.length - 1] : null;

  return { setCode, localId, cardNumber, rarityCode };
}
```

**Common OCR error corrections** (apply before parsing):

```javascript
function correctOcrErrors(text, knownSetCodes) {
  let corrected = text;
  // Common OCR confusions
  corrected = corrected.replace(/\bl\b/g, '1');  // lowercase L → 1
  corrected = corrected.replace(/\bO(\d)/g, '0$1'); // O before digit → 0

  // Validate set code against known list
  if (knownSetCodes && knownSetCodes.length > 0) {
    // Try fuzzy match: if parsed setCode not in known list,
    // find closest match by edit distance
  }
  return corrected;
}
```

**Known set codes** are fetched once from `GET https://api.tcgdex.net/v2/ja/sets` and cached in `chrome.storage.local` for 24 hours. The set list response is an array of `{ id, name }` objects. We only need the `id` values for validation.

---

### ⚠️ IMPORTANT UPDATE: CardRush is behind Cloudflare — plain `fetch()` does not work

**Verified during implementation**: `cardrush-pokemon.jp` responds to any direct HTTP request (curl, or `fetch()` from a service worker) with a Cloudflare **JS challenge** page (`cf-mitigated: challenge`, title "Just a moment..."). A service worker's `fetch()` is a raw HTTP request — it cannot execute the challenge's JavaScript, so it will **always** receive the challenge page instead of real content, even with `host_permissions` granted (host_permissions only grants CORS access, it does not bypass Cloudflare).

**Fix**: Scraping must happen through a real browser **tab**, because only a real tab executes JavaScript and can pass the automatic JS challenge (no CAPTCHA interaction needed in most cases — it auto-resolves in ~3-5 seconds). The corrected flow:

```
1. Service worker opens a new background tab (active: false) at the CardRush search URL
2. Listen for chrome.tabs.onUpdated until status === "complete"
3. Inject a script via chrome.scripting.executeScript that checks document.title
   - If title is "Just a moment..." → Cloudflare challenge still resolving → wait 500ms, check again (poll up to ~8s)
   - Once title changes → real page has loaded → run the extraction function in that page's DOM
4. Extraction function uses real document.querySelectorAll (NOT regex) to read listings
5. chrome.tabs.remove() the background tab
6. Return parsed listings to the caller (popup/scanner)
```

This requires two manifest permissions: `"scripting"` (to inject the extraction function) and `"tabs"` (to create/wait-for/remove the hidden tab). `activeTab` is not needed since the extension never touches the user's currently active tab — it only opens/manipulates tabs of its own creation.

Updated `manifest.json` permissions:
```json
"permissions": ["storage", "tabs", "scripting"],
```

### `content-scripts/cardrush-extractor.js`

**Purpose**: Function injected into the real (challenge-passed) CardRush page via `chrome.scripting.executeScript`. Runs in the page's own DOM context, so `document.querySelectorAll` and `DOMParser` work normally (unlike in the service worker).

```javascript
// This function is passed to chrome.scripting.executeScript({ func: extractCardrushListings })
// It runs INSIDE the cardrush-pokemon.jp page, not in the extension.
function extractCardrushListings() {
  const listings = [];
  const productLinks = document.querySelectorAll('a[href*="/product/"]');

  const seen = new Set();
  for (const link of productLinks) {
    const href = link.getAttribute('href');
    const idMatch = href && href.match(/\/product\/(\d+)/);
    if (!idMatch || seen.has(idMatch[1])) continue;

    // The product name + price + stock live in the closest list-item wrapper
    const container = link.closest('li') || link.parentElement;
    const text = container ? container.textContent.replace(/\s+/g, ' ').trim() : '';

    const nameMatch = text.match(/(.+?)【([A-Za-z-]+)】\{(\d{2,3}\/[\w-]{2,6})\}\s*\[([^\]]+)\]/);
    if (!nameMatch) continue;
    seen.add(idMatch[1]);

    const priceMatch = text.match(/([\d,]+)円\(税込\)/);
    const stockMatch = text.match(/在庫数\s*(\d+)/);

    let condition = 'NM';
    if (text.includes('状態A-')) condition = 'A-';
    else if (text.includes('状態A')) condition = 'A';
    else if (text.includes('状態B')) condition = 'B';
    if (text.includes('PSA')) condition = 'PSA';

    listings.push({
      productName: nameMatch[1].replace(/^(〔[^〕]+〕|☆[^☆]+☆)+/g, '').trim(),
      rarity: nameMatch[2],
      cardNumber: nameMatch[3],
      setCode: nameMatch[4],
      price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null,
      stock: stockMatch ? parseInt(stockMatch[1], 10) : 0,
      condition,
      isOnSale: text.includes('SALE'),
      productUrl: `https://www.cardrush-pokemon.jp/product/${idMatch[1]}`,
    });
  }
  return listings;
}
```

**Service worker orchestration** (`background/service-worker.js`):

```javascript
async function scrapeCardrushViaTab(searchUrl) {
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });

  try {
    await waitForTabLoad(tab.id);
    await waitForCloudflareChallenge(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractCardrushListings, // defined in content-scripts/cardrush-extractor.js, loaded via importScripts
    });
    return result || [];
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForCloudflareChallenge(tabId, maxAttempts = 16, delayMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    const [{ result: title }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.title,
    });
    if (title !== 'Just a moment...') return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Give up waiting; extraction will just return an empty list and the
  // caller falls back to the "View on CardRush" link.
}
```

**Fallback**: If the challenge never resolves (rare — some IPs/regions may get an interactive Turnstile checkbox instead of the automatic JS challenge) or extraction returns zero listings, the caller falls back to showing the "View on CardRush" link with the same search URL so the user can check manually in their own browser (where they can solve any interactive challenge themselves).

**Performance note**: This approach takes ~2-6 seconds per lookup (tab creation + page load + challenge wait) instead of the <1s a plain `fetch()` would take. Show a "Fetching CardRush price... (this can take a few seconds)" loading state in the UI.

**Original regex-based approach (kept as reference / no longer primary)**:

**Purpose**: Fetches a CardRush search page and parses product listings from the HTML. Runs inside the service worker (has CORS access via `host_permissions`).

**Search URL construction**:

```javascript
function buildCardrushSearchUrl(cardNameJp, rarityCode, cardNumber) {
  // Format: カード名【レアリティ】{番号/総数}
  // Example: "オーガポンみどりのめんex【RR】{017/193}"
  const keyword = `${cardNameJp}【${rarityCode}】{${cardNumber}}`;
  return `https://www.cardrush-pokemon.jp/product-list?keyword=${encodeURIComponent(keyword)}`;
}
```

If exact search returns 0 results, fallback searches in order:
1. `{cardNumber}` only (e.g. `{017/193}`)
2. `cardNameJp` only (e.g. `オーガポンみどりのめんex`)

**Rarity mapping** (TCGdex rarity string → CardRush code used in `【】`):

```javascript
const TCGDEX_TO_CARDRUSH_RARITY = {
  'Common':            'C',
  'Uncommon':          'U',
  'Rare':              'R',
  'Double rare':       'RR',
  'Triple rare':       'RRR',
  'Illustration rare': 'AR',
  'Art Rare':          'AR',
  'Super Rare':        'SR',
  'Special Art Rare':  'SAR',
  'Hyper Rare':        'HR',
  'Ultra Rare':        'UR',
  'MEGA Ultra Rare':   'MUR',
  'Shiny rare':        'S',
  'Promo':             'P',
};
```

Note: If OCR already extracted a rarity code directly (e.g. `RR`), use that instead of mapping from TCGdex. The OCR code is what appears on the physical card and matches CardRush exactly.

**HTML parsing** (CardRush product list page structure):

The search results page contains product items. Each product is an `<a>` tag linking to `/product/{id}`. The product info (name, price, stock) is in the surrounding markup.

```javascript
async function parseCardrushResults(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const listings = [];

  // Each product listing is inside the product list area
  // Product links match: /product/{numeric_id}
  const productLinks = doc.querySelectorAll('a[href*="/product/"]');

  for (const link of productLinks) {
    const href = link.getAttribute('href');
    const productIdMatch = href.match(/\/product\/(\d+)/);
    if (!productIdMatch) continue;

    const container = link.closest('li') || link.parentElement;
    const fullText = container?.textContent || '';

    // Extract product name: "カード名【レアリティ】{番号/総数} [セットコード]"
    const nameMatch = fullText.match(/(.+?)【(.+?)】\{(\d+\/\d+)\}\s*\[(.+?)\]/);
    if (!nameMatch) continue;

    const productName = nameMatch[1].trim();
    const rarity = nameMatch[2];
    const cardNum = nameMatch[3];
    const setCode = nameMatch[4];

    // Extract price: "X,XXX円(税込)" or "XXX円(税込)"
    const priceMatch = fullText.match(/([\d,]+)円\(税込\)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    // Extract stock: "在庫数 X枚" or "在庫数 X個"
    const stockMatch = fullText.match(/在庫数\s*(\d+)/);
    const stock = stockMatch ? parseInt(stockMatch[1], 10) : 0;

    // Detect condition from name prefix
    let condition = 'NM'; // default: near mint (no prefix)
    if (productName.includes('〔状態A-〕')) condition = 'A-';
    else if (productName.includes('〔状態B〕')) condition = 'B';
    else if (productName.includes('〔PSA')) condition = 'PSA';

    // Detect SALE
    const isOnSale = fullText.includes('SALE');

    const productUrl = href.startsWith('http')
      ? href
      : `https://www.cardrush-pokemon.jp${href}`;

    listings.push({
      productName,
      rarity,
      cardNumber: cardNum,
      setCode,
      price,
      stock,
      condition,
      isOnSale,
      productUrl,
    });
  }

  return listings;
}
```

**Important**: `DOMParser` is NOT available in service workers. Use regex-based parsing instead:

```javascript
async function parseCardrushResultsRegex(html) {
  const listings = [];

  // Match product blocks: find all /product/{id} links and surrounding text
  // Pattern: href="/product/{id}" ... product name ... 円(税込) ... 在庫数
  const productPattern = /href="(\/product\/\d+)"[^>]*>[\s\S]*?<\/a>/g;

  // Simpler approach: split by product entries and extract with regex
  // Product name pattern in text: "名前【レア】{000/000} [SET]"
  const namePattern = /([^\n【]+)【([A-Z-]+)】\{(\d{2,3}\/\d{2,3})\}\s*\[([^\]]+)\]/g;
  const pricePattern = /([\d,]+)円\(税込\)/g;
  const stockPattern = /在庫数\s*(\d+)/g;

  let nameMatch;
  while ((nameMatch = namePattern.exec(html)) !== null) {
    const searchStart = nameMatch.index;
    const searchEnd = searchStart + 500; // look within 500 chars after name
    const surroundingText = html.substring(searchStart, searchEnd);

    const priceM = surroundingText.match(/([\d,]+)円\(税込\)/);
    const stockM = surroundingText.match(/在庫数\s*(\d+)/);
    const urlM = html.substring(Math.max(0, searchStart - 500), searchEnd)
                     .match(/href="(\/product\/\d+)"/);

    let condition = 'NM';
    const fullName = nameMatch[1].trim();
    if (fullName.includes('状態A-')) condition = 'A-';
    else if (fullName.includes('状態B')) condition = 'B';
    else if (fullName.includes('PSA')) condition = 'PSA';

    listings.push({
      productName: fullName,
      rarity: nameMatch[2],
      cardNumber: nameMatch[3],
      setCode: nameMatch[4],
      price: priceM ? parseInt(priceM[1].replace(/,/g, ''), 10) : null,
      stock: stockM ? parseInt(stockM[1], 10) : 0,
      condition,
      isOnSale: surroundingText.includes('SALE'),
      productUrl: urlM
        ? `https://www.cardrush-pokemon.jp${urlM[1]}`
        : null,
    });
  }

  return listings;
}
```

---

### `lib/tcgplayer-linker.js`

**Purpose**: Builds a TCGPlayer search URL for English cards.

```javascript
function buildTcgplayerUrl(cardNameEn) {
  return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(cardNameEn)}&productLineName=pokemon`;
}
```

For EN cards, we only open the link. No scraping needed.

---

### `utils/storage.js`

**Purpose**: Helpers for `chrome.storage.local` operations.

**Data schema in storage**:

```javascript
// Key: "scanHistory"
// Value: array of scan entries, max 50, newest first
[
  {
    cardId: "M2a-017",               // TCGdex card ID
    cardNameJp: "オーガポンみどりのめんex",
    cardNameEn: null,                 // null if JP-only lookup
    cardNumber: "017/193",
    setCode: "M2a",
    setName: "MEGAドリームex",
    rarityCode: "RR",
    language: "ja",                   // "ja" or "en"
    price: 180,                       // cheapest NM price in JPY (null if not found)
    imageUrl: "https://assets.tcgdex.net/ja/M/M2a/017",
    cardrushUrl: "https://www.cardrush-pokemon.jp/product/82801",
    timestamp: 1725811200000
  }
]

// Key: "settings"
{
  defaultLanguage: "ja",              // "ja" or "en"
  geminiApiKey: "AIzaSy...",          // Gemini API key (null/undefined = use OCR fallback)
}

// Key: "setListCache"
{
  updatedAt: 1725811200000,
  sets: [ { id: "M2a", name: "MEGAドリームex" }, ... ]
}
```

**Helper functions**:

```javascript
async function getScanHistory() {
  const result = await chrome.storage.local.get('scanHistory');
  return result.scanHistory || [];
}

async function addScanEntry(entry) {
  const history = await getScanHistory();
  history.unshift(entry);
  if (history.length > 50) history.length = 50;
  await chrome.storage.local.set({ scanHistory: history });
}

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return result.settings || { defaultLanguage: 'ja' };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function getCachedSets() {
  const result = await chrome.storage.local.get('setListCache');
  const cache = result.setListCache;
  if (!cache) return null;
  const isExpired = Date.now() - cache.updatedAt > 24 * 60 * 60 * 1000;
  if (isExpired) return null;
  return cache.sets;
}

async function cacheSets(sets) {
  await chrome.storage.local.set({
    setListCache: { updatedAt: Date.now(), sets }
  });
}
```

---

### `utils/constants.js`

```javascript
const TCGDEX_BASE_URL = 'https://api.tcgdex.net/v2';
const CARDRUSH_BASE_URL = 'https://www.cardrush-pokemon.jp';
const CARDRUSH_SEARCH_URL = `${CARDRUSH_BASE_URL}/product-list`;
const TCGPLAYER_SEARCH_URL = 'https://www.tcgplayer.com/search/pokemon/product';

// Gemini Vision API — used for card code recognition (primary path)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

const MESSAGE_TYPES = {
  RECOGNIZE_CARD_CODE: 'RECOGNIZE_CARD_CODE',   // Gemini Vision card code recognition
  FETCH_CARD_INFO: 'FETCH_CARD_INFO',
  FETCH_CARDRUSH_PRICE: 'FETCH_CARDRUSH_PRICE',
  FETCH_ALL_SETS: 'FETCH_ALL_SETS',
};

const TCGDEX_TO_CARDRUSH_RARITY = {
  'Common': 'C',
  'Uncommon': 'U',
  'Rare': 'R',
  'Double rare': 'RR',
  'Triple rare': 'RRR',
  'Illustration rare': 'AR',
  'Art Rare': 'AR',
  'Super Rare': 'SR',
  'Special Art Rare': 'SAR',
  'Hyper Rare': 'HR',
  'Ultra Rare': 'UR',
  'MEGA Ultra Rare': 'MUR',
  'Shiny rare': 'S',
  'Promo': 'P',
};
```

---

### `popup/popup.html`

**Layout**:

```
+------------------------------------------+
| [icon] Pokemon TCG Scanner     [⚙ gear]  |
+------------------------------------------+
| Search: [ M2a 017__________ ] [🔍]       |
|         or                                |
| [ Open Camera Scanner ]                   |
+------------------------------------------+
| (results area - hidden until search)      |
|                                           |
| [card img]  オーガポンみどりのめんex        |
|             M2a - 017/193 [RR]            |
|             MEGAドリームex                 |
|                                           |
|             CardRush: ¥180 (税込)          |
|             Stock: 16                     |
|             [View on CardRush]            |
+------------------------------------------+
| Recent Scans                              |
| ┌──────────────────────────────────────┐  |
| │ [img] オーガポンex  M2a-017  ¥180    │  |
| │ [img] ナンジャモ    SV2D-069  ¥80    │  |
| │ [img] ピカチュウex  M2a-044  ¥280    │  |
| └──────────────────────────────────────┘  |
+------------------------------------------+
```

**Popup behavior**:
- Width: 400px (standard Chrome extension popup width)
- Search input accepts: `M2a 017`, `M2a-017`, `017/193 M2a`, `SV2D 069`
- Parse input → send `FETCH_CARD_INFO` message to service worker → display result
- Then auto-send `FETCH_CARDRUSH_PRICE` → display price
- "Open Camera Scanner" button: `chrome.tabs.create({ url: chrome.runtime.getURL('scanner/scanner.html') })`
- Settings gear icon: `chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') })`
- Recent scans: loaded from `chrome.storage.local` on popup open

**Search input parsing** (in `popup.js`):

```javascript
function parseSearchInput(input) {
  const trimmed = input.trim();

  // Format: "M2a-017" or "M2a 017"
  const dashFormat = trimmed.match(/^([A-Za-z][A-Za-z0-9-]+)[- ](\d{2,3})$/);
  if (dashFormat) return { setCode: dashFormat[1], localId: dashFormat[2].padStart(3, '0') };

  // Format: "017/193 M2a" or "017/193"
  const numberFirst = trimmed.match(/^(\d{2,3})\/(\d{2,3})\s*([A-Za-z][A-Za-z0-9-]+)?$/);
  if (numberFirst) return { setCode: numberFirst[3] || null, localId: numberFirst[1] };

  return null;
}
```

---

### `scanner/scanner.html`

**Layout**:

```
+----------------------------------------------------+
| Pokemon TCG Card Scanner                            |
+----------------------------------------------------+
|                                                     |
|  +----------------------------------------------+  |
|  |                                              |  |
|  |          Camera Preview                      |  |
|  |          (or "Click to upload image")        |  |
|  |                                              |  |
|  |    +--------------------+                    |  |
|  |    | ← guide overlay →  |                    |  |
|  |    | "Position card     |                    |  |
|  |    |  bottom-left here" |                    |  |
|  |    +--------------------+                    |  |
|  |                                              |  |
|  +----------------------------------------------+  |
|                                                     |
|  [ 📷 Capture ]  [ 📁 Upload Image ]               |
|                                                     |
+----------------------------------------------------+
|  OCR Result:                                        |
|  Detected: "H M2a 017/193 RR"                      |
|  Set: [M2a    ▼]  Number: [017/193]  Rarity: [RR]  |
|  [ 🔍 Look Up Card ]                               |
+----------------------------------------------------+
|  (card result area - same layout as popup)          |
|  [card img]  オーガポンみどりのめんex                 |
|              M2a - 017/193 [RR]                     |
|              CardRush: ¥180 (税込)                   |
|              [View on CardRush]                      |
+----------------------------------------------------+
```

**Scanner behavior** (updated for Gemini Vision primary path):

1. On page load: request camera via `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
2. Show live preview in `<video>` element
3. "Capture" button: draw current video frame to hidden `<canvas>`
4. "Upload" button: open file picker (`accept="image/*"`), also support drag-drop and clipboard paste (`Ctrl+V`)
5. After capture/upload — **card code recognition flow**:

```
   canvas (full card image)
       │
       ├─ [Gemini path] Convert to base64 JPEG → send RECOGNIZE_CARD_CODE message to service worker
       │   → service worker calls Gemini API → returns { setCode, cardNumber, rarityCode }
       │   → populate editable fields
       │
       └─ [OCR fallback] If service worker returns error "NO_API_KEY":
           → preprocessCardImage(canvas) → recognizeCardCode(croppedCanvas) → parseCardCode(rawText)
           → populate editable fields
```

6. Show result in editable fields (user can correct regardless of which path was used)
7. "Look Up Card" button: send `FETCH_CARD_INFO` then `FETCH_CARDRUSH_PRICE` to service worker
8. Display card info + price in result area

**Key change in `processCapturedCanvas()`** (scanner.js):

```javascript
async function processCapturedCanvas(fullCanvas) {
  showStatus('Reading card code...');

  // Try Gemini Vision first (via service worker)
  const base64 = canvasToBase64Jpeg(fullCanvas);
  const geminiResult = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.RECOGNIZE_CARD_CODE,
    payload: { imageBase64: base64 },
  });

  if (geminiResult.success) {
    // Gemini returned structured data — populate fields directly
    el('setCodeInput').value = geminiResult.data.setCode || '';
    el('cardNumberInput').value = geminiResult.data.cardNumber || '';
    el('rarityInput').value = geminiResult.data.rarityCode || '';
    el('ocrRawText').textContent = JSON.stringify(geminiResult.data);
    hideStatus();
    el('ocrSection').classList.remove('hidden');
    return;
  }

  // Gemini failed or no API key — fall back to local OCR
  if (geminiResult.error !== 'NO_API_KEY') {
    console.warn('Gemini failed, falling back to OCR:', geminiResult.error);
  }

  // ... existing OCR pipeline (preprocessCardImage → recognizeCardCode → parseCardCode) ...
}
```

**Camera constraints**:

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: 'environment',  // prefer rear camera on mobile
    width: { ideal: 1280 },
    height: { ideal: 720 },
  }
});
```

---

### `settings/settings.html`

Settings page sections:

**1. Gemini API Key** (NEW — most important setting):
- Text input for the API key, type `password` (masked by default), with a show/hide toggle
- "Get a free API key" link → `https://aistudio.google.com/apikey`
- Help text: "Free tier: unlimited card scans. Your card images are sent to Google for recognition."
- "Test API Key" button: sends a simple text-only request to Gemini to verify the key works, shows success/error
- Key is saved to `chrome.storage.local` under `STORAGE_KEYS.SETTINGS` → `geminiApiKey`

**2. Scan History**:
- "Clear Scan History" button with confirmation

**3. About**:
- Extension version display
- Explains: "When a Gemini API key is configured, card photos are sent to Google's Gemini API for recognition. Without an API key, card codes are read locally with on-device OCR (Tesseract.js) — no images leave your device."
- Links to TCGdex, CardRush, TCGPlayer

---

## Communication Flow Diagram

```
┌─────────────┐      chrome.runtime.sendMessage       ┌──────────────────────────┐
│             │  ──────────────────────────────────►  │                          │
│   Scanner   │  { type: "RECOGNIZE_CARD_CODE",      │  Service Worker          │
│   (tab)     │    payload: { imageBase64 } }        │  (background)            │
│             │                                       │                          │
│             │  ◄──────────────────────────────────  │  → Gemini Vision API     │
│             │  { success, data: { setCode, ... } } │    (card code recognition)│
│             │                                       │  → fetch TCGdex          │
│   Popup     │  { type: "FETCH_CARD_INFO", ... }    │    (card metadata)       │
│   or        │  ──────────────────────────────────►  │  → scrape CardRush       │
│   Scanner   │                                       │    (JP pricing via tab)  │
│             │  ◄──────────────────────────────────  │                          │
│             │  { success: true, data: { card } }   │                          │
└─────────────┘                                       └──────────────────────────┘
       │                                                       │
       │ Uses directly (same-origin OK):                       │ Fetches (CORS OK via host_permissions):
       │ • Tesseract.js (local WASM, fallback only)            │ • generativelanguage.googleapis.com (Gemini)
       │ • Canvas API (image processing, fallback only)        │ • api.tcgdex.net
       │ • chrome.storage.local                                │ • www.cardrush-pokemon.jp (via browser tab)
       │                                                       │
```

Key rules:
- **Scanner sends the full card image to the service worker** for Gemini recognition. The service worker holds the API key and calls Gemini. This keeps the API key secure.
- **Popup and scanner pages NEVER fetch cardrush-pokemon.jp or Gemini API directly.** They always go through the service worker.
- **If no Gemini API key is configured**, the service worker returns `{ success: false, error: "NO_API_KEY" }` and the scanner page falls back to local OCR (Tesseract.js + image preprocessing). No network call is made for recognition in this case.

---

## Implementation Order

Steps 1-10 are **already implemented** from the initial OCR-based build. Step 11 adds Gemini Vision as the primary card code recognition method.

### Steps 1-10: Already Complete (OCR-based build)

1. Minimal extension skeleton (manifest, popup, service worker)
2. TCGdex integration (card lookup by set code + local ID)
3. CardRush price scraping (tab-based, Cloudflare bypass)
4. Scanner page with image upload + OCR pipeline
5. Camera scanning
6. Scan history
7. English card support
8. Settings page
9. Polish & error handling
10. Set list validation/caching for OCR correction

### Step 11: Gemini Vision Integration ← CURRENT

This step adds Gemini Vision API as the primary card recognition method, keeping Tesseract OCR as a fallback.

**Files to create:**
- `lib/gemini-vision.js` — Gemini API wrapper (see `lib/gemini-vision.js` section above for exact implementation)

**Files to modify:**

1. **`utils/constants.js`**:
   - Add `GEMINI_API_URL` constant
   - Add `RECOGNIZE_CARD_CODE` to `MESSAGE_TYPES`

2. **`manifest.json`**:
   - Add `"https://generativelanguage.googleapis.com/*"` to `host_permissions`

3. **`background/service-worker.js`**:
   - Add `importScripts('../lib/gemini-vision.js')`
   - Add `RECOGNIZE_CARD_CODE` case to the `handleMessage` switch — calls `recognizeCardWithGemini(payload.imageBase64)`

4. **`scanner/scanner.js`**:
   - Add helper `canvasToBase64Jpeg(canvas)` — converts canvas to base64 JPEG string (no `data:` prefix)
   - Modify `processCapturedCanvas()`:
     - First, send `RECOGNIZE_CARD_CODE` message to service worker with the full image as base64
     - If success: populate setCode/cardNumber/rarity fields directly from the Gemini response
     - If error is `"NO_API_KEY"`: fall through to existing OCR pipeline (no change to OCR code)
     - If error is anything else (API failure): log warning, fall through to OCR pipeline
   - Show "Reading card code (AI)..." status when using Gemini, "Reading card code (OCR)..." for fallback

5. **`settings/settings.html` + `settings/settings.js`**:
   - Add "Gemini API Key" section at the top of settings:
     - Password input for the API key + show/hide toggle button
     - "Get a free API key" link → `https://aistudio.google.com/apikey`
     - Help text explaining free tier and privacy
     - Save button that stores key to `chrome.storage.local` → `settings.geminiApiKey`
   - Update About section to explain the dual recognition approach

6. **`utils/storage.js`**:
   - Add `geminiApiKey` field to the settings schema documentation (the actual read/write already uses the generic `getSettings`/`saveSettings` — no code change needed, just schema awareness)

**Verify step 11:**
1. Without API key: upload a card photo → falls back to OCR (same behavior as before)
2. Go to Settings → paste a Gemini API key → save
3. Upload a card photo → status shows "Reading card code (AI)..." → fields are populated correctly
4. Try a holo/foil card that previously failed OCR → Gemini should detect the code successfully
5. Enter an invalid API key → Gemini returns error → falls back to OCR gracefully

---

## Known Card Code Formats

The parser (and Gemini prompt) must handle all these bottom-left text formats:

| Era                     | Example text                  | setCode | localId | cardNumber | rarity |
| ----------------------- | ----------------------------- | ------- | ------- | ---------- | ------ |
| SV current              | `H SV2D 069/071 U`           | SV2D    | 069     | 069/071    | U      |
| SV secret rare          | `H SV4a 350/190 SAR`         | SV4a    | 350     | 350/190    | SAR    |
| MEGA series             | `H M2a 017/193 RR`           | M2a     | 017     | 017/193    | RR     |
| Sword & Shield JP       | `F S12 077/098 RRR`          | S12     | 077     | 077/098    | RRR    |
| Sun & Moon JP           | `C SM10a 009/054 C`          | SM10a   | 009     | 009/054    | C      |
| XY series               | `- XY 001/060 C`             | XY      | 001     | 001/060    | C      |
| Promo (has dash in set) | `H SV-P 161/SV-P P`          | SV-P    | 161     | 161/SV-P   | P      |
| English SV              | `H sv4 201/198 SAR`          | sv4     | 201     | 201/198    | SAR    |
| English SwSh            | `D swsh3 136/189 U`          | swsh3   | 136     | 136/189    | U      |

Special case: **Promo cards** have a non-numeric set total (e.g. `161/SV-P`). The parser should extract localId from the first part of the number and treat the set total as a string.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Gemini API key not configured | Cannot use primary recognition | Fall back to local OCR automatically; show "Set up API key in Settings for better accuracy" hint |
| Gemini API rate limit (free tier) | Recognition temporarily unavailable | Fall back to OCR; show "Rate limited, using offline OCR" message |
| Gemini API key leaked | Unauthorized usage | Key stored in `chrome.storage.local` (not in source); never sent to any domain except `generativelanguage.googleapis.com` |
| Gemini returns wrong card code | Wrong card lookup | Fields are always editable; user can correct before lookup |
| Gemini API response format changes | JSON parsing fails | Regex-based JSON extraction handles markdown-wrapped responses; error falls back to OCR |
| Privacy: card images sent to Google | User concern | Clearly documented in Settings page; OCR fallback available for privacy-conscious users |
| OCR misreads on holo/foil cards (fallback) | Card not found | Preprocessing (threshold, contrast); show editable fields for user correction |
| OCR misreads set code (fallback) | Wrong card or 404 | Validate against cached TCGdex set list; fuzzy match to closest known set |
| CardRush HTML structure changes | Price scraping breaks | Scraper isolated in one file; fallback to "View on CardRush" link always works |
| Camera not accessible in popup | Cannot scan from popup | Scanner is in dedicated tab; popup only does manual search |
| TCGdex missing some JP cards | Card not found | Fallback: search CardRush with just card number `{017/193}` |
| CardRush rate limiting / blocking | Scraping fails | Cache prices for 1 hour; limit to 1 request per 2 seconds; fallback to link |
