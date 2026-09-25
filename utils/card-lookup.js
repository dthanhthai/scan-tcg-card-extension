// Shared card lookup + result rendering logic used by both the popup and
// the scanner page. Depends on constants.js and storage.js being loaded
// first, and on chrome.runtime.sendMessage to reach the service worker.

// Phase 4/5: resolves the scanned card against the bundled Bulbapedia index
// via a precomputed resolution, validates the target via TCGdex, logs the
// comparison, and returns a report object. A validated TCGdex card is exposed
// as report.validatedCard so the caller may adopt it as the EN version —
// only when validation passes, never for ambiguous or failed resolutions.
async function runBulbapediaReport({ resolution, existingCard, progress }) {
  if (!resolution) return null;
  try {
    const report = { status: resolution.status, sourceKey: resolution.sourceKey || null };
    if (resolution.candidates) report.candidates = resolution.candidates;
    if (resolution.status === 'hit') {
      const target = resolution.target;
      report.target = {
        // A set-only target (the early DP sets) has no card number, so label it
        // with the set name rather than an id like "DP4-null".
        id: target.localId
          ? `${target.tcgdexSetId || target.setCode}-${target.localId}`
          : (target.setName || target.setCode),
        setName: target.setName,
        cardNumber: target.cardNumber,
        cardName: target.cardName,
        rarity: target.rarity,
      };
      // JA targets have no TCGdex set ID, so they cannot be validated via
      // TCGdex; their value is the physical set code + number for CardRush.
      if (target.tcgdexSetId) {
        const validationRes = await sendMessageSafely({
          type: MESSAGE_TYPES.FETCH_CARD_INFO,
          payload: { language: target.language || 'en', setCode: target.tcgdexSetId, localId: target.localId },
        });
        const tcgCard = validationRes && validationRes.success ? validationRes.data : null;
        report.tcgdexCardId = tcgCard ? tcgCard.id : null;
        report.validation = validateBulbapediaTarget(target, tcgCard);
        if (report.validation.valid && tcgCard) report.validatedCard = tcgCard;
      }
    }
    report.comparison = compareBulbapediaWithExisting(resolution, existingCard);
    console.log('[bulbapedia] report:', report);
    if (progress) {
      if (report.status === 'hit') {
        const rejected = report.validation && !report.validation.valid ? ' rejected' : '';
        progress('bulbapedia', 'done', `${report.target.id}${rejected}`);
      } else if (report.status === 'ambiguous') {
        progress('bulbapedia', 'done', `Ambiguous (${report.candidates.length})`);
      } else if (report.status === 'multi-target') {
        progress('bulbapedia', 'done', 'Multiple targets');
      } else {
        progress('bulbapedia', 'done', 'No match');
      }
    }
    return report;
  } catch (err) {
    console.warn('[bulbapedia] resolver error:', err.message);
    if (progress) progress('bulbapedia', 'error');
    return { status: 'error', error: err.message };
  }
}

/**
 * Runs the full lookup pipeline for a set code + local id:
 *  1. Try TCGdex `ja` locale first, then `en`.
 *  2. Fetch prices from all available sources in parallel:
 *     - CardRush (JPY) for JP cards
 *     - TCGPlayer (USD) for EN cards
 *     - PriceCharting (USD) always
 *  3. If TCGdex fails entirely, fall back to CardRush + PriceCharting
 *     using the detected printed code.
 *  4. Save a scan history entry.
 *
 * @param {string} setCode
 * @param {string} localId
 * @param {string} [cardNumberFull] - e.g. "018/017" (for fallback)
 * @param {string} [rarityCodeInput] - e.g. "RR" (for fallback)
 * @param {string} [cardNameInput] - English card name from Gemini (for fallback queries)
 * @param {string} [languageHint] - "ja" or "en" from Gemini (to skip unnecessary sources)
 * @param {string} [setNameHint] - English set name from Gemini (to match TCGdex set ID when set code doesn't match)
 * @param {function} [onProgress] - callback(stepId, status, detail) for progress UI
 * @param {boolean} [skipTcgdex] - skip the TCGdex metadata fetch and go straight
 *   to the marketplace queries (used for an indexed printing whose JA card TCGdex
 *   does not have, so the fetch is guaranteed to fail and only wastes time)
 * @returns {Promise<object>}
 */
// chrome.runtime.sendMessage rejects when the service worker cannot be reached.
// Every caller already handles { success: false }, so a failed message degrades
// to that shape instead of throwing out of the whole lookup and leaving the
// button stuck on "Searching...".
async function sendMessageSafely(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.error('[card-lookup] message failed:', message && message.type, err.message);
    return { success: false, error: err.message };
  }
}

// The keyword sent to CardRush. A printing with a set code uses
// "{setCode} {localId}" (e.g. "S12a 258"). A deck product prints no set code,
// and its placeholder code returns unrelated listings ("BREAK 002"), so those
// are queried by the Japanese card name instead ("MフシギバナEX 002").
function buildCardrushKeyword({ setCode, localId, japaneseName, nameOnly }) {
  if (nameOnly && japaneseName) return `${japaneseName} ${localId}`.trim();
  return `${setCode} ${localId}`;
}

async function lookupCardAndPrice(setCode, localId, cardNumberFull, rarityCodeInput, cardNameInput, languageHint, setNameHint, onProgress, cardNameJp, skipCrossVersion, crossSetCode, crossCardNumber, crossSetName, isPromo, skipTcgdex, nameOnlyKeyword) {
  // A DP-era card prints a level next to the name and the model reads it in
  // ("Darkrai LV.38"); it is not part of the name, so drop it before the name
  // reaches the TCGdex fetch, the index lookup, or a marketplace query.
  cardNameInput = stripPrintedCardLevel(cardNameInput);
  cardNameJp = stripPrintedCardLevel(cardNameJp);
  const progress = (stepId, status, detail) => {
    if (onProgress) onProgress(stepId, status, detail);
  };

  const cardLocalId = cardNumberFull ? cardNumberFull.split('/')[0] : localId;
  const printedTotal = parsePrintedTotal(cardNumberFull);
  const isPromoCard = isPromoCardNumber(cardNumberFull, isPromo);

  // A manual search carries no language hint and the default is Japanese, but a
  // printed code the EN abbreviation table knows ("JTG", "GE") means the card is
  // English: without this the index and TCGdex are both queried in the wrong
  // language and the reviewed counterpart is never found.
  let language = languageHint === 'en' || (!languageHint && getEnSetIdForPrintedCode(setCode))
    ? 'en'
    : 'ja';
  if (skipTcgdex) {
    progress('tcgdex', 'done', 'Skipped (indexed printing)');
  } else {
    progress('tcgdex', 'running', language === 'ja' ? 'Japanese' : 'English');
  }

  let isEnCard = language === 'en';
  const hasCardName = !!(cardNameInput && cardNameInput.trim());
  let englishCardName = cardNameInput || '';
  let cardInfoRes = skipTcgdex ? { success: false, data: null } : null;

  if (!hasCardName && !skipTcgdex) {
    progress('tcgdex', 'running', 'Looking up card name...');
    const slowTimer0 = setTimeout(() => {
      progress('tcgdex', 'running', 'Resolving set code...');
    }, 5000);
    cardInfoRes = await sendMessageSafely({
      type: MESSAGE_TYPES.FETCH_CARD_INFO,
      payload: { language, setCode, localId, setName: setNameHint, cardName: cardNameInput, printedTotal },
    });
    clearTimeout(slowTimer0);
    if (!cardInfoRes.success && !languageHint) {
      const fallbackLang = language === 'en' ? 'ja' : 'en';
      progress('tcgdex', 'running', fallbackLang === 'ja' ? 'Japanese' : 'English');
      language = fallbackLang;
      isEnCard = language === 'en';
      const slowTimer0b = setTimeout(() => {
        progress('tcgdex', 'running', 'Resolving set code...');
      }, 5000);
      cardInfoRes = await sendMessageSafely({
        type: MESSAGE_TYPES.FETCH_CARD_INFO,
        payload: { language, setCode, localId, setName: setNameHint, cardName: cardNameInput, printedTotal },
      });
      clearTimeout(slowTimer0b);
    }
    if (cardInfoRes.success && cardInfoRes.data && cardInfoRes.data.name) {
      englishCardName = cardInfoRes.data.name;
      console.log('[card-lookup] got card name from TCGdex:', englishCardName);
      if (!isEnCard && cardInfoRes.data.dexId && cardInfoRes.data.dexId.length > 0) {
        const enSearchRes = await sendMessageSafely({
          type: MESSAGE_TYPES.FIND_EN_VERSION,
          payload: { cardNameEn: '', jpDexId: cardInfoRes.data.dexId, jpLocalId: localId, jpSetCode: cardInfoRes.data.set?.id || setCode, crossSetCode: null, crossSetName: null, jpHp: cardInfoRes.data.hp || null },
        });
        if (enSearchRes.success && enSearchRes.data && enSearchRes.data.name) {
          englishCardName = enSearchRes.data.name;
          console.log('[card-lookup] got EN name via dexId:', englishCardName);
        }
      }
    }
  }

  const resolvedSetCode = (cardInfoRes && cardInfoRes.success && cardInfoRes.data && cardInfoRes.data.set && cardInfoRes.data.set.id)
    ? cardInfoRes.data.set.id : setCode;
  const fullCardNumber = isPromoCard ? cardLocalId : (cardNumberFull || cardLocalId);
  if (!skipCrossVersion && typeof ensureBulbapediaIndexes === 'function') {
    await ensureBulbapediaIndexes({ setCode, setName: setNameHint });
  }
  // Re-reads the merged views on every call: the loader rebuilds them when it
  // injects more eras, so a captured reference would go stale.
  const resolveBulbapediaFromIndex = () => {
    const records = (!skipCrossVersion && typeof BULBAPEDIA_INDEX !== 'undefined')
      ? (language === 'en' ? BULBAPEDIA_INDEX.en : BULBAPEDIA_INDEX.ja)
      : null;
    return (records && typeof resolveBulbapediaCounterparts === 'function')
      ? resolveBulbapediaCounterparts(records, {
          language,
          setCode,
          cardNumber: fullCardNumber,
          setName: setNameHint,
          cardName: cardNameInput,
          cardNameJp,
          // The index stores the set the card belongs to, not the code printed on
          // it, so a printed abbreviation ("JTG", "GE") is offered as an alias.
          setCodeAliases: language === 'en' ? [getEnSetIdForPrintedCode(setCode)].filter(Boolean) : [],
        })
      : null;
  };
  let bulbapediaResolution = resolveBulbapediaFromIndex();
  // The loader injects only the era the set belongs to, so a miss can also mean
  // the set code was misread into another era's code. Load every era once and
  // resolve again: a genuine miss stays a miss, so this only costs the load.
  if (bulbapediaResolution && bulbapediaResolution.status === 'miss'
    && typeof ensureAllBulbapediaIndexes === 'function'
    && typeof areAllBulbapediaErasLoaded === 'function' && !areAllBulbapediaErasLoaded()) {
    console.log('[bulbapedia] narrowed index missed, loading every era and retrying:', { setCode, setName: setNameHint, cardNumber: fullCardNumber });
    progress('bulbapedia', 'running', 'Loading every set...');
    await ensureAllBulbapediaIndexes();
    bulbapediaResolution = resolveBulbapediaFromIndex();
  }
  const bulbapediaTarget = bulbapediaResolution && bulbapediaResolution.status === 'hit'
    ? bulbapediaResolution.target : null;
  const bulbapediaEnTarget = language === 'ja' ? bulbapediaTarget : null;
  const bulbapediaJpTarget = language === 'en' ? bulbapediaTarget : null;
  // The index can identify the JP printing's set without its card number, because
  // Bulbapedia prints no jpcardno for the early DP sets. TCGdex has no card for
  // those sets at all, so its name search can only return a different printing
  // (observed: Great Encounters 3/106 Darkrai came back as Ultra Sun SM5S-031).
  // Fail closed instead of showing a wrong counterpart.
  const indexKnowsJpSetWithoutNumber = !!bulbapediaJpTarget && !bulbapediaJpTarget.localId;
  // For an EN scan the matched record's source side is the scanned EN card, so
  // its set name is authoritative (and local, unlike the TCGdex fetch).
  const bulbapediaEnSource = (language === 'en' && bulbapediaResolution && bulbapediaResolution.status === 'hit')
    ? bulbapediaResolution.record.source : null;
  const bulbapediaJpVersion = bulbapediaJpTarget ? buildBulbapediaJpVersion(bulbapediaJpTarget) : null;
  if (bulbapediaJpVersion) console.log('[bulbapedia] using exact JP printing:', bulbapediaJpVersion.id, '-', bulbapediaJpVersion.name);
  progress('bulbapedia', bulbapediaResolution ? 'running' : 'done', bulbapediaResolution ? undefined : 'Skipped');
  // EN-only marketplaces cannot sell the JP printing, so an exact EN
  // counterpart from the index makes their queries precise. CardRush keeps
  // the JP query; PriceCharting keeps the source number because its JP
  // listings are the correct printing for the scanned card.
  const cardrushJpName = cardNameJp || bulbapediaResolution?.record?.source?.japaneseName;
  const cardrushKeyword = buildCardrushKeyword({
    setCode: resolvedSetCode,
    localId: cardLocalId,
    japaneseName: cardrushJpName,
    // The index knows a deck printing has no printed code; the JP section's
    // button passes the same information because it skips the index.
    nameOnly: nameOnlyKeyword === true || bulbapediaResolution?.record?.source?.printsNoSetCode === true,
  });
  // C5: the EN marketplaces must receive an English name. The name read from
  // the card is sometimes Japanese (Trainer/Energy cards, which have no dexId
  // for the cross-version search), so when the index has no counterpart we
  // resolve the EN printing first and only then fire the EN queries. The
  // delay is limited to that case; Pokemon scans keep running in parallel.
  const needsEnNameResolution = !isEnCard && !bulbapediaEnTarget && !skipTcgdex
    && !!cardNameInput && hasJapaneseScript(englishCardName);
  let earlyEnVersion = null;

  // The English counterpart decides the name and the number the EN marketplaces
  // see: the index target when the index resolved one, otherwise the TCGdex card
  // resolved for a Japanese scan (C5). Without either, the scanned values stand.
  const resolveEnMarketTarget = (enName) => {
    const counterpart = bulbapediaEnTarget || earlyEnVersion;
    return {
      name: counterpart ? (counterpart.cardName || counterpart.name) : enName,
      number: buildEnMarketNumber(counterpart, fullCardNumber),
    };
  };

  // Builds and fires the three EN marketplaces. `enName` is the English name
  // resolved for this lookup (index counterpart or cross-version search).
  const startEnMarketplaces = (enName) => {
    const pricechartingName = hasJapaneseScript(englishCardName) && enName ? enName : englishCardName;
    const pricechartingSet = pickPricechartingSetToken({
      indexSetName: bulbapediaEnSource ? bulbapediaEnSource.setName : null,
      setNameHint,
      setCode,
      isEnCard,
    });
    const pricechartingQuery = [pricechartingName, fullCardNumber, pricechartingSet].filter(Boolean).join(' ');
    const enMarketTarget = resolveEnMarketTarget(enName);
    const enMarketQuery = `${enMarketTarget.name} ${enMarketTarget.number}`;
    console.log('[card-lookup] EN queries:', { pricecharting: pricechartingQuery, collectr: enMarketQuery, tcgplayer: enMarketQuery, crossVersion: !!skipCrossVersion });
    return [
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.FETCH_PRICECHARTING,
        payload: { query: pricechartingQuery, setName: pricechartingSet, cardName: pricechartingName },
      }).then((res) => { progress('pricecharting', 'done'); return res; })
        .catch((err) => { console.error('[pricecharting] error:', err); progress('pricecharting', 'error'); return { success: false }; }),
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.FETCH_COLLECTR,
        payload: { query: enMarketQuery },
      }).then((res) => { progress('collectr', 'done'); return res; })
        .catch((err) => { console.error('[collectr] error:', err); progress('collectr', 'error'); return { success: false }; }),
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.FETCH_TCGPLAYER,
        payload: { query: enMarketQuery },
      }).then((res) => { progress('tcgplayer', 'done'); return res; })
        .catch((err) => { console.error('[tcgplayer] error:', err); progress('tcgplayer', 'error'); return { success: false }; }),
    ];
  };

  // Start marketplace lookups immediately (in parallel with TCGdex)
  const queryCardrush = shouldQueryCardrush(isEnCard, resolvedSetCode);
  if (queryCardrush) {
    progress('cardrush', 'running');
  } else {
    progress('cardrush', 'done', isEnCard ? 'Skipped (EN card)' : 'Skipped (no set code)');
  }
  progress('tcgplayer', 'running');
  progress('pricecharting', 'running');
  progress('collectr', 'running');
  console.log('[card-lookup] search queries (parallel):', { cardrush: cardrushKeyword, crossVersion: !!skipCrossVersion });

  const cardrushPromise = !queryCardrush
    ? Promise.resolve({ success: false, data: { listings: [], searchUrl: null, cfChallenge: false } })
    : chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.FETCH_CARDRUSH_PRICE,
        payload: { keyword: cardrushKeyword },
      }).then((res) => {
        if (res.data && res.data.cfChallenge) {
          progress('cardrush', 'error', 'Cloudflare challenge — please verify in the opened window');
        } else {
          progress('cardrush', 'done');
        }
        return res;
      })
        .catch((err) => { console.error('[cardrush] error:', err); progress('cardrush', 'error'); return { success: false }; });

  let enMarketPromises = needsEnNameResolution
    ? null
    : startEnMarketplaces(bulbapediaEnTarget ? bulbapediaEnTarget.cardName : englishCardName);

  // The index knows the source card's own TCGdex set, which beats the printed
  // code the model may have misread (DP-era cards print "DPBP#" next to the
  // number, which reads as a set code). Prefer it for the source fetch instead
  // of trying the misread code first and correcting afterwards.
  const indexedCorrection = getIndexedSourceCorrection(bulbapediaResolution, language);
  if (indexedCorrection) {
    console.log('[bulbapedia] using the indexed set for the source fetch:', indexedCorrection.setCode, indexedCorrection.localId);
  }
  const sourceFetch = indexedCorrection
    ? { setCode: indexedCorrection.setCode, localId: indexedCorrection.localId, setName: indexedCorrection.setName }
    : { setCode, localId, setName: setNameHint };

  if (hasCardName && !skipTcgdex) {
    const slowTimer = setTimeout(() => {
      progress('tcgdex', 'running', 'Resolving set code...');
    }, 5000);
    cardInfoRes = await sendMessageSafely({
      type: MESSAGE_TYPES.FETCH_CARD_INFO,
      payload: { language, ...sourceFetch, cardName: cardNameInput, printedTotal },
    });
    clearTimeout(slowTimer);
    if (!cardInfoRes.success && !languageHint) {
      const fallbackLang = language === 'en' ? 'ja' : 'en';
      progress('tcgdex', 'running', fallbackLang === 'ja' ? 'Japanese' : 'English');
      language = fallbackLang;
      isEnCard = language === 'en';
      const slowTimer2 = setTimeout(() => {
        progress('tcgdex', 'running', 'Resolving set code...');
      }, 5000);
      cardInfoRes = await sendMessageSafely({
        type: MESSAGE_TYPES.FETCH_CARD_INFO,
        payload: { language, setCode, localId, setName: setNameHint, cardName: cardNameInput, printedTotal },
      });
      clearTimeout(slowTimer2);
    }
  }

  // C5: when the card name is Japanese and the index has no counterpart, the
  // cross-version search has to run before the EN queries so they can use the
  // resolved English name instead of the Japanese one.
  if (needsEnNameResolution && cardInfoRes.success && !isEnCard) {
    progress('tcgdex', 'running', 'Finding EN version...');
    earlyEnVersion = await findEnCounterpart(cardInfoRes.data, {
      cardNameEn: cardNameInput,
      crossSetCode,
      crossCardNumber,
      crossSetName,
      rarityCode: TCGDEX_TO_CARDRUSH_RARITY[cardInfoRes.data.rarity] || rarityCodeInput || null,
    });
    progress('tcgdex', 'done', cardInfoRes.data.name);
  }
  if (!enMarketPromises) {
    enMarketPromises = startEnMarketplaces((earlyEnVersion && earlyEnVersion.name) || englishCardName);
  }

  // Wait for marketplace results (they've been running in parallel)
  const [cardrushRes, pricechartingRes, collectrRes, tcgplayerRes] = await Promise.all([
    cardrushPromise, enMarketPromises[0], enMarketPromises[1], enMarketPromises[2],
  ]);
  // The EN queries carry the counterpart's name and number, so the returned
  // listings do too: the selection has to look for those, not the scanned ones.
  const enMarketTarget = resolveEnMarketTarget(englishCardName);
  const enMarketLocalId = extractLocalIdFromNumber(enMarketTarget.number);

  // If TCGdex failed, return fallback result using marketplace results
  if (!cardInfoRes.success) {
    if (!skipTcgdex) progress('tcgdex', 'error', 'Not found');
    if (!cardNumberFull) {
      return { success: false, error: `Card not found for ${setCode} ${localId}.` };
    }
    // Build fallback result from marketplace results (already available)
    const bestListing = cardrushRes.success ? pickListingByLocalId(cardrushRes.data.listings, cardLocalId, cardrushJpName) : null;
    const cardrushSearchUrl = cardrushRes.data ? cardrushRes.data.searchUrl : null;
    const cardrushCfChallenge = cardrushRes.data ? cardrushRes.data.cfChallenge : false;
    const pricechartingListing = pricechartingRes.success && pricechartingRes.data.listings.length > 0
      ? pricechartingRes.data.listings[0] : null;
    const pricechartingSearchUrl = pricechartingRes.data ? pricechartingRes.data.searchUrl : null;
    const pricechartingCfChallenge = pricechartingRes.data ? pricechartingRes.data.cfChallenge : false;
    const collectrAllListings = collectrRes.success ? collectrRes.data.listings : [];
    const collectrListing = pickListingByLocalId(collectrAllListings, enMarketLocalId, enMarketTarget.name);
    const collectrAlternativeListings = collectrListing
      ? collectrAllListings.filter((l) => l.productUrl === collectrListing.productUrl && l !== collectrListing)
      : [];
    const collectrSearchUrl = collectrRes.data ? collectrRes.data.searchUrl : `${COLLECTR_SEARCH_URL}/`;
    const tcgplayerScrapedListing = tcgplayerRes.success
      ? pickListingByLocalId(tcgplayerRes.data.listings, enMarketLocalId, enMarketTarget.name) : null;
    const tcgplayerUrl = tcgplayerScrapedListing ? tcgplayerScrapedListing.productUrl : null;
    const tcgplayerPrice = tcgplayerScrapedListing
      ? {
          marketPrice: tcgplayerScrapedListing.marketPrice != null ? tcgplayerScrapedListing.marketPrice : tcgplayerScrapedListing.price,
          mostRecentSale: tcgplayerScrapedListing.mostRecentSale != null ? tcgplayerScrapedListing.mostRecentSale : null,
          listingPrice: tcgplayerScrapedListing.listingPrice != null ? tcgplayerScrapedListing.listingPrice : tcgplayerScrapedListing.price,
          alternativePrices: tcgplayerScrapedListing.alternativePrices || [],
          lowPrice: null,
          highPrice: null,
          imageUrl: tcgplayerScrapedListing.imageUrl || null,
        }
      : null;
    const tcgplayerSearchUrl = tcgplayerRes.data ? tcgplayerRes.data.searchUrl : tcgplayerUrl;
    const bulbapediaReport = await runBulbapediaReport({
      resolution: bulbapediaResolution,
      existingCard: null,
      progress,
    });
    const enVersion = bulbapediaReport && bulbapediaReport.validatedCard ? bulbapediaReport.validatedCard : null;
    if (enVersion) console.log('[bulbapedia] adopted validated counterpart:', enVersion.id);
    return {
      success: true,
      card: null,
      language: isEnCard ? 'en' : 'ja',
      rarityCode: rarityCodeInput || null,
      cardNumber: cardNumberFull,
      setCode,
      bestListing,
      cardrushAllListings: cardrushRes.success ? cardrushRes.data.listings.slice(0, 5) : [],
      cardrushSearchUrl,
      cardrushCfChallenge,
      pricechartingListing,
      pricechartingAllListings: pricechartingRes.success ? pricechartingRes.data.listings.slice(0, 5) : [],
      pricechartingSearchUrl,
      pricechartingCfChallenge,
      collectrListing,
      collectrAlternativeListings,
      collectrAllListings: collectrAllListings.slice(0, 5),
      collectrSearchUrl,
      tcgplayerUrl,
      tcgplayerPrice,
      tcgplayerAllListings: tcgplayerRes.success ? tcgplayerRes.data.listings.slice(0, 5) : [],
      tcgplayerSearchUrl,
      resolvedCardName: englishCardName || null,
      bulbapediaReport,
      jpVersion: bulbapediaJpVersion,
      enVersion,
    };
  }

  progress('tcgdex', 'done', cardInfoRes.data.name);

  const card = cardInfoRes.data;
  const tcgdexRarityCode = TCGDEX_TO_CARDRUSH_RARITY[card.rarity] || null;
  const rarityCode = tcgdexRarityCode || rarityCodeInput || null;
  const isPromoSet = card.set && card.set.name && /promo/i.test(card.set.name);
  const cardNumber = !isPromoSet && card.set && card.set.cardCount
    ? `${card.localId}/${String(card.set.cardCount.official).padStart(3, '0')}`
    : card.localId;
  const imageUrl = card.image ? `${card.image}/high.webp` : null;

  const bestListing = cardrushRes.success ? pickListingByLocalId(cardrushRes.data.listings, cardLocalId, cardrushJpName) : null;
  const cardrushSearchUrl = cardrushRes.data ? cardrushRes.data.searchUrl : null;
  const cardrushCfChallenge = cardrushRes.data ? cardrushRes.data.cfChallenge : false;
  const pricechartingListing = pricechartingRes.success && pricechartingRes.data.listings.length > 0
    ? pricechartingRes.data.listings[0]
    : null;
  const pricechartingSearchUrl = pricechartingRes.data ? pricechartingRes.data.searchUrl : null;
  const pricechartingCfChallenge = pricechartingRes.data ? pricechartingRes.data.cfChallenge : false;
  const collectrAllListings = collectrRes.success ? collectrRes.data.listings : [];
  const collectrListing = pickListingByLocalId(collectrAllListings, enMarketLocalId, enMarketTarget.name);
  const collectrAlternativeListings = collectrListing
    ? collectrAllListings.filter((l) => l.productUrl === collectrListing.productUrl && l !== collectrListing)
    : [];
  const collectrSearchUrl = collectrRes.data ? collectrRes.data.searchUrl : `${COLLECTR_SEARCH_URL}/`;

  // Prefer scraped TCGPlayer price; fall back to TCGdex bundled price
  // Filter TCGPlayer results to match the card number
  const tcgplayerAllListings = tcgplayerRes.success ? tcgplayerRes.data.listings : [];
  const tcgplayerScrapedListing = pickListingByLocalId(tcgplayerAllListings, enMarketLocalId, enMarketTarget.name);
  const tcgplayerScrapedUrl = tcgplayerScrapedListing ? tcgplayerScrapedListing.productUrl : null;
  const tcgplayerUrl = tcgplayerScrapedUrl || buildTcgplayerUrl(card.name);
  const tcgplayerPrice = tcgplayerScrapedListing
    ? {
        marketPrice: tcgplayerScrapedListing.marketPrice != null ? tcgplayerScrapedListing.marketPrice : tcgplayerScrapedListing.price,
        mostRecentSale: tcgplayerScrapedListing.mostRecentSale != null ? tcgplayerScrapedListing.mostRecentSale : null,
        listingPrice: tcgplayerScrapedListing.listingPrice != null ? tcgplayerScrapedListing.listingPrice : tcgplayerScrapedListing.price,
        alternativePrices: tcgplayerScrapedListing.alternativePrices || [],
        lowPrice: null,
        highPrice: null,
        imageUrl: tcgplayerScrapedListing.imageUrl || null,
      }
    : extractTcgplayerPrice(card);
  const tcgplayerSearchUrl = tcgplayerRes.data ? tcgplayerRes.data.searchUrl : tcgplayerUrl;

  await addScanEntry({
    cardId: card.id,
    cardNameJp: language === 'ja' ? card.name : null,
    cardNameEn: language === 'en' ? card.name : null,
    cardNumber,
    setCode: card.set ? card.set.id : setCode,
    setName: card.set ? card.set.name : null,
    rarityCode,
    language,
    price: bestListing ? bestListing.price : (tcgplayerPrice ? tcgplayerPrice.marketPrice : null),
    currency: language === 'ja' ? 'JPY' : 'USD',
    imageUrl,
    cardrushUrl: bestListing ? bestListing.productUrl : cardrushSearchUrl,
    timestamp: Date.now(),
  });

  // For EN cards, try to find the JP version using Gemini's cardNameJp
  // For JP cards, try to find the EN version using Gemini's cardName (English)
  // Skip when this is a cross-version price lookup (avoid recursion)
  // The exact index relationship beats TCGdex search, whose dexId/rarity
  // fallbacks can match a different printing (observed: a Mega Darkrai ex
  // returned for Dark Explorers 107/108 instead of Dark Rush 072/069).
  let jpVersion = bulbapediaJpVersion;
  let enVersion = earlyEnVersion;
  if (!skipCrossVersion && language === 'en') {
    progress('tcgdex', 'running', 'Finding JP version...');
    if (indexKnowsJpSetWithoutNumber) {
      console.log('[card-lookup] JP version search skipped: the index knows the JP set but not its card number');
    }
    if (!jpVersion && !indexKnowsJpSetWithoutNumber && crossSetCode && crossCardNumber) {
      const crossLocalId = crossCardNumber.split('/')[0];
      const directRes = await sendMessageSafely({
        type: MESSAGE_TYPES.FETCH_CARD_INFO,
        payload: { language: 'ja', setCode: crossSetCode, localId: crossLocalId },
      });
      if (directRes.success && directRes.data) {
        const jpCard = directRes.data;
        if (validateCrossVersionMatch(card, jpCard)) {
          jpVersion = jpCard;
          console.log('[card-lookup] JP version found (direct):', jpVersion.id, '-', jpVersion.name);
        } else {
          console.log('[card-lookup] JP direct lookup mismatch (dex/hp), falling back:', jpCard.id, jpCard.name, 'dexId:', jpCard.dexId, 'hp:', jpCard.hp);
        }
      }
    }
    if (!jpVersion && !indexKnowsJpSetWithoutNumber && cardNameJp) {
      const jpRes = await sendMessageSafely({
        type: MESSAGE_TYPES.FIND_JP_VERSION,
        payload: { cardNameJp, enDexId: card.dexId || null, enLocalId: card.localId || null, enSetCode: card.set?.id || null, crossSetCode, crossSetName, enHp: card.hp || null, enRarity: rarityCode || null },
      });
      if (jpRes.success) {
        jpVersion = jpRes.data;
        console.log('[card-lookup] JP version found (search):', jpVersion.id, '-', jpVersion.name);
      } else {
        console.log('[card-lookup] JP version not found:', jpRes.error);
      }
    }
    if (!jpVersion && !indexKnowsJpSetWithoutNumber) {
      const jpRes = await sendMessageSafely({
        type: MESSAGE_TYPES.FIND_JP_VERSION,
        payload: { cardNameJp: englishCardName || cardNameInput, enDexId: card.dexId || null, enLocalId: card.localId || null, enSetCode: card.set?.id || null, crossSetCode, crossSetName, enHp: card.hp || null, enRarity: rarityCode || null },
      });
      if (jpRes.success) {
        jpVersion = jpRes.data;
        console.log('[card-lookup] JP version found (EN-name search):', jpVersion.id, '-', jpVersion.name);
      } else {
        console.log('[card-lookup] JP version not found (EN-name):', jpRes.error);
      }
    }
    progress('tcgdex', 'done', card.name);
  } else if (!skipCrossVersion && language === 'ja' && cardNameInput && !enVersion) {
    progress('tcgdex', 'running', 'Finding EN version...');
    enVersion = await findEnCounterpart(card, {
      cardNameEn: cardNameInput,
      crossSetCode,
      crossCardNumber,
      crossSetName,
      rarityCode,
    });
    progress('tcgdex', 'done', card.name);
  }

  const bulbapediaReport = await runBulbapediaReport({
    resolution: bulbapediaResolution,
    existingCard: language === 'en' ? jpVersion : enVersion,
    progress,
  });
  if (language === 'ja') {
    const selection = selectCrossVersionCard(bulbapediaReport && bulbapediaReport.validatedCard, enVersion);
    if (selection.overrode) {
      console.log('[bulbapedia] index overrides pipeline counterpart:', {
        pipeline: enVersion.id,
        index: selection.card.id,
        sourceKey: bulbapediaReport.sourceKey,
        comparison: bulbapediaReport.comparison,
      });
    } else if (selection.card && !enVersion) {
      console.log('[bulbapedia] adopted validated counterpart:', selection.card.id);
    }
    enVersion = selection.card;
  }

  const result = {
    success: true,
    card,
    language,
    rarityCode,
    cardNumber,
    setCode,
    bestListing,
    cardrushAllListings: cardrushRes.success ? cardrushRes.data.listings.slice(0, 5) : [],
    cardrushSearchUrl,
    cardrushCfChallenge,
    pricechartingListing,
    pricechartingAllListings: pricechartingRes.success ? pricechartingRes.data.listings.slice(0, 5) : [],
    pricechartingSearchUrl,
    pricechartingCfChallenge,
    collectrListing,
    collectrAlternativeListings,
    collectrAllListings: collectrAllListings.slice(0, 5),
    collectrSearchUrl,
    tcgplayerUrl,
    tcgplayerPrice,
    tcgplayerAllListings: tcgplayerRes.success ? tcgplayerRes.data.listings.slice(0, 5) : [],
    tcgplayerSearchUrl,
    jpVersion,
    enVersion,
    resolvedCardName: englishCardName || null,
    bulbapediaReport,
  };
  return result;
}

/**
 * Pulls a usable market price out of TCGdex's bundled `pricing.tcgplayer`
 * block, if present. Prefers the "normal" print, falling back to whichever
 * variant has a marketPrice.
 */
function extractTcgplayerPrice(card) {
  const tcgplayer = card.pricing && card.pricing.tcgplayer;
  if (!tcgplayer) return null;

  const variant = tcgplayer.normal || tcgplayer['reverse-holofoil'] || tcgplayer.holofoil
    || Object.values(tcgplayer).find((v) => v && typeof v.marketPrice === 'number');

  if (!variant || typeof variant.marketPrice !== 'number') return null;
  return { marketPrice: variant.marketPrice, lowPrice: variant.lowPrice, highPrice: variant.highPrice };
}

// Picks the listing that belongs to the printed card number, then the card
// name, and only then the first listing. CardRush and Collectr listings carry a
// parsed cardNumber ("212/187"), which is the only reliable number field: their
// product name holds just the card name, so the old product-name/URL text match
// never hit and every scan fell back to the first listing. Text patterns are
// kept as a fallback for listings without a parsed number.
//
// The name is the next best signal when no number matches. CardRush's search is
// fuzzy — a query for one printing returns every printing in the set (observed:
// "S8b 110" returned 23 different numbers with 204/184 first) — so a card that
// is sold out would otherwise show a different card's price.
function pickListingByLocalId(listings, localId, cardName) {
  if (!listings || listings.length === 0) return null;
  if (listings.length === 1) return listings[0];
  // Sources disagree on zero padding ("074" vs "74"), so numeric ids also
  // compare as numbers and the text patterns are tried in both forms.
  const numericLocalId = localId !== null && localId !== undefined && localId !== '' ? Number(localId) : NaN;
  const isNumeric = Number.isFinite(numericLocalId);
  const variants = isNumeric ? [String(localId), String(numericLocalId)] : [String(localId)];
  const matchesLocalId = (listing) => {
    const listingLocalId = listing.cardNumber ? listing.cardNumber.split('/')[0] : null;
    if (listingLocalId === localId) return true;
    if (listingLocalId && isNumeric && Number(listingLocalId) === numericLocalId) return true;
    const text = `${listing.productName || ''} ${listing.productUrl || ''}`;
    return variants.some((variant) => text.includes(`#${variant}`) || text.includes(` ${variant} `) || text.includes(`-${variant}`) || text.includes(`/${variant}`) || text.includes(`${variant}/`));
  };
  const wantedName = typeof normalizeBulbapediaCardName === 'function' ? normalizeBulbapediaCardName(cardName) : null;
  const matchesCardName = (listing) => {
    if (!wantedName) return false;
    const listingName = normalizeBulbapediaCardName(listing.productName);
    if (!listingName) return false;
    return listingName === wantedName || (wantedName.length >= 4 && listingName.includes(wantedName));
  };
  const ranked = listings.map((listing, index) => ({
    listing,
    index,
    matchesNumber: Boolean(localId) && matchesLocalId(listing),
    matchesName: matchesCardName(listing),
  }));
  const best = ranked
    .filter((entry) => entry.matchesNumber || entry.matchesName)
    .sort((a, b) => (Number(b.matchesNumber) - Number(a.matchesNumber))
      || (Number(b.matchesName) - Number(a.matchesName))
      || (a.index - b.index))[0];
  return best ? best.listing : listings[0];
}

// The number the English marketplaces search on. An English counterpart — the
// index target or the TCGdex card resolved for a Japanese scan — knows the
// printing those marketplaces actually sell, so it wins over the scanned
// number. Without one, the scanned number is all there is.
function buildEnMarketNumber(counterpart, fallbackNumber) {
  if (!counterpart) return fallbackNumber;
  if (counterpart.cardNumber) return counterpart.cardNumber;
  const official = counterpart.set && counterpart.set.cardCount ? counterpart.set.cardCount.official : null;
  return counterpart.localId && official ? `${counterpart.localId}/${official}` : fallbackNumber;
}

// The local id that goes with buildEnMarketNumber, used to pick the listing the
// query was built for.
function extractLocalIdFromNumber(cardNumber) {
  return typeof cardNumber === 'string' && cardNumber ? cardNumber.split('/')[0] : null;
}

// C2/C4: tells whether the cross-version card shown in the result came from
// the reviewed Bulbapedia index or from a TCGdex search guess.
// The JP section uses the index printing directly on a hit; the EN section
// uses it only when the validated index card was adopted as enVersion.
function resolveCrossVersionProvenance(result) {
  if (!result) return null;
  const report = result.bulbapediaReport || null;
  if (result.jpVersion) {
    return report && report.status === 'hit' ? 'index' : 'guess';
  }
  if (result.enVersion) {
    const isAdopted = !!(report && report.validatedCard && result.enVersion.id === report.validatedCard.id);
    return isAdopted ? 'index' : 'guess';
  }
  return null;
}

// C2/C4: renders the provenance badge for the cross-version section header.
// 'index' means a reviewed index match; 'guess' marks an unverified result.
// Draws the info icon with SVG shapes instead of a text "i", because a text
// glyph is not centred inside a circle at this small size. The tooltip text
// lives on the wrapper so the CSS ::after can show it on hover.
function renderCrossVersionInfoIcon(tooltip) {
  // role="img" + aria-label expose the tooltip text to screen readers, since the
  // visible icon is a decorative SVG.
  return `<span class="cross-version-badge-info" role="img" aria-label="${tooltip}" data-tooltip="${tooltip}"><svg class="cross-version-badge-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3" /><rect x="7.3" y="7" width="1.4" height="4" rx="0.7" fill="currentColor" /><circle cx="8" cy="4.8" r="0.95" fill="currentColor" /></svg></span>`;
}

function renderCrossVersionBadge(provenance) {
  if (provenance === 'index') {
    return `<span class="cross-version-badge cross-version-badge-verified">Verified${renderCrossVersionInfoIcon('Matched in the reviewed Bulbapedia index')}</span>`;
  }
  if (provenance === 'guess') {
    return `<span class="cross-version-badge cross-version-badge-guess">Unverified${renderCrossVersionInfoIcon('Not in the reviewed index. Matched by TCGdex on card name and Pokedex number, plus HP when available - verify the printing before trusting')}</span>`;
  }
  return '';
}

// The set token for the PriceCharting query. PriceCharting labels sets in
// English, so the token must be an English set name:
//   1. the set name from the index's own EN source — authoritative and local,
//      available before any network call;
//   2. the set name Gemini read;
//   3. the printed set code, which only helps for EN scans (a JP code such as
//      "XY1B" means nothing to PriceCharting).
// A Japanese-script set name is never used.
function pickPricechartingSetToken({ indexSetName, setNameHint, setCode, isEnCard }) {
  if (indexSetName && !hasJapaneseScript(indexSetName)) return indexSetName;
  if (setNameHint && !hasJapaneseScript(setNameHint)) return setNameHint;
  return isEnCard ? (setCode || null) : null;
}

// Brings a freshly rendered block into view. `block: 'start'` pins it to the top
// of the viewport (main result); `block: 'nearest'` only scrolls when it is out
// of view, which keeps the surrounding section (badge, printing info) visible
// for the cross-version price results. Guarded because test DOMs have no
// scrollIntoView.
function scrollIntoViewIfPossible(element, block = 'start') {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block, behavior: 'smooth' });
  }
}

/**
 * Renders a card + price result into the given container element.
 * Shows all available price sources (CardRush, TCGPlayer, PriceCharting)
 * side by side, each with currency conversion.
 *
 * @param {HTMLElement} container
 * @param {object} result - the object returned by lookupCardAndPrice()
 */
async function renderCardResult(container, result) {
  const { card, rarityCode, cardNumber, language, setCode } = result;
  const imageUrl = card && card.image ? `${card.image}/high.webp` : '';
  const cardName = card ? card.name : (result.bestListing ? result.bestListing.productName : 'Unknown card');
  const setName = card && card.set ? card.set.name : '';
  const setId = card && card.set ? card.set.id : (setCode || '');

  const ratesRes = await sendMessageSafely({ type: MESSAGE_TYPES.FETCH_EXCHANGE_RATES });
  console.log('[card-lookup] exchange rates response:', JSON.stringify(ratesRes));
  const rates = ratesRes.success ? ratesRes.data : null;
  console.log('[card-lookup] rates used for conversion:', rates);

  const sourcesHtml = renderAllPriceSources(result, rates);
  const crossVersionProvenance = resolveCrossVersionProvenance(result);
  const crossVersionBadge = renderCrossVersionBadge(crossVersionProvenance);

  // Build JP version section if found (when scanning EN card)
  let jpVersionHtml = '';
  if (result.jpVersion) {
    const jp = result.jpVersion;
    const jpRarityCode = TCGDEX_TO_CARDRUSH_RARITY[jp.rarity] || jp.rarity || '-';
    const jpSetId = jp.set ? jp.set.id : '';
    const jpSetName = jp.set ? jp.set.name : '';
    const jpCardNumber = jp.set && jp.set.cardCount
      ? `${jp.localId}/${String(jp.set.cardCount.official).padStart(3, '0')}`
      : jp.localId;
    const jpImageUrl = resolveJpVersionImage(jp, result.bulbapediaReport);
    jpVersionHtml = `
      <div class="cross-version-section" data-version-lang="ja">
        <div class="cross-version-label"><span>🇯🇵 Japanese Version</span>${crossVersionBadge}</div>
        <div class="cross-version-body">
          ${jpImageUrl ? `<img src="${jpImageUrl}" alt="${jp.name}" class="card-thumb-small" data-full="${jpImageUrl}" />` : ''}
          <div class="cross-version-info">
            <div class="cross-version-name">${jp.name}</div>
            <div class="cross-version-meta">${jpSetId} - ${jpCardNumber} [${jpRarityCode}]${jpSetName ? ` &middot; ${jpSetName}` : ''}</div>
          </div>
        </div>
        <button class="cross-version-lookup-btn" data-set-code="${jpSetId}" data-local-id="${jp.localId}" data-card-number="${jpCardNumber}" data-rarity="${jpRarityCode}" data-card-name="${jp.englishName || cardName}" data-jp-name="${jp.name || ''}" data-set-name="${jpSetName || setName}" data-lang="ja" data-name-keyword="${jp.printsNoSetCode ? '1' : '0'}" data-skip-tcgdex="${shouldSkipJpTcgdexLookup(crossVersionProvenance, jp) ? '1' : '0'}">🔍 Look Up Price</button>
        <div class="cross-version-progress hidden"></div>
        <div class="cross-version-result hidden"></div>
      </div>`;
  }

  // Build EN version section if found (when scanning JP card)
  let enVersionHtml = '';
  if (result.enVersion) {
    const en = result.enVersion;
    const enRarityCode = TCGDEX_TO_CARDRUSH_RARITY[en.rarity] || en.rarity || '-';
    const enSetId = en.set ? en.set.id : '';
    const enSetName = en.set ? en.set.name : '';
    const enCardNumber = en.set && en.set.cardCount
      ? `${en.localId}/${String(en.set.cardCount.official).padStart(3, '0')}`
      : en.localId;
    const enImageUrl = en.image ? `${en.image}/high.webp` : '';
    enVersionHtml = `
      <div class="cross-version-section" data-version-lang="en">
        <div class="cross-version-label"><span>🇺🇸 English Version</span>${crossVersionBadge}</div>
        <div class="cross-version-body">
          ${enImageUrl ? `<img src="${enImageUrl}" alt="${en.name}" class="card-thumb-small" data-full="${enImageUrl}" />` : ''}
          <div class="cross-version-info">
            <div class="cross-version-name">${en.name}</div>
            <div class="cross-version-meta">${enSetId} - ${enCardNumber} [${enRarityCode}]${enSetName ? ` &middot; ${enSetName}` : ''}</div>
          </div>
        </div>
        <button class="cross-version-lookup-btn" data-set-code="${enSetId}" data-local-id="${en.localId}" data-card-number="${enCardNumber}" data-rarity="${enRarityCode}" data-card-name="${en.name}" data-set-name="${enSetName}" data-lang="en">🔍 Look Up Price</button>
        <div class="cross-version-progress hidden"></div>
        <div class="cross-version-result hidden"></div>
      </div>`;
  }

  const crossVersionHtml = jpVersionHtml || enVersionHtml;

  container.innerHTML = `
    <div class="result-card">
      <div class="result-header">
        ${imageUrl ? `<img src="${imageUrl}" alt="${cardName}" class="card-thumb" data-full="${imageUrl}" />` : ''}
        <div class="result-info">
          <h3>${cardName}</h3>
          <div class="result-meta">${setId} - ${cardNumber} [${rarityCode || '-'}]${setName ? ` &middot; ${setName}` : ''}</div>
        </div>
      </div>
      <div class="price-sources">${sourcesHtml}</div>
    </div>
  `;

  // Insert cross-version section as a sibling (outside result-area)
  const existingCrossVersion = document.getElementById('crossVersionArea');
  if (existingCrossVersion) existingCrossVersion.remove();
  if (crossVersionHtml) {
    const crossVersionEl = document.createElement('div');
    crossVersionEl.id = 'crossVersionArea';
    crossVersionEl.innerHTML = `<div class="cross-version-wrapper">${crossVersionHtml}</div>`;
    container.parentNode.insertBefore(crossVersionEl, container.nextSibling);
  }

  container.classList.remove('hidden');

  // The result renders below the capture/OCR sections, so bring it into view.
  scrollIntoViewIfPossible(container);

  if (imageUrl) {
    const thumb = container.querySelector('.result-header .card-thumb');
    if (thumb) {
      thumb.addEventListener('click', () => showCardImageOverlay(imageUrl, cardName));
    }
  }

  container.querySelectorAll('.price-sources .card-thumb-small, .price-sources .alt-thumb').forEach((t) => {
    const fullUrl = t.getAttribute('data-full');
    if (fullUrl) t.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showCardImageOverlay(fullUrl, cardName); });
  });

  const smallThumbs = document.querySelectorAll('#crossVersionArea .card-thumb-small');
  smallThumbs.forEach((t) => {
    const fullUrl = t.getAttribute('data-full');
    if (fullUrl) t.addEventListener('click', () => showCardImageOverlay(fullUrl, cardName));
  });

  // Attach Look Up Price handlers for cross-version sections
  document.querySelectorAll('#crossVersionArea .cross-version-lookup-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const section = btn.closest('.cross-version-section');
      const setCode = btn.dataset.setCode;
      const localId = btn.dataset.localId;
      const cardNumber = btn.dataset.cardNumber;
      const rarityCode = btn.dataset.rarity;
      const cardName = btn.dataset.cardName;
      const setNameHint = btn.dataset.setName || null;
      const lang = btn.dataset.lang;
      const skipTcgdex = btn.dataset.skipTcgdex === '1';
      const nameOnlyKeyword = btn.dataset.nameKeyword === '1';
      // The Japanese name is only used to build a name-based CardRush keyword;
      // the cross-version search is skipped in this flow.
      const japaneseName = btn.dataset.jpName || null;
      const progressEl = section.querySelector('.cross-version-progress');
      const resultEl = section.querySelector('.cross-version-result');
      btn.disabled = true;
      btn.innerHTML = '🔍 Searching...';
      progressEl.classList.remove('hidden');
      progressEl.innerHTML = `<div class="progress-steps">${renderProgressSteps({})}</div>`;
      resultEl.classList.add('hidden');
      resultEl.innerHTML = '';
      const progressStates = {};
      // A failed lookup must still restore the button, or the section stays on
      // "Searching..." forever.
      const crossResult = await lookupCardAndPrice(
        setCode, localId, cardNumber, rarityCode, cardName, lang, setNameHint,
        (stepId, status, detail) => {
          progressStates[stepId] = { status, detail };
          progressEl.innerHTML = `<div class="progress-steps">${renderProgressSteps(progressStates)}</div>`;
        },
        japaneseName,
        true,
        null,
        null,
        null,
        null,
        skipTcgdex,
        nameOnlyKeyword,
      ).catch((err) => {
        console.error('[card-lookup] cross-version lookup failed:', err);
        return { success: false, error: `Lookup failed: ${err.message}` };
      });
      progressEl.classList.add('hidden');
      btn.disabled = false;
      btn.innerHTML = '🔍 Look Up Price';
      if (!crossResult.success) {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = `<div class="price-sub not-found">${crossResult.error || 'No results found.'}</div>`;
        scrollIntoViewIfPossible(resultEl, 'nearest');
        return;
      }
      const ratesRes = await sendMessageSafely({ type: MESSAGE_TYPES.FETCH_EXCHANGE_RATES });
      const rates = ratesRes.success ? ratesRes.data : null;
      const crossSourcesHtml = renderAllPriceSources(crossResult, rates);
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `<div class="price-sources">${crossSourcesHtml}</div>`;
      scrollIntoViewIfPossible(resultEl, 'nearest');
      // Attach thumbnail click handlers in cross-version result
      resultEl.querySelectorAll('.card-thumb-small, .alt-thumb').forEach((t) => {
        const fullUrl = t.getAttribute('data-full');
        if (fullUrl) t.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showCardImageOverlay(fullUrl, crossResult.card ? crossResult.card.name : cardName); });
      });
      // C1: eras without JA artwork have no thumbnail until this lookup runs,
      // so fill it with the CardRush listing image (the exact JP printing) or,
      // when CardRush has no listing, another marketplace's image.
      const sectionBody = section.querySelector('.cross-version-body');
      const listingImage = pickCrossVersionResultImage(crossResult);
      if (sectionBody && !sectionBody.querySelector('.card-thumb-small') && listingImage) {
        const img = document.createElement('img');
        img.src = listingImage;
        img.alt = cardName;
        img.className = 'card-thumb-small';
        img.setAttribute('data-full', listingImage);
        img.addEventListener('click', () => showCardImageOverlay(listingImage, cardName));
        sectionBody.insertBefore(img, sectionBody.firstChild);
      }
    });
  });
}

function showCardImageOverlay(imageUrl, cardName) {
  const existing = document.getElementById('cardImageOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cardImageOverlay';
  overlay.className = 'card-image-overlay';
  overlay.innerHTML = `
    <img src="${imageUrl}" alt="${cardName}" />
    <div class="card-image-overlay-hint">Click anywhere to close</div>
  `;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

function renderAllPriceSources(result, rates) {
  const blocks = [];
  const isPlaceholder = (url) => !url || url.startsWith('data:image/gif') || url.startsWith('data:image/png');
  // Fallback: TCGdex image first, then first available marketplace image
  let fallbackImageUrl = result.card && result.card.image ? `${result.card.image}/high.webp` : '';
  if (!fallbackImageUrl) {
    const marketplaceImages = [
      result.bestListing ? result.bestListing.imageUrl : null,
      result.collectrListing ? result.collectrListing.imageUrl : null,
      result.tcgplayerPrice ? result.tcgplayerPrice.imageUrl : null,
      result.pricechartingListing ? result.pricechartingListing.imageUrl : null,
    ].filter((url) => !isPlaceholder(url));
    fallbackImageUrl = marketplaceImages[0] || '';
  }

  console.log('[card-lookup] allListings counts:', {
    cardrush: (result.cardrushAllListings || []).length,
    tcgplayer: (result.tcgplayerAllListings || []).length,
    pricecharting: (result.pricechartingAllListings || []).length,
    collectr: (result.collectrAllListings || []).length,
  });

  if (result.bestListing) {
    blocks.push(renderCardrushBlock(result.bestListing, rates, fallbackImageUrl, result.cardrushAllListings || []));
  } else if (result.cardrushSearchUrl) {
    blocks.push(renderCardrushEmptyBlock(result.cardrushSearchUrl, result.cardrushCfChallenge));
  }

  if (result.tcgplayerPrice) {
    blocks.push(renderTcgplayerBlock(result.tcgplayerPrice, result.tcgplayerUrl, rates, fallbackImageUrl, result.tcgplayerAllListings || []));
  } else if (result.tcgplayerSearchUrl) {
    blocks.push(renderTcgplayerEmptyBlock(result.tcgplayerSearchUrl));
  }

  if (result.pricechartingListing) {
    blocks.push(renderPricechartingBlock(result.pricechartingListing, rates, fallbackImageUrl, result.pricechartingAllListings || []));
  } else if (result.pricechartingSearchUrl) {
    const pcCfChallenge = result.pricechartingCfChallenge || false;
    blocks.push(renderPricechartingEmptyBlock(result.pricechartingSearchUrl, pcCfChallenge));
  }

  if (result.collectrListing) {
    blocks.push(renderCollectrBlock(result.collectrListing, result.collectrAlternativeListings || [], rates, fallbackImageUrl, result.collectrAllListings || []));
  } else if (result.collectrSearchUrl) {
    blocks.push(renderCollectrEmptyBlock(result.collectrSearchUrl));
  }

  console.log('[card-lookup] image data:', {
    cardrush: result.bestListing ? result.bestListing.imageUrl : null,
    tcgplayer: result.tcgplayerPrice ? result.tcgplayerPrice.imageUrl : null,
    pricecharting: result.pricechartingListing ? result.pricechartingListing.imageUrl : null,
    collectr: result.collectrListing ? result.collectrListing.imageUrl : null,
    fallback: fallbackImageUrl,
  });

  return blocks.join('');
}

function thumbHtml(imageUrl, fallbackImageUrl) {
  const isPlaceholder = imageUrl && imageUrl.startsWith('data:image/gif');
  const url = (imageUrl && !isPlaceholder) ? imageUrl : fallbackImageUrl;
  if (!url) return '';
  console.log('[card-lookup] thumb image:', { source: imageUrl && !isPlaceholder ? 'marketplace' : 'tcgdex-fallback', url });
  return `<img src="${url}" alt="Card image" class="card-thumb-small" data-full="${url}" />`;
}

function renderAlternativesList(allListings, bestListing, fmtPrice) {
  if (!allListings || allListings.length <= 1) return '';
  const alts = allListings.filter((l) => !bestListing || l.productUrl !== bestListing.productUrl).slice(0, 4);
  if (alts.length === 0) return '';
  const items = alts.map((l) => {
    const name = (l.productName || '').substring(0, 40);
    const price = fmtPrice(l);
    const thumb = l.imageUrl ? `<img src="${l.imageUrl}" class="alt-thumb" data-full="${l.imageUrl}" />` : '';
    return `<a class="alt-result" href="${l.productUrl}" target="_blank" rel="noopener" title="Click to view details">
      ${thumb}
      <span class="alt-name">${name}</span>
      <span class="alt-price">${price}</span>
      <span class="alt-arrow">›</span>
    </a>`;
  }).join('');
  // Collapsed by default: the alternatives are secondary to the picked listing,
  // and <details> gives the disclosure keyboard and screen-reader support for free.
  return `<details class="alt-results"><summary class="alt-results-label">Other results (${alts.length})</summary><div class="alt-results-body">${items}</div></details>`;
}

function renderCardrushBlock(bestListing, rates, fallbackImageUrl, allListings) {
  let convertedHtml = '';
  if (rates && rates.JPY) {
    const usdPrice = bestListing.price * rates.JPY.USD;
    const vndPrice = bestListing.price * rates.JPY.VND;
    convertedHtml = `<div class="price-converted">≈ $${usdPrice.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USD &middot; ≈ ₫${Math.ceil(vndPrice).toLocaleString('vi-VN')} VND</div>`;
  }
  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/cardrush.png')}" class="source-logo" alt="CardRush">CardRush</div>
        <a class="link-btn" href="${bestListing.productUrl}" target="_blank" rel="noopener">View →</a>
      </div>
      <div class="price-source-body">
        <div class="price-primary">
          <div class="price-value">${bestListing.price != null ? `¥${bestListing.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'N/A'}</div>
          ${convertedHtml}
        </div>
        ${thumbHtml(bestListing.imageUrl, fallbackImageUrl)}
      </div>
      <div class="price-sub">在庫 ${bestListing.stock}枚 &middot; ${bestListing.condition}</div>
      ${renderAlternativesList(allListings, bestListing, (l) => l.price != null ? `¥${l.price.toLocaleString('en-US')}` : 'N/A')}
    </div>`;
}

function renderCardrushEmptyBlock(searchUrl, cfChallenge) {
  const warning = cfChallenge
    ? '<div class="price-sub cf-warning">⚠️ Cloudflare challenge detected. Please verify manually in the opened CardRush window, then search again.</div>'
    : '<div class="price-sub not-found">No card found.</div>';
  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/cardrush.png')}" class="source-logo" alt="CardRush">CardRush</div>
        <a class="link-btn" href="${searchUrl}" target="_blank" rel="noopener">Search →</a>
      </div>
      ${warning}
    </div>`;
}

function renderTcgplayerBlock(tcgplayerPrice, tcgplayerUrl, rates, fallbackImageUrl, allListings) {
  const fmt = (v) => v != null ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : null;
  const fmtVnd = (v) => {
    if (v == null || !rates || !rates.USD) return null;
    return `≈ ₫${Math.ceil(v * rates.USD.VND).toLocaleString('vi-VN')} VND`;
  };

  // Determine which prices to show
  const market = tcgplayerPrice.marketPrice;
  const recentSale = tcgplayerPrice.mostRecentSale;
  const listing = tcgplayerPrice.listingPrice;

  // Primary price = Market Price (most reliable), fallback to listingPrice
  const primaryPrice = market != null ? market : listing;
  const primaryLabel = market != null ? 'Market Price' : 'Listing Price';
  const vndPrimary = fmtVnd(primaryPrice);

  const priceRow = (label, price, highlight) => {
    if (price == null) return '';
    const vnd = fmtVnd(price);
    return `<div class="price-row${highlight ? ' highlight' : ''}">
      <span class="price-row-label">${label}</span>
      <span class="price-row-value">${fmt(price)}${vnd ? `<span class="converted-price">${vnd}</span>` : ''}</span>
    </div>`;
  };

  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/tcgplayer.png')}" class="source-logo" alt="TCGPlayer">TCGPlayer</div>
        <a class="link-btn" href="${tcgplayerUrl}" target="_blank" rel="noopener">View →</a>
      </div>
      <div class="price-source-body">
        ${primaryPrice != null
          ? `<div class="price-primary"><div class="price-value">${fmt(primaryPrice)}</div><div class="price-value-label">${primaryLabel}</div>${vndPrimary ? `<div class="price-converted">${vndPrimary}</div>` : ''}</div>`
          : '<div class="price-sub not-found">No price found.</div>'}
        ${thumbHtml(tcgplayerPrice.imageUrl, fallbackImageUrl)}
      </div>
      <div class="price-rows">
        ${priceRow('Most Recent Sale', recentSale, true)}
        ${market != null ? priceRow('Listing Price', listing) : ''}
        ${(tcgplayerPrice.alternativePrices || []).map((alt) => priceRow(`Market Price (${alt.condition})`, alt.marketPrice)).join('')}
        ${(tcgplayerPrice.lowPrice != null || tcgplayerPrice.highPrice != null) ? `<div class="price-row"><span class="price-row-label">Range</span><span class="price-row-value">${fmt(tcgplayerPrice.lowPrice) || '-'} - ${fmt(tcgplayerPrice.highPrice) || '-'}</span></div>` : ''}
      </div>
      ${renderAlternativesList(allListings, { productUrl: tcgplayerUrl }, (l) => l.price != null ? `$${l.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'N/A')}
    </div>`;
}

function renderTcgplayerEmptyBlock(tcgplayerUrl) {
  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/tcgplayer.png')}" class="source-logo" alt="TCGPlayer">TCGPlayer</div>
        <a class="link-btn" href="${tcgplayerUrl}" target="_blank" rel="noopener">Search →</a>
      </div>
      <div class="price-sub not-found">No card found.</div>
    </div>`;
}

function renderPricechartingBlock(listing, rates, fallbackImageUrl, allListings) {
  const fmt = (v) => v != null ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : null;
  const fmtVnd = (v) => {
    if (v == null || !rates || !rates.USD) return null;
    return `≈ ₫${Math.ceil(v * rates.USD.VND).toLocaleString('vi-VN')} VND`;
  };

  const priceRow = (label, price, highlight) => {
    if (price == null) return '';
    const vnd = fmtVnd(price);
    return `<div class="price-row${highlight ? ' highlight' : ''}">
      <span class="price-row-label">${label}</span>
      <span class="price-row-value">${fmt(price)}${vnd ? `<span class="converted-price">${vnd}</span>` : ''}</span>
    </div>`;
  };

  const vndPrimary = fmtVnd(listing.ungradedPrice);

  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/pricecharting.png')}" class="source-logo" alt="PriceCharting">PriceCharting</div>
        <a class="link-btn" href="${listing.productUrl}" target="_blank" rel="noopener">View →</a>
      </div>
      <div class="price-source-body">
        ${listing.ungradedPrice != null
          ? `<div class="price-primary"><div class="price-value">${fmt(listing.ungradedPrice)}</div><div class="price-value-label">Ungraded</div>${vndPrimary ? `<div class="price-converted">${vndPrimary}</div>` : ''}</div>`
          : '<div class="price-sub not-found">No price.</div>'}
        ${thumbHtml(listing.imageUrl, fallbackImageUrl)}
      </div>
      <div class="price-rows">
        ${priceRow(`Recent Sale${listing.recentSaleDate ? ` (${listing.recentSaleDate})` : ''}`, listing.recentSalePrice, true)}
        ${priceRow('Grade 9', listing.grade9Price)}
        ${priceRow('Grade 10', listing.grade10Price)}
      </div>
      ${renderAlternativesList(allListings, listing, (l) => l.ungradedPrice != null ? `$${l.ungradedPrice.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'N/A')}
    </div>`;
}

function renderPricechartingEmptyBlock(searchUrl, cfChallenge) {
  const warning = cfChallenge
    ? '<div class="price-sub cf-warning">⚠️ Cloudflare challenge detected. Please verify in the opened PriceCharting window and scan again.</div>'
    : '';
  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/pricecharting.png')}" class="source-logo" alt="PriceCharting">PriceCharting</div>
        <a class="link-btn" href="${searchUrl}" target="_blank" rel="noopener">Search →</a>
      </div>
      <div class="price-sub not-found">No card found.</div>
      ${warning}
    </div>`;
}

function renderCollectrBlock(listing, alternativeListings, rates, fallbackImageUrl, allListings) {
  const fmt = (v) => v != null ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'N/A';
  const fmtVnd = (v) => (rates && rates.USD && v != null)
    ? `≈ ₫${Math.ceil(v * rates.USD.VND).toLocaleString('vi-VN')} VND`
    : null;
  const priceRow = (label, price) => {
    if (price == null) return '';
    const vnd = fmtVnd(price);
    return `<div class="price-row">
      <span class="price-row-label">${label}</span>
      <span class="price-row-value">${fmt(price)}${vnd ? `<span class="converted-price">${vnd}</span>` : ''}</span>
    </div>`;
  };
  const primaryPrice = listing.price;
  const vndPrimary = fmtVnd(primaryPrice);
  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/collectr.png')}" class="source-logo" alt="Collectr">Collectr</div>
        <a class="link-btn" href="${listing.productUrl}" target="_blank" rel="noopener">View →</a>
      </div>
      <div class="price-source-body">
        ${primaryPrice != null
          ? `<div class="price-primary"><div class="price-value">${fmt(primaryPrice)}</div><div class="price-value-label">${listing.condition || 'Normal'}</div>${vndPrimary ? `<div class="price-converted">${vndPrimary}</div>` : ''}</div>`
          : '<div class="price-sub not-found">No price found.</div>'}
        ${thumbHtml(listing.imageUrl, fallbackImageUrl)}
      </div>
      <div class="price-rows">
        ${(alternativeListings || []).filter((alt) => alt.price != null && alt.condition).map((alt) => priceRow(alt.condition, alt.price)).join('')}
      </div>
      ${renderAlternativesList(allListings, listing, (l) => l.price != null ? `$${l.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'N/A')}
    </div>`;
}

function renderCollectrEmptyBlock(searchUrl) {
  return `
    <div class="price-source">
      <div class="price-source-header">
        <div class="price-source-name"><img src="${chrome.runtime.getURL('assets/logos/collectr.png')}" class="source-logo" alt="Collectr">Collectr</div>
        <a class="link-btn" href="${searchUrl}" target="_blank" rel="noopener">Search →</a>
      </div>
      <div class="price-sub not-found">No card found.</div>
    </div>`;
}

const PROGRESS_GROUPS = [
  { id: 'api', title: 'API' },
  { id: 'market', title: 'Marketplaces' },
];

const PROGRESS_STEPS = [
  { id: 'tcgdex', label: 'TCGdex metadata', group: 'api' },
  { id: 'bulbapedia', label: 'Bulbapedia counterpart', group: 'api' },
  { id: 'cardrush', label: 'CardRush price', group: 'market' },
  { id: 'tcgplayer', label: 'TCGPlayer price', group: 'market' },
  { id: 'pricecharting', label: 'PriceCharting price', group: 'market' },
  { id: 'collectr', label: 'Collectr price', group: 'market' },
];

const PROGRESS_ICONS = {
  pending: '&#9675;',
  running: '&#8987;',
  done: '&#10003;',
  error: '&#10007;',
};

function renderProgressStep(step, state) {
  const status = (state && state.status) || 'pending';
  const icon = PROGRESS_ICONS[status] || PROGRESS_ICONS.pending;
  const detail = state && state.detail ? ` <span class="progress-detail">${state.detail}</span>` : '';
  return `<div class="progress-step progress-${status}"><span class="progress-icon">${icon}</span><span class="progress-text">${step.label}${detail}</span></div>`;
}

function renderProgressSteps(stepStates) {
  return PROGRESS_GROUPS.map((group) => {
    const steps = PROGRESS_STEPS
      .filter((step) => step.group === group.id)
      .map((step) => renderProgressStep(step, stepStates[step.id]))
      .join('');
    return `<div class="progress-column"><div class="progress-column-title">${group.title}</div>${steps}</div>`;
  }).join('');
}

// The total printed on the card ("2/83" -> 83) identifies the set, because
// each set prints its own official card count. Returns null when the read
// number has no numeric total.
function parsePrintedTotal(cardNumberFull) {
  if (!cardNumberFull || !cardNumberFull.includes('/')) return null;
  const total = parseInt(cardNumberFull.split('/')[1], 10);
  return Number.isFinite(total) ? total : null;
}

// CardRush is a Japanese marketplace, so it is only queried for Japanese
// scans with a resolvable set code. EN scans still reach the JP printing's
// prices through the JP Version section's Look Up Price button, which runs
// its own JA lookup.
function shouldQueryCardrush(isEnCard, resolvedSetCode) {
  return !isEnCard && !!resolvedSetCode;
}

// A printed number with a total ("60/108") is never a promo number, so it
// overrides a wrong Gemini isPromo flag that would drop the total.
function isPromoCardNumber(cardNumberFull, isPromo) {
  return cardNumberFull ? !cardNumberFull.includes('/') : isPromo === true;
}

// True when the text contains Japanese kana or kanji. Used to tell an English
// card name apart from the Japanese name Gemini or TCGdex returned, because
// only the former is usable in the EN marketplace queries (C5).
function hasJapaneseScript(text) {
  return typeof text === 'string' && /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/.test(text);
}

// Finds the English counterpart of a Japanese card: the direct printing Gemini
// reported first, then the TCGdex cross-version search. Returns null when
// nothing matches. Used both for the EN section and, for a Japanese card name,
// to resolve the name before the EN marketplace queries fire (C5).
async function findEnCounterpart(card, { cardNameEn, crossSetCode, crossCardNumber, crossSetName, rarityCode }) {
  if (crossSetCode && crossCardNumber) {
    const crossLocalId = crossCardNumber.split('/')[0];
    const directRes = await sendMessageSafely({
      type: MESSAGE_TYPES.FETCH_CARD_INFO,
      payload: { language: 'en', setCode: crossSetCode, localId: crossLocalId },
    });
    if (directRes.success && directRes.data) {
      if (validateCrossVersionMatch(card, directRes.data)) {
        console.log('[card-lookup] EN version found (direct):', directRes.data.id, '-', directRes.data.name);
        return directRes.data;
      }
      console.log('[card-lookup] EN direct lookup mismatch (dex/hp), falling back:', directRes.data.id, directRes.data.name, 'dexId:', directRes.data.dexId, 'hp:', directRes.data.hp);
    }
  }
  const enRes = await sendMessageSafely({
    type: MESSAGE_TYPES.FIND_EN_VERSION,
    payload: { cardNameEn, jpDexId: card.dexId || null, jpLocalId: card.localId || null, jpSetCode: card.set?.id || null, crossSetCode, crossSetName, jpHp: card.hp || null, jpRarity: rarityCode || null },
  });
  if (enRes.success) {
    console.log('[card-lookup] EN version found (search):', enRes.data.id, '-', enRes.data.name);
    return enRes.data;
  }
  console.log('[card-lookup] EN version not found:', enRes.error);
  return null;
}

// Phase 6: the reviewed index relationship outranks the pipeline's
// cross-version search, which can match a different printing. Returns the
// chosen card plus whether a pipeline result was overridden.
function selectCrossVersionCard(indexedCard, pipelineCard) {
  if (!indexedCard) return { card: pipelineCard || null, overrode: false };
  if (!pipelineCard) return { card: indexedCard, overrode: false };
  return { card: indexedCard, overrode: pipelineCard.id !== indexedCard.id };
}

// Returns the TCGdex set/local id the index knows for an EN source, so the
// source fetch uses the reviewed set instead of the printed code the model may
// have misread.
function getIndexedSourceCorrection(resolution, language) {
  if (language !== 'en' || !resolution || resolution.status !== 'hit') return null;
  const source = resolution.record && resolution.record.source;
  if (!source || !source.tcgdexSetId || !source.localId) return null;
  return { setCode: source.tcgdexSetId, localId: source.localId, setName: source.setName || null };
}

// Builds a TCGdex-shaped card object from a Bulbapedia JA target so the
// cross-version section can render the exact JP printing even though TCGdex
// has no metadata for it. The set card count is derived from the target's
// printed number so the Look Up Price button keeps the full "072/069" form.
function buildBulbapediaJpVersion(target) {
  // No local id means the index knows the Japanese set but not the card number,
  // so there is no printing to render and no number to query with.
  if (!target.localId) return null;
  const total = (target.cardNumber || '').split('/')[1];
  const official = total ? parseInt(total, 10) : null;
  return {
    id: `${target.setCode}-${target.localId}`,
    name: target.japaneseName || target.cardName || `${target.setCode} ${target.localId}`,
    englishName: target.cardName || null,
    localId: target.localId,
    set: {
      id: target.setCode,
      name: target.setName,
      ...(official ? { cardCount: { official } } : {}),
    },
    image: null,
    rarity: target.rarity || null,
    // C6: null when TCGdex has no JA card for this printing, which lets the
    // Look Up Price button skip the guaranteed-to-fail TCGdex fetch.
    tcgdexSetId: target.tcgdexSetId || null,
    // Deck printings have no printed set code, so the Look Up Price button has
    // to query CardRush by the Japanese card name.
    printsNoSetCode: target.printsNoSetCode === true,
  };
}

// C6: the JP section's Look Up Price can skip the TCGdex set-code brute force
// when the printing came from the index and TCGdex has no JA card for it
// (BW, HGSS, XY, most of SWSH). Eras whose JA targets carry a TCGdex set id
// (SM, SV, M) still fetch, because the fetch succeeds and adds card metadata.
function shouldSkipJpTcgdexLookup(provenance, jpVersion) {
  return provenance === 'index' && !!jpVersion && !jpVersion.tcgdexSetId;
}

// C1: image for the JP section. The index-synthesized printing carries no
// image, so fall back to the JA TCGdex card the validation fetch returned
// (available for SV/SM/M, whose JA targets have a TCGdex set id). Eras without
// JA artwork stay empty and are filled by the Look Up Price flow instead.
function resolveJpVersionImage(jpVersion, report) {
  if (jpVersion && jpVersion.image) return `${jpVersion.image}/high.webp`;
  const validatedCard = report && report.validatedCard;
  return validatedCard && validatedCard.image ? `${validatedCard.image}/high.webp` : '';
}

// C1: image for the JP section after its Look Up Price runs. CardRush is the JP
// source, so prefer its listing image; when CardRush has no listing, fall back
// to the image of whichever other marketplace returned a result. Placeholder
// data URLs are ignored.
function pickCrossVersionResultImage(result) {
  if (!result) return null;
  const candidates = [
    result.bestListing ? result.bestListing.imageUrl : null,
    result.collectrListing ? result.collectrListing.imageUrl : null,
    result.tcgplayerPrice ? result.tcgplayerPrice.imageUrl : null,
    result.pricechartingListing ? result.pricechartingListing.imageUrl : null,
  ];
  const isPlaceholder = (url) => !url || url.startsWith('data:image/gif') || url.startsWith('data:image/png');
  return candidates.find((url) => !isPlaceholder(url)) || null;
}

/**
 * Validates whether a candidate card is a valid cross-language counterpart
 * for the source card by comparing dexId and HP.
 *
 * Rules:
 * - If source has dexId, candidate MUST also have dexId and at least one must match.
 * - If source has no dexId, dexId check passes (cannot verify).
 * - If source has HP, candidate MUST also have HP and it must match.
 * - If source has no HP, HP check passes (cannot verify).
 *
 * This prevents accepting a trainer card (no dexId/HP) when the source is a
 * Pokemon card, and prevents matching a normal Pokemon to its ex/V/VMAX variant.
 *
 * @param {object} sourceCard - the original card (has dexId, hp)
 * @param {object} candidateCard - the cross-language candidate (has dexId, hp)
 * @returns {boolean} true if the candidate is a valid counterpart
 */
function validateCrossVersionMatch(sourceCard, candidateCard) {
  const sourceDexId = sourceCard.dexId || [];
  const candidateDexId = candidateCard.dexId || [];
  const dexMatch = sourceDexId.length > 0
    ? candidateDexId.length > 0 && sourceDexId.some((d) => candidateDexId.includes(d))
    : true;
  const hpMatch = sourceCard.hp != null
    ? candidateCard.hp != null && sourceCard.hp === candidateCard.hp
    : true;
  return dexMatch && hpMatch;
}

// Exported for test environments (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateCrossVersionMatch,
    pickListingByLocalId,
    shouldSkipJpTcgdexLookup,
    hasJapaneseScript,
    resolveJpVersionImage,
    pickCrossVersionResultImage,
    extractTcgplayerPrice,
  };
}
