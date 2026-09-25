# Search Logic — Visual Reference

How a scan becomes four marketplace queries and one picked listing. The normative rules live in
[`APP_DOCUMENTATION.md` §7](APP_DOCUMENTATION.md#7-marketplace-search-query-logic) and §12; this file is the map.

Diagrams are Mermaid (they render on GitHub). Each one also has an ASCII version, so the file stays readable in a
plain editor.

---

## 1. End-to-end flow

```mermaid
flowchart TD
    A[Scan or manual search] --> B[Gemini Vision, else Tesseract OCR]
    B --> C[Fields filled in the scanner]
    C --> D["ensureBulbapediaIndexes: load only the era the set belongs to"]
    D --> E[Resolve against the Bulbapedia index]
    E -->|hit| F[Counterpart + Verified badge]
    E -->|miss while index is narrowed| G[Load every era, resolve once more]
    G -->|hit| F
    G -->|miss| H[No index counterpart]
    E -->|miss| H
    D --> I[Fire marketplaces and the TCGdex fetch in parallel]
    H --> I
    F --> I
    I --> J{English name resolved?}
    J -->|Japanese name, no index counterpart, TCGdex found the card| K[Resolve the English counterpart first, then fire EN queries]
    J -->|otherwise| L[EN queries fire with the known name]
    K --> M[Wait for all sources]
    L --> M
    M --> N[Pick one listing per marketplace]
    N --> O["Render result, EN/JP sections, badge"]
```

```text
scan/manual ─► Gemini|Tesseract ─► fields ─► ensureBulbapediaIndexes(era) ─► resolve
                                                     │ hit ─► counterpart (Verified)
                                                     │ miss ─► load all eras, retry once ─► miss = no counterpart
                                                     ▼
        fire in parallel: CardRush(JP only) + PriceCharting + Collectr + TCGPlayer + TCGdex fetch
                                                     │
                        Japanese name with no index counterpart? ─► resolve EN card first (C5)
                                                     ▼
                     wait for all ─► pick listing per marketplace ─► render (+ badge)
```

Two properties worth remembering:

- The marketplaces are the slow part, so they normally start together with the TCGdex fetch (§6.4 of the application
  documentation) and its result only refines later steps. The exception is the C5 path: when the name was read in
  Japanese and the index has no counterpart, the three EN queries wait until the English printing is resolved,
  because they must not be searched with a Japanese name.
- The index is the only source that can mark a counterpart **Verified**; a TCGdex search result is **Unverified**.

---

## 2. Which query each marketplace gets

```mermaid
flowchart LR
    S[Card + counterpart] --> CR{Japanese card?}
    CR -->|yes, printed set code| CR1["CardRush: setCode localId"]
    CR -->|yes, deck printing| CR2["CardRush: Japanese name localId"]
    CR -->|no| CR3["CardRush: skipped"]
    S --> PC["PriceCharting: name + scanned number + set token"]
    S --> EN{English counterpart known?}
    EN -->|index target or resolved TCGdex card| EN1["Collectr / TCGPlayer: counterpart name + counterpart number"]
    EN -->|no| EN2["Collectr / TCGPlayer: scanned name + scanned number"]
```

| Case | CardRush | PriceCharting | Collectr / TCGPlayer |
|---|---|---|---|
| Normal EN card | skipped | `{EN name} {number}/{total} {set token}` | `{EN name} {number}/{total}` |
| Normal JP card | `{set code} {localId}` | `{EN name} {JP number}/{total} {set token}` | counterpart name + number |
| Promo | `{set code} {localId}` | `{EN name} {localId}` | `{EN name} {localId}` |
| Deck printing (no printed code) | `{Japanese name} {localId}` | `{EN name} {number}/{total}` | same as normal |
| JP card, no counterpart found | `{set code} {localId}` | `{EN name} {JP number}/{total} {set token}` | scanned name + scanned number |

Set token for PriceCharting (`pickPricechartingSetToken`), first match wins:

```mermaid
flowchart TD
    T1[Set name from the index EN source] -->|present and not Japanese script| USE[Use it]
    T1 -->|absent| T2[Set name Gemini read]
    T2 -->|present and not Japanese script| USE
    T2 -->|absent| T3{EN scan?}
    T3 -->|yes| T4[Printed set code]
    T3 -->|no| T5[No set token]
```

---

## 3. Index resolution

```mermaid
flowchart TD
    Q[setCode, setName, cardNumber, names] --> A["Group by language:setCode:localId"]
    A --> B{Exact card number match?}
    B -->|yes| C{How many candidates?}
    B -->|no| D{Set name match on set + localId?}
    D -->|yes| C
    D -->|no| E{Full number + card name match?}
    E -->|yes| C
    E -->|no| F{Group has exactly one record?}
    F -->|yes| C
    F -->|no| MISS["miss: no counterpart"]
    C -->|one| HIT["hit: one record, one target"]
    C -->|several| AMB["ambiguous or multi-target: nothing is shown, never pick silently"]
    HIT --> R[Verified counterpart]
```

The last question is the tolerance for a wrong printed total: it only applies when a single record is left, so it can
never override a better match.

Why the total exists at all: paired Japanese products reuse the same printed code and number (`BW1` is both White
Collection `001/053` and Black Collection `001/055`), so the total separates them. It is only skipped when a single
record is left, which is how a Bulbapedia row with a wrong total stays reachable.

A card printed with an abbreviation the index does not store still resolves: the group index also holds each
record's source-side TCGdex set id, and the caller passes the printed code resolved through the abbreviation table
in `utils/constants.js` as an alias, so `JTG` finds the record stored as `SV09`. A manual search with no language
hint is treated as English when the set code is a known EN abbreviation.

---

## 4. Picking the listing

```mermaid
flowchart TD
    L[Search rows] --> P1["CardRush, Collectr, TCGPlayer: pickListingByLocalId"]
    P1 --> P2{Parsed cardNumber matches?}
    P2 -->|yes| PICK[That row]
    P2 -->|no, padding differs| P3["Numeric compare: 074 equals 74"]
    P3 --> PICK
    P2 -->|no| P4{"Text pattern: #id, space id, -id, /id?"}
    P4 -->|yes| PICK
    P4 -->|no| P6{Card name matches?}
    P6 -->|yes| PICK
    P6 -->|no| P5[First row]
    L --> R1["PriceCharting: rankPricechartingListings"]
    R1 --> R2[Card name 4 points, printed number 2, set label 1]
    R2 --> R3[Highest score first, original order on ties]
```

The name step is what keeps a sold-out card honest. CardRush's search is fuzzy: `S8b 110` returned 23 different
numbers with `204/184` first, so a number-only match would show another card's price whenever the wanted printing
is gone. The name passed in is the one the query used — the Japanese name for CardRush, the counterpart's English
name for Collectr and TCGPlayer — and it is compared after normalization (NFKC, lowercase, no trailing
`EX`/`GX`/`VMAX`/`VSTAR`, no spaces), accepting an exact match or a containment match of at least four characters.

The row that wins is also the row PriceCharting enriches from its detail page, so the score decides both the shown
price and the extra sale/grade data.

---

## 5. Cross-version sections and their buttons

```mermaid
flowchart TD
    R[Result rendered] --> S1[Main card + marketplace blocks]
    R --> S2{Index counterpart?}
    S2 -->|EN card, JA target| S3[Japanese Version section, Verified]
    S2 -->|JA card, EN target| S4[English Version section, Verified]
    S2 -->|no| S5[TCGdex search result, Unverified]
    S3 --> B1["Look Up Price: skips the index, re-runs the marketplaces for that printing"]
    S4 --> B1
    S5 --> B1
```

- The JP section's button carries the printing's set code, number, Japanese name and the `printsNoSetCode` flag,
  because that flow does not touch the index.
- `shouldSkipJpTcgdexLookup` skips the guaranteed-to-fail TCGdex fetch when the printing came from the index and
  TCGdex has no Japanese card for that set.

---

## 6. Where each rule lives

| Rule | File |
|---|---|
| Query construction, EN counterpart resolution, listing selection, badge | `utils/card-lookup.js` |
| Index resolution (`hit` / `ambiguous` / `multi-target` / `miss`) | `lib/bulbapedia-resolver.js` |
| Lazy per-era loading and the all-era retry | `lib/bulbapedia-index.js` |
| TCGdex lookup, set mapping, cross-version search | `lib/tcgdex-client.js` |
| PriceCharting row ranking and detail enrichment | `lib/pricecharting-scraper.js` |
| Marketplace DOM extraction | `content-scripts/*-extractor.js` |
| Reviewed index data and per-era exclusions | `data/bulbapedia/<era>/` |
