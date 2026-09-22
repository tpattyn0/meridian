/**
 * Bracket-counting JSON-array extraction — a parse fallback for the case
 * where a model still wraps its JSON in prose despite `responseSchema`
 * constraining the response shape (plans/2026-07-24-news-sentiment-accuracy.md,
 * Task 7). Ported verbatim from Compass (`src/lib/news/gemini.ts:48-73`).
 *
 * Not used as the primary parse path — `JSON.parse(text)` is tried first
 * and only falls back to this on failure.
 */
export function extractValidJsonArray(text: string): string {
  const startIdx = text.indexOf('[');
  if (startIdx === -1) throw new Error('No JSON array opening bracket found');

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\') { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (!inString) {
      if (char === '[') braceCount++;
      else if (char === ']') {
        braceCount--;
        if (braceCount === 0) return text.substring(startIdx, i + 1);
      }
    }
  }

  const endIdx = text.lastIndexOf(']');
  if (endIdx > startIdx) return text.substring(startIdx, endIdx + 1);
  return text.substring(startIdx);
}
