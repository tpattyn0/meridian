# Review: scoring methodology — financial-analysis deep dive
Date: 2026-07-17
Status:

> **Scope note:** this is a methodology review requested by the owner ("do a full analysis of the
> scoring system from a financial-analysis perspective"), not a branch-diff audit. It covers the five
> scoring engines and the composite blend:
> `lib/services/technical-analysis.service.ts`, `fundamental-analysis.service.ts`,
> `intrinsic-value.service.ts`, `analyst-ratings.service.ts`, `sentiment.service.ts` /
> `news.service.ts`, and `wishlist.service.ts` (composite). Findings mix concrete code defects
> (ISSUE) with methodology redesign advice (SUGGESTION) and owner decisions (QUESTION).

## Summary
Findings: 0 BLOCKERs, 13 ISSUEs, 12 SUGGESTIONs, 3 QUESTIONs
Requires owner decision: SCM-Q1, SCM-Q2, SCM-Q3
Ready for Coding agent: SCM-01…SCM-13 (Phase 1, no owner input needed); SCM-14…SCM-25 need
plan-level scoping (Planner) and, for SCM-19/21, the answers to SCM-Q1/Q2 first.

---

## What works well (keep this)

- **Multi-pillar decomposition with transparency.** Every score ships with a breakdown, per-indicator
  points, and human-readable warnings. This is the right product instinct: a score the user can
  interrogate builds trust; a bare number doesn't.
- **Honest missing-data handling.** `INSUFFICIENT_DATA` states, availability-normalized weights,
  the confidence/agreement metrics, and the recent `?? 5` fix (AUD-05) are all better than what most
  retail tools do (which is silently fake a number).
- **Forward-looking preference.** Weighting forward P/E, PEG, P/FCF at 1.5× over trailing metrics is
  correct.
- **Ensemble valuation with exposed formulas/inputs** instead of one opaque DCF.
- **Conservative DCF defaults** (15% growth cap, 10% discount) err in the right direction for retail.

The architecture is sound. The problems below are about *context* (sector, history, regime),
*independence* (double counting), *calibration* (biased inputs), and a handful of concrete bugs.

---

## Discussion — owner questions

### D1. One dynamic score: horizon vs. investment style (owner point 2)

The perceived overlap between "investment term" and "investment style" dissolves if the two choices
control **different levels of the weight tree** instead of both fighting over one flat weight vector:

```
CompositeScore = w_timing(horizon) × TimingBlock  +  w_anchor(horizon) × AnchorBlock(style)

TimingBlock  = blend of { technical, sentiment }            ← answers "is this a good entry now?"
AnchorBlock  = blend of { Value, Quality, Growth, Income }  ← answers "is this a good business at
                                                               this price?" (fundamental sub-scores,
                                                               intrinsic value, analyst consensus)
```

- **Horizon** sets only the top-level split. Illustrative presets:
  Trade (weeks): 60/40 · Position (months): 35/65 · Invest (years): 15/85.
  Fundamentals are never omitted — exactly the owner's requirement ("that is still the base").
- **Style** sets only the mix *inside* the anchor block. Illustrative presets:
  Value investor: Value 45 / Quality 30 / Growth 10 / Income 15.
  Dividend investor: Income 40 / Quality 30 / Value 20 / Growth 10.
  Growth investor: Growth 40 / Quality 30 / Value 20 / Income 10.
- The one style that *feels* like a horizon — "sentiment/momentum driven" — is handled inside the
  timing block (raise sentiment's share of TimingBlock), not by touching the horizon split. No
  overlap remains: horizon never reweights value-vs-dividend; style never reweights
  technical-vs-fundamental.

Two design rules that matter more than the exact numbers:

1. **Presets, not sliders.** Retail users cannot calibrate five weights; offer 4–6 named personas
   (each persona = one horizon preset + one style preset) plus an "advanced" escape hatch.
2. **Show the two block scores under the headline number.** A single composite structurally cannot
   distinguish "great company, terrible entry" from "mediocre company, great entry" — both average
   to ~6. Displaying `Anchor 8.4 / Timing 3.1` beneath the headline is the minimum honest display,
   and it *is* the answer to "which dimension is important to this user."

Reframing worth adopting: the composite is a **fit score** — "how well does this stock fit *your*
stated strategy" — not a universal quality grade. That makes it legitimate that a dividend
investor's 8 differs from a trader's 8, and it aligns with the product goal in `PRODUCT.md`.

### D2. Is intrinsic value a good measure at all? (owner point 3)

The owner's observation ("not very meaningful, mainly tested on tech") is correct, and it is a
property of the current implementation, not of the stocks tested. As built, the pillar has a
**systematic bearish bias on growth/asset-light companies** and a **bullish bias on cyclicals at
peak earnings**:

| Method | Why it fails on tech/growth |
|---|---|
| Graham Number | Encodes 1934-era ceilings (P/E 15 × P/B 1.5). Asset-light companies hold their value in intangibles, not book value — the method says "overvalued" permanently. Yet it carries `high` confidence = 3× weight (SCM-06). |
| P/B Multiple | Same book-value problem; fallback industry P/B of 1.5 vs. software sector reality of 5–10+. |
| DCF Lite | Growth capped at 15% deletes the out-years where all growth-stock value lives; terminal multiple is circular (SCM-05); missing growth silently becomes 0% (SCM-13). |
| P/E Multiple | Fallback industry P/E of 15 vs. tech sector 25–35 → "overvalued" by construction. |
| PEG Adjusted | Built on a PEG computed from one noisy YoY growth print (SCM-12). |

Averaging five estimates whose errors point the same direction does not cancel the error. The
mirror-image failure: a cyclical at peak earnings (semis, banks, autos) shows high trailing EPS →
DCF and P/E-multiple scream "cheap" precisely at the most dangerous moment.

**Recommendation: keep the pillar, rebuild its epistemics** (details in SCM-19):

1. **Applicability gating.** Each method declares which business models it applies to. Graham/P-B:
   financials and asset-heavy industrials only. Earnings methods: profitable companies only.
   "Intrinsic value: not reliably estimable for this business model" is a *feature* — it is what an
   honest analyst says about a pre-profit hypergrowth name — and far better than a garbage number.
2. **Ranges, not points.** Report bear/base/bull per method and a fair-value *band*; rate the stock
   by where price sits in the band (margin-of-safety framing).
3. **Add reverse DCF as the headline valuation view.** Instead of guessing growth to output fair
   value, solve for the growth rate the current price *implies* ("at $X, the market is pricing
   ~22%/yr earnings growth for 10 years") and let the user judge plausibility. This is the most
   robust valuation lens that exists for growth stocks — no forecast required — and is more
   decision-useful for a retail audience than any point estimate.

### D3. Analyst buy bias, explained plainly (owner point 4)

Sell-side analysts almost never publish Sell ratings: they need management access, and their banks
may want the company's business. The long-run distribution across large-cap coverage is roughly
**55–60% Buy, 35–40% Hold, ~5% Sell**. Consequence for the current mapping
(StrongBuy=10, Buy=8, Hold=5, Sell=2): virtually every liquid stock scores **6.5–8.5**. The pillar
therefore doesn't discriminate between stocks — it injects a near-constant bullish offset into 15%
of the composite. (Same effect on target prices: mean consensus upside is persistently ~+10–15%,
so `targetPriceUpside` is optimistic on average too.)

Where the real information in analyst data lives, in order of value:
1. **Revisions** — upgrades/downgrades and target-price *changes* (the code already fetches
   `upgradeDowngradeHistory` and never uses it — SCM-11).
2. **Relative standing** — a 2.1 average rating only matters vs. the distribution of all covered
   stocks (cross-sectional percentile).
3. **Dispersion** — tight consensus vs. wide disagreement is a confidence signal.
The level of the consensus rating, which is all the current score uses, is the least informative.

### D4. Valuation needs three anchors: absolute, sector, own history (owner NVDA point)

The owner is right that sector-relative alone is insufficient. Professional valuation work always
triangulates **three anchors**:

1. **Absolute** — is 35× forward earnings a lot in the abstract? (what the code does today)
2. **Sector-relative** — is it a lot for a semiconductor company? (SCM-14)
3. **Self-relative** — is it a lot *for this company*? NVDA at 30× forward earnings is expensive vs.
   the market, mid-range vs. sector, and near the *bottom* of its own 5-year range — three different
   answers, and the third is often the most actionable for persistent-premium compounders.
   Percentile of today's forward P/E (and EV/EBITDA) within the stock's own trailing 3–5y
   distribution is the standard formulation. (SCM-15)

Blend suggestion: score each valuation metric as a weighted blend of the three anchors — start
40% absolute / 40% sector / 20% history and let the history weight grow as data accrues.
Implementation note: the current `FundamentalData` table is an *upsert that overwrites itself
daily*, destroying exactly the time series this needs. Persisting snapshots instead of overwriting
(SCM-15) is a one-migration change that starts accruing the dataset immediately; Yahoo's free API
cannot backfill it (`earningsHistory` gives only 4 quarters), which is part of SCM-Q3.

On "are the right factors in the valuation score": the metric *set* (P/E, fwd P/E, PEG, P/S,
P/FCF, EV/EBITDA, P/B) is good coverage without bloat, and the 1.5× forward tilt is right. The
inaccuracy comes not from missing metrics but from (a) missing context — the three anchors above;
(b) missing interactions — P/B without ROE, P/S without gross margin (SCM-18); (c) step-bracket
cliffs (SCM-17); and (d) the composite-level double counting of valuation via the intrinsic pillar
(see SCM-21). Adding more ratios would add complexity without fixing any of those.

---

## Findings

### SCM-01 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:194-214
**Problem:** `extractMetrics` uses `|| null` throughout, so a legitimate value of `0` becomes
`null` and is *excluded* from scoring. Worst case: a **debt-free company** (`debtToEquity` = 0) has
its best financial-health datapoint silently dropped; zero revenue/earnings growth (should score 4)
is likewise excluded instead of scored.
**Recommendation:** Replace with `?? null` (or explicit `typeof x === 'number'` guards) for every
numeric field; add unit tests asserting that 0-valued growth, D/E, and margins are scored, not
skipped.

### SCM-02 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:473-481
**Problem:** `scoreDebtToEquity` returns 9 (best) for any ratio `< 0.3` — including **negative**
D/E. Negative equity arises from either massive buybacks (AAPL-style, benign) or accumulated losses
(distress). Both currently receive the top financial-health score.
**Recommendation:** Guard `ratio < 0` → return `null`/exclude with a warning ("negative shareholder
equity — D/E not meaningful"), or score leverage via net-debt/EBITDA when equity is negative.

### SCM-03 — ISSUE
**File:** lib/services/technical-analysis.service.ts:723-729; lib/services/wishlist.service.ts:223
**Problem:** `getInsufficientDataResponse()` carries `score: 0`. On the 0–10 scale, 0 is *maximally
bearish*, and the wishlist consumes it as a real number (`typeof indicators.score === 'number'` is
true), so a stock with insufficient price history gets technical = 0 and its composite dragged down
~1 point vs. neutral, purely for missing data.
**Recommendation:** In `wishlist.service.ts`, treat `signal === 'INSUFFICIENT_DATA'` as
`technicalScore = null`; consider making the insufficient-data response carry `score: null` at the
source so no consumer can repeat the mistake.

### SCM-04 — ISSUE
**File:** lib/services/technical-analysis.service.ts:537-549
**Problem:** The Bollinger middle band **is** the 20-day SMA. The "Upper Half"/"Lower Half"
branches therefore re-score the exact same price-vs-SMA20 comparison already scored at weight 3
(lines 313-331) — the same signal counted twice under two names. Combined with SMA20/50/200 +
golden cross, correlated trend readings hold 13 of ~30 points of weight.
**Recommendation:** Score Bollinger only at band extremes (outside upper/lower band); return
neutral (0 points) between the bands. Optionally cap the combined trend-family weight.

### SCM-05 — ISSUE
**File:** lib/services/intrinsic-value.service.ts:105-107
**Problem:** DCF Lite uses the stock's **own trailing P/E** as the terminal multiple. This is
circular: an expensive stock is granted an expensive exit multiple, validating its own price. The
method can barely ever say "overvalued" for a high-P/E name (only via the P/E<50 cutoff).
**Recommendation:** Terminal multiple = sector median (once SCM-14 lands); until then
`min(trailingPE, 18)` with the cap documented. Never feed a stock's own current multiple back into
its own fair value.

### SCM-06 — ISSUE
**File:** lib/services/intrinsic-value.service.ts:156
**Problem:** Graham Number is assigned `high` confidence (3× weight in the ensemble). It is the
*least* applicable method in the set for modern asset-light equities (see D2) — the confidence
ordering is inverted relative to reality.
**Recommendation:** Default Graham to `low`; raise to `medium`/`high` only for sectors where book
value is economically meaningful (financials, insurers, asset-heavy industrials) once sector data
exists (SCM-14). Same gating logic applies to the P/B Multiple method.

### SCM-07 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:152-154
**Problem:** P/FCF silently falls back from `freeCashflow` to `operatingCashflow`, which ignores
capex — overstating FCF most for capital-intensive firms, exactly where the distinction decides the
answer. The two ratios are then scored on the same bracket scale as if comparable.
**Recommendation:** Compute FCF = operating cash flow − capex (capex is available via the
cash-flow-statement module already being fetched), or return `null` when true FCF is unavailable.

### SCM-08 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:408-413
**Problem:** `scoreEVToEbitda` returns 3 for any negative ratio, conflating two opposite
situations: negative **EBITDA** (unprofitable — bearish, 3 is right) and negative **EV** (cash
exceeds market cap — a classic deep-value signal, arguably a 9).
**Recommendation:** Disambiguate using the sign of EBITDA (or EV) before scoring; negative-EV /
positive-EBITDA should score high with a warning, not low.

### SCM-09 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:214
**Problem:** `dividend.growthRate` is populated with `summaryDetail.fiveYearAvgDividendYield` —
a *yield* (in percent), not a growth rate — and persisted as `dividendGrowth`. Any display or
future scoring of "dividend growth" is showing the wrong quantity in the wrong unit.
**Recommendation:** Compute real dividend growth (trailing dividend-per-share CAGR) or rename the
field to `fiveYearAvgYield` and stop calling it growth. Then use actual growth in the dividend
score (see SCM-10).

### SCM-10 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:310-329, 483-490
**Problem:** Two related distortions. (a) Non-payers get dividend sub-score 0 at a fixed 5% weight
— a systematic ~0.25–0.45-point composite penalty for buyback-oriented capital return, which is not
a defect of a company. (b) `scoreDividendYield` rewards raw yield monotonically (>5% ⇒ 9) — but
abnormally high yield is more often a **distress signal** (price collapsed, cut imminent) than a
gift; this is a yield-trap detector scoring yield traps 9/10.
**Recommendation:** (a) For non-payers, drop the dividend pillar and renormalize the remaining
weights (the codebase already uses this pattern elsewhere) — or score "shareholder yield"
(dividends + net buybacks). (b) Score yield *jointly* with payout ratio and dividend growth: high
yield + payout >80% + flat/negative growth ⇒ low score, not high.

### SCM-11 — ISSUE
**File:** lib/services/analyst-ratings.service.ts:50-57, 107-121
**Problem:** Structural buy bias (see D3) means the mapping (SB=10, B=8, H=5) lands nearly every
covered stock at 6.5–8.5 — a near-constant bullish offset occupying 15% of the composite, with
almost no cross-stock discrimination. Meanwhile `upgradeDowngradeHistory` (the highest-information
analyst signal) is fetched on every refresh and never read.
**Recommendation:** Any of, in order of value: (1) add a revision-momentum component from
`upgradeDowngradeHistory` (net upgrades minus downgrades over 90 days); (2) score `averageRating`
as a cross-sectional percentile vs. all tracked symbols; (3) at minimum recenter the mapping so the
*typical* buy-skewed consensus ≈ 5–6 (e.g. SB=9, B=7, H=4, S=1.5, SS=0).

### SCM-12 — ISSUE
**File:** lib/services/fundamental-analysis.service.ts:169-176
**Problem:** The PEG fallback divides P/E by **one year of trailing earnings growth**. PEG is
conventionally defined on multi-year *expected* growth; a single YoY print is dominated by base
effects (a recovery year after a bad year produces 200% "growth" → PEG ≈ 0.1 → score 9 for a
mediocre business). This noisy PEG also feeds the PEG-Adjusted intrinsic method.
**Recommendation:** Use the analyst forward growth estimate from the `earningsTrend` module
(already fetched — the `+5y` or next-year trend entry); fall back to a 3-year historical EPS CAGR;
only then the current fallback, flagged low-confidence.

### SCM-13 — ISSUE
**File:** lib/services/intrinsic-value.service.ts:98-102
**Problem:** `earningsGrowth || 0` — when growth data is *missing*, DCF Lite assumes 0% growth for
5 years, producing fair value ≈ 38% below price for a typically-priced stock (pure discounting, no
growth). A data gap becomes a strong "overvalued" vote that still enters the weighted average at
weight 1.
**Recommendation:** Missing growth ⇒ method returns `value: null` (excluded), not a 0%-growth
valuation. (A *reported* 0 growth is legitimately 0 — distinguish missing from zero, cf. SCM-01.)

### SCM-14 — SUGGESTION
**File:** lib/services/intrinsic-value.service.ts:40-42; prisma/schema.prisma:186; fundamental-analysis.service.ts:348-500
**Problem:** All fundamental thresholds are absolute and sector-blind, and `IndustryComparison` is
read but never written (falls back to P/E 15, P/B 1.5 — documented in PRODUCT.md). Effect: the
fundamental+intrinsic pillars act as a value-style tilt detector — systematically scoring quality
compounders and all of big tech "expensive/weak" and rewarding statistically-cheap value traps.
Banks at P/B 1.2 are normal; utilities carry high D/E structurally; current ratio is irrelevant to
them; REIT payout ratios >90% are by design.
**Recommendation:** Highest-leverage single improvement. Phase A: populate `IndustryComparison`
with sector-median P/E, forward P/E, P/B, EV/EBITDA, margins, D/E (coarse GICS sector level,
refreshed weekly, from the set of symbols already in the DB or a static seed). Phase B: score each
metric as a percentile within its sector rather than against fixed brackets. Store sector on
`FundamentalData` (Yahoo `assetProfile` module provides it).

### SCM-15 — SUGGESTION
**File:** lib/services/fundamental-analysis.service.ts:512-578; prisma/schema.prisma
**Problem:** Valuation has no self-relative anchor (owner's NVDA case, D4): a persistent-premium
company near the bottom of its own 5-year multiple range scores identically to the same multiple at
its all-time-high percentile. Worse, the `FundamentalData` upsert *overwrites* yesterday's snapshot,
destroying exactly the time series this requires.
**Recommendation:** (1) Add `FundamentalDataHistory` (symbol, date, the multiple fields) and write
a snapshot on each refresh instead of only upserting — one migration, starts accruing immediately.
(2) Once ≥ ~1y of data exists, add a self-relative component: percentile of current forward P/E and
EV/EBITDA within the stock's own trailing distribution. (3) Blend three anchors per metric —
suggested start 40% absolute / 40% sector / 20% history, history weight growing with data depth.
Yahoo cannot backfill this history (see SCM-Q3).

### SCM-16 — SUGGESTION
**File:** lib/services/technical-analysis.service.ts:398-434, 469-509, 561-607
**Problem:** Mean-reversion and trend signals are summed as if independent. In a genuine downtrend
(the falling knife), RSI<30, Stochastic<20 and price-below-lower-band contribute up to +10 bullish
points against every trend indicator — netting a misleading HOLD on the way down. Additionally:
"price down on low volume ⇒ bullish +1" is folklore, not evidence; price direction from a single
2-close comparison is noise; RSI 30–50 flagged wholesale as bearish churns signals around 50; and
the wishlist path feeds close-only data, so Stochastic runs on degenerate high=low=close candles
(wishlist.service.ts:219-221).
**Recommendation:** (1) Regime gate: count oversold oscillators as bullish only when the long-term
trend is up (price > SMA200 or golden cross); in downtrends score them neutral and keep the
warning-text. (2) Volume: score confirmation only (high-volume moves); low-volume cases ⇒ neutral.
(3) RSI: neutral band 45–55. (4) Pass OHLC data from the wishlist path or skip Stochastic there.

### SCM-17 — SUGGESTION
**File:** lib/services/fundamental-analysis.service.ts:348-500
**Problem:** Step-bracket scoring creates cliff effects (P/E 14.9 ⇒ 9, 15.1 ⇒ 8) and wastes
information within brackets. Composite consumers see spurious 0.1–0.5 jumps when a metric crosses a
threshold by pennies.
**Recommendation:** Replace brackets with piecewise-linear interpolation between the same anchor
points (cheap, no re-tuning needed). Becomes moot for metrics that move to percentile scoring
(SCM-14/15).

### SCM-18 — SUGGESTION
**File:** lib/services/fundamental-analysis.service.ts:371-378, 388-396
**Problem:** Metric interactions are ignored where they decide the answer: P/B alone punishes
high-ROE compounders whose premium to book is *justified* (residual-income logic: fair P/B rises
with ROE); P/S ignores margin structure (P/S 5 on 80% gross margin ≠ P/S 5 on 25%).
**Recommendation:** Score P/B jointly with ROE (e.g., score the ratio P/B ÷ justified-P/B where
justified-P/B ≈ ROE/cost-of-equity), or suppress P/B outside financials/asset-heavy sectors.
For P/S, either condition thresholds on gross margin or accept the limitation but cut P/S weight
for high-margin sectors when SCM-14 lands. Keep it to these two — more interaction terms is
over-engineering at this product's scale.

### SCM-19 — SUGGESTION
**File:** lib/services/intrinsic-value.service.ts (whole)
**Problem:** See D2 — point-estimate fair values from methods misapplied to the business model
produce systematically wrong verdicts on growth/asset-light stocks and false comfort on peak-cycle
stocks.
**Recommendation:** Rebuild the pillar's epistemics (after SCM-Q2): (1) per-method applicability
gating by sector/profitability — output "not estimable for this business model" instead of a
number when methods don't apply; (2) report a bear/base/bull fair-value *band* and score by where
price sits in it (margin of safety); (3) add reverse DCF — solve for the growth rate implied by the
current price — as the headline valuation lens for growth names. Note `upsideToScore`
(wishlist.service.ts:343-350) maps 0% upside to 4.5, not 5 — recenter when touching this.

### SCM-20 — SUGGESTION
**File:** lib/services/sentiment.service.ts:79-86, 149-153; lib/services/wishlist.service.ts:352-371; news.service.ts:298-313
**Problem:** (1) No age decay inside the recency window — a 20-day-old article weighs the same as
this morning's. (2) No deduplication — syndicated copies of one story get counted N times.
(3) Per-article analysis errors return sentiment 0, which then *dilutes the average as if neutral
news existed*. (4) 15% composite weight is high for the noisiest, fastest-priced-in input: published
news sentiment is largely reflected in price within minutes.
**Recommendation:** Exponential age decay (half-life ~5 trading days) in `calculateSentimentScore`;
title-similarity dedup before averaging; exclude failed analyses instead of counting them as
neutral; cut composite weight to 5–10% and reposition the pillar in the UI as "news-flow context"
rather than a return signal.

### SCM-21 — SUGGESTION
**File:** lib/services/wishlist.service.ts:259-285
**Problem:** Composite-level issues: (1) valuation is double-counted — 30% of the fundamental score
*plus* effectively the entire intrinsic pillar ⇒ ~32% of the composite, while pillar correlations
(analyst↔sentiment↔momentum) are ignored; (2) all five pillars answer different-horizon questions
yet are averaged flat (see D1); (3) per-pillar confidence (technical confidence tier, intrinsic
confidence, analyst coverage count) never reaches the composite; (4) missing pillars are imputed at
neutral 5 with full weight — a stock with only a technical score of 6 composites to 5.2,
*hiding* missingness rather than reweighting over what exists.
**Recommendation:** Implement the two-level structure from D1 (blocked on SCM-Q1): timing block vs.
anchor block with horizon/style presets, headline + two block scores displayed. Deduplicate
valuation: the anchor block should contain one valuation component (merging today's
fundamental-valuation sub-score and intrinsic upside), not two. Weight pillars by their own
confidence, expose a composite confidence, and renormalize weights over available pillars instead
of imputing 5.

### SCM-22 — SUGGESTION
**File:** lib/services/fundamental-analysis.service.ts:193-217
**Problem:** Quality measurement is thin: `roic`, `interestCoverage`, `fcfGrowth` are declared and
permanently null; operating margin is fetched but never scored; there is no margin *trend*, no
share-count trend (dilution vs. buybacks), no earnings-quality check (accruals vs. cash flow).
These are the metrics that separate durable compounders from statistically-cheap decliners — the
exact distinction the current score gets wrong.
**Recommendation:** In priority order: interest coverage (EBIT ÷ interest expense — best single
balance-sheet stress signal; income-statement data available via Yahoo), ROIC ≈ NOPAT ÷ (equity +
debt − cash), share-count YoY change, margin trend (YoY delta in operating margin) once SCM-15's
history exists. A Piotroski F-Score (9 binary checks, well-studied) is an optional packaging of
several of these. Do not add more than this — diminishing returns.

### SCM-23 — SUGGESTION
**File:** lib/services/wishlist.service.ts (composite); components/wishlist-table.tsx
**Problem:** No risk dimension anywhere — no volatility, beta, drawdown, or liquidity. A composite
with no risk lens steers a retail user toward high-score/high-risk names with no counterweight, and
two stocks with identical scores and 3× different volatility read as equivalent.
**Recommendation:** Minimum: compute annualized volatility and max drawdown from the 1Y price
history already fetched for the technical score, and display them beside the composite. Better: a
sixth "Risk" pillar (vol percentile + drawdown + beta) that *never raises* the composite, only
dampens it or badges it ("high risk").

### SCM-24 — SUGGESTION
**File:** prisma/schema.prisma; lib/services/wishlist.service.ts
**Problem:** All weights and thresholds are hand-tuned with no feedback loop; there is no way to
know whether a 7.5 composite has ever out-predicted a 4.0. `SentimentHistory` exists but score
history does not.
**Recommendation:** Add a `ScoreHistory` table (symbol, date, five pillar scores, composite,
confidence) written on each wishlist/analysis refresh. Costs almost nothing now; after 6–12 months
it enables the only test that matters — did top-quintile scores outperform bottom-quintile over the
following 3/6/12 months — turning every future weight debate from opinion into evidence.

### SCM-25 — SUGGESTION
**File:** lib/services/fundamental-analysis.service.ts:78-84, 255-312
**Problem:** Minor robustness items grouped: (1) hardcoded cache-invalidation date
(`2025-10-14`) is a permanent magic constant standing in for schema versioning; (2) empty sub-pillar
defaults of 5 mean a company with *no* fundamental data at all still reports a plausible-looking
fundamental score of ~4.75 rather than "unknown"; (3) `formatCachedData` fabricates a neutral
score object when `scoreDetails` is missing.
**Recommendation:** Version the cache with an integer schema-version column; when no metrics exist
in a category, return `null` for that sub-score and surface "insufficient data" (consistent with
how the technical service behaves after SCM-03).

### SCM-Q1 — QUESTION
**Problem:** SCM-21 (composite restructure) needs product decisions only the owner can make: which
horizon presets and style personas to offer (D1 proposes Trade/Position/Invest × Value/Dividend/
Growth/Balanced), whether the headline stays a single number with two block sub-scores, and where
the profile lives (per-user setting vs. per-wishlist-item).
**Recommendation:** Owner picks the persona set; then a Planner session turns D1 + SCM-21 into a
plan. Phase 1 fixes (SCM-01..13) are not blocked on this.

### SCM-Q2 — QUESTION
**Problem:** Intrinsic-value direction (D2): keep repaired point-estimate fair values (SCM-05/06/13
fixes), pivot to range + reverse-DCF framing (SCM-19), or both (band as primary, methods as
detail)?
**Recommendation:** Owner decision; reviewer recommends "both, band primary" — it preserves the
existing UI concept while fixing its epistemics.

### SCM-Q3 — QUESTION
**Problem:** Several improvements are data-constrained on Yahoo's free API: own-history valuation
percentiles can only accrue forward (no backfill), capex/interest-expense granularity is spotty,
sector medians need a symbol universe. Is a paid data provider (e.g. FMP, EODHD, Polygon — typical
hobby tiers $15–50/mo) in scope, or should the roadmap assume Yahoo-only?
**Recommendation:** Owner decision. Yahoo-only is workable (SCM-15 accrues its own history; SCM-14
can seed sector medians from tracked symbols) but extends the timeline for the history anchor by
~a year.

---

## Recommended sequencing

| Phase | Contents | Depends on |
|---|---|---|
| 1. Correctness | SCM-01..13 — concrete defects, all autonomously actionable | nothing |
| 2. Context | SCM-14 (sector), SCM-15 (history snapshots — *ship the snapshot table early; data accrues while everything else is built*), SCM-17 | SCM-Q3 (provider) influences but doesn't block |
| 3. Composite | SCM-19 (intrinsic rebuild), SCM-21 (two-level composite), SCM-16 (regime gate), SCM-20 (sentiment), SCM-23 (risk) | SCM-Q1, SCM-Q2 |
| 4. Depth & calibration | SCM-18, SCM-22, SCM-24 (ship the ScoreHistory table in Phase 1–2 so data accrues), SCM-25 | Phase 2–3 |

## Proposed DECISIONS.md entries

```
## ADR-8 — Three-anchor valuation scoring (absolute / sector / own-history)
- **Decision:** Valuation metrics are scored as a blend of three anchors: absolute brackets,
  sector-relative percentile (IndustryComparison), and the stock's own trailing 3–5y multiple
  percentile (FundamentalDataHistory). Initial blend 40/40/20.
- **Evidence:** not-implemented (proposed in reviews/2026-07-17-scoring-methodology.md, SCM-14/15)
- **Tradeoffs:** More moving parts than fixed brackets; history anchor needs ≥1y of accrued
  snapshots before it activates; sector medians only as good as the symbol universe.
- **Status:** proposed
- **Confidence:** High

## ADR-9 — Two-level composite: horizon × style without weight overlap
- **Decision:** The composite is computed as w(horizon)·TimingBlock + (1−w)·AnchorBlock, where
  investment style reweights only the AnchorBlock internals (Value/Quality/Growth/Income) and
  sentiment-preference reweights only the TimingBlock internals. Presets, not free sliders. The
  headline number is displayed with both block scores.
- **Evidence:** not-implemented (proposed in reviews/2026-07-17-scoring-methodology.md, D1/SCM-21)
- **Tradeoffs:** Two-level weights are harder to explain than one flat vector; presets constrain
  power users (mitigated by an advanced mode).
- **Status:** proposed
- **Confidence:** Medium (pending SCM-Q1 persona decisions)
```
