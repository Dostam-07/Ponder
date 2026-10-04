import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { FsrsScheduler } from "../src/review/fsrs.js";
import { PictureGenerationError } from "../src/llm/openrouter.js";
import type { NodeEntity, ImageSpec } from "@canvas-learn/shared";

/**
 * POST /api/visual — the on-demand Create Visual route.
 * Regression coverage for: real visual persistence on the node, honest 502
 * error surfacing (no fake "none"), existing-visual survival on a failed
 * regeneration, and crash-safety of body validation (Express 4 does not
 * forward async-handler rejections to the error middleware).
 */

function makeNode(canvasId: string): NodeEntity {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "Static electricity",
    question: "What is static electricity?",
    answer_text: "Static electricity is a buildup of electric charge on the surface of objects, caused by the transfer of electrons between materials.",
    key_terms: ["static electricity"],
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
  };
}

/** Script the LLM for the visual route: generateVisual calls generateWithFailover. */
function stubModel(created: ReturnType<typeof createApp>, impl: () => Promise<{ text: string; provider: string; model: string }>) {
  Object.assign(created.router, { generateWithFailover: impl });
}

const VALID_VISUAL_JSON = JSON.stringify({
  type: "flowchart",
  spec: { mermaid: "flowchart TD\nA[Charge buildup] --> B[Electron transfer] --> C[Discharge / spark]" },
});

describe("POST /api/visual (Create Visual route)", () => {
  let dir: string;
  let base: string;
  let server: Server | undefined;
  let created: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-visual-api-"));
    created = createApp(path.join(dir, "app.db"));
    await new Promise<void>((resolve, reject) => {
      const srv = created.app.listen(0, "127.0.0.1", () => resolve());
      srv.once("error", reject);
      server = srv;
    });
    const addr = server!.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    base = `http://127.0.0.1:${addr.port}`;
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

  async function postVisual(body: unknown): Promise<{ status: number; json: unknown }> {
    const r = await fetch(`${base}/api/visual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as unknown };
  }

  async function getStoredVisual(nodeId: string): Promise<NodeEntity["visual"]> {
    const node = created.repos.nodeRepo.get(nodeId);
    return node?.visual ?? null;
  }

  it("generates a real visual, returns it, and persists it on the node", async () => {
    stubModel(created, async () => ({ text: VALID_VISUAL_JSON, provider: "fake", model: "fake" }));
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    created.repos.nodeRepo.insert(node);

    const { status, json } = await postVisual({ node_id: node.id, text: node.answer_text });
    expect(status).toBe(200);
    const block = (json as { visual: NodeEntity["visual"] }).visual;
    expect(block?.type).toBe("flowchart");
    expect((block?.spec as { mermaid: string }).mermaid).toContain("flowchart TD");

    // persisted — survives a refresh / re-fetch of the graph
    const stored = await getStoredVisual(node.id);
    expect(stored?.type).toBe("flowchart");
    expect((stored?.spec as { mermaid: string }).mermaid).toContain("flowchart TD");
  });

  it("returns an honest 502 (not a fake 'none') when the model output is unparseable, and leaves the node untouched", async () => {
    stubModel(created, async () => ({ text: "I am a paragraph, not JSON", provider: "fake", model: "fake" }));
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    created.repos.nodeRepo.insert(node);

    const { status, json } = await postVisual({ node_id: node.id, text: node.answer_text });
    expect(status).toBe(502);
    expect((json as { error: string }).error).toMatch(/couldn't be read/);
    expect((json as { visual?: unknown }).visual).toBeUndefined(); // no fake visual in the payload
    // honest recoverable state persisted (shown after refresh; Visualize = retry)
    const stored = await getStoredVisual(node.id);
    expect(stored).toEqual({ type: "none", status: "failed", spec: null });
  });

  it("returns an actionable 502 when no model responds at all", async () => {
    stubModel(created, async () => {
      throw new Error("Ollama unreachable: connect ECONNREFUSED 127.0.0.1:11434");
    });
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    created.repos.nodeRepo.insert(node);

    const { status, json } = await postVisual({ node_id: node.id, text: node.answer_text });
    expect(status).toBe(502);
    expect((json as { error: string }).error).toMatch(/no model responded/);
    const stored = await getStoredVisual(node.id);
    expect(stored).toEqual({ type: "none", status: "failed", spec: null });
  });

  it("a failed regeneration keeps the node's previously good visual", async () => {
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    created.repos.nodeRepo.insert(node);

    stubModel(created, async () => ({ text: VALID_VISUAL_JSON, provider: "fake", model: "fake" }));
    const ok = await postVisual({ node_id: node.id, text: node.answer_text });
    expect(ok.status).toBe(200);

    stubModel(created, async () => {
      throw new Error("model stalled");
    });
    const bad = await postVisual({ node_id: node.id, text: node.answer_text });
    expect(bad.status).toBe(502);
    expect((await getStoredVisual(node.id))?.type).toBe("flowchart"); // untouched
  });

  it("generates a picture only on request, persists its bytes, and includes it in the export", async () => {
    const image = {
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mediaType: "image/png",
      model: "test/image-model",
    };
    const generateImage = vi.spyOn(created.router, "generateImage").mockResolvedValue(image);
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    created.repos.nodeRepo.insert(node);
    try {
      const { status, json } = await postVisual({ node_id: node.id, text: node.answer_text, kind: "picture" });
      expect(status).toBe(200);
      const block = (json as { visual: NodeEntity["visual"] }).visual;
      expect(block?.type).toBe("image");
      const spec = block?.spec as ImageSpec;
      expect(spec.data_url).toBe(image.dataUrl);
      expect(spec.model).toBe(image.model);
      expect(generateImage).toHaveBeenCalledTimes(1);
      expect(generateImage.mock.calls[0]?.[0]).toContain(node.answer_text);
      expect(await getStoredVisual(node.id)).toEqual(block);

      const exported = await (await fetch(`${base}/api/export`)).json() as { canvases: { nodes: NodeEntity[] }[] };
      expect(exported.canvases.flatMap((c) => c.nodes).find((n) => n.id === node.id)?.visual).toEqual(block);
    } finally {
      generateImage.mockRestore();
    }
  });

  it("surfaces picture-provider errors and retains a previously generated diagram", async () => {
    const generateImage = vi.spyOn(created.router, "generateImage").mockRejectedValue(new Error("Picture generation requires OPENROUTER_API_KEY"));
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    node.visual = { type: "flowchart", status: "ready", spec: { mermaid: "flowchart TD\nA --> B" } };
    created.repos.nodeRepo.insert(node);
    try {
      const { status, json } = await postVisual({ node_id: node.id, text: node.answer_text, kind: "picture" });
      expect(status).toBe(502);
      expect((json as { error: string }).error).toContain("OPENROUTER_API_KEY");
      expect(await getStoredVisual(node.id)).toEqual(node.visual);
    } finally {
      generateImage.mockRestore();
    }
  });

  it("imports embedded picture payloads larger than the ordinary 1 MB JSON limit", async () => {
    const canvasId = crypto.randomUUID();
    const node = makeNode(canvasId);
    node.visual = {
      type: "image",
      status: "ready",
      spec: {
        data_url: `data:image/png;base64,${Buffer.alloc(1_100_000).toString("base64")}`,
        media_type: "image/png",
        prompt: "An educational picture",
        alt: "Educational picture",
        model: "test/image-model",
      },
    };
    const response = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2, canvases: [{ canvas: { id: canvasId, title: "Pictures" }, nodes: [node] }] }),
    });
    expect(response.status).toBe(200);
    expect(await getStoredVisual(node.id)).toEqual(node.visual);
  });

  it.each([false, true])("returns credit guidance and preserves an existing visual (%s)", async (hasVisual) => {
    const generateImage = vi.spyOn(created.router, "generateImage").mockRejectedValue(new PictureGenerationError("Insufficient picture credits. Add credits or use a funded key.", 402, "credits_required"));
    const response = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = await response.json() as { id: string };
    const node = makeNode(canvas.id);
    if (hasVisual) node.visual = { type: "flowchart", status: "ready", spec: { mermaid: "flowchart TD\nA --> B" } };
    created.repos.nodeRepo.insert(node);
    try {
      const { status, json } = await postVisual({ node_id: node.id, text: node.answer_text, kind: "picture" });
      expect(status).toBe(402);
      expect(json).toMatchObject({ code: "credits_required", error: expect.stringContaining("funded key") });
      expect(generateImage).toHaveBeenCalledTimes(1);
      const graph = await (await fetch(`${base}/api/canvases/${canvas.id}/graph`)).json() as { nodes: NodeEntity[] };
      const saved = graph.nodes.find((item) => item.id === node.id)?.visual;
      if (hasVisual) expect(saved).toEqual(node.visual);
      else expect(saved).toMatchObject({ type: "image", status: "failed", error: { code: "credits_required", message: expect.stringContaining("funded key") } });
    } finally { generateImage.mockRestore(); }
  });

  it("404s an unknown node and 400s an empty/oversized text (no crash, no hang)", async () => {
    const missing = await postVisual({ node_id: crypto.randomUUID(), text: "some answer" });
    expect(missing.status).toBe(404);

    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id);
    created.repos.nodeRepo.insert(node);

    // this exact shape used to crash the whole process (zod throw inside an
    // async Express 4 handler → unhandled rejection)
    const empty = await postVisual({ node_id: node.id, text: "" });
    expect(empty.status).toBe(400);
    const oversize = await postVisual({ node_id: node.id, text: "x".repeat(6001) });
    expect(oversize.status).toBe(400);
  });
});
