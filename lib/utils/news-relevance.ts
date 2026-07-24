/**
 * Token-based, word-boundary relevance scoring for news articles against a
 * stock symbol + company name — extracted from `news.service.ts`'s
 * `calculateRelevance` (plans/2026-07-24-news-sentiment-accuracy.md, Task 5,
 * ADR-30). Pure, exported, unit-testable: no DOM, no Prisma, no network.
 *
 * Replaces literal-substring matching (`companyName` matched as an exact
 * substring, e.g. "Alphabet Inc." never matching "Alphabet slides…") with
 * token derivation (corporate-suffix stripping) + word-boundary regex
 * matching, and adds share-class-aware ticker normalization (GOOG credits a
 * GOOGL request).
 *
 * `MIN_RELEVANCE` is the single threshold used by both the ingest filter and
 * every DB read in news.service.ts — eliminating the old `>0.4` / `>=0.5`
 * split. Comparisons must use `>=` so an exactly-at-threshold article is kept.
 */

/**
 * Corporate-entity suffixes to strip when deriving a company's distinctive
 * "core" token — ported verbatim from Compass (`src/lib/news/rss.ts:93`),
 * which is materially more complete than a hand-rolled version: it covers
 * `S.A.`, `société anonyme`, `N.V.`, `Oyj`, `ASA`, `AB`, `SE`, `plc`, `AG`,
 * `SpA` — relevant here because Meridian has Belgian/European tickers
 * (`BTLS.BR` appears in the current code).
 */
export const CORP_SUFFIX =
  /\b(s\.?a\.?|société anonyme|societe anonyme|n\.?v\.?|inc\.?|corp\.?|corporation|holdings?|group|company|co\.?|plc|ag|ltd\.?|limited|se|spa|ab|oyj|asa)\b/gi;

/** Single relevance threshold shared by the ingest filter and all DB reads (ADR-30). */
export const MIN_RELEVANCE = 0.4;

/**
 * Derives the match tokens for a symbol + optional company name: the raw
 * symbol, the exchange-stripped symbol, and the company name reduced to its
 * distinctive core by stripping corporate suffixes. Tokens are lowercased
 * and de-duplicated; tokens shorter than 2 characters are dropped (too
 * noisy for a word-boundary match).
 */
export function deriveMatchTokens(symbol: string, companyName?: string): string[] {
  const tokens = new Set<string>();

  const rawSymbol = symbol.trim().toLowerCase();
  if (rawSymbol.length >= 2) tokens.add(rawSymbol);

  const cleanSymbol = symbol.split('.')[0].trim().toLowerCase();
  if (cleanSymbol.length >= 2) tokens.add(cleanSymbol);

  if (companyName) {
    const core = companyName
      .replace(CORP_SUFFIX, '')
      // Strip trailing punctuation left behind by suffix removal (e.g.
      // "Alphabet Inc." -> "Alphabet ." after CORP_SUFFIX strips "Inc",
      // since the orphaned "." is neither a comma nor whitespace and
      // survived the old /[,\s]+$/ trim) and collapse the internal
      // whitespace the removal leaves (NSA-Q-derived fix, regression review
      // 2026-07-24: deriveMatchTokens('GOOGL', 'Alphabet Inc.') previously
      // returned the junk token "alphabet .").
      .replace(/[,.\s]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (core.length >= 2) tokens.add(core);

    // Also add the individual words of the core name (>2 chars each) so a
    // multi-word company name ("Alphabet Inc.") still matches via its most
    // distinctive single word ("alphabet") even if the exact-phrase core
    // itself doesn't appear verbatim in a headline.
    core
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .forEach((w) => tokens.add(w));
  }

  return Array.from(tokens);
}

/** Escapes a string for safe interpolation into a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary test: does `token` appear as a whole word in `text`? */
function matchesWordBoundary(text: string, token: string): boolean {
  if (!token) return false;
  const escaped = escapeRegExp(token);
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(text);
}

/**
 * Strips a trailing exchange suffix (e.g. `.BR`, `.L`) for comparison —
 * NOT the dual-class share-letter handling (NSA-S3 correction: this
 * function's name/behaviour previously disagreed with a docstring claiming
 * it stripped "a single trailing letter"; it only ever stripped a
 * `.`-prefixed exchange suffix via `/\.[A-Z]+$/`). Share-class letter
 * normalization (GOOG <-> GOOGL) is `isTrailingClassVariant`'s job, below —
 * this function only removes the leading-dot exchange-code part so two
 * tickers on different exchange suffixes can still compare their roots.
 */
function stripExchangeSuffix(sym: string): string {
  return sym.trim().toUpperCase().replace(/\.[A-Z]+$/, '');
}

/**
 * True if `candidateTicker` (from an article's related-tickers list) should
 * credit a relevance match for `requestedSymbol`. Handles exact match and
 * conservative share-class normalization (GOOG <-> GOOGL): the two are
 * considered equivalent only when one is exactly the other with a single
 * trailing class letter added/removed.
 */
/** Trailing letters recognized as real dual-class share suffixes (e.g. GOOGL, BRK.B's "B"). */
const KNOWN_CLASS_LETTERS = new Set(["A", "B", "C", "K", "L"]);

export function tickerCreditsSymbol(candidateTicker: string, requestedSymbol: string): boolean {
  const a = stripExchangeSuffix(candidateTicker);
  const b = stripExchangeSuffix(requestedSymbol);
  if (a === b) return true;

  const isTrailingClassVariant = (longer: string, shorter: string) =>
    longer.length === shorter.length + 1 &&
    longer.startsWith(shorter) &&
    KNOWN_CLASS_LETTERS.has(longer[longer.length - 1]);

  if (a.length > b.length) return isTrailingClassVariant(a, b);
  if (b.length > a.length) return isTrailingClassVariant(b, a);
  return false;
}

export interface RelevanceInput {
  title: string;
  summary?: string | null;
  content?: string | null;
  symbols?: string[];
}

/**
 * Per-field score bands (regression fix, review 2026-07-24 manual-check
 * finding). The original scorer added one of these amounts **per matching
 * token**, so a title containing both the ticker token ("googl") and the
 * company-core token ("alphabet") — a completely ordinary shape for
 * ticker-stuffed boilerplate like a 13F filing notice — scored
 * `0.5 + 0.5 = 1.0` before the symbols bonus was even added. Nearly every
 * article converged on the 1.0 ceiling, which collapsed news.service.ts's
 * relevance-then-recency sort (a >0.1 gap is required to prefer relevance)
 * into pure recency — and a continuously-publishing boilerplate source
 * (MarketBeat 13F notices) crowded out real reporting.
 *
 * Each field now contributes **at most its own band regardless of how many
 * tokens hit** — multiple token matches in the same field no longer stack.
 * This preserves the intended ordering (title > summary > content, symbols
 * array match a solid bonus) while spreading scores across the range instead
 * of piling at 1.00.
 */
const TITLE_MATCH_SCORE = 0.5;
const SUMMARY_MATCH_SCORE = 0.2;
const CONTENT_MATCH_SCORE = 0.1;
const SYMBOLS_MATCH_SCORE = 0.3;

/**
 * Boilerplate-title demotion (plan regression fix, review 2026-07-24).
 * Institutional-holdings / 13F filing-notice headlines ("Nwam LLC Buys
 * 8,055 Shares of Alphabet Inc. $GOOGL", "Alphabet Inc. $GOOGL Shares Sold
 * by Bryn Mawr Trust Advisors LLC", "Boosts Stock Position in...", "Grows
 * Stake in...", "Has $1.2 Million Stake in...") are technically on-topic —
 * they legitimately mention the company and ticker — but are near-worthless
 * for sentiment: they report routine 13F portfolio rebalancing, not news,
 * and a handful of publishers (MarketBeat chief among them) emit them
 * continuously, so left unchecked they crowd out genuine reporting purely
 * by publishing volume once the saturation fix above stops them tying at
 * 1.0 with everything else.
 *
 * Matched narrowly on title *shape* (an institutional/fund-sounding actor
 * name combined with a holdings verb and a share/stake noun), not on the
 * mere presence of a share count or dollar figure — a headline like
 * "Company raises 2025 guidance, adds 500 jobs" must not be caught by this.
 */
const BOILERPLATE_TITLE_PATTERNS: RegExp[] = [
  // "X (LLC|Inc|Trust|Advisors|Group|Capital|Management|...) Buys/Sells/Acquires/Purchases
  // N Shares of ..." — the share count can appear either before "Shares"
  // ("Buys 8,055 Shares of") or after "Shares of" ("Acquires Shares of
  // 4,494 Alphabet Inc.", the live MarketBeat variant that motivated
  // widening this from a single fixed word order).
  /\b(buys|sells|acquires|purchases)\s([\d,.]+\s(shares|stake)\s(of|in)|shares\sof\s[\d,.]+)\b/i,
  // "... Shares Sold by X" / "... Shares Bought by X" / "... Shares Acquired by X"
  /\bshares\s(sold|bought|acquired|purchased)\sby\b/i,
  // "Boosts/Grows/Trims/Cuts/Reduces/Raises/Lowers Stock Position in/Stake in ..."
  /\b(boosts|grows|trims|cuts|reduces|raises|lowers|increases|decreases)\s(its\s)?(stock\s)?(position|holdings|stake)\s(in|by)\b/i,
  // "Has $N (Million|Billion) Stake in ..." / "Holds $N Million Position in ..."
  /\bhas\s\$[\d,.]+\s(million|billion|thousand)\s(stake|position|holdings)\s(in|of)\b/i,
];

/** Multiplier applied to the whole score when the title matches a boilerplate 13F-style shape. */
const BOILERPLATE_DEMOTION_FACTOR = 0.5;

function isBoilerplateFilingTitle(title: string): boolean {
  return BOILERPLATE_TITLE_PATTERNS.some((re) => re.test(title));
}

/**
 * Scores one article's relevance to `symbol`/`companyName` on a 0..1 scale,
 * token-based and word-boundary matched (not literal substring). Mirrors the
 * old weighting shape (title match to be worth more than summary, symbol
 * array match a solid bonus) but on tokens instead of raw search terms, and
 * caps each field's contribution so multiple token matches within one field
 * cannot stack past that field's band (see the saturation-fix comment
 * above). A 13F/institutional-holdings-filing-shaped title is demoted after
 * the base score is computed — it is still relevant, just deprioritized.
 */
export function scoreRelevance(
  article: RelevanceInput,
  symbol: string,
  companyName?: string
): number {
  const tokens = deriveMatchTokens(symbol, companyName);
  const titleText = article.title || '';
  const summaryText = article.summary || '';
  const contentText = article.content || '';

  const titleMatches = tokens.some((token) => matchesWordBoundary(titleText, token));
  const summaryMatches = tokens.some((token) => matchesWordBoundary(summaryText, token));
  const contentMatches = tokens.some((token) => matchesWordBoundary(contentText, token));

  let score = 0;
  if (titleMatches) score += TITLE_MATCH_SCORE;
  if (summaryMatches) score += SUMMARY_MATCH_SCORE;
  if (contentMatches) score += CONTENT_MATCH_SCORE;

  if (article.symbols?.some((s) => tickerCreditsSymbol(s, symbol))) {
    score += SYMBOLS_MATCH_SCORE;
  }

  if (score > 0 && isBoilerplateFilingTitle(titleText)) {
    score *= BOILERPLATE_DEMOTION_FACTOR;
  }

  return Math.max(0, Math.min(1, score));
}
