# future_ideas.md

Aspirational / not-yet-built ideas only. Do not treat anything here as implemented or committed — see `PRODUCT.md` for implemented reality.

(No open items as of 2026-07-18 — the dashboard hero chart's hover crosshair + y-axis price labels, previously tracked here, shipped in `plans/2026-07-18-meridian-dashboard-detail-fixes.md` Tasks 2-3; see `components/portfolio-chart.tsx` and DESIGN.md "Dashboard SVG performance chart".)

Captured 2026-07-18 from a feature-brainstorm session. Ordering within each section is rough priority, not commitment. Items marked (TD-…) have a corresponding TECH_DEBT.md entry where the UI or data path is already partially scaffolded.

## Owner-requested

- **Stock screener.** A list of top-scoring stocks filtered by market, market cap, sector, etc. — surfacing stocks interesting for the user's investment style using the scoring engine that already exists (technical, fundamental, analyst, sentiment, intrinsic value). Extensible to letting a user compose their own index or tracker from a screen's results.
- **Configurable scoring weights.** Make an asset's composite score configurable to reflect the user's investing style: adjust the top-level weights (fundamental vs technical vs analyst vs sentiment vs intrinsic value), and one level deeper the intra-category weights (e.g. valuation vs profitability vs growth vs financial health within the fundamental score).

## Highest leverage — activation & GTM

- **Broker transaction import (CSV first).** Parsers for DeGiro, Interactive Brokers, and Trading212 exports (EU-first, matching GTM.md's EUR positioning) to remove the manual-entry cliff at onboarding. Directly serves the GTM activation metric ("adds ≥1 position").
- **Benchmark comparison.** Overlay S&P 500 / MSCI World / a custom ticker on the portfolio performance chart, with alpha per time range — "did I actually beat the index?". Yahoo Finance already provides the data; the SVG chart infrastructure exists.
- **Dividend tracking.** Dividend income history, yield-on-cost per position, forward income calendar. Requires extending the `Transaction.type` schema beyond BUY/SELL — the transactions UI already anticipates a DIVIDEND badge type (TD-DTL-TXTYPE).
- **Alerts + weekly email digest.** Email alerts on wishlist target-price hits (currently flagged only in-app), technical signal changes on holdings, and sentiment swings; plus a weekly portfolio digest that doubles as GTM.md's owned email channel.

## Deepens the moat — research that knows your portfolio

- **Portfolio risk & allocation analysis.** Sector / geography / currency exposure breakdowns with concentration warnings, sourced from Yahoo's `assetProfile` per holding. Analysis-not-advice compliant.
- **"Ask your portfolio" AI chat.** Gemini chat grounded in the user's actual positions, transactions, and computed research scores. Flagship paid-tier candidate.
- **Earnings calendar.** Upcoming earnings dates for holdings and wishlist items, surfaced on the dashboard. Cheap via Yahoo calendar data; builds a daily-check habit.
- **Signal track record / backtesting.** Show how the 7-level technical signal and intrinsic-value ratings would have performed historically. Doubles as methodology-transparency marketing content for the HN/Reddit audience.

## Already scaffolded — UI waiting for data (see TECH_DEBT.md)

- Bear/base/bull scenario band on the intrinsic-value tab (TD-DTL-SCEN).
- Analyst price-target low/high + recent upgrades/downgrades (TD-DTL-TGT, TD-DTL-REV).
- Real peer comparison — populate `IndustryComparison` (TD-13, TD-DTL-PEER).
- Support/resistance reference lines on the technical chart (TD-DTL-SR).

## Deferred technical consolidation

- **Consolidate `/portfolio/[ticker]` and `/research/[symbol]` into one route (Option A).** Logged 2026-07-19 per `plans/2026-07-19-positions-tab.md` OD-1, resolved as Option B for that plan (keep both routes, align their behaviour — see ADR-18). The two routes still duplicate header/tab scaffolding; a future pass could redirect `/portfolio/[ticker]` → `/research/[symbol]` and migrate the Buy more / Sell / Delete actions into the research view's Positions tab, collapsing to one detail route entirely. Larger change than Option B: touches the mutation flows and the dashboard/closed-positions link targets, and risks the fragile sell/FIFO surfaces (`AGENT.md` known fragile surfaces) — deliberately deferred rather than attempted alongside the Positions-tab rename.

## Prerequisites before any paid launch (not features, but gating)

- Product analytics instrumentation (signup / first-position / first-analysis events) — GTM.md launch KPIs are unmeasurable without it.
- Quota / billing / entitlements — the free-tier research quota in GTM.md is strategy-only today.
- TD-02 (shared dev/prod database) explicitly blocks a production deploy. TD-01 (live NewsAPI key in git history) no longer blocks a deploy as of 2026-07-24 (ADR-33, `plans/2026-07-24-news-sentiment-accuracy.md`) — NewsAPI was removed entirely, so nothing in the app can spend the exposed quota; the key remains live and public in history regardless.

## News & sentiment

- **Native per-article sentiment via a paid provider (e.g. EODHD).** Considered and explicitly rejected by the owner during `plans/2026-07-24-news-sentiment-accuracy.md` — the current pass replaces NewsAPI with keyless Google News RSS + Gemini-based sentiment scoring, no paid sources. A provider with built-in per-article sentiment (polarity/neg/neu/pos scores, as Compass's `RawArticle.sentiment` shape anticipates) could reduce reliance on LLM-based scoring and its associated latency/cost/model-availability risk, but is out of scope until the owner revisits it.
