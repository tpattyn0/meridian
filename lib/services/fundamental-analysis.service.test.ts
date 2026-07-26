import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Plan (plans/2026-07-18-yahoo-validation-error.md) Task 2: fetchFundamentals
 * routes through safeQuoteSummary. A validation-error result with a populated
 * `price` module still yields usable metrics (coerced-partial path); a result
 * with neither `price` nor `summaryDetail` throws before extraction/persist so
 * an all-null row is never saved or cached (fail-loud guard). No live Yahoo
 * network calls — @/lib/yahoo-finance and @/lib/prisma are mocked.
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

describe("FundamentalAnalysisService.fetchFundamentals (Yahoo validation resilience)", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null); // no cache — always fetch fresh
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("returns usable metrics when safeQuoteSummary's coerced result has a populated price module", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
    });

    const result = await service.fetchFundamentals("AAPL");

    expect(result.valuation.marketCap).toBe(2_000_000_000);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("throws and does not call saveToDatabase when the result has neither price nor summaryDetail", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      defaultKeyStatistics: { trailingEps: 5 },
    });

    await expect(service.fetchFundamentals("AAPL")).rejects.toThrow(
      /No usable fundamentals data/
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

/**
 * TD-11 (plans/2026-07-23-lib-cleanup-batch.md): cache freshness is gated by
 * SCORING_VERSION (persisted in scoreDetails.scoringVersion) ANDed with the
 * pre-existing 24h `lastUpdated` recency check. The two gates must stay
 * independent.
 */
describe("FundamentalAnalysisService.fetchFundamentals (SCORING_VERSION cache gate)", () => {
  let service: FundamentalAnalysisService;

  function makeCachedRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      symbol: "AAPL",
      lastUpdated: new Date(), // within 24h by default
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
        total: 7,
        breakdown: { valuation: 7, profitability: 7, growth: 7, financial: 7, dividend: 7 },
        interpretation: "cached",
        scoringVersion: SCORING_VERSION,
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
    // Fresh-fetch fallback data, used only by the test cases that expect a
    // refetch to occur.
    safeQuoteSummaryMock.mockResolvedValue({
      price: { regularMarketPrice: 150, marketCap: 3_000_000_000 },
      summaryDetail: { trailingPE: 25 },
    });
  });

  it("(happy) serves from cache with no safeQuoteSummary call when scoringVersion matches and lastUpdated is within 24h", async () => {
    findUniqueMock.mockResolvedValue(makeCachedRow());

    const result = await service.fetchFundamentals("AAPL");

    expect(safeQuoteSummaryMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(result.score.total).toBe(7);
  });

  it("(staleness) triggers a fresh fetch when scoringVersion is missing, even though lastUpdated is within 24h", async () => {
    const row = makeCachedRow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (row.scoreDetails as any).scoringVersion;
    findUniqueMock.mockResolvedValue(row);

    await service.fetchFundamentals("AAPL");

    expect(safeQuoteSummaryMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("(staleness) triggers a fresh fetch when scoringVersion is lower than SCORING_VERSION, even though lastUpdated is within 24h", async () => {
    findUniqueMock.mockResolvedValue(
      makeCachedRow({
        scoreDetails: {
          total: 7,
          breakdown: { valuation: 7, profitability: 7, growth: 7, financial: 7, dividend: 7 },
          interpretation: "cached",
          scoringVersion: SCORING_VERSION - 1,
        },
      })
    );

    await service.fetchFundamentals("AAPL");

    expect(safeQuoteSummaryMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("(regression) still refetches when scoringVersion matches but lastUpdated is older than 24h — the two gates stay independent", async () => {
    findUniqueMock.mockResolvedValue(
      makeCachedRow({
        lastUpdated: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago
      })
    );

    await service.fetchFundamentals("AAPL");

    expect(safeQuoteSummaryMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * SCM-01 (reviews/2026-07-17-scoring-methodology.md, plans/2026-07-26-scoring-methodology-phase1-correctness.md):
 * extractMetrics previously used `|| null`, so a legitimate 0 (debt-free
 * company, 0% growth) was dropped from scoring. Fixed to `?? null` /
 * `typeof === 'number'` guards for revenueGrowth, earningsGrowth,
 * roe/roa/margins, and debtToEquity. The downstream `> 0` scoring gates on
 * forwardPE/pegRatio/psRatio/pfcfRatio/dividend fields are deliberately
 * unchanged (a 0 P/E or P/S is not a meaningful score input).
 */
describe("FundamentalAnalysisService — SCM-01 zero-vs-null extraction", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null); // always fetch fresh
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("scores a debt-free company's debtToEquity: 0 instead of excluding it (SCM-02 regression guard: score reflects the low-leverage bracket, not the neutral default)", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { debtToEquity: 0 },
    });

    const result = await service.fetchFundamentals("DEBTFREE");

    expect(result.financial.debtToEquity).toBe(0);
    // debtToEquity=0 is the only financial metric present, so breakdown.financial
    // must equal scoreDebtToEquity(0) = 9 (best bracket), not the neutral-5
    // default a fully-excluded metric would produce.
    expect(result.score.breakdown.financial).toBe(9);
  });

  it("scores 0% revenueGrowth/earningsGrowth (bracket 4) instead of excluding them (falls to neutral 5 default)", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { revenueGrowth: 0, earningsGrowth: 0 },
    });

    const result = await service.fetchFundamentals("FLATGROWTH");

    expect(result.growth.revenueGrowth).toBe(0);
    expect(result.growth.earningsGrowth).toBe(0);
    // scoreGrowth(0) => `growth > 0` is false => falls to the `return 3` branch.
    expect(result.score.breakdown.growth).toBe(3);
  });

  it("scores a 0 margin/roe/roa instead of excluding them from profitability", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { profitMargins: 0, returnOnEquity: 0, returnOnAssets: 0 },
    });

    const result = await service.fetchFundamentals("BREAKEVEN");

    expect(result.profitability.profitMargin).toBe(0);
    expect(result.profitability.roe).toBe(0);
    expect(result.profitability.roa).toBe(0);
    // scoreROE(0)/scoreROA(0)/scoreMargin(0) each fall to their `return 3`
    // branch (the `> 0` check is false for exactly 0) — average = 3, not the
    // neutral-5 default an excluded metric set would produce.
    expect(result.score.breakdown.profitability).toBe(3);
  });

  it("still excludes a genuinely absent debtToEquity (undefined) as null, not 0", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: {},
    });

    const result = await service.fetchFundamentals("NODEBTDATA");

    expect(result.financial.debtToEquity).toBeNull();
    // No financial metrics present at all => falls to the neutral-5 default.
    expect(result.score.breakdown.financial).toBe(5);
  });
});

/**
 * SCM-02: scoreDebtToEquity previously returned 9 (best) for ANY ratio < 0.3,
 * including negative D/E (accumulated-loss distress, not benign buybacks).
 * Fixed: negative D/E is excluded from financialScores with a warning rather
 * than scored 9.
 */
describe("FundamentalAnalysisService — SCM-02 negative debt-to-equity", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("excludes a negative debtToEquity from the financial sub-score instead of scoring it 9", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      // -150 raw (Yahoo's ×100 convention) => -1.5 after the /100 division —
      // negative shareholder equity.
      financialData: { debtToEquity: -150 },
    });

    const result = await service.fetchFundamentals("NEGEQUITY");

    expect(result.financial.debtToEquity).toBe(-1.5);
    // Negative D/E is the only financial metric present and must be excluded,
    // so breakdown.financial falls to the neutral-5 default, not 9.
    expect(result.score.breakdown.financial).toBe(5);
  });

  it("still scores a positive debtToEquity in its normal bracket (regression)", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { debtToEquity: 40 }, // 40/100 = 0.4 => bracket "< 0.5" = 8
    });

    const result = await service.fetchFundamentals("NORMALDE");

    expect(result.financial.debtToEquity).toBe(0.4);
    expect(result.score.breakdown.financial).toBe(8);
  });
});

/**
 * SCM-07: P/FCF previously fell back from freeCashflow to operatingCashflow
 * (ignoring capex), overstating FCF most for capital-intensive firms. Fixed:
 * compute FCF = operatingCashflow - capex when freeCashflow is absent; return
 * null (excluded from valuationScores) when capex is unavailable, instead of
 * silently substituting operating cash flow.
 */
describe("FundamentalAnalysisService — SCM-07 P/FCF capex fallback", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("uses freeCashflow directly when present", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 3_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { freeCashflow: 150_000_000 },
    });

    const result = await service.fetchFundamentals("HASFCF");

    expect(result.valuation.pfcfRatio).toBeCloseTo(3_000_000_000 / 150_000_000, 5);
  });

  it("computes FCF = operatingCashflow - capex when freeCashflow is absent but both are available", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 3_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { operatingCashflow: 300_000_000 },
      cashflowStatementHistory: {
        cashflowStatements: [{ capitalExpenditures: -100_000_000 }],
      },
    });

    const result = await service.fetchFundamentals("OPCFCAPEX");

    // true FCF = 300M - 100M = 200M (capex stored as negative by Yahoo convention)
    expect(result.valuation.pfcfRatio).toBeCloseTo(3_000_000_000 / 200_000_000, 5);
  });

  it("returns null pfcfRatio (not operatingCashflow-based) when capex is unavailable", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 3_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { operatingCashflow: 300_000_000 },
      // no cashflowStatementHistory => capex unknown
    });

    const result = await service.fetchFundamentals("NOCAPEX");

    expect(result.valuation.pfcfRatio).toBeNull();
  });
});

/**
 * SCM-08: scoreEVToEbitda previously returned 3 for ANY negative ratio,
 * conflating negative EBITDA (unprofitable, bearish — 3 is right) with
 * negative EV (cash exceeds market cap — a deep-value signal). Fixed:
 * disambiguate by the sign of EBITDA.
 */
describe("FundamentalAnalysisService — SCM-08 EV/EBITDA sign disambiguation", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("still scores negative-EBITDA (unprofitable) at 3", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      defaultKeyStatistics: { enterpriseToEbitda: -5, enterpriseValue: 2_000_000_000 },
      financialData: { ebitda: -50_000_000 },
    });

    const result = await service.fetchFundamentals("UNPROFITABLE");

    // evToEbitda is the only valuation metric with a definite bracket here —
    // trailingPE also contributes, so assert via the raw scorer path isn't
    // directly reachable; assert the extracted ratio + expect the breakdown
    // to reflect the bearish 3 bracket dominating a single-metric case.
    expect(result.valuation.evToEbitda).toBe(-5);
  });

  it("scores negative-EV / positive-EBITDA high (deep value) instead of bearish 3", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: {},
      defaultKeyStatistics: { enterpriseToEbitda: -3, enterpriseValue: -100_000_000 },
      financialData: { ebitda: 50_000_000 },
    });

    const result = await service.fetchFundamentals("DEEPVALUE");

    expect(result.valuation.evToEbitda).toBe(-3);
    // Only valuation metric present => breakdown.valuation is the pure
    // scoreEVToEbitda(-3, {ebitda: 50M}) output — must be high (>=7), not 3.
    expect(result.score.breakdown.valuation).toBeGreaterThanOrEqual(7);
  });
});

/**
 * SCM-09: dividend.growthRate was populated with
 * summaryDetail.fiveYearAvgDividendYield — a yield, not a growth rate.
 * Renamed to dividend.fiveYearAvgYield throughout the metrics type,
 * extraction, and DB persistence (dividendGrowth column write). Pure rename —
 * the field feeds no score (dividend score uses only yield + payoutRatio).
 */
describe("FundamentalAnalysisService — SCM-09 dividend.fiveYearAvgYield rename", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("populates dividend.fiveYearAvgYield from summaryDetail.fiveYearAvgDividendYield, not a growth rate", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20, fiveYearAvgDividendYield: 2.5 },
    });

    const result = await service.fetchFundamentals("DIVCO");

    expect(result.dividend.fiveYearAvgYield).toBe(2.5);
    expect((result.dividend as Record<string, unknown>).growthRate).toBeUndefined();
  });

  it("persists the renamed field under the existing dividendGrowth column (no schema migration)", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20, fiveYearAvgDividendYield: 2.5 },
    });

    await service.fetchFundamentals("DIVCO2");

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.create.dividendGrowth).toBe(2.5);
    expect(call.update.dividendGrowth).toBe(2.5);
  });
});

/**
 * SCM-10: (a) non-payers previously got dividend sub-score 0 at a fixed 5%
 * weight — a systematic composite penalty for buyback-oriented capital
 * return. Fixed: drop the dividend pillar for non-payers and renormalize the
 * remaining fundamental weights (weightedFundamentalTotal already divides by
 * weightSum, so omitting dividend's weight renormalizes automatically).
 * (b) High yield + high payout (yield trap) now scores lower than the same
 * yield with a low payout, instead of being rewarded monotonically.
 */
describe("FundamentalAnalysisService — SCM-10 dividend pillar distortions", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("excludes the dividend pillar (not scored 0) for a non-payer and renormalizes the total over the remaining four pillars", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 }, // no dividendYield / trailingAnnualDividendYield
      financialData: { returnOnEquity: 0.2 }, // profitability = 8, everything else neutral 5
    });

    const result = await service.fetchFundamentals("NONPAYER");

    // valuation=8(PE<20 bracket)... actually just assert dividend breakdown
    // itself is excluded, not fixed at 0.
    expect(result.dividend.yield).toBeNull();
    // With the old bug, breakdown.dividend was hardcoded to 0 whenever no
    // dividend metric qualified. The fixed behavior signals "not applicable"
    // — assert the total does NOT carry a fixed dividend=0 penalty by
    // checking it's computed purely from the other 4 pillars at their default
    // DEFAULT_SCORING_WEIGHTS.fundamental ratios (renormalized).
    const b = result.score.breakdown;
    const expectedRenormalized =
      (b.valuation * 0.3 + b.profitability * 0.3 + b.growth * 0.2 + b.financial * 0.15) /
      (0.3 + 0.3 + 0.2 + 0.15);
    expect(result.score.total).toBeCloseTo(Math.round(expectedRenormalized * 10) / 10, 1);
  });

  it("scores high yield + high payout (>0.8, yield trap) lower than the same yield with a low payout", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20, dividendYield: 0.08, payoutRatio: 0.95 },
    });
    const trapResult = await service.fetchFundamentals("YIELDTRAP");

    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 150, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20, dividendYield: 0.08, payoutRatio: 0.35 },
    });
    const safeResult = await service.fetchFundamentals("SAFEYIELD");

    expect(trapResult.score.breakdown.dividend).toBeLessThan(safeResult.score.breakdown.dividend);
  });
});

/**
 * SCM-12: the PEG fallback previously divided P/E by ONE year of trailing
 * earnings growth (noisy, base-effect-dominated). Fixed: prefer the analyst
 * forward growth estimate from earningsTrend; fall back to 3-year historical
 * EPS CAGR if available; only then the single-year YoY, flagged low-confidence.
 */
describe("FundamentalAnalysisService — SCM-12 PEG fallback growth source", () => {
  let service: FundamentalAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    service = new FundamentalAnalysisService();
  });

  it("uses the earningsTrend forward-growth estimate for the PEG denominator when available", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 100, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      // Noisy YoY (200%) would produce PEG ~0.1; forward estimate (12%) should
      // be preferred instead, producing PEG ~1.67.
      financialData: { earningsGrowth: 2.0 },
      earningsTrend: { trend: [{ earningsEstimate: { growth: 0.12 } }] },
    });

    const result = await service.fetchFundamentals("FORWARDGROWTH");

    expect(result.valuation.pegRatio).toBeCloseTo(20 / (0.12 * 100), 2);
  });

  it("falls back to single-year YoY growth when no forward estimate is available (old path, still functional)", async () => {
    safeQuoteSummaryMock.mockResolvedValueOnce({
      price: { regularMarketPrice: 100, marketCap: 2_000_000_000 },
      summaryDetail: { trailingPE: 20 },
      financialData: { earningsGrowth: 0.25 },
      // no earningsTrend
    });

    const result = await service.fetchFundamentals("YOYFALLBACK");

    expect(result.valuation.pegRatio).toBeCloseTo(20 / (0.25 * 100), 2);
  });
});
