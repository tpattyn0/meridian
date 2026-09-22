import { describe, it, expect, vi, beforeEach } from "vitest";

// NB: vi.mock factories are hoisted above imports/top-level consts, so the
// fixture must be defined inside the factory rather than shared via a
// module-scope const.
vi.mock("@/lib/prisma", () => {
  const wishlistItem = {
    id: "item-1",
    wishlistId: "wishlist-1",
    ticker: "AAPL",
    name: "Apple Inc.",
    currency: "USD",
    addedPrice: 100,
    currentPrice: 100,
    targetPrice: null,
    notes: null,
    createdAt: new Date("2026-01-01"),
  };

  return {
    prisma: {
      wishlist: {
        findUnique: vi.fn().mockResolvedValue({ id: "wishlist-1", userId: "user-1", items: [] }),
        create: vi.fn(),
      },
      wishlistItem: {
        findMany: vi.fn().mockResolvedValue([wishlistItem]),
        update: vi.fn().mockResolvedValue(wishlistItem),
      },
      analystRating: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userScoringPreferences: {
        // No row — getWeights falls back to DEFAULT_SCORING_WEIGHTS, matching
        // this test's pre-existing hand-computed expected composite exactly
        // (plans/2026-07-20-configurable-scoring-weights.md, Task 8).
        findUnique: vi.fn().mockResolvedValue(null),
      },
    },
  };
});

vi.mock("@/lib/yahoo-finance", () => ({
  default: {
    quote: vi.fn().mockResolvedValue({ regularMarketPrice: 100, currency: "USD" }),
  },
}));

vi.mock("./market-data.service", () => ({
  marketDataService: {
    getHistoricalData: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./technical-analysis.service", () => ({
  technicalAnalysisService: {
    calculateIndicators: vi.fn(),
  },
}));

// fundamentalScore = 0 (legitimate, e.g. worst possible fundamentals) — the
// AUD-05 regression this test guards against: `|| 5` would have silently
// replaced this with a neutral 5.
vi.mock("./fundamental-analysis.service", () => ({
  fundamentalAnalysisService: {
    fetchFundamentals: vi.fn().mockResolvedValue({ score: { total: 0 } }),
  },
}));

vi.mock("./news.service", () => ({
  newsService: {
    getAnalyzedNewsForSymbol: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./intrinsic-value.service", () => ({
  IntrinsicValueService: {
    calculateIntrinsicValue: vi.fn().mockResolvedValue({ upsidePercent: null }),
  },
}));

import { wishlistService } from "./wishlist.service";
import { fundamentalAnalysisService } from "./fundamental-analysis.service";
import { marketDataService } from "./market-data.service";
import { technicalAnalysisService } from "./technical-analysis.service";

describe("WishlistService.getWishlistWithScores composite score (AUD-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fundamentalAnalysisService.fetchFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      score: { total: 0 },
    });
  });

  it("treats a legitimate score of 0 as a real value, not as missing (?? 5, not || 5)", async () => {
    const results = await wishlistService.getWishlistWithScores("user-1");

    expect(results).toHaveLength(1);
    expect(results[0].fundamentalScore).toBe(0);

    // sentiment(5, default from empty articles) * .15 + fundamental(0) * .25 +
    // technical(null -> ?? 5) * .20 + intrinsic(null -> ?? 5) * .25 + analyst(null -> ?? 5) * .15
    // = 5*.15 + 0*.25 + 5*.20 + 5*.25 + 5*.15 = 0.75 + 0 + 1 + 1.25 + 0.75 = 3.75,
    // rounded to one decimal place by the service = 3.8.
    // With the old `|| 5` bug, fundamentalScore=0 would have been replaced by 5,
    // producing a composite of 5.0 instead.
    expect(results[0].compositeScore).toBe(3.8);
  });
});

/**
 * SCM-03 (consumer half, reviews/2026-07-17-scoring-methodology.md,
 * plans/2026-07-26-scoring-methodology-phase1-correctness.md): an
 * INSUFFICIENT_DATA technical result must yield technicalScore = null so the
 * composite substitutes a neutral 5, not a bearish 0. Pre-fix, the source
 * (getInsufficientDataResponse) carried score: 0, which passed the
 * `typeof === 'number'` check and dragged the composite down by ~1 point
 * purely for missing data.
 */
describe("WishlistService.getWishlistWithScores — SCM-03 insufficient-data technical score", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fundamentalAnalysisService.fetchFundamentals as ReturnType<typeof vi.fn>).mockResolvedValue({
      score: { total: 5 },
    });
    (marketDataService.getHistoricalData as ReturnType<typeof vi.fn>).mockResolvedValue([
      { value: 100, volume: 1_000_000 },
      { value: 101, volume: 1_000_000 },
    ]);
  });

  it("sets technicalScore = null (not 0) when the technical result is INSUFFICIENT_DATA", async () => {
    (technicalAnalysisService.calculateIndicators as ReturnType<typeof vi.fn>).mockReturnValue({
      signal: "INSUFFICIENT_DATA",
      score: null,
    });

    const results = await wishlistService.getWishlistWithScores("user-1");

    expect(results[0].technicalScore).toBeNull();
    // All dimensions default to fundamental(5)/sentiment(5, empty
    // articles)/technical(null -> 5)/intrinsic(null -> 5)/analyst(null -> 5)
    // => composite 5.0, not dragged down by a bearish-0 technical score.
    expect(results[0].compositeScore).toBe(5);
  });

  it("still uses a real technical score when the indicators are valid (regression)", async () => {
    (technicalAnalysisService.calculateIndicators as ReturnType<typeof vi.fn>).mockReturnValue({
      signal: "BUY",
      score: 7.2,
    });

    const results = await wishlistService.getWishlistWithScores("user-1");

    expect(results[0].technicalScore).toBe(7.2);
  });
});
