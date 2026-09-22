import { describe, expect, it } from "vitest";
import {
  MIN_RELEVANCE,
  deriveMatchTokens,
  scoreRelevance,
  tickerCreditsSymbol,
} from "./news-relevance";

describe("deriveMatchTokens", () => {
  it("derives the symbol, exchange-stripped symbol, and corporate-suffix-stripped company core", () => {
    const tokens = deriveMatchTokens("GOOGL", "Alphabet Inc.");
    expect(tokens).toContain("googl");
    expect(tokens).toContain("alphabet");
  });

  it("does not produce a malformed trailing-punctuation token (regression, review 2026-07-24)", () => {
    // CORP_SUFFIX strips "Inc" from "Alphabet Inc.", leaving the orphaned
    // "Alphabet ." — the old /[,\s]+$/ trim did not remove a trailing "."
    // (only commas/whitespace), so "alphabet ." leaked through as a junk
    // token that could never match a real headline via word-boundary.
    const tokens = deriveMatchTokens("GOOGL", "Alphabet Inc.");
    expect(tokens).not.toContain("alphabet .");
    for (const token of tokens) {
      expect(token.trim()).toBe(token);
      expect(token.endsWith(".")).toBe(false);
      expect(token.endsWith(",")).toBe(false);
    }
  });

  it("strips the exchange suffix for a European ticker", () => {
    const tokens = deriveMatchTokens("BTLS.BR", "Barco NV");
    expect(tokens).toContain("btls.br");
    expect(tokens).toContain("btls");
    expect(tokens).toContain("barco");
  });

  it("drops tokens shorter than 2 characters", () => {
    const tokens = deriveMatchTokens("A", undefined);
    expect(tokens).not.toContain("a");
  });
});

describe("tickerCreditsSymbol — share-class normalization", () => {
  it("credits GOOG for a GOOGL request (trailing class letter)", () => {
    expect(tickerCreditsSymbol("GOOG", "GOOGL")).toBe(true);
    expect(tickerCreditsSymbol("GOOGL", "GOOG")).toBe(true);
  });

  it("matches an exact ticker", () => {
    expect(tickerCreditsSymbol("AAPL", "AAPL")).toBe(true);
  });

  it("does not credit unrelated tickers", () => {
    expect(tickerCreditsSymbol("MSFT", "GOOGL")).toBe(false);
  });

  it("is conservative — a symbol differing by more than a trailing class letter is not merged", () => {
    expect(tickerCreditsSymbol("GOOGLE", "GOOGL")).toBe(false);
  });
});

describe("scoreRelevance — live-measured GOOGL/Alphabet cases (plan Task 5 acceptance)", () => {
  const symbol = "GOOGL";
  const companyName = "Alphabet Inc.";

  it("scores real on-topic RSS headlines at or above MIN_RELEVANCE", () => {
    const onTopic = [
      "Tesla, Alphabet lose hundreds of billions in value in post-earnings stock plunge",
      "Alphabet earnings are out and the stock is falling",
      "When AI CapEx Eats Cash: Is Alphabet's Huge Bet Building a Moat or Sinking Margins?",
    ];
    for (const title of onTopic) {
      const score = scoreRelevance({ title }, symbol, companyName);
      expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE);
    }
  });

  it("scores real off-topic RSS headlines below MIN_RELEVANCE", () => {
    const offTopic = [
      "Why Micron Stock Popped Today",
      "Intel Stock Jumps as Earnings Blow Past Expectations Amid Booming AI Demand",
    ];
    for (const title of offTopic) {
      const score = scoreRelevance({ title }, symbol, companyName);
      expect(score).toBeLessThan(MIN_RELEVANCE);
    }
  });

  it("scores real off-topic RSS headlines below MIN_RELEVANCE even carrying the RSS fetcher's self-tag (NSA-S2)", () => {
    // fetchGoogleNewsRSS sets `symbols: [symbol]` on every item it creates
    // (the requested symbol, self-asserted, not derived from the article) —
    // this is the exact shape RSS items actually have, unlike the untagged
    // cases above. The margin protecting MIN_RELEVANCE here is thin (an
    // off-topic RSS item scores exactly 0.3, one notch below 0.4) — this
    // test pins it so a future change to MIN_RELEVANCE or the symbols bonus
    // can't silently admit every off-topic RSS item.
    const offTopic = [
      "Why Micron Stock Popped Today",
      "Intel Stock Jumps as Earnings Blow Past Expectations Amid Booming AI Demand",
    ];
    for (const title of offTopic) {
      const score = scoreRelevance({ title, symbols: [symbol] }, symbol, companyName);
      expect(score).toBeLessThan(MIN_RELEVANCE);
    }
  });

  it("a GOOG-tagged article credits a GOOGL request via the symbols array (adds the symbols bonus)", () => {
    const withoutTag = scoreRelevance({ title: "Market wrap: tech megacaps mixed" }, symbol, companyName);
    const withGoogTag = scoreRelevance(
      { title: "Market wrap: tech megacaps mixed", symbols: ["GOOG"] },
      symbol,
      companyName
    );
    expect(withGoogTag).toBeGreaterThan(withoutTag);
  });

  it("a GOOG-tagged, Alphabet-titled article clears MIN_RELEVANCE for a GOOGL request", () => {
    const score = scoreRelevance(
      { title: "Alphabet earnings are out and the stock is falling", symbols: ["GOOG"] },
      symbol,
      companyName
    );
    expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE);
  });

  it("does not require a literal company-name substring match — word-boundary token match is sufficient", () => {
    // "Alphabet slides…" does not contain "Alphabet Inc." verbatim, but does
    // contain the distinctive core token "alphabet".
    const score = scoreRelevance({ title: "Alphabet slides on spending concerns" }, symbol, companyName);
    expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE);
  });

  it("SA cannot match inside Salesforce (word-boundary, not bare includes)", () => {
    const score = scoreRelevance(
      { title: "Salesforce announces new AI product" },
      "SA",
      "Some SA Company"
    );
    // "sa" as a token must not match inside "Salesforce" — no word boundary there.
    expect(score).toBeLessThan(MIN_RELEVANCE);
  });
});

describe("scoreRelevance — saturation fix (regression, review 2026-07-24 manual checks)", () => {
  const symbol = "GOOGL";
  const companyName = "Alphabet Inc.";

  it("does not stack per-token matches within the same field to the 1.0 ceiling", () => {
    // A title containing BOTH the ticker token and the company-core token
    // (the ordinary shape of ticker-stuffed boilerplate, e.g. a 13F filing
    // notice) previously scored 0.5 + 0.5 = 1.0 before the symbols bonus was
    // even added — the exact defect that let MarketBeat 13F notices crowd
    // out real reporting once nearly everything tied at the ceiling.
    const score = scoreRelevance(
      { title: "Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBeLessThan(1.0);
  });

  it("does not stack per-token matches to the title band, pinned on a NON-boilerplate title (NSA3-I1)", () => {
    // The test above uses a boilerplate title, so its `< 1.0` assertion is
    // satisfied by the boilerplate demotion alone (1.0 * 0.5 = 0.65) even if
    // the underlying per-field accumulation regresses back to per-token
    // stacking — the demotion masks the saturation fix exactly as the old
    // threshold-only tests masked the original defect (review iteration 3,
    // NSA3-I1). This title matches BOTH the ticker token ("googl") and the
    // company-core token ("alphabet") in the title field but has no
    // boilerplate shape at all, so nothing can rescue the assertion: under
    // per-token accumulation the title field alone would score
    // 0.5 + 0.5 = 1.0; under the flat per-field band it must score exactly
    // TITLE_MATCH_SCORE (0.5), regardless of how many tokens matched.
    const score = scoreRelevance(
      { title: "Alphabet (GOOGL) slides on earnings" },
      symbol,
      companyName
    );
    expect(score).toBe(0.5);
  });

  it("a title matching one token scores identically to a title matching multiple tokens in the same field (NSA3-I1)", () => {
    // The decisive property of a per-field band, stated directly: matching
    // more tokens in the same field must not increase the score. Neither
    // title is boilerplate-shaped, so the demotion cannot equalize them by
    // accident — this is the flat-band contract itself, not a downstream
    // consequence of it.
    const oneToken = scoreRelevance(
      { title: "Alphabet slides on spending concerns" },
      symbol,
      companyName
    );
    const threeTokens = scoreRelevance(
      // Matches "googl" (raw symbol), "alphabet" (company-core word), and
      // "alphabet inc" is not a token, but "googl" + "alphabet" + the
      // exchange-stripped symbol "googl" (same as raw here) still gives at
      // least two independent tokens hitting the title in one field.
      { title: "GOOGL: Alphabet Inc. shares slide on spending concerns" },
      symbol,
      companyName
    );
    expect(oneToken).toBe(threeTokens);
    expect(oneToken).toBe(0.5);
  });

  it("real reporting outranks a MarketBeat-style 13F filing notice for the same symbol (ranking assertion)", () => {
    // The core regression: threshold-only assertions (>= MIN_RELEVANCE) can't
    // catch saturation, because both of these clear the bar. What matters is
    // that genuine reporting is scored ABOVE routine institutional-holdings
    // boilerplate, not tied with it — otherwise the news.service.ts sort's
    // >0.1 relevance-preference gap never fires and a continuously-publishing
    // boilerplate source wins on recency alone.
    const cnbcSelloff = scoreRelevance(
      {
        title: "Tesla, Alphabet lose hundreds of billions in value in post-earnings stock plunge",
        symbols: ["GOOGL"],
      },
      symbol,
      companyName
    );
    const marketBeat13F = scoreRelevance(
      { title: "Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(cnbcSelloff).toBeGreaterThan(marketBeat13F);
    // The gap must clear news.service.ts's >0.1 relevance-preference sort
    // threshold, or the fix doesn't actually change sort order.
    expect(cnbcSelloff - marketBeat13F).toBeGreaterThan(0.1);
  });

  it("a second MarketBeat-style 13F headline ('Shares Sold by') is also outranked by real reporting", () => {
    const stockStory = scoreRelevance(
      { title: "Why Alphabet (GOOGL) Shares Are Getting Obliterated Today", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    const marketBeat13F2 = scoreRelevance(
      {
        title: "Alphabet Inc. $GOOGL Shares Sold by Bryn Mawr Trust Advisors LLC",
        symbols: ["GOOGL"],
      },
      symbol,
      companyName
    );
    expect(stockStory).toBeGreaterThan(marketBeat13F2);
  });

  it("scores match the exact expected lattice rather than piling at 1.00 (measured live-headline set, NSA3-I1)", () => {
    // Recommendation 3 (review iteration 3, NSA3-I1): a bare
    // `distinctValues.size > 1` check is nearly unfalsifiable once any
    // demotion exists in the pipeline — it is satisfied by the boilerplate
    // demotion alone even if per-token accumulation regresses (the demoted
    // set becomes {0.65, 1.00}, still size 2). Asserting the exact expected
    // values makes a change in banding visible instead of absorbed: all five
    // titles are RSS-shaped (title + self-tagged symbols only, no
    // summary/content), so under the current flat-band scorer every one
    // lands on exactly one of two reachable RSS values — 0.40 (demoted 13F
    // shape) or 0.80 (undemoted title+symbols match).
    const measured: [string, string[]][] = [
      ["Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL", ["GOOGL"]],
      ["Alphabet Inc. $GOOGL Shares Sold by Bryn Mawr Trust Advisors LLC", ["GOOGL"]],
      ["Why Alphabet (GOOGL) Shares Are Getting Obliterated Today", ["GOOGL"]],
      ["Tesla, Alphabet lose hundreds of billions in value in post-earnings stock plunge", ["GOOGL"]],
      ["Market Digest: CCI, COF, DHR, GOOGL, NOC, NOK, TSLA", ["GOOGL"]],
    ];
    const scores = measured.map(([title, symbols]) =>
      scoreRelevance({ title, symbols }, symbol, companyName)
    );
    expect(scores).toEqual([0.4, 0.4, 0.8, 0.8, 0.8]);
    expect(new Set(scores).size).toBe(2);
  });

  it("MIN_RELEVANCE / demotion-factor coupling: a demoted RSS-sourced 13F notice lands at exactly MIN_RELEVANCE (NSA3-S1)", () => {
    // (TITLE_MATCH_SCORE + SYMBOLS_MATCH_SCORE) * BOILERPLATE_DEMOTION_FACTOR
    // = (0.5 + 0.3) * 0.5 = 0.40, which is exactly MIN_RELEVANCE — a
    // deliberate-but-undocumented-until-now coincidence (review iteration 3,
    // directed-verification item 4 / NSA3-S1). It survives filtering only
    // because scoreRelevance's ingest comparison uses >=. This test pins the
    // relationship directly: it fails loudly (not silently) if
    // BOILERPLATE_DEMOTION_FACTOR, MIN_RELEVANCE, TITLE_MATCH_SCORE, or
    // SYMBOLS_MATCH_SCORE drift out of this exact relationship.
    const score = scoreRelevance(
      { title: "Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBe(MIN_RELEVANCE);
    expect(score).toBe(0.4);
  });
});

describe("scoreRelevance — 13F/institutional-holdings boilerplate demotion", () => {
  const symbol = "GOOGL";
  const companyName = "Alphabet Inc.";

  const boilerplateTitles = [
    "Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL",
    "Alphabet Inc. $GOOGL Shares Sold by Bryn Mawr Trust Advisors LLC",
    "Meridian Capital Boosts Stock Position in Alphabet Inc. $GOOGL",
    "Harbor Advisors Grows Stake in Alphabet Inc. $GOOGL",
    "Elm Street Wealth Has $1.2 Million Stake in Alphabet Inc. $GOOGL",
    // Live-measured against real GOOGL RSS data during this fix's
    // verification pass — the share count appears AFTER "Shares of" rather
    // than before it, a second word order the pattern must also catch.
    "ABC Arbitrage SA Acquires Shares of 4,494 Alphabet Inc. $GOOGL",
  ];

  it("demotes each measured 13F/institutional-holdings title shape below undemoted title-only relevance", () => {
    for (const title of boilerplateTitles) {
      const demoted = scoreRelevance({ title, symbols: ["GOOGL"] }, symbol, companyName);
      // Title + symbols alone (no demotion) would be 0.5 + 0.3 = 0.8; the
      // demotion factor must pull every boilerplate shape below that.
      expect(demoted).toBeLessThan(0.8);
    }
  });

  it("still clears MIN_RELEVANCE (demoted, not discarded) — a 13F notice is technically on-topic", () => {
    const score = scoreRelevance(
      { title: "Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBeGreaterThanOrEqual(MIN_RELEVANCE);
  });

  it("does not demote a genuine news headline that happens to mention a share/position count", () => {
    // The demotion must be narrow: matched on institutional-actor filing
    // *shape* (buys/sells N shares of, shares sold by, boosts/grows a
    // position/stake in, has $N stake in) — not on the mere presence of a
    // number or the word "shares". A real news headline that happens to
    // mention a share count must NOT be caught by this.
    const genuine = [
      "Alphabet issues 10 million new shares as part of employee compensation plan",
      "Alphabet raises 2025 guidance, adds 500 jobs",
      "Alphabet's board approves a new share buyback program worth $70 billion",
    ];
    for (const title of genuine) {
      const withDemotion = scoreRelevance({ title }, symbol, companyName);
      const titleOnlyBand = 0.5; // TITLE_MATCH_SCORE, undemoted
      expect(withDemotion).toBeGreaterThanOrEqual(titleOnlyBand);
    }
  });

  it("does not demote an article with no boilerplate-shaped title at all", () => {
    const score = scoreRelevance(
      { title: "Tesla, Alphabet lose hundreds of billions in value in post-earnings stock plunge" },
      symbol,
      companyName
    );
    expect(score).toBe(0.5);
  });

  it("does not demote genuine corporate-action, insider-transaction, or index-rebalance headlines (NSA3-Q1, owner decision (b))", () => {
    // Review iteration 3 measured 12 false positives across 20 probed
    // real-headline shapes against the pre-tightening pattern set — all from
    // the verb+noun patterns having no institutional-actor anchor. These are
    // the exact headlines from that table (NSA3-Q1's Directed Verification
    // item 1). None of them has an institutional-actor suffix (LLC, LP,
    // Inc., Trust, Advisors, Management, Capital, Partners, Retirement
    // System, Bank, ...) anchoring the actor name, so none should match the
    // 13F filing-notice shape — they must score their full undemoted band,
    // never the demoted (halved) version of it.
    //
    // Two of these titles ("Nvidia cuts holdings in Arm Holdings...", "S&P
    // 500 index raises its position...") don't mention Alphabet/GOOGL in the
    // title text at all, so they only earn the symbols bonus (0.3) even
    // undemoted — included anyway because they were part of the review's
    // false-positive table and must still not be halved to 0.15.
    const expected: [string, number][] = [
      ["SoftBank trims stake in Alphabet to fund AI buildout", 0.8],
      ["Alphabet reduces stake in Chinese AI venture amid regulatory pressure", 0.8],
      ["Nvidia cuts holdings in Arm Holdings, filing shows", 0.3],
      ["Alphabet boosts its stake in Anthropic", 0.8],
      ["Alphabet Raises Its Position in AI Infrastructure Spending", 0.8],
      ["S&P 500 index raises its position in tech names after rebalance", 0.3],
      ["Alphabet Shares Sold by Insiders Ahead of Earnings", 0.8],
      ["Alphabet shares sold by CEO Sundar Pichai under 10b5-1 plan", 0.8],
      ["Alphabet insider sells 4,000 shares of stock", 0.8],
    ];
    for (const [title, expectedScore] of expected) {
      const score = scoreRelevance({ title, symbols: ["GOOGL"] }, symbol, companyName);
      expect(score, title).toBe(expectedScore);
    }
  });

  it("still demotes the true 13F filing-notice shapes after the actor-anchor tightening (NSA3-Q1)", () => {
    // The other half of NSA3-Q1: tightening the patterns to require an
    // institutional-actor anchor must not lose the true positives the
    // demotion exists for. Same live-measured MarketBeat-style set as above,
    // reproduced here with the actor-anchor requirement engaged.
    const true13FShapes = [
      "Nwam LLC Buys 8,055 Shares of Alphabet Inc. $GOOGL",
      "Alphabet Inc. $GOOGL Shares Sold by Bryn Mawr Trust Advisors LLC",
      "Meridian Capital Boosts Stock Position in Alphabet Inc. $GOOGL",
      "Harbor Advisors Grows Stake in Alphabet Inc. $GOOGL",
      "Elm Street Wealth Has $1.2 Million Stake in Alphabet Inc. $GOOGL",
      "ABC Arbitrage SA Acquires Shares of 4,494 Alphabet Inc. $GOOGL",
      // NSA4-I1: carries the "Inc." suffix a real filer's name actually has
      // (the pre-fix version of this case, "Berkshire Hathaway Buys
      // 5,000,000 Shares of Alphabet" with no suffix, passed the old
      // "does not demote" test at 0.8 for the wrong reason — it never
      // engaged the actor-anchor pattern at all, since bare "Berkshire
      // Hathaway" carries no institutional suffix. This is the corrected
      // shape: Berkshire Hathaway Inc. is a genuine third-party
      // institutional filer, not the requested company (Alphabet), so it
      // must still demote — proving the NSA4-I1 self-exclusion fix demotes
      // a real 13F filer and only un-demotes the subject company's own
      // corporate actions (see the dedicated describe block below).
      "Berkshire Hathaway Inc. Buys 5,000,000 Shares of Alphabet",
    ];
    for (const title of true13FShapes) {
      const score = scoreRelevance({ title, symbols: ["GOOGL"] }, symbol, companyName);
      expect(score).toBe(0.4);
    }
  });

  it("demotes real filer-name shapes using the Corp/Lllp/Associates suffixes (NSA4-I1, live-measured filer shapes)", () => {
    // Corp/Lllp/Associates were absent from INSTITUTIONAL_ACTOR_SUFFIX even
    // though real MarketBeat-style filer names use them ("Corp" is also
    // already present in the unrelated CORP_SUFFIX list used for company-name
    // token derivation — the two lists serve different purposes and were not
    // in sync).
    const realFilerShapes = [
      "Van ECK Associates Corp Sells 500 Shares of Alphabet Inc. $GOOGL",
      "Jones Financial Companies Lllp Buys 1,000 Shares of Alphabet Inc. $GOOGL",
    ];
    for (const title of realFilerShapes) {
      const score = scoreRelevance({ title, symbols: ["GOOGL"] }, symbol, companyName);
      expect(score, title).toBe(0.4);
    }
  });
});

describe("scoreRelevance — boilerplate self-exclusion for the subject company's own corporate actions (NSA4-I1)", () => {
  const symbol = "GOOGL";
  const companyName = "Alphabet Inc.";

  it("does not demote a genuine corporate-action headline where the subject company is the actor", () => {
    // "Alphabet Inc." satisfies the institutional-actor suffix anchor
    // (ends in "Inc."), so without the self-exclusion fix this matches
    // pattern 1 (actor <suffix> buys/sells N shares of ...) and gets
    // demoted to 0.40 — reintroducing the exact false-positive class
    // NSA3-Q1 was raised to eliminate, through a different route. This is
    // real news about the requested company, not a third-party 13F filer
    // reporting a stake in it.
    const score = scoreRelevance(
      { title: "Alphabet Inc. Buys 100,000 Shares of Anthropic in AI push", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBe(0.8);
  });

  it("still demotes a genuine third-party institutional filer's 13F notice about the subject company", () => {
    // Sanity check the fix narrows correctly: a REAL third-party filer
    // (Berkshire Hathaway, not Alphabet) reporting a stake in Alphabet must
    // still be demoted — the self-exclusion must reject only a match whose
    // actor segment IS the subject company, never a genuine other actor.
    const score = scoreRelevance(
      { title: "Berkshire Hathaway Inc. Buys 5,000,000 Shares of Alphabet", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBe(0.4);
  });

  it("does not demote the subject company's own share-sale/reduction headline", () => {
    const score = scoreRelevance(
      { title: "Alphabet Inc. Sells 250,000 Shares of Anthropic to fund AI buildout", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBe(0.8);
  });

  it("does not demote the subject company boosting a stake in another company", () => {
    const score = scoreRelevance(
      { title: "Alphabet Inc. Boosts Stock Position in Anthropic", symbols: ["GOOGL"] },
      symbol,
      companyName
    );
    expect(score).toBe(0.8);
  });
});
