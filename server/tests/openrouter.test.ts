import { describe, it, expect, vi, afterEach } from "vitest";
import { ThinkFilter, OpenRouterProvider, PictureGenerationError } from "../src/llm/openrouter.js";

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

describe("OpenRouter image generation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the image API and returns image data for persistence", async () => {
    vi.stubEnv("OPENROUTER_IMAGE_MODEL", "test/image-model");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=", media_type: "image/png" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const picture = await new OpenRouterProvider("test-key").generateImage("A landscape showing evaporation");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/images");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toMatchObject({ model: "test/image-model", prompt: "A landscape showing evaporation", n: 1 });
    expect(picture).toEqual({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png", model: "test/image-model" });
  });

  it("does not make a request without a key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OpenRouterProvider("").generateImage("A picture")).rejects.toThrow("save an OpenRouter API key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing images and HTTP failures instead of returning text as a picture", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(new Response("Insufficient credits", { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("test-key");
    await expect(provider.generateImage("A picture")).rejects.toThrow("returned no image");
    await expect(provider.generateImage("A picture")).rejects.toThrow("insufficient credits");
  });

  it("turns a billing rejection into safe credit guidance without disabling free text or automatically retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Insufficient credits. secret-key sk-or-private", code: 402, metadata: { remedy_hint: "untrusted" } } }), { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterProvider("sk-or-private");
    const error = await provider.generateImage("A picture").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(PictureGenerationError);
    expect(error).toMatchObject({ status: 402, code: "credits_required", provider: "openrouter" });
    expect((error as Error).message).toContain("funded key");
    expect((error as Error).message).not.toContain("sk-or-private");
    expect((error as Error).message).not.toContain("metadata");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.hasKey).toBe(true);
  });

  it.each([
    [401, "key_rejected"], [403, "key_rejected"], [404, "model_unavailable"],
    [429, "rate_limited"], [503, "provider_unavailable"],
  ])("returns safe guidance for picture HTTP %i errors", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream secret diagnostics", { status: status as number })));
    const error = await new OpenRouterProvider("test-key").generateImage("A picture").catch((error: unknown) => error);
    expect(error).toMatchObject({ status, code });
    expect((error as Error).message).not.toContain("secret diagnostics");
  });

  it("handles a billing error envelope returned with HTTP 200 without displaying raw upstream content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 402, message: "private diagnostics" } }))));
    await expect(new OpenRouterProvider("test-key").generateImage("A picture")).rejects.toMatchObject({ code: "credits_required", status: 402 });
  });
});
