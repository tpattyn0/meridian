"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DetailPriceChart } from "@/components/research/detail-price-chart";
import { HeadlineScoreCard } from "@/components/research/headline-score-card";
import { SubscoreBand } from "@/components/research/subscore-band";
import {
  computeSentimentScore,
  round1,
  upsideToScore,
  verdictLabel,
} from "@/lib/utils/research-scores";
import {
  DEFAULT_SCORING_WEIGHTS,
  normalizeCompositeWeights,
  weightedCompositeTotal,
  weightsEqualDefaults,
  type CompositeWeights,
} from "@/lib/utils/scoring-weights";

interface OverviewProps {
  symbol: string;
  name: string;
  currentPrice: number;
  context?: "portfolio" | "wishlist";
  currency?: string;
}

export function Overview({ symbol, name, currentPrice, context = "portfolio", currency }: OverviewProps) {
  // Chart/technical indicators for score
  const chartQ = useQuery({
    queryKey: ["chart", symbol, "1Y"],
    queryFn: async () => {
      const res = await fetch(`/api/market/chart/${symbol}?period=1Y`);
      if (!res.ok) throw new Error("Failed to fetch chart/indicators");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fundamentals
  const fundamentalsQ = useQuery({
    queryKey: ["fundamentals", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market/fundamentals/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch fundamentals");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  // Analyst ratings
  const analystQ = useQuery({
    queryKey: ["analyst-ratings", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market/analyst-ratings/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch analyst ratings");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  // Intrinsic value
  const intrinsicQ = useQuery({
    queryKey: ["intrinsic-value", symbol, currentPrice],
    queryFn: async () => {
      const res = await fetch(`/api/research/${symbol}/intrinsic-value?price=${currentPrice}`);
      if (!res.ok) throw new Error("Failed to fetch intrinsic value");
      return res.json();
    },
    enabled: currentPrice > 0,
    staleTime: 60 * 60 * 1000,
  });

  // News & sentiment (analyzed)
  const newsQ = useQuery({
    queryKey: ["news", symbol, "overview"],
    queryFn: async () => {
      const params = new URLSearchParams({ analyze: "true", limit: "20" });
      params.append("name", name);
      const res = await fetch(`/api/news/${symbol}?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // User's scoring weights (plans/2026-07-20-configurable-scoring-weights.md).
  // This is user config, not market data — long staleTime, no periodic
  // refetch. Settings page invalidates ["scoring-weights"] on save so an
  // open Overview tab picks up a changed weighting without a manual refresh.
  const weightsQ = useQuery<{ composite: CompositeWeights }>({
    queryKey: ["scoring-weights"],
    queryFn: async () => {
      const res = await fetch("/api/settings/scoring-weights");
      if (!res.ok) throw new Error("Failed to fetch scoring weights");
      return res.json();
    },
    staleTime: Infinity,
  });

  // Derive subscores. Each dimension defaults to a neutral `5` when its query
  // has *resolved with no usable data* (the pre-existing behavior), but
  // reports `null` when its query *errored* — the composite math substitutes
  // a neutral value for a missing input either way (unchanged scoring
  // behavior), but the SubscoreBand/ScoreFigure render an honest `--mut`
  // placeholder for `null` instead of a fabricated `5` (DESIGN.md "Score
  // figure" null/unavailable band). This is presentational-only: no scoring
  // math changes, only what gets displayed for an errored dimension.
  const technicalScore = useMemo(() => {
    if (chartQ.isError) return null;
    const indicators = chartQ.data?.indicators;
    if (!indicators) return 5;
    // Use the actual calculated score from technical analysis instead of mapping signal
    return typeof indicators.score === 'number' ? indicators.score : 5;
  }, [chartQ.data, chartQ.isError]);

  const fundamentalScore = useMemo(() => {
    if (fundamentalsQ.isError) return null;
    const s = fundamentalsQ.data?.score?.total;
    return typeof s === "number" ? s : 5;
  }, [fundamentalsQ.data, fundamentalsQ.isError]);

  const analystScore = useMemo(() => {
    if (analystQ.isError) return null;
    const s = analystQ.data?.score;
    if (typeof s !== "number") return 5;
    return Math.max(0, Math.min(10, s));
  }, [analystQ.data, analystQ.isError]);

  const intrinsicScore = useMemo(() => {
    if (intrinsicQ.isError) return null;
    const up = intrinsicQ.data?.upsidePercent as number | null | undefined;
    return upsideToScore(up);
  }, [intrinsicQ.data, intrinsicQ.isError]);

  const sentimentScore = useMemo(() => {
    if (newsQ.isError) return null;
    const articles = (newsQ.data || []) as Array<{ sentiment: number | null; impact?: string | null; relevanceScore?: number | null }>;
    if (!Array.isArray(articles) || articles.length === 0) return 5;
    // Shared News & sentiment score derivation (plans/2026-07-24-news-sentiment-accuracy.md,
    // Task 11; review NSA-I1/NSA-I2) — identical function call at all three
    // call sites (news-feed.tsx, this component, wishlist.service.ts) so the
    // composite's sentiment dimension cannot silently diverge from the News
    // tab's own headline score. See `computeSentimentScore`'s docstring for
    // the null-sentiment exclusion rule.
    return computeSentimentScore(articles).score;
  }, [newsQ.data, newsQ.isError]);

  // Composite score, user-weighted (plans/2026-07-20-configurable-scoring-weights.md,
  // ADR-21) — the hardcoded weights object is replaced by the user's fetched
  // category weights (falling back to DEFAULT_SCORING_WEIGHTS.composite while
  // the query is loading/unset), normalized client-side via the shared
  // lib/utils/scoring-weights.ts module. A `null` (errored) dimension still
  // substitutes a neutral 5 in the weighted sum, same as before.
  const compositeWeights = useMemo(
    () => normalizeCompositeWeights(weightsQ.data?.composite ?? DEFAULT_SCORING_WEIGHTS.composite),
    [weightsQ.data]
  );

  const composite = useMemo(() => {
    const sum = weightedCompositeTotal(
      {
        intrinsicValue: intrinsicScore,
        fundamental: fundamentalScore,
        technical: technicalScore,
        sentiment: sentimentScore,
        analyst: analystScore,
      },
      compositeWeights
    );
    const rounded = round1(sum);
    const action = verdictLabel(rounded, context);
    return { score: rounded, action };
  }, [intrinsicScore, fundamentalScore, technicalScore, sentimentScore, analystScore, compositeWeights, context]);

  const hasCustomWeights = useMemo(
    () => !weightsEqualDefaults(weightsQ.data?.composite, DEFAULT_SCORING_WEIGHTS.composite),
    [weightsQ.data]
  );

  // The composite HeadlineScoreCard is assembled from all five dimension
  // queries plus the weights query — gate its loading state on all six, not
  // just chart/technical (plans/2026-07-20-small-visual-fixes.md, Issues 2/3;
  // extended for the weights query per plans/2026-07-20-configurable-scoring-weights.md
  // so the card never jumps from default-weighted -> custom-weighted).
  // `isLoading` (React Query v5: isPending && isFetching) is true only during
  // a query's first fetch with no cached data yet — exactly "still pending",
  // distinct from "resolved with no usable data" (which the subscore
  // useMemos above already handle via a neutral-5 fallback, unchanged).
  // Holding the composite card back until every query has resolved at least
  // once prevents it from ever rendering a composite/SubscoreBand figure
  // built from a still-loading dimension's (or still-default) fallback value.
  const isLoading =
    chartQ.isLoading ||
    fundamentalsQ.isLoading ||
    analystQ.isLoading ||
    intrinsicQ.isLoading ||
    newsQ.isLoading ||
    weightsQ.isLoading;

  const insights: string[] = [];
  if (chartQ.data?.indicators?.signal) {
    insights.push(`Technical: ${String(chartQ.data.indicators.signal).replace(/_/g, " ")}`);
  }
  if (fundamentalsQ.data?.score?.interpretation) {
    insights.push(`Fundamentals: ${fundamentalsQ.data.score.interpretation}`);
  }
  if (analystQ.data?.scoreInterpretation) {
    insights.push(`Analysts: ${analystQ.data.scoreInterpretation}`);
  }
  if (typeof intrinsicQ.data?.upsidePercent === "number") {
    insights.push(
      `Intrinsic value suggests ${intrinsicQ.data.upsidePercent >= 0 ? "upside" : "downside"} of ${Math.abs(intrinsicQ.data.upsidePercent).toFixed(1)}%`
    );
  }
  if (typeof sentimentScore === "number") {
    insights.push(`News & sentiment score: ${sentimentScore.toFixed(1)}/10`);
  }

  const verdictStamp = composite.action;

  const dimensionItems = [
    { label: "Technical", score: technicalScore },
    { label: "Fundamental", score: fundamentalScore },
    { label: "Analysts", score: analystScore },
    { label: "Intrinsic", score: intrinsicScore },
    { label: "Sentiment", score: sentimentScore },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card px-7 py-6">
        <DetailPriceChart symbol={symbol} period="1Y" currency={currency} />
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-mut">
          Loading overview…
        </div>
      ) : (
        <HeadlineScoreCard
          kicker="Overview & composite score"
          metaKicker={hasCustomWeights ? "Your weighting · updated daily" : "Meridian rating · updated daily"}
          score={composite.score}
          verdictStamp={verdictStamp}
          leftExtra={
            <div className="mt-4 text-[10.5px] uppercase tracking-[0.12em] text-mut">
              Momentum + quality
            </div>
          }
        >
          <SubscoreBand items={dimensionItems} />

          {insights.length > 0 && (
            <div className="mt-2 border-t border-line2 pt-[18px]">
              <div className="mb-3 text-[10.5px] uppercase tracking-[0.14em] text-mut">Key insights</div>
              <div className="max-w-[680px] font-serif text-[15.5px] leading-[1.55] text-sub">
                {insights.map((insight, i) => (
                  <div
                    key={i}
                    className={i > 0 ? "mt-2.5 flex items-baseline gap-3 border-t border-line2 pt-2.5" : "flex items-baseline gap-3"}
                  >
                    <span className="text-sm text-mut">№{i + 1}</span>
                    <span>{insight}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </HeadlineScoreCard>
      )}
    </div>
  );
}
