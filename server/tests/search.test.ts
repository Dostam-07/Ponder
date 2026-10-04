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
    title: "",
    question: "Q",
    answer_text: "A",
    key_terms: [],
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

interface Hit {
  node_id: string;
  canvas_id: string;
  canvas_title: string;
  title: string;
  question: string;
  field: "question" | "answer" | "term" | "title";
  snippet: string;
  score: number;
}

describe("global search across the learning map (roadmap B)", () => {
  let dir: string;
  let h: AppHandle;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-search-"));
    h = await bootApp(dir);
    const sky = h.created.repos.canvasRepo.create("Sky color");
    const osm = h.created.repos.canvasRepo.create("Osmosis basics");
    ids.n1 = "aaaaaaaa-1111-1111-1111-111111111111";
    ids.n2 = "aaaaaaaa-2222-2222-2222-222222222222";
    ids.n3 = "bbbbbbbb-3333-3333-3333-333333333333";
    ids.n4 = "bbbbbbbb-4444-4444-4444-444444444444";
    h.created.repos.nodeRepo.insert(
      makeNode(sky.id, ids.n1, {
        question: "Why is the sky blue?",
        answer_text: "Rayleigh scattering by air molecules bends the short wavelengths.",
        key_terms: ["Rayleigh scattering", "wavelength"],
      }),
    );
    h.created.repos.nodeRepo.insert(
      makeNode(sky.id, ids.n2, {
        question: "Why is a sunset red?",
        answer_text: "The longer path through the atmosphere scatters away the blue, leaving red.",
      }),
    );
    h.created.repos.nodeRepo.insert(
      makeNode(osm.id, ids.n3, {
        question: "What is osmosis?",
        answer_text: "The movement of water across a semipermeable membrane.",
        key_terms: ["membrane", "water"],
      }),
    );
    h.created.repos.nodeRepo.insert(
      makeNode(osm.id, ids.n4, {
        question: "What is a semipermeable membrane?",
        answer_text: "A barrier that lets water through but not solutes.",
      }),
    );
  });

  afterAll(async () => {
    await shutdown(h);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const search = async (q: string, limit?: number): Promise<Hit[]> => {
    const url = `${h.base}/api/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    return ((await res.json()) as { results: Hit[] }).results;
  };

  it("finds a term only present in key_terms and labels the field", async () => {
    const hits = await search("rayleigh");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const top = hits[0]!;
    expect(top.node_id).toBe(ids.n1);
    expect(top.field).toBe("term");
    expect(top.canvas_title).toBe("Sky color");
    expect(top.snippet.length).toBeGreaterThan(0);
    expect(top.snippet.length).toBeLessThanOrEqual(130);
  });

  it("finds a question hit and ranks it above an answer-only hit for the same word", async () => {
    const hits = await search("blue");
    const n1 = hits.find((x) => x.node_id === ids.n1)!;
    const n2 = hits.find((x) => x.node_id === ids.n2)!;
    expect(n1).toBeDefined();
    expect(n2).toBeDefined();
    expect(n1.field).toBe("question");
    expect(n2.field).toBe("answer");
    expect(n1.score).toBeGreaterThan(n2.score);
    expect(hits[0]!.node_id).toBe(ids.n1); // best first
  });

  it("attributes every hit to its real source canvas", async () => {
    for (const q of ["osmosis", "membrane", "water"]) {
      for (const hit of await search(q)) {
        if (hit.node_id === ids.n3 || hit.node_id === ids.n4) expect(hit.canvas_title).toBe("Osmosis basics");
        if (hit.node_id === ids.n1 || hit.node_id === ids.n2) expect(hit.canvas_title).toBe("Sky color");
        expect(hit.canvas_id).toBeTruthy();
      }
    }
  });

  it("is case-insensitive", async () => {
    expect((await search("OSMOSIS")).map((x) => x.node_id)).toContain(ids.n3);
  });

  it("returns empty (never an error) for no matches and for an empty query", async () => {
    expect(await search("zzzznotthere")).toEqual([]);
    expect(await search("   ")).toEqual([]);
  });

  it("respects the limit", async () => {
    const two = await search("water", 2);
    expect(two.length).toBeLessThanOrEqual(2);
    expect((await search("water")).length).toBeGreaterThanOrEqual(two.length);
  });
});
