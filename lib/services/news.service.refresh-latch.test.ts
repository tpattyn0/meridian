import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan Task 2 (plans/2026-07-24-news-sentiment-accuracy.md, R1): the old
 * refresh trigger was `articles.length < 2` — once any 2 rows existed for a
 * symbol, the pipeline never fetched again, permanently (this is the
 * documented cause of the owner's "2 articles, 9.6/10" report). Replaced by
 * a staleness-aware condition: refresh when the DB has fewer than
 * REFRESH_TARGET_ARTICLE_COUNT in-window articles, OR the newest in-window
 * article is older than REFRESH_STALENESS_MS.
 */

const findManyMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    newsArticle: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

import { NewsAggregationService, REFRESH_TARGET_ARTICLE_COUNT, REFRESH_STALENESS_MS } from "./news.service";

function staleArticle(id: string, ageMs: number) {
  return {
    id,
    symbols: ["AAPL"],
    relevanceScore: 0.6,
    sentiment: 0.1,
    publishedAt: new Date(Date.now() - ageMs),
  };
}

describe("NewsAggregationService.getAnalyzedNewsForSymbol — refresh latch (Task 2)", () => {
  let service: NewsAggregationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NewsAggregationService();
    // fetchNewsForSymbol hits the network (Yahoo + RSS) — stub it directly
    // rather than mocking fetch/yahoo-finance for this unit.
    vi.spyOn(service, "fetchNewsForSymbol").mockResolvedValue([]);
  });

  it("refreshes when the DB holds 2 STALE articles (old latch would never refresh past 2)", async () => {
    findManyMock.mockResolvedValueOnce([
      staleArticle("a1", REFRESH_STALENESS_MS + 60_000),
      staleArticle("a2", REFRESH_STALENESS_MS + 120_000),
    ]);
    findManyMock.mockResolvedValueOnce([]); // second findMany, post-refresh

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: false });

    expect(service.fetchNewsForSymbol).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh when the DB holds a full, fresh set (>= target, newest within staleness TTL)", async () => {
    const freshSet = Array.from({ length: REFRESH_TARGET_ARTICLE_COUNT }, (_, i) =>
      staleArticle(`fresh-${i}`, 60_000) // 1 minute old, well within TTL
    );
    findManyMock.mockResolvedValueOnce(freshSet);

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: false });

    expect(service.fetchNewsForSymbol).not.toHaveBeenCalled();
  });

  it("refreshes when article count is below the target even if fresh", async () => {
    findManyMock.mockResolvedValueOnce([staleArticle("only-one", 60_000)]);
    findManyMock.mockResolvedValueOnce([staleArticle("only-one", 60_000)]);

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: false });

    expect(service.fetchNewsForSymbol).toHaveBeenCalledTimes(1);
  });

  it("the 5-minute in-process cache short-circuits a second immediate fetchNewsForSymbol call (real cache, not the mock)", async () => {
    // Exercise the real fetchNewsForSymbol (restore the spy) against a
    // service with both upstream fetchers stubbed, to assert its own
    // node-cache — not the refresh-decision logic above — actually
    // short-circuits back-to-back calls for the same symbol.
    vi.restoreAllMocks();
    const realService = new NewsAggregationService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yahooSpy = vi.spyOn(realService as any, "fetchYahooFinanceNews").mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rssSpy = vi.spyOn(realService as any, "fetchGoogleNewsRSS").mockResolvedValue([]);

    await realService.fetchNewsForSymbol("AAPL");
    await realService.fetchNewsForSymbol("AAPL");

    expect(yahooSpy).toHaveBeenCalledTimes(1);
    expect(rssSpy).toHaveBeenCalledTimes(1);
  });
});
