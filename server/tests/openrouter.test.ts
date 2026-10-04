import { describe, it, expect } from "vitest";
import { ThinkFilter } from "../src/llm/openrouter.js";

function run(chunks: string[]): string {
  const f = new ThinkFilter();
  let out = "";
  for (const c of chunks) f.push(c, (s) => (out += s));
  f.flush((s) => (out += s));
  return out;
}

describe("ThinkFilter", () => {
  it("passes plain content through unchanged", () => {
    expect(run(["Hello ", "world"])).toBe("Hello world");
  });

  it("strips a complete think block", () => {
    expect(run(["<think>secret reasoning</think>", "Final answer."])).toBe("Final answer.");
  });

  it("handles tags split across chunk boundaries", () => {
    const out = run(["Hello <thi", "nk>hidden</th", "ink> world"]);
    expect(out).toBe("Hello  world");
  });

  it("holds back a partial opening tag until resolved", () => {
    const f = new ThinkFilter();
    let out = "";
    f.push("Answer <th", (s) => (out += s));
    // up to (<think> length - 1) trailing chars stay buffered until the tag resolves
    expect(out).toBe("Answ");
    f.push("ink>hi</think>!", (s) => (out += s));
    f.flush((s) => (out += s));
    expect(out).toBe("Answer !");
  });

  it("emits an unterminated tag as literal text if it never closes", () => {
    expect(run(["a < b but no tag"])).toBe("a < b but no tag");
  });

  it("discards everything inside an unclosed think block", () => {
    const out = run(["<think>leaked reasoning forever"]);
    expect(out).toBe("");
  });
});
