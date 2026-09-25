const SET_CATALOG = {
  en: {
    'Ancient Origins': { setCode: 'AOR', tcgdexSetId: 'xy7' },
    'Black & White': { setCode: 'BLW', tcgdexSetId: 'bw1' },
    'Boundaries Crossed': { setCode: 'BCR', tcgdexSetId: 'bw7' },
    'BREAKpoint': { setCode: 'BKP', tcgdexSetId: 'xy9' },
    'BREAKthrough': { setCode: 'BKT', tcgdexSetId: 'xy8' },
    'BW Black Star Promos': { setCode: 'BWP', tcgdexSetId: 'bwp' },
    'Call of Legends': { setCode: 'CL', tcgdexSetId: 'col1' },
    'Dark Explorers': { setCode: 'DEX', tcgdexSetId: 'bw5' },
    'Double Crisis': { setCode: 'DCR', tcgdexSetId: 'dc1' },
    'Dragon Vault': { setCode: 'DRV', tcgdexSetId: 'dv1' },
    'Dragons Exalted': { setCode: 'DRX', tcgdexSetId: 'bw6' },
    'Emerging Powers': { setCode: 'EP', tcgdexSetId: 'bw2' },
    'Evolutions': { setCode: 'EVO', tcgdexSetId: 'xy12' },
    'Fates Collide': { setCode: 'FCO', tcgdexSetId: 'xy10' },
    'Flashfire': { setCode: 'FLF', tcgdexSetId: 'xy2' },
    'Furious Fists': { setCode: 'FFI', tcgdexSetId: 'xy3' },
    'Generations': { setCode: 'GEN', tcgdexSetId: 'g1' },
    'HeartGold & SoulSilver': { setCode: 'HS', tcgdexSetId: 'hgss1' },
    'HGSS Black Star Promos': { setCode: 'HSP', tcgdexSetId: 'hgssp' },
    'Kalos Starter Set': { setCode: 'KSS', tcgdexSetId: 'xy0' },
    'Legendary Treasures': { setCode: 'LTR', tcgdexSetId: 'bw11' },
    "McDonald's Collection 2014": { setCode: 'MCD14', tcgdexSetId: '2014xy' },
    "McDonald's Collection 2015": { setCode: 'MCD15', tcgdexSetId: '2015xy' },
    "McDonald's Collection 2016": { setCode: 'MCD16', tcgdexSetId: '2016xy' },
    'Next Destinies': { setCode: 'NXD', tcgdexSetId: 'bw4' },
    'Noble Victories': { setCode: 'NVI', tcgdexSetId: 'bw3' },
    'Phantom Forces': { setCode: 'PHF', tcgdexSetId: 'xy4' },
    'Plasma Blast': { setCode: 'PLB', tcgdexSetId: 'bw10' },
    'Plasma Freeze': { setCode: 'PLF', tcgdexSetId: 'bw9' },
    'Plasma Storm': { setCode: 'PLS', tcgdexSetId: 'bw8' },
    'Primal Clash': { setCode: 'PRC', tcgdexSetId: 'xy5' },
    'Roaring Skies': { setCode: 'ROS', tcgdexSetId: 'xy6' },
    'Steam Siege': { setCode: 'STS', tcgdexSetId: 'xy11' },
    'Triumphant': { setCode: 'TM', tcgdexSetId: 'hgss4' },
    'Undaunted': { setCode: 'UD', tcgdexSetId: 'hgss3' },
    'Unleashed': { setCode: 'UL', tcgdexSetId: 'hgss2' },
    'XY': { setCode: 'XY', tcgdexSetId: 'xy1' },
    'XY Black Star Promos': { setCode: 'XYP', tcgdexSetId: 'xyp' },
    // Diamond & Pearl era (setCode is the TCGdex id for EN; Bulbapedia prints
    // the Arceus set as "Platinum: Arceus").
    'Diamond & Pearl': { setCode: 'dp1', tcgdexSetId: 'dp1' },
    'DP Black Star Promos': { setCode: 'dpp', tcgdexSetId: 'dpp' },
    'Great Encounters': { setCode: 'dp4', tcgdexSetId: 'dp4' },
    'Legends Awakened': { setCode: 'dp6', tcgdexSetId: 'dp6' },
    'Majestic Dawn': { setCode: 'dp5', tcgdexSetId: 'dp5' },
    'Mysterious Treasures': { setCode: 'dp2', tcgdexSetId: 'dp2' },
    'Platinum': { setCode: 'pl1', tcgdexSetId: 'pl1' },
    'Platinum: Arceus': { setCode: 'pl4', tcgdexSetId: 'pl4' },
    'Rising Rivals': { setCode: 'pl2', tcgdexSetId: 'pl2' },
    'Secret Wonders': { setCode: 'dp3', tcgdexSetId: 'dp3' },
    'Stormfront': { setCode: 'dp7', tcgdexSetId: 'dp7' },
    'Supreme Victors': { setCode: 'pl3', tcgdexSetId: 'pl3' },
    // Sun & Moon era (setCode is the TCGdex id for EN; printed abbreviations are
    // unnecessary because the resolver falls back to set name + card number).
    'Burning Shadows': { setCode: 'SM3', tcgdexSetId: 'sm3' },
    'Celestial Storm': { setCode: 'SM7', tcgdexSetId: 'sm7' },
    'Cosmic Eclipse': { setCode: 'SM12', tcgdexSetId: 'sm12' },
    'Crimson Invasion': { setCode: 'SM4', tcgdexSetId: 'sm4' },
    'Dragon Majesty': { setCode: 'SM7.5', tcgdexSetId: 'sm7.5' },
    'Guardians Rising': { setCode: 'SM2', tcgdexSetId: 'sm2' },
    'Hidden Fates': { setCode: 'SM115', tcgdexSetId: 'sm115' },
    'Lost Thunder': { setCode: 'SM8', tcgdexSetId: 'sm8' },
    'SM Black Star Promos': { setCode: 'SMP', tcgdexSetId: 'smp' },
    'Sun & Moon': { setCode: 'SM1', tcgdexSetId: 'sm1' },
    'Team Up': { setCode: 'SM9', tcgdexSetId: 'sm9' },
    'Ultra Prism': { setCode: 'SM5', tcgdexSetId: 'sm5' },
    'Unbroken Bonds': { setCode: 'SM10', tcgdexSetId: 'sm10' },
    'Unified Minds': { setCode: 'SM11', tcgdexSetId: 'sm11' },
    // Sword & Shield era (setCode is the TCGdex id for EN).
    'Astral Radiance': { setCode: 'SWSH10', tcgdexSetId: 'swsh10' },
    'Battle Styles': { setCode: 'SWSH5', tcgdexSetId: 'swsh5' },
    'Brilliant Stars': { setCode: 'SWSH9', tcgdexSetId: 'swsh9' },
    'Celebrations': { setCode: 'CEL25', tcgdexSetId: 'cel25' },
    "Champion's Path": { setCode: 'SWSH3.5', tcgdexSetId: 'swsh3.5' },
    'Chilling Reign': { setCode: 'SWSH6', tcgdexSetId: 'swsh6' },
    'Crown Zenith': { setCode: 'SWSH12.5', tcgdexSetId: 'swsh12.5' },
    'Darkness Ablaze': { setCode: 'SWSH3', tcgdexSetId: 'swsh3' },
    'Evolving Skies': { setCode: 'SWSH7', tcgdexSetId: 'swsh7' },
    'Fusion Strike': { setCode: 'SWSH8', tcgdexSetId: 'swsh8' },
    'Lost Origin': { setCode: 'SWSH11', tcgdexSetId: 'swsh11' },
    'Rebel Clash': { setCode: 'SWSH2', tcgdexSetId: 'swsh2' },
    'SWSH Black Star Promos': { setCode: 'SWSHP', tcgdexSetId: 'swshp' },
    'Shining Fates': { setCode: 'SWSH4.5', tcgdexSetId: 'swsh4.5' },
    'Silver Tempest': { setCode: 'SWSH12', tcgdexSetId: 'swsh12' },
    'Sword & Shield': { setCode: 'SWSH1', tcgdexSetId: 'swsh1' },
    'Vivid Voltage': { setCode: 'SWSH4', tcgdexSetId: 'swsh4' },
    // Scarlet & Violet era (setCode is the TCGdex id for EN).
    '151': { setCode: 'SV03.5', tcgdexSetId: 'sv03.5' },
    'Black Bolt': { setCode: 'SV11B', tcgdexSetId: 'sv10.5b' },
    'Destined Rivals': { setCode: 'SV10', tcgdexSetId: 'sv10' },
    'Journey Together': { setCode: 'SV09', tcgdexSetId: 'sv09' },
    'Obsidian Flames': { setCode: 'SV03', tcgdexSetId: 'sv03' },
    'Paldea Evolved': { setCode: 'SV02', tcgdexSetId: 'sv02' },
    'Paldean Fates': { setCode: 'SV04.5', tcgdexSetId: 'sv04.5' },
    'Paradox Rift': { setCode: 'SV04', tcgdexSetId: 'sv04' },
    'Prismatic Evolutions': { setCode: 'SV08.5', tcgdexSetId: 'sv08.5' },
    'SVP Black Star Promos': { setCode: 'SVP', tcgdexSetId: 'svp' },
    'Scarlet & Violet': { setCode: 'SV01', tcgdexSetId: 'sv01' },
    'Shrouded Fable': { setCode: 'SV06.5', tcgdexSetId: 'sv06.5' },
    'Stellar Crown': { setCode: 'SV07', tcgdexSetId: 'sv07' },
    'Surging Sparks': { setCode: 'SV08', tcgdexSetId: 'sv08' },
    'Temporal Forces': { setCode: 'SV05', tcgdexSetId: 'sv05' },
    'Twilight Masquerade': { setCode: 'SV06', tcgdexSetId: 'sv06' },
    'White Flare': { setCode: 'SV11W', tcgdexSetId: 'sv10.5w' },
    // Mega Evolution era (2025+).
    'Ascended Heroes': { setCode: 'ME02.5', tcgdexSetId: 'me02.5' },
    'Chaos Rising': { setCode: 'ME04', tcgdexSetId: 'me04' },
    'MEP Black Star Promos': { setCode: 'MEP', tcgdexSetId: 'mep' },
    'Mega Evolution': { setCode: 'ME01', tcgdexSetId: 'me01' },
    'Perfect Order': { setCode: 'ME03', tcgdexSetId: 'me03' },
    'Phantasmal Flames': { setCode: 'ME02', tcgdexSetId: 'me02' },
    'Pitch Black': { setCode: 'ME05', tcgdexSetId: 'me05' },
  },
  ja: {
    'Awakening Psychic King': { setCode: 'XY10', tcgdexSetId: null },
    'Bandit Ring': { setCode: 'XY7', tcgdexSetId: null },
    'Black Collection': { setCode: 'BW1', tcgdexSetId: null },
    'Blue Shock': { setCode: 'XY8a', tcgdexSetId: null },
    // Deck product: prints no set code, so marketplaces must be queried by name.
    'BREAK Starter Pack': { setCode: 'BREAK', tcgdexSetId: null, printsNoSetCode: true },
    'BW-P Promotional cards': { setCode: 'BW-P', tcgdexSetId: null },
    'Clash at the Summit': { setCode: 'L3', tcgdexSetId: null },
    'Cold Flare': { setCode: 'BW6', tcgdexSetId: null },
    'Collection X': { setCode: 'XY1a', tcgdexSetId: null },
    'Collection Y': { setCode: 'XY1b', tcgdexSetId: null },
    'Cruel Traitor': { setCode: 'XY11b', tcgdexSetId: null },
    'Dark Rush': { setCode: 'BW4', tcgdexSetId: null },
    'Dragon Blade': { setCode: 'BW5', tcgdexSetId: null },
    'Dragon Blast': { setCode: 'BW5', tcgdexSetId: null },
    'Dragon Selection': { setCode: 'DS', tcgdexSetId: null },
    'Emerald Break': { setCode: 'XY6', tcgdexSetId: null },
    'EX Battle Boost': { setCode: 'EB', tcgdexSetId: null },
    'Expansion Pack 20th Anniversary': { setCode: 'CP6', tcgdexSetId: null },
    'Fever-Burst Fighter': { setCode: 'XY11a', tcgdexSetId: null },
    'Freeze Bolt': { setCode: 'BW6', tcgdexSetId: null },
    'Gaia Volcano': { setCode: 'XY5a', tcgdexSetId: null },
    'Hail Blizzard': { setCode: 'BW3', tcgdexSetId: null },
    'HeartGold Collection': { setCode: 'L1a', tcgdexSetId: null },
    'Infinity Zone': { setCode: 'S3', tcgdexSetId: null },
    'Legendary Shine Collection': { setCode: 'CP2', tcgdexSetId: null },
    'Lost Link': { setCode: 'LL', tcgdexSetId: null },
    'L-P Promotional cards': { setCode: 'L-P', tcgdexSetId: null },
    'Megalo Cannon': { setCode: 'BW9', tcgdexSetId: null },
    'Phantom Gate': { setCode: 'XY4', tcgdexSetId: null },
    'Plasma Gale': { setCode: 'BW7', tcgdexSetId: null },
    'PokéKyun Collection': { setCode: 'CP3', tcgdexSetId: null },
    'Psycho Drive': { setCode: 'BW3', tcgdexSetId: null },
    'Rage of the Broken Heavens': { setCode: 'XY9', tcgdexSetId: null },
    'Red Collection': { setCode: 'BW2', tcgdexSetId: null },
    'Red Flash': { setCode: 'XY8b', tcgdexSetId: null },
    'Reviving Legends': { setCode: 'L2', tcgdexSetId: null },
    'Rising Fist': { setCode: 'XY3', tcgdexSetId: null },
    'Shiny Collection': { setCode: 'SC', tcgdexSetId: null },
    'SoulSilver Collection': { setCode: 'L1b', tcgdexSetId: null },
    'Spiral Force': { setCode: 'BW8', tcgdexSetId: null },
    'Thunder Knuckle': { setCode: 'BW8', tcgdexSetId: null },
    'Tidal Storm': { setCode: 'XY5b', tcgdexSetId: null },
    'White Collection': { setCode: 'BW1', tcgdexSetId: null },
    'Wild Blaze': { setCode: 'XY2', tcgdexSetId: null },
    'XY-P Promotional cards': { setCode: 'XY-P', tcgdexSetId: null },
    // Diamond & Pearl era. TCGdex JA has no DP set at all, so every entry keeps
    // tcgdexSetId: null and behaves like BW (EN->JA records are marketplace-only).
    'Advent of Arceus': { setCode: 'DPt4', tcgdexSetId: null },
    'Beat of the Frontier': { setCode: 'DPt3', tcgdexSetId: null },
    'Bonds to the End of Time': { setCode: 'DPt2', tcgdexSetId: null },
    'Cry from the Mysterious': { setCode: 'DP5', tcgdexSetId: null },
    'Dawn Dash': { setCode: 'DP4', tcgdexSetId: null },
    'DP-P Promotional cards': { setCode: 'DP-P', tcgdexSetId: null },
    'DPt-P Promotional cards': { setCode: 'DPt-P', tcgdexSetId: null },
    "Galactic's Conquest": { setCode: 'DPt1', tcgdexSetId: null },
    'Intense Fight in the Destroyed Sky': { setCode: 'DP6', tcgdexSetId: null },
    'Moonlit Pursuit': { setCode: 'DP4', tcgdexSetId: null },
    'Secret of the Lakes': { setCode: 'DP2', tcgdexSetId: null },
    'Shining Darkness': { setCode: 'DP3', tcgdexSetId: null },
    'Space-Time Creation': { setCode: 'DP1', tcgdexSetId: null },
    'Temple of Anger': { setCode: 'DP5', tcgdexSetId: null },
    // Sun & Moon era. TCGdex JA ids ending in "p" carry the cards for the "+" sets.
    'Collection Sun': { setCode: 'SM1S', tcgdexSetId: 'SM1S' },   // cards: 73
    'Collection Moon': { setCode: 'SM1M', tcgdexSetId: 'SM1M' },   // cards: 73
    'Enhanced Expansion Pack Sun & Moon': { setCode: 'SM1+', tcgdexSetId: 'SM1p' },   // cards: 51
    // Deck product: prints no set code, so marketplaces must be queried by name.
    'Sun & Moon Starter Set': { setCode: 'SM1D', tcgdexSetId: null, printsNoSetCode: true },   // cards: 59
    'Islands Await You': { setCode: 'SM2K', tcgdexSetId: 'SM2K' },   // cards: 61
    'Alolan Moonlight': { setCode: 'SM2L', tcgdexSetId: 'SM2L' },   // cards: 62
    'To Have Seen the Battle Rainbow': { setCode: 'SM3H', tcgdexSetId: 'SM3H' },   // cards: 64
    'Darkness that Consumes Light': { setCode: 'SM3N', tcgdexSetId: 'SM3N' },   // cards: 64
    'Shining Legends': { setCode: 'SM3+', tcgdexSetId: 'SM3p' },   // cards: 72
    'Awakened Heroes': { setCode: 'SM4S', tcgdexSetId: 'SM4S' },   // cards: 62
    'Ultradimensional Beasts': { setCode: 'SM4A', tcgdexSetId: 'SM4A' },   // cards: 61
    'GX Battle Boost': { setCode: 'SM4+', tcgdexSetId: 'SM4p' },   // cards: 114
    'Ultra Force': { setCode: 'SM5+', tcgdexSetId: 'SM5p' },   // cards: 50
    'Ultra Sun': { setCode: 'SM5S', tcgdexSetId: 'SM5S' },   // cards: 78
    'Ultra Moon': { setCode: 'SM5M', tcgdexSetId: 'SM5M' },   // cards: 78
    'Forbidden Light': { setCode: 'SM6', tcgdexSetId: 'SM6' },   // cards: 110
    'Dragon Storm': { setCode: 'SM6a', tcgdexSetId: 'SM6a' },   // cards: 66
    'Champion Road': { setCode: 'SM6b', tcgdexSetId: 'SM6b' },   // cards: 86
    'Sky-Splitting Charisma': { setCode: 'SM7', tcgdexSetId: 'SM7' },   // cards: 112
    'Thunderclap Spark': { setCode: 'SM7a', tcgdexSetId: 'SM7a' },   // cards: 73
    'Fairy Rise': { setCode: 'SM7b', tcgdexSetId: 'SM7b' },   // cards: 63
    'Super-Burst Impact': { setCode: 'SM8', tcgdexSetId: 'SM8' },   // cards: 111
    'Dark Order': { setCode: 'SM8a', tcgdexSetId: 'SM8a' },   // cards: 65
    'GX Ultra Shiny': { setCode: 'SM8b', tcgdexSetId: 'SM8b' },   // cards: 250
    'Tag Bolt': { setCode: 'SM9', tcgdexSetId: 'SM9' },   // cards: 118
    'Night Unison': { setCode: 'SM9a', tcgdexSetId: 'SM9a' },   // cards: 70
    'Full Metal Wall': { setCode: 'SM9b', tcgdexSetId: 'SM9b' },   // cards: 69
    'Double Blaze': { setCode: 'SM10', tcgdexSetId: 'SM10' },   // cards: 116
    'GG End': { setCode: 'SM10a', tcgdexSetId: 'SM10a' },   // cards: 69
    'Sky Legend': { setCode: 'SM10b', tcgdexSetId: 'SM10b' },   // cards: 69
    'Miracle Twin': { setCode: 'SM11', tcgdexSetId: 'SM11' },   // cards: 115
    'Remix Bout': { setCode: 'SM11a', tcgdexSetId: 'SM11a' },   // cards: 80
    'Dream League': { setCode: 'SM11b', tcgdexSetId: 'SM11b' },   // cards: 75
    'Alter Genesis': { setCode: 'SM12', tcgdexSetId: 'SM12' },   // cards: 117
    'Tag All Stars': { setCode: 'SM12a', tcgdexSetId: 'SM12a' },   // cards: 226
    'SM-P Promotional cards': { setCode: 'SM-P', tcgdexSetId: null },   // cards: 0
    'Facing a New Trial': { setCode: 'SM2p', tcgdexSetId: 'SM2p' },   // cards: 49
    'Detective Pikachu': { setCode: 'SMP2', tcgdexSetId: 'SMP2' },   // cards: 24
    // Sun & Moon-era deck products. English cards pair with these when Bulbapedia
    // prints their JP printing from a deck (`jpdeck=`) rather than an expansion,
    // which is why the English categories of the sets above are crawled. None of
    // them exists on TCGdex, so they keep tcgdexSetId null and print no set code.
    'Sun & Moon Family Pokémon Card Game': { setCode: 'SM-FAMILY', tcgdexSetId: null, printsNoSetCode: true },
    'Trainer Battle Decks': { setCode: 'SM-TRAINER-DECKS', tcgdexSetId: null, printsNoSetCode: true },
    'TAG TEAM GX Starter Sets': { setCode: 'TAGTEAM-STARTERS', tcgdexSetId: null, printsNoSetCode: true },
    'Rockruff Full Power Deck': { setCode: 'ROCKRUFF-DECK', tcgdexSetId: null, printsNoSetCode: true },
    // Sword & Shield era. Only 14 of 30 sets carry JA cards in TCGdex, so the rest
    // keep tcgdexSetId: null and behave like BW (marketplace-only EN->JA records).
    'Sword': { setCode: 'S1W', tcgdexSetId: null },   // cards: 0
    'Shield': { setCode: 'S1H', tcgdexSetId: null },   // cards: 0
    'VMAX Rising': { setCode: 'S1a', tcgdexSetId: null },   // cards: 0
    'Rebellion Crash': { setCode: 'S2', tcgdexSetId: null },   // cards: 0
    'Explosive Walker': { setCode: 'S2a', tcgdexSetId: null },   // cards: 0
    'Infinity Zone': { setCode: 'S3', tcgdexSetId: null },   // cards: 0
    'Legendary Heartbeat': { setCode: 'S3a', tcgdexSetId: null },   // cards: 0
    'Amazing Volt Tackle': { setCode: 'S4', tcgdexSetId: null },   // cards: 0
    'Shiny Star V': { setCode: 'S4a', tcgdexSetId: null },   // cards: 0
    'Peerless Fighters': { setCode: 'S5a', tcgdexSetId: null },   // cards: 0
    'Single Strike Master': { setCode: 'S5I', tcgdexSetId: 'S5I' },   // cards: 91
    'Rapid Strike Master': { setCode: 'S5R', tcgdexSetId: null },   // cards: 0
    'Silver Lance': { setCode: 'S6H', tcgdexSetId: 'S6H' },   // cards: 95
    'Jet-Black Spirit': { setCode: 'S6K', tcgdexSetId: 'S6K' },   // cards: 95
    'Eevee Heroes': { setCode: 'S6a', tcgdexSetId: null },   // cards: 0
    'Skyscraping Perfection': { setCode: 'S7D', tcgdexSetId: 'S7D' },   // cards: 90
    'Blue Sky Stream': { setCode: 'S7R', tcgdexSetId: null },   // cards: 0
    'Fusion Arts': { setCode: 'S8', tcgdexSetId: 'S8' },   // cards: 129
    '25th Anniversary Collection': { setCode: 'S8a', tcgdexSetId: null },   // cards: 0
    'VMAX Climax': { setCode: 'S8b', tcgdexSetId: 'S8b' },   // cards: 285
    'Star Birth': { setCode: 'S9', tcgdexSetId: 'S9' },   // cards: 127
    'Battle Region': { setCode: 'S9a', tcgdexSetId: 'S9a' },   // cards: 93
    'Time Gazer': { setCode: 'S10D', tcgdexSetId: null },   // cards: 0
    'Space Juggler': { setCode: 'S10P', tcgdexSetId: 'S10P' },   // cards: 88
    'Dark Phantasma': { setCode: 'S10a', tcgdexSetId: 'S10a' },   // cards: 99
    'Pokémon GO': { setCode: 'S10b', tcgdexSetId: null },   // cards: 0
    'Lost Abyss': { setCode: 'S11', tcgdexSetId: 'S11' },   // cards: 127
    'Incandescent Arcana': { setCode: 'S11a', tcgdexSetId: 'S11a' },   // cards: 94
    'Paradigm Trigger': { setCode: 'S12', tcgdexSetId: 'S12' },   // cards: 125
    'VSTAR Universe': { setCode: 'S12a', tcgdexSetId: 'S12a' },   // cards: 258
    'S-P Promotional cards': { setCode: 'S-P', tcgdexSetId: null },   // cards: 0
    // Scarlet & Violet era. TCGdex JA carries cards for every SV set.
    'Scarlet ex': { setCode: 'SV1S', tcgdexSetId: 'SV1S' },   // cards: 108
    'Violet ex': { setCode: 'SV1V', tcgdexSetId: 'SV1V' },   // cards: 108
    'Triplet Beat': { setCode: 'SV1a', tcgdexSetId: 'SV1a' },   // cards: 103
    'Snow Hazard': { setCode: 'SV2P', tcgdexSetId: 'SV2P' },   // cards: 99
    'Clay Burst': { setCode: 'SV2D', tcgdexSetId: 'SV2D' },   // cards: 99
    'Pokémon Card 151': { setCode: 'SV2a', tcgdexSetId: 'SV2a' },   // cards: 210
    'Ruler of the Black Flame': { setCode: 'SV3', tcgdexSetId: 'SV3' },   // cards: 141
    'Raging Surf': { setCode: 'SV3a', tcgdexSetId: 'SV3a' },   // cards: 92
    'Ancient Roar': { setCode: 'SV4K', tcgdexSetId: 'SV4K' },   // cards: 95
    'Future Flash': { setCode: 'SV4M', tcgdexSetId: 'SV4M' },   // cards: 95
    // TCGdex JA has no Shiny Treasure ex set: its "SV4a" is Raging Surf, so the
    // number range runs past the set and lookups return the wrong card. Null
    // keeps the physical set code and the card number, like the SV-P promos.
    'Shiny Treasure ex': { setCode: 'SV4a', tcgdexSetId: null },   // cards: 320
    'Cyber Judge': { setCode: 'SV5M', tcgdexSetId: 'SV5M' },   // cards: 100
    'Wild Force': { setCode: 'SV5K', tcgdexSetId: 'SV5K' },   // cards: 100
    'Crimson Haze': { setCode: 'SV5a', tcgdexSetId: 'SV5a' },   // cards: 96
    'Transformation Mask': { setCode: 'SV6', tcgdexSetId: 'SV6' },   // cards: 133
    'Night Wanderer': { setCode: 'SV6a', tcgdexSetId: 'SV6a' },   // cards: 94
    'Stellar Miracle': { setCode: 'SV7', tcgdexSetId: 'SV7' },   // cards: 135
    'Paradise Dragona': { setCode: 'SV7a', tcgdexSetId: 'SV7a' },   // cards: 94
    'Super Electric Breaker': { setCode: 'SV8', tcgdexSetId: 'SV8' },   // cards: 138
    'Terastal Fest ex': { setCode: 'SV8a', tcgdexSetId: 'SV8a' },   // cards: 237
    'Battle Partners': { setCode: 'SV9', tcgdexSetId: 'SV9' },   // cards: 132
    'Hot Wind Arena': { setCode: 'SV9a', tcgdexSetId: 'SV9a' },   // cards: 92
    'Glory of the Rocket Gang': { setCode: 'SV10', tcgdexSetId: 'SV10' },   // cards: 132
    'Black Bolt': { setCode: 'SV11B', tcgdexSetId: 'SV11B' },   // cards: 174
    'White Flare': { setCode: 'SV11W', tcgdexSetId: 'SV11W' },   // cards: 174
    'SV-P Promotional cards': { setCode: 'SV-P', tcgdexSetId: null },   // cards: 0
    // SV-era deck and starter products. English cards pair with these when
    // Bulbapedia prints their JP printing from a deck (`jpdeck=`) rather than an
    // expansion, which is why the English categories of the sets above are
    // crawled. Only Start Deck 100 Battle Collection exists on TCGdex (JA `MC`,
    // 774 cards), so the rest keep tcgdexSetId null and print no set code, like
    // the BREAK Starter Pack.
    'Start Deck 100 Battle Collection': { setCode: 'MC', tcgdexSetId: 'MC', printsNoSetCode: true },
    'Start Deck 100 Battle Collection CoroCiao Version': { setCode: 'MC-COROCIAO', tcgdexSetId: null, printsNoSetCode: true },
    'Start Deck 100': { setCode: 'SD100', tcgdexSetId: null, printsNoSetCode: true },
    'ex Start Decks': { setCode: 'EXSD', tcgdexSetId: null, printsNoSetCode: true },
    'ex Starter Sets': { setCode: 'EXSS', tcgdexSetId: null, printsNoSetCode: true },
    'Pokémon Card Game Battle Academy': { setCode: 'PCGBA', tcgdexSetId: null, printsNoSetCode: true },
    'Stellar Tera Type Starter Sets': { setCode: 'STTS', tcgdexSetId: null, printsNoSetCode: true },
    'Terastal Starter Set Mewtwo ex': { setCode: 'TSS-MEWTWO', tcgdexSetId: null, printsNoSetCode: true },
    'Terastal Starter Set Skeledirge ex': { setCode: 'TSS-SKELEDIRGE', tcgdexSetId: null, printsNoSetCode: true },
    "ex Starter Set Marnie's Morpeko & Grimmsnarl ex": { setCode: 'EXSS-MARNIE', tcgdexSetId: null, printsNoSetCode: true },
    'ex Starter Set Pikachu ex & Pawmot': { setCode: 'EXSS-PIKACHU', tcgdexSetId: null, printsNoSetCode: true },
    "ex Starter Set Steven's Beldum & Metagross ex": { setCode: 'EXSS-STEVEN', tcgdexSetId: null, printsNoSetCode: true },
    'Ancient Koraidon ex Starter Deck & Build Set': { setCode: 'SDBS-KORAIDON', tcgdexSetId: null, printsNoSetCode: true },
    'Future Miraidon ex Starter Deck & Build Set': { setCode: 'SDBS-MIRAIDON', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Zacian ex & Alcremie ex': { setCode: 'GSD-ZACIAN', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Reshiram ex & Amoonguss ex': { setCode: 'GSD-RESHIRAM', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Tapu Koko ex & Mimikyu ex': { setCode: 'GSD-TAPUKOKO', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Koraidon ex & Paldean Clodsire ex': { setCode: 'GSD-KORAIDON', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Xerneas ex & Noivern ex': { setCode: 'GSD-XERNEAS', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Dialga ex & Lucario ex': { setCode: 'GSD-DIALGA', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Lugia ex & Tyranitar ex': { setCode: 'GSD-LUGIA', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Kyogre ex & Blaziken ex': { setCode: 'GSD-KYOGRE', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Deck Pikachu ex & Snorlax ex': { setCode: 'GSD-PIKACHU', tcgdexSetId: null, printsNoSetCode: true },
    '2023 Pokémon World Championships Yokohama Deck: Pikachu': { setCode: 'WCS23-PIKACHU', tcgdexSetId: null, printsNoSetCode: true },
    'Venusaur & Charizard & Blastoise Special Deck Set ex': { setCode: 'SDS-KANTO', tcgdexSetId: null, printsNoSetCode: true },
    // Mega Evolution era (2025+). TCGdex JA carries cards for every M set.
    'Mega Brave': { setCode: 'M1L', tcgdexSetId: 'M1L' },   // cards: 63
    'Mega Symphonia': { setCode: 'M1S', tcgdexSetId: 'M1S' },   // cards: 63
    'Inferno X': { setCode: 'M2', tcgdexSetId: 'M2' },   // cards: 80
    'MEGA Dream ex': { setCode: 'M2a', tcgdexSetId: 'M2a' },   // cards: 193
    'Nihil Zero': { setCode: 'M3', tcgdexSetId: 'M3' },   // cards: 80
    'Ninja Spinner': { setCode: 'M4', tcgdexSetId: 'M4' },   // cards: 83
    'Abyss Eye': { setCode: 'M5', tcgdexSetId: 'M5' },   // cards: 81
    'Storm Emeralda': { setCode: 'M6', tcgdexSetId: 'M6' },   // cards: 76
    'M-P Promotional cards': { setCode: 'M-P', tcgdexSetId: null },   // cards: 0
    // Deck products reached through the English categories of the SM, SWSH and M
    // eras (see those era configs). They span eras - the same V Starter Sets card
    // pairs with an SWSH card and with an M card - so they live in one block
    // instead of an era block. None of them exists on TCGdex, so they keep
    // tcgdexSetId null and print no set code, like the BREAK Starter Pack.
    'Battle Gift Set: Thundurus vs Tornadus': { setCode: 'BG-THUNDURUS-TORNADUS', tcgdexSetId: null, printsNoSetCode: true },
    'Battle Starter Decks': { setCode: 'BATTLE-STARTER-DECKS', tcgdexSetId: null, printsNoSetCode: true },
    'Battle Strength Decks': { setCode: 'BATTLE-STRENGTH-DECKS', tcgdexSetId: null, printsNoSetCode: true },
    'Blastoise VMAX Starter Set': { setCode: 'BLASTOISE-VMAX', tcgdexSetId: null, printsNoSetCode: true },
    'Bulbasaur Deck': { setCode: 'BULBASAUR-DECK', tcgdexSetId: null, printsNoSetCode: true },
    'Charizard VMAX Starter Set': { setCode: 'CHARIZARD-VMAX', tcgdexSetId: null, printsNoSetCode: true },
    'Charizard VMAX Starter Set 2': { setCode: 'CHARIZARD-VMAX-2', tcgdexSetId: null, printsNoSetCode: true },
    'Darkrai VSTAR Starter Set': { setCode: 'DARKRAI-VSTAR', tcgdexSetId: null, printsNoSetCode: true },
    'GX Starter Decks': { setCode: 'GX-STARTER-DECKS', tcgdexSetId: null, printsNoSetCode: true },
    'Generations Start Decks': { setCode: 'GENERATIONS-DECKS', tcgdexSetId: null, printsNoSetCode: true },
    'Gengar VMAX High-Class Deck': { setCode: 'GENGAR-VMAX', tcgdexSetId: null, printsNoSetCode: true },
    'Gift Box DPt': { setCode: 'GIFT-BOX-DPT', tcgdexSetId: null, printsNoSetCode: true },
    'Grimmsnarl VMAX Starter Set': { setCode: 'GRIMMSNARL-VMAX', tcgdexSetId: null, printsNoSetCode: true },
    'Inteleon VMAX High-Class Deck': { setCode: 'INTELEON-VMAX', tcgdexSetId: null, printsNoSetCode: true },
    'Lucario VSTAR Starter Set': { setCode: 'LUCARIO-VSTAR', tcgdexSetId: null, printsNoSetCode: true },
    'MEGA Starter Set Mega Diancie ex': { setCode: 'MEGA-DIANCIE', tcgdexSetId: null, printsNoSetCode: true },
    'MEGA Starter Set Mega Gengar ex': { setCode: 'MEGA-GENGAR', tcgdexSetId: null, printsNoSetCode: true },
    'National Beginning Set': { setCode: 'NATIONAL-BEGINNING', tcgdexSetId: null, printsNoSetCode: true },
    'Start Deck 100 CoroCoro Comic Version': { setCode: 'SD100-COROCORO', tcgdexSetId: null, printsNoSetCode: true },
    'Sword & Shield Family Pokémon Card Game': { setCode: 'SWSH-FAMILY', tcgdexSetId: null, printsNoSetCode: true },
    'V Starter Decks': { setCode: 'V-STARTER-DECKS', tcgdexSetId: null, printsNoSetCode: true },
    'V Starter Sets': { setCode: 'V-STARTER-SETS', tcgdexSetId: null, printsNoSetCode: true },
    'Venusaur VMAX Starter Set': { setCode: 'VENUSAUR-VMAX', tcgdexSetId: null, printsNoSetCode: true },
    'XY Beginning Set': { setCode: 'XY-BEGINNING', tcgdexSetId: null, printsNoSetCode: true },
  },
};

// Bulbapedia prints the Hidden Fates Shiny Vault under the same set name as
// the main set, but TCGdex stores it as its own set (sma), so the lookup needs
// the card number to tell them apart.
const SET_CATALOG_NUMBER_RULES = {
  en: [
    { setName: 'Hidden Fates', numberPrefix: 'SV', setCode: 'SMA', tcgdexSetId: 'sma' },
    // Sword & Shield sub-sets print inside their parent set but TCGdex stores
    // them separately (Trainer Gallery "TG", Galarian Gallery "GG", Shining
    // Fates Shiny Vault "SV").
    { setName: 'Brilliant Stars', numberPrefix: 'TG', setCode: 'BRS:TG', tcgdexSetId: 'swsh9tg' },
    { setName: 'Astral Radiance', numberPrefix: 'TG', setCode: 'ASR:TG', tcgdexSetId: 'swsh10tg' },
    { setName: 'Lost Origin', numberPrefix: 'TG', setCode: 'LOR:TG', tcgdexSetId: 'swsh11tg' },
    { setName: 'Silver Tempest', numberPrefix: 'TG', setCode: 'SIT:TG', tcgdexSetId: 'swsh12tg' },
    { setName: 'Crown Zenith', numberPrefix: 'GG', setCode: 'CRZ:GG', tcgdexSetId: 'swsh12.5gg' },
    { setName: 'Shining Fates', numberPrefix: 'SV', setCode: 'SHF:SV', tcgdexSetId: 'swsh4.5sv' },
  ],
};

export { SET_CATALOG, SET_CATALOG_NUMBER_RULES };
