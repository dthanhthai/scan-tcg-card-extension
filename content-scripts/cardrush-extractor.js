// Injected into a real cardrush-pokemon.jp tab via chrome.scripting.executeScript.
// Runs INSIDE the CardRush page's own DOM context (after Cloudflare's JS
// challenge has resolved), so document.querySelectorAll works normally.
//
// This file is loaded by the background service worker only to keep the
// function's source in one readable place; the function itself is passed
// directly to chrome.scripting.executeScript({ func: extractCardrushListings }).

function extractCardrushListings() {
  // Every CardRush page also renders "recently viewed" / recommendation
  // carousels at the bottom. Their links point at /product/ like real search
  // results, so a plain page-wide query would return them when the search has
  // no results. Walks up the ancestors and rejects a link that sits inside a
  // section whose id/class or heading marks it as history or recommendations.
  //
  // This has to stay *inside* the injected function: chrome.scripting
  // .executeScript({ func }) serializes only that one function, so a sibling
  // top-level helper is undefined in the page and every call throws — which
  // silently produced zero listings on pages that did have results.
  function isNonResultProductLink(link) {
    let node = link.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const className = typeof node.className === 'string' ? node.className : '';
      if (/recent|history|viewed|osusume|recommend|ranking|related|pickup|swiper/i.test(`${node.id || ''} ${className}`)) return true;
      const heading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > .title, :scope > .heading');
      if (heading && /最近チェック|閲覧履歴|最近見た|おすすめ|関連商品|ランキング|Recently viewed/i.test(heading.textContent || '')) return true;
    }
    return false;
  }

  const listings = [];
  const productLinks = document.querySelectorAll('a[href*="/product/"]');
  const seen = new Set();

  for (const link of productLinks) {
    const href = link.getAttribute('href') || '';
    const idMatch = href.match(/\/product\/(\d+)/);
    if (!idMatch || seen.has(idMatch[1])) continue;
    if (isNonResultProductLink(link)) continue;

    const container = link.closest('li') || link.closest('[class*="product"]') || link.parentElement;
    const text = container ? container.textContent.replace(/\s+/g, ' ').trim() : '';
    const img = container ? container.querySelector('img') : null;
    const imageUrl = img ? img.src : null;
    console.log('[cardrush] image:', { id: idMatch[1], imageUrl });

    // Try strict format first:
    //   Japanese: "カード名【レアリティ】{番号/総数} [セットコード]"
    //   English:  "name [rarity] { number / total } [setCode]"
    const nameMatch =
      text.match(/(.+?)【([A-Za-z-]+)】\{(\d{2,3}\/[\w-]{2,6})\}\s*\[([^\]]+)\]/) ||
      text.match(/(.+?)\s\[([A-Za-z-]+)\]\s\{\s*(\d{2,3}\s*\/\s*[\w-]{2,6})\s*\}\s*\[\s*([^\]]+?)\s*\]/);

    const priceMatch = text.match(/([\d,]+)\s*円(?:\s*\(税込\)|\s*\(tax included\))?/);
    const stockMatch = text.match(/在庫数\s*(\d+)/) || text.match(/Quantity in stock:?\s*(\d+)/i);

    let condition = 'NM';
    if (text.includes('状態A-') || text.includes('[Condition A-]')) condition = 'A-';
    else if (text.includes('状態A') || text.includes('[Condition A]')) condition = 'A';
    else if (text.includes('状態B') || text.includes('[Condition B]')) condition = 'B';
    else if (text.includes('状態C') || text.includes('[Condition C]')) condition = 'C';
    if (text.includes('PSA')) condition = 'PSA';

    seen.add(idMatch[1]);

    if (nameMatch) {
      listings.push({
        productName: nameMatch[1].replace(/^(〔[^〕]+〕|☆[^☆]+☆)+/g, '').trim(),
        rarity: nameMatch[2],
        cardNumber: nameMatch[3].replace(/\s+/g, ''),
        setCode: nameMatch[4].trim(),
        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null,
        stock: stockMatch ? parseInt(stockMatch[1], 10) : 0,
        condition,
        isOnSale: text.includes('SALE'),
        productUrl: `https://www.cardrush-pokemon.jp/product/${idMatch[1]}`,
        imageUrl,
      });
    } else if (priceMatch) {
      // Lenient fallback: only links whose price was parsed. A product link
      // with no price (a history/recommendation tile) is not a search result.
      const linkText = link.textContent.replace(/\s+/g, ' ').trim();
      listings.push({
        productName: linkText.substring(0, 80),
        rarity: null,
        cardNumber: null,
        setCode: null,
        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null,
        stock: stockMatch ? parseInt(stockMatch[1], 10) : 0,
        condition,
        isOnSale: text.includes('SALE'),
        productUrl: `https://www.cardrush-pokemon.jp/product/${idMatch[1]}`,
        imageUrl,
      });
    }
  }

  return listings;
}

// Exported for test environments (Node/Vitest).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractCardrushListings };
}
