// Picks which marketplace listing a scan refers to, shared by the scanner and the
// service worker.
//
// The scanner picks with it to decide whose price to show, and the worker picks
// with it to decide whose product detail page to open. Both must agree: when the
// worker enriched the first listing while the scanner picked a later one, the
// detail page it had already opened went unused and the picked printing showed
// "Listing Price" instead of "Market Price".
//
// Pure logic, no Chrome APIs. `normalizeBulbapediaCardName` (lib/bulbapedia-resolver.js)
// sharpens the name comparison and is optional: without it the number is the only
// signal, which is how the worker ran before this file existed.

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
