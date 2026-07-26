# Review: scoring-methodology Phase 1 correctness fixes (SCM-01…13 + SCM-06)
Date: 2026-07-26
Status:

## Summary
Findings: 0 BLOCKERs, 1 ISSUE, 2 SUGGESTIONs, 0 QUESTIONs
Requires owner decision: none
Ready for Coding agent: SCM-P1-I1, SCM-P1-S1, SCM-P1-S2

Reviewed PR #38 (branch `plan/scoring-methodology-phase1`, HEAD `1350eea7`) implementing
`plans/2026-07-26-scoring-methodology-phase1-correctness.md` — the 13 concrete correctness
defects (SCM-01…13) from `reviews/2026-07-17-scoring-methodology.md` plus SCM-06 (Graham
Number confidence), which was named in the plan's title/Problem/Approach but absent from its
Tasks list and closed in-session.

Overall this is a clean, well-scoped, well-tested implementation. Each of the 14 fixes matches
the source review's stated recommendation verbatim, the described defect is actually removed
(not merely tested around), and 61 new/updated test cases assert both the fix and a regression
guard for each. `npm run verify` is green on HEAD (typecheck ok · lint ok, warnings pre-existing ·
317/317 tests · secret-scan clean). Working tree clean except the orchestrator's in-flight
`STATUS.md` edit (expected under the pipeline carve-out — not a BLOCKER).

The one ISSUE is a genuine follow-through miss on SCM-11: the recentering updated the service's
own interpretation string but left a **second, divergent verdict-label mapping in
`components/analyst-ratings.tsx` still keyed to the old analyst scale** — exactly the
"interpretation-label thresholds that depend on the old scale" the task asked to verify.

### Per-item verification (all confirmed the defect is gone)

- **SCM-01** (0-vs-null): `?? null` / `typeof === 'number'` guards applied to all numeric
  extraction fields; the `debtToEquity` truthy ternary fixed to a `typeof` guard so `0`
  survives (`fundamental-analysis.service.ts:291-303`). The downstream `> 0` scoring gates
  (`forwardPE`, `psRatio`, `pfcfRatio`, dividend `yield`/`payoutRatio`) are preserved and no
  NaN path is introduced — extraction sources are `?? null`-coalesced before any arithmetic,
  and `pfcfRatio`/`forwardPE` still guard `> 0` on their denominators. Tests assert
  `revenueGrowth: 0`/`earningsGrowth: 0`/`debtToEquity: 0`/`0` margins each reach scoring, and
  that a genuinely absent (`undefined`) `debtToEquity` still becomes `null`.
- **SCM-02** (negative D/E): excluded from `financialScores` with a `console.warn` at the call
  site (`:397-406`); positive-D/E bracket behavior unchanged (regression test present).
- **SCM-03** (insufficient-data score): `getInsufficientDataResponse` and the base object now
  carry `score: null`; `TechnicalIndicators.score` widened to `number | null`; every existing
  consumer already gated on `typeof === 'number'`, and the wishlist consumer now correctly
  yields `technicalScore = null` → composite substitutes neutral 5. Both source and consumer
  halves present and tested.
- **SCM-04** (Bollinger double-count): mid-band case now `bbPoints = 0` / `neutral`; above-upper
  stays bearish full weight, below-lower stays bullish full weight; `totalWeight += 3` retained
  so availability normalization is unaffected. Correct.
- **SCM-05** (circular terminal multiple): `min(trailingPE, 18)` via a named `TERMINAL_PE_CAP`;
  low-P/E stock still uses its own multiple. Tested at 40→18 and 12→12 with a materially-lower
  fair-value assertion.
- **SCM-06** (Graham confidence): unconditionally `'low'` (was `'high'` when inputs present).
  Matches the review's SCM-06 recommendation exactly ("Default Graham to `low`"). **Not scope
  creep** — the review explicitly calls for it and the plan's Problem/Approach committed to it;
  the in-session addition to close the plan's Tasks-list drafting gap is legitimate and is well
  documented in the plan file, AGENT.md, and ADR-30. Sector-gated elevation correctly deferred to
  SCM-14.
- **SCM-07** (P/FCF capex fallback): computes `operatingCashflow + capex` (capex is negative from
  Yahoo) only when `freeCashflow` absent; `null` when capex unavailable — no silent opCF
  substitution. Tested all three branches.
- **SCM-08** (EV/EBITDA sign): `scoreEVToEbitda(ratio, enterpriseValue)` — negative ratio with
  negative EV scores 8 (deep value) with a warning; otherwise stays 3 (negative EBITDA). New
  param defaults `null` so no other call site breaks. Tested both branches.
- **SCM-09** (dividend field rename): `growthRate` → `fiveYearAvgYield` across the metrics type,
  `lib/types/market.ts`, extraction, cache read-back, and both display rows in
  `components/fundamental-analysis.tsx` (relabeled "5Y avg dividend yield", and the metric-grade
  thresholds updated from growth-appropriate `0.05` to yield-appropriate `0.02`). DB column stays
  `dividendGrowth` (documented, no migration). Grep confirms **no remaining code path treats it as
  a growth rate** — the only surviving `growthRate` token is `dcfLite.inputs.growthRate` (earnings
  growth, an unrelated field). Complete and consistent.
- **SCM-10** (dividend distortions): (a) non-payer drops the pillar via a per-call
  `{...fundamental, dividend: 0}` weight set, renormalizing over four pillars — `DEFAULT_SCORING_WEIGHTS`
  untouched, payer scores byte-identically; (b) high-yield + high-payout (>0.8) capped at 4.
  Both tested; scale-invariance weights test stays green.
- **SCM-11** (analyst recenter): mapping SB=9/B=7/H=4/S=1.5/SS=0 applied in `calculateScore`;
  buy-skewed 55/40/5 lands ≈5.5 (verified: 0.55·7+0.40·4+0.05·1.5 = 5.525); clamp floor moved
  1→0; `getScoreInterpretation` thresholds moved down in lockstep (6/4.5/3/1.5). **See SCM-P1-I1
  for the component-side label that was missed.**
- **SCM-12** (noisy PEG): now prefers Yahoo PEG → `earningsTrend` forward growth → single-year
  YoY. The review's middle tier (3-year EPS CAGR) is honestly **not** implemented and recorded as
  TD-41 with rationale (no Yahoo module fetched exposes multi-year historical EPS). This is an
  acceptable, documented partial — see SCM-P1-S2 for a data-source caveat worth confirming.
- **SCM-13** (missing vs reported-zero growth): `earningsGrowth == null` → `value: null`
  (excluded); reported `0` still produces a discounted no-growth value. Depends on SCM-01
  restoring `0` at extraction, which it does. Tested both.

### SCORING_VERSION bump (2→3) — verified correct

`SCORING_VERSION` bumped to `3` (`fundamental-analysis.service.ts:98`). The freshness gate
(`scoreDetails.scoringVersion >= SCORING_VERSION` AND `lastUpdated` within 24h, per the AGENT.md
fragile-surface contract) means every existing `FundamentalData` row written under version 2 now
fails the `>=` check and refetches once on next read — correctly invalidating stale scores from
the six fundamental-affecting fixes (SCM-01/02/07/08/10/12). A single bump covers all six (correct
— it is a version, not a per-fix counter). The analyst service has no equivalent gate; SCM-11's
recentered scores land within 24h via the `lastUpdated` cache, documented as a known lag in the
plan, ADR-30, and AGENT.md — acceptable.

## Findings

### SCM-P1-I1 — ISSUE
**File:** components/analyst-ratings.tsx:121-122
**Problem:** SCM-11 recentered the analyst score distribution downward (a typical buy-skewed
consensus now scores ≈5.5 instead of ≈7) and updated the service's `getScoreInterpretation`
thresholds to track it (6/4.5/3/1.5). But `components/analyst-ratings.tsx` computes its **own**
`verdictLabel` inline off `ratings.score`, still using the **pre-recenter** boundaries:
`>= 7 STRONG BUY : >= 5.5 BUY : >= 4.5 HOLD : >= 3 SELL : STRONG SELL`. This VerdictStamp is
rendered on the analyst tab's headline card and now systematically disagrees with the analyst
service's own interpretation string for the same score. Concrete divergences under the new scale:
a score of 6.5 → service "Strong Buy" but component "BUY"; a score of 4.6 → service "Buy" but
component "HOLD"; a score of 3.5 → service "Hold" but component "SELL". Because the whole point of
SCM-11 is that scores shifted down, most real post-recenter scores now land in exactly the ranges
where the two mappings diverge, so the headline stamp mislabels the majority of stocks (and skews
one notch too bearish relative to the recentered intent). This is the exact "interpretation-label
threshold that depends on the old scale" the fix needed to carry through. The service change and
the SCM-11 unit test both look complete, but the test only asserts the service's
`scoreInterpretation`, never the component stamp, so it doesn't catch this.
**Recommendation:** Update `components/analyst-ratings.tsx`'s `verdictLabel` thresholds to match
the recentered `getScoreInterpretation` boundaries (`>= 6 STRONG BUY : >= 4.5 BUY : >= 3 HOLD :
>= 1.5 SELL : STRONG SELL`). Better: derive the stamp from a single shared source rather than a
second inline copy — e.g. have the service expose a short label enum alongside
`scoreInterpretation`, or add a shared `analystVerdictLabel(score)` helper both the service and the
component call, so the two mappings can't drift again (this is a smaller version of the
`verdictLabel(score, context)` pattern already used for the composite in `lib/utils/research-scores.ts`).

### SCM-P1-S1 — SUGGESTION
**File:** lib/services/analyst-ratings.service.ts:214-218
**Problem:** The score clamp floor moved from `1` to `0` (`Math.max(0, weightedScore)`) with a
comment that the clamp is "defensive only, since the weighted average of 0-9 inputs never exceeds
that range." That is true for the finite mapping, but the `0` floor now means a pure Strong-Sell
consensus scores exactly `0`, which on the shared 0-10 presentation scale is indistinguishable
from "no data / not computed" in some UI banding contexts (e.g. `scoreBandClass` treats very-low
and zero identically; some empty states render `0`). This is not a correctness bug in the score
math — it is a display-collision risk worth a glance.
**Recommendation:** Confirm the analyst tab and composite treat a genuine `0` analyst score
distinctly from a missing one (the composite path already substitutes neutral `5` only for
`null`, not `0`, so a real `0` correctly flows through — likely fine). If any surface renders a
literal `0` ambiguously, consider a `0.5` floor or an explicit "insufficient coverage" branch.
No change required if the audit confirms no collision.

### SCM-P1-S2 — SUGGESTION
**File:** lib/services/fundamental-analysis.service.ts:210, 262
**Problem:** SCM-12's forward-growth source is `data.earningsTrend?.trend?.[0]?.earningsEstimate`,
then `earningsTrend?.growth`. The review's SCM-12 recommendation specifies "the `+5y` or next-year
trend entry" — the `+5y` long-term growth estimate. `trend[0]` is Yahoo's **current-period** (e.g.
current-quarter/current-year) entry, whose `earningsEstimate.growth` is a near-term single-period
growth figure, not the multi-year expected growth PEG is conventionally defined on. Using `trend[0]`
still improves on the old single-YoY fallback (it is an analyst estimate rather than a trailing
print), and TD-41 already records the missing 3-year-CAGR tier, so this is not a blocker — but the
chosen entry may not be the multi-year figure the review intended, which slightly undercuts the
"multi-year expected growth, not a single noisy YoY print" claim in the code comment.
**Recommendation:** Confirm which `earningsTrend.trend[]` entry carries the long-term (`+5y`)
growth estimate in the Yahoo payload this service fetches (typically the entry with `period: "+5y"`,
not index `0`), and select it explicitly if available, falling back to `trend[0]`. If `+5y` is not
reliably present in the fetched module, keep `trend[0]` but soften the code comment to "next-period
analyst estimate" rather than "multi-year expected growth." Low priority; fold into the TD-41
follow-up.

## Standing checklist
- **Working tree clean** — only `STATUS.md` dirty (orchestrator in-flight edit); expected under the
  pipeline carve-out, not a BLOCKER. All application code, plans, docs committed.
- **STATUS.md within limits** — 13 lines, links only, no narrative, no custom sections. Pass.
- **File structures conform** — ADR-30 matches the ADR template (Decision/Evidence/Tradeoffs/
  Status/Confidence, evidence cites file:line); TD-41 is a well-formed Backlog row (ID/Severity/
  Impact/Effort/Recommended fix); plans/INDEX.md row set to `in review`. Pass.
- **Secrets** — secret-scan clean; no keys/tokens in the diff. Pass.
- **Verify block present and passing** — `npm run verify` green (317/317 tests). Pass.
- **Test coverage** — every modified scoring function has happy-path + regression coverage; 61
  new/updated cases across 5 test files. Pass. (Gap noted: the SCM-11 test covers the service label
  but not the component stamp — see SCM-P1-I1.)

## Proposed DECISIONS.md entries
None. ADR-30 (added by the implementation) already records the three calibration decisions
(SCM-11 recenter, SCM-05 cap, SCM-06 confidence) and is well-formed. No new ADR is needed for the
findings above — SCM-P1-I1 is a follow-through fix to an already-recorded decision, not a new one.
