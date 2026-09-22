# Review: scoring-methodology Phase 1 — fix-pass verification (SCM-P1-I1/S1/S2)
Date: 2026-07-26
Status: IMPLEMENTED — 2026-07-26

## Summary
Findings: 0 BLOCKERs, 0 ISSUEs, 0 SUGGESTIONs, 0 QUESTIONs
Requires owner decision: none
Ready for Coding agent: none — all prior findings resolved, no new findings

Re-review of PR #38 (branch `plan/scoring-methodology-phase1`, HEAD `5bc7e6d0`) following the
Coding agent fix pass (commit `61c94cd8`) that acted on the three findings from
`reviews/2026-07-26-scoring-methodology-phase1-correctness.md` (SCM-P1-I1 ISSUE, SCM-P1-S1 and
SCM-P1-S2 SUGGESTIONs). Scope of this pass: confirm the three fixes were correctly implemented
and introduced no regression or scope creep across the files the fix pass touched
(`components/analyst-ratings.tsx`, `lib/utils/research-scores.ts`,
`lib/services/analyst-ratings.service.ts`, `lib/services/fundamental-analysis.service.ts`,
`AGENT.md`, and their tests). The prior review's SCM-01…13 + SCM-06 per-item verifications are
not re-litigated — those were confirmed defect-gone in the previous pass and are untouched by
this fix commit.

All three findings are correctly resolved. No new issues introduced. `npm run verify` is green on
HEAD (typecheck ok · lint ok, only pre-existing `any`/`no-console` warnings · 329/329 tests ·
secret-scan clean). Working tree clean except the orchestrator's in-flight `STATUS.md` edit
(expected under the pipeline carve-out — not a BLOCKER).

Security pass: performed manually against the fix-pass diff (the `security-review` skill diffs the
working tree against HEAD and had no meaningful input here — the work under review is committed and
the tree is clean). The diff introduces no endpoint, no credential, no destructive op, no injection
surface, and no permission change: a pure presentational label helper, a `||`→`??` swap on a numeric
cache-read field, and an `Array.find()` selector over already-fetched Yahoo payload data. Nothing
security-relevant.

### Per-finding verification (all confirmed resolved)

- **SCM-P1-I1** (component/service verdict-label drift) — RESOLVED. A shared
  `analystVerdictLabel(score)` helper was added to `lib/utils/research-scores.ts:69-75` with
  boundaries `>=6 STRONG BUY : >=4.5 BUY : >=3 HOLD : >=1.5 SELL : STRONG SELL`, which **exactly
  match** the service's recentered `getScoreInterpretation` thresholds
  (`analyst-ratings.service.ts:233-237` — `>=6 / >=4.5 / >=3 / >=1.5`). `components/analyst-ratings.tsx`
  now imports and calls the helper (`:122`), replacing the stale inline mapping
  (`>=7 / >=5.5 / >=4.5 / >=3`) the prior review flagged. Confirmed the divergence cases the prior
  review named are now consistent: score 6.5 → "STRONG BUY" (was component "BUY"), 4.6 → "BUY"
  (was "HOLD"), 3.5 → "HOLD" (was "SELL"). Tests assert the helper at every boundary and at those
  three exact scores (`research-scores.test.ts:91-113`), and the service test table asserts the
  matching interpretation string for the same scores (`analyst-ratings.service.test.ts:452-456`),
  so the two mappings are now pinned together by tests.
  - **Client-bundle reasoning is sound.** The helper deliberately lives in
    `lib/utils/research-scores.ts` (verified: zero imports — a pure module) rather than
    `analyst-ratings.service.ts`, which imports `prisma`/`@prisma/client`. `analyst-ratings.tsx` is a
    `"use client"` component (verified `:1`); importing the service there would pull the Prisma
    client into the client bundle. Placing the helper in the already-shared, dependency-free
    `research-scores.ts` avoids that regression while giving the component and the service one source
    of truth. No client-bundle regression introduced — the component's only new import is the pure
    helper. AGENT.md fragile-surface note (`AGENT.md`) documents the two-must-move-together contract
    and the reason the helper is in `lib/utils`, matching the code.

- **SCM-P1-S1** (`|| 5` collapses a genuine 0 on cache read) — RESOLVED. `formatCachedData`'s
  `cached.score || 5` is now `cached.score ?? 5` (`analyst-ratings.service.ts:303`). Correctly
  scoped: the change is confined to the single 24h cache-hit read path; the sibling coalesces on the
  same object (`averageRating`, `scoreInterpretation`) were left on their existing (correct) logic
  and no other read path was altered. No NaN/undefined risk reintroduced — `AnalystRating.score` is a
  Prisma `Float @default(5.0)` (never NaN at rest), and `??` returns `5` only on `null`/`undefined`,
  so a genuine post-SCM-11 Strong-Sell `0` now survives. Tests assert both branches: a cached `0`
  is preserved (`:407-414`) and a null score still substitutes `5` (`:416-423`).

- **SCM-P1-S2** (`trend[0]` was current-quarter, not long-term growth) — RESOLVED. A new
  `selectLongTermEarningsTrend(trend)` helper (`fundamental-analysis.service.ts:337-343`) selects the
  entry by `period` in priority order `+5y` → `+1y` → `trend[0]`, replacing the positional
  `trend?.[0]` the PEG fallback previously used (`:219-220`). Period-matching logic is correct against
  Yahoo's documented `earningsTrend.trend[]` shape: the `yahoo-finance2` v3 (`package.json`,
  `"^3.13.0"`) `quoteSummary` `earningsTrend` module (requested at `:146`) returns `trend[]` ordered
  by `period` (`"0q","+1q","0y","+1y","+5y","-5y"`), where `+5y` is the long-term (5-year) growth
  estimate and `trend[0]` (`0q`) is the current quarter — exactly the mismatch the prior review
  diagnosed. **SCM-12 actually consumes the helper's output:** the selected entry flows
  `earningsTrendEntry?.earningsEstimate` → `earningsTrend` → `earningsTrend?.growth` → the PEG
  denominator (`:263-267`), so the `+5y` figure now reaches the PEG-Adjusted intrinsic method too.
  The fallback chain degrades safely (missing/reshaped payload → `trend[0]`, old behavior — never
  throws). Tests cover all three tiers with a realistic full Yahoo array ordering
  (`fundamental-analysis.service.test.ts:594-644`), asserting the `+5y` entry wins over the
  current-quarter `0q` entry that would have dominated under the old bug.

### No scope creep in the incidental edits

The fix pass touched `AGENT.md` and `fundamental-analysis.service.ts` beyond the three targeted
files, as the Coding agent's summary claimed. Verified both are in-scope:
- `AGENT.md` — three new fragile-surface bullets documenting exactly the three fixes (the shared
  `analystVerdictLabel` contract, the `??`-not-`||` rule on `formatCachedData`, and the
  `selectLongTermEarningsTrend` period-selection rule). This is the "compound the learning" step, not
  scope creep — each bullet maps 1:1 to a fix in this commit.
- `fundamental-analysis.service.ts` — the only change is the SCM-P1-S2 helper and its call site plus
  updated comments; no other function altered. The `// eslint-disable-next-line
  @typescript-eslint/no-explicit-any` on the helper signature is consistent with the existing
  `any`-tolerance pattern for Yahoo payload shapes elsewhere in the codebase (e.g. `lib/yahoo-finance.ts`)
  and does not suppress any real type error — the helper only reads `.period`/`.earningsEstimate` off
  loosely-typed payload objects.

## Findings
None.

## Standing checklist
- **Working tree clean** — only `STATUS.md` dirty (orchestrator in-flight edit, iteration 2);
  expected under the pipeline carve-out, not a BLOCKER. All application code, tests, and docs
  committed on branch HEAD `5bc7e6d0`. Pass.
- **STATUS.md within limits** — 13 lines, links only, no narrative, no custom sections. Pass.
- **File structures conform** — AGENT.md fragile-surface additions match the existing bullet style;
  plans/INDEX.md scoring row correctly `in review`. Pass.
- **Secrets** — secret-scan clean; no keys/tokens in the fix-pass diff. Pass.
- **Verify block present and passing** — `npm run verify` green (329/329 tests, up from 317 — +12
  cases for the three fixes). Pass.
- **Test coverage** — each of the three fixes has happy-path + boundary/regression coverage, and the
  gap the prior review flagged (SCM-11 component stamp untested) is now closed by
  `research-scores.test.ts:91-113`. Pass.

## Proposed DECISIONS.md entries
None. The three fixes are follow-through on decisions already recorded (ADR-30, and the prior
review's findings) — no new architectural decision was made.
