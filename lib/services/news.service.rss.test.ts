import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plan Task 6 (plans/2026-07-24-news-sentiment-accuracy.md): Google News RSS
 * source, parsed with cheerio in xmlMode, using a captured real RSS
 * response as a fixture (lib/services/__fixtures__/google-news-googl.xml)
 * so this test is deterministic rather than hitting the network.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: { newsArticle: { findMany: vi.fn(), upsert: vi.fn() } },
}));

const originalFetch = global.fetch;

import { NewsAggregationService } from "./news.service";

const FIXTURE_PATH = join(__dirname, "__fixtures__", "google-news-googl.xml");
const FIXTURE_XML = readFileSync(FIXTURE_PATH, "utf-8");

describe("NewsAggregationService.fetchGoogleNewsRSS — fixture parsing (Task 6)", () => {
  let service: NewsAggregationService;

  beforeEach(() => {
    service = new NewsAggregationService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses the captured fixture: item count, title-suffix stripping, source population, junk-title drop", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => FIXTURE_XML,
    }) as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const articles = await (service as any).fetchGoogleNewsRSS("GOOGL", "Alphabet Inc.");

    // 10 items in the fixture, 1 is the META_TITLE_QUOTE junk placeholder —
    // it must be dropped.
    expect(articles.length).toBe(9);

    // Every remaining title must NOT end in " - " + source (suffix stripped).
    for (const a of articles) {
      expect(a.title).not.toMatch(new RegExp(`\\s-\\s${a.source}$`));
      expect(a.source).toBeTruthy();
    }

    const junkTitleSurvived = articles.some((a: { title: string }) => a.title.includes("META_TITLE_QUOTE"));
    expect(junkTitleSurvived).toBe(false);

    const cnbcArticle = articles.find((a: { source: string }) => a.source === "CNBC");
    expect(cnbcArticle).toBeDefined();
    expect(cnbcArticle.title).toBe("Tesla, Alphabet lose hundreds of billions in value in post-earnings stock plunge");
    expect(cnbcArticle.title).not.toContain(" - CNBC");

    // summary/content are left undefined — title-only input (RSS <description> is markup, not a real snippet).
    expect(cnbcArticle.summary).toBeUndefined();
    expect(cnbcArticle.content).toBeUndefined();
  });

  it("returns [] rather than throwing on a non-OK HTTP status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "",
    }) as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const articles = await (service as any).fetchGoogleNewsRSS("GOOGL", "Alphabet Inc.");
    expect(articles).toEqual([]);
  });

  it("returns [] rather than throwing on a fetch rejection (network error / timeout)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const articles = await (service as any).fetchGoogleNewsRSS("GOOGL", "Alphabet Inc.");
    expect(articles).toEqual([]);
  });

  it("query construction: short symbol (<=3 chars) uses a plain quoted-name query", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, text: async () => "<rss><channel></channel></rss>" };
    }) as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).fetchGoogleNewsRSS("IBM", "International Business Machines Corporation");

    expect(capturedUrl).toContain("news.google.com/rss/search");
    // Company name (suffix-stripped) or symbol should appear, URL-encoded with + for spaces.
    expect(capturedUrl).toMatch(/stock/);
    expect(capturedUrl).not.toContain("%20");
  });

  it("query construction: longer symbol includes an OR clause with the cleaned symbol", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, text: async () => "<rss><channel></channel></rss>" };
    }) as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).fetchGoogleNewsRSS("GOOGL", "Alphabet Inc.");

    expect(capturedUrl).toContain("OR");
    expect(capturedUrl).toContain("GOOGL");
  });

  it("query construction: strips the exchange suffix for a European ticker (BTLS.BR)", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, text: async () => "<rss><channel></channel></rss>" };
    }) as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).fetchGoogleNewsRSS("BTLS.BR", "Barco NV");

    expect(capturedUrl).not.toContain("BTLS.BR");
    expect(capturedUrl).toContain("BTLS");
  });
});

describe("NewsAggregationService.fetchNewsForSymbol — merged/capped result (Task 6)", () => {
  it("caps the merged result at MAX_ARTICLES_PER_FETCH, applied after dedup", async () => {
    const service = new NewsAggregationService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, "fetchYahooFinanceNews").mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        title: `Alphabet unique yahoo headline number ${i}`,
        url: `https://example.com/yahoo-${i}`,
        source: "Yahoo Finance",
        publishedAt: new Date(),
        symbols: ["GOOGL"],
      }))
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, "fetchGoogleNewsRSS").mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        title: `Alphabet unique rss headline number ${i}`,
        url: `https://news.google.com/rss/articles/rss-${i}`,
        source: "Reuters",
        publishedAt: new Date(),
        symbols: ["GOOGL"],
      }))
    );

    const result = await service.fetchNewsForSymbol("GOOGL", "Alphabet Inc.");
    expect(result.length).toBeLessThanOrEqual(20);
  });
});
