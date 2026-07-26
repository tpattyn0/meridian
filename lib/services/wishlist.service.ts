import { prisma } from '@/lib/prisma';
import { marketDataService } from './market-data.service';
import { fundamentalAnalysisService } from './fundamental-analysis.service';
import { technicalAnalysisService } from './technical-analysis.service';
import { newsService } from './news.service';
import { IntrinsicValueService } from './intrinsic-value.service';
import yahooFinance from '@/lib/yahoo-finance';
import { getWeights } from './scoring-preferences.service';
import { normalizeCompositeWeights, weightedCompositeTotal } from '@/lib/utils/scoring-weights';
import { computeSentimentScore } from '@/lib/utils/research-scores';

export interface WishlistItemWithScores {
  id: string;
  ticker: string;
  name: string;
  currency: string;
  addedPrice: number;
  currentPrice: number;
  targetPrice: number | null;
  notes: string | null;
  createdAt: Date;
  priceChange: number;
  priceChangePercent: number;
  fundamentalScore: number | null;
  analystScore: number | null;
  technicalScore: number | null;
  sentimentScore: number | null;
  intrinsicScore: number | null;
  compositeScore: number | null;
  targetPriceUpside: number | null;
}

export class WishlistService {
  async getOrCreateWishlist(userId: string) {
    let wishlist = await prisma.wishlist.findUnique({
      where: { userId },
      include: { items: true }
    });

    if (!wishlist) {
      wishlist = await prisma.wishlist.create({
        data: { userId },
        include: { items: true }
      });
    }

    return wishlist;
  }

  async addToWishlist(
    userId: string,
    ticker: string,
    targetPrice?: number,
    notes?: string
  ) {
    // Validate ticker exists
    const quote = await yahooFinance.quote(ticker);
    if (!quote || !quote.regularMarketPrice) {
      throw new Error('Invalid ticker symbol');
    }

    // Get or create wishlist
    const wishlist = await this.getOrCreateWishlist(userId);

    // Check if already in wishlist
    const existingItem = await prisma.wishlistItem.findUnique({
      where: {
        wishlistId_ticker: {
          wishlistId: wishlist.id,
          ticker: ticker.toUpperCase()
        }
      }
    });

    if (existingItem) {
      throw new Error('This stock is already in your wishlist');
    }

    // Check limit
    const itemCount = await prisma.wishlistItem.count({
      where: { wishlistId: wishlist.id }
    });

    if (itemCount >= 50) {
      throw new Error('Wishlist limit reached (50 items maximum)');
    }

    // Check if already in portfolio
    const portfolio = await prisma.portfolio.findUnique({
      where: { userId },
      include: { positions: { where: { ticker: ticker.toUpperCase() } } }
    });

    if (portfolio?.positions && portfolio.positions.length > 0) {
      throw new Error('This stock is already in your portfolio');
    }

    // Create wishlist item
    const item = await prisma.wishlistItem.create({
      data: {
        wishlistId: wishlist.id,
        ticker: ticker.toUpperCase(),
        name: quote.shortName || quote.longName || ticker,
        currency: quote.currency || 'USD',
        addedPrice: quote.regularMarketPrice,
        currentPrice: quote.regularMarketPrice,
        targetPrice,
        notes
      }
    });

    return item;
  }

  async removeFromWishlist(userId: string, itemId: string) {
    const wishlist = await this.getOrCreateWishlist(userId);

    const item = await prisma.wishlistItem.findFirst({
      where: {
        id: itemId,
        wishlistId: wishlist.id
      }
    });

    if (!item) {
      throw new Error('Wishlist item not found');
    }

    await prisma.wishlistItem.delete({
      where: { id: itemId }
    });

    return { success: true };
  }

  async updateWishlistItem(
    userId: string,
    itemId: string,
    updates: {
      targetPrice?: number | null;
      notes?: string | null;
    }
  ) {
    const wishlist = await this.getOrCreateWishlist(userId);

    const item = await prisma.wishlistItem.findFirst({
      where: {
        id: itemId,
        wishlistId: wishlist.id
      }
    });

    if (!item) {
      throw new Error('Wishlist item not found');
    }

    return await prisma.wishlistItem.update({
      where: { id: itemId },
      data: updates
    });
  }

  async getWishlistWithScores(userId: string): Promise<WishlistItemWithScores[]> {
    const wishlist = await this.getOrCreateWishlist(userId);
    const items = await prisma.wishlistItem.findMany({
      where: { wishlistId: wishlist.id },
      orderBy: { createdAt: 'desc' }
    });

    // Single source of truth (plans/2026-07-20-configurable-scoring-weights.md,
    // Task 8 — owner requirement): load the user's scoring weights once per
    // call, not per item, and consume the SAME shared
    // lib/utils/scoring-weights.ts functions the research Overview tab uses
    // — no second definition of the composite formula or the fundamental
    // weights lives here.
    const weights = await getWeights(userId);
    const normalizedCompositeWeights = normalizeCompositeWeights(weights.composite);

    // Fetch current prices and scores for all items
    const itemsWithScores = await Promise.all(
      items.map(async (item) => {
        try {
          // Get current price
          const quote = await yahooFinance.quote(item.ticker);
          const currentPrice = quote.regularMarketPrice || Number(item.currentPrice);

          // Update current price in DB
          await prisma.wishlistItem.update({
            where: { id: item.id },
            data: { currentPrice }
          });

          // Calculate price changes
          const priceChange = currentPrice - Number(item.addedPrice);
          const priceChangePercent = (priceChange / Number(item.addedPrice)) * 100;

          // Five independent per-item score fetches — previously sequential
          // `await`s with no data dependency between them, serializing the
          // slowest cost (Gemini sentiment + intrinsic value) on top of the
          // rest for every item. Parallelized with Promise.all (plan Task
          // 5); each still resolves to `null` on its own failure exactly as
          // before, so a single dimension failing does not affect the
          // others or change the composite-score fallback behavior below.
          const [
            fundamentalResult,
            analystResult,
            technicalResult,
            sentimentResult,
            intrinsicResult,
          ] = await Promise.allSettled([
            fundamentalAnalysisService.fetchFundamentals(item.ticker, weights.fundamental),
            prisma.analystRating.findUnique({ where: { symbol: item.ticker } }),
            marketDataService.getHistoricalData(item.ticker, '1Y'),
            // AUD-05: previously called this app's own /api/news/[symbol] route via
            // `fetch()` with no session cookie forwarded — since that route requires
            // auth (ONB-05, 2026-07-16), the call always 401'd and this score was
            // silently always null. Call the service directly instead.
            newsService.getAnalyzedNewsForSymbol(item.ticker, { analyze: true, limit: 20 }),
            // AUD-05: same self-fetch issue as sentiment above — call the service
            // directly instead of hitting our own now-authenticated route over HTTP.
            IntrinsicValueService.calculateIntrinsicValue(item.ticker, currentPrice),
          ]);

          // Get fundamental score
          let fundamentalScore: number | null = null;
          if (fundamentalResult.status === 'fulfilled') {
            fundamentalScore = fundamentalResult.value.score.total;
          } else {
            console.error(`Failed to fetch fundamentals for ${item.ticker}:`, fundamentalResult.reason);
          }

          // Get analyst score and target price upside
          let analystScore: number | null = null;
          let targetPriceUpside: number | null = null;
          if (analystResult.status === 'fulfilled') {
            const analystRating = analystResult.value;
            if (analystRating) {
              analystScore = Number(analystRating.score);

              if (analystRating.targetPrice) {
                const targetPrice = Number(analystRating.targetPrice);
                targetPriceUpside = ((targetPrice - currentPrice) / currentPrice) * 100;
              }
            }
          } else {
            console.error(`Failed to fetch analyst rating for ${item.ticker}:`, analystResult.reason);
          }

          // Get technical score
          let technicalScore: number | null = null;
          if (technicalResult.status === 'fulfilled') {
            const historicalData = technicalResult.value;
            if (historicalData && historicalData.length > 0) {
              const prices = historicalData.map(d => d.value);
              const volumes = historicalData.map(d => d.volume);
              const indicators = technicalAnalysisService.calculateIndicators(prices, volumes);
              // Use the actual calculated score instead of mapping signal
              technicalScore = typeof indicators.score === 'number' ? indicators.score : null;
            }
          } else {
            console.error(`Failed to fetch technical data for ${item.ticker}:`, technicalResult.reason);
          }

          // Get sentiment score
          let sentimentScore: number | null = null;
          if (sentimentResult.status === 'fulfilled') {
            sentimentScore = this.calculateSentimentScore(sentimentResult.value);
          } else {
            console.error(`Failed to fetch sentiment data for ${item.ticker}:`, sentimentResult.reason);
          }

          // Get intrinsic value score
          let intrinsicScore: number | null = null;
          if (intrinsicResult.status === 'fulfilled') {
            intrinsicScore = this.upsideToScore(intrinsicResult.value.upsidePercent);
          } else {
            console.error(`Failed to fetch intrinsic value for ${item.ticker}:`, intrinsicResult.reason);
          }

          // Calculate composite score — shared formula (lib/utils/scoring-weights.ts),
          // the same one components/overview.tsx uses, so the wishlist and the
          // research Overview tab produce the identical composite for the
          // same stock + same user (Task 8's one-definition invariant).
          // weightedCompositeTotal already substitutes a neutral 5 for a
          // missing (null) dimension (AUD-05's `?? 5` semantic, preserved).
          let compositeScore: number | null = null;
          const scores = [fundamentalScore, analystScore, technicalScore, sentimentScore, intrinsicScore];
          const validScores = scores.filter((s): s is number => s !== null);

          if (validScores.length > 0) {
            compositeScore = weightedCompositeTotal(
              {
                intrinsicValue: intrinsicScore,
                fundamental: fundamentalScore,
                technical: technicalScore,
                sentiment: sentimentScore,
                analyst: analystScore,
              },
              normalizedCompositeWeights
            );
          }

          return {
            id: item.id,
            ticker: item.ticker,
            name: item.name,
            currency: item.currency,
            addedPrice: Number(item.addedPrice),
            currentPrice,
            targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
            notes: item.notes,
            createdAt: item.createdAt,
            priceChange,
            priceChangePercent,
            fundamentalScore,
            analystScore,
            technicalScore,
            sentimentScore,
            intrinsicScore,
            compositeScore,
            targetPriceUpside
          };
        } catch (error) {
          console.error(`Failed to process wishlist item ${item.ticker}:`, error);
          // Return item with basic data if fetching fails
          return {
            id: item.id,
            ticker: item.ticker,
            name: item.name,
            currency: item.currency,
            addedPrice: Number(item.addedPrice),
            currentPrice: Number(item.currentPrice),
            targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
            notes: item.notes,
            createdAt: item.createdAt,
            priceChange: Number(item.currentPrice) - Number(item.addedPrice),
            priceChangePercent: ((Number(item.currentPrice) - Number(item.addedPrice)) / Number(item.addedPrice)) * 100,
            fundamentalScore: null,
            analystScore: null,
            technicalScore: null,
            sentimentScore: null,
            intrinsicScore: null,
            compositeScore: null,
            targetPriceUpside: null
          };
        }
      })
    );

    return itemsWithScores;
  }

  private upsideToScore(upsidePercent: number | null | undefined): number {
    if (upsidePercent === null || upsidePercent === undefined) return 5;
    const min = -25;
    const max = 30;
    const clamped = Math.max(min, Math.min(max, upsidePercent));
    const normalized = (clamped - min) / (max - min);
    return Math.round(normalized * 10 * 10) / 10;
  }

  private calculateSentimentScore(articles: Array<{ sentiment?: number | null; impact?: string | null; relevanceScore?: number | null }>): number {
    if (!Array.isArray(articles) || articles.length === 0) return 5;

    // Shared News & sentiment score derivation (plans/2026-07-24-news-sentiment-accuracy.md,
    // Task 11; review NSA-I1/NSA-I2) — identical function call at all three
    // call sites (news-feed.tsx, overview.tsx, this method) so the wishlist
    // sentiment score cannot silently diverge from the other two. See
    // `computeSentimentScore`'s docstring for the null-sentiment exclusion
    // rule.
    return computeSentimentScore(articles).score;
  }

  async syncWishlistPrices(userId: string) {
    const wishlist = await this.getOrCreateWishlist(userId);
    const items = await prisma.wishlistItem.findMany({
      where: { wishlistId: wishlist.id }
    });

    await Promise.all(
      items.map(async (item) => {
        try {
          const quote = await yahooFinance.quote(item.ticker);
          if (quote.regularMarketPrice) {
            await prisma.wishlistItem.update({
              where: { id: item.id },
              data: { currentPrice: quote.regularMarketPrice }
            });
          }
        } catch (error) {
          console.error(`Failed to sync price for ${item.ticker}:`, error);
        }
      })
    );
  }
}

export const wishlistService = new WishlistService();
