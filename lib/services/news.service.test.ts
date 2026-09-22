import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan Task 7 (plans/2026-07-24-news-sentiment-accuracy.md): the previous
 * two tests here asserted the exact 3-call concurrent Promise.all fan-out
 * this task removes (mocking analyzeAndUpdateArticle, asserting
 * toHaveBeenCalledTimes(3) plus interleaved start/end ordering) — both are
 * meaningless under batching and are replaced by this file, which asserts
 * getAnalyzedNewsForSymbol calls analyzeSentimentBatch exactly once for the
 * unanalyzed set, and correctly persists/skips per the batch's per-id map.
 */

const findManyMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    newsArticle: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      upsert: vi.fn(),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

const analyzeSentimentBatchMock = vi.fn();
vi.mock("./sentiment.service", () => ({
  sentimentService: {
    analyzeSentimentBatch: (...args: unknown[]) => analyzeSentimentBatchMock(...args),
  },
}));

import { NewsAggregationService } from "./news.service";

function unanalyzed(id: string) {
  return {
    id,
    title: `Article ${id}`,
    summary: "summary text",
    content: null,
    symbols: ["AAPL"],
    sentiment: null,
    relevanceScore: 0.6,
    publishedAt: new Date(),
  };
}

describe("NewsAggregationService.getAnalyzedNewsForSymbol — batched Gemini analysis (Task 7)", () => {
  let service: NewsAggregationService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
    service = new NewsAggregationService();
    vi.spyOn(service, "fetchNewsForSymbol").mockResolvedValue([]);
  });

  it("makes exactly ONE analyzeSentimentBatch call for N unanalyzed articles, not N calls", async () => {
    const unanalyzedArticles = [unanalyzed("a1"), unanalyzed("a2"), unanalyzed("a3")];
    findManyMock.mockResolvedValueOnce(unanalyzedArticles); // initial (fresh, no refresh needed)
    // Pad to REFRESH_TARGET_ARTICLE_COUNT so the staleness/refresh logic
    // doesn't trigger a second upstream fetch for this test's purposes —
    // 3 articles is below target, so a refresh WILL be attempted; stub
    // fetchNewsForSymbol returns [] so no new rows are saved and the
    // second findMany (post-refresh) returns the same unanalyzed set.
    findManyMock.mockResolvedValueOnce(unanalyzedArticles); // post-refresh re-read
    analyzeSentimentBatchMock.mockResolvedValueOnce({
      ok: true,
      results: new Map([
        ["a1", { sentiment: 0.5, sentimentLabel: "positive", confidence: 0.8, keyFactors: [], impact: "medium" as const }],
        ["a2", { sentiment: -0.3, sentimentLabel: "negative", confidence: 0.7, keyFactors: [], impact: "low" as const }],
        ["a3", { sentiment: 0.1, sentimentLabel: "neutral", confidence: 0.6, keyFactors: [], impact: "low" as const }],
      ]),
    });
    findManyMock.mockResolvedValueOnce([]); // final re-read after persisting

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: true });

    expect(analyzeSentimentBatchMock).toHaveBeenCalledTimes(1);
    const [articlesArg] = analyzeSentimentBatchMock.mock.calls[0];
    expect(articlesArg).toHaveLength(3);
  });

  it("passes id/title/content/symbol for each article to the batch call", async () => {
    const unanalyzedArticles = [unanalyzed("a1")];
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    analyzeSentimentBatchMock.mockResolvedValueOnce({ ok: true, results: new Map() });
    findManyMock.mockResolvedValueOnce([]);

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: true });

    const [articlesArg] = analyzeSentimentBatchMock.mock.calls[0];
    expect(articlesArg[0]).toMatchObject({ id: "a1", title: "Article a1", symbol: "AAPL" });
  });

  it("a response missing one article's id leaves that article unpersisted, others still written", async () => {
    const unanalyzedArticles = [unanalyzed("a1"), unanalyzed("a2")];
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    analyzeSentimentBatchMock.mockResolvedValueOnce({
      ok: true,
      results: new Map([
        ["a1", { sentiment: 0.5, sentimentLabel: "positive", confidence: 0.8, keyFactors: [], impact: "medium" as const }],
        ["a2", null], // absent from model's response
      ]),
    });
    findManyMock.mockResolvedValueOnce([]);

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: true });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1" } })
    );
  });

  it("a completely failed batch (ok: false) persists nothing — no article defaults to neutral", async () => {
    const unanalyzedArticles = [unanalyzed("a1"), unanalyzed("a2")];
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    analyzeSentimentBatchMock.mockResolvedValueOnce({ ok: false });
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);

    const result = await service.getAnalyzedNewsForSymbol("AAPL", { analyze: true });

    expect(updateMock).not.toHaveBeenCalled();
    // Articles remain in the returned set with sentiment: null (pending).
    expect(result.every((a: { sentiment: number | null }) => a.sentiment === null)).toBe(true);
  });

  it("does not call analyzeSentimentBatch when there are no unanalyzed articles", async () => {
    const analyzedOnly = [{ ...unanalyzed("a1"), sentiment: 0.2 }];
    findManyMock.mockResolvedValueOnce(analyzedOnly);
    findManyMock.mockResolvedValueOnce(analyzedOnly); // refresh triggered (below target count)

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: true });

    expect(analyzeSentimentBatchMock).not.toHaveBeenCalled();
  });

  it("does not call analyzeSentimentBatch when analyze: false", async () => {
    const unanalyzedArticles = [unanalyzed("a1")];
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);
    findManyMock.mockResolvedValueOnce(unanalyzedArticles);

    await service.getAnalyzedNewsForSymbol("AAPL", { analyze: false });

    expect(analyzeSentimentBatchMock).not.toHaveBeenCalled();
  });
});
