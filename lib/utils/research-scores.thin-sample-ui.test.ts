import { describe, expect, it } from "vitest";
import { MIN_CONFIDENT_SAMPLE, calibratedSentimentToScore, dampenForSample, round1 } from "./research-scores";

/**
 * Plan Task 12 (plans/2026-07-24-news-sentiment-accuracy.md, DESIGN.md
 * "Thin-sample honesty"): components/news-feed.tsx has no render-test seam
 * (TD-38 — this repo's vitest config has no jsdom/@testing-library/react).
 * This test locks the exact decision values the component's JSX consumes
 * (score band, verdictKickerBanded, thin-sample flag) so a future change to
 * the underlying pure math is caught here even without a component-render
 * test. The component itself must be verified manually/visually per TD-38's
 * documented precedent (see this session's summary).
 */
describe("News & sentiment thin-sample UI decision values (Task 12)", () => {
  function computeCardState(avgSentiment: number, analysedCount: number) {
    const score = round1(dampenForSample(calibratedSentimentToScore(avgSentiment), analysedCount));
    const isThinSample = analysedCount > 0 && analysedCount < MIN_CONFIDENT_SAMPLE;
    const trendKicker = score >= 7 ? "Warming" : score >= 4 ? "Steady" : "Cooling";
    const trendBanded = score >= 7 && !isThinSample;
    return { score, isThinSample, trendKicker, trendBanded };
  }

  it("owner's exact reported case (2 articles, avg +0.92): damped score lands in --amber (4-7) band, not --up", () => {
    const state = computeCardState(0.92, 2);
    expect(state.isThinSample).toBe(true);
    expect(state.score).toBeGreaterThanOrEqual(4);
    expect(state.score).toBeLessThan(8);
    // scoreBandClass (lib/utils/score-band.ts) bands >=7 as --up, 4-7 as
    // --amber — a damped score under 7 lands in --amber by construction.
    expect(state.score).toBeLessThan(7);
  });

  it("thin sample forces verdictKickerBanded false even if the damped score still clears 7 (a small unanimous-extreme sample)", () => {
    // 4 articles (below MIN_CONFIDENT_SAMPLE=5) all at sentiment +1.0 —
    // calibratedSentimentToScore(1.0) = 10, dampenForSample(10, 4) is still
    // high, potentially >= 7. Assert the branch this case is meant to
    // exercise unconditionally (NSA-S1): if the damping math ever changes so
    // this score no longer clears 7, this assertion fails loudly instead of
    // silently vacating (the guard the old `if` form allowed).
    const state = computeCardState(1.0, 4);
    expect(state.isThinSample).toBe(true);
    expect(state.score).toBeGreaterThanOrEqual(7);
    expect(state.trendBanded).toBe(false);
  });

  it("a thin sample's trend word is never 'Warming' when damped into the 4-7 band — 'Steady' is the honest word", () => {
    // Asserted unconditionally (NSA-S1): if the damping math ever moves this
    // case's score outside [4, 7), this assertion fails loudly instead of
    // silently vacating.
    const state = computeCardState(0.92, 2);
    expect(state.score).toBeGreaterThanOrEqual(4);
    expect(state.score).toBeLessThan(7);
    expect(state.trendKicker).toBe("Steady");
  });

  it("healthy sample (>= MIN_CONFIDENT_SAMPLE): trendBanded follows the score band exactly, no thin-sample override", () => {
    const state = computeCardState(0.8, 8);
    expect(state.isThinSample).toBe(false);
    expect(state.score).toBeGreaterThanOrEqual(7);
    expect(state.trendBanded).toBe(true);
  });

  it("zero analysed is not flagged as a thin sample (it is the separate zero-coverage state)", () => {
    const state = computeCardState(0, 0);
    expect(state.isThinSample).toBe(false);
  });

  it("exactly MIN_CONFIDENT_SAMPLE analysed articles is NOT thin (threshold is exclusive on the low side)", () => {
    const state = computeCardState(0.9, MIN_CONFIDENT_SAMPLE);
    expect(state.isThinSample).toBe(false);
  });

  it("MIN_CONFIDENT_SAMPLE - 1 analysed articles IS thin", () => {
    const state = computeCardState(0.9, MIN_CONFIDENT_SAMPLE - 1);
    expect(state.isThinSample).toBe(true);
  });
});
