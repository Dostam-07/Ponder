import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import type { AskEvent, CanvasEntity, NodeEntity } from "@canvas-learn/shared";

/**
 * Canvas-independence integration tests — real backend behavior, no mocks:
 * boots the actual Express app on a temp SQLite DB and drives the real HTTP
 * endpoints the frontend uses. Each SSE ask is aborted right after `node_created`
 * (client disconnect → server aborts the LLM pipeline), so routing and
 * persistence are verified without requiring an LLM.
 *
 * Acceptance covered:
 *  - two unrelated "Home" questions → two independent canvases, no merging
 *  - follow-ups stay in the same canvas with the parent chain preserved
 *  - each canvas persists its own conversation; unknown canvas_id → 404 (no fallback)
 */

let dir: string;
let server: Server | null = null;
let closeDb: () => void = () => {};
let base = "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-routing-"));
  const { app, close } = createApp(path.join(dir, "routing.db"));
  closeDb = close;
  await new Promise<void>((resolve, reject) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve());
    srv.once("error", reject);
    server = srv;
  });
  const addr = server!.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP address");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  closeDb(); // release SQLite handles so Windows can delete the temp dir
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp dir is OS-managed; a locked WAL file must not fail the suite.
  }
});

async function createCanvas(title?: string): Promise<CanvasEntity> {
  const res = await fetch(`${base}/api/canvases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as CanvasEntity;
}

async function graphNodes(canvasId: string): Promise<NodeEntity[]> {
  const res = await fetch(`${base}/api/canvases/${canvasId}/graph`);
  expect(res.ok).toBe(true);
  const g = (await res.json()) as { nodes: NodeEntity[] };
  return g.nodes;
}

/** POST the real /api/nodes/ask and resolve with the first created node, then abort the stream. */
async function askUntilNodeCreated(body: unknown): Promise<NodeEntity> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${base}/api/nodes/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`ask failed: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream ended before node_created");
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const ev = JSON.parse(line.slice(5).trim()) as AskEvent;
        if (ev.type === "node_created") return ev.node;
      }
    }
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // client disconnect → server-side pipeline aborts
  }
}

const threadAsk = (canvasId: string, question: string, parentId: string | null = null) => ({
  canvas_id: canvasId,
  parent_id: parentId,
  branch_origin: parentId ? "followup_box" : "thread",
  question,
  position: { x: 0, y: 0 },
  model_speed: "fast",
  web_search: false,
});

describe("canvas independence (real backend)", () => {
  it("two unrelated questions each get their own canvas and node", async () => {
    // The fixed Home flow: POST /canvases → ask on THAT canvas.
    const a = await createCanvas();
    const b = await createCanvas();
    expect(a.id).not.toBe(b.id);

    const nodeA = await askUntilNodeCreated(threadAsk(a.id, "Why does time slow down near a black hole?"));
    expect(nodeA.canvas_id).toBe(a.id);
    expect(nodeA.parent_id).toBeNull();

    const nodeB = await askUntilNodeCreated(threadAsk(b.id, "What would happen if the Moon disappeared?"));
    expect(nodeB.canvas_id).toBe(b.id);
    expect(nodeB.id).not.toBe(nodeA.id);

    // Each canvas persisted exactly its own question — no merging, no cross-posting.
    const graphA = await graphNodes(a.id);
    const graphB = await graphNodes(b.id);
    expect(graphA.map((n) => n.id)).toEqual([nodeA.id]);
    expect(graphB.map((n) => n.id)).toEqual([nodeB.id]);
    expect(graphA[0]!.question).not.toBe(graphB[0]!.question);
  }, 20_000);

  it("follow-ups stay in the same canvas and preserve the parent chain", async () => {
    const c = await createCanvas();
    const root = await askUntilNodeCreated(threadAsk(c.id, "How do neural networks actually learn?"));
    const followup = await askUntilNodeCreated(threadAsk(c.id, "What role do activation functions play in learning?", root.id));
    const followup2 = await askUntilNodeCreated(threadAsk(c.id, "Why not just use linear combinations instead?", root.id));

    expect(followup.canvas_id).toBe(c.id);
    expect(followup.parent_id).toBe(root.id);
    expect(followup2.canvas_id).toBe(c.id);
    expect(followup2.parent_id).toBe(root.id);

    const graphC = await graphNodes(c.id);
    expect(graphC.length).toBe(3);
    expect(graphC.every((n) => n.canvas_id === c.id)).toBe(true);
    // Both follow-ups branch from the same root — the conversation tree is intact.
    expect(graphC.filter((n) => n.parent_id === root.id).length).toBe(2);
  }, 20_000);

  it("switching canvases restores each one's own conversation", async () => {
    // Simulates navigating canvas → canvas → canvas via the graph endpoint.
    const first = await createCanvas();
    await askUntilNodeCreated(threadAsk(first.id, "Compare classical and operant conditioning."));
    const second = await createCanvas();
    await askUntilNodeCreated(threadAsk(second.id, "Explain quantum computing like I'm 15."));

    const a = await graphNodes(first.id);
    const b = await graphNodes(second.id);
    expect(a[0]!.canvas_id).toBe(first.id);
    expect(b[0]!.canvas_id).toBe(second.id);
    expect(a[0]!.question).toMatch(/conditioning/i);
    expect(b[0]!.question).toMatch(/quantum computing/i);
  }, 20_000);

  it("rejects an ask for an unknown canvas instead of falling back", async () => {
    const res = await fetch(`${base}/api/nodes/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(threadAsk(crypto.randomUUID(), "This canvas does not exist.")),
    });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  }, 20_000);
});
