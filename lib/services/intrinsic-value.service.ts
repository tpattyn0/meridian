import { prisma } from "@/lib/prisma";
import { FundamentalData, IndustryComparison } from "@prisma/client";

interface ValuationMethod {
  name: string;
  value: number | null;
  formula: string;
  inputs: Record<string, number | null>;
  confidence: 'high' | 'medium' | 'low';
}

interface IntrinsicValueResult {
  currentPrice: number;
  intrinsicValue: number | null;
  upside: number | null;
  upsidePercent: number | null;
  methods: ValuationMethod[];
  confidence: 'high' | 'medium' | 'low';
  lastUpdated: Date;
  // Method-spread Bear/Bull (OD-2, plans/2026-07-19-research-tab-fixes.md):
  // min/max of the valid (value > 0) method results. Not a flex-assumptions
  // scenario model — intrinsicValue (the weighted average) stays the base
  // case. Null when fewer than 2 methods produced a valid value.
  scenarioLow: number | null;
  scenarioHigh: number | null;
  validMethodCount: number;
}

export class IntrinsicValueService {
  /**
   * Calculate intrinsic value using multiple methods
   */
  static async calculateIntrinsicValue(
    symbol: string,
    currentPrice: number
  ): Promise<IntrinsicValueResult> {
    // Fetch fundamental data
    const fundamentalData = await prisma.fundamentalData.findUnique({
      where: { symbol },
    });

    if (!fundamentalData) {
      throw new Error("No fundamental data available");
    }

    // Fetch industry comparison for relative valuation
    const industryData = await prisma.industryComparison.findUnique({
      where: { symbol },
    });

    const methods: ValuationMethod[] = [];

    // Method 1: DCF Lite (Simplified DCF)
    const dcfValue = this.calculateDCFLite(fundamentalData);
    methods.push(dcfValue);

    // Method 2: Graham Number
    const grahamValue = this.calculateGrahamNumber(fundamentalData);
    methods.push(grahamValue);

    // Method 3: PEG Adjusted Value
    const pegValue = this.calculatePEGAdjusted(
      fundamentalData,
      industryData,
      currentPrice
    );
    methods.push(pegValue);

    // Method 4: P/E Multiple Valuation
    const peValue = this.calculatePEMultiple(fundamentalData, industryData);
    methods.push(peValue);

    // Method 5: P/B Multiple Valuation
    const pbValue = this.calculatePBMultiple(fundamentalData, industryData);
    methods.push(pbValue);

    // Calculate final intrinsic value (weighted average)
    const intrinsicValue = this.calculateWeightedAverage(methods);

    // Calculate upside/downside
    const upside = intrinsicValue ? intrinsicValue - currentPrice : null;
    const upsidePercent = intrinsicValue
      ? ((intrinsicValue - currentPrice) / currentPrice) * 100
      : null;

    // Determine overall confidence
    const confidence = this.determineConfidence(methods);

    // Method-spread Bear/Bull (OD-2): min/max of the already-computed valid
    // method values, not a new scenario model. intrinsicValue (weighted
    // average) remains the Base case.
    const { scenarioLow, scenarioHigh, validMethodCount } = this.calculateScenarioRange(methods);

    return {
      currentPrice,
      intrinsicValue,
      upside,
      upsidePercent,
      methods,
      confidence,
      lastUpdated: new Date(),
      scenarioLow,
      scenarioHigh,
      validMethodCount,
    };
  }

  /**
   * DCF Lite Method
   * Formula: EPS * (1 + g)^5 * Terminal P/E
   */
  private static calculateDCFLite(data: FundamentalData): ValuationMethod {
    const eps = data.eps;

    // SCM-13: distinguish MISSING growth (no data — should not enter the
    // ensemble at all) from a REPORTED 0% growth (a legitimate, if bearish,
    // input). `earningsGrowth || 0` previously collapsed both cases to 0%,
    // producing a strong "overvalued" vote purely from a data gap. A missing
    // value returns value: null below so this method is excluded from the
    // weighted average, exactly like every other method's "insufficient
    // inputs" case.
    const earningsGrowthMissing = data.earningsGrowth === null || data.earningsGrowth === undefined;
    const earningsGrowth = data.earningsGrowth ?? 0;

    // Cap growth at 15% for conservative estimate
    const g = Math.min(earningsGrowth, 0.15);

    // SCM-05: the terminal multiple previously used the stock's OWN trailing
    // P/E uncapped (up to <50), which is circular — an expensive stock is
    // granted an expensive exit multiple, validating its own price. Capped
    // at a documented ceiling of 18 (never the stock's own uncapped current
    // multiple) until sector-median terminal multiples land (SCM-14).
    const TERMINAL_PE_CAP = 18;
    const terminalPE = data.peRatio && data.peRatio > 0
      ? Math.min(data.peRatio, TERMINAL_PE_CAP)
      : 15;

    let value = null;
    if (!earningsGrowthMissing && eps && eps > 0) {
      // Project earnings 5 years out
      const futureEPS = eps * Math.pow(1 + g, 5);
      // Apply terminal multiple
      value = futureEPS * terminalPE;

      // Discount back to present value (using 10% discount rate)
      const discountRate = 0.10;
      value = value / Math.pow(1 + discountRate, 5);
    }

    return {
      name: "DCF Lite",
      value,
      formula: "EPS × (1 + g)^5 × Terminal P/E ÷ (1 + r)^5",
      inputs: {
        eps,
        growthRate: g,
        terminalPE,
        discountRate: 0.10,
      },
      confidence: value && eps && eps > 0 && g > 0 ? 'medium' : 'low',
    };
  }

  /**
   * Graham Number Method
   * Formula: √(15 × EPS × 1.5 × Book Value)
   */
  private static calculateGrahamNumber(data: FundamentalData): ValuationMethod {
    const eps = data.eps;
    const bookValue = data.bookValue;

    let value = null;
    if (eps && eps > 0 && bookValue && bookValue > 0) {
      value = Math.sqrt(15 * eps * 1.5 * bookValue);
    }

    return {
      name: "Graham Number",
      value,
      formula: "√(15 × EPS × 1.5 × Book Value)",
      inputs: {
        eps,
        bookValue,
      },
      confidence: value && eps && eps > 0 && bookValue && bookValue > 0 ? 'high' : 'low',
    };
  }

  /**
   * PEG Adjusted Valuation
   * Formula: Current Price × (Industry PEG / Stock PEG)
   */
  private static calculatePEGAdjusted(
    data: FundamentalData,
    industryData: IndustryComparison | null,
    currentPrice: number
  ): ValuationMethod {
    const pegRatio = data.pegRatio;
    const industryAvgPEG = industryData?.avgPeRatio && data.earningsGrowth
      ? industryData.avgPeRatio / (data.earningsGrowth * 100)
      : 1;

    let value = null;
    if (pegRatio && pegRatio > 0 && industryAvgPEG > 0) {
      value = currentPrice * (industryAvgPEG / pegRatio);
    }

    return {
      name: "PEG Adjusted",
      value,
      formula: "Current Price × (Industry PEG / Stock PEG)",
      inputs: {
        currentPrice,
        stockPEG: pegRatio,
        industryPEG: industryAvgPEG,
      },
      confidence: value && pegRatio && pegRatio > 0 && pegRatio < 3 ? 'medium' : 'low',
    };
  }

  /**
   * P/E Multiple Valuation
   * Formula: EPS × Industry Average P/E
   */
  private static calculatePEMultiple(data: FundamentalData, industryData: IndustryComparison | null): ValuationMethod {
    const eps = data.eps;
    const industryPE = industryData?.avgPeRatio || 15;

    let value = null;
    if (eps && eps > 0) {
      value = eps * industryPE;
    }

    return {
      name: "P/E Multiple",
      value,
      formula: "EPS × Industry Average P/E",
      inputs: {
        eps,
        industryPE,
      },
      confidence: value && eps && eps > 0 && industryPE > 0 && industryPE < 50 ? 'medium' : 'low',
    };
  }

  /**
   * P/B Multiple Valuation
   * Formula: Book Value × Industry Average P/B
   */
  private static calculatePBMultiple(data: FundamentalData, industryData: IndustryComparison | null): ValuationMethod {
    const bookValue = data.bookValue;
    const industryPB = industryData?.avgPbRatio || 1.5;

    let value = null;
    if (bookValue && bookValue > 0) {
      value = bookValue * industryPB;
    }

    return {
      name: "P/B Multiple",
      value,
      formula: "Book Value × Industry Average P/B",
      inputs: {
        bookValue,
        industryPB,
      },
      confidence: value && bookValue && bookValue > 0 ? 'medium' : 'low',
    };
  }

  /**
   * Calculate weighted average of all methods
   */
  private static calculateWeightedAverage(methods: ValuationMethod[]): number | null {
    const weights = {
      high: 3,
      medium: 2,
      low: 1,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    methods.forEach(method => {
      if (method.value && method.value > 0) {
        const weight = weights[method.confidence];
        weightedSum += method.value * weight;
        totalWeight += weight;
      }
    });

    return totalWeight > 0 ? weightedSum / totalWeight : null;
  }

  /**
   * Method-spread Bear/Bull range (OD-2, plans/2026-07-19-research-tab-fixes.md):
   * min/max of the methods with a valid positive value. Requires at least 2
   * valid methods to produce a meaningful range — a single value has no
   * "spread", so scenarioLow/scenarioHigh are null in that case (em-dash at
   * the component layer), matching the same em-dash convention already used
   * for every other data-gap in this tab.
   */
  private static calculateScenarioRange(methods: ValuationMethod[]): {
    scenarioLow: number | null;
    scenarioHigh: number | null;
    validMethodCount: number;
  } {
    const validValues = methods
      .filter((m) => m.value !== null && m.value > 0)
      .map((m) => m.value as number);

    if (validValues.length < 2) {
      return { scenarioLow: null, scenarioHigh: null, validMethodCount: validValues.length };
    }

    return {
      scenarioLow: Math.min(...validValues),
      scenarioHigh: Math.max(...validValues),
      validMethodCount: validValues.length,
    };
  }

  /**
   * Determine overall confidence level
   */
  private static determineConfidence(methods: ValuationMethod[]): 'high' | 'medium' | 'low' {
    const validMethods = methods.filter(m => m.value && m.value > 0);
    
    if (validMethods.length >= 4) {
      const highConfidence = validMethods.filter(m => m.confidence === 'high').length;
      if (highConfidence >= 2) return 'high';
      return 'medium';
    } else if (validMethods.length >= 2) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Get value rating based on upside
   */
  static getValueRating(upsidePercent: number | null): {
    rating: string;
    color: string;
    description: string;
  } {
    if (!upsidePercent) {
      return {
        rating: "Unknown",
        color: "gray",
        description: "Insufficient data for valuation",
      };
    }

    if (upsidePercent >= 30) {
      return {
        rating: "Significantly Undervalued",
        color: "green",
        description: "Trading well below intrinsic value",
      };
    } else if (upsidePercent >= 15) {
      return {
        rating: "Undervalued",
        color: "emerald",
        description: "Trading below intrinsic value",
      };
    } else if (upsidePercent >= -10) {
      return {
        rating: "Fairly Valued",
        color: "blue",
        description: "Trading near intrinsic value",
      };
    } else if (upsidePercent >= -25) {
      return {
        rating: "Overvalued",
        color: "orange",
        description: "Trading above intrinsic value",
      };
    } else {
      return {
        rating: "Significantly Overvalued",
        color: "red",
        description: "Trading well above intrinsic value",
      };
    }
  }
}