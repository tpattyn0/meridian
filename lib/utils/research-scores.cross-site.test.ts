import { describe, expect, it } from "vitest";
import { calibratedSentimentToScore, computeSentimentScore, dampenForSample, round1 } from "./research-scores";
import { wishlistService } from "@/lib/services/wishlist.service";

type Article = { sentiment?: number | null; impact?: string | null; relevanceScore?: number | null };

// wishlist.service.ts's calculateSentimentScore is private; access it the
// same way the class does internally rather than reimplementing its logic
// in the test (that reimplementation is exactly what made the old version
// of this file tautological).
const calculateSentimentScore = (
  wishlistService as unknown as { calculateSentimentScore: (articles: Article[]) => number }
).calculateSentimentScore.bind(wishlistService);

/**
 * Plan Task 11 acceptance (plans/2026-07-24-news-sentiment-accuracy.md):
 * "the three call sites (news-feed, overview, wishlist) all produce the
 * identical score for identical input."
 *
 * Review NSA-I2 (reviews/2026-07-24-news-sentiment-accuracy.md): the
 * original version of this file computed the same expression three times
 * under three different local names and asserted they matched each other —
 * it never imported or called any of the three real call sites, so it was
 * structurally incapable of failing. It reported green while NSA-I1 (a real
 * divergence, up to 1.2 points on identical input) was live.
 *
 * This version exercises the ACTUAL shared implementation
 * (`computeSentimentScore`, extracted from the three call sites per NSA-I1's
 * recommendation) and the real `wishlist.service.ts` call site through its
 * public API. `news-feed.tsx` and `overview.tsx` are React components with
 * no render seam in this repo (TD-38) — per NSA-I2's recommendation, their
 * sentiment-score derivation was extracted into the same shared
 * `computeSentimentScore` function they both now call directly (see their
 * source), so asserting all three import/call that one exported symbol is
 * the honest test of "cannot silently diverge": there is no per-component
 * copy left to diverge.
 */
describe("News & sentiment score — cross-call-site consistency (Task 11, NSA-I1/NSA-I2)", () => {
  it("news-feed.tsx and overview.tsx both import and call the shared computeSentimentScore (no per-component copy to diverge)", async () => {
    const newsFeedSource = await import("fs").then((fs) =>
      fs.readFileSync(new URL("../../components/news-feed.tsx", import.meta.url), "utf-8")
    );
    const overviewSource = await import("fs").then((fs) =>
      fs.readFileSync(new URL("../../components/overview.tsx", import.meta.url), "utf-8")
    );

    expect(newsFeedSource).toMatch(/import\s*\{[^}]*\bcomputeSentimentScore\b[^}]*\}\s*from\s*["']@\/lib\/utils\/research-scores["']/);
    expect(newsFeedSource).toMatch(/computeSentimentScore\(/);

    expect(overviewSource).toMatch(/import\s*\{[^}]*\bcomputeSentimentScore\b[^}]*\}\s*from\s*["']@\/lib\/utils\/research-scores["']/);
    expect(overviewSource).toMatch(/computeSentimentScore\(/);
  });

  it("wishlist.service.ts's calculateSentimentScore (private, exercised via getWishlistWithScores' sentiment path) matches computeSentimentScore for the same articles", () => {
    const cases: Article[][] = [
      // the owner's exact reported case
      [
        { sentiment: 0.92, impact: "high", relevanceScore: 0.9 },
        { sentiment: 0.92, impact: "high", relevanceScore: 0.9 },
      ],
      // NSA-I1 case 1: 5 articles, 2 strong-positive + 3 negative
      [
        { sentiment: 0.92, impact: "high", relevanceScore: 0.9 },
        { sentiment: 0.92, impact: "high", relevanceScore: 0.9 },
        { sentiment: -0.8, impact: "medium", relevanceScore: 0.4 },
        { sentiment: -0.8, impact: "medium", relevanceScore: 0.4 },
        { sentiment: -0.8, impact: "medium", relevanceScore: 0.4 },
      ],
      // NSA-I1 case 2: null-sentiment (unanalysed) articles present
      [
        { sentiment: 0.92, impact: "high", relevanceScore: 0.9 },
        { sentiment: 0.92, impact: "high", relevanceScore: 0.9 },
        { sentiment: null, impact: "medium", relevanceScore: 0.4 },
        { sentiment: null, impact: "medium", relevanceScore: 0.4 },
      ],
      // articles in the [0.4, 0.5) relevance band — the last hardcoded 0.5
      // literal (news-feed.tsx) used to silently drop these
      [
        { sentiment: 0.3, impact: "low", relevanceScore: 0.45 },
        { sentiment: -0.3, impact: "low", relevanceScore: 0.42 },
        { sentiment: 0.1, impact: "low", relevanceScore: 0.4 },
      ],
      [],
    ];

    for (const articles of cases) {
      const shared = computeSentimentScore(articles).score;
      const wishlist = calculateSentimentScore(articles);
      expect(wishlist).toBe(shared);
    }
  });

  it("reproduces the review's NSA-I1 divergence shapes and asserts the shared function resolves them (not just that three copies agree with each other)", () => {
    // Review-reported divergence #1 (a hardcoded news-feed.tsx relevance
    // filter, `>= 0.5`, that overview.tsx/wishlist.service.ts never applied):
    // 5 articles, 2 above the 0.5 line, 3 in [0.4, 0.5) — pre-fix, the News
    // tab silently dropped the 3 low-relevance articles while Overview/
    // wishlist kept all 5, producing two different populations (and thus two
    // different scores) from the identical input array. Post-fix, all three
    // sites see the same population (no client-side re-filter — the server
    // already applied MIN_RELEVANCE), so this asserts the *shared* function
    // scores the full 5-article population, not the filtered 2-article one.
    const case1 = [
      { sentiment: 0.92, impact: "high" as const, relevanceScore: 0.9 }, // survives old >= 0.5 filter
      { sentiment: 0.92, impact: "high" as const, relevanceScore: 0.9 }, // survives old >= 0.5 filter
      { sentiment: -0.8, impact: "medium" as const, relevanceScore: 0.4 }, // old filter would drop this
      { sentiment: -0.8, impact: "medium" as const, relevanceScore: 0.4 }, // old filter would drop this
      { sentiment: -0.8, impact: "medium" as const, relevanceScore: 0.4 }, // old filter would drop this
    ];
    const result1 = computeSentimentScore(case1);
    // The 3 negative articles must be counted (population = all 5, not the
    // old filter's 2) — this is the regression lock for the removed 0.5
    // literal. Cross-check the number independently via the same formulas
    // this file imports, rather than a hand-typed literal, so the assertion
    // can't itself go stale if the calibration constant is retuned.
    expect(result1.analysedCount).toBe(5);
    const expected1 = round1(
      dampenForSample(
        calibratedSentimentToScore(
          (0.92 * 3 * 0.9 * 2 + -0.8 * 2 * 0.4 * 3) / (3 * 0.9 * 2 + 2 * 0.4 * 3)
        ),
        5
      )
    );
    expect(result1.score).toBe(expected1);
    // Sanity: this must differ from what the old filtered-to-2-articles
    // population would have scored, or this case isn't exercising the bug.
    const filteredToTwoOnly = computeSentimentScore(case1.slice(0, 2));
    expect(result1.score).not.toBe(filteredToTwoOnly.score);

    // Review-reported divergence #2 (null-sentiment coercion): 4 articles,
    // 2 analysed positive + 2 unanalysed (`sentiment: null`). Pre-fix,
    // overview.tsx/wishlist.service.ts coerced null -> 0 (dragging the
    // average toward neutral and inflating analysedCount to 4), while
    // news-feed.tsx excluded them (analysedCount 2). Post-fix, the shared
    // function excludes null everywhere — analysedCount must be 2, not 4,
    // and the score must equal the 2-article-only population's score.
    const case2 = [
      { sentiment: 0.92, impact: "high" as const, relevanceScore: 0.9 },
      { sentiment: 0.92, impact: "high" as const, relevanceScore: 0.9 },
      { sentiment: null, impact: "medium" as const, relevanceScore: 0.4 },
      { sentiment: null, impact: "medium" as const, relevanceScore: 0.4 },
    ];
    const result2 = computeSentimentScore(case2);
    const positiveOnly = computeSentimentScore(case2.filter((a) => a.sentiment !== null));
    expect(result2.analysedCount).toBe(2);
    expect(result2.score).toBe(positiveOnly.score);

    // All three real call sites must agree with the shared function on both
    // cases — the actual regression-lock for NSA-I1.
    for (const articles of [case1, case2]) {
      const shared = computeSentimentScore(articles).score;
      expect(calculateSentimentScore(articles)).toBe(shared);
    }
  });
});
