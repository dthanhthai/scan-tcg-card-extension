// Injected into a real app.getcollectr.com tab via chrome.scripting.executeScript.
// Runs INSIDE the Collectr SPA's DOM context after the search URL has loaded
// and results have rendered. Extracts product cards from the DOM.
//
// Collectr renders results as <div class="product-card ..."> (NOT <a> tags),
// so we select by class and parse the text content for name, set, number, price.

function extractCollectrListings() {
  const listings = [];
  const seen = new Set();

  const cards = document.querySelectorAll('div.product-card');
  for (const card of cards) {
    const text = card.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const priceMatch = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    const numberMatch = text.match(/(\d{1,3}\/\d{1,3})/);
    const cardNumber = numberMatch ? numberMatch[1] : '';

    const nameMatch = text.match(/^([A-Za-z][A-Za-z0-9\s.'\-]+?)\s*\((?:JP|EN)\)/);
    const productName = nameMatch ? nameMatch[1].trim() : text.substring(0, 60);

    let productUrl = location.href;
    const innerLink = card.querySelector('a[href*="/explore/product/"], a[href*="/product/"]');
    if (innerLink) {
      productUrl = innerLink.href;
    } else {
      const img = card.querySelector('img[src*="product_"]');
      if (img) {
        const srcMatch = img.src.match(/product_(\d+)/);
        if (srcMatch) {
          productUrl = `https://app.getcollectr.com/explore/product/${srcMatch[1]}`;
        }
      }
    }

    const cardImg = card.querySelector('img');
    const imageUrl = cardImg ? cardImg.src : null;
    console.log('[collectr] image:', { productUrl, imageUrl });

    const conditionMatch = text.match(/(Normal|Holofoil|Reverse Holofoil|Reverse Holo)/i);
    const condition = conditionMatch ? conditionMatch[1] : null;

    const key = `${productName}-${cardNumber}-${price}-${condition}`;
    if (seen.has(key)) continue;
    seen.add(key);

    listings.push({
      productName,
      cardNumber,
      price,
      productUrl,
      condition,
      imageUrl,
    });
  }

  return { listings: listings.slice(0, 10) };
}
