// Shared market data types used across services and components

export interface ChartDataPoint {
  date: string;
  value: number;
  volume: number;
}

export interface ChartIndicators {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: {
    value: number | null;
    signal: number | null;
    histogram: number | null;
  } | null;
  bollingerBands: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  } | null;
  stochastic: {
    k: number | null;
    d: number | null;
  } | null;
  signal: string;
  score: number;
  confidence: string;
  confidenceStars: number;
  breakdown: Record<string, Record<string, IndicatorBreakdownEntry>>;
  warnings: string[];
  agreement: number;
  indicatorsUsed: number;
  bullishPoints: number;
  bearishPoints: number;
  availableWeight: number;
  volumeTrend: {
    currentVolume: number | null;
    avgVolume: number | null;
    changePercent: number | null;
  } | null;
}

export interface IndicatorBreakdownEntry {
  signal: 'bullish' | 'bearish' | 'neutral';
  points: number;
  details?: Record<string, string>;
}

export interface ChartApiResponse {
  chart: ChartDataPoint[];
  indicators: ChartIndicators;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  exchange?: string;
  type?: string;
}

export interface FundamentalMetricsResponse {
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
    // SCM-09: renamed from growthRate — this field is populated from
    // summaryDetail.fiveYearAvgDividendYield (a yield), not a computed
    // growth rate. See lib/services/fundamental-analysis.service.ts.
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

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  ticker: string;
  name: string;
  quantity: number;
  price: number;
  totalAmount: number;
  fees: number;
  executedAt: string;
  notes?: string;
}

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  quantity: number;
  avgCostBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  originalCurrency?: string;
}
