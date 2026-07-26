// lib/services/gemini.test.ts
//
// TD-12 (plans/2026-07-23-lib-cleanup-batch.md) Task 2: getGeminiApiKey +
// createGeminiClient are the single sanctioned place `new
// GoogleGenerativeAI(...)` is constructed. No live Gemini network calls —
// @google/generative-ai is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { GoogleGenerativeAIMock } = vi.hoisted(() => ({
  GoogleGenerativeAIMock: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: GoogleGenerativeAIMock,
}));

import { getGeminiApiKey, createGeminiClient, GEMINI_MODEL, GEMINI_MODELS } from "./gemini";

describe("GEMINI_MODELS — model fallback chain (plans/2026-07-24-news-sentiment-accuracy.md Task 8)", () => {
  it("GEMINI_MODEL equals the chain's first entry", () => {
    expect(GEMINI_MODEL).toBe(GEMINI_MODELS[0]);
  });

  it("does not include the retired gemini-1.5-flash (Compass's list includes it; deliberately not copied)", () => {
    expect(GEMINI_MODELS).not.toContain("gemini-1.5-flash");
  });

  it("has more than one entry — a real fallback chain, not a single pinned model wrapped in an array", () => {
    expect(GEMINI_MODELS.length).toBeGreaterThan(1);
  });
});

describe("getGeminiApiKey", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("reads GEMINI_API_KEY from process.env", () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    expect(getGeminiApiKey()).toBe("test-key-123");
  });

  it("returns undefined when GEMINI_API_KEY is unset", () => {
    delete process.env.GEMINI_API_KEY;
    expect(getGeminiApiKey()).toBeUndefined();
  });
});

describe("createGeminiClient", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    GoogleGenerativeAIMock.mockImplementation(function (this: unknown) {
      return { mocked: true };
    });
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("returns a GoogleGenerativeAI instance when a key is present (explicit arg)", () => {
    const client = createGeminiClient("explicit-key");
    expect(GoogleGenerativeAIMock).toHaveBeenCalledWith("explicit-key");
    expect(client).toEqual({ mocked: true });
  });

  it("returns a GoogleGenerativeAI instance when a key is present (defaults to getGeminiApiKey())", () => {
    process.env.GEMINI_API_KEY = "env-key";
    const client = createGeminiClient();
    expect(GoogleGenerativeAIMock).toHaveBeenCalledWith("env-key");
    expect(client).toEqual({ mocked: true });
  });

  it("throws with the exact message when GEMINI_API_KEY is unset and no explicit key is passed", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => createGeminiClient()).toThrow("GEMINI_API_KEY is not configured");
    expect(GoogleGenerativeAIMock).not.toHaveBeenCalled();
  });

  it("throws the exact message when an explicit empty-string key is passed", () => {
    expect(() => createGeminiClient("")).toThrow("GEMINI_API_KEY is not configured");
    expect(GoogleGenerativeAIMock).not.toHaveBeenCalled();
  });
});
