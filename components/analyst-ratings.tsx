"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { HeadlineScoreCard } from "@/components/research/headline-score-card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/format";
import { analystVerdictLabel } from "@/lib/utils/research-scores";

export interface AnalystRevisionData {
  firm: string;
  action: string;
  fromGrade: string | null;
  toGrade: string | null;
  date: string;
}

export interface AnalystRatingsData {
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
  revisions: AnalystRevisionData[];
}

/**
 * Maps Yahoo's `upgradeDowngradeHistory` action vocabulary (up/down/main/
 * init/reit) to the DESIGN.md RAISED/HELD/LOWERED tag vocabulary. "main"
 * (reiterated at the same grade) and "init" (new coverage) both read as
 * "HELD" — neither raised nor lowered an existing rating.
 */
function revisionTag(action: string): { label: string; className: string } {
  switch (action.toLowerCase()) {
    case "up":
      return { label: "RAISED", className: "text-up" };
    case "down":
      return { label: "LOWERED", className: "text-dn" };
    default:
      return { label: "HELD", className: "text-mut" };
  }
}

interface AnalystRatingsProps {
  symbol: string;
  currentPrice?: number;
  initialData?: AnalystRatingsData;
  currency?: string;
}

const DISTRIBUTION_ROWS = [
  { key: "strongBuy", label: "Strong buy", color: "bg-up" },
  { key: "buy", label: "Buy", color: "bg-up" },
  { key: "hold", label: "Hold", color: "bg-amber" },
  { key: "sell", label: "Sell", color: "bg-dn" },
  { key: "strongSell", label: "Strong sell", color: "bg-dn" },
] as const;

export function AnalystRatings({ symbol, currentPrice, initialData, currency }: AnalystRatingsProps) {
  const [ratings, setRatings] = useState<AnalystRatingsData | null>(initialData || null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRatings = async () => {
      if (initialData) return;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/market/analyst-ratings/${encodeURIComponent(symbol)}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch analyst ratings: ${response.statusText}`);
        }
        const data = await response.json();
        setRatings(data);
      } catch (err) {
        console.error("Error fetching analyst ratings:", err);
        setError(err instanceof Error ? err.message : "Failed to load analyst ratings");
      } finally {
        setIsLoading(false);
      }
    };

    fetchRatings();
  }, [symbol, initialData]);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-mut">
        Loading analyst ratings…
      </div>
    );
  }

  if (error || !ratings) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-mut">
        <AlertCircle className="mr-2 h-4 w-4" />
        {error || "Failed to load analyst ratings"}
      </div>
    );
  }

  const totalRatings = ratings.strongBuy + ratings.buy + ratings.hold + ratings.sell + ratings.strongSell;

  let priceDifference: { value: number; formatted: string } | null = null;
  if (currentPrice && ratings.targetPrice) {
    const diff = ((ratings.targetPrice - currentPrice) / currentPrice) * 100;
    priceDifference = { value: diff, formatted: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%` };
  }

  // SCM-P1-I1: derive from the shared helper (matches the service's own
  // getScoreInterpretation boundaries) rather than a second inline copy of
  // the thresholds, so the headline stamp cannot drift from the service's
  // interpretation string again.
  const verdictLabel = analystVerdictLabel(ratings.score);

  return (
    <div className="space-y-5">
      <HeadlineScoreCard
        kicker="Analyst ratings"
        metaKicker={`${totalRatings} analysts · last 90 days`}
        score={ratings.score}
        verdictStamp={verdictLabel}
        leftExtra={
          <div className="mt-4 text-[10.5px] uppercase tracking-[0.12em] text-mut">Street consensus</div>
        }
      >
        <div className="space-y-3">
          {DISTRIBUTION_ROWS.map((row) => {
            const count = ratings[row.key];
            const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0;
            return (
              <div key={row.key} className="flex items-center gap-4">
                <div className="w-24 shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-mut">{row.label}</div>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                  <div className={cn("h-full rounded-full", row.color)} style={{ width: `${pct}%` }} />
                </div>
                <div className="w-6 shrink-0 text-right text-[12.5px] text-sub">{count}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-3 border-t border-line pt-5">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-mut">Low</div>
            <div className="mt-1.5 font-serif text-[26px] text-dn">
              {ratings.targetLowPrice ? formatCurrency(ratings.targetLowPrice, currency) : "—"}
            </div>
          </div>
          <div className="border-l border-line2 pl-5">
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-mut">Median</div>
            <div className="mt-1.5 font-serif text-[26px]">
              {ratings.targetPrice ? formatCurrency(ratings.targetPrice, currency) : "—"}
            </div>
            {priceDifference && (
              <div className={cn("mt-0.5 text-[12.5px]", priceDifference.value >= 0 ? "text-up" : "text-dn")}>
                {priceDifference.formatted} {priceDifference.value >= 0 ? "upside" : "downside"}
              </div>
            )}
          </div>
          <div className="border-l border-line2 pl-5">
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-mut">High</div>
            <div className="mt-1.5 font-serif text-[26px] text-up">
              {ratings.targetHighPrice ? formatCurrency(ratings.targetHighPrice, currency) : "—"}
            </div>
          </div>
        </div>
      </HeadlineScoreCard>

      <div className="rounded-lg border border-border bg-card px-7 pb-7 pt-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">Recent revisions</div>
        {ratings.revisions.length === 0 ? (
          <p className="mt-5 font-serif text-[14.5px] italic text-mut">
            No analyst revisions in the last 90 days.
          </p>
        ) : (
          <table className="mt-5 w-full border-collapse text-[13.5px]">
            <tbody>
              {ratings.revisions.map((rev, i) => {
                const tag = revisionTag(rev.action);
                return (
                  <tr
                    key={`${rev.firm}-${rev.date}-${i}`}
                    className={cn(i < ratings.revisions.length - 1 && "border-b border-line2")}
                  >
                    <td className="py-[15px] font-serif">{rev.firm}</td>
                    <td className="py-[15px] text-sub">
                      {rev.fromGrade && rev.toGrade ? `${rev.fromGrade} → ${rev.toGrade}` : rev.toGrade || "—"}
                    </td>
                    <td className={cn("py-[15px] text-right text-[10.5px] font-semibold uppercase tracking-[0.14em]", tag.className)}>
                      {tag.label}
                    </td>
                    <td className="py-[15px] text-right text-mut">
                      {new Date(rev.date).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
