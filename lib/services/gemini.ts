// lib/services/gemini.ts
// Single source of truth for the Gemini model(s) used by both AI call sites
// (sentiment.service.ts, app/api/insights/portfolio/route.ts). Change the
// model chain in exactly one place — see
// plans/2026-07-20-gemini-model-update.md and
// plans/2026-07-24-news-sentiment-accuracy.md (Task 8, ADR-32).
//
// The original single-pinned model (Gemini 1.5 Flash) was retired by Google
// in 2026 and started returning 404 on generateContent — a single point of
// failure that already broke this project once. GEMINI_MODELS (Task 8)
// replaces the single constant with an ordered fallback chain, tried in
// sequence until one succeeds; GEMINI_MODEL remains exported as the chain's
// first entry so existing consumers are unaffected.
//
// Every model below was live-verified against this project's API key
// (2026-07-24, including with responseSchema — the sentiment batch call's
// requirement) before being committed to the chain:
//   - gemini-2.5-flash: OK (the pre-existing pin, still current)
//   - gemini-flash-latest: OK (a Google-maintained alias — resilient to a
//     future model retirement the way a pinned name is not)
//   - gemini-3.5-flash: OK (the newest generation available at verification time)
// Deliberately NOT copying Compass's list (gemini-3.1-flash-lite,
// gemini-3.5-flash, gemini-1.5-flash) — it includes gemini-1.5-flash, the
// exact model Google already retired out from under this project.
// gemini-2.5-flash-lite was tried and 404s against this API version/key —
// excluded, not silently assumed to work.
import { GoogleGenerativeAI } from '@google/generative-ai';

export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash'] as const;

export const GEMINI_MODEL = GEMINI_MODELS[0];

// TD-12 (plans/2026-07-23-lib-cleanup-batch.md): the single sanctioned place
// `new GoogleGenerativeAI(...)` is constructed. Both call sites previously
// instantiated their own client identically but differed in missing-key
// behavior — sentiment.service.ts throws at construction (module-scope
// singleton, so it throws at import time); app/api/insights/portfolio/route.ts
// returns a graceful 200 placeholder and never constructs a client at all when
// the key is absent. This factory does not impose one policy on both — it
// only centralizes the client construction itself. See AGENT.md fragile
// surfaces and DECISIONS.md ADR-27.

/** A single read of `process.env.GEMINI_API_KEY`. */
export function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

/**
 * Constructs the shared Gemini client. Takes an explicit key (defaulting to
 * `getGeminiApiKey()`), throwing the same message call sites already threw
 * before consolidation when no key is available.
 */
export function createGeminiClient(apiKey: string | undefined = getGeminiApiKey()): GoogleGenerativeAI {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenerativeAI(apiKey);
}
