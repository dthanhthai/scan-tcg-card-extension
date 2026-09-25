// Injected into a real pricecharting.com tab via chrome.scripting.executeScript.
// Runs INSIDE the PriceCharting page's own DOM context, so document.querySelectorAll
// works normally. Parses search results from #games_table or fallback selectors.
//
// IMPORTANT: chrome.scripting.executeScript({func}) serializes ONLY the passed
// function — sibling functions in this file are NOT available in the injected
// context. Each top-level function here must be self-contained.
//
// This file is loaded by the background service worker only to keep the
// function's source in one readable place; the function itself is passed
// directly to chrome.scripting.executeScript({func: extractPricechartingListings}).

function extractPricechartingListings() {
  const listings = [];

  // Path 1: search results page with #games_table
  const table = document.querySelector('#games_table');
  if (table) {
    const rows = table.querySelectorAll('tbody tr');
    for (const row of rows) {
      const titleCell = row.querySelector('td.title');
      if (!titleCell) continue;
      const titleLink = titleCell.querySelector('a');
      if (!titleLink) continue;

      const productUrl = titleLink.href;
      const title = titleLink.textContent.trim();

      const setCell = row.querySelector('td.console');
      const setName = setCell ? setCell.textContent.trim() : '';

      function parsePrice(className) {
        const cell = row.querySelector(`td.${className}`);
        if (!cell) return null;
        const text = cell.textContent.trim().replace(/[$,]/g, '');
        const price = parseFloat(text);
        return isNaN(price) ? null : price;
      }

      const ungradedPrice = parsePrice('used_price');
      const grade7Price = parsePrice('cib_price');
      const grade8Price = parsePrice('new_price');

      const img = row.querySelector('img.photo') || row.querySelector('td.title img') || row.querySelector('img');
      const rawImgUrl = img ? (img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || (img.srcset ? img.srcset.split(' ')[0] : null) || img.src) : null;
      const imageUrl = (rawImgUrl && !rawImgUrl.startsWith('data:image/gif') && !rawImgUrl.startsWith('data:image/png'))
        ? rawImgUrl.replace('/60.jpg', '/240.jpg').replace('/60.webp', '/240.webp')
        : null;
      console.log('[pricecharting] search image:', { imageUrl, rawSrc: img ? img.src : null, rawDataSrc: img ? img.getAttribute('data-src') : null, rawSrcset: img ? img.srcset : null });

      listings.push({
        productName: title,
        setName,
        ungradedPrice,
        grade7Price,
        grade8Price,
        productUrl,
        imageUrl,
      });
    }
    if (listings.length > 0) return listings;
  }

  // Path 2: product detail page (URL contains /game/)
  // PriceCharting redirects to a detail page when search finds 1 match.
  // Detail page has #used_price, #complete_price, #new_price, #graded_price, #manual_only_price cells.
  // Ungraded sold listings live inside div.completed-auctions-used (the visible condition panel).
  // NOTE: This path is synchronous — it cannot poll for async table render after
  // clicking the Ungraded tab. For enrichment with polling, use
  // extractPricechartingDetailSales (async) via lib/pricecharting-scraper.js.
  if (location.pathname.includes('/game/')) {
    function parseCellPrice(selector) {
      const cell = document.querySelector(selector);
      if (!cell) return null;
      const text = cell.textContent.trim().replace(/[$,]/g, '');
      const price = parseFloat(text);
      return isNaN(price) ? null : price;
    }

    const ungradedPrice = parseCellPrice('#used_price .price.js-price, #used_price .js-price, #used_price');
    const grade7Price = parseCellPrice('#complete_price .price.js-price, #complete_price .js-price, #complete_price');
    const grade8Price = parseCellPrice('#new_price .price.js-price, #new_price .js-price, #new_price');
    const grade9Price = parseCellPrice('#graded_price .price.js-price, #graded_price .js-price, #graded_price');
    const grade10Price = parseCellPrice('#manual_only_price .price.js-price, #manual_only_price .js-price, #manual_only_price');

    // Best-effort synchronous read of the ungraded panel (no click — only reads
    // whatever is currently rendered). The async enrichment path handles the
    // click + poll for fresh renders.
    const PANEL_CLASS = 'completed-auctions-used';
    let recentSalePrice = null;
    let recentSaleDate = null;
    let ungradedPanel = document.querySelector(`#price_comparison .${PANEL_CLASS}:not(.tab):not([style*="display: none"])`);
    if (!ungradedPanel) ungradedPanel = document.querySelector(`#price_comparison .${PANEL_CLASS}:not(.tab)`);
    if (ungradedPanel) {
      const saleTable = ungradedPanel.querySelector('table');
      if (saleTable) {
        const saleRows = saleTable.querySelectorAll('tbody tr, tr');
        for (const row of saleRows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) continue;
          const dateText = cells[0].textContent.trim();
          const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
          if (!dateMatch) continue;
          let price = null;
          for (let ci = 1; ci < cells.length; ci++) {
            const cellText = cells[ci].textContent.trim();
            const cellPriceMatch = cellText.match(/^\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
            if (cellPriceMatch) {
              price = parseFloat(cellPriceMatch[1].replace(/,/g, ''));
              break;
            }
          }
          if (price == null) continue;
          if (recentSaleDate == null || dateMatch[1] > recentSaleDate) {
            recentSaleDate = dateMatch[1];
            recentSalePrice = price;
          }
        }
      }
    }

    if (ungradedPrice != null || grade7Price != null || grade8Price != null || grade9Price != null || grade10Price != null || recentSalePrice != null) {
      const titleEl = document.querySelector('h1') || document.querySelector('title');
      const productName = titleEl ? titleEl.textContent.trim() : 'PriceCharting product';
      const isPlaceholder = (url) => !url || url.startsWith('data:image/gif') || url.startsWith('data:image/png');
      // Strategy 1: og:image meta tag (most reliable)
      let imageUrl = document.querySelector('meta[property="og:image"]')?.content;
      if (isPlaceholder(imageUrl)) imageUrl = null;
      // Strategy 2: product image containers with lazy-load support
      if (!imageUrl) {
        const img = document.querySelector('#product_details img, .product-image img, #product_image, img.product-image');
        if (img) {
          const candidates = [
            img.getAttribute('data-src'),
            img.getAttribute('data-lazy-src'),
            img.dataset.src,
            img.dataset.lazySrc,
            img.srcset ? img.srcset.split(' ')[0] : null,
            img.src,
          ];
          for (const c of candidates) {
            if (!isPlaceholder(c) && c.startsWith('http')) { imageUrl = c; break; }
          }
        }
      }
      console.log('[pricecharting] detail image:', { imageUrl });
      return [{
        productName,
        setName: '',
        ungradedPrice,
        grade7Price,
        grade8Price,
        grade9Price,
        grade10Price,
        recentSalePrice,
        recentSaleDate,
        productUrl: location.href,
        imageUrl,
      }];
    }
  }

  // Path 3: fallback — look for any product links with prices
  const productLinks = document.querySelectorAll('a[href*="/game/"]');
  const seen = new Set();
  for (const link of productLinks) {
    const href = link.getAttribute('href') || '';
    if (seen.has(href)) continue;
    seen.add(href);

    let container = link;
    for (let i = 0; i < 5; i++) {
      const parent = container.parentElement;
      if (!parent) break;
      const parentText = parent.textContent || '';
      if (parentText.includes('$') || parentText.match(/\d+\.\d{2}/)) {
        container = parent;
        break;
      }
      container = parent;
    }

    const text = container.textContent.replace(/\s+/g, ' ').trim();
    const priceMatch = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    if (price != null) {
      listings.push({
        productName: link.textContent.trim().substring(0, 80),
        setName: '',
        ungradedPrice: price,
        grade7Price: null,
        grade8Price: null,
        productUrl: link.href,
        imageUrl: null,
      });
    }
  }

  return listings;
}

/**
 * Standalone entry point used by lib/pricecharting-scraper.js when enriching
 * a search result by opening the product detail URL. Clicks the Ungraded tab
 * and returns { recentSalePrice, recentSaleDate } — both null if not found.
 * Must be self-contained (no sibling-function calls) because executeScript
 * only serializes the function passed to it.
 *
 * Async: polls for the sold-listings table to render after clicking the tab
 * (PriceCharting renders the table asynchronously on tab activation).
 */
async function extractPricechartingDetailSales() {
  const PANEL_CLASS = 'completed-auctions-used';
  const tab = document.querySelector(`#tab-bar .tab.${PANEL_CLASS}`);
  if (tab) tab.click();

  // Parse standard grade prices from the detail page header cells.
  function parseCellPrice(selector) {
    const cell = document.querySelector(selector);
    if (!cell) return null;
    const text = cell.textContent.trim().replace(/[$,]/g, '');
    const price = parseFloat(text);
    return isNaN(price) ? null : price;
  }
  const grade9Price = parseCellPrice('#graded_price .price.js-price, #graded_price .js-price, #graded_price');
  const grade10Price = parseCellPrice('#manual_only_price .price.js-price, #manual_only_price .js-price, #manual_only_price');

  // Poll for the ungraded content panel + table to render (up to ~4s after click).
  // IMPORTANT: use :not(.tab) to exclude the tab header itself — both the tab
  // and the content panel share class "completed-auctions-used" and live inside
  // #price_comparison. querySelector returns the first match (the tab) without
  // this exclusion.
  let panel = null;
  let saleTable = null;
  for (let i = 0; i < 20; i++) {
    panel = document.querySelector(`#price_comparison .${PANEL_CLASS}:not(.tab):not([style*="display: none"])`);
    if (!panel) panel = document.querySelector(`#price_comparison .${PANEL_CLASS}:not(.tab)`);
    if (panel) {
      saleTable = panel.querySelector('table');
      if (saleTable && saleTable.querySelectorAll('tbody tr, tr').length > 0) break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!panel || !saleTable) {
    return { recentSalePrice: null, recentSaleDate: null, grade9Price, grade10Price };
  }

  let recentSalePrice = null;
  let recentSaleDate = null;
  const rows = saleTable.querySelectorAll('tbody tr, tr');
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const dateText = cells[0].textContent.trim();
    const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    // Find the price cell: a cell whose trimmed text starts with $ (the actual
    // sale price). Avoids matching "$6/month" in the "Time Warp / Subscribe"
    // promo cell, which appears before the real price cell.
    let price = null;
    for (let ci = 1; ci < cells.length; ci++) {
      const cellText = cells[ci].textContent.trim();
      const cellPriceMatch = cellText.match(/^\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
      if (cellPriceMatch) {
        price = parseFloat(cellPriceMatch[1].replace(/,/g, ''));
        break;
      }
    }
    if (price == null) continue;
    if (recentSaleDate == null || dateMatch[1] > recentSaleDate) {
      recentSaleDate = dateMatch[1];
      recentSalePrice = price;
    }
  }
  // Extract product image from detail page
  const isPlaceholder = (url) => !url || url.startsWith('data:image/gif') || url.startsWith('data:image/png');
  let imageUrl = document.querySelector('meta[property="og:image"]')?.content;
  if (isPlaceholder(imageUrl)) imageUrl = null;
  if (!imageUrl) {
    const img = document.querySelector('#product_details img, .product-image img, #product_image, img.product-image');
    if (img) {
      const candidates = [
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.dataset.src,
        img.dataset.lazySrc,
        img.srcset ? img.srcset.split(' ')[0] : null,
        img.src,
      ];
      for (const c of candidates) {
        if (!isPlaceholder(c) && c.startsWith('http')) { imageUrl = c; break; }
      }
    }
  }
  console.log('[pricecharting] detail image:', { imageUrl });
  return { recentSalePrice, recentSaleDate, grade9Price, grade10Price, imageUrl };
}
