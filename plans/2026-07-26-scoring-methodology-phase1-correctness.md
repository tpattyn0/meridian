# Plan: Scoring methodology Phase 1 — correctness fixes (SCM-01…SCM-13)

Date: 2026-07-26

## Problem

The scoring-methodology review (`reviews/2026-07-17-scoring-methodology.md`) found 13
concrete, autonomously-actionable code defects across the five scoring engines and the
composite blend. Each injects a wrong number into a user-facing score with no data
problem to blame — a debt-free company silently losing its best datapoint (SCM-01), a
distressed company scored best-in-class on leverage (SCM-02), an insufficient-data stock
scored maximally bearish (SCM-03), the same trend signal counted twice (SCM-04), a DCF
that validates a stock's own price (SCM-05), the least-applicable valuation method carrying
the most weight (SCM-06), and several more.

This plan covers only Phase 1 of the review's sequencing table: **SCM-01 through SCM-13**,
the "concrete defects, all autonomously actionable, depends on nothing" row. It explicitly
excludes the SUGGESTION-level methodology redesigns (SCM-14…SCM-25, which need separate
Planner scoping) and the owner-decision QUESTIONs (SCM-Q1/Q2/Q3). The review already states
the exact fix for each of these 13 items in its per-finding `Recommendation` field; this
plan turns each into an independently-verifiable task, ordered by file to minimize context
switching.

## Approach

Each task maps to one SCM finding (SCM-05 and SCM-13 share the DCF Lite method and are
adjacent but remain independently gradeable). All changes are inside the pure/static-method
calculation services (`fundamental-analysis.service.ts`, `technical-analysis.service.ts`,
`intrinsic-value.service.ts`, `analyst-ratings.service.ts`) plus one consumer edit in
`wishlist.service.ts` (SCM-03). Per `AGENT.md`, these services stay side-effect-free — no
route, schema, or migration change is in scope for any of the 13, and none touches the
`FundamentalData`/`AnalystRating` cache shape (see Assumptions on `SCORING_VERSION`).

Key decisions, all drawn from the review's stated recommendations:

- **SCM-01 (0-vs-null):** replace `|| null` with `?? null` (or a `typeof === 'number'`
  guard) on every numeric extraction field so a legitimate `0` is scored, not dropped. The
  `debtToEquity` line uses a truthy ternary (`financialData.debtToEquity ? …/100 : null`)
  that drops `0` the same way — fix it to a nullish guard too. Note the downstream scoring
  gates that use `> 0` (`forwardPE`, `pegRatio`, `psRatio`, `pfcfRatio`, dividend `yield`,
  dividend `payoutRatio`) are deliberately kept — a `0` P/E or P/S is not a meaningful score
  input — so the fix targets the *extraction* nullishness, and specifically restores
  `revenueGrowth`, `earningsGrowth`, `roe`/`roa`/margins, and `debtToEquity` at `0`.

- **SCM-02 (negative D/E):** guard `ratio < 0` in `scoreDebtToEquity` → return a sentinel the
  caller excludes (return `null` and skip pushing it into `financialScores`, mirroring the
  existing availability-normalized pattern), with a warning. Negative equity is not
  best-in-class leverage.

- **SCM-03 (insufficient-data score:0):** in `wishlist.service.ts`, treat
  `signal === 'INSUFFICIENT_DATA'` as `technicalScore = null` (so the composite's neutral-5
  substitution applies instead of a bearish 0). Also change the insufficient-data response at
  the source (`getInsufficientDataResponse`) so its `score` cannot be consumed as a real
  bearish number — the review recommends `score: null`; see Open decisions for the type-shape
  caveat, resolved to a null-at-source approach guarded so the wishlist `typeof … === 'number'`
  check already stops treating it as a number.

- **SCM-04 (Bollinger double-count):** score Bollinger only at band extremes (above upper /
  below lower); return neutral 0 points between the bands, deleting the "Upper Half"/"Lower
  Half" branches that re-score the price-vs-SMA20 comparison already scored under trend.

- **SCM-05 (circular terminal multiple):** in `calculateDCFLite`, cap the terminal multiple
  at `min(trailingPE, 18)` (documented) instead of feeding the stock's own current multiple
  back into its own fair value. (Sector-median terminal multiple is out of scope — that is
  SCM-14.)

- **SCM-06 (Graham confidence):** default Graham Number to `low` confidence (currently
  `high` = 3× ensemble weight). Sector-gated elevation is SCM-14, out of scope.

- **SCM-07 (P/FCF fallback):** compute FCF as `operatingCashflow − capex` (capex from the
  cash-flow-statement module) when `freeCashflow` is absent, or return `null` — do not
  silently substitute operating cash flow and score it on the same bracket scale.

- **SCM-08 (EV/EBITDA sign conflation):** disambiguate a negative ratio by the sign of
  EBITDA (or EV) before scoring — negative-EBITDA (unprofitable) stays bearish (3);
  negative-EV / positive-EBITDA (cash exceeds market cap, deep-value) scores high with a
  warning.

- **SCM-09 (dividend growthRate mislabel):** `dividend.growthRate` is populated with
  `summaryDetail.fiveYearAvgDividendYield` — a yield, not a growth rate. Rename the field to
  `fiveYearAvgYield` (the honest label) and stop calling it growth. This is a wrong-unit data
  bug; the field currently feeds no score (dividend score uses only yield + payout), so this
  is a rename + persistence-label fix, not a scoring-math change.

- **SCM-10 (dividend distortions):** (a) for non-payers, drop the dividend pillar and
  renormalize the remaining fundamental weights instead of scoring it `0` at fixed weight —
  the codebase already renormalizes over available sub-pillars; (b) stop rewarding raw yield
  monotonically — score yield jointly with payout ratio so high yield + high payout reads as
  a yield-trap risk, not a 9.

- **SCM-11 (analyst buy-bias + unused revisions):** recenter the rating mapping so a typical
  buy-skewed consensus lands ≈ 5–6 (review's option 3: SB=9, B=7, H=4, S=1.5, SS=0) —
  the lowest-effort of the three offered options and the one with no new data dependency.
  The revision-momentum component (option 1, using the already-fetched-and-persisted
  `revisions`) and the cross-sectional percentile (option 2) are larger methodology changes;
  see Open decisions — this plan takes option 3 only unless the owner directs otherwise.

- **SCM-12 (noisy PEG fallback):** use the analyst forward growth estimate from the
  `earningsTrend` module (already extracted at `earningsTrend?.trend?.[0]?.earningsEstimate`)
  for the PEG denominator; fall back to a 3-year historical EPS CAGR if available; only then
  the current single-year YoY, flagged low-confidence. This PEG also feeds the PEG-Adjusted
  intrinsic method, so the fix improves both.

- **SCM-13 (missing growth → 0% DCF):** in `calculateDCFLite`, distinguish *missing* growth
  from *reported* 0. Missing (`earningsGrowth == null`) ⇒ method returns `value: null`
  (excluded from the ensemble), not a 0%-growth valuation that reads as a strong "overvalued"
  vote. A genuinely reported `0` stays a legitimate 0 (cf. SCM-01).

## Tasks

Ordered by file. `[ ]` todo · `[~]` in progress · `[x]` done (acceptance passed) · `[!]` blocked.

### `lib/services/fundamental-analysis.service.ts`

1. [x] **SCM-01** — In `extractMetrics`, replace `|| null` with `?? null` (or `typeof`
   guards) on all numeric fields, and fix the `debtToEquity` truthy ternary to a nullish
   guard so `0` survives. Keep the downstream `> 0` scoring gates unchanged.
   — Acceptance: new unit tests assert that `revenueGrowth: 0`, `earningsGrowth: 0`,
   `debtToEquity: 0`, and a `0` margin each produce a scored (non-skipped) sub-metric — i.e.
   `debtToEquity === 0` reaches `scoreDebtToEquity` and `growth === 0` reaches `scoreGrowth`
   (→ 3, per the `> 0` brackets) rather than being excluded. `npm run verify` green.

2. [x] **SCM-02** — Guard `ratio < 0` in `scoreDebtToEquity` (or at its call site) so
   negative D/E is excluded from `financialScores` with a warning, not scored 9.
   — Acceptance: unit test asserts a negative `debtToEquity` is not added to the financial
   sub-score set (and, if all other financial metrics are absent, `breakdown.financial`
   falls to the neutral default rather than 9). Positive D/E behavior unchanged (regression
   test on an existing bracket value).

3. [x] **SCM-07** — Compute FCF = `operatingCashflow − capex` from the cash-flow module when
   `freeCashflow` is absent; return `null` for `pfcfRatio` if true FCF cannot be computed,
   instead of silently substituting operating cash flow.
   — Acceptance: unit test — given `freeCashflow` absent but `operatingCashflow` and `capex`
   present, `pfcfRatio` uses `opCF − capex`; given no capex available, `pfcfRatio` is `null`
   (not opCF-based). `npm run verify` green.

4. [x] **SCM-08** — In `scoreEVToEbitda`, disambiguate negative ratios by the sign of EBITDA
   (or EV): negative-EBITDA ⇒ 3 (unchanged); negative-EV / positive-EBITDA ⇒ high score with
   a warning.
   — Acceptance: unit tests for both negative branches — negative-EBITDA still scores 3;
   negative-EV/positive-EBITDA scores high (≥7). Positive-ratio brackets unchanged.

5. [x] **SCM-09** — Rename `dividend.growthRate` to `dividend.fiveYearAvgYield` throughout
   the metrics type, extraction, and DB persistence (the `dividendGrowth` column write is
   mislabeled — relabel the mapping, no schema migration; confirm the persisted column semantics
   in the acceptance check). Stop calling a yield a growth rate.
   — Acceptance: `tsc` passes with the renamed field; a test asserts the value equals
   `summaryDetail.fiveYearAvgDividendYield` and no code path treats it as a growth rate.
   `npm run verify` green.

6. [x] **SCM-10** — (a) For non-payers (`dividend.yield` null/0), drop the dividend pillar and
   renormalize the remaining fundamental sub-pillar weights (do not score dividend `0` at
   fixed weight). (b) Score yield jointly with payout ratio so high-yield + high-payout is not
   rewarded monotonically.
   — Acceptance: unit tests — a non-payer's `breakdown.dividend` is excluded and the total is
   renormalized over the four remaining pillars (a non-payer no longer takes the fixed ~0.25–0.45
   composite penalty); a high-yield + high-payout (>0.8) case scores lower than the same yield
   with a low payout. `DEFAULT_SCORING_WEIGHTS` and the scale-invariance test in
   `scoring-weights.test.ts` stay green.

7. [x] **SCM-12** — Use the forward growth estimate from `earningsTrend` for the PEG-fallback
   denominator; fall back to 3-year EPS CAGR if available; only then single-year YoY, flagged
   low-confidence.
   — Acceptance: unit test — given an `earningsTrend` forward-growth value, the computed PEG
   uses it (not YoY); given only YoY, the old path is used but flagged low-confidence. Verify
   the PEG-Adjusted intrinsic method consumes the improved PEG (no divergence introduced).

### `lib/services/technical-analysis.service.ts`

8. [x] **SCM-04** — In the Bollinger block, score only at band extremes (above upper / below
   lower); return neutral 0 points between the bands, removing the "Upper Half"/"Lower Half"
   branches that duplicate the price-vs-SMA20 trend signal.
   — Acceptance: unit test — price between `bb.lower` and `bb.upper` yields `bbPoints === 0`
   and `bbSignal === 'neutral'`; price above/below the bands still scores the full weight in
   the correct direction. `bearishPoints`/`bullishPoints` totals for a mid-band case drop by
   the removed 1.5.

9. [x] **SCM-03 (source half)** — Make `getInsufficientDataResponse` carry a non-bearish
   score so no consumer can read it as a real number (review recommends `score: null`); keep
   `signal: 'INSUFFICIENT_DATA'`. Ensure existing consumers that read `.score` still behave
   (the research-detail technical tab and the chart route).
   — Acceptance: unit test asserts the insufficient-data response's `score` is not `0`
   (null or explicitly non-numeric); existing technical-service tests stay green; `tsc`
   passes given the `TechnicalIndicators.score` type change (see Open decisions).

### `lib/services/wishlist.service.ts`

10. [x] **SCM-03 (consumer half)** — When the technical result's `signal === 'INSUFFICIENT_DATA'`
    (or `.score` is null per Task 9), set `technicalScore = null` so the composite substitutes
    neutral 5, not a bearish 0.
    — Acceptance: unit test in `wishlist.service.test.ts` — an insufficient-data technical
    result yields `technicalScore = null` and the composite is ~1 point higher than the
    pre-fix bearish-0 path for an otherwise-identical stock.

### `lib/services/intrinsic-value.service.ts`

11. [x] **SCM-05** — In `calculateDCFLite`, replace the terminal multiple with
    `min(trailingPE, 18)` (documented cap), never the stock's own uncapped current multiple.
    — Acceptance: unit test — a high-P/E stock (e.g. trailingPE 40) uses terminal 18, not 40;
    a low-P/E stock (e.g. 12) uses 12. Fair value for the high-P/E case is materially lower
    than the pre-fix circular value.

12. [x] **SCM-13** — In `calculateDCFLite`, distinguish missing from reported-zero growth:
    when `earningsGrowth == null`, return `value: null` (excluded from the ensemble); a
    reported `0` stays a legitimate 0%-growth valuation.
    — Acceptance: unit tests — `earningsGrowth: null` ⇒ `value === null` and the method is
    dropped from the weighted average; `earningsGrowth: 0` ⇒ a real (discounted, no-growth)
    value is still produced. Depends on SCM-01 restoring `0` at extraction so a reported 0
    reaches this method as `0`, not `null`.

14. [x] **SCM-06** — **(added during implementation — drafting gap: the Approach section's
    "Key decisions" already stated this fix and the plan title/Problem section list SCM-06 as
    in scope, but no numbered Task or Files-to-modify line existed for it; the Coding agent
    session found and closed the gap rather than silently skipping a review finding the plan
    otherwise committed to.)** In `calculateGrahamNumber`, default confidence to `low`
    unconditionally (was `high` whenever eps/bookValue were present — 3× ensemble weight for
    the least-applicable method for asset-light equities). Sector-gated elevation is SCM-14,
    out of scope.
    — Acceptance: unit tests — Graham Number confidence is `low` both when its inputs are
    present (value computed) and when absent (value null). `npm run verify` green.

### `lib/services/analyst-ratings.service.ts`

13. [x] **SCM-11** — Recenter the rating mapping in `calculateScore` to SB=9, B=7, H=4,
    S=1.5, SS=0 so a typical buy-skewed consensus lands ≈ 5–6 (option 3). Update
    `getScoreInterpretation` thresholds if the recentering shifts the label boundaries.
    — Acceptance: unit tests — a realistic buy-skewed distribution (≈55% buy / 40% hold /
    5% sell) now scores ≈ 5–6 (was 6.5–8.5); a genuine strong-buy consensus still scores
    high; a sell-heavy consensus scores low. Interpretation labels remain sensible at the new
    boundaries.

## Files to create or modify

- `lib/services/fundamental-analysis.service.ts` — SCM-01, 02, 07, 08, 09, 10, 12
- `lib/services/fundamental-analysis.service.test.ts` — tests for the above
- `lib/services/technical-analysis.service.ts` — SCM-04, SCM-03 (source)
- `lib/services/technical-analysis.service.test.ts` — tests
- `lib/services/wishlist.service.ts` — SCM-03 (consumer)
- `lib/services/wishlist.service.test.ts` — test
- `lib/services/intrinsic-value.service.ts` — SCM-05, SCM-13, SCM-06 (added during implementation)
- `lib/services/intrinsic-value.service.test.ts` — tests
- `lib/services/analyst-ratings.service.ts` — SCM-11
- `lib/services/analyst-ratings.service.test.ts` — tests
- `AGENT.md` — `SCORING_VERSION` bump note if the fundamental cache needs invalidation (see
  Assumptions); add any newly-discovered fragile surface.
- `DECISIONS.md` — an ADR only if a change proves non-obvious in implementation (e.g. the
  SCM-11 recenter is a deliberate calibration choice worth recording). None mandated up front.

## Verification

`npm run verify` (the `## Verify` block in `AGENT.md`: typecheck + lint + test + secret scan)
must pass. Beyond it:

- **`SCORING_VERSION` bump.** Several tasks change what a cached `FundamentalData` row's score
  *should* be (SCM-01, 02, 07, 08, 10, 12) and what `AnalystRating` scores should be (SCM-11).
  Per the `AGENT.md` fragile-surface note, any change to extraction/scoring that would make
  previously-cached rows wrong requires bumping the exported `SCORING_VERSION` integer in
  `fundamental-analysis.service.ts` so stale rows are re-fetched. The Coding agent must bump it
  once (not per-task) for the fundamental changes. The analyst service has its own 24h cache
  keyed only on `lastUpdated` (no version gate) — SCM-11's recentered scores will refresh
  within 24h naturally; note this in the summary as a known lag, not a blocker.
- **Manual spot-check** (owner, post-merge): open the research detail for one high-multiple
  growth name (e.g. NVDA) and one debt-free / non-dividend name; confirm the fundamental,
  intrinsic, and analyst sub-scores moved in the expected direction (growth name's intrinsic
  less punitively bearish; debt-free name's financial score no longer silently missing; analyst
  score recentred lower) and no NaN / blank score appears.

## Assumptions

- **The 13 findings need no further owner input on direction.** The review marks SCM-01…13
  "Ready for Coding agent … no owner input needed" and states an explicit recommendation for
  each; this plan adopts those recommendations verbatim. Approving this plan approves them.
- **Option 3 for SCM-11.** The review offers three options for the analyst fix in ascending
  value/effort; this plan takes only the recentering (option 3) because it is self-contained,
  needs no new data, and fully addresses the "near-constant bullish offset" the finding names.
  The revision-momentum and percentile options (1 and 2) are larger and better scoped as
  Phase-2/3 methodology work. Flagged in Open decisions in case the owner wants more.
- **SCM-11 relies on already-persisted data only.** `revisions` are already persisted
  (ADR-19) but option 3 does not use them, so no cache/migration concern arises from this task.
- **A `SCORING_VERSION` bump is sufficient** to invalidate stale fundamental cache rows without
  a schema migration (the version lives in the existing `scoreDetails` JSON, per AGENT.md /
  TD-11). No `FundamentalData` or `AnalystRating` migration is in scope.
- **SCM-09 is a rename, not a scoring change.** The mislabeled field currently feeds no score
  (the dividend sub-score reads only `yield` + `payoutRatio`), so renaming it and its persisted
  label changes no computed number — it corrects a wrong-unit data/display bug and unblocks any
  future honest use of the field.

## Open decisions (if any)

- **SCM-03 response type shape.** Making `getInsufficientDataResponse().score` `null` requires
  `TechnicalIndicators.score` to accept `number | null` (or a separate discriminated
  insufficient-data shape). The consumer fix (Task 10) works either way — it can gate on
  `signal === 'INSUFFICIENT_DATA'` directly without a null score. Recommendation: gate the
  consumer on `signal` (robust regardless of score type) AND change the source score to `null`
  behind a `number | null` type widening; the Coding agent should confirm the research-detail
  technical tab and chart route tolerate a null/`INSUFFICIENT_DATA` score before widening the
  type, and if the type change ripples too far, fall back to source `score: 5` (neutral) with
  the consumer still gating on `signal`. Not a blocker — either resolution satisfies the
  finding; surfaced so the Coding agent picks the lower-blast-radius option, not the owner.
- **SCM-11 depth (option 1/2 vs 3).** If the owner wants the revision-momentum component or the
  cross-sectional percentile now rather than in a later phase, that expands Task 13
  materially and should be re-scoped. Absent that direction, the Coding agent implements
  option 3 only.
