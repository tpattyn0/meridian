import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan (plans/2026-07-18-yahoo-validation-error.md) Task 4: fetchAnalystRatings
 * routes through safeQuoteSummary with NO added hard module guard — a missing
 * `recommendationTrend` in the coerced result legitimately means "no analyst
 * coverage" and must resolve to the existing neutral path (totalAnalysts: 0,
 * neutral score), not a throw. No live Yahoo network calls — @/lib/yahoo-finance
 * and @/lib/prisma are mocked.
 */

const { safeQuoteSummaryMock, findUniqueMock, upsertMock } = vi.hoisted(() => ({
  safeQuoteSummaryMock: vi.fn(),
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/yahoo-finance", () => ({
  default: {},
  safeQuoteSummary: safeQuoteSummaryMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    analystRating: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
  },
}));

import { AnalystRatingsService, filterRecentRevisions, AnalystRevision } from "./analyst-ratings.service";

/**
 * plans/2026-07-20-analyst-revisions-nvda-fix.md Task 1: filterRecentRevisions
 * is a pure helper (no Yahoo/Prisma mocks needed) — it windows extractRevisions'
 * output to the last `windowDays` (inclusive of the boundary instant), excludes
 * future-dated entries, sorts newest-first, and caps to `cap` entries. `now` is
 * an explicit parameter so the boundary math is deterministic here.
 */
describe("filterRecentRevisions", () => {
  const NOW = new Date("2026-07-20T12:00:00.000Z");

  function makeRevision(daysAgo: number, firm = "Firm"): AnalystRevision {
    const date = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return {
      firm,
      action: "up",
      fromGrade: "Hold",
      toGrade: "Buy",
      date: date.toISOString(),
    };
  }

  it("keeps only entries within the last 90 days, sorted newest-first", () => {
    const recent1 = makeRevision(1, "Recent1");
    const recent2 = makeRevision(30, "Recent2");
    const recent3 = makeRevision(89, "Recent3");
    const old = makeRevision(200, "Old");
    // future-dated entry (negative daysAgo => in the future)
    const future = makeRevision(-5, "Future");

    const result = filterRecentRevisions([old, recent3, future, recent1, recent2], NOW);

    expect(result.map((r) => r.firm)).toEqual(["Recent1", "Recent2", "Recent3"]);
  });

  it("includes a revision dated exactly 90 days ago (boundary inclusive)", () => {
    const boundary = makeRevision(90, "Boundary90");

    const result = filterRecentRevisions([boundary], NOW);

    expect(result.map((r) => r.firm)).toEqual(["Boundary90"]);
  });

  it("excludes a revision dated exactly 91 days ago (boundary exclusive)", () => {
    const boundary = makeRevision(91, "Boundary91");

    const result = filterRecentRevisions([boundary], NOW);

    expect(result).toEqual([]);
  });

  it("excludes future-dated entries", () => {
    const future = makeRevision(-1, "Future");

    const result = filterRecentRevisions([future], NOW);

    expect(result).toEqual([]);
  });

  it("caps an in-window set larger than 25 to the 25 most recent", () => {
    const revisions = Array.from({ length: 30 }, (_, i) => makeRevision(i, `Firm${i}`));

    const result = filterRecentRevisions(revisions, NOW);

    expect(result).toHaveLength(25);
    // newest-first: Firm0 (0 days ago) through Firm24 (24 days ago)
    expect(result.map((r) => r.firm)).toEqual(
      Array.from({ length: 25 }, (_, i) => `Firm${i}`)
    );
  });

  it("supports custom windowDays and cap parameters", () => {
    const revisions = [makeRevision(5), makeRevision(20), makeRevision(40)];

    const result = filterRecentRevisions(revisions, NOW, 30, 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(revisions[0]);
  });
});

describe("AnalystRatingsService.fetchAnalystRatings (Yahoo validation resilience)", () => {
  let service: AnalystRatingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null); // no cache — always fetch fresh
    upsertMock.mockResolvedValue({});
    service = new AnalystRatingsService();
  });

  it("returns totalAnalysts: 0 and a neutral score when the coerced result has no recommendationTrend module", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      // recommendationTrend intentionally absent — simulates Yahoo drift
      // coercing that module away, which is a valid "no coverage" state.
    });

    const result = await service.fetchAnalystRatings("AAPL");

    expect(result.totalAnalysts).toBe(0);
    expect(result.score).toBe(5);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("returns populated ratings when the coerced result has a valid recommendationTrend module", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: {
        trend: [{ strongBuy: 5, buy: 3, hold: 2, sell: 0, strongSell: 0 }],
      },
    });

    const result = await service.fetchAnalystRatings("AAPL");

    expect(result.totalAnalysts).toBe(10);
    expect(result.score).toBeGreaterThan(5);
  });
});

/**
 * plans/2026-07-19-research-tab-fixes.md Task 2/3: targetLowPrice/
 * targetHighPrice and analyst revisions are plumbed from Yahoo's
 * financialData/upgradeDowngradeHistory modules (already fetched) through
 * the extractor into the response. Non-persisted (OD-3/A4) — present on a
 * fresh fetch, null/[] on a cache hit.
 */
describe("AnalystRatingsService — targetLow/High and revisions mapping", () => {
  let service: AnalystRatingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new AnalystRatingsService();
  });

  it("maps targetLowPrice/targetHighPrice when financialData returns them", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175, targetLowPrice: 140, targetHighPrice: 210 },
      recommendationTrend: { trend: [{ strongBuy: 5, buy: 3, hold: 2, sell: 0, strongSell: 0 }] },
    });

    const result = await service.fetchAnalystRatings("AAPL");

    expect(result.targetLowPrice).toBe(140);
    expect(result.targetHighPrice).toBe(210);
  });

  it("defaults targetLowPrice/targetHighPrice to null when financialData omits them", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: { trend: [{ strongBuy: 5, buy: 3, hold: 2, sell: 0, strongSell: 0 }] },
    });

    const result = await service.fetchAnalystRatings("ENGI.PA");

    expect(result.targetLowPrice).toBeNull();
    expect(result.targetHighPrice).toBeNull();
  });

  it("maps upgradeDowngradeHistory.history into typed revisions when present", async () => {
    const epochGradeDate = new Date("2026-06-01T00:00:00.000Z");
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: { trend: [{ strongBuy: 5, buy: 3, hold: 2, sell: 0, strongSell: 0 }] },
      upgradeDowngradeHistory: {
        history: [
          { firm: "Morgan Stanley", toGrade: "Overweight", fromGrade: "Equal-Weight", action: "up", epochGradeDate },
          { firm: "Barclays", toGrade: "Equal-Weight", fromGrade: "Equal-Weight", action: "main", epochGradeDate },
        ],
      },
    });

    const result = await service.fetchAnalystRatings("AAPL");

    expect(result.revisions).toHaveLength(2);
    expect(result.revisions[0]).toEqual({
      firm: "Morgan Stanley",
      action: "up",
      fromGrade: "Equal-Weight",
      toGrade: "Overweight",
      date: epochGradeDate.toISOString(),
    });
  });

  it("returns an empty revisions array when upgradeDowngradeHistory is absent or empty", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: { trend: [{ strongBuy: 5, buy: 3, hold: 2, sell: 0, strongSell: 0 }] },
      // upgradeDowngradeHistory intentionally absent
    });

    const result = await service.fetchAnalystRatings("ENGI.PA");

    expect(result.revisions).toEqual([]);
  });

  it("returns persisted targetLow/High and revisions on a cache hit (plans/2026-07-20-analyst-revisions-nvda-fix.md Task 2)", async () => {
    const persistedRevisions = [
      {
        firm: "Morgan Stanley",
        action: "up",
        fromGrade: "Equal-Weight",
        toGrade: "Overweight",
        date: "2026-06-01T00:00:00.000Z",
      },
    ];
    findUniqueMock.mockResolvedValueOnce({
      symbol: "NVDA",
      targetPrice: 175,
      targetLowPrice: 140,
      targetHighPrice: 210,
      strongBuy: 5,
      buy: 3,
      hold: 2,
      sell: 0,
      strongSell: 0,
      totalAnalysts: 10,
      averageRating: 2,
      score: 7,
      scoreInterpretation: "Buy",
      revisions: persistedRevisions,
      lastUpdated: new Date(), // fresh — within 24h
    });

    const result = await service.fetchAnalystRatings("NVDA");

    expect(result.targetLowPrice).toBe(140);
    expect(result.targetHighPrice).toBe(210);
    expect(result.revisions).toEqual(persistedRevisions);
    expect(safeQuoteSummaryMock).not.toHaveBeenCalled();
  });

  it("gracefully returns null/[] on a cache hit when the revisions/low/high columns are absent (back-compat for rows written before the migration)", async () => {
    findUniqueMock.mockResolvedValueOnce({
      symbol: "AAPL",
      targetPrice: 175,
      // targetLowPrice/targetHighPrice/revisions intentionally absent —
      // simulates a row written before the migration landed.
      strongBuy: 5,
      buy: 3,
      hold: 2,
      sell: 0,
      strongSell: 0,
      totalAnalysts: 10,
      averageRating: 2,
      score: 7,
      scoreInterpretation: "Buy",
      lastUpdated: new Date(), // fresh — within 24h
    });

    const result = await service.fetchAnalystRatings("AAPL");

    expect(result.targetLowPrice).toBeNull();
    expect(result.targetHighPrice).toBeNull();
    expect(result.revisions).toEqual([]);
    expect(safeQuoteSummaryMock).not.toHaveBeenCalled();
  });
});

/**
 * SCM-11 (reviews/2026-07-17-scoring-methodology.md,
 * plans/2026-07-26-scoring-methodology-phase1-correctness.md): the old
 * mapping (SB=10, B=8, H=5, S=2, SS=0) landed nearly every buy-skewed
 * consensus at 6.5-8.5, injecting a near-constant bullish offset into 15% of
 * the composite. Recentered to SB=9/B=7/H=4/S=1.5/SS=0 (review's option 3)
 * so a typical buy-skewed distribution lands approximately 5-6.
 */
describe("AnalystRatingsService.calculateScore — SCM-11 recentered rating mapping", () => {
  let service: AnalystRatingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new AnalystRatingsService();
  });

  it("scores a realistic buy-skewed consensus (~55% buy / 40% hold / 5% sell) around 5-6, not 6.5-8.5", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: {
        trend: [{ strongBuy: 0, buy: 55, hold: 40, sell: 5, strongSell: 0 }],
      },
    });

    const result = await service.fetchAnalystRatings("TYPICAL");

    expect(result.score).toBeGreaterThanOrEqual(5);
    expect(result.score).toBeLessThanOrEqual(6);
  });

  it("still scores a genuine strong-buy consensus high", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: {
        trend: [{ strongBuy: 18, buy: 2, hold: 0, sell: 0, strongSell: 0 }],
      },
    });

    const result = await service.fetchAnalystRatings("STRONGBUY");

    expect(result.score).toBeGreaterThanOrEqual(8);
  });

  it("scores a sell-heavy consensus low", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 50 },
      recommendationTrend: {
        trend: [{ strongBuy: 0, buy: 0, hold: 2, sell: 8, strongSell: 10 }],
      },
    });

    const result = await service.fetchAnalystRatings("SELLHEAVY");

    expect(result.score).toBeLessThanOrEqual(2);
  });

  it("keeps interpretation labels sensible at the recentered boundaries", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: {
        trend: [{ strongBuy: 0, buy: 55, hold: 40, sell: 5, strongSell: 0 }],
      },
    });

    const result = await service.fetchAnalystRatings("LABELCHECK");

    expect(result.scoreInterpretation).toMatch(/Buy|Hold/);
  });
});
