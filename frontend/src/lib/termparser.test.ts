import { describe, it, expect } from "vitest";
import { parseAnswerSegments, extractTerms, termExplanationContext } from "./termparser";

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

  it("keeps saved concepts clickable when section formatting omits markers", () => {
    expect(parseAnswerSegments("Rayleigh scattering redirects light.", ["rayleigh scattering", "light"])).toEqual([
      { kind: "term", term: "Rayleigh scattering" },
      { kind: "text", text: " redirects " },
      { kind: "term", term: "light" },
      { kind: "text", text: "." },
    ]);
  });

  it("does not highlight part of a larger word or a Unicode word", () => {
    const text = "Rain, rainfall, brain, entrain, and train. été and météore.";
    const terms = parseAnswerSegments(text, ["rain", "été"]).filter((segment) => segment.kind === "term");
    expect(terms).toEqual([{ kind: "term", term: "Rain" }, { kind: "term", term: "été" }]);
  });

  it("prefers the longest phrase and tolerates whitespace without changing the prose", () => {
    const text = "Water\n  vapor carries heat.";
    const segments = parseAnswerSegments(text, ["water", "water vapor", "WATER VAPOR"]);
    expect(segments[0]).toEqual({ kind: "term", term: "Water\n  vapor" });
    expect(segments.map((segment) => segment.kind === "text" ? segment.text : segment.term).join("")).toBe(text);
  });

  it("escapes punctuation in concepts and keeps explicit markers intact", () => {
    expect(parseAnswerSegments("C++ differs from [[C#]].", ["C++", "C#"])).toEqual([
      { kind: "term", term: "C++" }, { kind: "text", text: " differs from " },
      { kind: "term", term: "C#" }, { kind: "text", text: "." },
    ]);
  });

  it("never turns an incomplete streamed marker into a link", () => {
    expect(parseAnswerSegments("Water moves as [[water vapor", ["water", "water vapor"])).toEqual([
      { kind: "term", term: "Water" }, { kind: "text", text: " moves as [[water vapor" },
    ]);
  });
});

describe("extractTerms", () => {
  it("extracts all closed terms", () => {
    expect(extractTerms("[[x]] y [[z]]")).toEqual(["x", "z"]);
  });
});

describe("term explanation grounding", () => {
  it("includes a concept near a long answer's end instead of sending only the opening paragraph", () => {
    const text = "Earlier background. ".repeat(200) + "A [[wavelength]] measures the distance between successive wave crests.";
    const context = termExplanationContext(text, "wavelength");
    expect(context).toContain("wavelength measures the distance between successive wave crests");
    expect(context).not.toContain("[[");
    expect(context.length).toBeLessThanOrEqual(1200);
  });
});
