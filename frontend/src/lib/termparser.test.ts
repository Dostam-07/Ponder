import { describe, it, expect } from "vitest";
import { parseAnswerSegments, extractTerms } from "./termparser";

describe("parseAnswerSegments", () => {
  it("parses text with terms into alternating segments", () => {
    const segs = parseAnswerSegments("Water moves in a [[water cycle]] powered by the sun.");
    expect(segs).toEqual([
      { kind: "text", text: "Water moves in a " },
      { kind: "term", term: "water cycle" },
      { kind: "text", text: " powered by the sun." },
    ]);
  });

  it("handles multiple terms", () => {
    const segs = parseAnswerSegments("[[a]] and [[b]]");
    expect(segs.filter((s) => s.kind === "term").map((s) => (s as { term: string }).term)).toEqual(["a", "b"]);
  });

  it("tolerates an unclosed marker while streaming", () => {
    const segs = parseAnswerSegments("The [[water");
    expect(segs).toEqual([{ kind: "text", text: "The [[water" }]);
  });

  it("returns plain text when no markers exist", () => {
    expect(parseAnswerSegments("hello world")).toEqual([{ kind: "text", text: "hello world" }]);
  });
});

describe("extractTerms", () => {
  it("extracts all closed terms", () => {
    expect(extractTerms("[[x]] y [[z]]")).toEqual(["x", "z"]);
  });
});
