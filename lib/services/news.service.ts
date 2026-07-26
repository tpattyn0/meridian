import { prisma } from '@/lib/prisma';
import yahooFinance from '@/lib/yahoo-finance';
import NodeCache from 'node-cache';
import * as cheerio from 'cheerio';
import { MIN_RELEVANCE, CORP_SUFFIX, scoreRelevance } from '@/lib/utils/news-relevance';

/**
 * Plan Task 3 (plans/2026-07-24-news-sentiment-accuracy.md, R5): the single
 * time window applied to every DB read of NewsArticle for a symbol — the
 * ingest fetch, and both refresh-latch re-reads. Previously the three
 * disagreed (7 days / unbounded / unbounded) while the UI claimed "last 30
 * days"; this constant makes that claim true.
 */
export const NEWS_WINDOW_DAYS = 30;

/**
 * Plan Task 2 (R1): the refresh latch used to be "fetch upstream only when
 * the DB holds fewer than 2 in-window articles" — once any 2 rows existed,
 * the pipeline never fetched again, permanently. Replaced by a
 * staleness-aware condition: refresh when the DB has fewer than
 * REFRESH_TARGET_ARTICLE_COUNT in-window articles, OR the newest in-window
 * article is older than REFRESH_STALENESS_MS. The existing 5-minute
 * node-cache in fetchNewsForSymbol already bounds upstream call volume, so
 * this cannot become a per-request fetch storm.
 */
export const REFRESH_TARGET_ARTICLE_COUNT = 8;
export const REFRESH_STALENESS_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Plan Task 6: Yahoo hard-caps at 10 regardless of `newsCount`; Google News
 * RSS returns up to 100. The cap, not the sources, is now the binding
 * constraint on how many articles are worth carrying through relevance
 * scoring, dedup, and (eventually) sentiment analysis.
 */
export const MAX_ARTICLES_PER_FETCH = 20;

/** Hard timeout for the Google News RSS fetch (Compass uses 4000ms). */
const RSS_FETCH_TIMEOUT_MS = 4000;

/** Minimum cleaned-title length to be considered real news, not a junk placeholder. */
const MIN_JUNK_TITLE_LENGTH = 8;

/**
 * Plan Task 7: the maximum number of unanalyzed articles submitted to a
 * single batched Gemini sentiment call per getAnalyzedNewsForSymbol
 * invocation — replaces the old Promise.all fan-out capped at 3 individual
 * requests.
 */
export const MAX_ANALYZE_PER_PASS = 10;

interface NewsArticleData {
  title: string;
  summary?: string;
  content?: string;
  url: string;
  source: string;
  author?: string;
  publishedAt: Date;
  imageUrl?: string;
  symbols: string[];
  relevanceScore?: number;
}

export class NewsAggregationService {
  private cache: NodeCache;
  
  constructor() {
    this.cache = new NodeCache({ stdTTL: 300 });
  }
  
  async fetchNewsForSymbol(symbol: string, companyName?: string): Promise<NewsArticleData[]> {
    const cacheKey = `news_${symbol}`;
    const cached = this.cache.get<NewsArticleData[]>(cacheKey);
    
    if (cached) {
        return cached;
    }
    
    try {
        // For Belgian/European stocks, clean the symbol
        const cleanSymbol = symbol.split('.')[0]; // BTLS.BR -> BTLS
        const searchTerms = [cleanSymbol];
        
        // Add company name variations
        if (companyName) {
        searchTerms.push(companyName);
        // For biotech companies, add common terms
        if (companyName.toLowerCase().includes('bio') || 
            companyName.toLowerCase().includes('pharma')) {
            searchTerms.push(`${companyName} biotech`);
            searchTerms.push(`${companyName} pharmaceutical`);
        }
        }
        
        // Try to get news from multiple sources
        const [yahooNews, rssNews] = await Promise.all([
        this.fetchYahooFinanceNews(symbol),
        this.fetchGoogleNewsRSS(symbol, companyName),
        ]);

        let allNews = [...yahooNews, ...rssNews];

        // Dedup before relevance scoring and before the cap, so duplicates
        // cannot consume slots in either (plan Task 4).
        allNews = this.deduplicateNews(allNews);

        // Score relevance with the shared token-based helper (plan Task 5,
        // ADR-30) — replaces literal-substring matching.
        for (const article of allNews) {
          article.relevanceScore = scoreRelevance(article, symbol, companyName);
        }

        // Filter out articles below the single shared threshold, `>=` so an
        // exactly-at-threshold article is kept (plan Task 5).
        const relevantNews = allNews.filter(article =>
        (article.relevanceScore || 0) >= MIN_RELEVANCE
        );

        // If no relevant news found, return empty array instead of generic news
        if (relevantNews.length === 0) {
        this.cache.set(cacheKey, []); // Cache empty result
        return [];
        }

        // Sort by relevance and date
        const sorted = relevantNews.sort((a, b) => {
        const relevanceDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (Math.abs(relevanceDiff) > 0.1) return relevanceDiff;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        });

        // Take only the most relevant articles, after dedup (plan Task 6).
        const topArticles = sorted.slice(0, MAX_ARTICLES_PER_FETCH);

        this.cache.set(cacheKey, topArticles);
        return topArticles;
    } catch (error) {
        console.error('Error fetching news:', error);
        return [];
    }
    }

  private async fetchYahooFinanceNews(symbol: string): Promise<NewsArticleData[]> {
    try {
      // Use the exact symbol for Yahoo Finance
      const result = await yahooFinance.search(symbol, {
        newsCount: 10,
      });
      
      const newsArticles: NewsArticleData[] = [];
      
      if (result.news && Array.isArray(result.news)) {
        result.news.forEach((article) => {
          if (article.title && article.link) {
            newsArticles.push({
              title: article.title,
              summary: (typeof article.summary === 'string' ? article.summary : null) || article.title,
              url: article.link,
              source: article.publisher || 'Yahoo Finance',
              publishedAt: article.providerPublishTime 
                ? new Date(article.providerPublishTime)
                : new Date(),
              imageUrl: article.thumbnail?.resolutions?.[0]?.url,
              symbols: article.relatedTickers || [symbol],
            });
          }
        });
      }
      
      return newsArticles;
    } catch (error) {
      console.error('Yahoo Finance news error:', error);
      return [];
    }
  }

  /**
   * Google News RSS (plan Task 6, ADR-34) — keyless, volume source. Ported
   * from Compass/src/lib/news/rss.ts:85-173 with Meridian-specific changes:
   * source/title read from the <source> element (not guessed from the
   * title), a junk-title guard, and no `summary`/`content` (the RSS
   * <description> is only an anchor tag, not a real snippet).
   *
   * On any non-OK status, timeout, or parse failure, logs once and returns
   * [] so Yahoo still succeeds — must never reject (the caller's
   * Promise.all would reject the whole fetch).
   */
  private async fetchGoogleNewsRSS(symbol: string, companyName?: string): Promise<NewsArticleData[]> {
    const cleanedSymbol = symbol.replace(/\.[A-Z]+$/, '');

    let q: string;
    if (companyName && companyName.toLowerCase() !== cleanedSymbol.toLowerCase()) {
      const shortName = companyName.replace(CORP_SUFFIX, '').replace(/[,\s]+$/, '').trim() || companyName;
      q = cleanedSymbol.length <= 3 ? `"${shortName}" stock` : `"${shortName}" OR ${cleanedSymbol} stock`;
    } else {
      q = `${cleanedSymbol} stock news`;
    }

    const query = encodeURIComponent(q).replace(/%20/g, '+');
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);

    let xml: string;
    try {
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        console.warn(`Google News RSS request failed for ${symbol}: status ${response.status}`);
        return [];
      }

      xml = await response.text();
    } catch (error: unknown) {
      console.error(
        `Google News RSS fetch error for ${symbol}:`,
        error instanceof Error ? (error.name === 'AbortError' ? 'Timeout' : error.message) : error
      );
      return [];
    }

    try {
      const $ = cheerio.load(xml, { xmlMode: true });
      const articles: NewsArticleData[] = [];

      $('item').each((_, el) => {
        const item = $(el);
        const rawTitle = item.find('title').first().text().trim();
        const link = item.find('link').first().text().trim();
        const pubDateText = item.find('pubDate').first().text().trim();
        const source = item.find('source').first().text().trim() || 'Google News';

        if (!rawTitle || !link) return;

        // Strip the exact " - " + <source> suffix, anchored to the actual
        // source text (escaped for regex use) — not a blind last-dash split.
        let title = rawTitle;
        if (source) {
          const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const suffixRe = new RegExp(`\\s-\\s${escapedSource}$`);
          title = rawTitle.replace(suffixRe, '').trim();
        }

        // Junk-title guard: drop empty, too-short, or all-caps
        // underscore-placeholder titles (e.g. the observed literal
        // "META_TITLE_QUOTE").
        const isPlaceholderShape = /^[A-Z0-9_]+$/.test(title) && title.includes('_');
        if (!title || title.length < MIN_JUNK_TITLE_LENGTH || isPlaceholderShape) {
          return;
        }

        const publishedAt = pubDateText ? new Date(pubDateText) : new Date();

        articles.push({
          title,
          url: link,
          source,
          publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
          symbols: [symbol],
        });
      });

      return articles;
    } catch (error) {
      console.error(`Google News RSS parse error for ${symbol}:`, error);
      return [];
    }
  }

  private deduplicateNews(articles: NewsArticleData[]): NewsArticleData[] {
    // Two sets, not one (plan Task 4 — the previous version mixed
    // normalized-title keys and raw URLs in a single set, which is not a
    // correctness bug on its own but conflates two different identity
    // spaces). Normalized title is the load-bearing key: Google News RSS
    // <link> values are always news.google.com redirect URLs, never the
    // publisher's canonical URL, so a Yahoo article and its RSS-sourced
    // duplicate can never collide on URL. The URL set is kept as a cheap
    // exact-dupe guard within a single source.
    const seenTitles = new Set<string>();
    const seenUrls = new Set<string>();
    const unique: NewsArticleData[] = [];

    for (const article of articles) {
      const titleKey = article.title.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 50);

      if (seenTitles.has(titleKey) || seenUrls.has(article.url)) {
        continue;
      }
      seenTitles.add(titleKey);
      seenUrls.add(article.url);
      unique.push(article);
    }

    return unique;
  }

  async saveArticlesToDatabase(articles: NewsArticleData[]): Promise<void> {
    for (const article of articles) {
      try {
        await prisma.newsArticle.upsert({
          where: { url: article.url },
          update: {
            title: article.title,
            summary: article.summary,
            content: article.content,
            source: article.source,
            author: article.author,
            publishedAt: article.publishedAt,
            imageUrl: article.imageUrl,
            symbols: article.symbols,
            relevanceScore: article.relevanceScore,
            updatedAt: new Date(),
          },
          create: {
            title: article.title,
            summary: article.summary,
            content: article.content,
            url: article.url,
            source: article.source,
            author: article.author,
            publishedAt: article.publishedAt,
            imageUrl: article.imageUrl,
            symbols: article.symbols,
            relevanceScore: article.relevanceScore,
          },
        });
      } catch (error) {
        console.error('Error saving article:', article.title, error);
      }
    }
  }

  /**
   * DB-first fetch of relevant, sentiment-analyzed articles for a symbol —
   * refreshes from upstream sources if the cache is thin, and runs sentiment
   * analysis (Gemini, if configured) on a batch of unanalyzed articles.
   *
   * Extracted from app/api/news/[symbol]/route.ts (AUD-05, 2026-07-17 audit)
   * so callers running server-side (e.g. wishlist scoring) can get the same
   * data without an HTTP round-trip to their own route.
   */
  async getAnalyzedNewsForSymbol(
    symbol: string,
    options: { companyName?: string; limit?: number; analyze?: boolean } = {}
  ) {
    const { companyName, limit = 20, analyze = true } = options;

    const windowStart = new Date(Date.now() - NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const whereClause = {
      symbols: { has: symbol },
      publishedAt: { gte: windowStart },
      relevanceScore: { gte: MIN_RELEVANCE },
    };

    let articles = await prisma.newsArticle.findMany({
      where: whereClause,
      orderBy: [{ relevanceScore: 'desc' }, { publishedAt: 'desc' }],
      take: limit,
    });

    // Plan Task 2 (R1): refresh when the DB has fewer than
    // REFRESH_TARGET_ARTICLE_COUNT in-window articles, OR the newest
    // in-window article (by publishedAt, independent of the
    // relevance-first sort above) is older than REFRESH_STALENESS_MS — not
    // the old "< 2, then never again" latch. The 5-minute node-cache in
    // fetchNewsForSymbol already bounds upstream call volume.
    const newestPublishedAtMs =
      articles.length > 0
        ? Math.max(...articles.map((a) => new Date(a.publishedAt).getTime()))
        : null;
    const isStale = newestPublishedAtMs === null || Date.now() - newestPublishedAtMs > REFRESH_STALENESS_MS;
    const needsRefresh = articles.length < REFRESH_TARGET_ARTICLE_COUNT || isStale;

    if (needsRefresh) {
      const freshNews = await this.fetchNewsForSymbol(symbol, companyName);
      const relevantNews = freshNews.filter(
        (article) => (article.relevanceScore || 0) >= MIN_RELEVANCE
      );

      if (relevantNews.length > 0) {
        await this.saveArticlesToDatabase(relevantNews);
      }

      articles = await prisma.newsArticle.findMany({
        where: whereClause,
        orderBy: [{ relevanceScore: 'desc' }, { publishedAt: 'desc' }],
        take: limit,
      });
    }

    if (articles.length === 0) {
      return [];
    }

    if (analyze && process.env.GEMINI_API_KEY) {
      const unanalyzedArticles = articles.filter((a) => a.sentiment === null);

      if (unanalyzedArticles.length > 0) {
        const articlesToAnalyze = unanalyzedArticles.slice(0, MAX_ANALYZE_PER_PASS);

        // Lazy import avoids a hard module-scope dependency on
        // GEMINI_API_KEY for every caller of news.service.ts (see AGENT.md
        // fragile surfaces — sentiment.service throws at import time if the
        // key is unset).
        const { sentimentService } = await import('./sentiment.service');

        // Plan Task 7: a single batched Gemini call for up to
        // MAX_ANALYZE_PER_PASS articles, replacing the old Promise.all
        // fan-out of up-to-3 individual requests. Plan Task 9: a failed
        // batch (every model in the chain failed, or the response could not
        // be parsed) leaves every article unanalyzed — never writes a
        // fabricated neutral sentiment.
        const batchResult = await sentimentService.analyzeSentimentBatch(
          articlesToAnalyze.map((article) => ({
            id: article.id,
            title: article.title,
            content: article.summary || article.content,
            symbol: article.symbols[0],
          }))
        );

        if (batchResult.ok) {
          await Promise.all(
            articlesToAnalyze.map(async (article) => {
              const result = batchResult.results.get(article.id);
              // An article whose id is absent from the response (or the
              // whole batch failed) stays null (unanalyzed) — never
              // defaulted to neutral (plan Task 7/9, ADR-31).
              if (!result) return;
              try {
                await prisma.newsArticle.update({
                  where: { id: article.id },
                  data: {
                    sentiment: result.sentiment,
                    sentimentLabel: result.sentimentLabel,
                    confidence: result.confidence,
                    impact: result.impact,
                    aiSummary: result.aiSummary,
                    keyPoints: result.keyFactors,
                  },
                });
              } catch (error) {
                console.error(`Failed to persist sentiment for article ${article.id}:`, error);
              }
            })
          );
        } else {
          console.error(
            `Batch sentiment analysis failed for symbol ${symbol} (${articlesToAnalyze.length} articles) — leaving them unanalyzed.`
          );
        }

        articles = await prisma.newsArticle.findMany({
          where: whereClause,
          orderBy: [{ relevanceScore: 'desc' }, { publishedAt: 'desc' }],
          take: limit,
        });
      }
    }

    return articles;
  }
}

export const newsService = new NewsAggregationService();