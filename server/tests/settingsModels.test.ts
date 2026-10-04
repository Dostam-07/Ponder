import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import type { ModelRouter } from "../src/llm/router.js";

interface AppHandle {
  base: string;
  server: Server;
  created: ReturnType<typeof createApp>;
}

async function bootApp(dir: string): Promise<AppHandle> {
  const created = createApp(path.join(dir, "app.db"));
  const server = await new Promise<Server>((resolve, reject) => {
    const srv = created.app.listen(0, "127.0.0.1", () => resolve(srv));
    srv.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP address");
  return { base: `http://127.0.0.1:${addr.port}`, server, created };
}

async function shutdown(h: AppHandle) {
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  h.created.close();
}

/** Deterministic installed-model list (no live Ollama dependency in tests). */
function fakeInstalled(router: ModelRouter, names: string[] | null) {
  const r = router as unknown as { installedNames: string[] | null; installedCheckedAt: number };
  r.installedNames = names;
  r.installedCheckedAt = Date.now();
}

async function getModels(base: string) {
  const res = await fetch(`${base}/api/settings/models`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function putModels(base: string, body: unknown) {
  const res = await fetch(`${base}/api/settings/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const role = (m: Record<string, unknown>, r: "fast" | "quality") => m[r] as {
  effective: string;
  source: string;
  saved: string | null;
  savedIgnored: boolean;
  savedIgnoreReason: string | null;
  env: string | null;
  fallback: string;
};

describe("model picker endpoints (roadmap D)", () => {
  let dir: string;
  let h: AppHandle;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-models-"));
    h = await bootApp(dir);
    fakeInstalled(h.created.router, ["llama3.2:3b", "gemma3:4b", "gemma4:latest"]);
  });

  afterAll(async () => {
    await shutdown(h);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("starts at the documented defaults with source=default", async () => {
    const { status, body } = await getModels(h.base);
    expect(status).toBe(200);
    expect(role(body, "fast").source).toBe("default");
    expect(role(body, "fast").effective).toBe("llama3.2:3b");
    expect(role(body, "quality").effective).toBe("gemma3:4b");
  });

  it("saves a preference; it becomes the effective model (source=saved)", async () => {
    const put = await putModels(h.base, { fast: "gemma4:latest" });
    expect(put.status).toBe(200);
    expect(role(put.body, "fast").source).toBe("saved");
    expect(role(put.body, "fast").effective).toBe("gemma4:latest");
    // the other role is untouched
    expect(role(put.body, "quality").source).toBe("default");

    const get = await getModels(h.base);
    expect(role(get.body, "fast").effective).toBe("gemma4:latest");
    expect(role(get.body, "fast").saved).toBe("gemma4:latest");
  });

  it("rejects a model that is not installed (graceful unavailable-model handling)", async () => {
    const { status, body } = await putModels(h.base, { quality: "llama3:70b" });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("not installed");
    // nothing changed
    const get = await getModels(h.base);
    expect(role(get.body, "quality").saved).toBeNull();
  });

  it("env var OVERRIDES the saved preference and reports the override", async () => {
    process.env.CANVAS_FAST_MODEL = "gemma3:4b";
    try {
      const { body } = await getModels(h.base);
      const fast = role(body, "fast");
      expect(fast.source).toBe("env");
      expect(fast.effective).toBe("gemma3:4b");
      expect(fast.env).toBe("gemma3:4b");
      expect(fast.saved).toBe("gemma4:latest"); // still saved…
      expect(fast.savedIgnored).toBe(true); // …but not in effect
      expect(fast.savedIgnoreReason).toBe("env_override");
    } finally {
      delete process.env.CANVAS_FAST_MODEL;
    }
  });

  it("when the env var goes away, the saved preference returns to effect", async () => {
    const { body } = await getModels(h.base);
    expect(role(body, "fast").source).toBe("saved");
    expect(role(body, "fast").effective).toBe("gemma4:latest");
  });

  it("null clears the saved preference back to the default", async () => {
    const { status, body } = await putModels(h.base, { fast: null });
    expect(status).toBe(200);
    expect(role(body, "fast").saved).toBeNull();
    expect(role(body, "fast").source).toBe("default");
  });

  it("503 (not a silent save) when Ollama cannot be validated against", async () => {
    fakeInstalled(h.created.router, []); // nothing discoverable
    const { status, body } = await putModels(h.base, { fast: "gemma4:latest" });
    expect(status).toBe(503);
    expect(String(body.error)).toMatch(/Ollama/i);
    fakeInstalled(h.created.router, ["llama3.2:3b", "gemma3:4b", "gemma4:latest"]);
  });

  it("persists across a server restart (reloaded from app_state at startup)", async () => {
    await putModels(h.base, { quality: "gemma4:latest" });
    await shutdown(h);
    const h2 = await bootApp(dir); // fresh process, same DB
    fakeInstalled(h2.created.router, ["llama3.2:3b", "gemma3:4b", "gemma4:latest"]);
    const { body } = await getModels(h2.base);
    expect(role(body, "quality").source).toBe("saved");
    expect(role(body, "quality").effective).toBe("gemma4:latest");
    await shutdown(h2);
  });

  it("a saved model that later disappears falls back with reason=not_installed", async () => {
    const h3 = await bootApp(dir);
    // gemma4:latest was saved; pretend it is no longer installed
    fakeInstalled(h3.created.router, ["llama3.2:3b", "gemma3:4b"]);
    const { body } = await getModels(h3.base);
    const q = role(body, "quality");
    expect(q.effective).toBe("gemma3:4b"); // documented default
    expect(q.source).toBe("default");
    expect(q.saved).toBe("gemma4:latest");
    expect(q.savedIgnored).toBe(true);
    expect(q.savedIgnoreReason).toBe("not_installed");
    await shutdown(h3);
  });
});
