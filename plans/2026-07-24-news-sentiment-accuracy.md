# Plan: News & sentiment — retrieval coverage and scoring accuracy
Date: 2026-07-24

> **Revised 2026-07-24 (owner decision).** The first version of this plan kept
> NewsAPI and tuned it. NewsAPI is now **removed entirely** and replaced by
> **Google News RSS**. The R1-R6 / S1-S4 defect analysis below is
> source-independent and survives unchanged; the source strategy, Task 6, Task 7,
> and ADR-31 are rewritten, and a new Task 0 handles the NewsAPI removal and its
> TD-01 / ADR-7 / TD-28 knock-on effects.

## Problem

The News & Sentiment tab reports a confident, wrong number. Owner evidence
(GOOGL research page): **9.6/10 "WARMING", 100% positive, from 2 articles**, on a
day GOOGL closed **-7.13%**. The two surviving articles were promotional
syndicated pieces; nothing that explained the selloff was retrieved.

**This is both a source problem and a pipeline problem.** The two current
sources cannot cover a same-day selloff, and the pipeline discards what little
they do return.

### The source problem: NewsAPI is structurally incapable here

NewsAPI's free tier is **delayed 24 hours**. A tab whose entire job is to explain
what moved a stock *today* cannot be built on a feed that is a day behind — no
amount of query tuning fixes this. It is also missing the publishers that
actually cover equities (Barron's, MarketWatch, Investopedia, Morningstar,
Seeking Alpha, TipRanks). Combined with the leaked, unrevocable `NEWS_API_KEY`
(TD-01/ADR-7), the source is removed rather than tuned.

**Google News RSS replaces it.** Live probe this session, keyless, one request:

```
https://news.google.com/rss/search?q=%22Alphabet%22+OR+GOOGL+stock&hl=en-US&gl=US&ceid=US:en
```

Measured, and re-verified during this planning session:

| Measure | Value |
|---|---|
| HTTP status / content-type | `200`, `application/xml; charset=utf-8` |
| Response size | ~132 KB |
| `<item>` count | **100** (the briefed figure was 25+; the feed returns 100) |
| Items with a `<source>` element | 100 / 100 |
| Titles ending in exactly `" - " + <source>` | **100 / 100** |
| Titles containing a *second* `" - "` | **0 / 100** |
| Unique titles after normalization | 93 / 100 (**7 intra-feed near-duplicates**) |
| Titles not mentioning alphabet/googl/google | **4 / 100** |
| `<link>` values that are Google redirect URLs | 100 / 100 |

The feed carries exactly the selloff coverage the current pipeline missed —
CNBC's "Tesla, Alphabet lose hundreds of billions in value in post-earnings stock
plunge", Investopedia's "Alphabet Stock Plunges as Investors React to Google's
Massive AI Spending Plans", Barron's "When AI CapEx Eats Cash", MarketWatch's
"Alphabet earnings are out and the stock is falling" — timestamped hours old. The
real narrative (Q2 beat, 82% cloud growth, overwhelmed by a $205B capex plan) is
fully covered.

Yahoo Finance `search()` stays for precision. **Final source set: Yahoo + Google
News RSS.** No paid APIs, no new keys. EODHD and other paid per-article-sentiment
providers are explicitly rejected by the owner (noted in `future_ideas.md` as a
possible future upgrade, out of scope here).

**Two data-quality caveats, both reproduced in the probe and both handled below:**
- One item's title was the literal placeholder `META_TITLE_QUOTE - Yahoo Finance`.
  A junk-title guard is required (Task 6).
- 4 of 100 items are about a *different* company ("Why Micron Stock Popped
  Today", "Intel Stock Jumps as Earnings Blow Past Expectations"). Google News
  RSS is **lower-precision than Yahoo**, so the Task 5 relevance filter matters
  **more** now, not less. Volume without precision is how the wrong story gets
  scored.

### The pipeline problem: six retrieval defects

Each verified against the code; measurements re-stated against the new source set.

**R1 — the refresh trigger is the primary cause of "2 articles."**
`news.service.ts:330` refreshes from upstream only when the DB holds `< 2`
articles. Once any 2 rows exist for a symbol, the pipeline **never fetches
again** — permanently. The screenshot's "2 articles" is this latch, exactly.

**R2 — the relevance filter drops market-moving headlines.**
`calculateRelevance` (L94-147) requires a *literal substring* match. Three
compounding causes:
- **The `> 0.4` boundary is strict** (L62), so a score of *exactly* `0.40` fails.
  Scores are quantized to {0, 0.3, 0.4, 0.5, 0.6, 1.0}, so the ingest boundary is
  the live dead-band. The `>0.4` / `>=0.5` mismatch (L62 vs L325) is a genuine
  second-order inconsistency, fixed here too.
- **`companyName` is matched as an exact substring.** It arrives as Yahoo's
  `longName` — `"Alphabet Inc."` — so a title reading "Alphabet slides…" does not
  match, and contributes **0.0**. This defect is *amplified* by the RSS source:
  its titles are publisher headlines that almost never contain the legal entity
  name, so under the current scorer most of the 100 RSS items would be discarded.
- **`relatedTickers` misses dual-class tickers.** Yahoo returns `GOOG` for most
  GOOGL articles, so the `+0.3` symbols bonus (L126-131) silently never fires for
  the requested symbol.

**R3 — the unrelated-ticker penalty is dead code.** L134-142 runs
`/\b[A-Z]{2,5}\b/g` against `titleLower`, already lowercased at L96. Verified:
the match returns `null`, always. The penalty has never once applied — but the
thresholds were tuned as if it did.

**R4 — `deduplicateNews()` (L248-265) is defined and never called.** Measured on
the new source: **7 near-duplicate titles inside a single RSS feed**, before
Yahoo overlap. Duplicates consume slots in the cap and double-count in the
sentiment average.

**R5 — three inconsistent time windows.** L318-328 filters `publishedAt >= now-7d`;
the two refetches (L340-347, L381-388) drop the date filter **entirely** (so they
can return articles of any age); the UI caption says "LAST 30 DAYS"
(`news-feed.tsx:106`). All three disagree. None is 30 days.

**R6 — the analysis cap silently truncates.** `slice(0, 3)` (L358) analyses at
most 3 unanalysed articles per request; `slice(0, 10)` (L79) caps the fetch.
Downstream, unanalysed articles are **excluded** from the aggregate
(`news-feed.tsx:56` filters `sentiment !== null`) but **counted** in the displayed
article total (L106/L113 use `news.length`) — so the caption can claim more
articles than the score is actually built from.

### And the score itself is overstated independently of retrieval

**S1 — the 0–10 mapping is linear and uncalibrated.** `sentimentToScore`
(`lib/utils/research-scores.ts:10`) is `(s+1)*5`. Two articles at +0.92 average
map to **9.6/10** — reproduced exactly: this is where the owner's 9.6 comes from
(`news-feed.tsx:84`).

**S2 — a 2-article sample produces a full-confidence headline.** There is no
minimum-sample or confidence rule anywhere. One article at +1.0 would render
**10.0/10**.

**S3 — the error path is a silent neutral.** `sentiment.service.ts:75-85` returns
`{sentiment: 0, confidence: 0.5, impact:'low'}` on **any** failure, including a
JSON parse error. This is indistinguishable from a genuine neutral reading and is
persisted as if real. A total Gemini outage renders as "perfectly neutral news."

**S4 — the prompt has no calibration anchors** (L30-54), so nothing pins what
+0.9 means versus +0.4. Combined with S1's linear map, mild-positive coverage
inflates toward the top of the scale.

## Approach

Fix in dependency order: **source swap and dead code first, then the refresh
latch, windows and dedup, then thresholds, then scoring.** A threshold cannot be
tuned while R1 freezes the corpus and R3 skews what the thresholds were set
against — so Tasks 0-4 must land before Task 5 tunes anything.

Scope is bounded by the owner's settled decisions: **Yahoo + Google News RSS
only, no paid sources, no new API keys**; and **sentiment analysis batches into a
single Gemini call** returning a structured array.

Key design decisions:

**Google News RSS is parsed with `cheerio`, not `rss-parser`.** The reference
implementation (`Compass/src/lib/news/rss.ts`) uses `rss-parser`, which is **not
installed in Meridian**. I checked it before planning it in: `rss-parser@3.13.0`
was **last published April 2023** (3+ years stale) and pulls in `xml2js`. Adding
a stale transitive-dependency chain for one XML parse is not justified here,
because **`cheerio` is already a dependency of this repo** (`package.json:41`,
`cheerio@1.1.2`, last published 2026-07-17 — actively maintained) and currently
has **zero call sites** (`git grep cheerio -- lib app components` returns
nothing). It parses this exact feed correctly in XML mode — verified live this
session, all 100 items extracted with titles, sources, links, and pubDates. So
this adds **no new dependency at all** and puts an already-paid-for, unused one
to work. Do not add `rss-parser`.

**Source and title are read from the `<source>` element, not guessed from the
title.** Compass splits `" - "` off the title to *derive* the publisher
(`rss.ts:143`) because its parser did not surface `<source>`. Meridian does not
need to guess: every item carries a `<source>` element (100/100 verified). Use
`<source>` for the publisher, and strip the **exact** `" - " + source` suffix
from the title — anchored to the source string, not a blind last-dash split. This
is strictly safer than Compass's approach, and the probe confirms it is
sufficient: 100/100 titles end in that exact suffix and **none** contain a second
`" - "`, so no headline is truncated.

**Dedup keys on normalized title, not URL.** Every RSS `<link>` is a
`news.google.com/rss/articles/...` redirect, never the publisher's canonical URL
(100/100 verified). So a Yahoo article and the same story from RSS will **never**
collide on URL — URL dedup is dead weight across sources, and normalized-title
dedup is the only key that works. Measured: 7 intra-feed dupes are caught by
title normalization. Meridian's planned dedup (Task 4) is kept and is
deliberately **not** replaced by Compass's version (`pipeline.ts:262-274`), which
normalizes full title strings and lets near-duplicates with differing punctuation
survive. Compass's relevance ranking (`pipeline.ts:277-291`) is also **not**
ported — it uses the same `includes()` substring matching that is the bug being
fixed here, and merely *sorts* by it rather than filtering, so it degrades
instead of dropping.

**Relevance becomes token-aware, not substring-literal.** Derive match tokens
from the symbol and company name — the raw symbol, the exchange-stripped symbol,
and the company name reduced to its distinctive core by stripping corporate
suffixes. `"Alphabet Inc."` yields the token `alphabet`, which matches "Alphabet
slides…". Match on **word boundaries**, not bare `includes`, so `SA` cannot match
inside "Salesforce". Take Compass's `CORP_SUFFIX` regex (`rss.ts:93`) rather than
writing a new one — it is materially more complete than the first version of this
plan sketched, handling `S.A.`, `société anonyme`, `N.V.`, `Oyj`, `ASA`, `AB`,
`SE`, `plc`, `AG`, `SpA`. Meridian has Belgian/European tickers (`BTLS.BR`
appears in the current code), so this matters.

**Ticker matching normalizes share classes.** Compare `relatedTickers` against the
symbol's root (strip a trailing class letter for known dual-class shapes) so
`GOOG` credits a `GOOGL` request. Conservative: applied only when the candidate
differs from the requested symbol by a trailing class character.

**One relevance threshold, one constant, one time window.** A single exported
`MIN_RELEVANCE` used by both the ingest filter and every DB read — eliminating the
`>0.4` / `>=0.5` split by construction — with a `>=` comparison so an exactly-at-
threshold article is kept. A single exported `NEWS_WINDOW_DAYS = 30` applied to
**all three** queries, matching the UI's existing claim.

**Sentiment batches into one Gemini call, structurally constrained by
`responseSchema`.** This is the biggest change from the first version of this
plan. Compass passes `responseMimeType: 'application/json'`, `temperature: 0.1`
and an explicit `responseSchema` (`gemini.ts:12-18`, `pipeline.ts:419-438`), which
makes the response shape a contract enforced by the API rather than a hope. That
**obsoletes most of the first plan's Task 7** — the hand-rolled index-echo
matching, the reordering defense, and the "missing index stays null" rule were all
scaffolding to survive a free-form text response. With a schema, the array shape
and required fields are guaranteed.

I verified how Meridian's SDK exposes this rather than assuming (Meridian uses
`@google/generative-ai@0.24.1`, not Compass's raw `fetch`). Confirmed against the
installed type definitions
(`node_modules/@google/generative-ai/dist/generative-ai.d.ts`):
`GenerationConfig` exposes both `responseMimeType?: string` (L691) and
`responseSchema?: ResponseSchema` (L697); `ResponseSchema = Schema` (L1205), a
union including `ArraySchema` (with `items`) and `ObjectSchema` (with
`properties`/`required`); every schema extends `BaseSchema`, which carries
`nullable?: boolean` (L30-35); and the type enum is the exported `SchemaType`
(L1252, lowercase string values — `"array"`, `"object"`, `"string"`, `"number"`).
So the config is passed through `getGenerativeModel({ model, generationConfig })`
using the SDK's `SchemaType` enum — **not** Compass's raw uppercase `'ARRAY'`
strings, which are the REST wire format and are not what this SDK's types expect.

Article identity uses **string ids (`art_0`, `art_1`)** as Compass does, not
positional integers — more robust, and it keeps a response element self-
describing. `extractValidJsonArray`'s bracket-counting logic (`gemini.ts:48-73`)
is ported as a **parse fallback** for the case where a model still wraps its JSON
in prose despite the schema.

**A model fallback chain replaces the single pinned model.** Meridian pins one
`GEMINI_MODEL` (`lib/services/gemini.ts:12`, `gemini-2.5-flash`) — a single point
of failure that already bit this project once (the model was retired mid-2026 and
started 404ing, per that file's own comment). Compass tries three models in
sequence (`gemini.ts:1-5`). Port the *pattern*, not the list: Compass names
`gemini-3.1-flash-lite` / `gemini-3.5-flash` / `gemini-1.5-flash`, and
`gemini-1.5-flash` is precisely the model Meridian already had to abandon. The
chain is constructed for Meridian (see Task 8).

**Failures stop masquerading as neutral.** `analyzeSentiment`'s catch returns an
explicit failure signal that callers must handle; a failed analysis leaves
`sentiment` as `null` (pending) in the DB rather than writing `0`. `null` is
already correctly excluded from the aggregate and already renders as "PENDING" in
the coverage list (`news-feed.tsx:31`), so this needs no new UI state — it just
stops a failure from voting `0` into the average.

**The headline score gains calibration and sample-awareness.** Two changes, both
in pure, testable helpers:
1. A **non-linear map** replacing `(s+1)*5`, compressing the extremes so that
   genuinely uniform, high-conviction coverage is required to reach 9+. Mild
   positive coverage lands in the 6-7 band where it belongs.
2. **Confidence damping toward neutral on thin samples.** Below a minimum sample
   (`MIN_CONFIDENT_SAMPLE = 5` analysed articles), the score is shrunk toward 5.0
   proportionally to how thin the sample is, so 2 articles cannot yield 9.6. The
   damping is continuous — no cliff at the boundary.

**The card tells the truth about its sample.** The caption and meta kicker are
driven by the *analysed* count, not the retrieved count, and a thin sample is
labelled as such. This is a **visible UI change** — see `## Assumptions`.

Deliberately **not** in scope: paid sources; Compass's full two-pass
extract-then-synthesize architecture (owner wants the Pass-1 prompt *language*
only, not the architecture); changing `calculateDailySentiment`'s impact-weighting
math (it is not on the path that produces the headline — traced: the 9.6 comes
from `news-feed.tsx:84`, and `SentimentHistory` is only read by
`/api/sentiment/[symbol]/history`, which no current component consumes); the
TD-DTL-TONE MoM delta.

## Tasks

0. [x] **Remove NewsAPI entirely.** Delete `fetchNewsAPI` (`news.service.ts:184-246`),
   its call site (L50-55), and the `NEWS_API_KEY` read. Remove `NEWS_API_KEY` from
   `.env.example`. Then handle the debt knock-ons, precisely and without
   overclaiming (see `## The TD-01 / ADR-7 / TD-28 knock-on` below for the exact
   wording and the gitleaks trap — **read that section before touching
   `.gitleaks.toml` or `.gitleaks-local/.gitleaksignore`**). Update
   `ARCHITECTURE.md` lines 8, 19, 45. Add the ADR-33 amendment to ADR-7. —
   Acceptance: `git grep -n "NEWS_API_KEY\|newsapi\|fetchNewsAPI"` returns hits
   **only** in `.gitleaks.toml`, `.gitleaks-local/.gitleaksignore`,
   `.github/workflows/verify.yml` comments, `TECH_DEBT.md`, `DECISIONS.md`, and
   `plans/` history — no hits under `lib/`, `app/`, `components/`, or
   `.env.example`. `npm run verify` passes (the secret scan must still pass —
   confirm the fingerprints still match).

1. [x] **Delete the dead unrelated-ticker penalty** (`news.service.ts:134-142`).
   Remove the block outright rather than "fixing" it against the original-case
   title — reintroducing a live penalty would change every score at once, in the
   same change that retunes thresholds, making both untestable. —
   Acceptance: a unit test asserts a title containing unrelated uppercase tickers
   (e.g. "GOOGL vs MSFT and AMZN") scores identically before and after; `grep -n
   "unrelatedTickers" lib/services/news.service.ts` returns nothing.

2. [x] **Fix the refresh latch** (`news.service.ts:330`). Replace the `< 2` guard
   with a staleness-aware condition: refresh when the DB has fewer than a target
   number of in-window articles **or** when the newest in-window article is older
   than a short freshness TTL. The existing 5-minute `node-cache` in
   `fetchNewsForSymbol` (L22) already bounds upstream call volume, so this cannot
   turn into a per-request fetch storm.

   *Considered and rejected: Compass's link-set fingerprint* (`pipeline.ts:304`),
   which invalidates a cached digest when the article link set changes. It is a
   good fit for Compass, which caches one **derived summary** per ticker and needs
   to know whether that summary is still valid for the current articles. Meridian's
   R1 is a different question: it must decide **whether to fetch upstream at all**,
   and a fingerprint of the links it already has cannot answer that — computing it
   requires the fetch whose necessity is in question. A fingerprint would be
   strictly circular here. The staleness TTL answers the actual question ("is what
   I have old?") with data already in the DB. Keeping the TTL. —
   Acceptance: a unit test with a mocked Prisma returning 2 **stale** articles
   asserts `fetchNewsForSymbol` **is** called; a second with a full set of fresh
   articles asserts it is **not**. Both assert the 5-min cache still short-circuits
   a second immediate call.

3. [x] **Reconcile the three time windows.** Export `NEWS_WINDOW_DAYS = 30` and
   apply the same `publishedAt >= now - NEWS_WINDOW_DAYS` filter to all three
   queries (L318-328, L340-347, L381-388), so the two refetches stop returning
   unbounded-age articles. —
   Acceptance: a unit test asserts all three `findMany` calls receive an identical
   `publishedAt.gte`; the UI's existing "last 30 days" caption is now accurate.

4. [x] **Wire up deduplication.** Call the existing `deduplicateNews()` in
   `fetchNewsForSymbol` on the merged Yahoo + RSS array, **before** relevance
   scoring and before the cap, so duplicates cannot consume slots. Fix its `seen`
   set, which currently mixes normalized-title keys and raw URLs in one set — use
   two sets. **Normalized title is the load-bearing key**: RSS `<link>` values are
   Google redirect URLs and never equal Yahoo's publisher URLs, so cross-source
   duplicates can only be caught by title (verified: 100/100 RSS links are
   `news.google.com/rss/articles/...` redirects). Keep the URL set as a cheap
   exact-dupe guard within a source. —
   Acceptance: a unit test feeds an array containing a known duplicate pair (same
   title, differing URL and source — the exact cross-source shape) and asserts one
   survives, and that the post-dedup count is what the cap is applied to. Measured
   baseline: **7 near-dupes in a single live RSS feed**.

5. [x] **Rewrite relevance scoring** (`calculateRelevance`, L94-147) — only now
   that Tasks 0-4 have removed the confounds. Extract to a pure, exported,
   unit-testable helper (`lib/utils/news-relevance.ts`): token derivation
   (corporate-suffix stripping using Compass's `CORP_SUFFIX` regex from
   `rss.ts:93`), word-boundary matching, and share-class-aware ticker
   normalization. Introduce a single exported `MIN_RELEVANCE` used with `>=` by
   both the ingest filter (L62) and **all three** DB reads (L324, L344, L385),
   removing the `>0.4`/`>=0.5` split.

   **This filter carries more weight than in the previous plan.** Google News RSS
   is higher-volume but lower-precision than Yahoo: 4 of 100 probe items were about
   a different company entirely ("Why Micron Stock Popped Today", "Intel Stock
   Jumps as Earnings Blow Past Expectations Amid Booming AI Demand"). With RSS as
   the volume source, this filter is the only thing standing between the score and
   another company's news. —
   Acceptance: table-driven unit tests over the live-measured cases — the real RSS
   headlines "Tesla, Alphabet lose hundreds of billions in value in post-earnings
   stock plunge", "Alphabet earnings are out and the stock is falling", "When AI
   CapEx Eats Cash: Is Alphabet's Huge Bet Building a Moat or Sinking Margins?" all
   score **at or above `MIN_RELEVANCE`** for symbol `GOOGL` / name
   `"Alphabet Inc."`; the live off-topic cases "Why Micron Stock Popped Today" and
   "Intel Stock Jumps as Earnings Blow Past Expectations Amid Booming AI Demand"
   score **below** it; a `GOOG`-tagged article credits a `GOOGL` request. `grep`
   confirms `0.4`/`0.5` relevance literals appear nowhere outside the constant's
   definition.

6. [x] **Add the Google News RSS source** (replaces the old "raise the NewsAPI
   pageSize" task, which is moot). Add `fetchGoogleNewsRSS(symbol, companyName)` to
   `news.service.ts`, ported from `Compass/src/lib/news/rss.ts:85-173` with the
   Meridian-specific changes below. Fetch with native `fetch` + `AbortController`
   (matching the pattern the removed `fetchNewsAPI` used, and
   `exchange-rate.service.ts`), and parse with **`cheerio` in `xmlMode: true`** —
   already a dependency, currently unused; **do not add `rss-parser`** (rationale
   in `## Approach`).

   Port precisely:
   - **Query construction** (`rss.ts:87-103`): strip the exchange suffix
     (`/\.[A-Z]+$/`), strip corporate suffixes from the company name via
     `CORP_SUFFIX`, then `"${shortName}" stock` for symbols ≤3 chars and
     `"${shortName}" OR ${cleanedSymbol} stock` for longer ones. URL-encode and
     replace `%20` with `+`.
   - **Per-item extraction**: `<title>`, `<link>`, `<pubDate>`, `<source>`.
   - **Title cleanup**: strip the trailing `" - " + <source>` suffix, anchored to
     the actual `<source>` text (escape it for regex use), **not** a blind
     last-dash split. Verified safe: 100/100 titles carry that exact suffix and 0
     contain a second `" - "`.
   - **Junk-title guard** (new, not in Compass): drop items whose cleaned title is
     empty, shorter than a minimum length, or matches an all-caps
     underscore-placeholder shape. The probe reproduced a literal
     `META_TITLE_QUOTE - Yahoo Finance` item; without this guard it reaches Gemini
     and is scored as if it were news.
   - **Timeout and failure**: hard timeout via `AbortController` (Compass uses
     4000ms); on non-OK status, abort, or parse failure, log once and return `[]`
     so Yahoo still succeeds — the existing `Promise.all` in `fetchNewsForSymbol`
     must not be allowed to reject the whole fetch.
   - `summary`/`content` are left undefined: the RSS `<description>` is only an
     anchor tag, not a real snippet (verified) — writing it into `summary` would
     feed markup to Gemini. Title-only is the honest input.

   Also replace the hardcoded `slice(0, 10)` (L79) with an exported
   `MAX_ARTICLES_PER_FETCH`. Volume characteristics of the final source set:
   **Yahoo hard-caps at 10 regardless of `newsCount`** (verified in the prior
   planning session: `newsCount: 30` still returns exactly 10); **RSS returns 100**.
   So the cap, not the sources, is now the binding constraint — size it to the
   number of articles actually worth analysing rather than to what the sources
   return. —
   Acceptance: a unit test feeds a **captured fixture of the real RSS XML** (saved
   from the probe, not hand-written) and asserts: item count parsed correctly;
   `" - Source"` stripped from every title; `source` populated from `<source>`;
   the `META_TITLE_QUOTE` item dropped by the junk guard; a non-OK HTTP status
   returns `[]` rather than throwing; and the merged result is capped at
   `MAX_ARTICLES_PER_FETCH` **after** dedup, not before. A second test asserts
   query construction for a ≤3-char symbol, a longer symbol, and a suffixed
   European symbol (`BTLS.BR`).

7. [x] **Batch the Gemini call with a `responseSchema`** (`sentiment.service.ts`).
   Add `analyzeSentimentBatch(articles)`: **one** `generateContent` request
   containing N articles each tagged with a string id (`art_0`, `art_1`, …), with
   `generationConfig: { responseMimeType: 'application/json', temperature: 0.1,
   responseSchema }`. Build the schema with the SDK's exported `SchemaType` enum
   (`SchemaType.ARRAY` / `.OBJECT` / `.STRING` / `.NUMBER`) — **not** the raw
   uppercase `'ARRAY'` strings Compass uses, which are the REST wire format and do
   not match this SDK's types. Shape: an array of objects with required `id` plus
   the sentiment fields, mirroring `pipeline.ts:419-438`.

   Because the schema constrains the response structurally, the previous plan's
   hand-rolled index-echo/reordering defenses are dropped. What remains:
   - Match results back to articles **by `id`**, not array position.
   - An article whose id is absent from the response stays `null` (unanalysed) —
     never defaulted to neutral.
   - Keep `extractValidJsonArray`'s bracket-counting parse (`gemini.ts:48-73`) as a
     **fallback** if `JSON.parse` of the raw text fails.

   Replace the `Promise.all` fan-out over `slice(0, 3)` (`news.service.ts:354-379`)
   with a single batch call over up to `MAX_ANALYZE_PER_PASS` articles. Keep the
   existing lazy `import('./sentiment.service')` exactly as-is — it is the
   documented guard against the module-scope `GEMINI_API_KEY` throw (AGENT.md
   fragile surface). —
   Acceptance: unit tests assert (a) **one** `generateContent` call for N articles,
   not N calls; (b) the call passes `responseMimeType: 'application/json'` and a
   `responseSchema` whose `type` is `SchemaType.ARRAY`; (c) a response missing one
   id leaves that article `null` and still writes the others correctly; (d) a
   response with **reordered** ids maps each sentiment to the correct article;
   (e) a response wrapped in prose is still parsed via the bracket-counting
   fallback; (f) a malformed/non-JSON response writes **nothing** rather than
   neutral zeros. Rewrite `lib/services/news.service.test.ts`, whose two current
   tests assert exactly the 3-call concurrent fan-out this task removes (they
   mock `analyzeAndUpdateArticle` and assert `toHaveBeenCalledTimes(3)` plus
   interleaved start/end ordering — both become meaningless under batching).

8. [x] **Add a Gemini model fallback chain** (`lib/services/gemini.ts`). Replace
   the single `GEMINI_MODEL` constant with an ordered `GEMINI_MODELS` list tried in
   sequence, falling through on a failed request (as `Compass/src/lib/news/gemini.ts:7-46`
   does) and logging which model served. Keep `GEMINI_MODEL` exported as the first
   entry of the chain so the two existing consumers and the
   `sentiment.service.test.ts` assertion that the constant is not the retired
   `gemini-1.5-flash` keep working.

   **Construct the chain for Meridian; do not copy Compass's list.** Meridian
   currently pins `gemini-2.5-flash` (live-verified against this project's key,
   `plans/2026-07-20-gemini-model-update.md`). Compass lists
   `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-1.5-flash` — and
   `gemini-1.5-flash` is **the exact model Meridian already had to abandon when
   Google retired it**, so copying that list would reintroduce a known-dead
   endpoint as a fallback. Lead with the currently-verified `gemini-2.5-flash` and
   add one or two live alternatives, each confirmed to respond before being
   committed. This directly addresses the single-point-of-failure tradeoff ADR-31
   previously rated Medium confidence on. —
   Acceptance: a unit test asserts that when the first model's `generateContent`
   rejects, the second is tried and its result returned; that all models failing
   surfaces a failure (not a fabricated neutral — see Task 9); and that
   `GEMINI_MODEL` still equals the chain's first entry. Manual: confirm each model
   in the committed chain actually responds with the project key before merging.

9. [x] **Stop silent-neutral masking** (`sentiment.service.ts:75-85`). The catch
   must surface failure rather than return a well-formed neutral: return an
   explicit failure result, and have `analyzeAndUpdateArticle` / the batch path
   leave `sentiment` as `null` on failure instead of persisting `0`. Log once per
   failed batch, not per article. —
   Acceptance: a unit test asserts a rejected `generateContent` (on **every** model
   in the Task 8 chain) results in **no** `prisma.newsArticle.update` writing
   `sentiment: 0`; the article remains `null` and is therefore excluded from the
   aggregate (already the behaviour at `news-feed.tsx:56`) and renders "PENDING".
   Update the existing `sentiment.service.test.ts` case at L72-87, which currently
   asserts the silent-neutral return being removed here.

10. [x] **Add calibration anchors and a selectivity rule to the prompt**
    (`sentiment.service.ts:30-54`), carried into the batch prompt from Task 7.
    Two additions:
    - **Calibration anchors.** State explicitly what the scale means, with anchored
      examples: routine analyst-target and syndicated promotional coverage → mild
      (±0.2-0.4); genuine company-specific earnings/guidance/regulatory news →
      strong (±0.6-0.9); reserve ±0.9+ for major surprises. Instruct that a
      price-move article's sentiment must follow the **direction of the move**, and
      that `impact` reflects market materiality, not the article's tone.
    - **A selectivity rule**, ported from Compass's Pass-1 prompt
      (`pipeline.ts:394-398`): instruct the model to treat vague or clickbait items
      as low-impact/low-confidence unless concrete facts (a figure, a ruling, a
      named event) are stated in the title, and to prefer specific factual
      headlines. This targets the owner's failure case directly — the two articles
      that produced the 9.6 were "Google's profits are outrunning its AI spending
      boom" and Zacks' "Could Surge 25.12%", exactly the promotional genre this rule
      demotes. **Port the prompt language only — not Compass's two-pass
      extract-then-synthesize architecture** (owner decision).
    Note the input constraint: RSS items are **title-only** (no usable snippet, see
    Task 6), so the prompt must not imply body text will be present. —
    Acceptance: a unit test asserts the generated batch prompt contains the anchor
    examples, the selectivity rule, and the id-tagging instruction. This task's real
    validation is the manual check below — the unit test only guards against silent
    prompt loss.

11. [x] **Calibrate the 0-10 map and damp thin samples.** In
    `lib/utils/research-scores.ts`, add a non-linear `sentimentToScore` replacement
    and a `dampenForSample(score, analysedCount)` helper shrinking toward 5.0 below
    `MIN_CONFIDENT_SAMPLE = 5`. **`sentimentToScore` itself must keep its current
    exact behaviour and its passing tests** — it is also consumed by
    `components/overview.tsx:150` (the composite's sentiment dimension) and
    mirrored in `lib/services/wishlist.service.ts:352`; introduce the calibrated
    map as a **new** exported function and migrate all three call sites
    deliberately in this task, so the composite and the wishlist cannot silently
    diverge from the News tab. —
    Acceptance: unit tests assert **the owner's exact reported case** — 2 articles
    averaging +0.92 no longer produces 9.6 and lands below 8.0; a single +1.0
    article does not produce 10.0; ≥5 uniformly strong-positive articles still
    reach the 8+ band; the neutral midpoint stays exactly 5.0; and the three call
    sites (news-feed, overview, wishlist) all produce the identical score for
    identical input.

12. [x] **Make the card honest about its sample** (`components/news-feed.tsx`).
    Drive the meta kicker and caption off the **analysed** count rather than
    `news.length` (L106, L113), and surface a thin-sample state when analysed
    count is below `MIN_CONFIDENT_SAMPLE`. Use existing `DESIGN.md` tokens and the
    existing `HeadlineScoreCard` slots only — no new chrome. The `ScoreFigure`
    `null/unavailable → --mut` band already exists for the zero-analysed case. —
    Acceptance: rendering with 2 analysed articles shows a damped score and a
    thin-sample caption; with 0 analysed shows the existing no-coverage state;
    the meta-kicker count matches the number actually feeding the score. **Visible
    UI change — Designer stage applies.**

13. [x] **Update docs.** `TECH_DEBT.md`: amend TD-01 and TD-28 per the knock-on
    section below; add a Backlog entry for the remaining `calculateDailySentiment` /
    `SentimentHistory` path (impact-only weighting, and the fact that nothing
    currently reads the history route) if still unaddressed. `ARCHITECTURE.md`:
    update lines 8, 19, 45 for the source swap, and the `news.service.ts` /
    `sentiment.service.ts` / `gemini.ts` rows for the batch call, the model chain,
    and the shared constants. `AGENT.md`: add fragile-surface entries for the
    relevance-scoring helper, the RSS title/`<source>` parsing contract, the
    `responseSchema` batch contract, and the model fallback chain.
    `future_ideas.md`: note that native per-article sentiment via a paid provider
    (e.g. EODHD) is a possible future upgrade, explicitly out of scope now. Add the
    ADRs below to `DECISIONS.md`. —
    Acceptance: `grep` confirms each touched invariant is documented; ADR entries
    cite real file:line evidence.

## The TD-01 / ADR-7 / TD-28 knock-on

`git grep` confirms `lib/services/news.service.ts` is the **sole consumer** of
`NEWS_API_KEY` — ADR-7's own Evidence line states this, and the grep agrees
(the only other hits are `.env.example`, the two gitleaks config files, CI
comments, and docs). Removing the consumer therefore changes the risk materially,
but **not** in the way it is tempting to claim. Be precise:

**What removal does NOT do.** The key remains readable in git history
(commits `2a6c4c1a`, `3855042e`) **forever**. Deleting the consumer does not
unpublish it, does not revoke it (newsapi.org's free tier still offers no revoke),
and does not make the historical commits safe. Anyone who has already scraped the
repo has the key regardless.

**What removal DOES do.** Nothing in the application can spend the quota any
more. The exposure stops being "our deployed app shares a quota with the public"
and becomes "a dead key we no longer use is public." The *residual* risk is that
a third party burns a quota on an account the owner still nominally holds — an
annoyance against an unused free-tier account, not a user-visible outage.

**Therefore:**

- **TD-01 → downgraded and amended, not closed.** It cannot be closed: the
  credential is still live and still public. But its **blocking precondition on
  production deploys is lifted** — that condition existed because a deployed app
  depending on this key would suffer a user-visible outage if the quota were
  exhausted. With no consumer, no deploy can be affected. Amend the entry:
  severity Medium → Low; strike "**Blocking condition — do not deploy to
  production while this is open**"; replace the recommended fix with "delete the
  newsapi.org account (the only real remediation now that nothing consumes the
  key); optionally scrub history / make the repo private." Update the `Used by`
  clause — it currently names `lib/services/news.service.ts`, which will no longer
  reference it.
- **ADR-7 → superseded by ADR-33** (below), not edited in place. ADR-7's status is
  `accepted-but-flagged` with the validity **conditional on non-deployment** — and
  that condition is exactly what changes. Its own Confidence note flags the risk:
  "a decision conditional on 'we won't deploy' silently expires the moment someone
  deploys." ADR-33 removes the dependence on that condition. Mark ADR-7
  `superseded by ADR-33` and leave its text intact for history.
- **TD-28 → amended, and the CI gate can be tightened only partially.** TD-28's
  recommended fix says to drop `continue-on-error` from the `secret-history` job
  "when TD-01 is fully resolved." TD-01 is **not** fully resolved by this plan, so
  **do not remove `continue-on-error` in this change.** The job would still go red:
  gitleaks matches *shapes* in history and cannot know a value is unused, so it
  will keep reporting the NewsAPI finding (and the three rotated ones) on every
  run. What *can* change is the justification — amend TD-28 to record that the
  blocker is now purely historical-findings noise rather than a live consumed
  credential, and that the remaining path to a required check is a
  fingerprint-suppressed, history-scoped ignore file (or history scrub), not a
  fresh key. Also update the CI comment block in
  `.github/workflows/verify.yml:106-126`, which currently states "NEWS_API_KEY is
  still live and public" as the reason and points at obtaining a fresh key.
- **`.env.example`** — remove the `NEWS_API_KEY` lines (14-15). Safe: it holds only
  the placeholder `"your-newsapi-key"`.
- **`.gitleaks.toml`** — **keep** the `newsapi-key` rule (L19-22). It is a
  *history* detector, and the secret is still in history; deleting the rule would
  make the `secret-history` job stop reporting a leak that still exists. Removing
  a detector is not the same as fixing a leak.
- **`.gitleaks-local/.gitleaksignore`** — ⚠️ **do not edit, and do not remove the
  `NEWS_API_KEY` line from the owner's local `.env`/`.env.local` as part of this
  task.** The fingerprints are **line-number anchored**:
  `.env:newsapi-key:13`, `.env:gcp-api-key:16`, `.env:gemini-api-key-assignment:16`
  (and the `.env.local` equivalents). Deleting the `NEWS_API_KEY` line from a local
  env file shifts every subsequent line up, so `gcp-api-key:16` and
  `gemini-api-key-assignment:16` would **no longer match** and `npm run verify`'s
  secret scan would start failing on the *Gemini* key — a self-inflicted red that
  looks like a new leak. This is the same class of trap AGENT.md already documents
  for key rotation. The env files are untracked and out of scope for this plan;
  leave both the files and the fingerprints alone, and note the hazard in
  `AGENT.md` so a future cleanup does it deliberately (remove the line **and**
  re-fingerprint in the same change).

## Files to create or modify

- `lib/services/news.service.ts` — delete NewsAPI, add RSS source, refresh latch, windows, dedup wiring, cap, thresholds, batch call
- `lib/utils/news-relevance.ts` *(new)* — pure token derivation + relevance scoring
- `lib/utils/news-relevance.test.ts` *(new)*
- `lib/services/news.service.test.ts` — rewrite the fan-out tests for the batch; add RSS-fixture parsing tests
- `lib/services/__fixtures__/google-news-googl.xml` *(new)* — captured real RSS response for deterministic parser tests
- `lib/services/sentiment.service.ts` — batch method + `responseSchema`, prompt anchors + selectivity rule, failure signalling
- `lib/services/sentiment.service.test.ts` — update the silent-neutral test
- `lib/services/gemini.ts` — model fallback chain (`GEMINI_MODELS`), keep `GEMINI_MODEL` as chain head
- `lib/services/gemini.test.ts` *(new, if absent)* — fallback-chain tests
- `lib/utils/research-scores.ts` — calibrated map + sample damping
- `lib/utils/research-scores.test.ts` — extend
- `components/news-feed.tsx` — analysed-count caption, thin-sample state
- `components/overview.tsx` — migrate to the calibrated map (L150)
- `lib/services/wishlist.service.ts` — migrate to the calibrated map (L352, L385)
- `.env.example` — remove `NEWS_API_KEY`
- `.github/workflows/verify.yml` — update the `secret-history` comment block (comment only; **no** `continue-on-error` change)
- `ARCHITECTURE.md`, `AGENT.md`, `DECISIONS.md`, `TECH_DEBT.md`, `future_ideas.md`, `DESIGN.md` (if the Designer adds a thin-sample pattern)

**Not modified:** `.gitleaks.toml`, `.gitleaks-local/.gitleaksignore` (see the knock-on section).

## Verification

The `## Verify` block in AGENT.md runs automatically. Beyond it:

- **The owner's exact case, end to end.** Load `/research/GOOGL` → News &
  sentiment. Expect: article count in the high teens or more (not 2); the
  coverage list containing the negative/mixed headlines the probe found
  (CNBC/Investopedia/Barron's/MarketWatch capex-selloff coverage), not only
  promotional ones; and a score that is **not** 9.6 on a -7% day.
- **Confirm no NewsAPI request is made.** The app must work with `NEWS_API_KEY`
  absent from the environment entirely — unset it locally and confirm the tab
  still populates.
- **Confirm the RSS source works for a European ticker.** Load a `.BR` symbol
  (e.g. `BTLS.BR`) and confirm the query strips the exchange suffix and returns
  something sane — this is the path `CORP_SUFFIX` and the symbol cleanup exist for,
  and it is not covered by the GOOGL case.
- **Confirm the junk-title guard fires.** The `META_TITLE_QUOTE` item is present in
  the live feed; confirm it does not appear in the coverage list.
- **Confirm the refresh latch is broken.** Load the tab twice ~6 minutes apart
  (past the 5-min `node-cache` TTL) and confirm new articles appear rather than
  the same frozen set.
- **Confirm a single Gemini call per pass**, not N — observable in the request
  count / latency, or via a temporary log removed before commit.
- **Confirm the model fallback chain.** Temporarily point the first entry at a
  bogus model name and confirm the second serves the request (then revert).
- **Sanity-check calibration against a known-negative symbol** so the fix is not
  merely "less positive on GOOGL": pick a stock down sharply on company-specific
  news and confirm the score lands below 5.
- **Confirm no regression in the composite.** The Overview tab's sentiment
  dimension must move consistently with the News tab's headline (Task 11 migrates
  both) — they must not disagree.
- **Note in the PR** that Task 1 removes a never-executing penalty, so no score
  changes attributable to it.

## Assumptions

Carried forward from the owner-approved first version where still applicable, plus
new ones from the source swap.

- **A sentiment-prompt rewrite and score recalibration are in scope** (Tasks 10,
  11) even though the owner scoped only retrieval and batching. Justification: the
  evidence shows the score is wrong for reasons retrieval alone cannot fix — a
  single +1.0 article still renders 10.0/10 after every retrieval fix lands, and
  the silent-neutral error path (S3) means a Gemini outage is currently
  indistinguishable from genuinely neutral news. **If the owner wants scoring left
  alone, Tasks 10-12 can be dropped without affecting 0-9.**
- **Task 12 changes visible UI** (caption/meta-kicker copy and a thin-sample
  state). It is deliberately constrained to existing `HeadlineScoreCard` slots and
  `DESIGN.md` tokens, but the Designer stage should confirm the thin-sample
  treatment before it is coded.
- **`MIN_CONFIDENT_SAMPLE = 5` and the exact damping curve are starting values,
  not derived constants.** Chosen so the owner's 2-article case is visibly damped
  while a realistic 15-30 article corpus is unaffected. Expect one tuning pass
  after the owner sees real output.
- **Google News RSS is treated as a stable, unversioned public feed.** It is
  undocumented and unsupported by Google — the shape could change without notice.
  Mitigated by: parsing defensively (missing elements skip the item, not throw), a
  hard timeout, and returning `[]` on any failure so Yahoo alone still serves the
  tab. Accepted because the alternative is a paid source the owner has rejected.
  If the feed shape breaks, the symptom is a thin-sample card, not an error page.
- **Google News RSS rate limits are unknown.** No published quota; the 5-minute
  `node-cache` plus the Task 2 staleness TTL bound request volume to roughly one
  fetch per symbol per 5 minutes. If Google starts returning 429, the failure is
  already handled as "return `[]`". Not a new key or a billing risk either way.
- **Article `url` stores the Google redirect link for RSS items.** `NewsArticle.url`
  is the upsert key, so the redirect URL becomes the identity for those rows. This
  is stable (verified: identical across two fetches) and the links resolve for the
  user. The consequence is that the same story from Yahoo and RSS is deduped by
  *title*, never by URL — which Task 4 accounts for explicitly.
- **`cheerio` is a safe parse target for untrusted XML here.** It is already a
  dependency, actively maintained, and used only to read text out of elements — no
  HTML is rendered from the parse result. Titles still flow into React, which
  escapes them.
- **`calculateDailySentiment` / `SentimentHistory` are left as-is.** Traced: the
  9.6 does not originate there (it is `news-feed.tsx:84`), and the only reader of
  that data, `/api/sentiment/[symbol]/history`, has no current component consumer.
- **Share-class normalization is applied conservatively** (trailing class letter
  only). A symbol pair that differs by more than that will not be merged.

## Open decisions

None. The owner's decisions (drop NewsAPI; Yahoo + Google News RSS; no paid
sources; reject EODHD; batch into a single Gemini call) settle the material
questions. The two implementation choices the brief left to my judgement — the RSS
parser (`cheerio`, not `rss-parser`) and the R1 fix (staleness TTL, not
fingerprint) — are decided above with reasoning; remaining uncertainty is in
`## Assumptions`.

## Proposed DECISIONS.md entries

```
## ADR-30 — Relevance scoring is token-based with word-boundary matching, on one shared threshold
- **Decision:** Replace `news.service.ts`'s literal-substring relevance scoring with a
  pure, exported helper (`lib/utils/news-relevance.ts`) that derives match tokens by
  stripping corporate suffixes from the company name, matches on word boundaries, and
  normalizes share-class ticker variants (GOOG↔GOOGL). A single exported `MIN_RELEVANCE`,
  compared with `>=`, governs both the ingest filter and every DB read.
- **Evidence:** `lib/utils/news-relevance.ts` (new); `lib/services/news.service.ts` ingest
  filter and all three `findMany` relevance filters — not-implemented until this plan lands.
- **Tradeoffs:** Token matching is more permissive than substring matching and will admit
  some market-context articles that only mention the company in passing; accepted, because
  the measured alternative discards the articles that explain a -7% day. The dead uppercase
  penalty is removed rather than repaired, so no compensating precision mechanism remains —
  precision now rests entirely on the token/threshold pair. That bet is larger under ADR-34's
  RSS source, which measured 4 off-topic items per 100, than it was under the prior source
  set; this filter is now the only guard against scoring another company's news.
- **Status:** proposed
- **Confidence:** High

## ADR-31 — Sentiment analysis is one batched Gemini call constrained by responseSchema; failures persist as null, never neutral
- **Decision:** Replace the per-article Gemini fan-out (capped at 3) with a single
  `analyzeSentimentBatch` request whose `generationConfig` sets
  `responseMimeType: 'application/json'`, `temperature: 0.1`, and an explicit
  `responseSchema` (built with the SDK's `SchemaType` enum). Articles are tagged with string
  ids (`art_0`, …) and results matched back by id, not array position. An article absent
  from the response, or any parse/request failure, leaves `sentiment` as `null` (pending) —
  the prior silent `sentiment: 0, confidence: 0.5` fallback is removed. Compass's
  bracket-counting `extractValidJsonArray` is kept as a parse fallback.
- **Evidence:** `lib/services/sentiment.service.ts`; `lib/services/news.service.ts` analysis
  block — not-implemented until this plan lands. SDK support verified against
  `node_modules/@google/generative-ai/dist/generative-ai.d.ts`: `GenerationConfig.responseMimeType`
  (L691), `.responseSchema` (L697), `ResponseSchema = Schema` (L1205), `SchemaType` enum (L1252).
- **Tradeoffs:** `responseSchema` makes the response shape an API-enforced contract rather
  than a prompt request, which removes the hand-rolled index-echo and reordering defenses an
  earlier draft of this decision required. It costs a hard dependency on the schema feature
  being supported by every model in the ADR-32 chain — verified per model before commit. One
  batch remains a single point of failure for N articles where the fan-out degraded
  per-article; mitigated by ADR-32's model chain and by leaving unanalysed articles `null`
  (already excluded from the aggregate and rendered "PENDING"), which is strictly more honest
  than the fabricated neutral it replaces.
- **Status:** proposed
- **Confidence:** High — raised from the earlier draft's Medium: the schema removes the
  parse-shape risk, and ADR-32 removes the single-model risk that drove the original rating.

## ADR-32 — Gemini calls try an ordered model chain instead of one pinned model
- **Decision:** `lib/services/gemini.ts` exports an ordered `GEMINI_MODELS` chain, tried in
  sequence until one succeeds. `GEMINI_MODEL` remains exported as the chain's first entry so
  existing consumers and tests are unaffected. The chain leads with the currently
  live-verified `gemini-2.5-flash`; Compass's list is deliberately not copied, because it
  includes `gemini-1.5-flash` — the exact model Google retired out from under this project
  in 2026 (`plans/2026-07-20-gemini-model-update.md`).
- **Evidence:** `lib/services/gemini.ts:12` (current single constant); pattern ported from
  `Compass/src/lib/news/gemini.ts:1-46` — not-implemented until this plan lands.
- **Tradeoffs:** A failing primary now costs extra latency (a failed round-trip before the
  fallback) instead of failing fast, and outputs can differ subtly between models, so a
  score may shift depending on which model served it. Accepted: this project has already
  been broken once by a single pinned model being retired, and a silently degraded score is
  preferable to a whole tab returning nothing. Every model in the chain must be
  live-verified before commit — an unverified fallback is worse than none.
- **Status:** proposed
- **Confidence:** High

## ADR-33 — NewsAPI is removed; ADR-7's non-deployment condition no longer gates production
- **Decision:** Supersedes ADR-7. `NEWS_API_KEY` and all NewsAPI code are removed from the
  application. The leaked key remains live and publicly readable in git history (commits
  `2a6c4c1a`, `3855042e`) and is still not revocable — removing the consumer does **not**
  unpublish or revoke it. What changes is that nothing in the app can spend the quota, so
  ADR-7's validity condition ("this app is not in production") no longer carries any weight:
  a deploy cannot be affected by exhaustion of a quota the app never calls. TD-01 is
  therefore downgraded (Medium → Low) and its blocking precondition on production deploys is
  lifted, but TD-01 is **not closed** — the real remediation is deleting the newsapi.org
  account.
- **Evidence:** `lib/services/news.service.ts` (sole consumer, removed by this plan — ADR-7's
  own Evidence line and `git grep NEWS_API_KEY` both confirm sole-consumer status);
  `.env.example` (entry removed); `TECH_DEBT.md` TD-01 (amended); `.gitleaks.toml`
  `newsapi-key` rule (deliberately retained — the secret is still in history, and deleting a
  detector is not fixing a leak) — not-implemented until this plan lands.
- **Tradeoffs:** The residual exposure is a public, unrevocable key on an unused free-tier
  account — an annoyance rather than a risk to data, users, or availability. `secret-history`
  CI stays `continue-on-error` because gitleaks matches shapes in history and cannot know a
  value is unused, so it will keep reporting this finding; tightening that gate still
  requires a history scrub or a fingerprint-suppressed history-scoped ignore file (TD-28).
- **Status:** proposed
- **Confidence:** High

## ADR-34 — Google News RSS replaces NewsAPI as the volume source, parsed with cheerio
- **Decision:** The news source set becomes **Yahoo Finance `search()` (precision) + Google
  News RSS (volume)**. NewsAPI is removed rather than demoted. RSS is fetched keylessly via
  native `fetch` + `AbortController` and parsed with **`cheerio` in `xmlMode: true`** — already
  a dependency of this repo (`package.json:41`, actively maintained) with zero existing call
  sites. `rss-parser` (the reference implementation's choice) is deliberately **not** added:
  it was last published April 2023 and pulls in `xml2js`, and adding a stale dependency chain
  is unjustified when an installed, maintained parser handles the feed. Publisher name comes
  from each item's `<source>` element and the matching `" - " + source` suffix is stripped
  from the title.
- **Rationale (live-probed 2026-07-24, one keyless request):** NewsAPI's free tier is delayed
  **24 hours**, which makes it structurally incapable of explaining a same-day selloff
  regardless of tuning. The RSS feed returned **100 items**, `200 application/xml`, carrying
  the exact capex-selloff coverage the pipeline missed (CNBC, Investopedia, Barron's,
  MarketWatch, Yahoo Finance) from publishers NewsAPI's free tier does not serve. Parse
  contract verified on the live response: 100/100 items carry `<source>`; 100/100 titles end
  in exactly `" - " + source`; **0** contain a second `" - "` (so suffix stripping cannot
  truncate a headline).
- **Evidence:** `lib/services/news.service.ts` (`fetchNewsAPI` removed, `fetchGoogleNewsRSS`
  added); `lib/services/__fixtures__/google-news-googl.xml` (captured live response backing
  the parser tests) — not-implemented until this plan lands.
- **Tradeoffs:** Three, all accepted. (1) **Lower precision** — 4 of 100 probe items were
  about a different company, so ADR-30's relevance filter becomes load-bearing rather than
  a safety net. (2) **Dirty data** — the probe reproduced a literal `META_TITLE_QUOTE`
  placeholder title, requiring a junk-title guard; assume more such artifacts exist. (3)
  **Unversioned, undocumented, unsupported feed** — Google can change or withdraw it without
  notice; mitigated by defensive parsing, a hard timeout, and returning `[]` on any failure
  so Yahoo alone still serves the tab. A further consequence: RSS `<link>` values are Google
  redirect URLs, never publisher URLs, so cross-source dedup must key on normalized title
  (URL dedup can never match across the two sources) and `NewsArticle.url` stores the
  redirect for RSS rows.
- **Status:** proposed
- **Confidence:** High
```
