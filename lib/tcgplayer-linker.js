// Builds a TCGPlayer search URL for English cards. Link-only — no scraping.
// Depends on constants.js (TCGPLAYER_SEARCH_URL).

function buildTcgplayerUrl(cardNameEn) {
  return `${TCGPLAYER_SEARCH_URL}?q=${encodeURIComponent(cardNameEn)}&productLineName=pokemon`;
}
