# Pokemon TCG Card Scanner

A Chrome and Safari extension that identifies Japanese and English Pokémon TCG cards from images, retrieves metadata from TCGdex, and compares prices from CardRush, PriceCharting, Collectr, and TCGPlayer.

For complete technical documentation, see [`docs/APP_DOCUMENTATION.md`](docs/APP_DOCUMENTATION.md).

## Features

- Identifies Japanese and English cards with Gemini Vision.
- Uses local Tesseract.js OCR when no Gemini API key is configured.
- Supports image upload, drag and drop, clipboard paste, and current-tab snapshots.
- Lets users select the card area within a snapshot.
- Allows users to edit detected fields before lookup.
- Supports manual search by card name, set code, card number, and language.
- Retrieves locale-specific metadata and images from TCGdex.
- Finds a card's counterpart in the other language from a bundled Bulbapedia index (about 21,400 reviewed
  printings across eight eras), and marks each counterpart **Verified** when it comes from that index or
  **Unverified** when it comes from a TCGdex search.
- Compares prices from four marketplaces.
- Converts JPY and USD prices to VND.
- Displays one primary result and up to four alternatives for each marketplace.
- Opens a larger image when a thumbnail is clicked and opens the product detail page when a result is clicked.
- Stores up to 10 recent scans; each history entry opens its product page or re-runs the lookup.
- Displays lookup progress for each data source.
- Starts the lookup as soon as the detected fields are filled (can be turned off in Settings → Scanning).
- Runs the lookup with **Enter** from anywhere on the scanner page (no field is focused for you, so the accent focus ring never lands on a field the AI just filled), and closes the snapshot overlay with **Esc**.

## Data Sources

| Source | Data |
|---|---|
| Gemini Vision | Card name, set, number, rarity, language, promo status, and counterpart hints |
| TCGdex | Metadata, images, sets, rarity, dexId, HP, and fallback pricing |
| CardRush | Japanese card listings and JPY prices |
| PriceCharting | Ungraded, graded, and recent-sale prices in USD |
| Collectr | Product listings and USD prices |
| TCGPlayer | Listings, Market Price, Most Recent Sale, and printing prices in USD |
| open.er-api.com | JPY, USD, and VND exchange rates |

## Installation

### Use a prebuilt release (no Node.js, no Xcode)

Download the latest zip from
[Releases](https://github.com/dthanhthai/scan-tcg-card-extension/releases/latest). Each release is built
from the tagged source, so nothing has to be compiled locally:

- **`pokemon-tcg-scanner-extension-<version>.zip`** — the unpacked extension. Unzip it, then load the
  resulting folder in **Chrome** (`chrome://extensions` → **Load unpacked**) or in **Safari**
  (**Develop** → **Add Temporary Extension**, with **Allow Unsigned Extensions** enabled). One folder
  works in both browsers, because the build output is identical for the two.
- **`PokemonTcgScanner-<version>.app.zip`** — the packaged macOS app, for Safari without Xcode. Unzip it,
  move the app to `/Applications`, and clear the quarantine flag first, because the app is ad-hoc signed:
  ```bash
  xattr -cr /Applications/PokemonTcgScanner.app
  ```

Either way, open Settings in the extension and enter a Gemini API key to enable Gemini Vision.

### Chrome (Developer Mode)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Select **Load unpacked**.
4. Select the project root directory, or a clean package built with:
   ```bash
   npm run build:chrome   # writes build/chrome (runtime files only)
   ```
   The project root works for development; `build/chrome` is smaller because it leaves out tests, docs, scripts,
   the Safari project, and the development-only Bulbapedia reports under `data/`.
5. Pin the extension to the toolbar if needed.
6. Open Settings and enter a Gemini API key to enable Gemini Vision.

If no Gemini API key is configured, the scanner automatically falls back to local Tesseract OCR.

### Safari (macOS 15+ / Safari 26+)

Safari requires an Xcode project wrapper. The project lives in `safari/` and shares the same extension source.

#### Build

```bash
./safari/build-safari.sh
```

This script:
1. Syncs extension source from the repo root into `safari/.../Resources/` (excludes `node_modules`, `tests`, `docs`, etc.).
2. Builds the macOS `.app` via `xcodebuild` with ad-hoc signing.
3. Writes two outputs: `build/safari/PokemonTcgScanner.app` and an unpacked `build/safari/extension/` folder.

Requirements: Xcode installed, macOS 15+ (Tahoe / Safari 26+).

#### Add as a temporary extension (fastest for testing)

Safari → **Develop** → **Add Temporary Extension**, then select the folder:

```text
build/safari/extension
```

Select the extension folder itself (the one holding `manifest.json`) — the picker does not accept the `.app`.
This needs **Develop → Allow Unsigned Extensions** to be enabled.

#### Install the packaged app

1. Open the built app:
   ```bash
   open build/safari/PokemonTcgScanner.app
   ```
2. The app window shows "extension is currently off" — click **Quit and Open Safari Settings**.
3. In Safari Settings → **Extensions** tab → enable **PokemonTcgScanner**.
4. If the extension does not appear, enable **Develop → Allow Unsigned Extensions** first (ad-hoc signing is not Apple-trusted).

#### Distribute to friends (ad-hoc, no Apple Developer account)

1. Copy the `.app` to the friend's Mac:
   ```bash
   cp -R build/safari/PokemonTcgScanner.app ~/Desktop/
   ```
2. Friend copies `PokemonTcgScanner.app` into `/Applications`.
3. Friend removes the quarantine attribute (one-time):
   ```bash
   xattr -cr /Applications/PokemonTcgScanner.app
   ```
4. Friend double-clicks the app and confirms **Open** at the Gatekeeper prompt.
5. Friend enables the extension in Safari → Settings → Extensions.

#### Reload after code changes

```bash
./safari/build-safari.sh
```

Then quit the old app, open the new `.app`, and re-enable the extension in Safari if needed.

#### Safari limitations

- `commands` (keyboard shortcuts) may not be supported depending on Safari version. If `Command+Shift+S` does not trigger a snapshot, use the **Snapshot** button in the popup.
- Cloudflare-protected marketplaces (CardRush, PriceCharting) may behave differently in Safari; manual verification may be needed.
- **Safari prompts for permission each time the extension opens a marketplace tab** (CardRush, PriceCharting, Collectr, TCGPlayer). The user must click **Allow** for each domain the first time. Chrome grants access automatically via `host_permissions` at install time; Safari may not honor this the same way.

## Usage

### Scan an Image

1. Open the extension.
2. Select **Upload Image**, or open the scanner and drag, drop, or paste an image.
3. Review the detected fields:
   - Card Name.
   - Set Code.
   - Set Name.
   - Card Number.
   - Rarity.
   - Language.
   - Promo (a checkbox, ticked when Gemini reports a promo).
4. Correct any field if needed.
5. The lookup starts by itself once the fields are filled (Settings → **Scanning** turns that off); you can also
   press **Enter** in any field or select **Look Up Card**.

For best results, ensure that the card number, set code, rarity, and any `PROMO` logo in the bottom-left area are clearly visible.

### Snapshot the Current Tab

Use either method:

- Select the snapshot action in the popup.
- Use the keyboard shortcut:
  - Windows/Linux: `Ctrl+Shift+S`.
  - macOS: `Command+Shift+S`.

After capturing the tab, drag to select the card area before recognition starts.

### Manual Search

Supported formats include:

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

Append `JP`, `JA`, or `EN` to specify a language.

The popup parser currently accepts alphanumeric set-code tokens. For a set code containing a hyphen, such as `SV-P`, scan an image and edit the fields directly in the scanner if the popup parser does not accept it.

## Marketplace Search Logic

For diagrams of the whole flow (query construction, index resolution, listing selection, cross-version sections),
see [`docs/SEARCH_LOGIC.md`](docs/SEARCH_LOGIC.md).

### Card Number Normalization

```text
cardLocalId = the portion before `/`
```

Examples:

- `027/182` → `027`.
- `074/SV-P` → `074`.
- `074` → `074`.

### Normal Cards

Collectr and TCGPlayer use the full card number to reduce ambiguity between sets:

```text
{English card name} {number}/{setTotal}
```

Examples:

```text
Armarouge ex 027/182
Roaring Moon ex 054/066
```

PriceCharting adds a set token, because it searches a card name across every set and would otherwise return other
printings first (a `Beedrill 5/146` search ranked the correct XY printing tenth):

```text
{English card name} {number}/{setTotal} {set token}
```

The set token is the set name from the reviewed index when the card is indexed, otherwise the name Gemini read,
otherwise the printed set code for English scans. A Japanese set name is never used, because PriceCharting labels
sets in English. The scraper then ranks the returned rows by card name, then printed number, then set label.

For a Japanese card, Collectr and TCGPlayer search the **English counterpart's** name and number: from the index
when it has a record, otherwise from the TCGdex card resolved for that scan. Without either, the scanned number is
used. The listing is then picked with the same number the query used, and zero padding is ignored when comparing.

### Promo Cards

Gemini sets `isPromo` using promo set codes and indicators such as a `PROMO` logo near the card number and rarity.

PriceCharting, Collectr, and TCGPlayer use only the local number:

```text
{English card name} {localId}
```

Example:

```text
Pikachu 074
```

This prevents suffixes such as `/SV-P` from reducing marketplace search accuracy.

### CardRush

CardRush always uses a separate rule:

```text
{resolved set code} {localId}
```

Examples:

```text
SV4K 054
SV-P 074
```

CardRush is queried only for Japanese cards. It is skipped for English cards.

A deck printing carries no printed set code (the BREAK Starter Pack and the Sun & Moon Starter Set). Those are
queried by the Japanese card name instead, because the placeholder code returns unrelated listings:

```text
MフシギバナEX 002
```

### Search Summary

| Card type | CardRush | PriceCharting | Collectr | TCGPlayer |
|---|---|---|---|---|
| Normal EN `Armarouge ex 027/182` | Skipped | Full number + set token | Full number | Full number |
| Normal JP `Roaring Moon ex 054/066` | `SV4K 054` | Full number + set token | Full number | Full number |
| Promo JP `Pikachu 074/SV-P` | `SV-P 074` | `Pikachu 074` | `Pikachu 074` | `Pikachu 074` |
| Deck JP `MフシギバナEX 002/072` | `MフシギバナEX 002` | `M Venusaur-EX 002/072` | `M Venusaur-EX 002/072` | `M Venusaur-EX 002/072` |
| JP card with an indexed counterpart | `S12a 041` | Source number | Counterpart `054/159` | Counterpart `054/159` |
| JP card without an index record | `S99 054` | Source number | Resolved EN card `54/159` | Resolved EN card `54/159` |

See [Application Documentation](docs/APP_DOCUMENTATION.md#7-marketplace-search-query-logic) for complete lookup, fallback, and cross-language rules.

## Primary Results and Alternatives

Each marketplace block contains:

- One primary result.
- Up to four unique alternative results.
- Up to five results in total, including the primary result.

The primary result is removed from **Other results** by matching its `productUrl`, so it is not displayed twice.

Current primary-selection behavior:

| Marketplace | Primary selection |
|---|---|
| CardRush | Prefers a result matching the local card number |
| PriceCharting | Uses the first result |
| Collectr | Prefers a result matching the local card number |
| TCGPlayer | Prefers a result matching the local card number |

This remains heuristic matching. When a search returns similar printings, users should verify the thumbnail, product name, set, and card number in the alternatives.

## Cross-Language Cards

The extension can find:

- A Japanese counterpart for an English card.
- An English counterpart for a Japanese card.

The primary source is a reviewed **Bulbapedia counterpart index** bundled with the extension (about 20,300
printings across eight eras: DP, BW, HGSS, XY, SM, SWSH, SV, M). It resolves the exact printing, so the counterpart is
marked **Verified**. When the index has no record, the extension falls back to a TCGdex search and marks the result
**Unverified**.

The index resolves by set code, set name, and card number, with fallbacks for aliases and misread codes. A miss
while only part of the index is loaded reloads every era and retries once.

The TCGdex fallback matching uses:

1. Gemini counterpart set and card hints (matched by same artwork).
2. Direct TCGdex lookup.
3. Card name.
4. Set code and local ID.
5. JP-to-EN set mapping (explicit map + auto-derive pattern for Scarlet and Violet sets).
6. National dex ID.
7. Rarity, using `TCGDEX_TO_CARDRUSH_RARITY` to map JP and EN rarities to a shared short code.
8. HP, to prevent a normal Pokémon from being matched to an `ex`, `V`, `VMAX`, or other variant.

Cross-language cards have a separate price-lookup button. A cross-language lookup does not search for another counterpart, which prevents recursion.

## Marketplace Scraping

The marketplaces render content with JavaScript or use Cloudflare, so the extension opens a temporary browser tab or window and injects a DOM extractor:

- **CardRush:** uses a real browser tab to run the Cloudflare JavaScript challenge. Supports both Japanese and English page rendering (price, stock, condition, and product-name formats).
- **PriceCharting:** uses a minimized window, triggers lazy image loading, and enriches the best-ranked result (by card name, printed number, then set label) from its detail page.
- **Collectr:** waits for its Next.js SPA to render product cards.
- **TCGPlayer:** waits for its React SPA and detail price points to render.

If Cloudflare requires manual verification, the extension may show a window so the user can complete the checkbox.

### Safari build

The Safari port lives in `safari/` and shares the same extension source. Build with:

```bash
./safari/build-safari.sh
```

The script syncs the root extension source into `safari/.../Resources/`, builds the macOS `.app` via `xcodebuild`, and writes `build/safari/PokemonTcgScanner.app` plus an unpacked `build/safari/extension/` folder. See [Installation](#installation) for details.

## Prices and Currencies

- CardRush prices are in JPY.
- PriceCharting, Collectr, and TCGPlayer prices are in USD.
- Exchange rates come from `open.er-api.com` and are cached for six hours.
- The UI displays the original price and a VND conversion when exchange rates are available.

## Settings and Storage

Settings support:

- Saving, testing, showing, hiding, and clearing the Gemini API key.
- Selecting image quality.
- Turning the automatic lookup after a scan on or off (Settings → **Scanning**; on by default).
- Clearing scan history.
- Clearing TCGdex caches.
- Opening Chrome's extension shortcut settings.

The extension uses `chrome.storage.local` for:

- Up to 10 recent scans.
- Settings and the Gemini API key.
- TCGdex set and abbreviation caches.
- The exchange-rate cache.
- Temporary upload and manual-search data. A snapshot is written to `chrome.storage.session` when available
  (in memory, no disk write) and falls back to `local`.

## Privacy

- Tesseract OCR processes images entirely on the local device.
- When Gemini Vision is enabled, a JPEG base64 image is sent to the Google Gemini API for recognition.
- The Gemini API key is stored in local extension storage.
- Marketplace lookup opens marketplace pages in a browser context and extracts publicly rendered DOM data.

## Architecture

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
        +-- CardRush / PriceCharting / Collectr / TCGPlayer scrapers
```

Important files:

| File | Responsibility |
|---|---|
| `utils/card-lookup.js` | Lookup orchestration, query construction, result selection, and rendering |
| `lib/gemini-vision.js` | Gemini prompt and structured recognition |
| `lib/tcgdex-client.js` | Card lookup, set mapping, and cross-language matching |
| `lib/bulbapedia-index.js` | Loads and merges the per-era counterpart index (lazy, per era) |
| `lib/bulbapedia-resolver.js` | Pure counterpart resolution against the index |
| `data/bulbapedia/<era>/counterpart-index.js` | Bundled per-era index the runtime reads |
| `lib/*-scraper.js` | Browser-tab marketplace scraping |
| `content-scripts/*-extractor.js` | DOM extraction in marketplace page contexts |
| `utils/storage.js` | History, settings, and caches |
| `assets/shared.css` | Shared UI, marketplace, cross-language, and overlay styles |

## Development and Verification

```bash
node --check path/to/file.js     # syntax check one file
npm test                         # Vitest suite
npm run build:chrome             # write build/chrome
./safari/build-safari.sh         # write build/safari (app + extension folder)
```

The Bulbapedia index has its own pipeline (crawl → generate → review → bundle). See
[`docs/BULBAPEDIA_INTEGRATION_PLAN.md`](docs/BULBAPEDIA_INTEGRATION_PLAN.md) and `AGENTS.md` for the commands,
the review gate, and the per-era `exclusions.json` mechanism.

Minimum test checklist:

1. Reload the unpacked extension (and rebuild/reopen the Safari app).
2. Scan a normal card.
3. Scan a promo card.
4. Run a cross-language lookup and check the **Verified** / **Unverified** badge.
5. Check the generated queries in the console.
6. Confirm that the primary result is not repeated in alternatives.
7. Test thumbnail overlays and marketplace detail links.
8. Confirm that lookup buttons are re-enabled after completion.

For implementation details, limitations, and the full test matrix, see [`docs/APP_DOCUMENTATION.md`](docs/APP_DOCUMENTATION.md).

## Credits and Licenses

| Component | License |
|---|---|
| Extension source code | [MIT](LICENSE) |
| Bulbapedia counterpart index (`data/bulbapedia/`) | [CC BY-NC-SA 2.5](https://creativecommons.org/licenses/by-nc-sa/2.5/) |
| TCGdex metadata and images | [MIT](https://github.com/tcgdex/javascript-sdk/blob/master/LICENSE.md) |
| tesseract.js (`vendor/tesseract/`) | [Apache-2.0](vendor/tesseract/CORE_LICENSE) |

### Attribution

- Card metadata, sets, and images come from the [TCGdex API](https://tcgdex.dev) (MIT).
- The Japanese/English counterpart index is derived from [Bulbapedia](https://bulbapedia.bulbagarden.net)
  content, licensed **CC BY-NC-SA 2.5**. Each index record stores the Bulbapedia page title, page ID, and
  revision ID it was derived from.
- Local OCR uses [tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0).
- Marketplace names and logos (CardRush, PriceCharting, Collectr, TCGPlayer) are trademarks of their
  respective owners and are used only to link to their listings.
- Pokémon and Pokémon TCG are trademarks of Nintendo, Creatures Inc., and GAME FREAK inc. This project is
  not affiliated with, endorsed by, or sponsored by them.

### Non-commercial note

The MIT license covers the source code only. Because the bundled counterpart index is CC BY-NC-SA 2.5,
**the extension as shipped may not be used commercially**, and any redistributed derivative of the index
must keep the same license. Removing `data/bulbapedia/` (or replacing it with data you own) leaves the
code fully MIT.
