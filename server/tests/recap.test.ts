import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { FsrsScheduler } from "../src/review/fsrs.js";
import type { NodeEntity } from "@canvas-learn/shared";

function makeNode(canvasId: string, now: number, over: Partial<NodeEntity> = {}): NodeEntity {
  return {
    id: crypto.randomUUID(),
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "Transistors",
    question: "What is a transistor?",
    answer_text: "A transistor is a semiconductor switch that controls current flow.",
    key_terms: ["transistor"],
    suggested_followups: [],
    tags: [],
    visual: null,
    position: { x: 0, y: 0 },
    width: 420,
    collapsed: false,
    saved_to_library: false,
    model_used: "",
    web_search_used: false,
    context_summary: "",
    mode: "",
    sources: [],
    provenance: null,
    gaps: [],
    material_id: null,
    sections: [],
    note: "",
    important: false,
    review_state: new FsrsScheduler().initial(),
    created_at: now,
    updated_at: now,
    ...over,
  };
}

const RECAP_TEXT = "Here's what you learned: A transistor is a semiconductor switch that controls current flow. It is the building block of modern electronics. Worth going deeper on how the gate voltage turns it on.";

describe("recap route (createApp + stubbed LLM)", () => {
  let dir: string;
  let base: string;
  let server: Server | undefined;
  let created: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-recap-"));
    created = createApp(path.join(dir, "app.db"));
    await new Promise<void>((resolve, reject) => {
      const srv = created.app.listen(0, "127.0.0.1", () => resolve());
      srv.once("error", reject);
      server = srv;
    });
    const addr = server!.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    base = `http://127.0.0.1:${addr.port}`;
    // Stub the LLM — recap is free-form prose via generateWithFailover.
    Object.assign(created.router, {
      generateWithFailover: async () => ({ text: RECAP_TEXT, provider: "fake", model: "fake-model" }),
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    created.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly
    }
  });

  async function newCanvasWithNodes(n = 1): Promise<string> {
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    for (let i = 0; i < n; i++) created.repos.nodeRepo.insert(makeNode(canvas.id, Date.now()));
    return canvas.id;
  }

  it("400 on a canvas with no completed answers (nothing to recap)", async () => {
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const r = await fetch(`${base}/api/canvases/${canvas.id}/recap`, { method: "POST" });
    expect(r.status).toBe(400);
  });

  it("returns a short plain-prose recap of real completed nodes", async () => {
    const id = await newCanvasWithNodes(2);
    const r = await fetch(`${base}/api/canvases/${id}/recap`, { method: "POST" });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { text: string; model_used: string; node_count: number };
    expect(body.node_count).toBe(2);
    expect(body.model_used).toBe("fake:fake-model");
    expect(body.text).toContain("Here's what you learned");
    // spoken prose: no Markdown markers survive
    expect(body.text).not.toMatch(/\*|\[\[|\]\]/);
  });

  it("404 for an unknown canvas", async () => {
    const r = await fetch(`${base}/api/canvases/00000000-0000-0000-0000-000000000000/recap`, { method: "POST" });
    expect(r.status).toBe(404);
  });
});
