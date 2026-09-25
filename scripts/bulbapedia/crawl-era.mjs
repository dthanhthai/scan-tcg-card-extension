import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  buildPageBatchUrl,
  buildPageRevisionBatchUrl,
  collectCategoryMembers,
  createCrawlPlan,
  fetchJsonWithRetry,
  selectPagesToFetch,
  wait,
} from './bw-crawler.mjs';
import { getEraConfig } from './era-config.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function createSlug(value) {
  return value.toLowerCase().replace(/^category:/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function createBatchFileName(batchIndex) {
  return `batch-${String(batchIndex + 1).padStart(3, '0')}.json`;
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function loadCachedPages(cacheDirectory, crawlManifest) {
  const pages = new Map();
  if (!crawlManifest) return pages;
  for (const batch of crawlManifest.batches || []) {
    const response = await readJsonIfPresent(resolve(cacheDirectory, 'pages', batch.fileName));
    for (const page of response?.query?.pages || []) pages.set(page.title, page);
  }
  return pages;
}

// Crawls every category of one era into .cache/bulbapedia/<era> so artifact
// generation and tests stay offline and reproducible. With `incremental` the
// page content is only re-fetched when a page is new or its revision changed.
async function crawlEra(eraId, options = {}) {
  const config = getEraConfig(eraId);
  const cacheDirectory = resolve(PROJECT_ROOT, `.cache/bulbapedia/${eraId}`);
  const categoryDirectory = resolve(cacheDirectory, 'categories');
  const pageDirectory = resolve(cacheDirectory, 'pages');
  const requestJson = async (requestUrl) => {
    const responseData = await fetchJsonWithRetry(requestUrl, { maxRetries: config.crawlMaxRetries });
    await wait(config.crawlDelayMs);
    return responseData;
  };

  await Promise.all([
    mkdir(categoryDirectory, { recursive: true }),
    mkdir(pageDirectory, { recursive: true }),
  ]);
  const categoryResults = [];
  const categoryManifest = [];
  for (const category of config.setCategories) {
    console.log(`Fetching ${category.categoryTitle}`);
    const result = await collectCategoryMembers(category.categoryTitle, requestJson);
    const responseFiles = [];
    for (let responseIndex = 0; responseIndex < result.responses.length; responseIndex += 1) {
      const fileName = `${createSlug(category.categoryTitle)}-${String(responseIndex + 1).padStart(2, '0')}.json`;
      await writeJson(resolve(categoryDirectory, fileName), result.responses[responseIndex]);
      responseFiles.push(fileName);
    }
    categoryResults.push(result);
    categoryManifest.push({ ...category, pageCount: result.members.length, responseFiles });
  }
  const crawlPlan = createCrawlPlan(categoryResults, config.crawlBatchSize);
  const cachedPages = options.incremental
    ? await loadCachedPages(cacheDirectory, await readJsonIfPresent(resolve(cacheDirectory, 'crawl-manifest.json')))
    : new Map();
  if (options.incremental) console.log(`Incremental crawl: ${cachedPages.size} cached pages`);
  let refreshedCount = 0;
  const batchFiles = [];
  for (let batchIndex = 0; batchIndex < crawlPlan.pageBatches.length; batchIndex += 1) {
    const pageTitles = crawlPlan.pageBatches[batchIndex];
    const fileName = createBatchFileName(batchIndex);
    console.log(`Fetching page batch ${batchIndex + 1}/${crawlPlan.pageBatches.length}`);
    let responseData;
    if (options.incremental) {
      const revisionResponse = await requestJson(buildPageRevisionBatchUrl(pageTitles));
      const currentRevisionIds = new Map((revisionResponse.query?.pages || [])
        .map((page) => [page.title, page.revisions?.[0]?.revid]));
      const { toFetch, reused } = selectPagesToFetch(pageTitles, currentRevisionIds, cachedPages);
      refreshedCount += toFetch.length;
      const fetchedPages = new Map();
      if (toFetch.length > 0) {
        const contentResponse = await requestJson(buildPageBatchUrl(toFetch));
        for (const page of contentResponse.query?.pages || []) fetchedPages.set(page.title, page);
      }
      responseData = {
        query: {
          pages: pageTitles.map((title) => fetchedPages.get(title) || cachedPages.get(title)).filter(Boolean),
        },
      };
      console.log(`  reused ${reused.length}, refreshed ${toFetch.length}`);
    } else {
      responseData = await requestJson(buildPageBatchUrl(pageTitles));
    }
    await writeJson(resolve(pageDirectory, fileName), responseData);
    batchFiles.push({ fileName, pageCount: pageTitles.length, pageTitles });
  }
  if (options.incremental) console.log(`Incremental crawl refreshed ${refreshedCount} page(s)`);
  const crawlManifest = {
    schemaVersion: 1,
    batchSize: config.crawlBatchSize,
    categoryMemberships: categoryManifest.reduce((total, category) => total + category.pageCount, 0),
    uniquePages: crawlPlan.pageTitles.length,
    categories: categoryManifest.sort((left, right) => left.categoryTitle.localeCompare(right.categoryTitle)),
    batches: batchFiles,
  };
  await writeJson(resolve(cacheDirectory, 'crawl-manifest.json'), crawlManifest);
  console.log(`Cached ${crawlManifest.uniquePages} unique pages from ${crawlManifest.categoryMemberships} category memberships`);
  return crawlManifest;
}

export { crawlEra };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  crawlEra(process.argv[2] || 'bw', { incremental: process.argv.includes('--incremental') }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
