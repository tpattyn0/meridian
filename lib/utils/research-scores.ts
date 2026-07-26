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
 * Below this many analysed articles, a headline sentiment score is
 * continuously damped toward the neutral midpoint (5.0) by
 * `dampenForSample` — plans/2026-07-24-news-sentiment-accuracy.md, Task 11.
 * Chosen so the owner's 2-article case is visibly damped while a realistic
 * 15-30 article corpus (the plan's measured RSS volume) is unaffected — a
 * starting value, not a derived constant (see the plan's `## Assumptions`).
 */
export const MIN_CONFIDENT_SAMPLE = 5;

/** Exponent controlling how sharply calibratedSentimentToScore compresses the extremes. */
const CALIBRATION_EXPONENT = 1.4;

/**
 * Calibrated -1..1 sentiment -> 0..10 map (plan Task 11) — replaces the
 * linear `sentimentToScore` for headline scoring. Compresses the extremes
 * (`score = 5 + 5 * sign(s) * |s|^CALIBRATION_EXPONENT`) so genuinely
 * uniform, high-conviction coverage is required to reach the 8+ band; mild
 * positive coverage (the ±0.2-0.4 promotional-genre anchor from Task 10's
 * prompt) lands in the 6-7 band instead of inflating toward 10. The neutral
 * midpoint (`s = 0`) still maps to exactly 5.0, and the function remains
 * monotonic and symmetric — only its steepness away from the midpoint
 * changes versus the old linear map.
 *
 * `sentimentToScore` above is intentionally left byte-identical (still
 * consumed wherever the linear map is the documented, tested contract) —
 * this is a new, separate export, not a replacement in place. All three
 * call sites that build a News & sentiment headline score
 * (`components/news-feed.tsx`, `components/overview.tsx`,
 * `lib/services/wishlist.service.ts`) must use this function, never the
 * linear one, so they cannot silently diverge (plan Task 11).
 */
export function calibratedSentimentToScore(sent: number | null | undefined): number {
  const s = typeof sent === "number" ? Math.max(-1, Math.min(1, sent)) : 0;
  const sign = s < 0 ? -1 : 1;
  const score = 5 + 5 * sign * Math.pow(Math.abs(s), CALIBRATION_EXPONENT);
  return Math.max(0, Math.min(10, score));
}

/**
 * Continuously shrinks `score` toward the neutral midpoint (5.0) in
 * proportion to how far `analysedCount` falls below `MIN_CONFIDENT_SAMPLE`
 * (plan Task 11, S2) — no cliff at the boundary: the damping factor is
 * `min(1, analysedCount / MIN_CONFIDENT_SAMPLE)`, so a 1-article sample is
 * damped far more than a 4-article one, and at/above the threshold the
 * score passes through unchanged.
 */
export function dampenForSample(
  score: number,
  analysedCount: number,
  minConfidentSample: number = MIN_CONFIDENT_SAMPLE
): number {
  if (!Number.isFinite(score)) return score;
  const safeCount = Math.max(0, analysedCount);
  const factor = minConfidentSample > 0 ? Math.min(1, safeCount / minConfidentSample) : 1;
  return 5 + (score - 5) * factor;
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

/** Minimal article shape the three News & sentiment call sites share. */
export interface SentimentScoreInput {
  sentiment?: number | null;
  impact?: string | null;
  relevanceScore?: number | null;
}

export interface SentimentScoreResult {
  /** Calibrated, sample-damped 0-10 headline score, rounded to 1dp. */
  score: number;
  /** Count of articles with a non-null `sentiment` — the weighted-average population. */
  analysedCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
}

/**
 * Single shared implementation of the News & sentiment headline score —
 * relevance-filtered-and-impact-weighted average sentiment, piped through
 * `calibratedSentimentToScore` + `dampenForSample` (plan Task 11 / review
 * NSA-I1, NSA-I2, `plans/2026-07-24-news-sentiment-accuracy.md`).
 *
 * Consumed by `components/news-feed.tsx`, `components/overview.tsx`
 * (composite sentiment dimension), and `lib/services/wishlist.service.ts`
 * (`calculateSentimentScore`) — this replaces three independently
 * maintained copies of the same expression that were kept in sync only by
 * convention (and a tautological test, NSA-I2). Do not reimplement this
 * inline at a fourth call site — import and call this function.
 *
 * Population rule (NSA-I1, deliberate): articles with `sentiment === null`
 * (unanalysed/pending) are EXCLUDED from the weighted average at all three
 * sites. A pending article is not neutral news — coercing it to `0` (the
 * pre-fix overview/wishlist behavior) pulled the composite toward neutral
 * as the pending backlog grew (Task 9 made `null` routinely reachable via
 * batch sentiment analysis leaving unanalysed articles unscored). This
 * matches `analysedCount`, which always counts the same population passed
 * through `dampenForSample`.
 *
 * The caller is responsible for any relevance pre-filter on `articles`
 * before calling this (the shared `MIN_RELEVANCE` server-side filter
 * already applies to everything `getAnalyzedNewsForSymbol` returns, so no
 * caller needs a second client-side relevance filter — see NSA-I1).
 */
export function computeSentimentScore(articles: SentimentScoreInput[]): SentimentScoreResult {
  const analyzed = articles.filter((a) => a.sentiment !== null && a.sentiment !== undefined);

  if (analyzed.length === 0) {
    return { score: 5, analysedCount: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0 };
  }

  let weighted = 0;
  let totalW = 0;
  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;

  for (const a of analyzed) {
    const s = a.sentiment ?? 0;
    let w = 1;
    if (a.impact === "high") w = 3;
    else if (a.impact === "medium") w = 2;
    const rel = a.relevanceScore ?? 0.5;
    const weight = w * rel;
    weighted += s * weight;
    totalW += weight;

    if (s > 0.2) positiveCount++;
    else if (s < -0.2) negativeCount++;
    else neutralCount++;
  }

  const avg = totalW > 0 ? weighted / totalW : 0;
  const score = round1(dampenForSample(calibratedSentimentToScore(avg), analyzed.length));

  return { score, analysedCount: analyzed.length, positiveCount, neutralCount, negativeCount };
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
