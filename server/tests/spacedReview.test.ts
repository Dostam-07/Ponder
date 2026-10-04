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

describe("spaced-review integration (createApp + stubbed LLM)", () => {
  let dir: string;
  let base: string;
  let server: Server | undefined;
  let created: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-spaced-"));
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

  async function submit(answers: { topic: string; correct: boolean }[]) {
    const r = await fetch(`${base}/api/exam/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    expect(r.status).toBe(200);
    return r.json();
  }

  it("tracks each exam topic with canonicalized, accumulating FSRS state", async () => {
    await submit([
      { topic: "Transistor", correct: false }, // miss → again
      { topic: "  Diode  ", correct: true }, // hit → good (whitespace must not break the key)
    ]);
    const repo = created.repos.conceptMasteryRepo;
    // canonicalized: "  Diode  " and "diode" are the same concept
    expect(repo.get("diode")).toBeDefined();
    expect(repo.get("  Diode  ")).toBeUndefined();
    expect(repo.get("diode")!.review_state.times_reviewed).toBe(1);
    expect(repo.get("transistor")!.review_state.times_reviewed).toBe(1);
  });

  it("repeated hits push a concept further out; repeated misses keep it near (weak resurfaces first)", async () => {
    const repo = created.repos.conceptMasteryRepo;
    const strongDue1 = repo.get("diode")!.review_state.due_at;
    const weakDue1 = repo.get("transistor")!.review_state.due_at;

    // Second exam: same pattern — hit Diode, miss Transistor.
    await submit([
      { topic: "Diode", correct: true },
      { topic: "Transistor", correct: false },
    ]);

    const strongDue2 = repo.get("diode")!.review_state.due_at;
    const weakDue2 = repo.get("transistor")!.review_state.due_at;

    expect(repo.get("diode")!.review_state.times_reviewed).toBe(2);
    expect(repo.get("transistor")!.review_state.times_reviewed).toBe(2);
    // success stretches the interval (spaced-out), a miss does not
    expect(strongDue2).toBeGreaterThan(strongDue1);
    expect(weakDue2).toBeLessThanOrEqual(weakDue1 + 86400000);
    // the weak topic is due no later than the strong one → it resurfaces first
    expect(weakDue2).toBeLessThanOrEqual(strongDue2);
    expect(weakDue1).toBeLessThanOrEqual(strongDue1);
  });

  it("pipes a weak recall grade into the node's FSRS scheduler", async () => {
    // Stub the LLM grader: the learner's explanation is shaky.
    Object.assign(created.router, {
      generateJsonWithRetry: async () => ({ understanding: "weak", missing: ["gate voltage"], misconception: "thinks it's on/off only", feedback: "You mixed up the roles." }),
    });
    const c = await fetch(`${base}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const canvas = (await c.json()) as { id: string };
    const node = makeNode(canvas.id, Date.now());
    created.repos.nodeRepo.insert(node);
    const before = node.review_state.times_reviewed;

    const r = await fetch(`${base}/api/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: node.id, explanation: "It's like a switch." }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { understanding: string; review_state: { times_reviewed: number; due_at: number } };
    expect(body.understanding).toBe("weak");
    const after = created.repos.nodeRepo.get(node.id)!.review_state;
    expect(after.times_reviewed).toBe(before + 1);
    expect(body.review_state).toEqual(after);
    // a weak recall schedules the node to resurface (due within ~a day, not pushed far out)
    expect(after.due_at - Date.now()).toBeLessThan(2 * 86400000);
  });

  it("GET /api/review/concepts surfaces concepts whose review is due", async () => {
    // Simulate a topic that has come due (e.g. missed repeatedly, FSRS pulled it back).
    const repo = created.repos.conceptMasteryRepo;
    const past = Date.now() - 60_000;
    const rs = new FsrsScheduler().initial();
    repo.upsert({
      concept: "resurface-me",
      canvas_id: null,
      review_state: { ...rs, due_at: past, times_reviewed: 4 },
      created_at: past,
      updated_at: past,
    });

    const r = await fetch(`${base}/api/review/concepts`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { concepts: { concept: string; times_reviewed: number }[] };
    expect(Array.isArray(body.concepts)).toBe(true);
    const surfaced = body.concepts.find((c) => c.concept === "resurface-me");
    expect(surfaced).toBeDefined();
    expect(surfaced!.times_reviewed).toBe(4);
    // a not-yet-due concept (strong "diode", pushed days out) should not surface
    expect(body.concepts.map((c) => c.concept)).not.toContain("diode");
  });
});
