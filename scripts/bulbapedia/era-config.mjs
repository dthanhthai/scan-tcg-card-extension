import {
  BW_CRAWL_BATCH_SIZE,
  BW_CRAWL_DELAY_MS,
  BW_CRAWL_MAX_RETRIES,
  BW_SET_CATEGORIES,
} from './bw-config.mjs';

const DEFAULT_CRAWL_BATCH_SIZE = 20;
const DEFAULT_CRAWL_DELAY_MS = 150;
const DEFAULT_CRAWL_MAX_RETRIES = 2;

const HGSS_SET_CATEGORIES = [
  { categoryTitle: 'Category:HeartGold Collection cards', jpSetCode: 'L1a', setName: 'HeartGold Collection' },
  { categoryTitle: 'Category:SoulSilver Collection cards', jpSetCode: 'L1b', setName: 'SoulSilver Collection' },
  { categoryTitle: 'Category:Reviving Legends cards', jpSetCode: 'L2', setName: 'Reviving Legends' },
  { categoryTitle: 'Category:Lost Link cards', jpSetCode: 'LL', setName: 'Lost Link' },
  { categoryTitle: 'Category:Clash at the Summit cards', jpSetCode: 'L3', setName: 'Clash at the Summit' },
  { categoryTitle: 'Category:L-P Promotional cards', jpSetCode: 'L-P', setName: 'L-P Promotional cards' },
];

const XY_SET_CATEGORIES = [
  { categoryTitle: 'Category:Collection X cards', jpSetCode: 'XY1a', setName: 'Collection X' },
  { categoryTitle: 'Category:Collection Y cards', jpSetCode: 'XY1b', setName: 'Collection Y' },
  { categoryTitle: 'Category:Wild Blaze cards', jpSetCode: 'XY2', setName: 'Wild Blaze' },
  { categoryTitle: 'Category:Rising Fist cards', jpSetCode: 'XY3', setName: 'Rising Fist' },
  { categoryTitle: 'Category:Phantom Gate cards', jpSetCode: 'XY4', setName: 'Phantom Gate' },
  { categoryTitle: 'Category:Gaia Volcano cards', jpSetCode: 'XY5a', setName: 'Gaia Volcano' },
  { categoryTitle: 'Category:Tidal Storm cards', jpSetCode: 'XY5b', setName: 'Tidal Storm' },
  { categoryTitle: 'Category:Emerald Break cards', jpSetCode: 'XY6', setName: 'Emerald Break' },
  { categoryTitle: 'Category:Bandit Ring cards', jpSetCode: 'XY7', setName: 'Bandit Ring' },
  { categoryTitle: 'Category:Blue Shock cards', jpSetCode: 'XY8a', setName: 'Blue Shock' },
  { categoryTitle: 'Category:Red Flash cards', jpSetCode: 'XY8b', setName: 'Red Flash' },
  { categoryTitle: 'Category:Rage of the Broken Heavens cards', jpSetCode: 'XY9', setName: 'Rage of the Broken Heavens' },
  { categoryTitle: 'Category:Awakening Psychic King cards', jpSetCode: 'XY10', setName: 'Awakening Psychic King' },
  { categoryTitle: 'Category:Fever-Burst Fighter cards', jpSetCode: 'XY11a', setName: 'Fever-Burst Fighter' },
  { categoryTitle: 'Category:Cruel Traitor cards', jpSetCode: 'XY11b', setName: 'Cruel Traitor' },
  { categoryTitle: 'Category:Expansion Pack 20th Anniversary cards', jpSetCode: 'CP6', setName: 'Expansion Pack 20th Anniversary' },
  // Deck product: its cards carry no printed set code, so the CardRush keyword
  // has to use the Japanese card name instead (see printsNoSetCode).
  { categoryTitle: 'Category:BREAK Starter Pack cards', jpSetCode: 'BREAK', setName: 'BREAK Starter Pack' },
  { categoryTitle: 'Category:Legendary Shine Collection cards', jpSetCode: 'CP2', setName: 'Legendary Shine Collection' },
  { categoryTitle: 'Category:PokéKyun Collection cards', jpSetCode: 'CP3', setName: 'PokéKyun Collection' },
  { categoryTitle: 'Category:XY-P Promotional cards', jpSetCode: 'XY-P', setName: 'XY-P Promotional cards' },
];

// The DP era is crawled from its English categories, unlike the other eras:
// Bulbapedia's DP card pages carry both printings (expansion + jpexpansion) and
// TCGdex has no Japanese DP sets at all. The `setName` below is the Japanese
// set the English category pairs with, because the generator's per-era printing
// filter keys on `ja.setName`; the English name lives in SET_CATALOG.en.
const DP_SET_CATEGORIES = [
  { categoryTitle: 'Category:Diamond & Pearl cards', jpSetCode: 'DP1', setName: 'Space-Time Creation' },
  { categoryTitle: 'Category:Mysterious Treasures cards', jpSetCode: 'DP2', setName: 'Secret of the Lakes' },
  { categoryTitle: 'Category:Secret Wonders cards', jpSetCode: 'DP3', setName: 'Shining Darkness' },
  { categoryTitle: 'Category:Great Encounters cards', jpSetCode: 'DP4', setName: 'Dawn Dash' },
  { categoryTitle: 'Category:Majestic Dawn cards', jpSetCode: 'DP4', setName: 'Moonlit Pursuit' },
  { categoryTitle: 'Category:Legends Awakened cards', jpSetCode: 'DP5', setName: 'Cry from the Mysterious' },
  { categoryTitle: 'Category:Stormfront cards', jpSetCode: 'DP6', setName: 'Intense Fight in the Destroyed Sky' },
  { categoryTitle: 'Category:Platinum cards', jpSetCode: 'DPt1', setName: "Galactic's Conquest" },
  { categoryTitle: 'Category:Rising Rivals cards', jpSetCode: 'DPt2', setName: 'Bonds to the End of Time' },
  { categoryTitle: 'Category:Supreme Victors cards', jpSetCode: 'DPt3', setName: 'Beat of the Frontier' },
  { categoryTitle: 'Category:Arceus cards', jpSetCode: 'DPt4', setName: 'Advent of Arceus' },
  { categoryTitle: 'Category:DP Black Star Promotional cards', jpSetCode: 'DP-P', setName: 'DP-P Promotional cards' },
  // Second Japanese promo set: its printings appear on the Platinum-era pages
  // above, and the filter drops any printing whose set name is not listed here.
  { categoryTitle: 'Category:DPt-P Promotional cards', jpSetCode: 'DPt-P', setName: 'DPt-P Promotional cards' },
];

const SM_SET_CATEGORIES = [
  { categoryTitle: 'Category:Collection Sun cards', jpSetCode: 'SM1S', setName: 'Collection Sun' },
  { categoryTitle: 'Category:Collection Moon cards', jpSetCode: 'SM1M', setName: 'Collection Moon' },
  { categoryTitle: 'Category:Enhanced Expansion Pack Sun & Moon cards', jpSetCode: 'SM1+', setName: 'Enhanced Expansion Pack Sun & Moon' },
  // Deck product: its cards carry no printed set code, so the CardRush keyword
  // has to use the Japanese card name instead (see printsNoSetCode).
  { categoryTitle: 'Category:Sun & Moon Starter Set cards', jpSetCode: 'SM1D', setName: 'Sun & Moon Starter Set' },
  { categoryTitle: 'Category:Islands Await You cards', jpSetCode: 'SM2K', setName: 'Islands Await You' },
  { categoryTitle: 'Category:Alolan Moonlight cards', jpSetCode: 'SM2L', setName: 'Alolan Moonlight' },
  { categoryTitle: 'Category:To Have Seen the Battle Rainbow cards', jpSetCode: 'SM3H', setName: 'To Have Seen the Battle Rainbow' },
  { categoryTitle: 'Category:Darkness that Consumes Light cards', jpSetCode: 'SM3N', setName: 'Darkness that Consumes Light' },
  { categoryTitle: 'Category:Shining Legends cards', jpSetCode: 'SM3+', setName: 'Shining Legends' },
  { categoryTitle: 'Category:Awakened Heroes cards', jpSetCode: 'SM4S', setName: 'Awakened Heroes' },
  { categoryTitle: 'Category:Ultradimensional Beasts cards', jpSetCode: 'SM4A', setName: 'Ultradimensional Beasts' },
  { categoryTitle: 'Category:GX Battle Boost cards', jpSetCode: 'SM4+', setName: 'GX Battle Boost' },
  { categoryTitle: 'Category:Ultra Force cards', jpSetCode: 'SM5+', setName: 'Ultra Force' },
  { categoryTitle: 'Category:Ultra Sun cards', jpSetCode: 'SM5S', setName: 'Ultra Sun' },
  { categoryTitle: 'Category:Ultra Moon cards', jpSetCode: 'SM5M', setName: 'Ultra Moon' },
  { categoryTitle: 'Category:Forbidden Light cards', jpSetCode: 'SM6', setName: 'Forbidden Light' },
  { categoryTitle: 'Category:Dragon Storm cards', jpSetCode: 'SM6a', setName: 'Dragon Storm' },
  { categoryTitle: 'Category:Champion Road cards', jpSetCode: 'SM6b', setName: 'Champion Road' },
  { categoryTitle: 'Category:Sky-Splitting Charisma cards', jpSetCode: 'SM7', setName: 'Sky-Splitting Charisma' },
  { categoryTitle: 'Category:Thunderclap Spark cards', jpSetCode: 'SM7a', setName: 'Thunderclap Spark' },
  { categoryTitle: 'Category:Fairy Rise cards', jpSetCode: 'SM7b', setName: 'Fairy Rise' },
  { categoryTitle: 'Category:Super-Burst Impact cards', jpSetCode: 'SM8', setName: 'Super-Burst Impact' },
  { categoryTitle: 'Category:Dark Order cards', jpSetCode: 'SM8a', setName: 'Dark Order' },
  { categoryTitle: 'Category:GX Ultra Shiny cards', jpSetCode: 'SM8b', setName: 'GX Ultra Shiny' },
  { categoryTitle: 'Category:Tag Bolt cards', jpSetCode: 'SM9', setName: 'Tag Bolt' },
  { categoryTitle: 'Category:Night Unison cards', jpSetCode: 'SM9a', setName: 'Night Unison' },
  { categoryTitle: 'Category:Full Metal Wall cards', jpSetCode: 'SM9b', setName: 'Full Metal Wall' },
  { categoryTitle: 'Category:Double Blaze cards', jpSetCode: 'SM10', setName: 'Double Blaze' },
  { categoryTitle: 'Category:GG End cards', jpSetCode: 'SM10a', setName: 'GG End' },
  { categoryTitle: 'Category:Sky Legend cards', jpSetCode: 'SM10b', setName: 'Sky Legend' },
  { categoryTitle: 'Category:Miracle Twin cards', jpSetCode: 'SM11', setName: 'Miracle Twin' },
  { categoryTitle: 'Category:Remix Bout cards', jpSetCode: 'SM11a', setName: 'Remix Bout' },
  { categoryTitle: 'Category:Dream League cards', jpSetCode: 'SM11b', setName: 'Dream League' },
  { categoryTitle: 'Category:Alter Genesis cards', jpSetCode: 'SM12', setName: 'Alter Genesis' },
  { categoryTitle: 'Category:Tag All Stars cards', jpSetCode: 'SM12a', setName: 'Tag All Stars' },
  { categoryTitle: 'Category:SM-P Promotional cards', jpSetCode: 'SM-P', setName: 'SM-P Promotional cards' },
  { categoryTitle: 'Category:Facing a New Trial cards', jpSetCode: 'SM2p', setName: 'Facing a New Trial' },
  { categoryTitle: 'Category:Detective Pikachu cards', jpSetCode: 'SMP2', setName: 'Detective Pikachu' },
  // English categories, same reason as the SV era below: a page only joins a
  // Japanese set category when its JP printing is that expansion, so cards whose
  // JP printing is a deck are invisible to the crawl (60 pages here, mostly
  // Hidden Fates pairing with the Sun & Moon Family Pokémon Card Game).
  { categoryTitle: 'Category:Hidden Fates cards', jpSetCode: 'SM8b', setName: 'GX Ultra Shiny' },
  { categoryTitle: 'Category:Unified Minds cards', jpSetCode: 'SM11', setName: 'Miracle Twin' },
  { categoryTitle: 'Category:Guardians Rising cards', jpSetCode: 'SM2K', setName: 'Islands Await You' },
  { categoryTitle: 'Category:Cosmic Eclipse cards', jpSetCode: 'SM12', setName: 'Alter Genesis' },
];

const SWSH_SET_CATEGORIES = [
  { categoryTitle: 'Category:Sword cards', jpSetCode: 'S1W', setName: 'Sword' },
  { categoryTitle: 'Category:Shield cards', jpSetCode: 'S1H', setName: 'Shield' },
  { categoryTitle: 'Category:VMAX Rising cards', jpSetCode: 'S1a', setName: 'VMAX Rising' },
  { categoryTitle: 'Category:Rebellion Crash cards', jpSetCode: 'S2', setName: 'Rebellion Crash' },
  { categoryTitle: 'Category:Explosive Walker cards', jpSetCode: 'S2a', setName: 'Explosive Walker' },
  { categoryTitle: 'Category:Infinity Zone cards', jpSetCode: 'S3', setName: 'Infinity Zone' },
  { categoryTitle: 'Category:Legendary Heartbeat cards', jpSetCode: 'S3a', setName: 'Legendary Heartbeat' },
  { categoryTitle: 'Category:Amazing Volt Tackle cards', jpSetCode: 'S4', setName: 'Amazing Volt Tackle' },
  { categoryTitle: 'Category:Shiny Star V cards', jpSetCode: 'S4a', setName: 'Shiny Star V' },
  { categoryTitle: 'Category:Peerless Fighters cards', jpSetCode: 'S5a', setName: 'Peerless Fighters' },
  { categoryTitle: 'Category:Single Strike Master cards', jpSetCode: 'S5I', setName: 'Single Strike Master' },
  { categoryTitle: 'Category:Rapid Strike Master cards', jpSetCode: 'S5R', setName: 'Rapid Strike Master' },
  { categoryTitle: 'Category:Silver Lance cards', jpSetCode: 'S6H', setName: 'Silver Lance' },
  { categoryTitle: 'Category:Jet-Black Spirit cards', jpSetCode: 'S6K', setName: 'Jet-Black Spirit' },
  { categoryTitle: 'Category:Eevee Heroes cards', jpSetCode: 'S6a', setName: 'Eevee Heroes' },
  { categoryTitle: 'Category:Skyscraping Perfection cards', jpSetCode: 'S7D', setName: 'Skyscraping Perfection' },
  { categoryTitle: 'Category:Blue Sky Stream cards', jpSetCode: 'S7R', setName: 'Blue Sky Stream' },
  { categoryTitle: 'Category:Fusion Arts cards', jpSetCode: 'S8', setName: 'Fusion Arts' },
  { categoryTitle: 'Category:25th Anniversary Collection cards', jpSetCode: 'S8a', setName: '25th Anniversary Collection' },
  { categoryTitle: 'Category:VMAX Climax cards', jpSetCode: 'S8b', setName: 'VMAX Climax' },
  { categoryTitle: 'Category:Star Birth cards', jpSetCode: 'S9', setName: 'Star Birth' },
  { categoryTitle: 'Category:Battle Region cards', jpSetCode: 'S9a', setName: 'Battle Region' },
  { categoryTitle: 'Category:Time Gazer cards', jpSetCode: 'S10D', setName: 'Time Gazer' },
  { categoryTitle: 'Category:Space Juggler cards', jpSetCode: 'S10P', setName: 'Space Juggler' },
  { categoryTitle: 'Category:Dark Phantasma cards', jpSetCode: 'S10a', setName: 'Dark Phantasma' },
  { categoryTitle: 'Category:Pokémon GO cards', jpSetCode: 'S10b', setName: 'Pokémon GO' },
  { categoryTitle: 'Category:Lost Abyss cards', jpSetCode: 'S11', setName: 'Lost Abyss' },
  { categoryTitle: 'Category:Incandescent Arcana cards', jpSetCode: 'S11a', setName: 'Incandescent Arcana' },
  { categoryTitle: 'Category:Paradigm Trigger cards', jpSetCode: 'S12', setName: 'Paradigm Trigger' },
  { categoryTitle: 'Category:VSTAR Universe cards', jpSetCode: 'S12a', setName: 'VSTAR Universe' },
  { categoryTitle: 'Category:S-P Promotional cards', jpSetCode: 'S-P', setName: 'S-P Promotional cards' },
  // English categories: 221 pages pair with a deck or another product instead of
  // the expansion the era crawls (see the SV era for the full explanation).
  { categoryTitle: 'Category:Sword & Shield cards', jpSetCode: 'S1W', setName: 'Sword' },
  { categoryTitle: 'Category:Fusion Strike cards', jpSetCode: 'S8', setName: 'Fusion Arts' },
  { categoryTitle: 'Category:Brilliant Stars cards', jpSetCode: 'S9', setName: 'Star Birth' },
  { categoryTitle: "Category:Champion's Path cards", jpSetCode: 'S3', setName: 'Infinity Zone' },
  { categoryTitle: 'Category:Shining Fates cards', jpSetCode: 'S4a', setName: 'Shiny Star V' },
  { categoryTitle: 'Category:Crown Zenith cards', jpSetCode: 'S12a', setName: 'VSTAR Universe' },
  { categoryTitle: 'Category:Darkness Ablaze cards', jpSetCode: 'S2', setName: 'Rebellion Crash' },
  { categoryTitle: 'Category:Lost Origin cards', jpSetCode: 'S11', setName: 'Lost Abyss' },
  { categoryTitle: 'Category:Astral Radiance cards', jpSetCode: 'S10D', setName: 'Time Gazer' },
  { categoryTitle: 'Category:Evolving Skies cards', jpSetCode: 'S7D', setName: 'Skyscraping Perfection' },
  { categoryTitle: 'Category:Rebel Clash cards', jpSetCode: 'S1a', setName: 'VMAX Rising' },
];

const SV_SET_CATEGORIES = [
  { categoryTitle: 'Category:Scarlet ex cards', jpSetCode: 'SV1S', setName: 'Scarlet ex' },
  { categoryTitle: 'Category:Violet ex cards', jpSetCode: 'SV1V', setName: 'Violet ex' },
  { categoryTitle: 'Category:Triplet Beat cards', jpSetCode: 'SV1a', setName: 'Triplet Beat' },
  { categoryTitle: 'Category:Snow Hazard cards', jpSetCode: 'SV2P', setName: 'Snow Hazard' },
  { categoryTitle: 'Category:Clay Burst cards', jpSetCode: 'SV2D', setName: 'Clay Burst' },
  { categoryTitle: 'Category:Pokémon Card 151 cards', jpSetCode: 'SV2a', setName: 'Pokémon Card 151' },
  { categoryTitle: 'Category:Ruler of the Black Flame cards', jpSetCode: 'SV3', setName: 'Ruler of the Black Flame' },
  { categoryTitle: 'Category:Raging Surf cards', jpSetCode: 'SV3a', setName: 'Raging Surf' },
  { categoryTitle: 'Category:Ancient Roar cards', jpSetCode: 'SV4K', setName: 'Ancient Roar' },
  { categoryTitle: 'Category:Future Flash cards', jpSetCode: 'SV4M', setName: 'Future Flash' },
  { categoryTitle: 'Category:Shiny Treasure ex cards', jpSetCode: 'SV4a', setName: 'Shiny Treasure ex' },
  { categoryTitle: 'Category:Cyber Judge cards', jpSetCode: 'SV5M', setName: 'Cyber Judge' },
  { categoryTitle: 'Category:Wild Force cards', jpSetCode: 'SV5K', setName: 'Wild Force' },
  { categoryTitle: 'Category:Crimson Haze cards', jpSetCode: 'SV5a', setName: 'Crimson Haze' },
  { categoryTitle: 'Category:Transformation Mask cards', jpSetCode: 'SV6', setName: 'Transformation Mask' },
  { categoryTitle: 'Category:Night Wanderer cards', jpSetCode: 'SV6a', setName: 'Night Wanderer' },
  { categoryTitle: 'Category:Stellar Miracle cards', jpSetCode: 'SV7', setName: 'Stellar Miracle' },
  { categoryTitle: 'Category:Paradise Dragona cards', jpSetCode: 'SV7a', setName: 'Paradise Dragona' },
  { categoryTitle: 'Category:Super Electric Breaker cards', jpSetCode: 'SV8', setName: 'Super Electric Breaker' },
  { categoryTitle: 'Category:Terastal Fest ex cards', jpSetCode: 'SV8a', setName: 'Terastal Fest ex' },
  { categoryTitle: 'Category:Battle Partners cards', jpSetCode: 'SV9', setName: 'Battle Partners' },
  { categoryTitle: 'Category:Hot Wind Arena cards', jpSetCode: 'SV9a', setName: 'Hot Wind Arena' },
  { categoryTitle: 'Category:Glory of the Rocket Gang cards', jpSetCode: 'SV10', setName: 'Glory of the Rocket Gang' },
  { categoryTitle: 'Category:Black Bolt cards', jpSetCode: 'SV11B', setName: 'Black Bolt' },
  { categoryTitle: 'Category:White Flare cards', jpSetCode: 'SV11W', setName: 'White Flare' },
  { categoryTitle: 'Category:SV-P Promotional cards', jpSetCode: 'SV-P', setName: 'SV-P Promotional cards' },
  // English categories as well: a Bulbapedia page only joins a Japanese set
  // category when its JP printing is that expansion, so every English card whose
  // JP printing is a deck or another product was invisible to the crawl (273
  // pages across these sets, measured 2026-09-23 - `Journey Together 6/159` is
  // one). The `setName` is the primary Japanese counterpart for documentation;
  // the filter's set-name union already carries the sibling sets from the JP
  // entries above, and the deck products themselves live in SET_CATALOG.ja.
  { categoryTitle: 'Category:Journey Together cards', jpSetCode: 'SV9', setName: 'Battle Partners' },
  { categoryTitle: 'Category:Obsidian Flames cards', jpSetCode: 'SV3', setName: 'Ruler of the Black Flame' },
  { categoryTitle: 'Category:Prismatic Evolutions cards', jpSetCode: 'SV8a', setName: 'Terastal Fest ex' },
  { categoryTitle: 'Category:Stellar Crown cards', jpSetCode: 'SV7', setName: 'Stellar Miracle' },
  { categoryTitle: 'Category:Scarlet & Violet cards', jpSetCode: 'SV1S', setName: 'Scarlet ex' },
  { categoryTitle: 'Category:Temporal Forces cards', jpSetCode: 'SV5K', setName: 'Wild Force' },
  { categoryTitle: 'Category:Destined Rivals cards', jpSetCode: 'SV10', setName: 'Glory of the Rocket Gang' },
  { categoryTitle: 'Category:Surging Sparks cards', jpSetCode: 'SV8', setName: 'Super Electric Breaker' },
  { categoryTitle: 'Category:Paldea Evolved cards', jpSetCode: 'SV1a', setName: 'Triplet Beat' },
  { categoryTitle: 'Category:Paldean Fates cards', jpSetCode: 'SV4a', setName: 'Shiny Treasure ex' },
  { categoryTitle: 'Category:Paradox Rift cards', jpSetCode: 'SV4K', setName: 'Ancient Roar' },
  { categoryTitle: 'Category:Twilight Masquerade cards', jpSetCode: 'SV5a', setName: 'Crimson Haze' },
];

const M_SET_CATEGORIES = [
  { categoryTitle: 'Category:Mega Brave cards', jpSetCode: 'M1L', setName: 'Mega Brave' },
  { categoryTitle: 'Category:Mega Symphonia cards', jpSetCode: 'M1S', setName: 'Mega Symphonia' },
  { categoryTitle: 'Category:Inferno X cards', jpSetCode: 'M2', setName: 'Inferno X' },
  { categoryTitle: 'Category:MEGA Dream ex cards', jpSetCode: 'M2a', setName: 'MEGA Dream ex' },
  { categoryTitle: 'Category:Nihil Zero cards', jpSetCode: 'M3', setName: 'Nihil Zero' },
  { categoryTitle: 'Category:Ninja Spinner cards', jpSetCode: 'M4', setName: 'Ninja Spinner' },
  { categoryTitle: 'Category:Abyss Eye cards', jpSetCode: 'M5', setName: 'Abyss Eye' },
  { categoryTitle: 'Category:Storm Emeralda cards', jpSetCode: 'M6', setName: 'Storm Emeralda' },
  { categoryTitle: 'Category:M-P Promotional cards', jpSetCode: 'M-P', setName: 'M-P Promotional cards' },
  // English categories: 101 pages pair with a deck or another product instead of
  // the expansion the era crawls (see the SV era for the full explanation).
  { categoryTitle: 'Category:Ascended Heroes cards', jpSetCode: 'M2a', setName: 'MEGA Dream ex' },
  { categoryTitle: 'Category:Phantasmal Flames cards', jpSetCode: 'M2', setName: 'Inferno X' },
  { categoryTitle: 'Category:Perfect Order cards', jpSetCode: 'M3', setName: 'Nihil Zero' },
  { categoryTitle: 'Category:Mega Evolution cards', jpSetCode: 'M1L', setName: 'Mega Brave' },
];

const ERA_CONFIGS = {
  bw: {
    id: 'bw',
    setCategories: BW_SET_CATEGORIES,
    crawlBatchSize: BW_CRAWL_BATCH_SIZE,
    crawlDelayMs: BW_CRAWL_DELAY_MS,
    crawlMaxRetries: BW_CRAWL_MAX_RETRIES,
  },
  dp: {
    id: 'dp',
    setCategories: DP_SET_CATEGORIES,
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
  hgss: {
    id: 'hgss',
    setCategories: HGSS_SET_CATEGORIES,
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
  xy: {
    id: 'xy',
    setCategories: XY_SET_CATEGORIES,
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
  m: {
    id: 'm',
    setCategories: M_SET_CATEGORIES,
    // Deck products reached through the English categories above; see the SV era
    // for why `filterSourcesBySetNames` needs their names listed explicitly.
    extraSetNames: [
      'MEGA Starter Set Mega Gengar ex',
      'MEGA Starter Set Mega Diancie ex',
      'GX Starter Decks',
      'V Starter Sets',
      'V Starter Decks',
      'Battle Strength Decks',
      'Battle Starter Decks',
      'National Beginning Set',
      'Gift Box DPt',
      'Battle Gift Set: Thundurus vs Tornadus',
      'Start Deck 100 CoroCoro Comic Version',
      'Generations Start Decks',
      'XY Beginning Set',
    ],
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
  sv: {
    id: 'sv',
    setCategories: SV_SET_CATEGORIES,
    // Japanese deck products whose cards arrive through the English categories
    // above. `filterSourcesBySetNames` keeps a printing only when its Japanese
    // set name is listed, and a deck has no category of its own here, so its
    // name has to be listed explicitly or every such printing is dropped (the
    // first attempt at the English categories produced zero new records for
    // exactly this reason). Only the products that are in SET_CATALOG.ja are
    // listed; the rest would be inert anyway.
    extraSetNames: [
      'Start Deck 100 Battle Collection',
      'Start Deck 100 Battle Collection CoroCiao Version',
      'Start Deck 100',
      'ex Start Decks',
      'ex Starter Sets',
      'Pokémon Card Game Battle Academy',
      'Stellar Tera Type Starter Sets',
      'Terastal Starter Set Mewtwo ex',
      'Terastal Starter Set Skeledirge ex',
      "ex Starter Set Marnie's Morpeko & Grimmsnarl ex",
      'ex Starter Set Pikachu ex & Pawmot',
      "ex Starter Set Steven's Beldum & Metagross ex",
      'Ancient Koraidon ex Starter Deck & Build Set',
      'Future Miraidon ex Starter Deck & Build Set',
      'Generations Start Deck Zacian ex & Alcremie ex',
      'Generations Start Deck Reshiram ex & Amoonguss ex',
      'Generations Start Deck Tapu Koko ex & Mimikyu ex',
      'Generations Start Deck Koraidon ex & Paldean Clodsire ex',
      'Generations Start Deck Xerneas ex & Noivern ex',
      'Generations Start Deck Dialga ex & Lucario ex',
      'Generations Start Deck Lugia ex & Tyranitar ex',
      'Generations Start Deck Kyogre ex & Blaziken ex',
      'Generations Start Deck Pikachu ex & Snorlax ex',
      '2023 Pokémon World Championships Yokohama Deck: Pikachu',
      'Venusaur & Charizard & Blastoise Special Deck Set ex',
    ],
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
  swsh: {
    id: 'swsh',
    setCategories: SWSH_SET_CATEGORIES,
    // Deck products reached through the English categories above; see the SV era
    // for why `filterSourcesBySetNames` needs their names listed explicitly.
    extraSetNames: [
      'V Starter Sets',
      'V Starter Decks',
      'Sword & Shield Family Pokémon Card Game',
      'Blastoise VMAX Starter Set',
      'Inteleon VMAX High-Class Deck',
      'Start Deck 100 CoroCoro Comic Version',
      'Darkrai VSTAR Starter Set',
      'Venusaur VMAX Starter Set',
      'Grimmsnarl VMAX Starter Set',
      'Lucario VSTAR Starter Set',
      'Gengar VMAX High-Class Deck',
      'Charizard VMAX Starter Set',
      'Charizard VMAX Starter Set 2',
      'GX Starter Decks',
      'Battle Strength Decks',
      'XY Beginning Set',
      'Bulbasaur Deck',
    ],
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
  sm: {
    id: 'sm',
    setCategories: SM_SET_CATEGORIES,
    // Deck products reached through the English categories above; see the SV era
    // for why `filterSourcesBySetNames` needs their names listed explicitly.
    extraSetNames: [
      'Sun & Moon Family Pokémon Card Game',
      'Trainer Battle Decks',
      'TAG TEAM GX Starter Sets',
      'Rockruff Full Power Deck',
    ],
    crawlBatchSize: DEFAULT_CRAWL_BATCH_SIZE,
    crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
    crawlMaxRetries: DEFAULT_CRAWL_MAX_RETRIES,
  },
};

function getEraConfig(eraId) {
  const config = ERA_CONFIGS[eraId];
  if (!config) {
    throw new Error(`Unknown era "${eraId}". Known eras: ${Object.keys(ERA_CONFIGS).join(', ')}`);
  }
  return config;
}

export {
  ERA_CONFIGS,
  DP_SET_CATEGORIES,
  HGSS_SET_CATEGORIES,
  SM_SET_CATEGORIES,
  M_SET_CATEGORIES,
  SV_SET_CATEGORIES,
  SWSH_SET_CATEGORIES,
  XY_SET_CATEGORIES,
  getEraConfig,
};
