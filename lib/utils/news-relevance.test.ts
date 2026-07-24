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

  it("scores spread across the range rather than piling at 1.00 (measured live-headline set)", () => {
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
    const distinctValues = new Set(scores.map((s) => s.toFixed(2)));
    // Pre-fix, every one of these ties at 1.00 (0 distinct values above the
    // ceiling). Post-fix there must be real spread, not a single pile-up.
    expect(distinctValues.size).toBeGreaterThan(1);
    expect(scores.every((s) => s <= 1.0)).toBe(true);
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
});
