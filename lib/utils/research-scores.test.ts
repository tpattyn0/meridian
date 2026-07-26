import { describe, expect, it } from "vitest";
import {
  calibratedSentimentToScore,
  dampenForSample,
  MIN_CONFIDENT_SAMPLE,
  round1,
  sentimentToScore,
  upsideToScore,
  verdictLabel,
} from "./research-scores";

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

describe("calibratedSentimentToScore — non-linear map (plan Task 11)", () => {
  it("the neutral midpoint stays exactly 5.0", () => {
    expect(calibratedSentimentToScore(0)).toBe(5);
    expect(calibratedSentimentToScore(null)).toBe(5);
    expect(calibratedSentimentToScore(undefined)).toBe(5);
  });

  it("compresses extremes relative to the linear map — the same sentiment maps to a lower score above the midpoint", () => {
    const s = 0.5;
    expect(calibratedSentimentToScore(s)).toBeLessThan(sentimentToScore(s));
  });

  it("clamps out-of-range input and stays monotonic at the boundaries", () => {
    expect(calibratedSentimentToScore(-2)).toBe(0);
    expect(calibratedSentimentToScore(2)).toBe(10);
    expect(calibratedSentimentToScore(-1)).toBe(0);
    expect(calibratedSentimentToScore(1)).toBe(10);
  });

  it("is symmetric around the midpoint", () => {
    const pos = calibratedSentimentToScore(0.6);
    const neg = calibratedSentimentToScore(-0.6);
    expect(round1(pos - 5)).toBe(round1(5 - neg));
  });
});

describe("dampenForSample — thin-sample confidence damping (plan Task 11, S2)", () => {
  it("passes a score through unchanged at or above MIN_CONFIDENT_SAMPLE", () => {
    expect(dampenForSample(9, MIN_CONFIDENT_SAMPLE)).toBe(9);
    expect(dampenForSample(9, MIN_CONFIDENT_SAMPLE + 3)).toBe(9);
  });

  it("shrinks a score toward 5.0 continuously as the sample thins — no cliff at the boundary", () => {
    const at4 = dampenForSample(9, 4);
    const at3 = dampenForSample(9, 3);
    const at1 = dampenForSample(9, 1);
    // Monotonically closer to 5 as the sample count drops.
    expect(at4).toBeGreaterThan(at3);
    expect(at3).toBeGreaterThan(at1);
    expect(at1).toBeGreaterThan(5);
  });

  it("a zero-sample damp fully collapses to the neutral midpoint", () => {
    expect(dampenForSample(9, 0)).toBe(5);
  });

  it("damping never changes an already-neutral score", () => {
    expect(dampenForSample(5, 1)).toBe(5);
    expect(dampenForSample(5, 0)).toBe(5);
  });
});

describe("News & sentiment headline pipeline — owner's exact reported case (plan Task 11 acceptance)", () => {
  it("2 articles averaging +0.92 no longer produces 9.6, and lands below 8.0", () => {
    const calibrated = calibratedSentimentToScore(0.92);
    const damped = round1(dampenForSample(calibrated, 2));
    expect(damped).not.toBe(9.6);
    expect(damped).toBeLessThan(8.0);
  });

  it("a single +1.0 article does not produce 10.0", () => {
    const calibrated = calibratedSentimentToScore(1.0);
    const damped = round1(dampenForSample(calibrated, 1));
    expect(damped).not.toBe(10.0);
  });

  it("5+ uniformly strong-positive articles (+0.7 to +0.9, within Task 10's 'strong' anchor) still reach the 8+ band", () => {
    for (const s of [0.7, 0.75, 0.8, 0.85, 0.9]) {
      const calibrated = calibratedSentimentToScore(s);
      const damped = dampenForSample(calibrated, 5);
      expect(damped).toBeGreaterThanOrEqual(8.0);
    }
  });

  it("the neutral midpoint (5.0) is unaffected by sample size", () => {
    const calibrated = calibratedSentimentToScore(0);
    expect(dampenForSample(calibrated, 1)).toBe(5);
    expect(dampenForSample(calibrated, 10)).toBe(5);
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
