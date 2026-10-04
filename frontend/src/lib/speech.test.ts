import { describe, it, expect } from "vitest";
import { sanitizeForSpeech, joinForSpeech } from "./speech";

describe("sanitizeForSpeech", () => {
  it("strips wikilinks, bold, code, headings and bullets to plain words", () => {
    const md = "# Photosynthesis\n**Plants** use [[chlorophyll]] to capture light.\n- step one\n- step two\n";
    expect(sanitizeForSpeech(md)).toBe("Photosynthesis Plants use chlorophyll to capture light. step one step two");
  });

  it("never leaves markdown markers behind", () => {
    const md = "A **bold** and *soft* and [[link]] and `code` term.";
    const out = sanitizeForSpeech(md);
    expect(out).not.toMatch(/\*|\[\[|\]\]|`/);
    expect(out).toContain("bold");
    expect(out).toContain("chlorophyll".slice(0, 0) || "term");
  });

  it("returns empty for empty/whitespace input", () => {
    expect(sanitizeForSpeech("")).toBe("");
    expect(sanitizeForSpeech("   \n  ")).toBe("");
  });

  it("truncates at a word boundary and marks the cut", () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const out = sanitizeForSpeech(long, 100);
    expect(out.length).toBeLessThanOrEqual(102); // ~100 + "…"
    expect(out.endsWith("…")).toBe(true);
    // must end on a complete word token (wordN), never mid-word
    expect(out.slice(0, -1)).toMatch(/word\d+$/);
  });

  it("is deterministic", () => {
    const md = "# T\n**x** uses [[y]].";
    expect(sanitizeForSpeech(md)).toBe(sanitizeForSpeech(md));
  });
});

describe("joinForSpeech", () => {
  it("drops empties and joins with single spaces", () => {
    expect(joinForSpeech(["  Hi ", null, undefined, "  there  "])).toBe("Hi there");
    expect(joinForSpeech([])).toBe("");
  });
});
