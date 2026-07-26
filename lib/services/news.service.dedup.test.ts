import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan Task 4 (plans/2026-07-24-news-sentiment-accuracy.md): deduplicateNews
 * is wired into fetchNewsForSymbol on the merged Yahoo + RSS array, before
 * relevance scoring and before the cap. Fixed to use two sets (title/URL)
 * instead of one mixed set. Normalized title is the load-bearing
 * cross-source key: RSS <link> values are Google redirect URLs, so a
 * cross-source duplicate (same story, differing URL and source) can only be
 * caught by title.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: { newsArticle: { findMany: vi.fn(), upsert: vi.fn() } },
}));

import { NewsAggregationService } from "./news.service";

describe("NewsAggregationService — dedup wiring (Task 4)", () => {
  let service: NewsAggregationService;

  beforeEach(() => {
    service = new NewsAggregationService();
  });

  it("a cross-source duplicate (same title, differing URL and source) survives only once, before the cap is applied", async () => {
    const sameStoryYahoo = {
      title: "Alphabet Drops 6% on Soaring AI Capex Despite 82% Cloud Surge",
      url: "https://finance.yahoo.com/news/alphabet-drops-6",
      source: "Yahoo Finance",
      publishedAt: new Date(),
      symbols: ["GOOGL"],
    };
    const sameStoryRss = {
      // Identical title, different URL (Google redirect) and source —
      // exactly the cross-source shape RSS <link> guarantees (100/100
      // measured Google redirect URLs, never a publisher URL).
      title: "Alphabet Drops 6% on Soaring AI Capex Despite 82% Cloud Surge",
      url: "https://news.google.com/rss/articles/some-redirect-id",
      source: "24/7 Wall St.",
      publishedAt: new Date(),
      symbols: ["GOOGL"],
    };
    const uniqueArticle = {
      title: "Alphabet earnings are out and the stock is falling",
      url: "https://marketwatch.com/alphabet-earnings",
      source: "MarketWatch",
      publishedAt: new Date(),
      symbols: ["GOOGL"],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, "fetchYahooFinanceNews").mockResolvedValue([sameStoryYahoo]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, "fetchGoogleNewsRSS").mockResolvedValue([sameStoryRss, uniqueArticle]);

    const result = await service.fetchNewsForSymbol("GOOGL", "Alphabet Inc.");

    const dropTitles = result.filter((a) => a.title.startsWith("Alphabet Drops 6%"));
    expect(dropTitles).toHaveLength(1);
    expect(result.some((a) => a.title.startsWith("Alphabet earnings are out"))).toBe(true);
  });

  it("dedup happens before the relevance filter/cap — a duplicate never consumes two slots even under a small cap", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service2 = new NewsAggregationService() as any;
    const dupeTitle = "Alphabet earnings are out and the stock is falling";
    const articles = Array.from({ length: 5 }, (_, i) => ({
      title: dupeTitle,
      url: `https://example.com/dupe-${i}`,
      source: "Test",
      publishedAt: new Date(),
      symbols: ["GOOGL"],
    }));

    const deduped = service2.deduplicateNews(articles);
    expect(deduped).toHaveLength(1);
  });

  it("two sets: a title match alone (differing URL) is caught even when the URL has never been seen", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service2 = new NewsAggregationService() as any;
    const a = { title: "Same Story Here", url: "https://a.example.com/1", source: "A", publishedAt: new Date(), symbols: ["GOOGL"] };
    const b = { title: "Same Story Here", url: "https://b.example.com/2", source: "B", publishedAt: new Date(), symbols: ["GOOGL"] };

    const result = service2.deduplicateNews([a, b]);
    expect(result).toHaveLength(1);
  });

  it("two sets: a URL match alone (differing title) is caught by the URL set", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service2 = new NewsAggregationService() as any;
    const a = { title: "Title One", url: "https://a.example.com/same", source: "A", publishedAt: new Date(), symbols: ["GOOGL"] };
    const b = { title: "Title Two (edited headline)", url: "https://a.example.com/same", source: "A", publishedAt: new Date(), symbols: ["GOOGL"] };

    const result = service2.deduplicateNews([a, b]);
    expect(result).toHaveLength(1);
  });
});
