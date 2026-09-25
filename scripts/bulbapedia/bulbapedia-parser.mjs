function extractPageSnapshot(apiResponse) {
  const pages = apiResponse?.query?.pages;
  if (!Array.isArray(pages) || pages.length !== 1 || pages[0].missing) throw new Error('Bulbapedia response must contain exactly one existing page');
  const page = pages[0];
  const revision = page.revisions?.[0];
  const wikitext = revision?.slots?.main?.content;
  if (!revision?.revid || typeof wikitext !== 'string') throw new Error(`Bulbapedia page has no revision content: ${page.title}`);
  return {
    title: page.title,
    pageId: page.pageid,
    revisionId: revision.revid,
    revisionTimestamp: revision.timestamp,
    wikitext,
  };
}

function isTemplateBoundary(character) {
  return character === '|' || character === '}' || /\s/.test(character || '');
}

function findTemplateStart(wikitext, templateName, searchStart) {
  const marker = `{{${templateName}`;
  let markerIndex = wikitext.indexOf(marker, searchStart);
  while (markerIndex >= 0 && !isTemplateBoundary(wikitext[markerIndex + marker.length])) markerIndex = wikitext.indexOf(marker, markerIndex + marker.length);
  return markerIndex;
}

function extractTemplates(wikitext, templateName) {
  const templates = [];
  let searchStart = 0;
  while (searchStart < wikitext.length) {
    const templateStart = findTemplateStart(wikitext, templateName, searchStart);
    if (templateStart < 0) return templates;
    let braceDepth = 0;
    let cursor = templateStart;
    let isClosed = false;
    while (cursor < wikitext.length - 1) {
      const pair = wikitext.slice(cursor, cursor + 2);
      if (pair === '{{') {
        braceDepth += 1;
        cursor += 2;
        continue;
      }
      if (pair === '}}') {
        braceDepth -= 1;
        cursor += 2;
        if (braceDepth === 0) {
          templates.push(wikitext.slice(templateStart, cursor));
          searchStart = cursor;
          isClosed = true;
          break;
        }
        continue;
      }
      cursor += 1;
    }
    if (!isClosed) throw new Error(`Unclosed ${templateName} template`);
  }
  return templates;
}

function splitTemplateParts(template) {
  const content = template.slice(2, -2);
  const parts = [];
  let partStart = 0;
  let braceDepth = 0;
  let linkDepth = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const pair = content.slice(cursor, cursor + 2);
    if (pair === '{{') {
      braceDepth += 1;
      cursor += 2;
      continue;
    }
    if (pair === '}}') {
      braceDepth -= 1;
      cursor += 2;
      continue;
    }
    if (pair === '[[') {
      linkDepth += 1;
      cursor += 2;
      continue;
    }
    if (pair === ']]') {
      linkDepth -= 1;
      cursor += 2;
      continue;
    }
    if (content[cursor] === '|' && braceDepth === 0 && linkDepth === 0) {
      parts.push(content.slice(partStart, cursor));
      partStart = cursor + 1;
    }
    cursor += 1;
  }
  parts.push(content.slice(partStart));
  return parts;
}

function parseTemplate(template) {
  const [templateName, ...rawParameters] = splitTemplateParts(template);
  const named = {};
  const positional = [];
  for (const rawParameter of rawParameters) {
    const equalsIndex = rawParameter.indexOf('=');
    if (equalsIndex < 0) {
      positional.push(rawParameter.trim());
      continue;
    }
    const parameterName = rawParameter.slice(0, equalsIndex).trim();
    named[parameterName] = rawParameter.slice(equalsIndex + 1).trim();
  }
  return { name: templateName.trim(), named, positional };
}

// Bulbapedia writes a jointly released Japanese pair as one expansion plus a
// per-printing display name ({{TCG|Black Bolt/White Flare|White Flare}}). That
// display name is the set the row really belongs to, but the same template also
// carries prose ("the Japanese expansion with the same name"), so callers must
// check it against their set catalog before using it.
function unwrapWikiDisplayName(value) {
  if (!value) return null;
  const match = value.match(/^\{\{TCG\|([^{}|]+)\|([^{}|]+)\}\}$/i);
  if (!match || !match[1].includes('/')) return null;
  return match[2].trim() || null;
}

// Bulbapedia marks the second half of a Z-move name with <small>
// ("ヒコウZ <small>エアスラッシュ</small>"), and the tag would otherwise travel into
// the index and from there into the marketplace queries.
function stripHtmlTags(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;
}

function unwrapWikiValue(value) {
  if (!value) return null;
  const simpleTemplateMatch = value.match(/^\{\{(?:TCG|rar)\|([^{}|]+)(?:\|[^{}]*)?\}\}$/i);
  if (simpleTemplateMatch) return simpleTemplateMatch[1].trim();
  const wikiLinkMatch = value.match(/^\[\[(?:[^\]|]+\|)?([^\]]+)\]\]$/);
  if (wikiLinkMatch) return wikiLinkMatch[1].trim();
  return value.replace(/'{2,3}/g, '').trim() || null;
}

function extractCardName(value) {
  if (!value) return null;
  const tcgIdMatch = value.match(/\{\{TCG ID\|[^|{}]+\|([^|{}]+)/i);
  if (tcgIdMatch) return tcgIdMatch[1].trim();
  const wikiLinkMatch = value.match(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/);
  if (wikiLinkMatch) return wikiLinkMatch[1].trim();
  return unwrapWikiValue(value);
}

function buildLanguagePrinting(named, language) {
  const isEnglish = language === 'en';
  const setKeys = isEnglish
    ? ['expansion', 'deck', 'deckkit', 'halfdeck', 'themedeck']
    : ['jpexpansion', 'jpdeck', 'jpdeckkit', 'jphalfdeck', 'jpthemedeck'];
  const setValue = setKeys.map((key) => named[key]).find(Boolean);
  const setName = unwrapWikiValue(setValue);
  const setNameAlt = unwrapWikiDisplayName(setValue);
  const cardNumber = named[isEnglish ? 'cardno' : 'jpcardno'] || null;
  const rarity = unwrapWikiValue(named[isEnglish ? 'rarity' : 'jprarity']);
  if (!setName && !cardNumber && !rarity) return null;
  // Only carried when set: a combined expansion name is the exception, and an
  // explicit null would only add noise to every stored printing.
  return { setName, cardNumber, rarity, ...(setNameAlt ? { setNameAlt } : {}) };
}

function normalizeCardName(cardName, pageTitle) {
  const titleName = (pageTitle || '').replace(/\s+\([^)]*\)$/, '').trim() || null;
  const templateName = cardName && !cardName.includes('{{') ? cardName : null;
  // Mega, Primal, and BREAK printings carry their prefix only in the page
  // title (e.g. title "M Houndoom-EX" with cardname "Houndoom"), so prefer
  // the title whenever it contains the template name.
  if (titleName && (!templateName || titleName.toLowerCase().includes(templateName.toLowerCase()))) return titleName;
  return templateName || titleName;
}

function findCardTemplateFamily(wikitext) {
  const families = [
    { cardKind: 'pokemon', infobox: 'PokémoncardInfobox', expansion: 'PokémoncardInfobox/Expansion' },
    { cardKind: 'trainer', infobox: 'TCGTrainerCardInfobox', expansion: 'TCGTrainerCardInfobox/Expansion' },
    { cardKind: 'energy', infobox: 'TCGEnergyCardInfobox', expansion: 'TCGEnergyCardInfobox/Expansion' },
  ];
  for (const family of families) {
    const infoboxes = extractTemplates(wikitext, family.infobox);
    const expansions = extractTemplates(wikitext, family.expansion);
    if (infoboxes.length === 1 && expansions.length > 0) return { ...family, infobox: infoboxes[0], expansions };
  }
  return null;
}

function parseCardPage(apiResponse) {
  const snapshot = extractPageSnapshot(apiResponse);
  const templateFamily = findCardTemplateFamily(snapshot.wikitext);
  if (!templateFamily) throw new Error(`Unsupported Bulbapedia card page: ${snapshot.title}`);
  const cardInfobox = parseTemplate(templateFamily.infobox).named;
  const printings = templateFamily.expansions.map((template) => {
    const named = parseTemplate(template).named;
    return { en: buildLanguagePrinting(named, 'en'), ja: buildLanguagePrinting(named, 'ja') };
  });
  return {
    title: snapshot.title,
    pageId: snapshot.pageId,
    revisionId: snapshot.revisionId,
    revisionTimestamp: snapshot.revisionTimestamp,
    cardKind: templateFamily.cardKind,
    cardName: normalizeCardName(stripHtmlTags(cardInfobox.cardname), snapshot.title),
    japaneseName: stripHtmlTags(cardInfobox.jname) || null,
    hp: cardInfobox.hp ? Number(cardInfobox.hp) : null,
    image: cardInfobox.image || null,
    reprintCount: cardInfobox.reprints ? Number(cardInfobox.reprints) : 0,
    printings,
  };
}

function parseSetPage(apiResponse) {
  const snapshot = extractPageSnapshot(apiResponse);
  const headers = extractTemplates(snapshot.wikitext, 'Setlist/nmheader').map((template) => parseTemplate(template));
  const entries = extractTemplates(snapshot.wikitext, 'Setlist/nmentry').map((template) => parseTemplate(template));
  if (headers.length === 0 || entries.length === 0) throw new Error(`Unsupported Bulbapedia set page: ${snapshot.title}`);
  return {
    title: snapshot.title,
    pageId: snapshot.pageId,
    revisionId: snapshot.revisionId,
    revisionTimestamp: snapshot.revisionTimestamp,
    setNames: [...new Set(headers.map((header) => header.named.title).filter(Boolean))],
    cards: entries.map((entry) => ({
      cardNumber: entry.positional[0] || null,
      cardName: extractCardName(entry.positional[1]),
      type: entry.positional[2] || null,
      parameters: entry.positional.slice(3),
    })),
  };
}

function parseRedirectPage(apiResponse) {
  const snapshot = extractPageSnapshot(apiResponse);
  const redirectMatch = snapshot.wikitext.match(/^#REDIRECT\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/i);
  if (!redirectMatch) throw new Error(`Unsupported Bulbapedia redirect page: ${snapshot.title}`);
  return {
    title: snapshot.title,
    pageId: snapshot.pageId,
    revisionId: snapshot.revisionId,
    revisionTimestamp: snapshot.revisionTimestamp,
    targetTitle: redirectMatch[1].trim(),
  };
}

function parseWithReport(parsePage, apiResponse) {
  try {
    return { success: true, data: parsePage(apiResponse), error: null };
  } catch (error) {
    return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export {
  extractPageSnapshot,
  extractTemplates,
  parseCardPage,
  parseRedirectPage,
  parseSetPage,
  parseTemplate,
  parseWithReport,
};
