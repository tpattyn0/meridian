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
import { analystVerdictLabel } from "@/lib/utils/research-scores";

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

/**
 * SCM-P1-S1: `formatCachedData` (the 24h cache-hit read path) previously did
 * `cached.score || 5` — a falsy check that silently collapsed a genuine
 * analyst score of exactly 0 (valid since SCM-11 moved the clamp floor from
 * 1 to 0 — a pure Strong-Sell consensus) to the neutral "no data" 5. Fixed
 * to `cached.score ?? 5`, which only substitutes on null/undefined.
 */
describe("AnalystRatingsService.fetchAnalystRatings — cache-hit score 0 vs. missing (SCM-P1-S1)", () => {
  let service: AnalystRatingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({});
    service = new AnalystRatingsService();
  });

  function cachedRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "1",
      symbol: "STRONGSELL",
      targetPrice: null,
      targetLowPrice: null,
      targetHighPrice: null,
      strongBuy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strongSell: 10,
      totalAnalysts: 10,
      averageRating: null,
      score: 0,
      scoreInterpretation: "Strong Sell - Analysts are very bearish on this stock",
      revisions: [],
      lastUpdated: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it("preserves a genuine cached score of 0 rather than substituting the neutral 5", async () => {
    findUniqueMock.mockResolvedValueOnce(cachedRow());

    const result = await service.fetchAnalystRatings("STRONGSELL");

    expect(result.score).toBe(0);
    expect(result.score).not.toBe(5);
  });

  it("still substitutes the neutral 5 when the cached score is genuinely null/undefined", async () => {
    // Prisma's Float column can't actually be null given the schema default,
    // but the fallback must still behave correctly if it ever were.
    findUniqueMock.mockResolvedValueOnce(cachedRow({ score: null as unknown as number }));

    const result = await service.fetchAnalystRatings("STRONGSELL");

    expect(result.score).toBe(5);
  });
});

/**
 * SCM-P1-I1: the review found that `components/analyst-ratings.tsx` computed
 * its own verdict-stamp label inline with stale pre-recenter thresholds,
 * silently disagreeing with `getScoreInterpretation` for most post-recenter
 * scores. The fix extracts a single shared `analystVerdictLabel` helper
 * (`lib/utils/research-scores.ts`) used by both the component and (via this
 * cross-check) verified here to agree with the service's own interpretation
 * string at representative post-recenter scores — this is the regression
 * test the review noted was missing (the existing SCM-11 test only asserted
 * the service's `scoreInterpretation`, never the component-facing label).
 */
describe("analystVerdictLabel agrees with AnalystRatingsService.scoreInterpretation (SCM-P1-I1)", () => {
  let service: AnalystRatingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new AnalystRatingsService();
  });

  it.each([
    // [label, trend distribution, expected verdict word fragment]
    // Distributions solved exactly against the SB=9/B=7/H=4/S=1.5/SS=0
    // weighted-average formula to land on the review's own example scores.
    ["a score of 6.5 (review's Strong-Buy example)", { strongBuy: 0, buy: 5, hold: 1, sell: 0, strongSell: 0 }, "Strong Buy"],
    ["a score of 4.6 (review's Buy example)", { strongBuy: 0, buy: 1, hold: 4, sell: 0, strongSell: 0 }, "Buy"],
    ["a score of 3.5 (review's Hold example)", { strongBuy: 0, buy: 0, hold: 4, sell: 1, strongSell: 0 }, "Hold"],
    ["a score of exactly 1.5 (Sell boundary)", { strongBuy: 0, buy: 0, hold: 0, sell: 1, strongSell: 0 }, "Sell"],
    ["a pure strong-sell consensus (score 0)", { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 1 }, "Strong Sell"],
  ])("%s: component label matches the service interpretation's verdict word", async (_label, trend, expectedWordFragment) => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      financialData: { targetMeanPrice: 175 },
      recommendationTrend: { trend: [trend] },
    });

    const result = await service.fetchAnalystRatings(`AGREE-${expectedWordFragment.replace(/\s/g, "")}`);
    const componentLabel = analystVerdictLabel(result.score);

    // scoreInterpretation reads e.g. "Strong Buy - Analysts are..."; the
    // component label reads e.g. "STRONG BUY". Compare case-insensitively.
    expect(result.scoreInterpretation.toLowerCase()).toContain(expectedWordFragment.toLowerCase());
    expect(componentLabel.toLowerCase()).toBe(expectedWordFragment.toLowerCase());
  });
});
