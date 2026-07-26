# Review: News & sentiment — retrieval coverage and scoring accuracy
Date: 2026-07-24
Status: IMPLEMENTED — 2026-07-24 (4 iterations; NSA4-I1/S1 fixed and mutation-verified; NSA-Q1 cap tuning remains open for the owner, and TD-42/TD-43 record consciously deferred residuals)

> **Stamp correction, iteration 3.** This file was stamped `Status: IMPLEMENTED — 2026-07-24`
> after iteration 2. That stamp was premature: the owner's manual checks against live data
> subsequently found a retrieval regression (relevance-score saturation → 13F boilerplate
> dominance) that both prior iterations missed, and iteration 3's review of the fix pass raises a
> further ISSUE plus an open QUESTION. The stamp is removed here per the Reviewer's ownership of
> this file; the Coding agent / orchestrator re-stamps it when the file is genuinely clean.
> `reviews/INDEX.md` and `plans/INDEX.md` carry the same premature state — see NSA3-I2.

Branch: `feature/news-sentiment-accuracy` · PR https://github.com/tpattyn0/meridian/pull/36
Plan: `plans/2026-07-24-news-sentiment-accuracy.md` (all 14 tasks, 0-13)

**This file covers four review iterations.** Iteration 1 (below) reviewed `main...39a6910f`.
Iteration 2 (`# Iteration 2`) reviewed the fix pass, `3a108f29..41c9efd9`.
Iteration 3 (`# Iteration 3`) reviewed the saturation-regression fix pass, `211b0b3c..b468606f`.
Iteration 4 (`# Iteration 4`, at the bottom) reviewed the NSA3 fix pass, `b468606f..064d813b`.
Earlier iterations' findings are retained verbatim as the record of what was
raised; their resolution status is recorded in the iteration that verified them.

---

# Iteration 1

Branch HEAD reviewed: `39a6910f`
Diff reviewed: `git diff main...HEAD` — 33 files, +3087 / -416

**Security-pass note.** The `security-review` skill diffs the *working tree against HEAD*. This
branch's work is fully committed, so that diff is empty and the skill has no meaningful input.
Per CLAUDE.md's Reviewer Step 1 carve-out, the skill was adapted: the security pass was run
manually against the branch range `main...HEAD`, with live probes for the two new attack surfaces
(untrusted third-party XML parsing, and the batched LLM call). Findings are folded in below.

## Summary
Findings: 0 BLOCKERs, 2 ISSUEs, 3 SUGGESTIONs, 1 QUESTION
Requires owner decision: NSA-Q1
Ready for Coding agent: NSA-I1, NSA-I2, NSA-S1, NSA-S2, NSA-S3

Verification run live this session: `npm run verify` — **pass** (typecheck ok · lint ok ·
**365/365 tests** · gitleaks `no leaks found`). Working tree clean at review time; branch pushed
and up to date with its upstream.

**Overall judgement: strong implementation; merge-ready once NSA-I1 is fixed.** The reported bug
is genuinely fixed and pinned by a test asserting the owner's exact case. Every constraint the
plan flagged as a trap was respected. The two ISSUEs are both narrow and concrete: one real
cross-call-site score desync that the plan explicitly set out to prevent (NSA-I1), and the test
that was supposed to catch it being tautological (NSA-I2).

### What was verified clean (audited, no finding raised)

- **Task 0's gitleaks trap — fully respected.** `git diff main...HEAD --stat` over
  `.gitleaks.toml`, `.gitleaks-local/`, `.env`, `.env.local` is **empty**: all four untouched, as
  the plan required. The line-anchored fingerprints (`.env:newsapi-key:13`,
  `.env:gcp-api-key:16`, `.env:gemini-api-key-assignment:16`) are intact, the `newsapi-key`
  gitleaks *rule* is retained (`.gitleaks.toml:19-22`) so the history detector still fires, and
  `continue-on-error: true` is still present on the `secret-history` job
  (`.github/workflows/verify.yml:134`). The local secret scan passes.
- **No overclaiming on TD-01 / ADR-7 / TD-28.** `TECH_DEBT.md:11` states plainly that the key
  "**remains live and publicly readable in git history**", that removing the consumer "does not
  unpublish or revoke it", and marks TD-01 amended-not-closed at severity Low. ADR-7 is marked
  `Status: superseded by ADR-33` with its text left intact for history — superseded, not edited
  in place, exactly as the plan required. ADR-33 is `accepted` and repeats the
  not-revocable/not-closed caveats. The CI comment block was updated to match. No document
  claims the key is safe.
- **XXE / entity expansion: not exploitable.** Probed live —
  `cheerio.load(xml, { xmlMode: true })` (htmlparser2) does **not** resolve custom DTD entities.
  An external-entity payload (`<!ENTITY xxe SYSTEM "file:///etc/passwd">`) yields the literal
  string `&xxe;`, and a billion-laughs payload yields the literal `&lol2;`. No file read, no
  expansion. Combined with a hard 4s `AbortController` timeout, non-OK status returning `[]`,
  and the parse wrapped in its own try/catch returning `[]`, hostile or malformed feed content
  cannot crash the route — the degraded state is a thin-sample card, which is precisely what the
  plan predicted.
- **Junk-title guard works.** The fixture retains the real `META_TITLE_QUOTE - Yahoo Finance`
  item and `news.service.rss.test.ts:46` asserts 9 of 10 items survive, with an explicit
  assertion that no surviving title contains `META_TITLE_QUOTE`.
- **Off-topic RSS items are correctly rejected despite self-tagging.** `fetchGoogleNewsRSS` sets
  `symbols: [symbol]` on every item, which grants the unconditional `+0.3` symbols bonus in
  `scoreRelevance`. I probed whether that alone could push an off-topic item past the filter: it
  scores exactly **0.3**, below `MIN_RELEVANCE = 0.4`. "Why Micron Stock Popped Today" and the
  Intel headline both score 0.3 *with* the self-tag and are dropped. The margin is one notch, but
  it holds. (See NSA-S2 — worth a regression test, not a defect.)
- **Batch results cannot be mismatched.** `sentiment.service.ts:188-195` pre-seeds the result map
  with every input id set to `null`, then only overwrites on `results.has(item.id)` — so an
  unknown id is discarded, an omitted id stays `null`, and ordering is irrelevant. Locked by a
  reordered-ids test (`sentiment.service.test.ts:121`).
- **No silent-neutral remains.** `{ ok: false }` propagates to `news.service.ts:430`, which skips
  all persistence. Asserted at `news.service.test.ts:118` (`updateMock` not called; every article
  stays `sentiment === null`).
- **Model chain is sensible and failure-handled.** `['gemini-2.5-flash', 'gemini-flash-latest',
  'gemini-3.5-flash']` — leads with the currently-pinned model, includes a Google-maintained
  alias, and correctly excludes the retired `gemini-1.5-flash`. The commit records that
  `gemini-2.5-flash-lite` was probed and 404s, so it was excluded rather than assumed. Fallthrough
  and total-failure paths are both tested.
- **The reported bug is fixed and pinned.** `research-scores.test.ts:83` asserts the owner's exact
  case: 2 articles averaging +0.92 no longer produces 9.6 and lands below 8.0 (measured: **6.8**,
  down from 9.6). A single +1.0 article no longer yields 10.0. Five uniformly strong-positive
  articles still reach 8+, so the fix is a recalibration, not a blanket suppression.
- **Deletions are all in scope.** Only `calculateRelevance` and `fetchNewsAPI` were removed from
  `news.service.ts`; only `analyzeSentiment`, `getSentimentLabel`, and `analyzeAndUpdateArticle`
  from `sentiment.service.ts`. `git grep` confirms **zero** remaining non-test callers of any of
  them. The rewritten `news.service.test.ts` replaces two tests that asserted the 3-call fan-out
  this change deliberately removes — genuinely obsoleted, not silently dropped, and the new suite
  covers strictly more (7 batch cases plus 4 dedup, 4 refresh-latch, 2 window, 6 RSS, 6 JSON).
- **Docs match code.** `ARCHITECTURE.md:8,19,45` reflect the source swap; `AGENT.md` gained the
  five fragile-surface entries; `future_ideas.md` records the rejected EODHD option; TD-41 was
  filed for the un-migrated `calculateDailySentiment` path. No drift found.

## Findings

### NSA-I1 — ISSUE
**File:** `components/news-feed.tsx:53` (interacting with `components/overview.tsx:153-162` and `lib/services/wishlist.service.ts:371-384`)

**Problem:** Task 11's stated goal is that the three call sites "all produce the identical score
for identical input," so the News tab, the Overview composite, and the wishlist "cannot silently
diverge." They still can, for two independent reasons, both reproduced numerically this session:

1. **A surviving hardcoded `0.5` relevance filter.** `news-feed.tsx:53` keeps
   `const news = allNews.filter((a) => (a.relevanceScore ?? 1) >= 0.5);`. Overview and wishlist
   apply **no** such filter. Since Task 5 lowered the shared ingest threshold to
   `MIN_RELEVANCE = 0.4`, articles scoring in `[0.4, 0.5)` are now persisted and served by the
   API, then counted by Overview/wishlist but **silently discarded by the News tab**. This is also
   the last surviving instance of exactly the `0.4`/`0.5` split Task 5 set out to eliminate by
   construction — the plan's own acceptance says "`grep` confirms `0.4`/`0.5` relevance literals
   appear nowhere outside the constant's definition," and this literal violates it.

2. **A different weighting population.** `news-feed.tsx:71-84` builds its weighted average over
   `analyzed` (sentiment non-null) only; `overview.tsx:145-153` and `wishlist.service.ts:365-375`
   iterate **all** articles, treating a `null` sentiment as `0` via `a.sentiment ?? 0`. Task 9
   makes `null` a *routinely reachable* state (any failed batch now leaves nulls where the old
   code wrote a fabricated `0`), so this pre-existing difference has been materially widened by
   this very change: unanalysed articles now drag the Overview/wishlist average toward neutral
   while the News tab ignores them — and the `analysedCount` passed to `dampenForSample` is
   computed identically in all three, so the damping does not compensate.

Reproduced (same input array, the three call sites' actual expressions):
- 5 articles, two at +0.92 / rel 0.9 and three at -0.8 / rel 0.4 → News tab **6.8**, Overview and
  wishlist **5.6**.
- 4 articles, two at +0.92 and two with `sentiment: null` → News tab **6.8**, Overview and
  wishlist **5.7**.

A 1.2-point disagreement between the News tab headline and the Overview composite's sentiment
dimension is the exact failure mode Task 11 was written to prevent, and it is user-visible on the
same page.

**Recommendation:** Make the population identical across all three. Concretely: (a) delete the
hardcoded `0.5` in `news-feed.tsx:53` and filter on the shared `MIN_RELEVANCE` imported from
`lib/utils/news-relevance.ts` (or drop the client-side filter entirely — the API already filters
at `MIN_RELEVANCE` server-side in `news.service.ts:360`, making it redundant); and (b) pick one
rule for unanalysed articles and apply it in all three — excluding `sentiment === null` from the
weighted average everywhere is the honest choice, and matches what `analysedCount` already
measures. Best done by extracting the whole weighted-average-plus-damping computation into one
shared exported helper in `lib/utils/research-scores.ts` that all three call, so the sync is
structural rather than by convention. Then fix NSA-I2 so the sync is actually tested.

---

### NSA-I2 — ISSUE
**File:** `lib/utils/research-scores.cross-site.test.ts:24-39`

**Problem:** The test named as Task 11's cross-site consistency guard cannot fail. It computes the
same expression three times in the test body — `round1(dampenForSample(calibratedSentimentToScore(
avgSentiment), analysedCount))` — assigns the results to `newsFeedScore`, `overviewScore`, and
`wishlistScore`, and asserts they are equal. It never imports, calls, or otherwise references
`news-feed.tsx`, `overview.tsx`, or `wishlist.service.ts`; it is asserting that a pure function is
deterministic. It passes identically whether the call sites agree or not — demonstrated by NSA-I1,
which is a live divergence that this test reports green on. The file's own docstring claims it
means "a future edit to any one call site's rounding/call order is caught," which is not true of
what it tests.

This matters more than a normal weak test: it is the *only* thing standing behind the plan's
explicit "cannot silently diverge" requirement, so its passing was reasonably read as that
requirement being met.

**Recommendation:** Make the test exercise the real call sites' logic on a shared article-array
input rather than three copies of one expression. The cheapest honest version, given TD-38 (no
render seam): extract each call site's sentiment computation into an exported pure function taking
`articles[]` (this falls out naturally from NSA-I1's shared-helper fix), then table-drive one test
over article arrays — including arrays with `relevanceScore` in `[0.4, 0.5)` and with
`sentiment: null` entries, the two cases that currently diverge — asserting the three functions
return the same number. If the helper is genuinely shared after NSA-I1, assert the three modules
import the same symbol.

---

### NSA-S1 — SUGGESTION
**File:** `lib/utils/research-scores.thin-sample-ui.test.ts:33-42, 44-49`

**Problem:** Task 12's coverage question, raised by the Coding agent itself (TD-38: no
jsdom/`@testing-library/react` seam in this repo). The mirror-test approach is a reasonable
response to a real constraint, and the file is honest about what it is. But two of its cases are
conditionally self-defeating: `if (state.score >= 7) { expect(state.trendBanded).toBe(false); }`
and `if (state.score >= 4 && state.score < 7) { ... }`. If the damping math changes so the guard
is never entered, the test passes while asserting nothing — the same failure mode as NSA-I2,
milder. (Measured now: `computeCardState(1.0, 4)` gives score 9.0, so the branch does execute
today.)

My judgement on adequacy: acceptable as a stopgap, not adequate as the permanent lock. The pure
decision values (score band, `isThinSample`, `trendKicker`, `trendBanded`) are genuinely the
component's whole decision surface here — the JSX below them is string interpolation — so the
logic risk is well covered. What is *not* covered is that the JSX still consumes those values;
a rename or a reordered ternary in `news-feed.tsx` would not be caught. That is the residual gap,
and it is correctly attributed to TD-38 rather than to this change.

**Recommendation:** Assert the score bands unconditionally (compute the expected value and assert
it directly, rather than guarding with `if`), so the cases cannot silently vacate. Separately,
consider raising TD-38's severity in `TECH_DEBT.md`: this is now the second consecutive plan
(after TD-33) to ship a UI change locked only by a mirror test, so the cost of the missing seam is
compounding rather than static.

---

### NSA-S2 — SUGGESTION
**File:** `lib/utils/news-relevance.ts:153-155`, `lib/services/news.service.ts:265`

**Problem:** Every RSS item is created with `symbols: [symbol]` — the requested symbol, self-
asserted by the fetcher rather than derived from the article. `scoreRelevance` then grants an
unconditional `+0.3` for it. So the symbols bonus, which exists to credit *independent* evidence
that an article is about this company, is a constant for the entire RSS source and carries no
information. The margin protecting the filter is one notch: an off-topic RSS item scores exactly
`0.3` against `MIN_RELEVANCE = 0.4`, so it is dropped — but any future tweak that lowers
`MIN_RELEVANCE` to 0.3, or adds any small additional signal, would admit *every* off-topic RSS
item unconditionally. Given ADR-34 accepts that ~4% of RSS items are about a different company,
and ADR-30 makes this filter the sole precision guard, the thin margin is worth pinning.

There is no test covering an off-topic article *carrying the RSS self-tag* — `news-relevance.test.ts:64-73`
tests the off-topic headlines without a `symbols` array, which is not the shape RSS actually
produces.

**Recommendation:** Add a regression test asserting an off-topic title with `symbols: [requestedSymbol]`
(the exact shape `fetchGoogleNewsRSS` emits) still scores below `MIN_RELEVANCE`. Optionally, do
not self-tag RSS items in a way that feeds the relevance bonus — either omit `symbols` at parse
time and set it after scoring, or have `scoreRelevance` ignore the bonus when the only entry is
the requested symbol itself.

---

### NSA-S3 — SUGGESTION
**File:** `lib/utils/news-relevance.ts:88-95`

**Problem:** `shareClassRoot`'s implementation does not match its documentation. The docstring and
its inline comment describe stripping "a single trailing letter," but the body only does
`upper.replace(/\.[A-Z]+$/, '')` — it strips an **exchange suffix**, never a class letter. The
actual share-class logic lives entirely in `tickerCreditsSymbol`'s `isTrailingClassVariant`. The
function is correct in effect (GOOG↔GOOGL works, verified by test), but the name and comment
describe behaviour that is not there, which is a trap for the next reader — and this file is now
listed in `AGENT.md` as a fragile surface.

**Recommendation:** Rename to `stripExchangeSuffix` and correct the comment to say the class-letter
handling is `isTrailingClassVariant`'s job. No behaviour change.

---

### NSA-Q1 — QUESTION
**File:** `lib/services/news.service.ts:35, 49` (`MAX_ARTICLES_PER_FETCH = 20`, `MAX_ANALYZE_PER_PASS = 10`)

**Problem:** Not a defect — a tuning call that interacts with the fix in a way the owner should
see before merge, and which the plan flagged as expecting "one tuning pass after the owner sees
real output."

The RSS feed returns ~100 items; the cap admits 20 per fetch, and at most 10 are analysed per
pass. With `MIN_CONFIDENT_SAMPLE = 5`, a first page load on a cold symbol analyses up to 10
articles in one batch, so the thin-sample state should clear on the first pass. But the interaction
worth confirming is at the *other* end: the refresh latch now refetches whenever the newest
in-window article is older than 15 minutes (`REFRESH_STALENESS_MS`), and `getAnalyzedNewsForSymbol`
analyses only `MAX_ANALYZE_PER_PASS` unanalysed articles per invocation. On a symbol with heavy
coverage, each refresh can add up to 20 new articles while only 10 get analysed — so the pool of
`sentiment: null` rows can grow across refreshes. Those nulls are excluded from the News tab
average but counted as `0` by Overview/wishlist (see NSA-I1), which would make the composite drift
toward neutral on the *best*-covered symbols. NSA-I1's fix removes the drift; the backlog itself
remains.

**Recommendation:** Owner decision on whether to (a) accept this as the expected tuning pass and
merge, adjusting after seeing live output, or (b) tune now — e.g. `MAX_ANALYZE_PER_PASS`
>= `MAX_ARTICLES_PER_FETCH` so a fetch's output is fully analysable in one pass. Note this
increases the size of a single Gemini batch. The plan's manual-verification checklist (the GOOGL
end-to-end case, the `.BR` ticker, the two-loads-6-minutes-apart latch check, the known-negative
symbol sanity check) has not been run in this session and is the natural place to settle it.

## Proposed DECISIONS.md entries

ADR-30 through ADR-34 were added by this branch and already carry `Status: accepted` with real
file:line evidence; ADR-7 is correctly marked superseded. No new ADRs are required from this
review.

One amendment to propose **only if the owner adopts the shared-helper approach in NSA-I1** (it
changes ADR-30's and Task 11's stated contract from convention to structure):

```
## ADR-35 — The News & sentiment headline score is computed by one shared helper, not three mirrored call sites
- **Decision:** The weighted-average-sentiment → calibrated map → sample-damping pipeline is
  extracted into a single exported helper in `lib/utils/research-scores.ts` taking the article
  array, and consumed unchanged by `components/news-feed.tsx`, `components/overview.tsx`, and
  `lib/services/wishlist.service.ts`. The three sites no longer each own a copy of the
  article-filtering, weighting, and counting logic — only the shared helper does. Articles with
  `sentiment === null` are excluded from the weighted average at all three sites (previously
  news-feed excluded them while overview/wishlist coerced them to 0), and relevance filtering uses
  the shared `MIN_RELEVANCE` everywhere (removing the last hardcoded `0.5` literal at
  news-feed.tsx:53).
- **Evidence:** `lib/utils/research-scores.ts`; the three call sites — not-implemented until
  NSA-I1 lands.
- **Tradeoffs:** Task 11 tried to keep the three in sync by convention plus a consistency test;
  the test was tautological (NSA-I2) and the sites diverged by up to 1.2 points in measured cases.
  Structural sharing costs a slightly less flexible per-site computation — accepted, because the
  divergence it prevents is user-visible on a single page (the News tab headline versus the
  Overview composite's sentiment dimension).
- **Status:** proposed
- **Confidence:** High
```

---

# Iteration 2

Date: 2026-07-24
Branch HEAD reviewed: `41c9efd9`
Diff reviewed: `git diff 3a108f29..HEAD` — 12 files, +339 / -136 (the fix pass, commit `c7d501cc`,
plus the orchestrator's `STATUS.md` bump `41c9efd9`)

**Security-pass note (unchanged rationale).** The `security-review` skill diffs the *working tree
against HEAD*; this branch is fully committed, so that diff is empty and the skill has no
meaningful input. Per CLAUDE.md's Reviewer Step 1 carve-out the skill was skipped and the security
pass run manually against `3a108f29..HEAD` instead — see "Security pass" below.

## Summary
Findings: 0 BLOCKERs, 1 ISSUE, 0 SUGGESTIONs, 1 QUESTION (carried forward)
Requires owner decision: NSA-Q1 (carried forward from iteration 1, deliberately not acted on)
Ready for Coding agent: NSA2-I1

Verification run live this session: `npm run verify` — **pass** (typecheck ok · lint ok ·
**363/363 tests** · gitleaks `no leaks found`). Working tree clean at review time
(`git status --porcelain` empty); branch pushed and level with `origin/feature/news-sentiment-accuracy`.

**Overall judgement: the fix pass is correct and the two ISSUEs are genuinely closed.** NSA-I1's
shared-helper extraction is structurally sound, and NSA-I2's rewritten test was verified to
actually fail — I reproduced three independent mutations in a throwaway git worktree and each one
broke the suite (detail below). The one new finding is a documentation miss, not a code defect:
`ARCHITECTURE.md`'s key-files row still describes the pre-fix two-function pipeline and never
mentions `computeSentimentScore`, while `AGENT.md`, `DECISIONS.md` (ADR-35), and `TECH_DEBT.md`
were all correctly updated.

## Iteration-1 findings — resolution status

| ID | Status | Verified how |
|----|--------|--------------|
| NSA-I1 | **Resolved** | `computeSentimentScore(articles)` added at `lib/utils/research-scores.ts:135`; all three sites call it (`news-feed.tsx:69`, `overview.tsx:148`, `wishlist.service.ts:371`). `rg` over `*.ts`/`*.tsx` finds **zero** remaining `sentiment ?? 0` coercions outside the helper (where it is a no-op after the null filter) and zero remaining relevance-threshold literals outside `MIN_RELEVANCE`'s definition — the plan's Task 5 acceptance criterion now actually holds. |
| NSA-I2 | **Resolved** | Mutation-tested, three ways — see "NSA-I2: independently verified the test can fail" below. |
| NSA-S1 | **Resolved** | Both conditionally-guarded cases in `research-scores.thin-sample-ui.test.ts:33-53` now assert the band unconditionally (`expect(state.score).toBeGreaterThanOrEqual(7)` / the explicit `[4, 7)` pair) *before* asserting the guarded behavior, so neither case can silently vacate. |
| NSA-S2 | **Resolved** | `news-relevance.test.ts:75-91` adds the off-topic-with-RSS-self-tag case, passing `symbols: [symbol]` — the exact shape `fetchGoogleNewsRSS` emits — for both probe headlines, asserting `< MIN_RELEVANCE`. This is the shape iteration 1 noted was untested. |
| NSA-S3 | **Resolved** | `shareClassRoot` → `stripExchangeSuffix` (`news-relevance.ts:88-93`), both call sites in `tickerCreditsSymbol` updated, docstring corrected to state that share-class-letter handling is `isTrailingClassVariant`'s job. Body unchanged — no behavior change, as intended. |
| NSA-Q1 | **Still open** | Deliberately not acted on; still requires the owner's decision. Restated below. |

## What was verified clean in iteration 2 (audited, no finding raised)

- **The `relevanceScore >= 0.5` deletion is sound — I traced every path, as asked.** The fix pass
  deleted `news-feed.tsx`'s client-side re-filter outright rather than repointing it at
  `MIN_RELEVANCE`, on the reasoning that the server already filters everything the component can
  see. That reasoning holds against the code:
  - `NewsFeed` has exactly two mount points (`rg "NewsFeed"`): `research/[symbol]/page.tsx:283`,
    which passes **no** `articles` prop and so uses the component's own `useQuery` against
    `/api/news/[symbol]`; and `portfolio/[ticker]/page.tsx:354`, which passes
    `articles={newsArticles}`.
  - That `newsArticles` (`portfolio/[ticker]/page.tsx:75-97`) is itself a `useQuery` against
    `/api/news/${ticker}` — the same route. So `propArticles` is not an independent supply path;
    it is the same server data hoisted a level for the page's own sentiment display.
  - `app/api/news/[symbol]/route.ts` has a single code path and returns
    `newsService.getAnalyzedNewsForSymbol(...)` unmodified — no alternate branch, no passthrough
    of an unfiltered set.
  - `getAnalyzedNewsForSymbol` (`news.service.ts:350-396`) reads through one `whereClause`
    containing `relevanceScore: { gte: MIN_RELEVANCE }`, used for **both** its initial
    `findMany` (line 363) and the post-refresh re-`findMany` (line 391); the refresh path
    additionally re-filters fresh articles at line 385 before persisting. Every return is
    `articles` derived from that clause, or `[]`.
  So no path can deliver an article below `MIN_RELEVANCE` to this component, and the deleted
  filter could only ever have disagreed with the server. Deletion was the right call, not a
  shortcut. (Articles now surfacing in the `[0.4, 0.5)` band are the *intended* effect of Task 5,
  not a regression.)
- **The null-sentiment rule is genuinely applied in one place, with no caller re-introducing a
  coercion.** The filter lives only at `research-scores.ts:136`. `rg` for `sentiment ?? 0` returns
  one hit — line 149, inside the helper, after the filter, where it is unreachable-as-a-coercion
  and serves only to satisfy the optional type. Neither `overview.tsx` nor `wishlist.service.ts`
  retains any local `?? 0`, local `analysedCount` computation, or local filter.
- **The retained `articles.length === 0 → 5` guards are consistent, not divergent.** Both
  `overview.tsx:141` and `wishlist.service.ts:363` keep an early return of `5` for an empty array.
  The helper independently returns `score: 5` when `analyzed.length === 0`, so these are redundant
  rather than a second behavior — empty input and all-null input both yield 5 at all three sites.
- **`news-feed.tsx`'s percentage denominators are unchanged in effect.** The old code divided by
  `analyzed.length`; the new code divides by `positiveCount + neutralCount + negativeCount`. Each
  analysed article increments exactly one bucket in the helper's loop, so the two are identical by
  construction. No display regression.
- **The `useMemo` wrapper on `news` is correct and necessary.** `const news = useMemo(() =>
  propArticles || fetchedArticles || [], [propArticles, fetchedArticles])` (`news-feed.tsx:61`)
  gives the `[]` fallback a stable identity, which the downstream `useMemo(..., [news])` depends
  on; without it the score memo would recompute every render on the no-articles path. `useMemo` is
  imported at line 3. The comment explains the reasoning accurately.
- **Test count 365 → 363 is fully accounted for by the tautology collapse — no tests were
  dropped.** The old `research-scores.cross-site.test.ts` was a single `it.each` over **6** cases
  (`git show 3a108f29:...`); the rewrite has **3** `it` blocks. NSA-S2 added **1** case to
  `news-relevance.test.ts`. 365 − 6 + 3 + 1 = **363**, matching the live run exactly.
  `git diff --diff-filter=D` confirms **no** test file was deleted, and the only three test files
  touched are the ones the fix pass reports.
- **Task 0's security constraints are undisturbed by the fix pass.** `git diff 3a108f29..HEAD
  --stat` over `.gitleaks.toml`, `.gitleaks-local/`, `.env`, `.env.local`, and
  `.github/workflows/verify.yml` is **empty** — all five untouched in iteration 2. Re-confirmed
  live at HEAD: the `newsapi-key` rule is still present (`.gitleaks.toml:20-23`),
  `continue-on-error: true` is still on the `secret-history` job
  (`.github/workflows/verify.yml:134`), `.env`/`.env*.local`/`scratch/` are still gitignored
  (`.gitignore:21-25,59,62`), and `git ls-files` shows only `.env.example` tracked. The local
  secret scan passes (`no leaks found`).
- **`ADR-35` matches what shipped.** It is `Status: accepted` (correctly upgraded from the
  `proposed` iteration 1 drafted) with real evidence paths, all of which resolve to code that
  exists. Its description of the null-exclusion rule and the removed `0.5` literal matches the
  implementation exactly — no overclaiming.
- **`AGENT.md` fragile-surface entry 5 was rewritten accurately**, including the explicit
  "do not regress the rewritten test back to that shape" instruction — the compounding-the-learning
  step done properly.

## NSA-I2: independently verified the test can fail

Iteration 1's substance was that a tautological test is worse than none, so I did not take the
fix pass's "I reverted it and saw 2/3 fail" report on trust. I checked out branch HEAD into a
throwaway `git worktree` under the scratch directory (no tracked file in this repo was modified at
any point) and ran three separate mutations against `research-scores.cross-site.test.ts`:

1. **Revert the NSA-I1 null-exclusion rule** — changed the helper's
   `articles.filter((a) => a.sentiment !== null && ...)` to `articles`. Result: **1 failed, 2
   passed**, failing at line 146 with `expected 4 to be 2` on `analysedCount`. The test catches
   the exact regression it exists for.
2. **Break the shared-symbol linkage from a component** — aliased news-feed's import to
   `computeSentimentScore as localComputeSentimentScore` and updated the call, simulating a
   component reverting to its own copy. Result: **1 failed**, at line 48's
   `expect(newsFeedSource).toMatch(/computeSentimentScore\(/)`. The grep-based structural
   assertion is doing real work, not just matching the import line.
3. **Diverge the wishlist delegate** — changed `wishlist.service.ts`'s one-line delegate to
   round the shared score to the nearest 0.5. Result: **2 failed** (both the direct-parity test
   at line 89 and the divergence-shapes test at line 153). The private-method binding really does
   exercise the live call site.

All three mutations were reverted and the worktree removed; `git status --porcelain` is empty.
I also ran the file with `GEMINI_API_KEY` and `DATABASE_URL` unset — it passes, so the
module-scope `wishlistService` import has not introduced a hidden environment dependency into the
suite (the lazy `sentiment.service` import in `news.service.ts` holds).

The one honest limitation, which the test file itself states: assertions 1 and 2 for
`news-feed.tsx`/`overview.tsx` are **source-text greps**, not executions, because TD-38 leaves the
repo with no component-render seam. A component could import and call the symbol while doing
something wrong with the result and the test would not notice. That is a real residual gap, but it
is correctly attributed to TD-38 and disclosed in the file's docstring — and it is strictly
stronger than iteration 1's version, which asserted nothing at all. Not raising it as a new
finding.

## Security pass (manual, `3a108f29..HEAD`)

Scanned every added line in the range for the standing categories — unauthenticated endpoints,
credentials at rest, overly broad permissions, injection surfaces, destructive ops without gates:

- **No route, middleware, or auth-guard file is in the diff.** No endpoint was added, and no
  existing endpoint's guard was touched.
- **No new `process.env` read, no new `fetch`, no new `prisma.*` call, no `exec`/`eval`/
  `child_process`/`dangerouslySetInnerHTML`** anywhere in the added lines.
- **The only new I/O in the entire range is `fs.readFileSync` at
  `research-scores.cross-site.test.ts:41,44`**, reading two fixed in-repo source paths resolved
  from `import.meta.url`. No user input reaches it, no path is interpolated, and it is test-only:
  `vitest.config.ts` scopes tests to `**/*.test.ts`, and nothing in `app/` or `components/`
  imports a test file, so it is not reachable from the Next.js bundle.
- **No destructive operation.** The diff adds one pure function and removes duplicated pure logic;
  the only persistence-adjacent file, `wishlist.service.ts`, had a private read-only computation
  replaced by a delegate.
- **No secrets.** gitleaks passes at HEAD; nothing in the diff resembles a credential.

No security findings in iteration 2.

## Findings

### NSA2-I1 — ISSUE
**File:** `ARCHITECTURE.md:56`

**Problem:** `ARCHITECTURE.md`'s key-files row for `lib/utils/research-scores.ts` still describes
the pre-fix design and was not updated by the fix pass. It reads:

> As of `plans/2026-07-24-news-sentiment-accuracy.md` (Task 11) also exports
> `calibratedSentimentToScore` (…) and `dampenForSample`/`MIN_CONFIDENT_SAMPLE` (…) — the
> calibrated News & sentiment scoring pipeline shared by `news-feed.tsx`, `overview.tsx`, and
> `wishlist.service.ts`.

That sentence is now the *iteration-1* architecture. It never mentions `computeSentimentScore`,
which is the module's new primary export and the actual thing the three call sites consume; it
describes the three sites as sharing two low-level primitives, which is precisely the
by-convention arrangement ADR-35 replaced because it failed. A reader consulting
`ARCHITECTURE.md` to find the sentiment-scoring entry point is pointed at the two functions they
should now be calling *through* the helper, not directly — the exact mistake ADR-35 and
`AGENT.md`'s fragile-surface entry 5 both explicitly warn against ("do not reimplement this inline
at a fourth call site").

`grep -rn "computeSentimentScore" *.md` confirms the miss is isolated: `AGENT.md:60`,
`DECISIONS.md:344,355`, and `TECH_DEBT.md:64-65` all name it. `ARCHITECTURE.md` is the only
required doc that does not, and per CLAUDE.md's hard limits it must reflect implemented reality.
Severity is ISSUE rather than SUGGESTION because this is a documented-decision-versus-doc
contradiction on a surface `AGENT.md` designates as fragile, not a stylistic gap.

**Recommendation:** Update the `lib/utils/research-scores.ts` row in `ARCHITECTURE.md:56` to lead
with `computeSentimentScore(articles)` as the shared News & sentiment entry point (citing ADR-35),
state that `news-feed.tsx`, `overview.tsx`, and `wishlist.service.ts` call it directly rather than
composing the primitives themselves, note the `sentiment === null` exclusion rule, and demote
`calibratedSentimentToScore`/`dampenForSample`/`MIN_CONFIDENT_SAMPLE` to internals of that helper
that remain exported for tests. Doc-only; no code change and no re-verification needed beyond
`npm run verify`.

---

### NSA-Q1 — QUESTION (carried forward from iteration 1, still open)
**File:** `lib/services/news.service.ts:35, 49` (`MAX_ARTICLES_PER_FETCH = 20`,
`MAX_ANALYZE_PER_PASS = 10`)

**Status:** unchanged and deliberately not acted on by the fix pass — correct, since it is a
QUESTION requiring the owner's decision, not an actionable finding. Neither constant was modified
in `3a108f29..HEAD`.

**One update from iteration 2 worth noting before the owner decides.** Iteration 1 framed the
consequence of the analysis backlog partly as "nulls counted as `0` by Overview/wishlist would
drag the composite toward neutral on the best-covered symbols." NSA-I1's fix removes that
drift entirely — `sentiment: null` is now excluded from the weighted average everywhere, so a
growing pending backlog no longer distorts any score. What remains is the narrower, benign
consequence: on a heavily-covered symbol each refresh can add up to `MAX_ARTICLES_PER_FETCH` (20)
articles while only `MAX_ANALYZE_PER_PASS` (10) are analysed per pass, so a pool of PENDING rows
can accumulate and be visible in the article list without ever affecting the headline score. The
decision is therefore now purely about analysis throughput and Gemini batch size, not about score
correctness — a smaller call than it was at iteration 1.

**Recommendation (unchanged):** owner decides between (a) accepting this as the expected tuning
pass and merging, adjusting after seeing live output, or (b) tuning now — e.g.
`MAX_ANALYZE_PER_PASS >= MAX_ARTICLES_PER_FETCH` so a fetch's output is fully analysable in one
pass, at the cost of a larger single Gemini batch. The plan's manual-verification checklist (the
GOOGL end-to-end case, the `.BR` ticker, the two-loads-6-minutes-apart latch check, the
known-negative symbol sanity check) has still not been run in either review session and remains
the natural place to settle it.

## Proposed DECISIONS.md entries (iteration 2)

None. ADR-35 was added by the fix pass, is `Status: accepted`, and its evidence paths all resolve
to code that exists at HEAD — it accurately records the decision iteration 1 proposed. No new
ADRs are required from this iteration; NSA2-I1 is a documentation correction, not a decision.

---

# Iteration 3

Date: 2026-07-24
Branch HEAD reviewed: `b468606f`
Diff reviewed: `git diff 211b0b3c..b468606f` — 6 files, +259 / -9 (the regression fix pass, commit
`0a6cf35b`, plus the orchestrator's `STATUS.md` bumps `f3415e29`/`b468606f`)

**Security-pass note (unchanged rationale, third time).** The `security-review` skill diffs the
*working tree against HEAD*; this branch is fully committed, so that diff is empty and the skill
has no meaningful input. Per CLAUDE.md's Reviewer Step 1 carve-out the skill was skipped and the
security pass run manually against `211b0b3c..HEAD` — see "Security pass" below.

## Summary
Findings: 0 BLOCKERs, 2 ISSUEs, 1 SUGGESTION, 2 QUESTIONs
Requires owner decision: NSA-Q1 (carried forward, still open), NSA3-Q1 (boilerplate-demotion
false-positive breadth — a product/precision call, not a code defect)
Ready for Coding agent: NSA3-I1, NSA3-I2, NSA3-S1

Verification run live this session: `npm run verify` — **pass** (typecheck ok · lint ok ·
**372/372 tests** · gitleaks `no leaks found`). Working tree clean at review time
(`git status --porcelain` empty, verified after `git fetch --prune`); branch pushed and level with
`origin/feature/news-sentiment-accuracy`.

**Overall judgement: the production fix is correct and the reported regression is genuinely
closed — but the new tests do not close the class of gap that let it through, and the boilerplate
patterns are materially broader than their own documentation claims.**

The saturation diagnosis is right and the structural fix (one match-or-not check per field,
replacing per-token accumulation) is the correct shape — it removes the defect by construction
rather than by retuning a threshold. The junk-token fix is correct and pinned by a test that
genuinely fails when reverted. Scope is tight: only the scorer, its tests, and four doc files
moved; nothing else in the diff, so the confirmed-good outcomes (26-article retrieval, 5.0
headline score, keyless operation, `.BR` tickers, refresh latch, calibration) are untouched by
construction and remain as the owner measured them.

Two things did not land as claimed. First — and this is the finding that matters, because it is
the *same* class of failure the task asked me to judge — **I mutation-tested the new suite and the
saturation fix itself is still unpinned.** Reverting `scoreRelevance` to the exact pre-fix
per-token accumulation loop leaves all 23 relevance tests green (NSA3-I1). The two tests written
specifically to catch saturation are both satisfied by the *boilerplate demotion* alone, so the
demotion masks the root-cause fix in exactly the way the old threshold-only tests masked the
original defect. Second, the boilerplate patterns catch a substantial set of genuine headlines —
insider sales, index rebalances, and any narrative sentence of the form "X trims stake in Y" —
which the code comment explicitly promises they will not (NSA3-Q1).

Judgements on the five items the task asked me to verify specifically are in "Directed
verification" below.

## Directed verification (the five items requested)

**1. Boilerplate patterns vs. genuine news — partially fails. See NSA3-Q1.**
The owner's spot-check is confirmed: "Alphabet Announces $70 Billion Share Buyback Program" scores
`0.80`, undemoted. But probing 20 constructed real-headline shapes found **12 false positives**,
almost all from pattern 3 (`boosts|grows|trims|cuts|reduces|raises|lowers|increases|decreases`
+ `position|holdings|stake` + `in|by`), which has **no institutional-actor anchor at all** despite
the code comment claiming it matches "an institutional/fund-sounding actor name combined with a
holdings verb and a share/stake noun". Measured, all demoted from `0.80` to `0.40`:

| Headline | Demoted to |
|---|---|
| `SoftBank trims stake in Alphabet to fund AI buildout` | 0.40 |
| `Alphabet reduces stake in Chinese AI venture amid regulatory pressure` | 0.40 |
| `Nvidia cuts holdings in Arm Holdings, filing shows` | 0.40 |
| `Alphabet boosts its stake in Anthropic` | 0.40 |
| `Alphabet Raises Its Position in AI Infrastructure Spending` | 0.40 |
| `S&P 500 index raises its position in tech names after rebalance` | 0.40 |
| `Alphabet Shares Sold by Insiders Ahead of Earnings` (pattern 2) | 0.40 |
| `Alphabet shares sold by CEO Sundar Pichai under 10b5-1 plan` (pattern 2) | 0.40 |
| `Alphabet insider sells 4,000 shares of stock` (pattern 1) | 0.40 |
| `Berkshire Hathaway Buys 5,000,000 Shares of Alphabet` (pattern 1) | 0.40 |

The first three are ordinary market-moving corporate-action reporting; "SoftBank trims stake in
Alphabet" is genuinely the kind of story a sentiment feed should rank highly. Insider transactions
(pattern 2) and a notable-investor position change (pattern 1, Berkshire) are also real news that
this pattern set cannot distinguish from a MarketBeat 13F notice by title shape alone. Buybacks,
secondary offerings, and acquisitions are safe — those all passed clean. This is a precision
tradeoff the owner should rule on rather than a defect I can score alone, hence QUESTION not ISSUE.

**2. Score spread — still coarse, and structurally so. See NSA3-S1.** Not a latent repeat of the
same defect, but for a narrower reason than the fix's own documentation gives. Enumerating the
full reachable lattice: with the four flat bands (0.5/0.2/0.1/0.3) and the ×0.5 demotion, only
nine distinct values are `>= MIN_RELEVANCE` (`0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0`). In
practice the Google News RSS path self-tags `symbols: [symbol]` unconditionally
(`news.service.ts:265`) and RSS items are title-only (no summary/content), so **every** RSS
article collapses to exactly one of `0.5+0.3 = 0.80` (undemoted) or `0.40` (demoted) — which is
precisely the 1.00/0.80 two-value split the owner measured, one band lower. The `0.4` gap between
them clears the sort's `0.1` threshold cleanly, so ordering is real and the demoted set genuinely
sinks. The residual risk is different from the original defect: it is not that boilerplate ties
with real news (it no longer does), but that **within** the undemoted 0.80 tier the sort is again
pure recency, so a high-volume publisher whose phrasing escapes the patterns can still crowd the
list. That is a ranking-resolution limitation worth recording, not a blocker.

**3. TD-42 (off-topic articles) — deferring is defensible and the record is accurate.** Confirmed:
"Why Nvidia Stock Isn't Rallying as It Should After Alphabet Earnings" scores `0.80` for GOOGL,
identical to genuine Alphabet coverage. TD-42's stated root cause is exactly right on both legs
(the "alphabet" token match plus the RSS fetcher's unconditional `symbols: [symbol]` self-tag at
`news.service.ts:265`), and the "no snippet — RSS items are title-only" premise checks out against
`fetchGoogleNewsRSS`, which sets no `summary`/`content`. The deferral reasoning is sound: any
title-only heuristic that suppresses this would need to know the *other* company's name, and the
naive version (drop titles mentioning a second ticker) would kill legitimate comparative coverage —
the plan's own "Tesla, Alphabet lose hundreds of billions" case is exactly that shape. Severity
`Low` is right given it inflates relevance rather than suppressing real news, and the entry even
volunteers the related `Barco`/`Barcola` proper-noun collision unprompted. No action.

**4. `BOILERPLATE_DEMOTION_FACTOR = 0.5` landing demoted items at exactly `MIN_RELEVANCE` — an
undocumented accident, not a deliberate design. See NSA3-I1's companion, NSA3-S1.** The arithmetic
is `(0.5 + 0.3) × 0.5 = 0.40`, exactly `MIN_RELEVANCE`, retained only because comparisons use `>=`.
Nothing in ADR-36, AGENT.md, or the code comments notes this coincidence, and it is genuinely
fragile: the stated design intent is "demoted, **not discarded** — these are technically on-topic",
yet lowering the factor to `0.49`, raising `MIN_RELEVANCE` to `0.41`, or trimming
`SYMBOLS_MATCH_SCORE` by `0.01` silently converts every demoted 13F notice from *retained* to
*filtered out*. The behavior isn't wrong today — and the one test covering it
(`"still clears MIN_RELEVANCE (demoted, not discarded)"`) does assert `>= MIN_RELEVANCE`, so a
future constant change would at least fail that test rather than shipping silently. But the
boundary is load-bearing and undocumented, which is what makes it worth flagging. Folded into
NSA3-S1 as a doc/comment fix rather than a separate finding, since the test already guards it.

**5. No regression to confirmed-good outcomes — confirmed.** `git diff --stat 211b0b3c..b468606f`
shows exactly six files: `lib/utils/news-relevance.ts`, `lib/utils/news-relevance.test.ts`,
`AGENT.md`, `DECISIONS.md`, `TECH_DEBT.md`, `STATUS.md`. `news.service.ts`, `sentiment.service.ts`,
`gemini.ts`, `research-scores.ts`, `news-feed.tsx`, `overview.tsx`, and `wishlist.service.ts` are
all untouched, so retrieval volume, the headline-score pipeline (ADR-35's `computeSentimentScore`),
keyless operation, `.BR` ticker handling, and the refresh latch cannot have moved. Full suite
372/372 (was 363, +9 new — matches the reported count). The one behavioral shift within the
scorer's own contract: every article's absolute score drops by one band (an RSS-sourced real story
that was `1.00` is now `0.80`), which changes no filtering outcome (`0.80 >= 0.4`) and no ordering
among undemoted items. The five all-caps GOOGL/`.BR`/threshold cases from the iteration-1 test
block still pass unchanged.

## Security pass

Manual, against `211b0b3c..HEAD`. No new attack surface: the diff adds no I/O, no auth-touching
code, no persistence, and no new dependency. Specifics checked:

- **ReDoS on the four new `BOILERPLATE_TITLE_PATTERNS`** — the real question, since these run over
  attacker-influenced text (third-party RSS titles) on every scored article. All four are linear:
  no nested quantifiers, no ambiguous alternation under a quantifier. The only repetition is
  `[\d,.]+` bounded by a required literal on both sides. Timed against a 100k-character
  adversarial title: sub-millisecond, no backtracking blowup.
- **`escapeRegExp` still applied** to every derived token before `new RegExp` in
  `matchesWordBoundary` — the widened `/[,.\s]+$/` trim changes token *content*, not the escaping
  path, so no token-injection regression. The four boilerplate patterns are static literals, never
  interpolated from input.
- **No secrets**: `gitleaks` clean; the diff's `api_key`/`token` grep hits are all prose in
  AGENT.md/DECISIONS.md/TECH_DEBT.md.
- **No unbounded work**: the scorer is called once per article over an already-capped
  (`MAX_ARTICLES_PER_FETCH = 20`, post-dedup) list; the demotion adds four regex tests per article.
- **Prompt-injection surface unchanged** — nothing here alters what reaches Gemini.

## Findings

### NSA3-I1 — ISSUE
**File:** `lib/utils/news-relevance.test.ts:144-190` (the two saturation tests)

**Problem:** The new tests do not pin the saturation fix — the actual root cause of the regression.
I verified this by mutation testing in a throwaway git worktree at HEAD: reverting `scoreRelevance`
to the exact pre-fix per-token accumulation loop (keeping the demotion and the token fix in place)
leaves **all 23 relevance tests green**. The suite's own protection against the defect it was
written for is zero. For contrast, the other three mutations I ran are all caught:
`BOILERPLATE_DEMOTION_FACTOR` → `1.0` fails 4 tests, → `0.9` fails 1, and reverting the
trailing-punctuation trim fails 1. So the boilerplate and token fixes are pinned; the saturation
fix is not.

The mechanism is the same masking pattern the task asked me to watch for, one level up. Both
saturation tests happen to be satisfied by the demotion alone:

- `"does not stack per-token matches within the same field to the 1.0 ceiling"` asserts
  `score < 1.0` — but its subject is `"Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL"`, a
  *boilerplate* title. Under the reverted scorer it computes `1.0 × 0.5 = 0.65` (it saturates,
  then the demotion pulls it back), so `< 1.0` holds and the test passes while the very stacking
  it names is happening. Its subject must be a **non**-boilerplate multi-token title, where the
  demotion cannot rescue the assertion.
- `"scores spread across the range rather than piling at 1.00"` asserts only
  `distinctValues.size > 1`. Under the reverted scorer the set is `{0.65, 0.80, 1.00}` — size 3,
  passes. A `> 1` distinctness check is nearly unfalsifiable once any demotion exists.

The ranking assertions (`cnbcSelloff > marketBeat13F`, gap `> 0.1`) are the right *shape* of test
and are a genuine improvement over the old threshold-only ones — but they too survive the revert,
because the demotion alone produces `0.80` vs `0.65`, still a `0.15` gap. They pin "boilerplate
ranks below real news" without pinning "scores don't saturate," which are two independent
properties that this fix pass happened to address together.

**Recommendation:** Add assertions that fail when per-token accumulation returns, targeting the
property directly rather than a downstream consequence:
1. Retarget the stacking test at a non-boilerplate title containing both the ticker and
   company-core tokens, e.g. `scoreRelevance({ title: "Alphabet (GOOGL) slides on earnings" },
   "GOOGL", "Alphabet Inc.")` — assert it equals `TITLE_MATCH_SCORE` exactly (`0.5`), not merely
   `< 1.0`. Under per-token accumulation this is `1.0`; exact-equality makes the flat-band contract
   the assertion rather than a bound the demotion can satisfy.
2. Add a direct multi-token-invariance test: a title matching **one** token and a title matching
   **three** tokens, same field, same everything else, must score **identically**. That is the
   flat-band contract stated as an equality, and no demotion can mask it.
3. Replace `distinctValues.size > 1` with an assertion on the actual expected lattice — e.g. that
   the measured set is exactly `{0.40, 0.80}` — so a change in banding is visible rather than
   absorbed.
4. Consider running the same revert-mutation once after the new assertions land, to confirm they
   actually fail. That is the check this iteration performed and the one that distinguishes a test
   that pins behavior from one that describes it.

### NSA3-I2 — ISSUE
**File:** `reviews/INDEX.md:5`, `plans/INDEX.md:32`, and this file's header (header already
corrected in this commit)

**Problem:** Both index files still record this work as complete, which is now false and is the
state a future session would read first. `reviews/INDEX.md` row 5 says
`IMPLEMENTED — 2026-07-24 (2 iterations; …; verify 363/363)`, and `plans/INDEX.md:32` sets the plan
to `implemented` with this review as its gate. Per CLAUDE.md, a plan is `implemented` only when the
review carries `Status: IMPLEMENTED`; iteration 3 has open findings, so neither is true. The
premature stamp is understandable — iteration 2 closed clean and the regression was found by the
owner afterwards, out of band — but leaving it means the next session sees "done" for work with an
open ISSUE and two open QUESTIONs.

**Recommendation:** Set `plans/INDEX.md:32` back to `in review` (leaving the `Review` column
pointing at this file). Update the `reviews/INDEX.md` row to blank/`in review` status, noting three
iterations and the iteration-3 regression. Both should be re-stamped together with this file's
header when iteration 3's findings are closed — the same commit, per the Coding agent's
review-is-the-gate rule.

### NSA3-S1 — SUGGESTION
**File:** `lib/utils/news-relevance.ts:172-176`, `:192-193`; `DECISIONS.md` ADR-36 Tradeoffs

**Problem:** Three documentation claims in this fix pass are inaccurate or incomplete against the
code as written. None changes behavior, but each would mislead the next person to touch this file —
which AGENT.md now explicitly designates a fragile surface.

1. **The pattern-set comment overstates the matching narrowness.** It says matching is on "an
   institutional/fund-sounding actor name combined with a holdings verb and a share/stake noun."
   No pattern tests for an actor name at all; pattern 3 in particular is a bare verb+noun+preposition
   match, which is why "SoftBank trims stake in Alphabet" and "S&P 500 index raises its position in
   tech names" are caught (see NSA3-Q1).
2. **ADR-36's Tradeoffs paragraph describes the post-fix clustering as `0.5`/`0.8`/`1.0`.** For the
   RSS path — the volume source, and the one this whole regression was about — the reachable values
   are `0.40` and `0.80` only, because RSS items are title-only and self-tag `symbols`. `1.0` is
   unreachable without a summary or content match, which no RSS article has.
3. **The `MIN_RELEVANCE` boundary coincidence is unrecorded.** A demoted article lands at exactly
   `0.40 == MIN_RELEVANCE` and survives only because the comparison is `>=` (directed-verification
   item 4). The stated intent is "demoted, not discarded," but a one-hundredth change to either
   constant flips that.

**Recommendation:** Reword the pattern comment to describe what the regexes actually match (holdings
verb + share/stake noun phrasing, no actor anchor) and note the known false-positive shapes. Correct
ADR-36's clustering figures to `0.40`/`0.80` for the RSS path, keeping the full lattice as the
general case. Add one line at `BOILERPLATE_DEMOTION_FACTOR`'s declaration recording that
`(TITLE + SYMBOLS) × FACTOR` lands exactly on `MIN_RELEVANCE` and that retention depends on the
`>=` comparison — so the coupling is visible at the point of change.

### NSA3-Q1 — QUESTION
**File:** `lib/utils/news-relevance.ts:177-190`

**Problem:** The boilerplate patterns demote a meaningful set of genuine headlines, not just 13F
notices — 12 false positives across 20 probed real-headline shapes (table in directed-verification
item 1). Three categories are affected:

- **Corporate-action narrative** — "SoftBank trims stake in Alphabet to fund AI buildout",
  "Alphabet reduces stake in Chinese AI venture amid regulatory pressure", "Nvidia cuts holdings in
  Arm Holdings". These are real, often market-moving stories, and the first is squarely the kind of
  coverage a GOOGL sentiment feed should rank *up*.
- **Insider transactions** — "Alphabet shares sold by CEO Sundar Pichai under 10b5-1 plan". A real
  signal, structurally indistinguishable from "Shares Sold by Bryn Mawr Trust Advisors LLC" by
  title shape.
- **Index/notable-investor changes** — "S&P 500 index raises its position in tech names after
  rebalance", "Berkshire Hathaway Buys 5,000,000 Shares of Alphabet".

The task framing was right that "a pattern that silently drops real news is worse than the
boilerplate it removes." The mitigating facts: these are **demoted, not dropped** (`0.40`, still
`>= MIN_RELEVANCE`, so they remain in the pool and are still sentiment-scored), and they are only
outranked by, not excluded in favour of, undemoted coverage. The cost lands only when the 20-slot
cap binds. Against that, the regression this fixes was severe and measured on live data, and the
patterns demonstrably eliminated it (12/20 → 0/20). This is a precision/recall balance on
heuristics over an unversioned third-party feed — a product call about which error the owner
prefers, not something a reviewer should silently retune.

**Recommendation:** Owner picks one:
- **(a) Accept as-is and merge.** Demotion is soft, the dominant real-world case is solved, and the
  false-positive set is mostly a *ranking* penalty on stories that stay visible. Revisit if the live
  feed shows a real story pushed off the list. Lowest risk of re-breaking what was just fixed.
- **(b) Narrow pattern 3 before merge** by requiring an institutional-actor cue — a preceding
  `LLC|LP|Inc|Trust|Advisors|Capital|Management|Partners|Group|Wealth|Asset` token, or the
  `13F`/`SEC filing` phrasing — which is what the comment already claims and would clear most of
  the corporate-action false positives while keeping the MarketBeat shapes. Costs a re-verification
  pass against live GOOGL data.
- **(c) Defer to TD-42's scope** and log the false-positive breadth as its own debt row, treating
  precision tuning as follow-up work once live output has been observed for a while.

My read: **(b) if a live re-verification pass is cheap, otherwise (a)** — the false positives are
real but soft, and the option with the worst expected outcome is widening the patterns further
without live data to check against.

### NSA-Q1 — QUESTION (carried forward from iterations 1 and 2, still open)

Unchanged and still unresolved: `MAX_ANALYZE_PER_PASS` (10) versus `MAX_ARTICLES_PER_FETCH` (20)
means a heavily-covered symbol accumulates PENDING rows that never affect the headline score. The
iteration-2 analysis (above) stands in full; nothing in this fix pass touches
`sentiment.service.ts` or the cap constants. Worth noting the owner's live run has now partly
answered the empirical half of it — the manual checks confirmed the retrieval and scoring outcomes
the cap interacts with — so this is now purely the throughput/batch-size tuning decision, ready to
settle at merge time.

## Proposed DECISIONS.md entries (iteration 3)

None. ADR-36 was added by the fix pass, is `Status: accepted`, and its Decision/Evidence sections
accurately describe the code at HEAD (the Tradeoffs paragraph needs the numeric correction in
NSA3-S1, which is a factual fix to an existing ADR, not a new decision). If the owner chooses
NSA3-Q1 option (b), the narrowed pattern set is a refinement of ADR-36's mechanism and should be
recorded as an amendment to ADR-36 rather than a new ADR.

---

# Iteration 4

Date: 2026-07-24
Branch HEAD reviewed: `064d813b`
Diff reviewed: `git diff b468606f..HEAD` — 8 files, +525 / -35 (the NSA3 fix pass, commit
`3bf5f4ca`, plus the orchestrator's `STATUS.md` bump `064d813b`)

**Security-pass note.** The `security-review` skill diffs the *working tree against HEAD*; this
branch is fully committed, so it diffed the whole branch against `main` instead of the iteration-4
range — no meaningful input for this iteration. Per CLAUDE.md's Reviewer Step 1 carve-out the skill
output was set aside and the security pass run manually against `b468606f..HEAD`. The range touches
one source file (`lib/utils/news-relevance.ts` — a pure, dependency-free scoring function), its test
file, and six doc/index files. No new I/O, network, DB, filesystem, auth, or user-input surface; no
credentials; no `eval`/`exec`/`dangerouslySetInnerHTML`; the added regexes are built from
hardcoded literal constants with no interpolation of untrusted input. `gitleaks` clean via the
Verify block. **Nothing to report.**

**Verify block re-run live at HEAD:** pass — typecheck ok, lint ok (pre-existing warnings only,
none new), **377/377 tests**, gitleaks `no leaks found`.

## Summary
Findings: 0 BLOCKERs, 1 ISSUE, 1 SUGGESTION, 0 QUESTIONs
Requires owner decision: none (NSA-Q1 remains open from iteration 1 — carried forward untouched,
still the owner's call at merge time, not a new finding)
Ready for Coding agent: NSA4-I1, NSA4-S1

**Iteration 3's four findings are all genuinely fixed.** I re-verified each by mutation and probe
rather than by reading the diff (details below). The saturation fix is now properly pinned, the
actor anchor removed the false-positive class it was aimed at, the constant-coupling guard works,
and both index files are corrected.

**One new finding, NSA4-I1**, which is the reverse of the one the fix pass was asked to check. The
directed question was about a *false negative* (a 13F notice surviving undemoted). That miss is
real, but investigating its mechanism surfaced something more consequential travelling with it: the
same positional constraint also **reintroduces the NSA3-Q1 false-positive class through a new
route** — a genuine corporate-action headline about Alphabet itself is now demoted, because
"Alphabet Inc." satisfies the institutional-actor suffix. Precision, not just recall, regressed at
the edges. I judge the anchored approach sound and worth keeping, but this specific case worth
fixing rather than deferring — reasoning in the finding.

## Findings

### NSA4-I1 — ISSUE
**File:** `lib/utils/news-relevance.ts:191-225` (`INSTITUTIONAL_ACTOR_SUFFIX` / `ACTOR_NAME` and the
four `BOILERPLATE_TITLE_PATTERNS`)

**Problem.** `ACTOR_NAME` requires the institutional suffix to be the token **immediately** preceding
the holdings verb (`\w+(?:\s\w+){0,4}\s<SUFFIX>` then `\s<verb>`). That single positional constraint
produces errors in *both* directions, and I confirmed each by direct probe against the committed
scorer at HEAD (all scored for `symbol='GOOGL'`, `companyName='Alphabet Inc.'`, `symbols:['GOOGL']`,
matching the RSS shape):

*Direction 1 — false negatives (the reported case, and it is not isolated).* Any real filer name
with words *after* the suffix, or with a suffix not in the list, escapes demotion:

| Title | Score | Expected |
|---|---|---|
| `Mcdonald Capital Investors Inc. CA Sells 2,220 Shares of Alphabet Inc. $GOOGL` | **0.80** | 0.40 |
| `Jones Financial Companies Lllp Buys 1,000 Shares of Alphabet Inc. $GOOGL` | **0.80** | 0.40 |
| `Van ECK Associates Corp Sells 500 Shares of Alphabet Inc. $GOOGL` | **0.80** | 0.40 |
| `Teacher Retirement System of Texas Buys 900 Shares of Alphabet Inc. $GOOGL` | **0.80** | 0.40 |
| `State of New Jersey Common Pension Fund D Buys 900 Shares of Alphabet Inc. $GOOGL` | **0.80** | 0.40 |

The reported `Mcdonald Capital Investors Inc. CA` fails because `CA` sits between the suffix and the
verb. `Lllp` and `Corp` are simply absent from the suffix list (note `Corp` is absent even though
`CORP_SUFFIX` elsewhere in this same file lists it). `Retirement System of Texas` and `Pension
Fund D` fail on trailing words again. These are all ordinary MarketBeat filer-name shapes, so the
class is broader than the 1-of-20 live figure suggests — that figure measures one symbol's feed on
one day, not the pattern's reach.

*Direction 2 — a new false positive, and this is the part that matters.* Because the anchor accepts
**any** name+suffix, including the requested company's own, a genuine corporate-action headline is
now demoted:

| Title | Score | Correct |
|---|---|---|
| `Alphabet Inc. Buys 100,000 Shares of Anthropic in AI push` | **0.40 (demoted)** | 0.80 |
| `Berkshire Hathaway Inc. Buys 5,000,000 Shares of Alphabet` | **0.40 (demoted)** | 0.80 |

Pattern 1 matches `"Alphabet Inc. Buys 100,000 Shares of"` — Alphabet is the *subject acquiring*,
not an anonymous fund reporting a 13F position. This is precisely the class NSA3-Q1 was opened to
eliminate ("genuine corporate-action headlines demoted"), reintroduced by a different mechanism.

The existing regression test does not catch it because of a detail worth flagging on its own:
`news-relevance.test.ts:380` asserts `"Berkshire Hathaway Buys 5,000,000 Shares of Alphabet"` → 0.8
and passes — but adding the `Inc.` that the real entity's name actually carries flips it to 0.40.
The test passes only by omitting the suffix nearly every real filer has, so it certifies a case
narrower than the one it appears to cover.

**Judgement (responding to the directed question).** The anchored approach is **sound and should be
kept** — the owner's NSA3-Q1 reasoning still holds, and mutation testing confirms it works: making
the anchor optional (reverting to bare verb+noun) fails a test, so the tightening is real and
pinned. The weakness is not the anchor concept but the **positional adjacency** requirement plus an
incomplete suffix list. Two consequences follow, and I weigh them differently:

- The false negatives (direction 1) are the *safe* failure mode. An undemoted 13F notice scores
  0.80, competing on equal footing with real coverage rather than dominating it — the saturation fix
  already removed the crowding-out mechanism. Cost is small and bounded.
- The false positive (direction 2) is the *unsafe* one, and it is the failure the owner explicitly
  judged worse ("the previous unanchored version demoted real news, which is the worse failure").
  Demoting `Alphabet Inc. Buys ... Shares of Anthropic` to exactly `MIN_RELEVANCE` puts a genuine,
  material corporate-action headline at the filter boundary, retained only by the `>=` comparison.

So I do **not** recommend deferring wholesale. Deferring direction 1 to `TECH_DEBT.md` is legitimate
and is what I recommend; direction 2 should be fixed now, because it is a regression against the
stated goal of the iteration-3 fix rather than a gap at the edges.

**Recommendation.**
1. **Fix now (direction 2, low risk, high value):** exclude the requested company from satisfying
   the actor anchor. The scorer already has the tokens — reject a boilerplate match when the actor
   segment contains a company-core token from `deriveMatchTokens`. This narrows demotion strictly
   (it can only ever *un*-demote), so it cannot reintroduce any false negative. Add the two
   direction-2 titles above as regression cases, and **change the existing `test:380` case to use
   `"Berkshire Hathaway Inc."`** so it tests the realistic shape.
2. **Fix now (cheap, contained):** add `Corp`, `Corporation`, `Lllp`, `Associates`, `Pension\sFund`
   to `INSTITUTIONAL_ACTOR_SUFFIX`. Pure additions to an alternation list; each only widens
   demotion to unambiguous institutional shapes.
3. **Defer to `TECH_DEBT.md` (direction 1's structural half):** the adjacency requirement — allowing
   trailing words between the suffix and the verb (e.g. `<SUFFIX>(\s\w+){0,2}\s<verb>`) trades
   precision for recall in a way that needs its own false-positive probe, which is more than this
   iteration should absorb. Record it as a new low-severity row referencing this finding, noting the
   measured 1/20 live rate and that the failure mode is benign (undemoted, not misranked). This is
   an explicit deferral, per the task's instruction to say so either way.

### NSA4-S1 — SUGGESTION
**File:** `reviews/INDEX.md:5`

**Problem.** The iteration-3 row records `verify 378/378`. The suite at HEAD is **377/377** (43
files) — I re-ran the Verify block live. The commit message for `3bf5f4ca` says "372 → 377/378",
suggesting the 378 is a transcription slip. Minor, but `reviews/INDEX.md` is the at-a-glance
lifecycle record and a wrong count there is the kind of small drift that later gets cited as fact.

**Recommendation.** Correct `378/378` to `377/377` in the iteration-3 row, in whichever commit next
touches the index (e.g. the eventual re-stamp).

## Directed verification — results

Each item the orchestrator asked me to confirm, with what I actually did.

**1. Iteration-3 fixes genuinely resolved.** Verified independently, not by reading:
- *NSA3-I1 (saturation unpinned).* Reproduced the mutation in a throwaway `git worktree`: reverting
  `scoreRelevance` to the per-token accumulation loop fails **5 of 28** tests (was 0 of 23). Matches
  the reported figure exactly. **Genuinely fixed** — the new non-boilerplate exact-equality tests are
  what catch it, and no other mechanism in the file can rescue those assertions.
- *NSA3-Q1 (false positives).* Confirmed `SoftBank trims stake in Alphabet to fund AI buildout` and
  `Alphabet shares sold by CEO Sundar Pichai under 10b5-1 plan` both score **0.80 undemoted**, and
  all six true-13F shapes still demote to **0.40**. Fixed for the probed set — with the new
  exception in NSA4-I1.
- *Record correction accepted:* agreed on `S&P 500 index raises its position in tech names after
  rebalance`. It scores 0.30 because it never mentions Alphabet/GOOGL in the title, so it earns only
  the symbols bonus — correct *irrelevance* filtering, not a demotion. Iteration 3's table listed it
  under false positives; that characterisation was wrong and the fix pass's test comment already
  documents this correctly. Noted here so the record is straight.
- *NSA3-S1 (coupling).* The dedicated test asserts `score === MIN_RELEVANCE` on a demoted RSS 13F
  notice, and `BOILERPLATE_DEMOTION_FACTOR`'s docstring now documents the four-constant coupling.
  Fixed.
- *NSA3-I2 (index state).* Both files corrected — see item 3.

**2. New tests fail without their mechanism (mutation spot-check).** Two mutations in a throwaway
worktree, tracked tree never touched:
- Revert per-field banding → **5 failures**. Pinned.
- Make the actor anchor optional → **1 failure**. Pinned, though by a single test.

*On whether the suite is now trustworthy — the systemic question.* Three consecutive iterations
found a test-quality defect, so the pattern deserves an answer rather than a shrug. My read: the
suite is now trustworthy **for the mechanisms it pins**, and the underlying cause has been correctly
diagnosed and written down. All three defects share one root — *an assertion satisfiable by a
mechanism other than the one under test* (threshold assertions satisfiable by admission; `< 1.0`
satisfiable by demotion; a tautology satisfiable by itself). The fix pass addressed the root, not
just the instance: assertions are now exact equalities on inputs chosen so no second mechanism is in
play, and AGENT.md now carries an explicit rule ("if you add a test for this scorer, verify it can
fail — revert the mechanism it claims to guard in a throwaway worktree"). The fix pass also audited
the branch's other new test files for the same weakness and found none, which I spot-confirmed.

That said, NSA4-I1 shows the residual limit of test-based confidence here: the Berkshire test passes
while testing a shape that does not occur in the wild. The masking problem is solved; **input
realism** is the remaining gap, and it is not something mutation testing detects. That is a
narrower, more tractable concern than the previous three — I do not think it warrants a further
process finding beyond the AGENT.md rule already added, but it is why I recommend fixing the test at
`:380` rather than only adding new cases alongside it.

**3. Index files accurate.** `plans/INDEX.md` → `in review`; `reviews/INDEX.md` → `in review` with an
accurate three-iteration history; the review file's own stamp correction is intact and the premature
`Status: IMPLEMENTED` has not crept back. All correct, except the test-count slip in NSA4-S1.

**4. Score spread — iteration 3's structural judgement still holds, and the signal is adequate.**
Confirmed: RSS items are title-only and self-tag `symbols`, so the only reachable values are
`0.5 + 0.3 = 0.80` undemoted and `0.40` demoted; `1.00` needs a summary/content match no RSS item
carries. Two values is structural, not a scoring defect. On adequacy against the sort's gap rule —
`news.service.ts:128` prefers relevance only when `Math.abs(relevanceDiff) > 0.1`, and the
0.40↔0.80 gap is **0.40**, four times the threshold. So demoted boilerplate is reliably sorted below
real coverage, which is exactly what the regression required; within each band the tiebreak falls to
recency, which is the intended behaviour. The ranking signal is sufficient. (Yahoo-sourced articles
do carry summaries and reach the intermediate values, so the two-value lattice is an RSS-path
property, not a whole-pipeline one.)

**5. No regression to confirmed-good outcomes.** The range touches exactly one source file, and only
its boilerplate-pattern constants and comments — `deriveMatchTokens`, `tickerCreditsSymbol`,
`stripExchangeSuffix`, the field bands, and `MIN_RELEVANCE` are all byte-identical to `b468606f`.
`news.service.ts`, `sentiment.service.ts`, `gemini.ts`, and `research-scores.ts` are untouched in
this range. Retrieval volume, the 9.6→5.0 headline calibration, keyless operation, `.BR` tickers,
and the refresh latch therefore cannot have regressed; 377/377 green confirms it.

**6. NSA-Q1 untouched.** Confirmed — `MAX_ANALYZE_PER_PASS` (10) and `MAX_ARTICLES_PER_FETCH` (20)
are unchanged in this range. Correctly left as the owner's call at merge time. Not re-litigated here.

## Proposed DECISIONS.md entries (iteration 4)

None. ADR-36's amendment already records the actor-anchor tightening accurately, including the
recall-for-precision tradeoff — and it even anticipates the direction-1 miss class ("a genuinely
institutional actor whose name doesn't happen to carry a recognized suffix is no longer demoted").
NSA4-I1 is a refinement of that same mechanism, not a new decision: if fixed as recommended, extend
ADR-36's amendment with the requested-company exclusion rather than opening a new ADR. Note that
ADR-36's Tradeoffs paragraph does *not* currently mention the direction-2 false positive; if the
owner instead chooses to accept it, that paragraph needs updating to say so.
