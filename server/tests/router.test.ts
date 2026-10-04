import { describe, it, expect } from "vitest";
import { extractJson, ModelRouter } from "../src/llm/router.js";

describe("extractJson", () => {
  it("extracts JSON from a plain response", () => {
    expect(extractJson('{"title": "Hi"}')).toBe('{"title": "Hi"}');
  });

  it("extracts JSON from fenced responses", () => {
    const text = 'Here you go:\n```json\n{"a": 1}\n```\nDone.';
    expect(JSON.parse(extractJson(text))).toEqual({ a: 1 });
  });

  it("extracts the outer object from chatty text", () => {
    const text = 'Sure! {"title": "The Water Cycle", "followups": ["a?", "b?"]} hope that helps';
    expect(JSON.parse(extractJson(text))).toHaveProperty("title");
  });
});

describe("ModelRouter.resolve", () => {
  it("routes explicit OpenRouter-style ids (with slash) to openrouter", () => {
    const router = new ModelRouter();
    const r = router.resolve("fast", { explicitModel: "mistralai/mistral-7b-instruct:free" });
    expect(r.provider.name).toBe("openrouter");
    expect(r.model).toBe("mistralai/mistral-7b-instruct:free");
  });

  it("routes explicit local ids to ollama", () => {
    const router = new ModelRouter();
    const r = router.resolve("fast", { explicitModel: "qwen2.5:7b" });
    expect(r.provider.name).toBe("ollama");
  });

  it("routes fast/quality to the configured local models", () => {
    const router = new ModelRouter({ fastModel: "m-fast", qualityModel: "m-big" });
    expect(router.resolve("fast").model).toBe("m-fast");
    expect(router.resolve("quality").model).toBe("m-big");
  });
});
