// lib/services/sentiment.service.test.ts
//
// Rewritten for plans/2026-07-24-news-sentiment-accuracy.md Tasks 7-9: the
// single-article analyzeSentiment/analyzeAndUpdateArticle methods this file
// used to test are removed, replaced by analyzeSentimentBatch — one Gemini
// call per pass, constrained by responseSchema, tried across the
// GEMINI_MODELS fallback chain (Task 8), with failures leaving articles
// unanalyzed rather than silently defaulting to neutral (Task 9). No live
// Gemini network calls — @google/generative-ai is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getGenerativeModelMock, generateContentMock } = vi.hoisted(() => {
  // sentiment.service.ts constructs a module-scope singleton
  // (`export const sentimentService = ...`) that throws at import time if
  // GEMINI_API_KEY is unset (see AGENT.md fragile surfaces) — set it inside
  // vi.hoisted so it runs before the static import below is evaluated.
  process.env.GEMINI_API_KEY = "test-key";
  return {
    getGenerativeModelMock: vi.fn(),
    generateContentMock: vi.fn(),
  };
});

vi.mock("@google/generative-ai", async () => {
  const actual = await vi.importActual<typeof import("@google/generative-ai")>("@google/generative-ai");
  return {
    ...actual,
    GoogleGenerativeAI: vi.fn().mockImplementation(function (this: unknown) {
      return { getGenerativeModel: getGenerativeModelMock };
    }),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { GEMINI_MODEL, GEMINI_MODELS } from "@/lib/services/gemini";
import { SchemaType } from "@google/generative-ai";
import { SentimentAnalysisService, buildBatchPrompt } from "./sentiment.service";

describe("GEMINI_MODEL / GEMINI_MODELS", () => {
  it("GEMINI_MODEL is the live-verified replacement model, not the retired gemini-1.5-flash", () => {
    expect(GEMINI_MODEL).toBe("gemini-2.5-flash");
  });

  it("GEMINI_MODEL equals the chain's first entry", () => {
    expect(GEMINI_MODEL).toBe(GEMINI_MODELS[0]);
  });

  it("the chain does not contain the retired gemini-1.5-flash", () => {
    expect(GEMINI_MODELS).not.toContain("gemini-1.5-flash");
  });
});

function mockSuccessResponse(items: Array<Record<string, unknown>>) {
  return { response: { text: () => JSON.stringify(items) } };
}

describe("SentimentAnalysisService.analyzeSentimentBatch — schema + batching (Task 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("makes exactly ONE generateContent call for N articles, not N calls", async () => {
    generateContentMock.mockResolvedValueOnce(
      mockSuccessResponse([
        { id: "art_0", sentiment: 0.5, sentimentLabel: "positive", confidence: 0.8, impact: "medium" },
        { id: "art_1", sentiment: -0.2, sentimentLabel: "negative", confidence: 0.6, impact: "low" },
      ])
    );
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([
      { id: "art_0", title: "Headline A", content: null },
      { id: "art_1", title: "Headline B", content: null },
    ]);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("passes responseMimeType 'application/json' and a responseSchema whose type is SchemaType.ARRAY", async () => {
    generateContentMock.mockResolvedValueOnce(mockSuccessResponse([]));
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    await service.analyzeSentimentBatch([{ id: "art_0", title: "Headline A", content: null }]);

    expect(getGenerativeModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: GEMINI_MODEL,
        generationConfig: expect.objectContaining({
          responseMimeType: "application/json",
          responseSchema: expect.objectContaining({ type: SchemaType.ARRAY }),
        }),
      })
    );
  });

  it("a response missing one id leaves that article null and still writes the others correctly", async () => {
    generateContentMock.mockResolvedValueOnce(
      mockSuccessResponse([{ id: "art_0", sentiment: 0.7, sentimentLabel: "positive", confidence: 0.9, impact: "high" }])
    );
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([
      { id: "art_0", title: "Headline A", content: null },
      { id: "art_1", title: "Headline B", content: null },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.results.get("art_0")?.sentiment).toBe(0.7);
    expect(result.results.get("art_1")).toBeNull();
  });

  it("a response with reordered ids maps each sentiment to the correct article", async () => {
    generateContentMock.mockResolvedValueOnce(
      mockSuccessResponse([
        { id: "art_1", sentiment: -0.4, sentimentLabel: "negative", confidence: 0.5, impact: "low" },
        { id: "art_0", sentiment: 0.9, sentimentLabel: "positive", confidence: 0.95, impact: "high" },
      ])
    );
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([
      { id: "art_0", title: "Headline A", content: null },
      { id: "art_1", title: "Headline B", content: null },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.results.get("art_0")?.sentiment).toBe(0.9);
    expect(result.results.get("art_1")?.sentiment).toBe(-0.4);
  });

  it("a response wrapped in prose is still parsed via the bracket-counting fallback", async () => {
    const prose =
      'Here is the analysis you requested:\n```json\n' +
      JSON.stringify([{ id: "art_0", sentiment: 0.3, sentimentLabel: "positive", confidence: 0.6, impact: "low" }]) +
      '\n```\nLet me know if you need anything else.';
    generateContentMock.mockResolvedValueOnce({ response: { text: () => prose } });
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([{ id: "art_0", title: "Headline A", content: null }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.results.get("art_0")?.sentiment).toBe(0.3);
  });

  it("a malformed/non-JSON response falls through the whole model chain and returns ok: false, writing nothing", async () => {
    generateContentMock.mockResolvedValue({ response: { text: () => "not json at all, no brackets" } });
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([{ id: "art_0", title: "Headline A", content: null }]);

    expect(result.ok).toBe(false);
    // Tried every model in the chain before giving up.
    expect(generateContentMock).toHaveBeenCalledTimes(GEMINI_MODELS.length);
  });

  it("returns ok: true with an empty map for an empty article list (no Gemini call)", async () => {
    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([]);

    expect(result.ok).toBe(true);
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe("SentimentAnalysisService.analyzeSentimentBatch — model fallback chain (Task 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("falls through to the second model when the first model's generateContent rejects, and returns its result", async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error("[404 Not Found] models/gemini-2.5-flash is not found"))
      .mockResolvedValueOnce(
        mockSuccessResponse([{ id: "art_0", sentiment: 0.6, sentimentLabel: "positive", confidence: 0.7, impact: "medium" }])
      );
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([{ id: "art_0", title: "Headline A", content: null }]);

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.results.get("art_0")?.sentiment).toBe(0.6);

    // Confirm the second call used the chain's second model name.
    expect(getGenerativeModelMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: GEMINI_MODELS[1] })
    );
  });

  it("surfaces a failure (ok: false) when every model in the chain fails — never a fabricated neutral", async () => {
    generateContentMock.mockRejectedValue(new Error("every model down"));
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([{ id: "art_0", title: "Headline A", content: null }]);

    expect(result.ok).toBe(false);
    expect(generateContentMock).toHaveBeenCalledTimes(GEMINI_MODELS.length);
  });
});

describe("SentimentAnalysisService.analyzeSentimentBatch — no silent-neutral masking (Task 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("a rejected generateContent on every model results in ok: false, not a well-formed neutral result", async () => {
    generateContentMock.mockRejectedValue(new Error("transient failure"));
    getGenerativeModelMock.mockReturnValue({ generateContent: generateContentMock });

    const service = new SentimentAnalysisService();
    const result = await service.analyzeSentimentBatch([{ id: "art_0", title: "Headline A", content: null }]);

    expect(result).toEqual({ ok: false });
  });
});

describe("buildBatchPrompt — calibration anchors + selectivity rule (Task 10)", () => {
  const articles = [
    { id: "art_0", title: "Google's profits are outrunning its AI spending boom", content: null },
    { id: "art_1", title: "Could Surge 25.12%", content: null, symbol: "GOOGL" },
  ];

  it("tags each article with its id", () => {
    const prompt = buildBatchPrompt(articles);
    expect(prompt).toContain("art_0");
    expect(prompt).toContain("art_1");
    expect(prompt).toContain('"id"');
  });

  it("states calibration anchors: mild for promotional coverage, strong for concrete company news, reserve extremes for major surprises", () => {
    const prompt = buildBatchPrompt(articles);
    expect(prompt).toMatch(/promotional/i);
    expect(prompt.toLowerCase()).toContain("0.2");
    expect(prompt.toLowerCase()).toContain("0.4");
    expect(prompt.toLowerCase()).toContain("0.6");
    expect(prompt.toLowerCase()).toContain("0.9");
  });

  it("instructs that a price-move article's sentiment must follow the direction of the move, and impact reflects materiality not tone", () => {
    const prompt = buildBatchPrompt(articles);
    expect(prompt).toMatch(/direction of the move/i);
    expect(prompt).toMatch(/materiality/i);
  });

  it("includes a selectivity rule for vague/clickbait titles", () => {
    const prompt = buildBatchPrompt(articles);
    expect(prompt).toMatch(/selective/i);
    expect(prompt).toMatch(/clickbait/i);
  });

  it("does not imply body text will always be present (RSS items are title-only)", () => {
    const prompt = buildBatchPrompt(articles);
    expect(prompt).toMatch(/title only|only a title|title alone/i);
  });
});

describe("SentimentAnalysisService constructor — fragile-surface contract (AGENT.md)", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("still throws at construction (via the shared createGeminiClient factory) when GEMINI_API_KEY is unset", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => new SentimentAnalysisService()).toThrow("GEMINI_API_KEY is not configured");
  });
});
