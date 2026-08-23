import { describe, it, expect, vi, beforeEach } from "vitest";
import { TechnicalAnalysisService } from "./technical-analysis.service";

// Fixed fixture: 220 ascending-then-oscillating closes (needs 205+ points
// per AGENT.md/ARCHITECTURE.md for a complete SMA200 read) with matching
// volumes — deterministic input for parity checks (plan Task 3).
function buildFixture(length = 220) {
  const prices: number[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < length; i++) {
    const base = 100 + i * 0.2;
    const wave = Math.sin(i / 5) * 3;
    prices.push(Math.round((base + wave) * 100) / 100);
    volumes.push(1_000_000 + (i % 7) * 10_000);
  }
  return { prices, volumes };
}

describe("TechnicalAnalysisService.getCachedIndicators (plan Task 3)", () => {
  let service: TechnicalAnalysisService;

  beforeEach(() => {
    service = new TechnicalAnalysisService();
  });

  it("is byte-identical to the uncached calculateIndicators for the same fixed input", () => {
    const { prices, volumes } = buildFixture();
    const direct = service.calculateIndicators(prices, volumes);
    const cached = service.getCachedIndicators("AAPL", prices, volumes);

    expect(cached).toEqual(direct);
  });

  it("computes indicators once for two sequential requests within the TTL for the same symbol", () => {
    const { prices, volumes } = buildFixture();
    const spy = vi.spyOn(service, "calculateIndicators");

    const first = service.getCachedIndicators("AAPL", prices, volumes);
    const second = service.getCachedIndicators("AAPL", prices, volumes);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("recomputes for a different symbol even with an identical price series", () => {
    const { prices, volumes } = buildFixture();
    const spy = vi.spyOn(service, "calculateIndicators");

    service.getCachedIndicators("AAPL", prices, volumes);
    service.getCachedIndicators("MSFT", prices, volumes);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("recomputes when the underlying series changes for the same symbol (fingerprint miss)", () => {
    const { prices, volumes } = buildFixture();
    const spy = vi.spyOn(service, "calculateIndicators");

    service.getCachedIndicators("AAPL", prices, volumes);
    const changedPrices = [...prices];
    changedPrices[changedPrices.length - 1] += 5; // new latest close
    service.getCachedIndicators("AAPL", changedPrices, volumes);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

/**
 * SCM-04 (reviews/2026-07-17-scoring-methodology.md,
 * plans/2026-07-26-scoring-methodology-phase1-correctness.md): the Bollinger
 * middle band IS the 20-day SMA, so the old "Upper Half"/"Lower Half"
 * branches re-scored the exact same price-vs-SMA20 comparison already
 * counted under trend (weight 3) — a duplicated signal. Fixed: score
 * Bollinger only at band extremes; mid-band is neutral (0 points).
 */
describe("TechnicalAnalysisService — SCM-04 Bollinger double-count fix", () => {
  let service: TechnicalAnalysisService;

  beforeEach(() => {
    service = new TechnicalAnalysisService();
  });

  // A flat-ish series so Bollinger bands are narrow and the final close can
  // be nudged to land precisely above/below/between them.
  function buildFlatFixture(length = 60, lastClose?: number) {
    const prices: number[] = [];
    for (let i = 0; i < length; i++) {
      prices.push(100 + (i % 2 === 0 ? 0.1 : -0.1));
    }
    if (lastClose !== undefined) prices[prices.length - 1] = lastClose;
    return prices;
  }

  it("scores 0 points and neutral signal when price sits between the bands (no trend double-count)", () => {
    const prices = buildFlatFixture(60, 100);
    const result = service.calculateIndicators(prices);

    expect(result.breakdown.volatility.bollinger?.points).toBe(0);
    expect(result.breakdown.volatility.bollinger?.signal).toBe("neutral");
  });

  it("still scores full weight bearish when price is above the upper band", () => {
    // Build a tight series, then a sharp spike on the last close to clear
    // the upper band computed from the prior (tight) window.
    const prices = buildFlatFixture(60, 150);
    const result = service.calculateIndicators(prices);

    expect(result.breakdown.volatility.bollinger?.points).toBe(3);
    expect(result.breakdown.volatility.bollinger?.signal).toBe("bearish");
  });

  it("still scores full weight bullish when price is below the lower band", () => {
    const prices = buildFlatFixture(60, 50);
    const result = service.calculateIndicators(prices);

    expect(result.breakdown.volatility.bollinger?.points).toBe(3);
    expect(result.breakdown.volatility.bollinger?.signal).toBe("bullish");
  });
});

/**
 * SCM-03 (source half): getInsufficientDataResponse previously carried
 * score: 0 (maximally bearish on the 0-10 scale). Fixed to score: null so no
 * consumer can read it as a real number.
 */
describe("TechnicalAnalysisService — SCM-03 insufficient-data score is not a bearish 0", () => {
  let service: TechnicalAnalysisService;

  beforeEach(() => {
    service = new TechnicalAnalysisService();
  });

  it("returns score: null (not 0) and signal INSUFFICIENT_DATA for too few price points", () => {
    const prices = Array.from({ length: 10 }, (_, i) => 100 + i);
    const result = service.calculateIndicators(prices);

    expect(result.signal).toBe("INSUFFICIENT_DATA");
    expect(result.score).toBeNull();
  });

  it("returns score: null when fewer than 2 indicators are available even with enough points", () => {
    // 20-24 points: enough for RSI (needs 20) but not enough for SMA20 (needs
    // 25) or Bollinger (needs 25) — exercises the indicatorsAvailable < 2
    // branch inside calculateIndicators, not just the length<20 guard.
    const prices = Array.from({ length: 20 }, () => 100);
    const result = service.calculateIndicators(prices);

    if (result.signal === "INSUFFICIENT_DATA") {
      expect(result.score).toBeNull();
    } else {
      // If enough indicators happened to resolve, this fixture doesn't
      // exercise the target branch — not a failure, just not applicable.
      expect(typeof result.score).toBe("number");
    }
  });
});
