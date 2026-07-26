import {
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
} from 'technicalindicators';

// Enhanced output structure per v2.0 specification
interface IndicatorBreakdown {
  available: boolean;
  signal: 'bullish' | 'bearish' | 'neutral';
  points: number;
  value?: number | string | null;
  details?: Record<string, string | number | null>;
}

interface TechnicalIndicators {
  // Raw indicator values
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: {
    value: number | null;
    signal: number | null;
    histogram: number | null;
  };
  bollingerBands?: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  };
  stochastic?: {
    k: number | null;
    d: number | null;
  };
  volumeTrend?: {
    currentVolume: number | null;
    avgVolume: number | null;
    changePercent: number | null;
  };

  // v2.0 Enhanced outputs
  signal: 'STRONG_BUY' | 'BUY' | 'WEAK_BUY' | 'HOLD' | 'WEAK_SELL' | 'SELL' | 'STRONG_SELL' | 'INSUFFICIENT_DATA';
  // SCM-03: `null` for the INSUFFICIENT_DATA case (getInsufficientDataResponse)
  // so no consumer can read it as a real bearish 0. Every other signal keeps
  // a real number. Consumers gate on `typeof score === 'number'` already.
  score: number | null;
  baseScore: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceStars: number;
  bullishPoints: number;
  bearishPoints: number;
  availableWeight: number;
  indicatorsUsed: number;
  agreement: number;
  breakdown: {
    trend: {
      sma20?: IndicatorBreakdown;
      sma50?: IndicatorBreakdown;
      sma200?: IndicatorBreakdown;
      goldenCross?: IndicatorBreakdown;
    };
    momentum: {
      rsi?: IndicatorBreakdown;
      macd?: IndicatorBreakdown;
      stochastic?: IndicatorBreakdown;
    };
    volatility: {
      bollinger?: IndicatorBreakdown;
    };
    volume: {
      volumeTrend?: IndicatorBreakdown;
    };
  };
  warnings: string[];
}

interface PriceData {
  close: number;
  high: number;
  low: number;
  volume?: number;
}

export class TechnicalAnalysisService {
  // Keyed in-process cache (ADR-4 pattern: independent hand-rolled Map, no
  // shared infra) so repeated requests for the same symbol within the TTL
  // don't re-run the full SMA/EMA/RSI/MACD/… recompute over 205+ points
  // (plan Task 3). Keyed by symbol + a cheap fingerprint of the input
  // series (length + last close) so a genuinely different dataset for the
  // same symbol (different period/lookback) is never served stale.
  private indicatorsCache = new Map<string, { data: TechnicalIndicators; timestamp: number }>();
  private readonly INDICATORS_CACHE_TTL = 60_000; // matches market-data.service's history cache TTL

  /**
   * Cached wrapper around calculateIndicators — same output, memoized per
   * symbol for INDICATORS_CACHE_TTL ms. Callers that don't have a stable
   * symbol to key on (or want the guaranteed-fresh computation) should call
   * calculateIndicators directly; this never changes what is computed, only
   * how often (plan Task 3 — no scoring-math change).
   */
  getCachedIndicators(
    symbol: string,
    prices: number[] | PriceData[],
    volumes?: number[]
  ): TechnicalIndicators {
    const closePrices = Array.isArray(prices) && typeof prices[0] === 'object'
      ? (prices as PriceData[]).map(p => p.close)
      : (prices as number[]);
    const fingerprint = `${closePrices.length}:${closePrices[closePrices.length - 1]}`;
    const cacheKey = `${symbol}:${fingerprint}`;

    const cached = this.indicatorsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.INDICATORS_CACHE_TTL) {
      return cached.data;
    }

    const data = this.calculateIndicators(prices, volumes);
    this.indicatorsCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  calculateIndicators(
    prices: number[] | PriceData[],
    volumes?: number[]
  ): TechnicalIndicators {

    // Handle both simple number array and PriceData array
    const closePrices = Array.isArray(prices) && typeof prices[0] === 'object'
      ? (prices as PriceData[]).map(p => p.close)
      : (prices as number[]);

    const highPrices = Array.isArray(prices) && typeof prices[0] === 'object'
      ? (prices as PriceData[]).map(p => p.high)
      : closePrices;

    const lowPrices = Array.isArray(prices) && typeof prices[0] === 'object'
      ? (prices as PriceData[]).map(p => p.low)
      : closePrices;

    const volumeData = volumes ||
      (Array.isArray(prices) && typeof prices[0] === 'object'
        ? (prices as PriceData[]).map(p => p.volume).filter(v => v !== undefined) as number[]
        : undefined);

    // Minimum requirement: 20 price points
    if (!closePrices || closePrices.length < 20) {
      return this.getInsufficientDataResponse();
    }

    try {
      const currentPrice = closePrices[closePrices.length - 1];
      const indicatorData = {} as TechnicalIndicators;

      // Track which indicators are available
      let indicatorsAvailable = 0;

      // === TREND INDICATORS ===

      // SMA 20 (needs 25 points: 20 + 5 warm-up)
      if (closePrices.length >= 25) {
        const sma20Array = SMA.calculate({ period: 20, values: closePrices });
        indicatorData.sma20 = sma20Array.length > 0 ? sma20Array[sma20Array.length - 1] : null;
        if (indicatorData.sma20 !== null) indicatorsAvailable++;
      } else {
        indicatorData.sma20 = null;
      }

      // SMA 50 (needs 55 points: 50 + 5 warm-up)
      if (closePrices.length >= 55) {
        const sma50Array = SMA.calculate({ period: 50, values: closePrices });
        indicatorData.sma50 = sma50Array.length > 0 ? sma50Array[sma50Array.length - 1] : null;
        if (indicatorData.sma50 !== null) indicatorsAvailable++;
      } else {
        indicatorData.sma50 = null;
      }

      // SMA 200 (needs 205 points: 200 + 5 warm-up)
      if (closePrices.length >= 205) {
        const sma200Array = SMA.calculate({ period: 200, values: closePrices });
        indicatorData.sma200 = sma200Array.length > 0 ? sma200Array[sma200Array.length - 1] : null;
        if (indicatorData.sma200 !== null) indicatorsAvailable++;
      } else {
        indicatorData.sma200 = null;
      }

      // EMA 12 and 26 for MACD
      if (closePrices.length >= 15) {
        const ema12Array = EMA.calculate({ period: 12, values: closePrices });
        indicatorData.ema12 = ema12Array.length > 0 ? ema12Array[ema12Array.length - 1] : null;
      } else {
        indicatorData.ema12 = null;
      }

      if (closePrices.length >= 30) {
        const ema26Array = EMA.calculate({ period: 26, values: closePrices });
        indicatorData.ema26 = ema26Array.length > 0 ? ema26Array[ema26Array.length - 1] : null;
      } else {
        indicatorData.ema26 = null;
      }

      // Golden/Death Cross (counted as one indicator when SMA 50 & 200 available)
      // Already counted in SMA 50 and 200

      // === MOMENTUM INDICATORS ===

      // RSI (needs 20 points: 14 + 6 warm-up)
      if (closePrices.length >= 20) {
        const rsiArray = RSI.calculate({ period: 14, values: closePrices });
        indicatorData.rsi14 = rsiArray.length > 0 ? rsiArray[rsiArray.length - 1] : null;
        if (indicatorData.rsi14 !== null) indicatorsAvailable++;
      } else {
        indicatorData.rsi14 = null;
      }

      // MACD (needs 40 points: 26 + 9 + 5 warm-up)
      if (closePrices.length >= 40) {
        const macdArray = MACD.calculate({
          values: closePrices,
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
          SimpleMAOscillator: false,
          SimpleMASignal: false
        });

        const lastMACD = macdArray.length > 0 ? macdArray[macdArray.length - 1] : null;
        indicatorData.macd = {
          value: lastMACD?.MACD ?? null,
          signal: lastMACD?.signal ?? null,
          histogram: lastMACD?.histogram ?? null,
        };
        if (indicatorData.macd.value !== null) indicatorsAvailable++;
      } else {
        indicatorData.macd = { value: null, signal: null, histogram: null };
      }

      // Stochastic Oscillator (needs 20 points: 14 + 3 + 3 warm-up)
      if (closePrices.length >= 20 && highPrices.length >= 20 && lowPrices.length >= 20) {
        try {
          const stochasticArray = Stochastic.calculate({
            high: highPrices,
            low: lowPrices,
            close: closePrices,
            period: 14,
            signalPeriod: 3
          });

          const lastStochastic = stochasticArray.length > 0
            ? stochasticArray[stochasticArray.length - 1]
            : null;

          if (lastStochastic) {
            indicatorData.stochastic = {
              k: lastStochastic.k ?? null,
              d: lastStochastic.d ?? null,
            };
            if (indicatorData.stochastic.k !== null) indicatorsAvailable++;
          }
        } catch (error) {
          console.error('Stochastic calculation error:', error);
          indicatorData.stochastic = { k: null, d: null };
        }
      } else {
        indicatorData.stochastic = { k: null, d: null };
      }

      // === VOLATILITY INDICATORS ===

      // Bollinger Bands (needs 25 points: 20 + 5 warm-up)
      if (closePrices.length >= 25) {
        const bbArray = BollingerBands.calculate({
          period: 20,
          values: closePrices,
          stdDev: 2
        });

        const lastBB = bbArray.length > 0 ? bbArray[bbArray.length - 1] : null;
        if (lastBB) {
          indicatorData.bollingerBands = {
            upper: lastBB.upper,
            middle: lastBB.middle,
            lower: lastBB.lower,
          };
          indicatorsAvailable++;
        }
      }

      // === VOLUME INDICATORS ===

      // Volume Trend (needs 25 volume points: 20 for avg + 5 for trend)
      if (volumeData && volumeData.length >= 25) {
        const currentVolume = volumeData[volumeData.length - 1];
        const last20Volumes = volumeData.slice(-20);
        const avgVolume = last20Volumes.reduce((a, b) => a + b, 0) / last20Volumes.length;
        const changePercent = ((currentVolume - avgVolume) / avgVolume) * 100;

        indicatorData.volumeTrend = {
          currentVolume,
          avgVolume,
          changePercent,
        };
        indicatorsAvailable++;
      }

      // Insufficient indicators check (need at least 2)
      if (indicatorsAvailable < 2) {
        return this.getInsufficientDataResponse();
      }

      // Generate enhanced signal with breakdown
      const analysis = this.generateEnhancedSignal(currentPrice, indicatorData, closePrices);


      return {
        ...indicatorData,
        ...analysis
      };
    } catch (error) {
      console.error('Technical analysis calculation error:', error);
      return this.getInsufficientDataResponse();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateEnhancedSignal(
    currentPrice: number,
    indicators: Record<string, any>,
    closePrices: number[]
  ): Partial<TechnicalIndicators> {
    let bullishPoints = 0;
    let bearishPoints = 0;
    let totalWeight = 0;
    let indicatorsUsed = 0;
    const warnings: string[] = [];

    const breakdown: TechnicalIndicators['breakdown'] = {
      trend: {},
      momentum: {},
      volatility: {},
      volume: {}
    };


    // === TREND INDICATORS ===

    // SMA 20 vs Price (weight: 3)
    if (indicators.sma20 !== null && indicators.sma20 !== undefined) {
      const weight = 3;
      totalWeight += weight;
      indicatorsUsed++;
      const isBullish = currentPrice > indicators.sma20;

      if (isBullish) {
        bullishPoints += weight;
      } else {
        bearishPoints += weight;
      }

      breakdown.trend.sma20 = {
        available: true,
        signal: isBullish ? 'bullish' : 'bearish',
        points: weight,
        value: indicators.sma20,
      };
    }

    // SMA 50 vs Price (weight: 3)
    if (indicators.sma50 !== null && indicators.sma50 !== undefined) {
      const weight = 3;
      totalWeight += weight;
      indicatorsUsed++;
      const isBullish = currentPrice > indicators.sma50;

      if (isBullish) {
        bullishPoints += weight;
      } else {
        bearishPoints += weight;
      }

      breakdown.trend.sma50 = {
        available: true,
        signal: isBullish ? 'bullish' : 'bearish',
        points: weight,
        value: indicators.sma50,
      };
    }

    // SMA 200 vs Price (weight: 2)
    if (indicators.sma200 !== null && indicators.sma200 !== undefined) {
      const weight = 2;
      totalWeight += weight;
      indicatorsUsed++;
      const isBullish = currentPrice > indicators.sma200;

      if (isBullish) {
        bullishPoints += weight;
      } else {
        bearishPoints += weight;
      }

      breakdown.trend.sma200 = {
        available: true,
        signal: isBullish ? 'bullish' : 'bearish',
        points: weight,
        value: indicators.sma200,
      };
    }

    // Golden Cross/Death Cross (weight: 5)
    if (indicators.sma50 !== null && indicators.sma200 !== null) {
      const weight = 5;
      totalWeight += weight;
      indicatorsUsed++;
      const isGoldenCross = indicators.sma50 > indicators.sma200;

      if (isGoldenCross) {
        bullishPoints += weight;
      } else {
        bearishPoints += weight;
      }

      breakdown.trend.goldenCross = {
        available: true,
        signal: isGoldenCross ? 'bullish' : 'bearish',
        points: weight,
        details: { active: isGoldenCross ? 'Golden Cross' : 'Death Cross' },
      };
    }

    // === MOMENTUM INDICATORS ===

    // RSI Analysis (weight: 4) - Enhanced v2.0 logic
    if (indicators.rsi14 !== null && indicators.rsi14 !== undefined) {
      const weight = 4;
      totalWeight += weight;
      indicatorsUsed++;
      const rsi = indicators.rsi14;
      let rsiPoints = 0;
      let rsiSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let category = '';

      if (rsi < 30) {
        // Oversold - reversal signal
        rsiPoints = weight;
        bullishPoints += rsiPoints;
        rsiSignal = 'bullish';
        category = 'Oversold (Reversal)';
        warnings.push('RSI oversold - potential bounce opportunity');
      } else if (rsi > 70) {
        // Overbought - reversal signal
        rsiPoints = weight;
        bearishPoints += rsiPoints;
        rsiSignal = 'bearish';
        category = 'Overbought (Reversal)';
        warnings.push('RSI overbought - potential correction ahead');
      } else if (rsi >= 50 && rsi <= 70) {
        // Bullish momentum
        rsiPoints = 2;
        bullishPoints += rsiPoints;
        rsiSignal = 'bullish';
        category = 'Bullish Momentum';
      } else if (rsi >= 30 && rsi < 50) {
        // Bearish momentum
        rsiPoints = 2;
        bearishPoints += rsiPoints;
        rsiSignal = 'bearish';
        category = 'Bearish Momentum';
      }

      breakdown.momentum.rsi = {
        available: true,
        signal: rsiSignal,
        points: rsiPoints,
        value: rsi,
        details: { category },
      };
    }

    // MACD Analysis (weight: 3) - v2.0: histogram removed
    if (indicators.macd.value !== null && indicators.macd.signal !== null) {
      const weight = 3;
      totalWeight += weight;
      indicatorsUsed++;
      const isBullish = indicators.macd.value > indicators.macd.signal;

      if (isBullish) {
        bullishPoints += weight;
      } else {
        bearishPoints += weight;
      }

      breakdown.momentum.macd = {
        available: true,
        signal: isBullish ? 'bullish' : 'bearish',
        points: weight,
        details: {
          macdValue: indicators.macd.value,
          signalValue: indicators.macd.signal,
        },
      };
    }

    // Stochastic Oscillator (weight: 3)
    if (indicators.stochastic?.k !== null && indicators.stochastic?.d !== null) {
      const weight = 3;
      totalWeight += weight;
      indicatorsUsed++;
      const k = indicators.stochastic.k;
      const d = indicators.stochastic.d;
      let stochPoints = 0;
      let stochSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';

      if (k < 20) {
        // Oversold
        stochPoints = weight;
        bullishPoints += stochPoints;
        stochSignal = 'bullish';
        warnings.push('Stochastic oversold - potential reversal');
      } else if (k > 80) {
        // Overbought
        stochPoints = weight;
        bearishPoints += stochPoints;
        stochSignal = 'bearish';
        warnings.push('Stochastic overbought - potential pullback');
      } else if (k > d && k >= 20 && k <= 80) {
        // Bullish crossover in mid-range
        stochPoints = 1.5;
        bullishPoints += stochPoints;
        stochSignal = 'bullish';
      } else if (k < d && k >= 20 && k <= 80) {
        // Bearish crossover in mid-range
        stochPoints = 1.5;
        bearishPoints += stochPoints;
        stochSignal = 'bearish';
      }

      breakdown.momentum.stochastic = {
        available: true,
        signal: stochSignal,
        points: stochPoints,
        details: { kValue: k, dValue: d },
      };
    }

    // === VOLATILITY INDICATORS ===

    // Bollinger Bands (weight: 3)
    // SCM-04: the Bollinger middle band IS the 20-day SMA, so the previous
    // "Upper Half"/"Lower Half" branches re-scored the exact same
    // price-vs-SMA20 comparison already scored under trend (weight 3) —
    // the same signal counted twice under two names. Now: score only at
    // band extremes (above upper / below lower); the mid-band case is
    // neutral (0 points), not a duplicate trend vote.
    if (indicators.bollingerBands) {
      const weight = 3;
      totalWeight += weight;
      indicatorsUsed++;
      const bb = indicators.bollingerBands;
      let bbPoints = 0;
      let bbSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      let position = '';

      if (currentPrice > bb.upper) {
        // Above upper band - overbought
        bbPoints = weight;
        bearishPoints += bbPoints;
        bbSignal = 'bearish';
        position = 'Above Upper Band';
        warnings.push('Price above Bollinger upper band - potentially overbought');
      } else if (currentPrice < bb.lower) {
        // Below lower band - oversold
        bbPoints = weight;
        bullishPoints += bbPoints;
        bbSignal = 'bullish';
        position = 'Below Lower Band';
        warnings.push('Price below Bollinger lower band - potentially oversold');
      } else {
        // Between the bands — neutral. Do not re-score price-vs-SMA20; that
        // signal is already counted under trend.
        bbPoints = 0;
        bbSignal = 'neutral';
        position = currentPrice > bb.middle ? 'Upper Half' : 'Lower Half';
      }

      breakdown.volatility.bollinger = {
        available: true,
        signal: bbSignal,
        points: bbPoints,
        details: { position, upper: bb.upper, middle: bb.middle, lower: bb.lower },
      };
    }

    // === VOLUME INDICATORS ===

    // Volume Trend (weight: 4)
    if (indicators.volumeTrend) {
      const weight = 4;
      totalWeight += weight;
      indicatorsUsed++;
      const vt = indicators.volumeTrend;
      const changePercent = vt.changePercent;
      let volPoints = 0;
      let volSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';

      // Determine price direction (comparing last 2 closes)
      const priceUp = closePrices[closePrices.length - 1] > closePrices[closePrices.length - 2];

      if (priceUp && changePercent > 20) {
        // Price up + high volume = strong bullish
        volPoints = weight;
        bullishPoints += volPoints;
        volSignal = 'bullish';
      } else if (!priceUp && changePercent > 20) {
        // Price down + high volume = strong bearish
        volPoints = weight;
        bearishPoints += volPoints;
        volSignal = 'bearish';
        warnings.push('Price declining on high volume - strong selling pressure');
      } else if (priceUp && changePercent < -20) {
        // Price up + low volume = weak move
        volPoints = 1;
        bearishPoints += volPoints;
        volSignal = 'bearish';
        warnings.push('Price increase not confirmed by volume');
      } else if (!priceUp && changePercent < -20) {
        // Price down + low volume = weak selling
        volPoints = 1;
        bullishPoints += volPoints;
        volSignal = 'bullish';
      }

      breakdown.volume.volumeTrend = {
        available: true,
        signal: volSignal,
        points: volPoints,
        details: {
          currentVolume: vt.currentVolume,
          avgVolume: vt.avgVolume,
          changePercent: `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`,
        },
      };
    }

    // === CALCULATE FINAL SCORE ===

    if (totalWeight === 0 || indicatorsUsed < 2) {
      return {
        signal: 'INSUFFICIENT_DATA',
        // SCM-03: null, not 0 — 0 is maximally bearish on the 0-10 scale and
        // was previously consumed by wishlist.service.ts as a real score.
        score: null,
        baseScore: 0,
        confidence: 'LOW',
        confidenceStars: 1,
        bullishPoints: 0,
        bearishPoints: 0,
        availableWeight: 0,
        indicatorsUsed: 0,
        agreement: 0,
        breakdown,
        warnings: ['Insufficient data for reliable analysis'],
      };
    }

    // Base score calculation
    const baseScore = (bullishPoints - bearishPoints) / totalWeight;

    // Confidence factor based on indicator availability (out of 9 possible indicators)
    const confidenceFactor = indicatorsUsed / 9;

    // Final adjusted score
    const finalScore = baseScore * (0.7 + 0.3 * confidenceFactor);

    // Agreement calculation
    const totalPoints = bullishPoints + bearishPoints;
    const dominantPoints = Math.max(bullishPoints, bearishPoints);
    const agreement = totalPoints > 0 ? (dominantPoints / totalPoints) * 100 : 0;

    // Confidence rating
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    let confidenceStars = 1;

    if (indicatorsUsed >= 8 && agreement >= 75) {
      confidence = 'HIGH';
      confidenceStars = 3;
    } else if (indicatorsUsed >= 6 || agreement >= 60) {
      confidence = 'MEDIUM';
      confidenceStars = 2;
    }

    // Signal classification (7 levels)
    let signal: TechnicalIndicators['signal'];
    if (finalScore >= 0.6) signal = 'STRONG_BUY';
    else if (finalScore >= 0.3) signal = 'BUY';
    else if (finalScore >= 0.1) signal = 'WEAK_BUY';
    else if (finalScore >= -0.1) signal = 'HOLD';
    else if (finalScore >= -0.3) signal = 'WEAK_SELL';
    else if (finalScore >= -0.6) signal = 'SELL';
    else signal = 'STRONG_SELL';

    // Add contextual warnings
    if (confidence === 'LOW') {
      warnings.push(`Signal based on limited data (only ${indicatorsUsed}/9 indicators available)`);
    }

    if (agreement < 60) {
      warnings.push('Mixed signals - indicators show divergence');
    }

    // Convert finalScore from -1..+1 range to 0..10 scale
    const scoreOutOf10 = Math.round(((finalScore + 1) / 2) * 10 * 10) / 10;


    return {
      signal,
      score: scoreOutOf10,
      baseScore,
      confidence,
      confidenceStars,
      bullishPoints,
      bearishPoints,
      availableWeight: totalWeight,
      indicatorsUsed,
      agreement,
      breakdown,
      warnings,
    };
  }

  private getEmptyIndicators(): TechnicalIndicators {
    return {
      sma20: null,
      sma50: null,
      sma200: null,
      ema12: null,
      ema26: null,
      rsi14: null,
      macd: { value: null, signal: null, histogram: null },
      signal: 'HOLD',
      // SCM-03: only ever consumed via getInsufficientDataResponse (below),
      // which overrides `signal` to INSUFFICIENT_DATA — null here keeps this
      // base object honest that no real score was computed.
      score: null,
      baseScore: 0,
      confidence: 'LOW',
      confidenceStars: 1,
      bullishPoints: 0,
      bearishPoints: 0,
      availableWeight: 0,
      indicatorsUsed: 0,
      agreement: 0,
      breakdown: {
        trend: {},
        momentum: {},
        volatility: {},
        volume: {}
      },
      warnings: [],
    };
  }

  private getInsufficientDataResponse(): TechnicalIndicators {
    return {
      ...this.getEmptyIndicators(),
      signal: 'INSUFFICIENT_DATA',
      warnings: ['Insufficient historical data for reliable technical analysis. Minimum 20 data points required.'],
    };
  }
}

export const technicalAnalysisService = new TechnicalAnalysisService();
