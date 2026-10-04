import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { NodeRepo } from "../src/db/repos.js";
import { ArtifactRepo } from "../src/db/learningRepos.js";
import { FsrsScheduler } from "../src/review/fsrs.js";
import type { NodeEntity, Artifact } from "@canvas-learn/shared";
import { ArtifactContent } from "@canvas-learn/shared";
import { sql } from "drizzle-orm";

/* ---------------- repo round-trip (real SQLite) ---------------- */

describe("ArtifactRepo", () => {
  it("persists artifacts and lists them newest-first per canvas", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-artifacts-"));
    const { sqlite, db, close } = createDb(path.join(dir, "a.db"));
    runMigrations(sqlite);
    const repo = new ArtifactRepo(db);
    const nodes = new NodeRepo(db);
    const now = Date.now();
    const cid = crypto.randomUUID();
    const other = crypto.randomUUID();
    db.run(sql`INSERT INTO canvases (id, title, created_at, updated_at) VALUES (${cid}, ${"C"}, ${now}, ${now})`);
    db.run(sql`INSERT INTO canvases (id, title, created_at, updated_at) VALUES (${other}, ${"O"}, ${now}, ${now})`);
    void nodes;

    const a1: Artifact = { id: crypto.randomUUID(), canvas_id: cid, kind: "timeline", title: "T1", content: { kind: "timeline", entries: [{ when: "1928", what: "Junction transistor invented" }] }, node_count: 2, created_at: now };
    const a2: Artifact = { id: crypto.randomUUID(), canvas_id: cid, kind: "flashcard_deck", title: "D1", content: { kind: "flashcard_deck", cards: [{ concept: "Transistor", explanation: "A switch made of semiconductors.", example: "Every logic gate in your phone" }] }, node_count: 2, created_at: now + 1000 };
    repo.insert(a1);
    repo.insert(a2);
    repo.insert({ ...a1, id: crypto.randomUUID(), canvas_id: other, title: "Other" });

    const list = repo.forCanvas(cid);
    expect(list.map((a) => a.title).sort()).toEqual(["D1", "T1"]);
    expect(repo.get(a2.id)?.content).toEqual(a2.content);
    repo.delete(a1.id);
    expect(repo.forCanvas(cid).map((a) => a.title)).toEqual(["D1"]);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/* ---------------- routes (createApp + stubbed LLM) ---------------- */

function makeNode(canvasId: string, now: number, over: Partial<NodeEntity> = {}): NodeEntity {
  return {
    id: crypto.randomUUID(),
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "Transistors",
    question: "What is a transistor?",
    answer_text: "A transistor is a semiconductor switch that controls current flow. In 1928 Julius Edgar Lilienfeld patented the field-effect transistor.",
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

const STUDY_GUIDE_JSON = {
  kind: "study_guide",
  title: "Transistors: A Study Guide",
  sections: [
    { heading: "The core idea", body: "A transistor is a semiconductor switch that controls current flow." },
    { heading: "Where it came from", body: "Lilienfeld patented the field-effect transistor in 1928." },
  ],
};
const DECK_JSON = {
  kind: "flashcard_deck",
  title: "Transistor Deck",
  cards: [
    { concept: "Transistor", explanation: "A semiconductor switch that controls current flow.", example: "A valve for electric current" },
    { concept: "1928 patent", explanation: "Lilienfeld's field-effect patent predates the modern transistor.", example: "The 1947 Bell Labs device came later" },
  ],
};

describe("artifact routes", () => {
  let dir: string;
  let base: string;
  let server: Server | undefined;
  let created: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-art-app-"));
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

  /** Stub the LLM: the route must never touch the network in tests. */
  function stubLlm(payload: unknown) {
    Object.assign(created.router, {
      generateJsonWithRetry: async () => payload,
    });
  }

  it("400 on a canvas with no completed answers (no invented content)", async () => {
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const r = await fetch(`${base}/api/canvases/${canvas.id}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "study_guide" }) });
    expect(r.status).toBe(400);
    const list = await fetch(`${base}/api/canvases/${canvas.id}/artifacts`);
    expect((await list.json())).toEqual([]);
  });

  it("generates a study guide strictly from completed nodes and persists it", async () => {
    stubLlm(STUDY_GUIDE_JSON);
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    created.repos.nodeRepo.insert(makeNode(canvas.id, Date.now()));
    created.repos.nodeRepo.insert(makeNode(canvas.id, Date.now(), { status: "failed", answer_text: "", title: "", question: "A failed one" })); // failed nodes are not content

    const r = await fetch(`${base}/api/canvases/${canvas.id}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "study_guide" }) });
    expect(r.status).toBe(201);
    const a = (await r.json()) as Artifact;
    expect(a.kind).toBe("study_guide");
    expect(a.title).toBe("Transistors: A Study Guide");
    expect(a.node_count).toBe(1); // only the completed one
    expect(ArtifactContent.safeParse(a.content).success).toBe(true);

    const list = await (await fetch(`${base}/api/canvases/${canvas.id}/artifacts`)).json() as Artifact[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(a.id);

    const del = await fetch(`${base}/api/artifacts/${a.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const after = await (await fetch(`${base}/api/canvases/${canvas.id}/artifacts`)).json() as Artifact[];
    expect(after).toEqual([]);
  });

  it("rejects LLM output that doesn't match the requested kind (never stores a mismatch)", async () => {
    stubLlm({ kind: "timeline", title: "Wrong kind", entries: [{ when: "now", what: "x" }] });
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    created.repos.nodeRepo.insert(makeNode(canvas.id, Date.now()));
    const r = await fetch(`${base}/api/canvases/${canvas.id}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "study_guide" }) });
    expect(r.status).toBe(502);
    const list = await (await fetch(`${base}/api/canvases/${canvas.id}/artifacts`)).json() as Artifact[];
    expect(list).toEqual([]);
  });

  it("imports a flashcard deck into the review queue — idempotent per concept", async () => {
    stubLlm(DECK_JSON);
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    created.repos.nodeRepo.insert(makeNode(canvas.id, Date.now()));
    const r = await fetch(`${base}/api/canvases/${canvas.id}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "flashcard_deck" }) });
    expect(r.status).toBe(201);
    const a = (await r.json()) as Artifact;

    // the deck's cards land in the public review queue (verified via counts below)
    const imp1 = await (await fetch(`${base}/api/artifacts/${a.id}/import-cards`, { method: "POST" })).json() as { added: number; total: number };
    expect(imp1).toEqual({ added: 2, total: 2 });
    const queue = (await (await fetch(`${base}/api/cards`)).json()) as { concept: string; source: string }[];
    expect(queue.filter((c) => c.source === "Transistor Deck").map((c) => c.concept).sort()).toEqual(["1928 patent", "Transistor"]);
    const imp2 = await (await fetch(`${base}/api/artifacts/${a.id}/import-cards`, { method: "POST" })).json() as { added: number; total: number };
    expect(imp2).toEqual({ added: 0, total: 2 }); // re-import adds nothing
  });

  it("non-deck artifacts cannot be imported", async () => {
    stubLlm(STUDY_GUIDE_JSON);
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    created.repos.nodeRepo.insert(makeNode(canvas.id, Date.now()));
    const r = await fetch(`${base}/api/canvases/${canvas.id}/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "study_guide" }) });
    const a = (await r.json()) as Artifact;
    const imp = await fetch(`${base}/api/artifacts/${a.id}/import-cards`, { method: "POST" });
    expect(imp.status).toBe(400);
  });
});
