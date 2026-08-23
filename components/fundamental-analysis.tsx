"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { FundamentalMetricsResponse } from "@/lib/types/market";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/format";
import { metricGrade, type MetricGrade } from "@/lib/utils/score-band";
import { HeadlineScoreCard } from "@/components/research/headline-score-card";
import { SubscoreBand } from "@/components/research/subscore-band";
import { GradedMetricRow } from "@/components/research/graded-metric-row";
import { ScoreFigure } from "@/components/research/score-figure";
import { DEFAULT_SCORING_WEIGHTS, weightsEqualDefaults, type FundamentalWeights } from "@/lib/utils/scoring-weights";

interface FundamentalAnalysisProps {
  symbol: string;
  currency?: string;
}

const SUB_NAV = [
  { value: "overview", label: "Overview" },
  { value: "valuation", label: "Valuation" },
  { value: "profitability", label: "Profitability" },
  { value: "growth", label: "Growth" },
  { value: "health", label: "Health" },
  { value: "dividend", label: "Dividend" },
] as const;

type SubNavValue = (typeof SUB_NAV)[number]["value"];

function fmtNumber(value: number | null): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}

function fmtPercent(value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function fmtCurrencyOrNull(value: number | null, currency?: string): string | null {
  return value === null || value === undefined ? null : formatCurrency(value, currency);
}

function fmtLargeNumber(value: number | null, currency?: string): string | null {
  if (value === null || value === undefined) return null;
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency || "$";
  if (value >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M`;
  return formatCurrency(value, currency);
}

export function FundamentalAnalysis({ symbol, currency }: FundamentalAnalysisProps) {
  const [subNav, setSubNav] = useState<SubNavValue>("overview");

  const { data, isLoading, error } = useQuery<FundamentalMetricsResponse>({
    queryKey: ["fundamentals", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market/fundamentals/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch fundamentals");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  // Custom-weighting meta kicker (DESIGN.md "Headline score card" ->
  // "Custom-weighting meta kicker"): a cheap comparison against the
  // already-fetched ["scoring-weights"] query vs. DEFAULT_SCORING_WEIGHTS —
  // no extra request. Swaps the meta kicker copy to signal this score is
  // personalized when the user's fundamental subcategory weights differ
  // from the house default.
  const weightsQ = useQuery<{ fundamental: FundamentalWeights }>({
    queryKey: ["scoring-weights"],
    queryFn: async () => {
      const res = await fetch("/api/settings/scoring-weights");
      if (!res.ok) throw new Error("Failed to fetch scoring weights");
      return res.json();
    },
    staleTime: Infinity,
  });
  const hasCustomWeights = !weightsEqualDefaults(weightsQ.data?.fundamental, DEFAULT_SCORING_WEIGHTS.fundamental);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-mut">
        Loading fundamental analysis…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-mut">
        <AlertCircle className="mr-2 h-4 w-4" />
        Unable to load fundamental analysis
      </div>
    );
  }

  const subscoreItems = [
    { label: "Valuation", score: data.score.breakdown.valuation },
    { label: "Profitability", score: data.score.breakdown.profitability },
    { label: "Growth", score: data.score.breakdown.growth },
    { label: "Health", score: data.score.breakdown.financial },
    { label: "Dividend", score: data.score.breakdown.dividend },
  ];

  return (
    <div className="space-y-5">
      <HeadlineScoreCard
        kicker="Fundamental analysis"
        metaKicker={hasCustomWeights ? "Your weighting · trailing twelve months" : "Trailing twelve months · FY ends"}
        score={data.score.total}
        summary={data.score.interpretation}
      >
        <SubscoreBand items={subscoreItems} />
      </HeadlineScoreCard>

      <div className="flex flex-wrap gap-2.5">
        {SUB_NAV.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setSubNav(item.value)}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-2xl px-[18px] py-2 text-[10.5px] uppercase tracking-[0.12em]",
              subNav === item.value
                ? "bg-btnbg font-semibold text-btnfg"
                : "border border-line text-mut"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {subNav === "overview" && <FundamentalOverviewSubView data={data} />}
      {subNav === "valuation" && <ValuationSubView data={data} currency={currency} />}
      {subNav === "profitability" && <ProfitabilitySubView data={data} />}
      {subNav === "growth" && <GrowthSubView data={data} />}
      {subNav === "health" && <HealthSubView data={data} />}
      {subNav === "dividend" && <DividendSubView data={data} />}
    </div>
  );
}

function SectionCard({ title, children, footnote }: { title?: string; children: React.ReactNode; footnote?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-7 pb-7 pt-6">
      {title && <div className="mb-5 text-[11px] font-semibold uppercase tracking-[0.14em]">{title}</div>}
      {children}
      {footnote && <p className="mt-5 font-serif text-[13.5px] italic text-mut">{footnote}</p>}
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 border-b border-line pb-2 text-[10.5px] uppercase tracking-[0.14em] text-mut">
      {children}
    </div>
  );
}

function GradingDotLegend() {
  return (
    <div className="mt-6 flex flex-wrap gap-6 text-[12.5px] text-sub">
      <span>
        <span className="text-up">●</span> Strong vs peers
      </span>
      <span>
        <span className="text-amber">●</span> In line
      </span>
      <span>
        <span className="text-dn">●</span> Weak vs peers
      </span>
    </div>
  );
}

function FundamentalOverviewSubView({ data }: { data: FundamentalMetricsResponse }) {
  const sections: Array<{
    name: string;
    score: number;
    rows: Array<{ label: string; value: string | null; grade: MetricGrade }>;
  }> = [
    {
      name: "Valuation",
      score: data.score.breakdown.valuation,
      rows: [
        { label: "P/E ratio", value: fmtNumber(data.valuation.peRatio), grade: metricGrade(data.valuation.peRatio, { goodThreshold: 20, badThreshold: 30, inverse: true }) },
        { label: "Forward P/E", value: fmtNumber(data.valuation.forwardPE), grade: metricGrade(data.valuation.forwardPE, { goodThreshold: 15, badThreshold: 25, inverse: true }) },
        { label: "PEG ratio", value: fmtNumber(data.valuation.pegRatio), grade: metricGrade(data.valuation.pegRatio, { goodThreshold: 1, badThreshold: 2, inverse: true }) },
        { label: "P/B ratio", value: fmtNumber(data.valuation.pbRatio), grade: metricGrade(data.valuation.pbRatio, { goodThreshold: 1.5, badThreshold: 3, inverse: true }) },
      ],
    },
    {
      name: "Profitability",
      score: data.score.breakdown.profitability,
      rows: [
        { label: "Profit margin", value: fmtPercent(data.profitability.profitMargin), grade: metricGrade(data.profitability.profitMargin, { goodThreshold: 0.1, badThreshold: 0 }) },
        { label: "Operating margin", value: fmtPercent(data.profitability.operatingMargin), grade: metricGrade(data.profitability.operatingMargin, { goodThreshold: 0.15, badThreshold: 0 }) },
        { label: "Return on equity", value: fmtPercent(data.profitability.roe), grade: metricGrade(data.profitability.roe, { goodThreshold: 0.15, badThreshold: 0 }) },
        { label: "Return on assets", value: fmtPercent(data.profitability.roa), grade: metricGrade(data.profitability.roa, { goodThreshold: 0.05, badThreshold: 0 }) },
      ],
    },
    {
      name: "Growth",
      score: data.score.breakdown.growth,
      rows: [
        { label: "Revenue growth", value: fmtPercent(data.growth.revenueGrowth), grade: metricGrade(data.growth.revenueGrowth, { goodThreshold: 0.1, badThreshold: 0 }) },
        { label: "Earnings growth", value: fmtPercent(data.growth.earningsGrowth), grade: metricGrade(data.growth.earningsGrowth, { goodThreshold: 0.1, badThreshold: 0 }) },
        { label: "FCF growth", value: fmtPercent(data.growth.fcfGrowth), grade: metricGrade(data.growth.fcfGrowth, { goodThreshold: 0.1, badThreshold: 0 }) },
      ],
    },
    {
      name: "Health",
      score: data.score.breakdown.financial,
      rows: [
        { label: "Current ratio", value: fmtNumber(data.financial.currentRatio), grade: metricGrade(data.financial.currentRatio, { goodThreshold: 1.5, badThreshold: 1 }) },
        { label: "Quick ratio", value: fmtNumber(data.financial.quickRatio), grade: metricGrade(data.financial.quickRatio, { goodThreshold: 1, badThreshold: 0.5 }) },
        { label: "Debt to equity", value: fmtNumber(data.financial.debtToEquity), grade: metricGrade(data.financial.debtToEquity, { goodThreshold: 1, badThreshold: 2, inverse: true }) },
      ],
    },
    {
      name: "Dividend",
      score: data.score.breakdown.dividend,
      rows: [
        { label: "Dividend yield", value: fmtPercent(data.dividend.yield), grade: metricGrade(data.dividend.yield, { goodThreshold: 0.02, badThreshold: 0 }) },
        { label: "Payout ratio", value: fmtPercent(data.dividend.payoutRatio), grade: metricGrade(data.dividend.payoutRatio, { goodThreshold: 0.6, badThreshold: 0.9, inverse: true }) },
        { label: "5Y avg dividend yield", value: fmtPercent(data.dividend.fiveYearAvgYield), grade: metricGrade(data.dividend.fiveYearAvgYield, { goodThreshold: 0.02, badThreshold: 0 }) },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <SectionCard title="Score breakdown">
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
          {sections.map((section) => (
            <div key={section.name}>
              <div className="flex items-baseline justify-between pb-3" style={{ borderBottom: "3px double var(--foreground)" }}>
                <span className="font-serif text-[17px]">{section.name}</span>
                <ScoreFigure score={section.score} size="sub" showSuffix={false} />
              </div>
              <div className="mt-1">
                {section.rows.map((row) => (
                  <GradedMetricRow key={row.label} label={row.label} value={row.value} grade={row.grade} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <GradingDotLegend />
      </SectionCard>

      <SectionCard title="Revenue by segment">
        <p className="font-serif text-[14.5px] italic text-mut">
          Segment breakdown not available. {/* TD-DTL-SEG — no segment data from the fundamentals API. */}
        </p>
      </SectionCard>
    </div>
  );
}

function ValuationSubView({ data, currency }: { data: FundamentalMetricsResponse; currency?: string }) {
  const v = data.valuation;
  return (
    <SectionCard>
      <div className="mb-6 flex items-baseline justify-between pb-3" style={{ borderBottom: "3px double var(--foreground)" }}>
        <span className="font-serif text-[17px]">Valuation</span>
        <ScoreFigure score={data.score.breakdown.valuation} size="sub" showSuffix={false} />
      </div>

      <GroupHeading>Valuation ratios</GroupHeading>
      <div className="mb-6 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <GradedMetricRow label="P/E ratio" value={fmtNumber(v.peRatio)} grade={metricGrade(v.peRatio, { goodThreshold: 20, badThreshold: 30, inverse: true })} />
        <GradedMetricRow label="Forward P/E" value={fmtNumber(v.forwardPE)} grade={metricGrade(v.forwardPE, { goodThreshold: 15, badThreshold: 25, inverse: true })} />
        <GradedMetricRow label="PEG ratio" value={fmtNumber(v.pegRatio)} grade={metricGrade(v.pegRatio, { goodThreshold: 1, badThreshold: 2, inverse: true })} />
        <GradedMetricRow label="P/S ratio" value={fmtNumber(v.psRatio)} grade={metricGrade(v.psRatio, { goodThreshold: 1.5, badThreshold: 5, inverse: true })} />
        <GradedMetricRow label="P/B ratio" value={fmtNumber(v.pbRatio)} grade={metricGrade(v.pbRatio, { goodThreshold: 1.5, badThreshold: 3, inverse: true })} />
        <GradedMetricRow label="P/FCF ratio" value={fmtNumber(v.pfcfRatio)} grade={metricGrade(v.pfcfRatio, { goodThreshold: 15, badThreshold: 30, inverse: true })} />
        <GradedMetricRow label="EV/EBITDA" value={fmtNumber(v.evToEbitda)} grade={metricGrade(v.evToEbitda, { goodThreshold: 10, badThreshold: 20, inverse: true })} />
      </div>

      <GroupHeading>Per-share metrics</GroupHeading>
      <div className="mb-6 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <GradedMetricRow label="EPS" value={fmtCurrencyOrNull(v.eps, currency)} hideDot />
        <GradedMetricRow label="Forward EPS" value={fmtCurrencyOrNull(v.forwardEps, currency)} hideDot />
        <GradedMetricRow label="Book value" value={fmtCurrencyOrNull(v.bookValue, currency)} hideDot />
      </div>

      <GroupHeading>Company size</GroupHeading>
      <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <GradedMetricRow label="Market cap" value={fmtLargeNumber(v.marketCap, currency)} hideDot />
        <GradedMetricRow label="Enterprise value" value={fmtLargeNumber(v.enterpriseValue, currency)} hideDot />
      </div>
    </SectionCard>
  );
}

function ProfitabilitySubView({ data }: { data: FundamentalMetricsResponse }) {
  const p = data.profitability;
  return (
    <SectionCard>
      <div className="mb-6 flex items-baseline justify-between pb-3" style={{ borderBottom: "3px double var(--foreground)" }}>
        <span className="font-serif text-[17px]">Profitability</span>
        <ScoreFigure score={data.score.breakdown.profitability} size="sub" showSuffix={false} />
      </div>
      <GroupHeading>Margins &amp; returns</GroupHeading>
      <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <GradedMetricRow label="Profit margin" value={fmtPercent(p.profitMargin)} grade={metricGrade(p.profitMargin, { goodThreshold: 0.1, badThreshold: 0 })} />
        <GradedMetricRow label="Operating margin" value={fmtPercent(p.operatingMargin)} grade={metricGrade(p.operatingMargin, { goodThreshold: 0.15, badThreshold: 0 })} />
        <GradedMetricRow label="Return on equity" value={fmtPercent(p.roe)} grade={metricGrade(p.roe, { goodThreshold: 0.15, badThreshold: 0 })} />
        <GradedMetricRow label="Return on assets" value={fmtPercent(p.roa)} grade={metricGrade(p.roa, { goodThreshold: 0.05, badThreshold: 0 })} />
      </div>
      <p className="mt-5 font-serif text-[13.5px] italic text-mut">
        High ROE driven primarily by buybacks (reduced equity base) rather than earnings growth can overstate capital efficiency.
      </p>
    </SectionCard>
  );
}

function GrowthSubView({ data }: { data: FundamentalMetricsResponse }) {
  const g = data.growth;
  return (
    <SectionCard>
      <div className="mb-6 flex items-baseline justify-between pb-3" style={{ borderBottom: "3px double var(--foreground)" }}>
        <span className="font-serif text-[17px]">Growth</span>
        <ScoreFigure score={data.score.breakdown.growth} size="sub" showSuffix={false} />
      </div>
      <GroupHeading>Year-over-year growth</GroupHeading>
      <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <GradedMetricRow label="Revenue growth" value={fmtPercent(g.revenueGrowth)} grade={metricGrade(g.revenueGrowth, { goodThreshold: 0.1, badThreshold: 0 })} />
        <GradedMetricRow label="Earnings growth" value={fmtPercent(g.earningsGrowth)} grade={metricGrade(g.earningsGrowth, { goodThreshold: 0.1, badThreshold: 0 })} />
        <GradedMetricRow label="Free cash flow growth" value={fmtPercent(g.fcfGrowth)} grade={metricGrade(g.fcfGrowth, { goodThreshold: 0.1, badThreshold: 0 })} />
      </div>
    </SectionCard>
  );
}

function HealthSubView({ data }: { data: FundamentalMetricsResponse }) {
  const f = data.financial;
  return (
    <SectionCard>
      <div className="mb-6 flex items-baseline justify-between pb-3" style={{ borderBottom: "3px double var(--foreground)" }}>
        <span className="font-serif text-[17px]">Health</span>
        <ScoreFigure score={data.score.breakdown.financial} size="sub" showSuffix={false} />
      </div>
      <GroupHeading>Liquidity &amp; leverage</GroupHeading>
      <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
        <GradedMetricRow label="Current ratio" value={fmtNumber(f.currentRatio)} grade={metricGrade(f.currentRatio, { goodThreshold: 1.5, badThreshold: 1 })} />
        <GradedMetricRow label="Quick ratio" value={fmtNumber(f.quickRatio)} grade={metricGrade(f.quickRatio, { goodThreshold: 1, badThreshold: 0.5 })} />
        <GradedMetricRow label="Debt to equity" value={fmtNumber(f.debtToEquity)} grade={metricGrade(f.debtToEquity, { goodThreshold: 1, badThreshold: 2, inverse: true })} />
        <GradedMetricRow label="Interest coverage" value={fmtNumber(f.interestCoverage)} grade={metricGrade(f.interestCoverage, { goodThreshold: 3, badThreshold: 1 })} />
      </div>
    </SectionCard>
  );
}

function DividendSubView({ data }: { data: FundamentalMetricsResponse }) {
  const d = data.dividend;
  const hasDividend = d.yield !== null || d.payoutRatio !== null;
  return (
    <SectionCard
      footnote={hasDividend ? "Payout ratios above 90% may not be sustainable through a downturn." : undefined}
    >
      <div className="mb-6 flex items-baseline justify-between pb-3" style={{ borderBottom: "3px double var(--foreground)" }}>
        <span className="font-serif text-[17px]">Dividend</span>
        <ScoreFigure score={data.score.breakdown.dividend} size="sub" showSuffix={false} />
      </div>
      {hasDividend ? (
        <>
          <GroupHeading>Payout</GroupHeading>
          <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
            <GradedMetricRow label="Dividend yield" value={fmtPercent(d.yield)} grade={metricGrade(d.yield, { goodThreshold: 0.02, badThreshold: 0 })} />
            <GradedMetricRow label="Payout ratio" value={fmtPercent(d.payoutRatio)} grade={metricGrade(d.payoutRatio, { goodThreshold: 0.6, badThreshold: 0.9, inverse: true })} />
            <GradedMetricRow label="5Y avg dividend yield" value={fmtPercent(d.fiveYearAvgYield)} grade={metricGrade(d.fiveYearAvgYield, { goodThreshold: 0.02, badThreshold: 0 })} />
          </div>
        </>
      ) : (
        <p className="font-serif text-[14.5px] italic text-mut">No dividend data available. This company may not pay dividends.</p>
      )}
    </SectionCard>
  );
}
