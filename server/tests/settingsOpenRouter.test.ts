import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { OpenRouterSettings } from "@canvas-learn/shared";
import { createApp } from "../src/app.js";

const KEY = "sk-or-v1-test-key-stored-only-on-the-server-abcd";
const ENV_KEY = "sk-or-v1-test-environment-key-ending-efgh";
const realFetch = globalThis.fetch;

describe("OpenRouter Settings", () => {
  let dir: string;
  let created: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;

  async function boot() {
    created = createApp(path.join(dir, "app.db"));
    server = await new Promise<Server>((resolve) => {
      const srv = created.app.listen(0, "127.0.0.1", () => resolve(srv));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address");
    base = `http://127.0.0.1:${address.port}`;
  }

  async function shutdown() {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    created.close();
  }

  beforeEach(async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENROUTER_IMAGE_MODEL", "");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-key-settings-"));
    await boot();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function save(body: unknown) {
    const response = await realFetch(`${base}/api/settings/openrouter`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as OpenRouterSettings };
  }

  async function read() {
    return await (await realFetch(`${base}/api/settings/openrouter`)).json() as OpenRouterSettings;
  }

  it("saves a key with redacted responses and applies text/picture preferences immediately", async () => {
    const result = await save({ api_key: ` ${KEY} `, image_model: "test/picture-model", prefer_openrouter: false });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ configured: true, key_source: "settings", key_hint: "••••abcd", image_model: "test/picture-model", image_model_source: "settings", prefer_openrouter: false });
    expect(JSON.stringify(result.body)).not.toContain(KEY);
    expect(await read()).toEqual(result.body);
    expect(created.router.openrouter.imageModel).toBe("test/picture-model");
    expect(created.router.openrouter.configured).toBe(true);
  });

  it("keeps the existing key when only the picture model changes", async () => {
    await save({ api_key: KEY });
    const result = await save({ image_model: "test/new-picture-model" });
    expect(result.body.configured).toBe(true);
    expect(result.body.key_hint).toBe("••••abcd");
    expect(result.body.image_model).toBe("test/new-picture-model");
  });

  it("uses the saved key and image model on actual outgoing image requests", async () => {
    await save({ api_key: KEY, image_model: "test/picture-model" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=", media_type: "image/png" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await created.router.generateImage("An educational picture");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(options.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(options.body).model).toBe("test/picture-model");
  });

  it("persists across restarting the backend", async () => {
    await save({ api_key: KEY, image_model: "test/picture-model", prefer_openrouter: false });
    await shutdown();
    await boot();
    expect(await read()).toMatchObject({ configured: true, key_source: "settings", key_hint: "••••abcd", image_model: "test/picture-model", prefer_openrouter: false });
  });

  it("supports environment fallback, a Settings override, and explicit key removal", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", ENV_KEY);
    await shutdown();
    await boot();
    expect(await read()).toMatchObject({ configured: true, key_source: "env", key_hint: "••••efgh" });
    expect((await save({ api_key: KEY })).body.key_hint).toBe("••••abcd");
    expect((await save({ api_key: "" })).body).toMatchObject({ configured: false, key_source: "settings", key_hint: "" });
    expect(created.router.openrouter.hasKey).toBe(false);
    expect((await save({ api_key: null })).body).toMatchObject({ configured: true, key_source: "env", key_hint: "••••efgh" });
  });

  it("does not leak the key through health or workspace exports", async () => {
    await save({ api_key: KEY });
    vi.spyOn(created.router.ollama, "capabilities").mockResolvedValue(null);
    vi.spyOn(created.router.openrouter, "listFreeModels").mockResolvedValue([]);
    const health = await (await realFetch(`${base}/api/health`)).text();
    const exported = await (await realFetch(`${base}/api/export`)).text();
    expect(health).not.toContain(KEY);
    expect(exported).not.toContain(KEY);
    expect(JSON.parse(health).openrouter_keyed).toBe(true);
  });

  it("tests the saved key with a non-generating authenticated request", async () => {
    await save({ api_key: KEY });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await realFetch(`${base}/api/settings/openrouter/test`, { method: "POST" });
    expect(response.status).toBe(200);
    expect((await response.json() as { ok: boolean }).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/key");
    expect(fetchMock.mock.calls[0]?.[1].headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("reports a rejected key without returning the upstream response or the key", async () => {
    await save({ api_key: KEY });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(KEY, { status: 401 })));
    const response = await realFetch(`${base}/api/settings/openrouter/test`, { method: "POST" });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("rejected this key");
    expect(body).not.toContain(KEY);
  });

  it("rejects malformed settings without changing the connection or crashing the server", async () => {
    for (const body of [{ api_key: "short" }, { image_model: "not-a-model-id" }, { prefer_openrouter: "yes" }, { api_key: [] }]) {
      expect((await save(body)).status).toBe(400);
    }
    expect((await read()).configured).toBe(false);
  });
});
