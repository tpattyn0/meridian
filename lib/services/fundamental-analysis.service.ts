import { safeQuoteSummary } from '@/lib/yahoo-finance';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { DEFAULT_SCORING_WEIGHTS, normalizeFundamentalWeights, weightedFundamentalTotal, type FundamentalWeights } from '@/lib/utils/scoring-weights';

interface AnalystRatings {
  targetPrice: number | null;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  totalAnalysts: number;
  averageRating: number | null;
  lastUpdated: string;
}

interface FundamentalMetrics {
  valuation: {
    peRatio: number | null;
    forwardPE: number | null;
    pegRatio: number | null;
    psRatio: number | null;
    pbRatio: number | null;
    pfcfRatio: number | null;
    evToEbitda: number | null;
    enterpriseValue: number | null;
    marketCap: number | null;
    eps: number | null;
    forwardEps: number | null;
    bookValue: number | null;
  };
  profitability: {
    profitMargin: number | null;
    operatingMargin: number | null;
    roe: number | null;
    roa: number | null;
    roic: number | null;
  };
  growth: {
    revenueGrowth: number | null;
    earningsGrowth: number | null;
    fcfGrowth: number | null;
  };
  financial: {
    currentRatio: number | null;
    quickRatio: number | null;
    debtToEquity: number | null;
    interestCoverage: number | null;
  };
  dividend: {
    yield: number | null;
    payoutRatio: number | null;
    // SCM-09: this was previously named `growthRate` but populated with
    // summaryDetail.fiveYearAvgDividendYield — a yield, not a growth rate.
    // Renamed to the honest label; no real dividend-growth computation is
    // implemented (would need trailing dividend-per-share CAGR, a separate
    // data need — see reviews/2026-07-17-scoring-methodology.md SCM-09).
    fiveYearAvgYield: number | null;
  };
  score: {
    total: number;
    breakdown: {
      valuation: number;
      profitability: number;
      growth: number;
      financial: number;
      dividend: number;
    };
    interpretation: string;
  };
}

/**
 * TD-11 (plans/2026-07-23-lib-cleanup-batch.md): explicit cache-freshness
 * version, replacing the hardcoded `latestMigrationDate` date literal. Bump
 * this integer whenever extraction or scoring logic changes in a way that
 * makes previously-cached rows wrong — every cached row whose
 * `scoreDetails.scoringVersion` is absent or lower than this value is treated
 * as stale and refetched, regardless of `lastUpdated`. Persisted inside the
 * existing `scoreDetails` JSON column (no schema migration — see ADR-27).
 *
 * Starting at 2 (not 1): this same plan also dropped the never-consumed
 * `earningsHistory` module from the fetch (TD-34b), changing what gets
 * fetched. Bumping the version here is the mechanism that invalidates every
 * row cached from the old modules payload — a deliberate one-time refetch
 * per symbol, not a bug.
 *
 * Bumped to 3 (plans/2026-07-26-scoring-methodology-phase1-correctness.md,
 * SCM-01/02/07/08/10/12): extraction/scoring changed in ways that make a row
 * cached under version 2 score differently if recomputed — 0-vs-null
 * extraction (SCM-01), negative D/E exclusion (SCM-02), P/FCF capex fallback
 * (SCM-07), EV/EBITDA sign disambiguation (SCM-08), dividend pillar
 * renormalization + joint yield/payout scoring (SCM-10), and the PEG
 * forward-growth fallback (SCM-12). A single bump covers all of them — one
 * deliberate one-time refetch per symbol, not per fix.
 */
export const SCORING_VERSION = 3;

export class FundamentalAnalysisService {
  /**
   * `fundamentalWeights` (plans/2026-07-20-configurable-scoring-weights.md,
   * ADR-21) is an optional pure parameter — this service NEVER reads
   * UserScoringPreferences itself (the route does, per ADR-3). When
   * provided, `metrics.score.total` is recomputed on read from the
   * weight-independent `score.breakdown` using the user's normalized
   * weights, for BOTH the fresh and the 24h-cache path. This reweight is
   * NEVER written back — `saveToDatabase` always persists the
   * default-weighted total, so the shared symbol-keyed FundamentalData
   * cache stays user-independent (ADR-4). Omitting the param reproduces
   * today's behavior byte-for-byte.
   */
  async fetchFundamentals(symbol: string, fundamentalWeights?: FundamentalWeights): Promise<FundamentalMetrics> {
    try {
      // Check cache first
      const cached = await prisma.fundamentalData.findUnique({
        where: { symbol }
      });

      // Cache freshness gate 1/2: SCORING_VERSION (TD-11). A cached row is
      // stale if its scoreDetails.scoringVersion is absent or lower than the
      // current SCORING_VERSION — independent of and ANDed with the 24h
      // recency gate below.
      const cachedScoreDetails =
        cached?.scoreDetails && typeof cached.scoreDetails === 'object' && !Array.isArray(cached.scoreDetails)
          ? (cached.scoreDetails as { scoringVersion?: number })
          : null;
      const isCacheFresh = !!cached && (cachedScoreDetails?.scoringVersion ?? 0) >= SCORING_VERSION;
      const isWithin24Hours = cached && cached.lastUpdated > new Date(Date.now() - 24 * 60 * 60 * 1000);


      // Only use cache if it's fresh AND within 24 hours
      if (cached && isCacheFresh && isWithin24Hours) {
        return this.applyPerUserReweight(this.formatCachedData(cached), fundamentalWeights);
      }


      // Fetch fresh data from Yahoo Finance
      const quoteSummary = await safeQuoteSummary(symbol, {
        modules: [
          'price',
          'summaryDetail',
          'defaultKeyStatistics',
          'financialData',
          'cashflowStatementHistory',
          'earningsTrend',
          'upgradeDowngradeHistory',
          'recommendationTrend'
        ]
      });

      // The minimum needed for any valuation metric is the `price` or
      // `summaryDetail` module. If neither is present (e.g. Yahoo schema
      // drift coerced everything away), do not persist/cache an all-null
      // row scored as a misleading neutral 5 — fail loud instead.
      if (!quoteSummary || (!quoteSummary.price && !quoteSummary.summaryDetail)) {
        throw new Error(`No usable fundamentals data available for ${symbol}`);
      }

      // Extract metrics and analyst ratings
      const metrics = this.extractMetrics(quoteSummary);

      // Calculate scores
      const score = this.calculateFundamentalScore(metrics);

      // Create the complete metrics object with score
      const completeMetrics: FundamentalMetrics = {
        ...metrics,
        score
      };

      // Save to database — always the DEFAULT-weighted total + the
      // weight-independent breakdown (before any per-user reweight below),
      // so the shared symbol-keyed cache stays user-independent (ADR-4).
      await this.saveToDatabase(symbol, completeMetrics);

      return this.applyPerUserReweight(completeMetrics, fundamentalWeights);
    } catch (error) {
      console.error(`Failed to fetch fundamentals for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Pure post-step: when `fundamentalWeights` is provided, recomputes
   * `score.total` from the weight-independent `score.breakdown` using the
   * user's normalized weights. Applied on read only, after the cache lookup/
   * write above — never persisted. Omitting `fundamentalWeights` returns
   * `metrics` unchanged (byte-identical to pre-feature behavior).
   */
  private applyPerUserReweight(metrics: FundamentalMetrics, fundamentalWeights?: FundamentalWeights): FundamentalMetrics {
    if (!fundamentalWeights) return metrics;
    const normalized = normalizeFundamentalWeights(fundamentalWeights);
    const total = weightedFundamentalTotal(metrics.score.breakdown, normalized);
    return {
      ...metrics,
      score: {
        ...metrics.score,
        total,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractMetrics(data: Record<string, any>): Omit<FundamentalMetrics, 'score'> {
    const price = data.price || {};
    const summaryDetail = data.summaryDetail || {};
    const defaultKeyStatistics = data.defaultKeyStatistics || {};
    const financialData = data.financialData || {};
    // SCM-P1-S2: Yahoo's earningsTrend.trend[] is ordered by period
    // ("0q","+1q","0y","+1y","+5y","-5y", not indexed by recency) — trend[0]
    // is the CURRENT-QUARTER estimate, not the long-term "+5y" figure the
    // PEG fallback below is meant to use. Select the "+5y" entry explicitly
    // by its `period` field; fall back to "+1y" (next-year) if +5y is
    // absent from the fetched payload, then to trend[0] as a last resort so
    // a missing/reshaped payload still degrades to the old behavior instead
    // of throwing.
    const earningsTrendEntry = this.selectLongTermEarningsTrend(data.earningsTrend?.trend);
    const earningsTrend = earningsTrendEntry?.earningsEstimate;


    // Calculate EPS (Earnings Per Share)
    const trailingEps = defaultKeyStatistics.trailingEps;
    const forwardEps = defaultKeyStatistics.forwardEps || null;
    const eps = trailingEps || forwardEps || null;

    // Calculate Book Value
    const bookValue = defaultKeyStatistics.bookValue || null;

    // Calculate Forward P/E
    const currentPrice = price.regularMarketPrice || summaryDetail.regularMarketPrice || null;
    const forwardPE = summaryDetail.forwardPE ||
      (currentPrice && forwardEps && forwardEps > 0 ? currentPrice / forwardEps : null);

    // Calculate P/FCF (Price to Free Cash Flow)
    // SCM-07: previously fell back from freeCashflow to operatingCashflow
    // (ignoring capex), overstating FCF most for capital-intensive firms.
    // Now: prefer Yahoo's own freeCashflow; if absent, compute true FCF =
    // operatingCashflow - capex from the already-fetched cash-flow-statement
    // module; if capex is unavailable, leave FCF (and therefore pfcfRatio)
    // null rather than silently substituting operating cash flow.
    const capex = data.cashflowStatementHistory?.cashflowStatements?.[0]?.capitalExpenditures;
    let freeCashFlow: number | null = typeof financialData.freeCashflow === 'number' ? financialData.freeCashflow : null;
    if (freeCashFlow === null && typeof financialData.operatingCashflow === 'number' && typeof capex === 'number') {
      // Yahoo reports capitalExpenditures as a negative number (cash outflow).
      freeCashFlow = financialData.operatingCashflow + capex;
    }
    const marketCap = price.marketCap || summaryDetail.marketCap || null;


    const pfcfRatio = (marketCap && freeCashFlow && freeCashFlow > 0)
      ? marketCap / freeCashFlow
      : null;


    // Calculate P/E Ratio
    const peRatio = summaryDetail.trailingPE || (price.regularMarketPrice && eps ? price.regularMarketPrice / eps : null);

    // Calculate PEG Ratio
    // PEG = P/E / (Growth Rate * 100)
    // SCM-12: prefer Yahoo's own PEG; then the analyst forward growth
    // estimate from earningsTrend's "+5y" (falling back to "+1y") entry —
    // see selectLongTermEarningsTrend — the multi-year expected growth PEG
    // is conventionally defined on, not a single noisy YoY print; only then
    // the single-year YoY fallback (low-confidence — no 3-year historical
    // EPS CAGR is available from the Yahoo modules this service fetches, so
    // that middle tier is not implementable without a new data source;
    // flagged here for a future pass rather than silently treated as done).
    let pegRatio = defaultKeyStatistics.pegRatio || null;

    if (!pegRatio && peRatio && peRatio > 0) {
      const forwardGrowth = earningsTrend?.growth;
      if (typeof forwardGrowth === 'number' && forwardGrowth > 0) {
        pegRatio = peRatio / (forwardGrowth * 100);
      } else if (financialData.earningsGrowth) {
        // Single-year YoY fallback (low-confidence — no multi-year estimate
        // or CAGR available for this symbol).
        const earningsGrowthPercent = financialData.earningsGrowth * 100;
        if (earningsGrowthPercent > 0) {
          pegRatio = peRatio / earningsGrowthPercent;
        }
      }
    }

    return {
      valuation: {
        peRatio,
        forwardPE,
        pegRatio,
        psRatio: summaryDetail.priceToSalesTrailing12Months || null,
        pbRatio: price.priceToBook || defaultKeyStatistics.priceToBook || null,
        pfcfRatio,
        evToEbitda: defaultKeyStatistics.enterpriseToEbitda || null,
        enterpriseValue: defaultKeyStatistics.enterpriseValue || null,
        marketCap,
        eps,
        forwardEps,
        bookValue,
      },
      profitability: {
        profitMargin: financialData.profitMargins ?? null,
        operatingMargin: financialData.operatingMargins ?? null,
        roe: financialData.returnOnEquity ?? null,
        roa: financialData.returnOnAssets ?? null,
        roic: null,
      },
      growth: {
        revenueGrowth: financialData.revenueGrowth ?? null,
        earningsGrowth: financialData.earningsGrowth ?? null,
        fcfGrowth: null,
      },
      financial: {
        currentRatio: financialData.currentRatio ?? null,
        quickRatio: financialData.quickRatio ?? null,
        debtToEquity: typeof financialData.debtToEquity === 'number' ? financialData.debtToEquity / 100 : null,
        interestCoverage: null,
      },
      dividend: {
        yield: summaryDetail.dividendYield || summaryDetail.trailingAnnualDividendYield || null,
        payoutRatio: summaryDetail.payoutRatio || null,
        fiveYearAvgYield: summaryDetail.fiveYearAvgDividendYield || null,
      },
    };
  }

  /**
   * SCM-P1-S2: Yahoo's `earningsTrend.trend[]` array is ordered by
   * `period` — typically `["0q","+1q","0y","+1y","+5y","-5y"]` — not by
   * "most relevant first". `trend[0]` is therefore the current-quarter
   * estimate, not the long-term growth figure PEG is conventionally
   * defined on. This selects the `+5y` entry by its `period` field
   * (long-term expected growth); if the fetched payload doesn't include a
   * `+5y` entry, falls back to `+1y` (next-year, still a multi-period
   * analyst estimate rather than a single quarter); if neither is present,
   * falls back to `trend[0]` so a reshaped/partial payload still degrades
   * gracefully instead of losing the PEG fallback entirely.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private selectLongTermEarningsTrend(trend: Array<Record<string, any>> | undefined): Record<string, any> | undefined {
    if (!Array.isArray(trend) || trend.length === 0) return undefined;
    return (
      trend.find((t) => t?.period === '+5y') ||
      trend.find((t) => t?.period === '+1y') ||
      trend[0]
    );
  }

  private calculateFundamentalScore(metrics: Omit<FundamentalMetrics, 'score'>): { total: number; breakdown: { valuation: number; profitability: number; growth: number; financial: number; dividend: number; }; interpretation: string; } {
    const breakdown = {
      valuation: 0,
      profitability: 0,
      growth: 0,
      financial: 0,
      dividend: 0
    };

    // Valuation Score (weighted average of available metrics)
    // Forward-looking metrics (Forward P/E, PEG, P/FCF) are weighted higher as they are more reliable
    const valuationScores: { score: number; weight: number }[] = [];

    // Prefer forward P/E over trailing P/E
    if (metrics.valuation.forwardPE !== null && metrics.valuation.forwardPE > 0) {
      valuationScores.push({ score: this.scoreForwardPE(metrics.valuation.forwardPE), weight: 1.5 });
    } else if (metrics.valuation.peRatio !== null) {
      valuationScores.push({ score: this.scorePE(metrics.valuation.peRatio), weight: 1 });
    }
    if (metrics.valuation.pbRatio !== null) {
      valuationScores.push({ score: this.scorePB(metrics.valuation.pbRatio), weight: 1 });
    }
    if (metrics.valuation.pegRatio !== null && metrics.valuation.pegRatio > 0) {
      valuationScores.push({ score: this.scorePEG(metrics.valuation.pegRatio), weight: 1.5 });
    }
    if (metrics.valuation.psRatio !== null && metrics.valuation.psRatio > 0) {
      valuationScores.push({ score: this.scorePS(metrics.valuation.psRatio), weight: 1 });
    }
    if (metrics.valuation.pfcfRatio !== null && metrics.valuation.pfcfRatio > 0) {
      valuationScores.push({ score: this.scorePFCF(metrics.valuation.pfcfRatio), weight: 1.5 });
    }
    if (metrics.valuation.evToEbitda !== null) {
      // SCM-08: a negative ratio is ambiguous — negative EBITDA
      // (unprofitable, bearish) and negative EV (cash exceeds market cap, a
      // deep-value signal) previously both scored 3. Disambiguate by the
      // sign of enterpriseValue (already extracted/persisted — avoids
      // needing a new schema field for EBITDA itself): a negative ratio with
      // a positive EV implies negative EBITDA; a negative EV implies the
      // opposite regardless of EBITDA's own sign.
      valuationScores.push({
        score: this.scoreEVToEbitda(metrics.valuation.evToEbitda, metrics.valuation.enterpriseValue),
        weight: 1,
      });
    }

    breakdown.valuation = valuationScores.length > 0
      ? valuationScores.reduce((acc, item) => acc + item.score * item.weight, 0) /
      valuationScores.reduce((acc, item) => acc + item.weight, 0)
      : 5;

    // Profitability Score (average of available metrics)
    const profitabilityScores = [];
    if (metrics.profitability.roe !== null) {
      profitabilityScores.push(this.scoreROE(metrics.profitability.roe));
    }
    if (metrics.profitability.profitMargin !== null) {
      profitabilityScores.push(this.scoreMargin(metrics.profitability.profitMargin));
    }
    if (metrics.profitability.roa !== null) {
      profitabilityScores.push(this.scoreROA(metrics.profitability.roa));
    }
    breakdown.profitability = profitabilityScores.length > 0
      ? profitabilityScores.reduce((a, b) => a + b, 0) / profitabilityScores.length
      : 5;

    // Growth Score (average of available metrics)
    const growthScores = [];
    if (metrics.growth.revenueGrowth !== null) {
      growthScores.push(this.scoreGrowth(metrics.growth.revenueGrowth));
    }
    if (metrics.growth.earningsGrowth !== null) {
      growthScores.push(this.scoreGrowth(metrics.growth.earningsGrowth));
    }
    breakdown.growth = growthScores.length > 0
      ? growthScores.reduce((a, b) => a + b, 0) / growthScores.length
      : 5;

    // Financial Health Score (average of available metrics)
    const financialScores = [];
    if (metrics.financial.currentRatio !== null) {
      financialScores.push(this.scoreCurrentRatio(metrics.financial.currentRatio));
    }
    if (metrics.financial.debtToEquity !== null) {
      // SCM-02: negative D/E (accumulated-loss distress, not benign
      // buybacks) is excluded from scoring rather than mapped into the
      // best-in-class bracket by scoreDebtToEquity's `< 0.3` check.
      if (metrics.financial.debtToEquity < 0) {
        console.warn('Negative shareholder equity — debt-to-equity not meaningful, excluded from financial score');
      } else {
        financialScores.push(this.scoreDebtToEquity(metrics.financial.debtToEquity));
      }
    }
    if (metrics.financial.quickRatio !== null) {
      financialScores.push(this.scoreQuickRatio(metrics.financial.quickRatio));
    }
    breakdown.financial = financialScores.length > 0
      ? financialScores.reduce((a, b) => a + b, 0) / financialScores.length
      : 5;

    // Dividend Score
    // SCM-10: (a) a non-payer previously scored dividend = 0 at a fixed 5%
    // composite weight — a systematic penalty for buyback-oriented capital
    // return, which is not a company defect. Now: a non-payer (no yield)
    // drops the dividend pillar entirely and the total is renormalized over
    // the remaining four pillars (weightedFundamentalTotal already divides
    // by weightSum, so zeroing this weight below renormalizes automatically).
    // (b) yield is no longer rewarded monotonically — scored jointly with
    // payout ratio so a high yield + a high (>80%) payout ratio (a classic
    // yield-trap pattern: price collapsed, cut imminent) scores lower than
    // the same yield paired with a sustainable payout.
    const isPayer = metrics.dividend.yield !== null && metrics.dividend.yield > 0;
    let dividendApplicable = false;
    if (isPayer) {
      dividendApplicable = true;
      const yieldScore = this.scoreDividendYield(
        metrics.dividend.yield as number,
        metrics.dividend.payoutRatio
      );
      if (metrics.dividend.payoutRatio !== null && metrics.dividend.payoutRatio > 0) {
        const payoutScore = this.scorePayoutRatio(metrics.dividend.payoutRatio);
        breakdown.dividend = (yieldScore + payoutScore) / 2;
      } else {
        breakdown.dividend = yieldScore;
      }
    }

    // Calculate total score (weighted average) — uses the same
    // DEFAULT_SCORING_WEIGHTS.fundamental + weightedFundamentalTotal the
    // rest of the app shares (lib/utils/scoring-weights.ts), so this
    // default-weighted total is the single source of truth, not a second
    // definition (plans/2026-07-20-configurable-scoring-weights.md, Task 8).
    // A non-payer zeroes the dividend weight for THIS total only (local
    // renormalization over the other four pillars) — DEFAULT_SCORING_WEIGHTS
    // itself is untouched, so a payer scores byte-identically to before.
    const effectiveWeights = dividendApplicable
      ? DEFAULT_SCORING_WEIGHTS.fundamental
      : { ...DEFAULT_SCORING_WEIGHTS.fundamental, dividend: 0 };
    const totalScore = weightedFundamentalTotal(breakdown, effectiveWeights);

    // Generate interpretation
    const interpretation = this.generateInterpretation(totalScore, breakdown, metrics);

    return {
      total: Math.round(totalScore * 10) / 10,
      breakdown: {
        valuation: Math.round(breakdown.valuation * 10) / 10,
        profitability: Math.round(breakdown.profitability * 10) / 10,
        growth: Math.round(breakdown.growth * 10) / 10,
        financial: Math.round(breakdown.financial * 10) / 10,
        dividend: Math.round(breakdown.dividend * 10) / 10,
      },
      interpretation,
    };
  }

  // Scoring methods
  private scorePE(pe: number): number {
    if (pe < 0) return 3;
    if (pe < 15) return 9;
    if (pe < 20) return 8;
    if (pe < 25) return 7;
    if (pe < 30) return 6;
    if (pe < 40) return 5;
    if (pe < 50) return 4;
    return 3;
  }

  private scoreForwardPE(forwardPE: number): number {
    // Forward P/E scoring - slightly more optimistic thresholds as it reflects future expectations
    if (forwardPE < 0) return 3;
    if (forwardPE < 12) return 9;
    if (forwardPE < 18) return 8;
    if (forwardPE < 22) return 7;
    if (forwardPE < 28) return 6;
    if (forwardPE < 35) return 5;
    if (forwardPE < 45) return 4;
    return 3;
  }

  private scorePB(pb: number): number {
    if (pb < 1) return 9;
    if (pb < 2) return 8;
    if (pb < 3) return 7;
    if (pb < 5) return 6;
    if (pb < 8) return 5;
    return 4;
  }

  private scorePEG(peg: number): number {
    if (peg < 0) return 3;
    if (peg < 1) return 9;
    if (peg < 1.5) return 7;
    if (peg < 2) return 5;
    return 3;
  }

  private scorePS(ps: number): number {
    if (ps < 1) return 9;
    if (ps < 2) return 8;
    if (ps < 3) return 7;
    if (ps < 5) return 6;
    if (ps < 7) return 5;
    if (ps < 10) return 4;
    return 3;
  }

  private scorePFCF(pfcf: number): number {
    if (pfcf < 15) return 9;
    if (pfcf < 20) return 8;
    if (pfcf < 25) return 7;
    if (pfcf < 30) return 6;
    if (pfcf < 40) return 5;
    if (pfcf < 50) return 4;
    return 3;
  }

  // SCM-08: `enterpriseValue` disambiguates which side of the ratio went
  // negative. ratio < 0 with a positive (or unknown) EV means EBITDA is
  // negative — genuinely unprofitable, still bearish (3). ratio < 0 with a
  // negative EV means cash exceeds market cap — a deep-value signal — score
  // high with a warning instead of bearish.
  private scoreEVToEbitda(ratio: number, enterpriseValue: number | null = null): number {
    if (ratio < 0) {
      if (enterpriseValue !== null && enterpriseValue < 0) {
        console.warn('Negative enterprise value (cash exceeds market cap) — scoring EV/EBITDA as a deep-value signal, not bearish');
        return 8;
      }
      return 3;
    }
    if (ratio < 8) return 9;
    if (ratio < 12) return 7;
    if (ratio < 15) return 5;
    return 3;
  }

  private scoreROE(roe: number): number {
    if (roe > 0.25) return 9;
    if (roe > 0.20) return 8;
    if (roe > 0.15) return 7;
    if (roe > 0.10) return 6;
    if (roe > 0.05) return 5;
    if (roe > 0) return 4;
    return 3;
  }

  private scoreROA(roa: number): number {
    if (roa > 0.15) return 9;
    if (roa > 0.10) return 8;
    if (roa > 0.07) return 7;
    if (roa > 0.05) return 6;
    if (roa > 0.02) return 5;
    if (roa > 0) return 4;
    return 3;
  }

  private scoreMargin(margin: number): number {
    if (margin > 0.30) return 9;
    if (margin > 0.20) return 8;
    if (margin > 0.15) return 7;
    if (margin > 0.10) return 6;
    if (margin > 0.05) return 5;
    if (margin > 0) return 4;
    return 3;
  }

  private scoreGrowth(growth: number): number {
    if (growth > 0.30) return 9;
    if (growth > 0.20) return 8;
    if (growth > 0.15) return 7;
    if (growth > 0.10) return 6;
    if (growth > 0.05) return 5;
    if (growth > 0) return 4;
    return 3;
  }

  private scoreCurrentRatio(ratio: number): number {
    if (ratio > 2) return 9;
    if (ratio > 1.5) return 8;
    if (ratio > 1.2) return 7;
    if (ratio > 1) return 6;
    if (ratio > 0.8) return 4;
    return 3;
  }

  private scoreQuickRatio(ratio: number): number {
    if (ratio > 1.5) return 9;
    if (ratio > 1.2) return 8;
    if (ratio > 1) return 7;
    if (ratio > 0.8) return 5;
    return 3;
  }

  private scoreDebtToEquity(ratio: number): number {
    if (ratio < 0.3) return 9;
    if (ratio < 0.5) return 8;
    if (ratio < 0.8) return 7;
    if (ratio < 1) return 6;
    if (ratio < 1.5) return 5;
    if (ratio < 2) return 4;
    return 3;
  }

  // SCM-10(b): yield is no longer rewarded purely monotonically. An
  // abnormally high yield paired with a high payout ratio (>0.8) is more
  // often a distress/yield-trap signal (price collapsed, cut imminent) than
  // a gift, so the bracket score is penalized in that combination. A high
  // yield with a low/moderate (or unknown) payout ratio keeps the original
  // monotonic bracket unchanged.
  private scoreDividendYield(dividendYield: number, payoutRatio: number | null = null): number {
    let score: number;
    if (dividendYield > 0.05) score = 9;
    else if (dividendYield > 0.04) score = 8;
    else if (dividendYield > 0.03) score = 7;
    else if (dividendYield > 0.02) score = 6;
    else if (dividendYield > 0.01) score = 5;
    else score = 3;

    const isHighYield = dividendYield > 0.05;
    const isHighPayout = payoutRatio !== null && payoutRatio > 0.8;
    if (isHighYield && isHighPayout) {
      // Yield-trap pattern: cap well below the top bracket instead of the
      // monotonic 9.
      return 4;
    }
    return score;
  }

  private scorePayoutRatio(ratio: number): number {
    if (ratio < 0 || ratio > 1) return 3;
    if (ratio < 0.4) return 9;
    if (ratio < 0.5) return 8;
    if (ratio < 0.6) return 7;
    if (ratio < 0.7) return 6;
    if (ratio < 0.8) return 5;
    return 3;
  }

  private generateInterpretation(score: number, _breakdown: FundamentalMetrics['score']['breakdown'], _metrics: Omit<FundamentalMetrics, 'score'>): string {
    if (score >= 7) {
      return "Strong fundamentals across multiple metrics. The company shows solid profitability, reasonable valuation, and healthy financial position.";
    } else if (score >= 5) {
      return "Mixed fundamentals with some strong points. Consider analyzing specific areas of concern before making investment decisions.";
    } else {
      return "Weak fundamentals detected. The company may face challenges in profitability, growth, or financial health. Proceed with caution.";
    }
  }

  private async saveToDatabase(symbol: string, metrics: FundamentalMetrics) {
    // TD-11: scoringVersion travels inside the existing scoreDetails JSON
    // column (no schema migration — ADR-27). Additive key only; do not
    // restructure `total`/`breakdown`/`interpretation`.
    const scoreDetailsWithVersion = {
      ...metrics.score,
      scoringVersion: SCORING_VERSION,
    } as unknown as Prisma.InputJsonValue;

    await prisma.fundamentalData.upsert({
      where: { symbol },
      update: {
        peRatio: metrics.valuation.peRatio,
        forwardPE: metrics.valuation.forwardPE,
        pegRatio: metrics.valuation.pegRatio,
        psRatio: metrics.valuation.psRatio,
        pbRatio: metrics.valuation.pbRatio,
        pfcfRatio: metrics.valuation.pfcfRatio,
        evToEbitda: metrics.valuation.evToEbitda,
        enterpriseValue: metrics.valuation.enterpriseValue,
        marketCap: metrics.valuation.marketCap,
        eps: metrics.valuation.eps,
        forwardEps: metrics.valuation.forwardEps,
        bookValue: metrics.valuation.bookValue,
        profitMargin: metrics.profitability.profitMargin,
        operatingMargin: metrics.profitability.operatingMargin,
        roe: metrics.profitability.roe,
        roa: metrics.profitability.roa,
        roic: metrics.profitability.roic,
        revenueGrowth: metrics.growth.revenueGrowth,
        earningsGrowth: metrics.growth.earningsGrowth,
        fcfGrowth: metrics.growth.fcfGrowth,
        currentRatio: metrics.financial.currentRatio,
        quickRatio: metrics.financial.quickRatio,
        debtToEquity: metrics.financial.debtToEquity,
        dividendYield: metrics.dividend.yield,
        payoutRatio: metrics.dividend.payoutRatio,
        dividendGrowth: metrics.dividend.fiveYearAvgYield, // SCM-09: column name unchanged (no migration); the value it holds is honestly a yield, per the renamed metrics field above
        fundamentalScore: metrics.score.total,
        scoreDetails: scoreDetailsWithVersion,
        lastUpdated: new Date(),
      },
      create: {
        symbol,
        peRatio: metrics.valuation.peRatio,
        forwardPE: metrics.valuation.forwardPE,
        pegRatio: metrics.valuation.pegRatio,
        psRatio: metrics.valuation.psRatio,
        pbRatio: metrics.valuation.pbRatio,
        pfcfRatio: metrics.valuation.pfcfRatio,
        evToEbitda: metrics.valuation.evToEbitda,
        enterpriseValue: metrics.valuation.enterpriseValue,
        marketCap: metrics.valuation.marketCap,
        eps: metrics.valuation.eps,
        forwardEps: metrics.valuation.forwardEps,
        bookValue: metrics.valuation.bookValue,
        profitMargin: metrics.profitability.profitMargin,
        operatingMargin: metrics.profitability.operatingMargin,
        roe: metrics.profitability.roe,
        roa: metrics.profitability.roa,
        roic: metrics.profitability.roic,
        revenueGrowth: metrics.growth.revenueGrowth,
        earningsGrowth: metrics.growth.earningsGrowth,
        fcfGrowth: metrics.growth.fcfGrowth,
        currentRatio: metrics.financial.currentRatio,
        quickRatio: metrics.financial.quickRatio,
        debtToEquity: metrics.financial.debtToEquity,
        dividendYield: metrics.dividend.yield,
        payoutRatio: metrics.dividend.payoutRatio,
        dividendGrowth: metrics.dividend.fiveYearAvgYield, // SCM-09: column name unchanged (no migration); the value it holds is honestly a yield, per the renamed metrics field above
        fundamentalScore: metrics.score.total,
        scoreDetails: scoreDetailsWithVersion,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatCachedData(cached: Record<string, any>): FundamentalMetrics {
    // Ensure the cached data has the correct structure
    const metrics = typeof cached.data === 'string' ? JSON.parse(cached.data) : cached.data;
    const score = cached.scoreDetails || {
      total: 5,
      breakdown: {
        valuation: 5,
        profitability: 5,
        growth: 5,
        financial: 5,
        dividend: 0
      },
      interpretation: 'No analysis available'
    };

    return {
      valuation: {
        peRatio: cached.peRatio,
        forwardPE: cached.forwardPE || null,
        pegRatio: cached.pegRatio,
        psRatio: cached.psRatio,
        pbRatio: cached.pbRatio,
        pfcfRatio: cached.pfcfRatio || null,
        evToEbitda: cached.evToEbitda,
        enterpriseValue: cached.enterpriseValue,
        marketCap: cached.marketCap,
        eps: cached.eps || null,
        forwardEps: cached.forwardEps || null,
        bookValue: cached.bookValue || null,
      },
      profitability: {
        profitMargin: cached.profitMargin,
        operatingMargin: cached.operatingMargin,
        roe: cached.roe,
        roa: cached.roa,
        roic: cached.roic,
      },
      growth: {
        revenueGrowth: cached.revenueGrowth,
        earningsGrowth: cached.earningsGrowth,
        fcfGrowth: cached.fcfGrowth,
      },
      financial: {
        currentRatio: cached.currentRatio,
        quickRatio: cached.quickRatio,
        debtToEquity: cached.debtToEquity,
        interestCoverage: cached.interestCoverage,
      },
      dividend: {
        yield: cached.dividendYield,
        payoutRatio: cached.payoutRatio,
        fiveYearAvgYield: cached.dividendGrowth,
      },
      score,
    };
  }
}

export const fundamentalAnalysisService = new FundamentalAnalysisService();