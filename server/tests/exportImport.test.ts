import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { FsrsScheduler } from "../src/review/fsrs.js";
import type { NodeEntity } from "@canvas-learn/shared";

function makeNode(canvasId: string, id: string, over: Partial<NodeEntity> = {}): NodeEntity {
  return {
    id,
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "Transistors",
    question: "What is a transistor?",
    answer_text: "A semiconductor switch that controls current.",
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
    created_at: Date.now(),
    updated_at: Date.now(),
    ...over,
  };
}

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

describe("shareable export/import round-trip (roadmap 7)", () => {
  let dirA: string;
  let dirB: string;
  let appA: AppHandle;
  let appB: AppHandle;
  let canvasId: string;

  beforeAll(async () => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-expA-"));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-expB-"));
    appA = await bootApp(dirA);
    appB = await bootApp(dirB);

    const { repos } = appA.created;
    const now = Date.now();
    const canvas = repos.canvasRepo.create("Electronics");
    canvasId = canvas.id;
    const nodeA = makeNode(canvasId, crypto.randomUUID());
    const nodeB = makeNode(canvasId, crypto.randomUUID(), { question: "What is a diode?", title: "Diodes" });
    repos.nodeRepo.insert(nodeA);
    repos.nodeRepo.insert(nodeB);
    repos.mapRepo.create({
      id: crypto.randomUUID(),
      canvas_id: canvasId,
      topic: "Electronics",
      title: "Map: Electronics",
      rationale: "A map of what we explored.",
      branches: [
        { id: crypto.randomUUID(), label: "Transistors", question: "How does a transistor switch current?", node_id: nodeA.id },
        { id: crypto.randomUUID(), label: "Diodes", question: "Why does a diode only conduct one way?", node_id: nodeB.id },
      ],
      created_at: now,
    });
    repos.linkRepo.create(canvasId, nodeA.id, nodeB.id, "both control current");
    repos.cardRepo.insert({
      id: crypto.randomUUID(),
      node_id: nodeA.id,
      canvas_id: canvasId,
      concept: "transistor",
      explanation: "A semiconductor switch.",
      example: "Turns current on/off.",
      source: "conversation",
      notes: "",
      due_at: now,
      times_reviewed: 0,
      last_reviewed_at: null,
      created_at: now,
    });
    repos.materialRepo.insert({
      id: crypto.randomUUID(),
      kind: "text",
      title: "Notes",
      content: "Transistors and diodes are the basics.",
      char_count: 40,
      canvas_id: canvasId,
      summary: "",
      key_points: [],
      concepts: ["transistor", "diode"],
      created_at: now,
    });
  });

  afterAll(async () => {
    await shutdown(appA);
    await shutdown(appB);
    for (const d of [dirA, dirB]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Windows may hold the WAL briefly
      }
    }
  });

  it("exports the full workspace as v2 JSON (map, links, cards, materials)", async () => {
    const r = await fetch(`${appA.base}/api/export`);
    expect(r.status).toBe(200);
    const ex = (await r.json()) as {
      version: number;
      canvases: { canvas: { id: string }; nodes: unknown[]; maps: unknown; links: { source: string }[] }[];
      cards: { concept: string }[];
      materials: { title: string; content: string }[];
    };
    expect(ex.version).toBe(2);
    expect(ex.canvases).toHaveLength(1);
    expect(ex.canvases[0]!.nodes).toHaveLength(2);
    expect(ex.canvases[0]!.maps).toBeTruthy(); // the learning map is included
    expect(ex.canvases[0]!.links).toHaveLength(1);
    expect(ex.cards).toHaveLength(1);
    expect(ex.materials).toHaveLength(1);
    expect(ex.materials[0]!.content).toContain("Transistors"); // content is included for a real share
  });

  it("imports that file into a fresh instance and re-import is idempotent", async () => {
    const ex = (await (await fetch(`${appA.base}/api/export`)).json()) as Record<string, unknown>;
    const first = (
      await (
        await fetch(`${appB.base}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ex) })
      ).json()
    ) as { canvases_imported: number; nodes_imported: number; maps_imported: number; links_imported: number; cards_imported: number; materials_imported: number };
    expect(first.canvases_imported).toBe(1);
    expect(first.nodes_imported).toBe(2);
    expect(first.maps_imported).toBe(1);
    expect(first.links_imported).toBe(1);
    expect(first.cards_imported).toBe(1);
    expect(first.materials_imported).toBe(1);

    // idempotent: re-importing the same file adds nothing
    const second = (
      await (
        await fetch(`${appB.base}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ex) })
      ).json()
    ) as { canvases_imported: number; nodes_imported: number; maps_imported: number };
    expect(second.canvases_imported).toBe(0);
    expect(second.nodes_imported).toBe(0);
    expect(second.maps_imported).toBe(0);

    // the imported workspace exports identically
    const reExport = (await (await fetch(`${appB.base}/api/export`)).json()) as {
      canvases: { canvas: { id: string }; nodes: unknown[] }[];
      materials: unknown[];
    };
    expect(reExport.canvases[0]!.canvas.id).toBe(canvasId);
    expect(reExport.canvases[0]!.nodes).toHaveLength(2);
    expect(reExport.materials).toHaveLength(1);
  });

  it("rejects a non-export payload", async () => {
    const r = await fetch(`${appB.base}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hello: 1 }) });
    expect(r.status).toBe(400);
  });

  it("still imports legacy v1 files (no version field) — backward compatible", async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-expC-"));
    const appC = await bootApp(dir3);
    try {
      const { repos } = appC.created;
      const canvas = repos.canvasRepo.create("Legacy canvas");
      repos.nodeRepo.insert(makeNode(canvas.id, crypto.randomUUID()));
      const legacy = (await (await fetch(`${appC.base}/api/export`)).json()) as Record<string, unknown>;
      delete legacy.version; // v1 files predate the version field

      const r = await fetch(`${appB.base}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legacy) });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { canvases_imported: number };
      expect(body.canvases_imported).toBe(1);
    } finally {
      await shutdown(appC);
      try {
        fs.rmSync(dir3, { recursive: true, force: true });
      } catch {
        // Windows may hold the WAL briefly
      }
    }
  });

  it("rejects unknown/future schema versions instead of mis-importing", async () => {
    const r = await fetch(`${appB.base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 99, canvases: [] }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("99");
    expect(body.error.toLowerCase()).toContain("version");
  });
});
