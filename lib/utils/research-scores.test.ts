import { describe, expect, it } from "vitest";
import { analystVerdictLabel, round1, sentimentToScore, upsideToScore, verdictLabel } from "./research-scores";

describe("sentimentToScore", () => {
  it("maps -1..1 sentiment onto 0..10", () => {
    expect(sentimentToScore(-1)).toBe(0);
    expect(sentimentToScore(0)).toBe(5);
    expect(sentimentToScore(1)).toBe(10);
  });

  it("defaults missing sentiment to neutral (score 5)", () => {
    expect(sentimentToScore(null)).toBe(5);
    expect(sentimentToScore(undefined)).toBe(5);
  });

  it("clamps out-of-range input", () => {
    expect(sentimentToScore(-2)).toBe(0);
    expect(sentimentToScore(2)).toBe(10);
  });
});

describe("upsideToScore", () => {
  it("maps the documented boundary points", () => {
    expect(upsideToScore(-25)).toBe(0);
    // 0% sits at (0 - -25) / (30 - -25) = 25/55 of the range, not exactly the
    // midpoint (the range is asymmetric: -25 to +30) -> 4.5, not 5.
    expect(upsideToScore(0)).toBe(4.5);
    expect(upsideToScore(30)).toBe(10);
  });

  it("defaults missing upside to neutral (score 5)", () => {
    expect(upsideToScore(null)).toBe(5);
    expect(upsideToScore(undefined)).toBe(5);
  });

  it("clamps beyond the -25/+30 range", () => {
    expect(upsideToScore(-100)).toBe(0);
    expect(upsideToScore(100)).toBe(10);
  });
});

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(7.849)).toBe(7.8);
    expect(round1(7.85)).toBe(7.9);
    expect(round1(3)).toBe(3);
  });
});

describe("verdictLabel", () => {
  it("uses buy-oriented wording for wishlist context (not owned)", () => {
    expect(verdictLabel(9, "wishlist")).toBe("STRONG BUY");
    expect(verdictLabel(8.5, "wishlist")).toBe("STRONG BUY");
    expect(verdictLabel(7.5, "wishlist")).toBe("BUY");
    expect(verdictLabel(7.0, "wishlist")).toBe("BUY");
    expect(verdictLabel(6, "wishlist")).toBe("WATCH");
    expect(verdictLabel(5.0, "wishlist")).toBe("WATCH");
    expect(verdictLabel(4.9, "wishlist")).toBe("AVOID");
    expect(verdictLabel(0, "wishlist")).toBe("AVOID");
  });

  it("uses hold/position-management wording for portfolio context (owned)", () => {
    expect(verdictLabel(9, "portfolio")).toBe("BUY MORE");
    expect(verdictLabel(8.5, "portfolio")).toBe("BUY MORE");
    expect(verdictLabel(7.5, "portfolio")).toBe("HOLD");
    expect(verdictLabel(7.0, "portfolio")).toBe("HOLD");
    expect(verdictLabel(6, "portfolio")).toBe("REDUCE");
    expect(verdictLabel(5.0, "portfolio")).toBe("REDUCE");
    expect(verdictLabel(4.9, "portfolio")).toBe("SELL");
    expect(verdictLabel(0, "portfolio")).toBe("SELL");
  });

  it("the same score resolves to a different label depending on ownership context", () => {
    expect(verdictLabel(6, "wishlist")).toBe("WATCH");
    expect(verdictLabel(6, "portfolio")).toBe("REDUCE");
  });
});

/**
 * SCM-P1-I1: `analystVerdictLabel` must track the recentered SCM-11
 * boundaries (SB=9/B=7/H=4/S=1.5/SS=0) that
 * `AnalystRatingsService.getScoreInterpretation` uses — asserted here at the
 * exact scores the review flagged as diverging under the old, pre-recenter
 * component thresholds (6.5 -> old component said "BUY", service said
 * "Strong Buy"; 4.6 -> old "HOLD" vs. service "Buy"; 3.5 -> old "SELL" vs.
 * service "Hold"). A cross-check against the service's own
 * `scoreInterpretation` string lives in
 * `lib/services/analyst-ratings.service.test.ts` so the two cannot drift
 * apart silently again.
 */
describe("analystVerdictLabel", () => {
  it("matches the recentered getScoreInterpretation boundaries (SB=9/B=7/H=4/S=1.5/SS=0)", () => {
    expect(analystVerdictLabel(9)).toBe("STRONG BUY");
    expect(analystVerdictLabel(6)).toBe("STRONG BUY");
    expect(analystVerdictLabel(5.9)).toBe("BUY");
    expect(analystVerdictLabel(4.5)).toBe("BUY");
    expect(analystVerdictLabel(4.4)).toBe("HOLD");
    expect(analystVerdictLabel(3)).toBe("HOLD");
    expect(analystVerdictLabel(2.9)).toBe("SELL");
    expect(analystVerdictLabel(1.5)).toBe("SELL");
    expect(analystVerdictLabel(1.4)).toBe("STRONG SELL");
    expect(analystVerdictLabel(0)).toBe("STRONG SELL");
  });

  it("resolves the review's concrete divergence examples to the recentered label, not the stale pre-SCM-11 one", () => {
    // Old (stale) component thresholds would have said "BUY" at 6.5.
    expect(analystVerdictLabel(6.5)).toBe("STRONG BUY");
    // Old thresholds would have said "HOLD" at 4.6.
    expect(analystVerdictLabel(4.6)).toBe("BUY");
    // Old thresholds would have said "SELL" at 3.5.
    expect(analystVerdictLabel(3.5)).toBe("HOLD");
  });
});
