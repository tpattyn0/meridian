import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan Task 3 (R5): the three NewsArticle findMany calls in
 * getAnalyzedNewsForSymbol previously disagreed on time window (7 days /
 * unbounded / unbounded) while the UI caption claimed "last 30 days". All
 * three must now receive the identical `publishedAt.gte` bound derived from
 * NEWS_WINDOW_DAYS = 30.
 */

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    newsArticle: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("./sentiment.service", () => ({
  sentimentService: {
    analyzeSentimentBatch: vi.fn().mockResolvedValue({
      ok: true,
      results: new Map([["a1", { sentiment: 0.2, sentimentLabel: "neutral", confidence: 0.6, keyFactors: [], impact: "low" }]]),
    }),
  },
}));

import { NewsAggregationService, NEWS_WINDOW_DAYS } from "./news.service";

describe("NewsAggregationService.getAnalyzedNewsForSymbol — reconciled time windows (Task 3)", () => {
  let service: NewsAggregationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NewsAggregationService();
    vi.spyOn(service, "fetchNewsForSymbol").mockResolvedValue([
      {
        title: "Fresh article",
        url: "https://example.com/fresh",
        source: "Test",
        publishedAt: new Date(),
        symbols: ["AAPL"],
        relevanceScore: 0.6,
      },
    ]);
  });

  it("NEWS_WINDOW_DAYS is 30, matching the UI's 'last 30 days' caption", () => {
    expect(NEWS_WINDOW_DAYS).toBe(30);
  });

  it("all findMany calls receive an identical publishedAt.gte bound", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    // Force a refresh (empty first read) and an analyze pass (unanalyzed article)
    findManyMock.mockResolvedValueOnce([]); // initial read
    findManyMock.mockResolvedValueOnce([
      { id: "a1", sentiment: null, publishedAt: new Date(), relevanceScore: 0.6, symbols: ["AAPL"] },
    ]); // post-refresh read
    findManyMock.mockResolvedValueOnce([
      { id: "a1", sentiment: 0.2, publishedAt: new Date(), relevanceScore: 0.6, symbols: ["AAPL"] },
    ]); // post-analyze read

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: true });

    expect(findManyMock).toHaveBeenCalledTimes(3);

    const gates = findManyMock.mock.calls.map(
      (call) => (call[0] as { where: { publishedAt: { gte: Date } } }).where.publishedAt.gte
    );
    expect(gates).toHaveLength(3);
    // All three gte bounds must be the identical Date instance/value (same
    // windowStart computed once per call to getAnalyzedNewsForSymbol).
    expect(gates[0].getTime()).toBe(gates[1].getTime());
    expect(gates[1].getTime()).toBe(gates[2].getTime());

    const expectedMs = NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    expect(nowMs - gates[0].getTime()).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(nowMs - gates[0].getTime()).toBeLessThanOrEqual(expectedMs + 5000);
  });
});
