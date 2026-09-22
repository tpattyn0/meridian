"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle } from "lucide-react";
import { HeadlineScoreCard } from "@/components/research/headline-score-card";
import { MIN_CONFIDENT_SAMPLE, computeSentimentScore } from "@/lib/utils/research-scores";
import { cn } from "@/lib/utils";

interface NewsArticle {
  id: string;
  title: string;
  summary?: string | null;
  url: string;
  source: string;
  publishedAt: string | Date;
  sentiment?: number | null;
  sentimentLabel?: string | null;
  impact?: string | null;
  relevanceScore?: number | null;
}

interface NewsFeedProps {
  symbol: string;
  companyName?: string;
  articles?: NewsArticle[];
}

function sentimentTag(sentiment: number | null | undefined): { label: string; color: string } {
  if (sentiment === null || sentiment === undefined) return { label: "PENDING", color: "text-mut" };
  if (sentiment > 0.2) return { label: "POSITIVE", color: "text-up" };
  if (sentiment < -0.2) return { label: "NEGATIVE", color: "text-dn" };
  return { label: "NEUTRAL", color: "text-mut" };
}

export function NewsFeed({ symbol, companyName, articles: propArticles }: NewsFeedProps) {
  const { data: fetchedArticles, isLoading } = useQuery({
    queryKey: ["news", symbol, companyName],
    queryFn: async () => {
      const params = new URLSearchParams({ analyze: "true", limit: "20" });
      if (companyName) params.append("name", companyName);

      const res = await fetch(`/api/news/${symbol}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json() as Promise<NewsArticle[]>;
    },
    enabled: !propArticles,
    refetchInterval: 5 * 60 * 1000,
  });

  // No client-side relevance re-filter here (removed NSA-I1): the server
  // already filters every article this component can see to
  // `relevanceScore >= MIN_RELEVANCE` (`news.service.ts`'s
  // `getAnalyzedNewsForSymbol`, the sole source for both the `/api/news/[symbol]`
  // route this component queries and `propArticles` callers), so a second,
  // differently-tuned client-side threshold can only ever disagree with the
  // server, never usefully narrow it further. Memoized (not just `||`-chained)
  // so the `[]` fallback is a stable reference across renders, matching what
  // the `useMemo` below expects of its `[news]` dependency.
  const news = useMemo(() => propArticles || fetchedArticles || [], [propArticles, fetchedArticles]);

  // Shared News & sentiment score derivation (plans/2026-07-24-news-sentiment-accuracy.md,
  // Task 11; review NSA-I1/NSA-I2) — identical function call at all three
  // call sites (this component, overview.tsx, wishlist.service.ts) so they
  // cannot silently diverge. See `computeSentimentScore`'s docstring for the
  // null-sentiment exclusion rule.
  const { score, positivePct, neutralPct, negativePct, analysedCount } = useMemo(() => {
    const result = computeSentimentScore(news);
    const total = result.positiveCount + result.neutralCount + result.negativeCount;
    return {
      score: result.score,
      positivePct: total > 0 ? Math.round((result.positiveCount / total) * 100) : 0,
      neutralPct: total > 0 ? Math.round((result.neutralCount / total) * 100) : 0,
      negativePct: total > 0 ? Math.round((result.negativeCount / total) * 100) : 0,
      analysedCount: result.analysedCount,
    };
  }, [news]);

  // Thin-sample honesty (plans/2026-07-24-news-sentiment-accuracy.md, Task 12,
  // DESIGN.md "Thin-sample honesty"). The WARMING/STEADY/COOLING word is
  // derived from the already-damped `score` — no separate thin-sample
  // vocabulary, so a damped thin-sample score in the 4-7 band already reads
  // "Steady," which is the honest word for it. `trendBanded` is forced false
  // on a thin sample regardless of what the damped score's band would
  // otherwise imply — the kicker's bold `--up` color is reserved for "this is
  // a well-founded reading," which a thin sample is not, by definition.
  const isThinSample = analysedCount > 0 && analysedCount < MIN_CONFIDENT_SAMPLE;
  const trendKicker = score >= 7 ? "Warming" : score >= 4 ? "Steady" : "Cooling";
  const trendBanded = score >= 7 && !isThinSample;

  if (isLoading && !propArticles) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-mut">
        Loading news &amp; sentiment…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeadlineScoreCard
        kicker="News & sentiment"
        metaKicker={`${analysedCount} articles analysed · last 30 days`}
        score={score}
        verdictKicker={trendKicker}
        verdictKickerBanded={trendBanded}
        summary={
          analysedCount === 0
            ? `No recent news coverage found for ${symbol}.`
            : isThinSample
              ? `Sentiment reflects only ${analysedCount} analysed article${analysedCount === 1 ? "" : "s"} — too few for a confident reading. Score shown is weighted toward neutral.`
              : `Sentiment reflects ${analysedCount} analysed articles, weighted by relevance and market impact.`
        }
      >
        <div className="grid grid-cols-3 pt-5">
          <ToneCell label="Positive" pct={positivePct} color="text-up" />
          <ToneCell label="Neutral" pct={neutralPct} color="text-mut" />
          <ToneCell label="Negative" pct={negativePct} color="text-dn" />
        </div>
        {/* MoM delta omitted — TD-DTL-TONE: SentimentHistory lacks a clean prior-30-day baseline. */}
      </HeadlineScoreCard>

      <div className="rounded-lg border border-border bg-card px-7 pb-7 pt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">Latest coverage</div>

        {news.length === 0 ? (
          <div className="mt-5 flex items-center gap-2 font-serif text-[14.5px] italic text-mut">
            <AlertCircle className="h-4 w-4 shrink-0" />
            No recent news found for {symbol}
            {companyName ? ` (${companyName})` : ""}.
          </div>
        ) : (
          <div className="mt-3">
            {news.map((article, i) => {
              const tag = sentimentTag(article.sentiment);
              return (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex cursor-pointer items-baseline justify-between gap-8 py-[18px] hover:bg-fill",
                    i < news.length - 1 && "border-b border-line2"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-serif text-[17px] font-medium leading-[1.35]">{article.title}</div>
                    <div className="mt-1.5 text-[10.5px] uppercase tracking-[0.12em] text-mut">
                      {article.source} · {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                    </div>
                  </div>
                  <span className={cn("shrink-0 whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.14em]", tag.color)}>
                    {tag.label}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ToneCell({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="border-l border-line2 pl-5 first:border-l-0 first:pl-0">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-mut">{label}</div>
      <div className={cn("mt-1.5 font-serif text-[26px]", color)}>{pct}%</div>
    </div>
  );
}
