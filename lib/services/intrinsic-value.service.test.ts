import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * plans/2026-07-19-research-tab-fixes.md Task 6 (OD-2 resolved — method
 * spread): after computing the 5 valuation methods, calculateIntrinsicValue
 * also derives scenarioLow/scenarioHigh (min/max of methods with a valid
 * positive value) alongside the existing weighted-average intrinsicValue
 * (unaffected — stays the Base case). scenarioLow/scenarioHigh are null when
 * fewer than 2 methods produce a valid value. No live Yahoo/DB — @/lib/prisma
 * is mocked with FundamentalData/IndustryComparison rows fabricated per case.
 */

const { findUniqueFundamentalMock, findUniqueIndustryMock } = vi.hoisted(() => ({
  findUniqueFundamentalMock: vi.fn(),
  findUniqueIndustryMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fundamentalData: { findUnique: findUniqueFundamentalMock },
    industryComparison: { findUnique: findUniqueIndustryMock },
  },
}));

import { IntrinsicValueService } from "./intrinsic-value.service";

describe("IntrinsicValueService.calculateIntrinsicValue — scenario low/high (OD-2 method spread)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueIndustryMock.mockResolvedValue(null); // methods fall back to hardcoded industry defaults
  });

  it("returns scenarioLow < intrinsicValue < scenarioHigh when several methods produce valid values", async () => {
    // A well-covered symbol: eps, bookValue, pegRatio, peRatio all present so
    // DCF Lite, Graham Number, PEG Adjusted, P/E Multiple, and P/B Multiple
    // all resolve to a value > 0 — 5 valid methods.
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "AAPL",
      eps: 6,
      bookValue: 4,
      peRatio: 28,
      pegRatio: 2,
      earningsGrowth: 0.1,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("AAPL", 190);

    expect(result.validMethodCount).toBeGreaterThanOrEqual(2);
    expect(result.scenarioLow).not.toBeNull();
    expect(result.scenarioHigh).not.toBeNull();
    expect(result.scenarioLow as number).toBeLessThanOrEqual(result.intrinsicValue as number);
    expect(result.scenarioHigh as number).toBeGreaterThanOrEqual(result.intrinsicValue as number);
    expect(result.scenarioLow as number).toBeLessThanOrEqual(result.scenarioHigh as number);
  });

  it("returns null scenarioLow/scenarioHigh when fewer than 2 methods produce a valid value", async () => {
    // Only eps present (no bookValue, no pegRatio) — DCF Lite and P/E
    // Multiple can resolve, Graham Number/PEG Adjusted/P/B Multiple cannot.
    // Force down to <2 valid methods by also omitting eps so nothing
    // computes a positive value.
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "THINCOVERAGE",
      eps: null,
      bookValue: null,
      peRatio: null,
      pegRatio: null,
      earningsGrowth: null,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("THINCOVERAGE", 50);

    expect(result.validMethodCount).toBeLessThan(2);
    expect(result.scenarioLow).toBeNull();
    expect(result.scenarioHigh).toBeNull();
    // Base case is unaffected by scenario-range insufficiency — it still
    // reports whatever the weighted average produces (possibly null too,
    // but derived independently of the scenario range).
  });

  it("throws the sentinel error when no FundamentalData row exists (route maps this to 200 unavailable)", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce(null);

    await expect(IntrinsicValueService.calculateIntrinsicValue("NODATA", 100)).rejects.toThrow(
      "No fundamental data available"
    );
  });
});

/**
 * SCM-05 (reviews/2026-07-17-scoring-methodology.md,
 * plans/2026-07-26-scoring-methodology-phase1-correctness.md): DCF Lite's
 * terminal multiple previously used the stock's own uncapped trailing P/E
 * (up to <50) — circular, since an expensive stock is granted an expensive
 * exit multiple that validates its own price. Fixed: cap at min(trailingPE, 18).
 */
describe("IntrinsicValueService.calculateDCFLite — SCM-05 terminal multiple cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueIndustryMock.mockResolvedValue(null);
  });

  it("caps a high-P/E stock's terminal multiple at 18, not its own uncapped 40x", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "HIGHPE",
      eps: 5,
      bookValue: null,
      peRatio: 40,
      pegRatio: null,
      earningsGrowth: 0.1,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("HIGHPE", 300);

    const dcfLite = result.methods.find((m) => m.name === "DCF Lite");
    expect(dcfLite?.inputs.terminalPE).toBe(18);
  });

  it("uses the stock's own trailing P/E as the terminal multiple when it is below the 18 cap", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "LOWPE",
      eps: 5,
      bookValue: null,
      peRatio: 12,
      pegRatio: null,
      earningsGrowth: 0.1,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("LOWPE", 60);

    const dcfLite = result.methods.find((m) => m.name === "DCF Lite");
    expect(dcfLite?.inputs.terminalPE).toBe(12);
  });

  it("produces a materially lower fair value for the high-P/E case than the pre-fix circular (uncapped) value would have been", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "HIGHPE2",
      eps: 5,
      bookValue: null,
      peRatio: 40,
      pegRatio: null,
      earningsGrowth: 0.1,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("HIGHPE2", 300);
    const dcfLite = result.methods.find((m) => m.name === "DCF Lite");

    // Pre-fix value would have used terminalPE=40 (min(40, 50) — the old
    // <50 cutoff). Reconstruct that circular value and assert the fixed
    // (18x) value is materially lower.
    const g = Math.min(0.1, 0.15);
    const futureEPS = 5 * Math.pow(1 + g, 5);
    const preFixValue = (futureEPS * 40) / Math.pow(1.1, 5);
    const fixedValue = (futureEPS * 18) / Math.pow(1.1, 5);

    expect(dcfLite?.value).toBeCloseTo(fixedValue, 2);
    expect(dcfLite?.value as number).toBeLessThan(preFixValue);
  });
});

/**
 * SCM-13: `earningsGrowth || 0` previously collapsed MISSING growth data
 * (null) into a 0%-growth valuation, producing a strong "overvalued" vote
 * from a data gap that still entered the weighted average. Fixed: missing
 * growth ⇒ value: null (excluded); a genuinely reported 0 still produces a
 * real discounted, no-growth value.
 */
describe("IntrinsicValueService.calculateDCFLite — SCM-13 missing vs reported-zero growth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueIndustryMock.mockResolvedValue(null);
  });

  it("returns value: null for DCF Lite when earningsGrowth is missing (null), excluding it from the weighted average", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "NOGROWTHDATA",
      eps: 5,
      bookValue: null,
      peRatio: 20,
      pegRatio: null,
      earningsGrowth: null,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("NOGROWTHDATA", 100);

    const dcfLite = result.methods.find((m) => m.name === "DCF Lite");
    expect(dcfLite?.value).toBeNull();
  });

  it("still produces a real (discounted, no-growth) value when earningsGrowth is a genuinely reported 0", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "ZEROGROWTH",
      eps: 5,
      bookValue: null,
      peRatio: 20,
      pegRatio: null,
      earningsGrowth: 0,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("ZEROGROWTH", 100);

    const dcfLite = result.methods.find((m) => m.name === "DCF Lite");
    expect(dcfLite?.value).not.toBeNull();
    expect(dcfLite?.value as number).toBeGreaterThan(0);
    // 0% growth => futureEPS = eps, terminal 18 (min(20, 18)), discounted 5y at 10%.
    const expected = (5 * 18) / Math.pow(1.1, 5);
    expect(dcfLite?.value as number).toBeCloseTo(expected, 2);
  });
});

/**
 * SCM-06 (reviews/2026-07-17-scoring-methodology.md,
 * plans/2026-07-26-scoring-methodology-phase1-correctness.md): Graham Number
 * was assigned `high` confidence (3x ensemble weight) whenever eps/bookValue
 * were present — the LEAST applicable method for modern asset-light equities
 * (1934-era book-value ceilings). Fixed: always `low` confidence (1x weight)
 * regardless of data availability. Sector-gated elevation is SCM-14, out of
 * scope here.
 */
describe("IntrinsicValueService.calculateGrahamNumber — SCM-06 confidence default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueIndustryMock.mockResolvedValue(null);
  });

  it("assigns low confidence to Graham Number even when eps/bookValue are both present and valid", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "GRAHAMCO",
      eps: 6,
      bookValue: 4,
      peRatio: null,
      pegRatio: null,
      earningsGrowth: null,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("GRAHAMCO", 100);

    const graham = result.methods.find((m) => m.name === "Graham Number");
    expect(graham?.value).not.toBeNull();
    expect(graham?.confidence).toBe("low");
  });

  it("assigns low confidence when Graham Number's inputs are missing too (unchanged)", async () => {
    findUniqueFundamentalMock.mockResolvedValueOnce({
      symbol: "NOGRAHAMDATA",
      eps: null,
      bookValue: null,
      peRatio: null,
      pegRatio: null,
      earningsGrowth: null,
    });

    const result = await IntrinsicValueService.calculateIntrinsicValue("NOGRAHAMDATA", 100);

    const graham = result.methods.find((m) => m.name === "Graham Number");
    expect(graham?.value).toBeNull();
    expect(graham?.confidence).toBe("low");
  });
});
