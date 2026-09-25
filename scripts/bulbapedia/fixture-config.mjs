const BULBAPEDIA_API_URL = 'https://bulbapedia.bulbagarden.net/w/api.php';
const BULBAPEDIA_PAGE_FIXTURES = [
  { fileName: 'dark-explorers-set.json', kind: 'set', pageTitle: 'Dark Explorers (TCG)' },
  { fileName: 'darkrai-ex.json', kind: 'card', pageTitle: 'Darkrai-EX (Dark Explorers 63)' },
  { fileName: 'professor-juniper.json', kind: 'card', pageTitle: 'Professor Juniper (Black & White 101)' },
  { fileName: 'ex-battle-boost-redirect.json', kind: 'redirect', pageTitle: 'EX Battle Boost (TCG)' },
];
const EXTRA_PAGE_FIXTURES = [
  { fileName: 'blend-energy-grpd.json', kind: 'card', pageTitle: 'Blend Energy GRPD (Dragons Exalted 117)' },
  { fileName: 'plasma-energy.json', kind: 'card', pageTitle: 'Plasma Energy (Plasma Storm 127)' },
  // Mega printings carry their prefix only in the page title, not in cardname.
  { fileName: 'm-houndoom-ex.json', kind: 'card', pageTitle: 'M Houndoom-EX (BREAKthrough 22)' },
];
const TCGDEX_SET_FIXTURE = {
  fileName: 'en-sets.json',
  language: 'en',
  url: 'https://api.tcgdex.net/v2/en/sets',
};
// JA sets carry their own TCGdex ids (e.g. L1a, XY1a). Target validation must
// accept them, so the generator checks both set lists.
const TCGDEX_JA_SET_FIXTURE = {
  fileName: 'ja-sets.json',
  language: 'ja',
  url: 'https://api.tcgdex.net/v2/ja/sets',
};

export {
  BULBAPEDIA_API_URL,
  BULBAPEDIA_PAGE_FIXTURES,
  EXTRA_PAGE_FIXTURES,
  TCGDEX_JA_SET_FIXTURE,
  TCGDEX_SET_FIXTURE,
};
