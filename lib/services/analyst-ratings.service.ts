import { safeQuoteSummary } from '@/lib/yahoo-finance';
import { prisma } from '@/lib/prisma';
import { AnalystRating, Prisma } from '@prisma/client';

export interface AnalystRevision {
  firm: string;
  action: string;
  fromGrade: string | null;
  toGrade: string | null;
  date: string;
}

/**
 * Pure window/sort/cap helper for analyst revisions (Task 1,
 * plans/2026-07-20-analyst-revisions-nvda-fix.md). Keeps entries whose `date`
 * falls within the last `windowDays` days, inclusive of the boundary instant
 * (a revision dated exactly `windowDays` ago is kept; one day further back is
 * excluded), excludes future-dated entries, sorts newest-first, and caps to
 * the `cap` most recent. `now` is an explicit parameter so this is
 * deterministically testable without mocking the system clock.
 */
export function filterRecentRevisions(
  revisions: AnalystRevision[],
  now: Date,
  windowDays = 90,
  cap = 25
): AnalystRevision[] {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  return revisions
    .filter((r) => {
      const t = new Date(r.date).getTime();
      return t >= windowStartMs && t <= nowMs;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, cap);
}

export interface AnalystRatings {
  targetPrice: number | null;
  targetLowPrice: number | null;
  targetHighPrice: number | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  totalAnalysts: number;
  averageRating: number | null;
  lastUpdated: string;
  score: number;
  scoreInterpretation: string;
  // Persisted as of plans/2026-07-20-analyst-revisions-nvda-fix.md Task 2
  // (`AnalystRating.revisions` Json? column) — populated on both a fresh
  // Yahoo fetch and a 24h cache hit (formatCachedData reads the stored
  // value). Rows written before the migration applies have a null column
  // and coalesce to [] (see formatCachedData).
  revisions: AnalystRevision[];
}

export class AnalystRatingsService {
  async fetchAnalystRatings(symbol: string): Promise<AnalystRatings> {
    try {
      // Check cache first
      const cached = await prisma.analystRating.findUnique({
        where: { symbol },
        select: {
          id: true,
          symbol: true,
          targetPrice: true,
          targetLowPrice: true,
          targetHighPrice: true,
          strongBuy: true,
          buy: true,
          hold: true,
          sell: true,
          strongSell: true,
          totalAnalysts: true,
          averageRating: true,
          score: true,
          scoreInterpretation: true,
          revisions: true,
          lastUpdated: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // If data is less than 24 hours old, use cached
      if (cached && cached.lastUpdated > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
        return this.formatCachedData(cached);
      }

      // Fetch fresh data from Yahoo Finance.
      // Note: no hard module guard here (unlike fundamentals/market-data) —
      // a missing `recommendationTrend` legitimately means "no analyst
      // coverage" and extractRatings already returns totalAnalysts: 0,
      // which calculateScore treats as a valid neutral 5. Only the wrapper's
      // own null-result re-throw applies.
      const quoteSummary = await safeQuoteSummary(symbol, {
        modules: [
          'financialData',
          'recommendationTrend',
          'upgradeDowngradeHistory',
          'earningsTrend'
        ]
      });

      // Extract and process ratings
      const ratings = this.extractRatings(quoteSummary);
      
      // Calculate score and interpretation
      const score = this.calculateScore(ratings);
      const scoreInterpretation = this.getScoreInterpretation(score);

      // Save to database
      await this.saveToDatabase(symbol, { ...ratings, score, scoreInterpretation });

      return { ...ratings, score, scoreInterpretation };
    } catch (error) {
      console.error(`Failed to fetch analyst ratings for ${symbol}:`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractRatings(data: Record<string, any>): Omit<AnalystRatings, 'score' | 'scoreInterpretation'> {
    const financialData = data.financialData || {};
    const recommendationTrend = data.recommendationTrend?.trend?.[0] || {};

    const strongBuy = recommendationTrend.strongBuy || 0;
    const buy = recommendationTrend.buy || 0;
    const hold = recommendationTrend.hold || 0;
    const sell = recommendationTrend.sell || 0;
    const strongSell = recommendationTrend.strongSell || 0;

    const totalAnalysts = strongBuy + buy + hold + sell + strongSell;

    // Calculate average rating (1=Strong Buy, 5=Strong Sell)
    const averageRating = totalAnalysts > 0
      ? (strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5) / totalAnalysts
      : null;

    const revisions = filterRecentRevisions(
      this.extractRevisions(data.upgradeDowngradeHistory),
      new Date()
    );

    return {
      targetPrice: financialData.targetMeanPrice || null,
      targetLowPrice: financialData.targetLowPrice ?? null,
      targetHighPrice: financialData.targetHighPrice ?? null,
      strongBuy,
      buy,
      hold,
      sell,
      strongSell,
      totalAnalysts,
      averageRating,
      lastUpdated: new Date().toISOString(),
      revisions,
    };
  }

  /**
   * Extracts ALL matching revisions from Yahoo's `upgradeDowngradeHistory`
   * module (already fetched, previously unread — TD-DTL-REV), unfiltered by
   * date. Callers (`extractRatings`) apply `filterRecentRevisions` to window
   * this down to the last 90 days — a symbol with long history (e.g. NVDA's
   * 982 entries) would otherwise return every entry ever recorded, mislabelled
   * under the "last 90 days" UI copy (plans/2026-07-20-analyst-revisions-nvda-fix.md
   * Task 1).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractRevisions(upgradeDowngradeHistory: Record<string, any> | undefined): AnalystRevision[] {
    const history = upgradeDowngradeHistory?.history;
    if (!Array.isArray(history)) return [];

    return history
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((entry: Record<string, any>) => entry && entry.firm && entry.action && entry.epochGradeDate)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((entry: Record<string, any>) => ({
        firm: String(entry.firm),
        action: String(entry.action),
        fromGrade: entry.fromGrade ? String(entry.fromGrade) : null,
        toGrade: entry.toGrade ? String(entry.toGrade) : null,
        date: new Date(entry.epochGradeDate).toISOString(),
      }));
  }

  private calculateScore(ratings: Omit<AnalystRatings, 'score' | 'scoreInterpretation'>): number {
    if (ratings.totalAnalysts === 0) return 5; // Neutral score if no ratings

    // SCM-11: sell-side analysts almost never publish Sell ratings (they
    // need management access; their banks may want the company's
    // business), so the real-world distribution across large-cap coverage
    // is roughly 55-60% Buy / 35-40% Hold / ~5% Sell. The old mapping
    // (SB=10, B=8, H=5, S=2, SS=0) landed nearly every liquid stock at
    // 6.5-8.5 — a near-constant bullish offset occupying 15% of the
    // composite with almost no cross-stock discrimination. Recentered
    // (review's option 3, lowest-effort / no new data dependency) so a
    // typical buy-skewed consensus (~55% Buy / 40% Hold / 5% Sell) lands
    // approximately 5-6 instead.
    const weightedScore = (
      (ratings.strongBuy * 9) +
      (ratings.buy * 7) +
      (ratings.hold * 4) +
      (ratings.sell * 1.5) +
      (ratings.strongSell * 0)
    ) / ratings.totalAnalysts;

    // Normalize to 0-10 scale (was 1-10 — the old floor of 1 no longer
    // makes sense against a Strong Sell weight of 0; the min/max clamp is
    // defensive only, since the weighted average of 0-9 inputs never
    // exceeds that range).
    return Math.min(10, Math.max(0, weightedScore));
  }

  private getScoreInterpretation(score: number): string {
    // SCM-11: thresholds shifted down to track the recentered calculateScore
    // mapping above (SB=9/B=7/H=4/S=1.5/SS=0) so the interpretation labels
    // stay sensible at the new boundaries rather than everything reading
    // "Buy"/"Strong Buy" under the old 1-10-scale thresholds.
    if (score >= 6) return 'Strong Buy - Analysts are very bullish on this stock';
    if (score >= 4.5) return 'Buy - Analysts are generally positive about this stock';
    if (score >= 3) return 'Hold - Analysts are neutral on this stock';
    if (score >= 1.5) return 'Sell - Analysts are generally negative about this stock';
    return 'Strong Sell - Analysts are very bearish on this stock';
  }

  private async saveToDatabase(symbol: string, data: AnalystRatings) {
    const { lastUpdated, ...ratingsData } = data;
    
    await prisma.analystRating.upsert({
      where: { symbol },
      update: {
        targetPrice: data.targetPrice !== null ? new Prisma.Decimal(data.targetPrice) : null,
        targetLowPrice: data.targetLowPrice !== null ? new Prisma.Decimal(data.targetLowPrice) : null,
        targetHighPrice: data.targetHighPrice !== null ? new Prisma.Decimal(data.targetHighPrice) : null,
        strongBuy: data.strongBuy,
        buy: data.buy,
        hold: data.hold,
        sell: data.sell,
        strongSell: data.strongSell,
        totalAnalysts: data.totalAnalysts,
        averageRating: data.averageRating !== null ? new Prisma.Decimal(data.averageRating) : null,
        score: data.score,
        scoreInterpretation: data.scoreInterpretation,
        revisions: data.revisions as unknown as Prisma.InputJsonValue,
        lastUpdated: new Date()
      },
      create: {
        symbol,
        targetPrice: data.targetPrice !== null ? new Prisma.Decimal(data.targetPrice) : null,
        targetLowPrice: data.targetLowPrice !== null ? new Prisma.Decimal(data.targetLowPrice) : null,
        targetHighPrice: data.targetHighPrice !== null ? new Prisma.Decimal(data.targetHighPrice) : null,
        strongBuy: data.strongBuy,
        buy: data.buy,
        hold: data.hold,
        sell: data.sell,
        strongSell: data.strongSell,
        totalAnalysts: data.totalAnalysts,
        averageRating: data.averageRating !== null ? new Prisma.Decimal(data.averageRating) : null,
        score: data.score,
        scoreInterpretation: data.scoreInterpretation,
        revisions: data.revisions as unknown as Prisma.InputJsonValue,
        lastUpdated: new Date()
      }
    });
  }

  private formatCachedData(cached: AnalystRating): AnalystRatings {
    return {
      targetPrice: cached.targetPrice ? Number(cached.targetPrice) : null,
      // Persisted as of Task 2 (plans/2026-07-20-analyst-revisions-nvda-fix.md)
      // — read back from the AnalystRating row. Rows written before the
      // migration applied have a null column here; coalesce to null/[] for
      // back-compat rather than throwing.
      targetLowPrice: cached.targetLowPrice ? Number(cached.targetLowPrice) : null,
      targetHighPrice: cached.targetHighPrice ? Number(cached.targetHighPrice) : null,
      revisions: Array.isArray(cached.revisions) ? (cached.revisions as unknown as AnalystRevision[]) : [],
      strongBuy: cached.strongBuy,
      buy: cached.buy,
      hold: cached.hold,
      sell: cached.sell,
      strongSell: cached.strongSell,
      totalAnalysts: cached.totalAnalysts,
      averageRating: cached.averageRating ? Number(cached.averageRating) : null,
      score: cached.score || 5,
      scoreInterpretation: cached.scoreInterpretation || 'No analyst data available',
      lastUpdated: cached.lastUpdated?.toISOString() || new Date().toISOString()
    };
  }
}

export const analystRatingsService = new AnalystRatingsService();
