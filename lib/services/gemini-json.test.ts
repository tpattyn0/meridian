import { describe, it, expect } from "vitest";
import { extractValidJsonArray } from "./gemini-json";

describe("extractValidJsonArray — bracket-counting parse fallback (Task 7)", () => {
  it("extracts a clean JSON array with no surrounding prose", () => {
    const text = '[{"id":"art_0","sentiment":0.5}]';
    expect(extractValidJsonArray(text)).toBe(text);
  });

  it("extracts a JSON array wrapped in prose/markdown fencing", () => {
    const text = 'Here is the result:\n```json\n[{"id":"art_0","sentiment":0.5}]\n```\nDone.';
    const extracted = extractValidJsonArray(text);
    expect(JSON.parse(extracted)).toEqual([{ id: "art_0", sentiment: 0.5 }]);
  });

  it("correctly counts brackets that appear inside string values", () => {
    const text = '[{"id":"art_0","aiSummary":"Revenue [up] 10% [beat]"}]';
    const extracted = extractValidJsonArray(text);
    expect(JSON.parse(extracted)).toEqual([{ id: "art_0", aiSummary: "Revenue [up] 10% [beat]" }]);
  });

  it("handles escaped quotes inside strings without miscounting", () => {
    const text = '[{"id":"art_0","aiSummary":"He said \\"buy\\" [strongly]"}]';
    const extracted = extractValidJsonArray(text);
    expect(JSON.parse(extracted)).toEqual([{ id: "art_0", aiSummary: 'He said "buy" [strongly]' }]);
  });

  it("throws when there is no opening bracket at all", () => {
    expect(() => extractValidJsonArray("no array here")).toThrow("No JSON array opening bracket found");
  });

  it("falls back to the last closing bracket if brace counting never balances", () => {
    const text = '[{"id":"art_0"}';
    // Unbalanced input — falls back to substring up to the last ']' if any,
    // else the tail from the opening bracket.
    const extracted = extractValidJsonArray(text);
    expect(extracted).toBe('[{"id":"art_0"}');
  });
});
