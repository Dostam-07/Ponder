import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline/pipeline.js";
import type { ModelRouter } from "../src/llm/router.js";
import type { GenerateOptions } from "../src/llm/provider.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { NodeRepo } from "../src/db/repos.js";
import { FsrsScheduler } from "../src/review/fsrs.js";
import type { AskEvent, NodeEntity, AskRequest } from "@canvas-learn/shared";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-test-"));
  const { sqlite, db, close } = createDb(path.join(dir, "test.db"));
  runMigrations(sqlite);
  const nodes = new NodeRepo(db);
  const fsrs = new FsrsScheduler();
  const now = Date.now();
  const canvasId = crypto.randomUUID();
  // canvas row must exist before nodes reference it (FK)
  db.run(
    sql`INSERT INTO canvases (id, title, created_at, updated_at) VALUES (${canvasId}, ${"Test canvas"}, ${now}, ${now})`,
  );
  const parent: NodeEntity = {
    id: crypto.randomUUID(),
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "Root",
    question: "What is the water cycle?",
    answer_text: "Water moves in a [[cycle]].",
    key_terms: ["cycle"],
    suggested_followups: [],
    tags: [],
    visual: null,
    position: { x: 0, y: 0 },
    material_id: null,
    sections: [],
    note: "",
    important: false,
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
    review_state: fsrs.initial(),
    created_at: now,
    updated_at: now,
  };
  nodes.insert(parent);
  return { nodes, parent, dir, close };
}

function makeChild(parent: NodeEntity, nodes: NodeRepo): NodeEntity {
  const child: NodeEntity = {
    ...parent,
    id: crypto.randomUUID(),
    parent_id: parent.id,
    question: "How does rain form?",      answer_text: "",
      mode: "",
      sources: [],
      gaps: [],
    key_terms: [],
    status: "answering",
    review_state: new FsrsScheduler().initial(),
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  nodes.insert(child);
  return child;
}

const baseReq: AskRequest = {
  canvas_id: "00000000-0000-0000-0000-000000000000",
  parent_id: null,
  branch_origin: "followup_box",
  question: "How does rain form?",
  position: { x: 0, y: 0 },
  model_speed: "fast",
  web_search: false,
};

interface FakeRouterOpts {
  answer?: string;
  meta?: unknown;
  visual?: string;
  /** streams a partial delta, invokes onRetry, then streams the full answer (failover path) */
  failoverFirstCandidate?: boolean;
  stage1Error?: string;
}

function makeRouter(opts: FakeRouterOpts): ModelRouter {
  return {
    generateWithFailover: async (
      _speed: string,
      genOpts: GenerateOptions,
      onDelta?: (c: string) => void,
      onRetry?: () => void,
    ) => {
      if (genOpts.system.includes("friendly, precise learning tutor")) {
        if (opts.stage1Error) throw new Error(opts.stage1Error);
        if (opts.failoverFirstCandidate) {
          onDelta?.("PARTIAL GARBAGE ");
          onRetry?.();
        }
        for (const chunk of (opts.answer ?? "").match(/.{1,5}/gs) ?? []) onDelta?.(chunk);
        return { text: opts.answer ?? "", provider: "fake", model: "fake-model" };
      }
      // stage 3 (visual) — returns the scripted raw text for JSON.parse
      return { text: opts.visual ?? "", provider: "fake", model: "fake-model" };
    },
    generateJson: async () => opts.meta ?? {},
  } as unknown as ModelRouter;
}

describe("runPipeline", () => {
  it("streams deltas, parses key terms, and emits stage2 metadata", async () => {
    const { nodes, parent, dir, close } = setup();
    const child = makeChild(parent, nodes);
    const events: AskEvent[] = [];
    await runPipeline(
      child,
      [parent],
      { request: baseReq, abort: new AbortController().signal },
      {
        router: makeRouter({
          answer: "Rain forms when [[water vapor]] cools and condenses into droplets.",
          meta: { title: "Rain Formation", followups: ["a", "b", "c"], tags: ["rain"] },
        }),
        nodes,
      },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });

    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(events.some((e) => e.type === "stage2" && e.title === "Rain Formation")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(stored?.key_terms).toEqual(["water vapor"]);
    expect(stored?.model_used).toBe("fake:fake-model");
  });

  it("clears partial output with a reset event on mid-stream failover", async () => {
    const { nodes, parent, dir, close } = setup();
    const child = makeChild(parent, nodes);
    const events: AskEvent[] = [];
    await runPipeline(
      child,
      [parent],
      { request: baseReq, abort: new AbortController().signal },
      {
        router: makeRouter({
          answer: "Clean second-attempt answer.",
          failoverFirstCandidate: true,
          meta: { title: "T", followups: [], tags: [] },
        }),
        nodes,
      },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(events.some((e) => e.type === "reset")).toBe(true);
    // no PARTIAL GARBAGE may survive in the final text
    expect(stored?.answer_text).toBe("Clean second-attempt answer.");
    expect(stored?.answer_text).not.toContain("PARTIAL");
  });

  it("reports an honest visual failure without failing the completed answer", async () => {
    // Regression: a swallowed visual failure used to masquerade as a "none"
    // success (the UI said "no visual fit this content" even though the model
    // output was garbage). Now: node stays complete, no fake "visual" event,
    // a "failed" visual block is persisted (retryable via the Visualize action),
    // and the real reason rides the visual_status event.
    const { nodes, parent, dir, close } = setup();
    const child = makeChild(parent, nodes);
    const events: AskEvent[] = [];
    await runPipeline(
      child,
      [parent],
      { request: baseReq, abort: new AbortController().signal },
      {
        router: makeRouter({ answer: "Answer with [[term]].", visual: "NOT JSON AT ALL", meta: { title: "T" } }),
        nodes,
      },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(stored?.status).toBe("complete"); // the answer is unaffected
    expect(stored?.visual).toEqual({ type: "none", status: "failed", spec: null });
    expect(events.find((e) => e.type === "visual")).toBeUndefined(); // no success event
    const failed = events.find((e) => e.type === "visual_status" && (e as { status: string }).status === "failed") as
      | { message: string }
      | undefined;
    expect(failed).toBeDefined();
    expect(failed!.message).toMatch(/couldn't be read/);
    expect(events.some((e) => e.type === "done")).toBe(true); // pipeline finished normally
  });

  it("marks the node failed and emits error when stage 1 blows up", async () => {
    const { nodes, parent, dir, close } = setup();
    const child = makeChild(parent, nodes);
    const events: AskEvent[] = [];
    await runPipeline(
      child,
      [parent],
      { request: baseReq, abort: new AbortController().signal },
      { router: makeRouter({ stage1Error: "Ollama is dead" }), nodes },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(events.some((e) => e.type === "error" && e.message.includes("Ollama is dead"))).toBe(true);
    expect(stored?.status).toBe("failed");
  });

  // Regression: a model that returns an EMPTY completion used to be recorded as
  // "complete" with answer_text="", and the sections stage then invented filler
  // like "No explanation was provided…". Empty answers must fail the node instead.
  it("marks the node failed (no invented sections) when the answer is empty", async () => {
    const { nodes, parent, dir, close } = setup();
    const child = makeChild(parent, nodes);
    const events: AskEvent[] = [];
    await runPipeline(
      child,
      [parent],
      { request: baseReq, abort: new AbortController().signal },
      {
        router: makeRouter({
          answer: "   ",
          // if the sections stage ever ran on an empty answer it would return this filler
          meta: {},
        }),
        nodes,
      },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(stored?.status).toBe("failed");
    expect(stored?.sections).toEqual([]);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
    const eventsText = JSON.stringify(events);
    expect(eventsText).not.toContain("No explanation was provided");
  });

  it("never writes sections when the answer carries no real words", async () => {
    const { nodes, parent, dir, close } = setup();
    const child = makeChild(parent, nodes);
    const events: AskEvent[] = [];
    // The mock router returns this filler from generateJson — the pipeline must
    // not even call it (guarded by the empty-answer check) and must fail the node.
    const filleredRouter = {
      ...makeRouter({ answer: "" }),
      generateJson: async () => ({ sections: [{ heading: "The concept", body: "No explanation was provided." }] }),
    } as unknown as ModelRouter;
    await runPipeline(
      child,
      [parent],
      { request: baseReq, abort: new AbortController().signal },
      { router: filleredRouter, nodes },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(stored?.status).toBe("failed");
    expect(stored?.sections).toEqual([]);
  });
});
