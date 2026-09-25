import { BULBAPEDIA_API_URL } from './fixture-config.mjs';
import { BW_CRAWL_MAX_RETRIES } from './bw-config.mjs';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function buildCategoryMembersUrl(categoryTitle, continuation = null) {
  const requestUrl = new URL(BULBAPEDIA_API_URL);
  requestUrl.searchParams.set('action', 'query');
  requestUrl.searchParams.set('list', 'categorymembers');
  requestUrl.searchParams.set('cmtitle', categoryTitle);
  requestUrl.searchParams.set('cmnamespace', '0');
  requestUrl.searchParams.set('cmlimit', 'max');
  requestUrl.searchParams.set('format', 'json');
  requestUrl.searchParams.set('formatversion', '2');
  if (continuation) requestUrl.searchParams.set('cmcontinue', continuation);
  return requestUrl;
}

function buildPageBatchUrl(pageTitles) {
  const requestUrl = new URL(BULBAPEDIA_API_URL);
  requestUrl.searchParams.set('action', 'query');
  requestUrl.searchParams.set('prop', 'revisions');
  requestUrl.searchParams.set('rvprop', 'ids|timestamp|content');
  requestUrl.searchParams.set('rvslots', 'main');
  requestUrl.searchParams.set('titles', pageTitles.join('|'));
  requestUrl.searchParams.set('format', 'json');
  requestUrl.searchParams.set('formatversion', '2');
  return requestUrl;
}

function buildPageRevisionBatchUrl(pageTitles) {
  const requestUrl = new URL(BULBAPEDIA_API_URL);
  requestUrl.searchParams.set('action', 'query');
  requestUrl.searchParams.set('prop', 'revisions');
  requestUrl.searchParams.set('rvprop', 'ids');
  requestUrl.searchParams.set('titles', pageTitles.join('|'));
  requestUrl.searchParams.set('format', 'json');
  requestUrl.searchParams.set('formatversion', '2');
  return requestUrl;
}

// Decides which pages need a fresh content fetch during an incremental crawl.
// A page is re-fetched when it is new or when its current revision differs from
// the cached one; everything else reuses the cached page object.
function selectPagesToFetch(pageTitles, currentRevisionIds, cachedPages) {
  const toFetch = [];
  const reused = [];
  for (const title of pageTitles) {
    const cached = cachedPages.get(title);
    const cachedRevisionId = cached?.revisions?.[0]?.revid;
    const currentRevisionId = currentRevisionIds.get(title);
    if (!cached || currentRevisionId === undefined || cachedRevisionId !== currentRevisionId) toFetch.push(title);
    else reused.push(title);
  }
  return { toFetch, reused };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJsonWithRetry(requestUrl, options = {}) {
  const delay = options.delay || wait;
  const fetchImplementation = options.fetchImplementation || fetch;
  const maxRetries = options.maxRetries ?? BW_CRAWL_MAX_RETRIES;
  let lastStatus = 'network-error';
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImplementation(requestUrl, {
        headers: { 'User-Agent': 'PokemonTcgScanner/1.0 BW Bulbapedia crawler' },
      });
      lastStatus = response.status;
      if (response.ok) {
        const responseData = await response.json();
        if (responseData.error) throw new Error(`MediaWiki API error: ${responseData.error.info}`);
        return responseData;
      }
      if (!RETRYABLE_STATUS_CODES.has(response.status)) throw new Error(`Request failed: ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries || String(error.message).startsWith('MediaWiki API error') || String(error.message).startsWith('Request failed:')) throw error;
      lastStatus = error.message;
    }
    if (attempt < maxRetries) await delay(1000 * (attempt + 1));
  }
  throw new Error(`Request failed after ${maxRetries + 1} attempts: ${lastStatus}`);
}

async function collectCategoryMembers(categoryTitle, requestJson = fetchJsonWithRetry) {
  const members = [];
  const responses = [];
  let continuation = null;
  do {
    const responseData = await requestJson(buildCategoryMembersUrl(categoryTitle, continuation));
    responses.push(responseData);
    members.push(...(responseData.query?.categorymembers || []));
    continuation = responseData.continue?.cmcontinue || null;
  } while (continuation);
  members.sort((left, right) => left.title.localeCompare(right.title));
  return { categoryTitle, members, responses };
}

function splitIntoBatches(items, batchSize) {
  const batches = [];
  for (let index = 0; index < items.length; index += batchSize) batches.push(items.slice(index, index + batchSize));
  return batches;
}

function createCrawlPlan(categoryResults, batchSize) {
  const pageTitles = [...new Set(categoryResults.flatMap((category) => category.members.map((member) => member.title)))].sort();
  const categoryCounts = categoryResults
    .map((category) => ({ categoryTitle: category.categoryTitle, pageCount: category.members.length }))
    .sort((left, right) => left.categoryTitle.localeCompare(right.categoryTitle));
  return {
    categoryCounts,
    pageTitles,
    pageBatches: splitIntoBatches(pageTitles, batchSize),
  };
}

export {
  buildPageRevisionBatchUrl,
  selectPagesToFetch,
  buildCategoryMembersUrl,
  buildPageBatchUrl,
  collectCategoryMembers,
  createCrawlPlan,
  fetchJsonWithRetry,
  splitIntoBatches,
  wait,
};
