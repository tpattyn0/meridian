/**
 * Shared 0-10 score derivations reused across the research-detail tabs
 * (Overview, Intrinsic value, News & sentiment) — extracted from
 * `overview.tsx` (plans/2026-07-18-meridian-research-detail.md, Task 4) so
 * each tab's headline score matches the Overview dimension exactly. Pure
 * functions: no DOM, no React, no side effects.
 */

/** Maps a -1..1 sentiment score to a 0..10 scale, clamped. */
export function sentimentToScore(sent: number | null | undefined): number {
  const s = typeof sent === "number" ? sent : 0;
  const score = (s + 1) * 5;
  return Math.max(0, Math.min(10, score));
}

/**
 * Maps intrinsic-value upside% to a 0..10 scale: -25% -> 0, 0% -> 5,
 * +30% -> 10 (clamped). Missing upside defaults to a neutral 5.
 */
export function upsideToScore(upsidePercent: number | null | undefined): number {
  if (upsidePercent === null || upsidePercent === undefined) return 5;
  const min = -25;
  const max = 30;
  const clamped = Math.max(min, Math.min(max, upsidePercent));
  const normalized = (clamped - min) / (max - min);
  return Math.round(normalized * 10 * 10) / 10;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Composite-score verdict label, context-aware (MRD-Q1): "portfolio" context
 * (the symbol is held) uses position-management wording; "wishlist" context
 * (not held) uses buy-oriented wording. Presentational only — the same
 * boundaries (8.5 / 7.0 / 5.0) `overview.tsx`'s composite score has always
 * used; this only extracts the label choice into a pure, testable function.
 */
export function verdictLabel(score: number, context: "portfolio" | "wishlist"): string {
  if (context === "portfolio") {
    if (score >= 8.5) return "BUY MORE";
    if (score >= 7.0) return "HOLD";
    if (score >= 5.0) return "REDUCE";
    return "SELL";
  }
  if (score >= 8.5) return "STRONG BUY";
  if (score >= 7.0) return "BUY";
  if (score >= 5.0) return "WATCH";
  return "AVOID";
}

/**
 * Analyst-ratings verdict-stamp label for a 0-10 analyst score, sharing the
 * exact boundaries `AnalystRatingsService.getScoreInterpretation`
 * (`lib/services/analyst-ratings.service.ts`) uses — the SB=9/B=7/H=4/
 * S=1.5/SS=0 recentered mapping (SCM-11). Extracted here (SCM-P1-I1) so
 * `components/analyst-ratings.tsx`'s headline VerdictStamp cannot drift
 * from the service's own interpretation string again — the component
 * previously computed this inline with stale pre-recenter thresholds
 * (`>= 7 STRONG BUY : >= 5.5 BUY : >= 4.5 HOLD : >= 3 SELL`), silently
 * disagreeing with `getScoreInterpretation` for the majority of
 * post-recenter scores. Lives in `lib/utils` rather than the service file
 * because the service imports `prisma`/`@prisma/client`, which must not be
 * pulled into `analyst-ratings.tsx`'s `"use client"` bundle. If the
 * recenter mapping or `getScoreInterpretation`'s thresholds ever change,
 * update both here and there.
 */
export function analystVerdictLabel(score: number): string {
  if (score >= 6) return "STRONG BUY";
  if (score >= 4.5) return "BUY";
  if (score >= 3) return "HOLD";
  if (score >= 1.5) return "SELL";
  return "STRONG SELL";
}
