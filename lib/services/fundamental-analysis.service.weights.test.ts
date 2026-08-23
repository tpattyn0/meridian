import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/utils/scoring-weights";

/**
 * Per-user fundamental reweight-on-read (plans/2026-07-20-configurable-scoring-weights.md,
 * Task 6, ADR-21). fetchFundamentals(symbol, fundamentalWeights?) must:
 * - return byte-identical `total` when `fundamentalWeights` is omitted
 * - return `total === weightedFundamentalTotal(breakdown, normalizeFundamentalWeights(weights))`
 *   when provided, with `breakdown` unchanged
 * - apply this on BOTH the fresh-fetch and the 24h-cache-hit path
 * - never rewrite the persisted cache row with a per-user total (saveToDatabase
 *   is called with the default-weighted total exactly once, on the fresh path)
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
    fundamentalData: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
  },
}));

import { FundamentalAnalysisService, SCORING_VERSION } from "./fundamental-analysis.service";
import { weightedFundamentalTotal, normalizeFundamentalWeights } from "@/lib/utils/scoring-weights";

const CUSTOM_WEIGHTS = { valuation: 1, profitability: 0, growth: 0, financial: 0, dividend: 0 };

describe("fetchFundamentals — per-user fundamental reweight (fresh path)", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null); // no cache — always fetch fresh
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
    safeQuoteSummaryMock.mockResolvedValue({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      defaultKeyStatistics: { priceToBook: 3 },
      financialData: { profitMargins: 0.2, returnOnEquity: 0.18, revenueGrowth: 0.1, earningsGrowth: 0.12, currentRatio: 1.8 },
    });
  });

  it("with no weights, returns the same total as the pre-feature default-weighted calculation", async () => {
    const result = await service.fetchFundamentals("AAPL");
    // Sanity: total is a real weighted average of the (already-rounded-to-1dp)
    // breakdown using defaults, rounded to 1dp the same way the service's own
    // calculateFundamentalScore rounds `total` (Math.round(x * 10) / 10).
    // SCM-10(a): this fixture mocks no dividend fields at all (a non-payer),
    // so the dividend pillar is excluded and the total is renormalized over
    // the other four pillars — the dividend weight must be zeroed here to
    // match, not the raw DEFAULT_SCORING_WEIGHTS.fundamental (which still
    // carries a 5% dividend weight).
    const nonPayerWeights = { ...DEFAULT_SCORING_WEIGHTS.fundamental, dividend: 0 };
    const expected = weightedFundamentalTotal(result.score.breakdown, nonPayerWeights);
    expect(result.score.total).toBeCloseTo(Math.round(expected * 10) / 10, 10);
  });

  it("with custom weights, total equals weightedFundamentalTotal(breakdown, normalized) and breakdown is unchanged", async () => {
    const defaultResult = await service.fetchFundamentals("AAPL");
    const customResult = await service.fetchFundamentals("AAPL", CUSTOM_WEIGHTS);

    expect(customResult.score.breakdown).toEqual(defaultResult.score.breakdown);
    const expectedTotal = weightedFundamentalTotal(customResult.score.breakdown, normalizeFundamentalWeights(CUSTOM_WEIGHTS));
    expect(customResult.score.total).toBeCloseTo(expectedTotal, 10);
    // Custom weights (100% valuation) should differ from the default-weighted total.
    expect(customResult.score.total).not.toBeCloseTo(defaultResult.score.total, 5);
  });

  it("saveToDatabase persists the DEFAULT-weighted total, never the per-user reweighted one", async () => {
    await service.fetchFundamentals("AAPL", CUSTOM_WEIGHTS);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const savedData = upsertMock.mock.calls[0][0].create;
    const savedScore = JSON.parse(JSON.stringify(savedData.scoreDetails));
    // SCM-10(a): same non-payer renormalization as the test above — this
    // fixture mocks no dividend fields, so the persisted default-weighted
    // total is computed with the dividend weight zeroed too.
    const nonPayerWeights = { ...DEFAULT_SCORING_WEIGHTS.fundamental, dividend: 0 };
    const expectedDefaultTotal = weightedFundamentalTotal(savedScore.breakdown, nonPayerWeights);
    expect(savedData.fundamentalScore).toBeCloseTo(Math.round(expectedDefaultTotal * 10) / 10, 10);
  });
});

describe("fetchFundamentals — per-user fundamental reweight (24h cache-hit path)", () => {
  let service: FundamentalAnalysisService;
  const breakdown = { valuation: 8, profitability: 4, growth: 6, financial: 5, dividend: 2 };
  const cachedRow = {
    symbol: "AAPL",
    lastUpdated: new Date(), // fresh, within 24h
    data: null,
    peRatio: 20,
    forwardPE: null,
    pegRatio: null,
    psRatio: null,
    pbRatio: null,
    pfcfRatio: null,
    evToEbitda: null,
    enterpriseValue: null,
    marketCap: 2_000_000_000,
    eps: null,
    forwardEps: null,
    bookValue: null,
    profitMargin: null,
    operatingMargin: null,
    roe: null,
    roa: null,
    roic: null,
    revenueGrowth: null,
    earningsGrowth: null,
    fcfGrowth: null,
    currentRatio: null,
    quickRatio: null,
    debtToEquity: null,
    interestCoverage: null,
    dividendYield: null,
    payoutRatio: null,
    dividendGrowth: null,
    scoreDetails: {
      total: weightedFundamentalTotal(breakdown, DEFAULT_SCORING_WEIGHTS.fundamental),
      breakdown,
      interpretation: "cached",
      // TD-11 (plans/2026-07-23-lib-cleanup-batch.md): the cache-freshness
      // gate now also requires scoreDetails.scoringVersion === current
      // SCORING_VERSION. Without this, the fixture's `lastUpdated: new
      // Date()` alone is no longer enough to be treated as a fresh 24h-cache
      // hit, and these tests would silently exercise the fresh-fetch path
      // instead. `total`/`breakdown` assertions below are unchanged.
      scoringVersion: SCORING_VERSION,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(cachedRow);
    service = new FundamentalAnalysisService();
  });

  it("with no weights, returns the cached default-weighted total unchanged", async () => {
    const result = await service.fetchFundamentals("AAPL");
    expect(result.score.total).toBeCloseTo(cachedRow.scoreDetails.total, 10);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("with custom weights, recomputes total from the cached breakdown without touching the DB", async () => {
    const result = await service.fetchFundamentals("AAPL", CUSTOM_WEIGHTS);
    const expected = weightedFundamentalTotal(breakdown, normalizeFundamentalWeights(CUSTOM_WEIGHTS));
    expect(result.score.total).toBeCloseTo(expected, 10);
    expect(result.score.breakdown).toEqual(breakdown);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
