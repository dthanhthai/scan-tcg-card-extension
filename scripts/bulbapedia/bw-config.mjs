const BW_SET_CATEGORIES = [
  { categoryTitle: 'Category:Black Collection cards', jpSetCode: 'BW1', setName: 'Black Collection' },
  { categoryTitle: 'Category:White Collection cards', jpSetCode: 'BW1', setName: 'White Collection' },
  { categoryTitle: 'Category:Red Collection cards', jpSetCode: 'BW2', setName: 'Red Collection' },
  { categoryTitle: 'Category:Psycho Drive cards', jpSetCode: 'BW3', setName: 'Psycho Drive' },
  { categoryTitle: 'Category:Hail Blizzard cards', jpSetCode: 'BW3', setName: 'Hail Blizzard' },
  { categoryTitle: 'Category:Dark Rush cards', jpSetCode: 'BW4', setName: 'Dark Rush' },
  { categoryTitle: 'Category:Dragon Blast cards', jpSetCode: 'BW5', setName: 'Dragon Blast' },
  { categoryTitle: 'Category:Dragon Blade cards', jpSetCode: 'BW5', setName: 'Dragon Blade' },
  { categoryTitle: 'Category:Freeze Bolt cards', jpSetCode: 'BW6', setName: 'Freeze Bolt' },
  { categoryTitle: 'Category:Cold Flare cards', jpSetCode: 'BW6', setName: 'Cold Flare' },
  { categoryTitle: 'Category:Plasma Gale cards', jpSetCode: 'BW7', setName: 'Plasma Gale' },
  { categoryTitle: 'Category:Spiral Force cards', jpSetCode: 'BW8', setName: 'Spiral Force' },
  { categoryTitle: 'Category:Thunder Knuckle cards', jpSetCode: 'BW8', setName: 'Thunder Knuckle' },
  { categoryTitle: 'Category:Megalo Cannon cards', jpSetCode: 'BW9', setName: 'Megalo Cannon' },
  { categoryTitle: 'Category:Dragon Selection cards', jpSetCode: 'DS', setName: 'Dragon Selection' },
  { categoryTitle: 'Category:Shiny Collection cards', jpSetCode: 'SC', setName: 'Shiny Collection' },
  { categoryTitle: 'Category:EX Battle Boost cards', jpSetCode: 'EB', setName: 'EX Battle Boost' },
];
const BW_CRAWL_BATCH_SIZE = 20;
const BW_CRAWL_DELAY_MS = 150;
const BW_CRAWL_MAX_RETRIES = 2;

export {
  BW_CRAWL_BATCH_SIZE,
  BW_CRAWL_DELAY_MS,
  BW_CRAWL_MAX_RETRIES,
  BW_SET_CATEGORIES,
};
