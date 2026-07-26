// lib/services/sentiment.service.ts
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { GEMINI_MODELS, createGeminiClient } from '@/lib/services/gemini';
import { extractValidJsonArray } from '@/lib/services/gemini-json';

interface SentimentResult {
  sentiment: number;        // -1 to 1
  sentimentLabel: string;   // negative, neutral, positive
  confidence: number;       // 0 to 1
  keyFactors: string[];
  impact: 'low' | 'medium' | 'high';
  aiSummary?: string;
}

/** One article to submit to a batched sentiment analysis pass. */
export interface BatchArticleInput {
  /** Stable string id (art_0, art_1, …) — results are matched back by id, never array position. */
  id: string;
  title: string;
  content: string | null;
  symbol?: string;
}

/**
 * Result of a batch sentiment pass: a map from the input article's `id` to
 * its result, or `null` if the model omitted that id from its response
 * (never defaulted to neutral — plan Task 7/ADR-31). `ok: false` means every
 * model in the GEMINI_MODELS chain failed the request or the response could
 * not be parsed at all — callers must leave every article unanalysed
 * (`sentiment: null`), never write a fabricated neutral (plan Task 9/ADR-31).
 */
export type BatchSentimentResult =
  | { ok: true; results: Map<string, SentimentResult | null> }
  | { ok: false };

/**
 * responseSchema for the batched sentiment call, built with the SDK's
 * SchemaType enum (lowercase string values — "array"/"object"/"string"/
 * "number") — NOT Compass's raw uppercase 'ARRAY' strings, which are the
 * REST wire format and do not match this SDK's TypeScript types (verified
 * against node_modules/@google/generative-ai/dist/generative-ai.d.ts,
 * plans/2026-07-24-news-sentiment-accuracy.md Task 7).
 */
const BATCH_SENTIMENT_SCHEMA: Schema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      id: { type: SchemaType.STRING },
      sentiment: { type: SchemaType.NUMBER },
      sentimentLabel: { type: SchemaType.STRING, format: 'enum', enum: ['negative', 'neutral', 'positive'] },
      confidence: { type: SchemaType.NUMBER },
      keyFactors: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      impact: { type: SchemaType.STRING, format: 'enum', enum: ['low', 'medium', 'high'] },
      aiSummary: { type: SchemaType.STRING, nullable: true },
    },
    required: ['id', 'sentiment', 'sentimentLabel', 'confidence', 'impact'],
  },
};

/**
 * Calibration anchors + selectivity rule (plan Task 10) — carried into the
 * batch prompt. RSS items are title-only (no usable snippet, Task 6), so
 * the prompt must not imply body text will always be present. Exported for
 * a direct unit-test guard against silent prompt loss.
 */
export function buildBatchPrompt(articles: BatchArticleInput[]): string {
  const payload = articles.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content || undefined,
    symbol: a.symbol,
  }));

  return `You are an expert financial analyst. Analyze the sentiment of each of these financial news articles for stock market impact. Some articles have only a title and no body content — that is expected; score them on the title alone rather than assuming missing information.

For each article, tagged with an "id", provide:
- "sentiment": a number between -1 (very bearish) and 1 (very bullish), 0 is neutral. The sentiment of a price-move article MUST follow the direction of the move described (e.g. an article about a stock falling on bad news is negative, regardless of upbeat phrasing elsewhere in the headline).
- "sentimentLabel": "negative", "neutral", or "positive", consistent with the sentiment number.
- "confidence": a number between 0 and 1 — how certain you are, given the information available.
- "keyFactors": a short list of the key factors driving the sentiment.
- "impact": "low", "medium", or "high" — the news's market MATERIALITY, not the article's tone. A calm-toned but structurally important disclosure (e.g. a guidance cut) is high impact; an excited-toned but inconsequential item is low impact.
- "aiSummary": an optional brief 1-2 sentence summary of the market impact.

Calibration anchors — use these as fixed reference points, not just relative ranking:
- Routine analyst-target commentary and syndicated promotional coverage (e.g. "could surge X%" round-ups, generic "outperforms its peers" pieces) -> mild sentiment, roughly ±0.2 to ±0.4, and typically low-to-medium impact.
- Genuine company-specific earnings, guidance, or regulatory news with concrete facts -> strong sentiment, roughly ±0.6 to ±0.9.
- Reserve ±0.9 or beyond for major surprises (e.g. a large guidance miss/beat, an M&A announcement, a regulatory ruling with material financial consequences).

Selectivity rule: be selective about which articles you treat as significant. Vague or clickbait titles with no concrete facts (a specific figure, a ruling, a named event) stated should be scored as low-impact and low-confidence, even if their language sounds dramatic. Prefer specific, factual headlines as the basis for a strong-conviction score over vague or promotional ones.

Articles:
${JSON.stringify(payload, null, 2)}

Respond with a JSON array where each element has the exact shape described above, one element per input article id, in any order.`;
}

function clampSentiment(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(-1, Math.min(1, n));
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0.5;
  return Math.max(0, Math.min(1, n));
}

function sentimentLabelOf(sentiment: number): string {
  if (sentiment > 0.3) return 'positive';
  if (sentiment < -0.3) return 'negative';
  return 'neutral';
}

function impactOf(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

/**
 * Parses a raw Gemini response array item into a SentimentResult, clamping
 * out-of-range numeric fields the same way the pre-batch single-article path
 * did. Does not throw — a malformed item's fields are coerced to safe
 * defaults rather than failing the whole batch over one bad element.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceResult(raw: any): SentimentResult {
  const sentiment = clampSentiment(raw?.sentiment);
  return {
    sentiment,
    sentimentLabel: typeof raw?.sentimentLabel === 'string' ? raw.sentimentLabel : sentimentLabelOf(sentiment),
    confidence: clampConfidence(raw?.confidence),
    keyFactors: Array.isArray(raw?.keyFactors) ? raw.keyFactors : [],
    impact: impactOf(raw?.impact),
    aiSummary: typeof raw?.aiSummary === 'string' ? raw.aiSummary : undefined,
  };
}

export class SentimentAnalysisService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = createGeminiClient();
  }

  /**
   * Analyzes N articles in a single Gemini request, structurally constrained
   * by responseSchema (plan Task 7, ADR-31). Tries each model in
   * GEMINI_MODELS (plan Task 8) in sequence until one succeeds. Returns
   * `{ ok: false }` only when every model failed or the response could not
   * be parsed at all — callers must leave affected articles `null`
   * (unanalysed), never default to a fabricated neutral (plan Task 9).
   */
  async analyzeSentimentBatch(articles: BatchArticleInput[]): Promise<BatchSentimentResult> {
    if (articles.length === 0) {
      return { ok: true, results: new Map() };
    }

    const prompt = buildBatchPrompt(articles);

    for (const modelName of GEMINI_MODELS) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            responseSchema: BATCH_SENTIMENT_SCHEMA,
          },
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsed: any[];
        try {
          parsed = JSON.parse(text);
        } catch {
          // Parse fallback for the case where a model still wraps its JSON
          // in prose despite the schema (Compass's bracket-counting logic).
          parsed = JSON.parse(extractValidJsonArray(text));
        }

        if (!Array.isArray(parsed)) {
          throw new Error('Batch sentiment response was not a JSON array');
        }

        const results = new Map<string, SentimentResult | null>();
        for (const article of articles) results.set(article.id, null);

        for (const item of parsed) {
          if (item && typeof item.id === 'string' && results.has(item.id)) {
            results.set(item.id, coerceResult(item));
          }
        }

        console.warn(`[Gemini] Model ${modelName} served the batch sentiment request (${articles.length} articles).`);
        return { ok: true, results };
      } catch (error) {
        console.warn(
          `[Gemini] Model ${modelName} failed for batch sentiment:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    console.error(`Batch sentiment analysis failed for all ${GEMINI_MODELS.length} models (${articles.length} articles).`);
    return { ok: false };
  }

  async calculateDailySentiment(symbol: string, date: Date): Promise<void> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const articles = await prisma.newsArticle.findMany({
      where: {
        symbols: { has: symbol },
        publishedAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        sentiment: { not: null },
      },
    });
    
    if (articles.length === 0) return;
    
    const sentiments = articles.map(a => a.sentiment!);
    const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    
    const positiveCount = sentiments.filter(s => s > 0.3).length;
    const negativeCount = sentiments.filter(s => s < -0.3).length;
    const neutralCount = sentiments.length - positiveCount - negativeCount;
    
    // Calculate weighted sentiment (by impact)
    const weightedSum = articles.reduce((sum, article) => {
      const weight = article.impact === 'high' ? 3 : article.impact === 'medium' ? 2 : 1;
      return sum + (article.sentiment! * weight);
    }, 0);
    
    const totalWeight = articles.reduce((sum, article) => {
      return sum + (article.impact === 'high' ? 3 : article.impact === 'medium' ? 2 : 1);
    }, 0);
    
    const weightedSentiment = totalWeight > 0 ? weightedSum / totalWeight : avgSentiment;
    
    await prisma.sentimentHistory.upsert({
      where: {
        symbol_date: {
          symbol,
          date: startOfDay,
        },
      },
      update: {
        avgSentiment,
        newsCount: articles.length,
        positiveCount,
        neutralCount,
        negativeCount,
        weightedSentiment,
      },
      create: {
        symbol,
        date: startOfDay,
        avgSentiment,
        newsCount: articles.length,
        positiveCount,
        neutralCount,
        negativeCount,
        weightedSentiment,
      },
    });
  }
}

export const sentimentService = new SentimentAnalysisService();