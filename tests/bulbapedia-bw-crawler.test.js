import { describe, expect, it, vi } from 'vitest';
import {
  buildPageRevisionBatchUrl,
  selectPagesToFetch,
  buildCategoryMembersUrl,
  buildPageBatchUrl,
  collectCategoryMembers,
  createCrawlPlan,
  fetchJsonWithRetry,
  splitIntoBatches,
} from '../scripts/bulbapedia/bw-crawler.mjs';
import {
  BW_CRAWL_BATCH_SIZE,
  BW_SET_CATEGORIES,
} from '../scripts/bulbapedia/bw-config.mjs';

describe('BW category configuration', () => {
  it('covers all 17 expected JP set categories', () => {
    expect(BW_SET_CATEGORIES).toHaveLength(17);
    expect(new Set(BW_SET_CATEGORIES.map((category) => category.jpSetCode))).toEqual(new Set([
      'BW1', 'BW2', 'BW3', 'BW4', 'BW5', 'BW6', 'BW7', 'BW8', 'BW9', 'DS', 'SC', 'EB',
    ]));
  });

  it('uses unique category titles', () => {
    const titles = BW_SET_CATEGORIES.map((category) => category.categoryTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('BW crawl request construction', () => {
  it('builds a category request with optional continuation', () => {
    const requestUrl = buildCategoryMembersUrl('Category:Dark Rush cards', 'next-token');
    expect(requestUrl.searchParams.get('list')).toBe('categorymembers');
    expect(requestUrl.searchParams.get('cmtitle')).toBe('Category:Dark Rush cards');
    expect(requestUrl.searchParams.get('cmnamespace')).toBe('0');
    expect(requestUrl.searchParams.get('cmlimit')).toBe('max');
    expect(requestUrl.searchParams.get('cmcontinue')).toBe('next-token');
  });

  it('builds a revision request for a stable title batch', () => {
    const requestUrl = buildPageBatchUrl(['Card B', 'Card A']);
    expect(requestUrl.searchParams.get('prop')).toBe('revisions');
    expect(requestUrl.searchParams.get('rvprop')).toBe('ids|timestamp|content');
    expect(requestUrl.searchParams.get('titles')).toBe('Card B|Card A');
  });
});

describe('collectCategoryMembers', () => {
  it('follows MediaWiki continuation and preserves raw responses', async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        continue: { cmcontinue: 'next-token', continue: '-||' },
        query: { categorymembers: [{ pageid: 2, title: 'Card B' }] },
      })
      .mockResolvedValueOnce({
        batchcomplete: true,
        query: { categorymembers: [{ pageid: 1, title: 'Card A' }] },
      });
    const result = await collectCategoryMembers('Category:Dark Rush cards', requestJson);
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(result.members.map((member) => member.title)).toEqual(['Card A', 'Card B']);
    expect(result.responses).toHaveLength(2);
  });
});

describe('BW crawl planning', () => {
  it('splits arrays into stable bounded batches', () => {
    expect(splitIntoBatches(['A', 'B', 'C', 'D', 'E'], 2)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E'],
    ]);
  });

  it('deduplicates and sorts pages shared by multiple categories', () => {
    const crawlPlan = createCrawlPlan([
      { categoryTitle: 'Category:B', members: [{ pageid: 2, title: 'Card B' }, { pageid: 1, title: 'Card A' }] },
      { categoryTitle: 'Category:A', members: [{ pageid: 1, title: 'Card A' }, { pageid: 3, title: 'Card C' }] },
    ], 2);
    expect(crawlPlan.pageTitles).toEqual(['Card A', 'Card B', 'Card C']);
    expect(crawlPlan.pageBatches).toEqual([['Card A', 'Card B'], ['Card C']]);
    expect(crawlPlan.categoryCounts).toEqual([
      { categoryTitle: 'Category:A', pageCount: 2 },
      { categoryTitle: 'Category:B', pageCount: 2 },
    ]);
  });

  it('uses a conservative default batch size', () => {
    expect(BW_CRAWL_BATCH_SIZE).toBe(20);
  });
});

describe('fetchJsonWithRetry', () => {
  it('retries transient failures up to the configured limit', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ batchcomplete: true }) });
    const delay = vi.fn();
    await expect(fetchJsonWithRetry(new URL('https://example.com'), {
      delay,
      fetchImplementation,
      maxRetries: 2,
    })).resolves.toEqual({ batchcomplete: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('fails after exhausting retries', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchJsonWithRetry(new URL('https://example.com'), {
      delay: vi.fn(),
      fetchImplementation,
      maxRetries: 1,
    })).rejects.toThrow('Request failed after 2 attempts: 503');
  });
});

describe('incremental crawl helpers', () => {
  it('builds a revision-ids-only page URL', () => {
    const url = buildPageRevisionBatchUrl(['A', 'B']).toString();
    expect(url).toContain('prop=revisions');
    expect(url).toContain('rvprop=ids');
    expect(url).not.toContain('content');
  });

  it('re-fetches only new or changed pages', () => {
    const cached = new Map([
      ['A', { revisions: [{ revid: 10 }] }],
      ['B', { revisions: [{ revid: 20 }] }],
    ]);
    const current = new Map([['A', 10], ['B', 21], ['C', 30]]);
    const { toFetch, reused } = selectPagesToFetch(['A', 'B', 'C'], current, cached);
    expect(toFetch).toEqual(['B', 'C']);
    expect(reused).toEqual(['A']);
  });

  it('re-fetches everything when nothing is cached', () => {
    const { toFetch, reused } = selectPagesToFetch(['A'], new Map([['A', 1]]), new Map());
    expect(toFetch).toEqual(['A']);
    expect(reused).toEqual([]);
  });
});
