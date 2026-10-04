import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stripInstructions,
  capAtWord,
  deriveCanvasTitle,
  isArtifactTitle,
  planTitleRepair,
  planTitleRepairs,
  type TitleRepairNode,
} from "../src/db/canvasTitles.js";
import { createDb, type Sqlite } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { CanvasRepo, NodeRepo } from "../src/db/repos.js";
import { createApp } from "../src/app.js";
import type { NodeEntity } from "@canvas-learn/shared";

describe("stripInstructions — clean titles from real questions", () => {
  it("removes trailing instruction scaffolding", () => {
    expect(stripInstructions("What is gravity? Answer in one sentence.")).toBe("What is gravity?");
    expect(stripInstructions("What is a black hole? Answer in two sentences.")).toBe("What is a black hole?");
    expect(stripInstructions("Compare React and Vue. Answer briefly.")).toBe("Compare React and Vue.");
    expect(stripInstructions("Explain photosynthesis in three sentences")).toBe("Explain photosynthesis");
    expect(stripInstructions("What is entropy? Keep it short.")).toBe("What is entropy?");
  });

  it("removes a leading 'please' (case preserved — capitalization is deriveCanvasTitle's job)", () => {
    expect(stripInstructions("Please explain osmosis")).toBe("explain osmosis");
    expect(deriveCanvasTitle("please explain osmosis")).toBe("Explain osmosis");
  });

  it("keeps legitimate questions untouched", () => {
    expect(stripInstructions("What is the water cycle?")).toBe("What is the water cycle?");
    expect(stripInstructions("Why do answers vary by model?")).toBe("Why do answers vary by model?");
    expect(stripInstructions("How does photosynthesis happen?")).toBe("How does photosynthesis happen?");
  });

  it("caps at a word boundary, never mid-word", () => {
    const long = "What are the differences between the React and Vue and Svelte and Angular front-end frameworks?";
    const out = stripInstructions(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith(" ")).toBe(false);
    // Must be a prefix that ends on a space or at the cap (no partial word kept as a full token).
    expect(long.startsWith(out)).toBe(true);
    const next = long[out.length];
    expect(next === undefined || next === " ").toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(stripInstructions("")).toBe("");
    expect(stripInstructions("   ")).toBe("");
  });
});

describe("capAtWord", () => {
  it("passes short strings through", () => {
    expect(capAtWord("Black Hole", 60)).toBe("Black Hole");
  });
  it("cuts at the last space before the cap", () => {
    expect(capAtWord("a b c d e f g h i j k l m n o p q r s t u v w x y z", 20)).toBe("a b c d e f g h i j");
  });
});

describe("deriveCanvasTitle — real content only, never invented", () => {
  it("prefers the stage-2 AI title", () => {
    expect(deriveCanvasTitle("What is gravity? Answer in one sentence.", "Gravity")).toBe("Gravity");
  });
  it("falls back to the cleaned question when the AI title is missing", () => {
    expect(deriveCanvasTitle("Why do leaves change color in autumn? Answer in two sentences.", "")).toBe(
      "Why do leaves change color in autumn?",
    );
    expect(deriveCanvasTitle("How does photosynthesis happen?", undefined)).toBe("How does photosynthesis happen?");
  });
  it("returns empty when there is no real content", () => {
    expect(deriveCanvasTitle("", undefined)).toBe("");
    expect(deriveCanvasTitle("", "")).toBe("");
  });
});

describe("isArtifactTitle — technical prefixes vs legit topics", () => {
  it("flags test-session artifacts", () => {
    expect(isArtifactTitle("E2E Water 2")).toBe(true);
    expect(isArtifactTitle("E2E Water Test")).toBe(true);
    expect(isArtifactTitle("Smoke Test")).toBe(true);
    expect(isArtifactTitle("Test 1")).toBe(true);
    expect(isArtifactTitle("Session 3")).toBe(true);
    expect(isArtifactTitle("Debug")).toBe(true);
    expect(isArtifactTitle("Untitled canvas")).toBe(true);
  });

  it("does NOT flag legitimate topics (including genuine E2E-testing topics)", () => {
    expect(isArtifactTitle("Playwright E2E Testing")).toBe(false);
    expect(isArtifactTitle("E2E Testing in Playwright")).toBe(false);
    expect(isArtifactTitle("Test-Driven Development")).toBe(false);
    expect(isArtifactTitle("Testing in general")).toBe(false);
    expect(isArtifactTitle("Debug the null pointer")).toBe(false);
    expect(isArtifactTitle("What is a black hole?")).toBe(false);
    expect(isArtifactTitle("Interest Rates and Inflation")).toBe(false);
    expect(isArtifactTitle("")).toBe(false);
  });
});

describe("planTitleRepair — content-derived replacements", () => {
  const nodes = (ns: [string, string, string][]): TitleRepairNode[] =>
    ns.map(([title, question, status]) => ({ title, question, status }));

  it("replaces an artifact title with the first completed node's topic title", () => {
    const plan = planTitleRepair(
      { id: "c1", title: "E2E Water 2" },
      nodes([
        ["Water and Its States", "Explain water and its states.", "complete"],
        ["States of Matter", "What are the states of matter?", "complete"],
      ]),
    );
    expect(plan).toEqual({ id: "c1", from: "E2E Water 2", to: "Water and Its States" });
  });

  it("uses the cleaned first question when only failed nodes exist", () => {
    const plan = planTitleRepair(
      { id: "c2", title: "Smoke Test" },
      nodes([["", "Why do leaves change color in autumn? Answer in two sentences.", "failed"]]),
    );
    expect(plan?.to).toBe("Why do leaves change color in autumn?");
  });

  it("skips canvases with no real content (no invented topics)", () => {
    expect(planTitleRepair({ id: "c3", title: "E2E Water Test" }, [])).toBeNull();
    expect(planTitleRepair({ id: "c4", title: "Smoke Test" }, nodes([["", "", "failed"]]))).toBeNull();
  });

  it("never touches meaningful titles", () => {
    expect(planTitleRepair({ id: "c5", title: "Playwright E2E Testing" }, nodes([["E2E Runs", "How do E2E runs work?", "complete"]]))).toBeNull();
    expect(planTitleRepair({ id: "c6", title: "What is the water cycle?" }, nodes([["Water Cycle", "What is the water cycle?", "complete"]]))).toBeNull();
  });

  it("repairs untitled canvases that already have a conversation", () => {
    const plan = planTitleRepair({ id: "c7", title: "Untitled canvas" }, nodes([["Gravity", "What is gravity?", "complete"]]));
    expect(plan?.to).toBe("Gravity");
  });

  it("re-derives titles that are truncated heads of the canvas's first question (old slice(0,40) artifacts)", () => {
    const plan = planTitleRepair(
      { id: "c9", title: "What is a black hole? Answer in two sent" },
      nodes([["What is a black hole? Answer in two sent", "What is a black hole? Answer in two sentences.", "complete"]]),
    );
    expect(plan?.to).toBe("What is a black hole?");
  });

  it("never plans a no-op rename (a title that already is the cleaned question)", () => {
    // "Why do leaves change color in autumn?" is a prefix of the full question,
    // so it must NOT be re-derived to itself on every startup.
    expect(
      planTitleRepair(
        { id: "c11", title: "Why do leaves change color in autumn?" },
        nodes([["", "Why do leaves change color in autumn? Answer in two sentences.", "failed"]]),
      ),
    ).toBeNull();
  });

  it("keeps a title that equals its question in full (complete question, not a truncation)", () => {
    expect(
      planTitleRepair(
        { id: "c10", title: "What is the water cycle?" },
        nodes([["What is the water cycle?", "What is the water cycle?", "complete"]]),
      ),
    ).toBeNull();
  });

  it("is idempotent — a repaired title is never re-planned", () => {
    const first = planTitleRepair({ id: "c8", title: "E2E Water 2" }, nodes([["Water and Its States", "q", "complete"]]))!;
    expect(planTitleRepair({ id: "c8", title: first.to }, nodes([["Water and Its States", "q", "complete"]]))).toBeNull();
  });

  it("plans many canvases at once, skipping the untouched", () => {
    const plan = planTitleRepairs(
      [
        { id: "a", title: "E2E Water 2" },
        { id: "b", title: "Interest Rates and Inflation" },
        { id: "c", title: "Untitled canvas" },
      ],
      new Map([
        ["a", nodes([["Water and Its States", "Explain water", "complete"]])],
        ["b", nodes([["Interest Rates", "Why do rates matter?", "complete"]])],
        ["c", nodes([["", "How does photosynthesis happen?", "failed"]])],
      ]),
    );
    expect(plan).toEqual([
      { id: "a", from: "E2E Water 2", to: "Water and Its States" },
      { id: "c", from: "Untitled canvas", to: "How does photosynthesis happen?" },
    ]);
  });
});

describe("startup repair (real DB through createApp)", () => {
  let dir: string;
  let sqlite: Sqlite;
  let canvasRepo: CanvasRepo;
  let nodeRepo: NodeRepo;

  const makeNode = (id: string, canvasId: string, over: Partial<NodeEntity> = {}): NodeEntity => ({
    id,
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "",
    question: "q",
    answer_text: "a",
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
    review_state: { due_at: 0, interval_days: 1, ease: 0, stability: 0, difficulty: 0, last_reviewed_at: null, times_reviewed: 0 },
    created_at: 1,
    updated_at: 1,
    ...over,
  });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-titles-"));
    const dbPath = path.join(dir, "titles.db");
    const { sqlite: handle, db } = createDb(dbPath);
    sqlite = handle;
    runMigrations(sqlite);
    canvasRepo = new CanvasRepo(db);
    nodeRepo = new NodeRepo(db);
  });

  afterAll(() => {
    sqlite.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dir is OS-managed */
    }
  });

  it("repairs artifact + untitled titles at startup, preserves meaningful ones, keeps ids/content", () => {
    // Seed shapes mirror the real production DB.
    const cE2e = canvasRepo.create("E2E Water 2");
    const cSmoke = canvasRepo.create("Smoke Test");
    const cUntitled = canvasRepo.create("Untitled canvas");
    const cLegit = canvasRepo.create("Playwright E2E Testing");
    const cEmpty = canvasRepo.create("Smoke Test");

    nodeRepo.insert(makeNode("n1", cE2e.id, { title: "Water and Its States", question: "Explain water and its states." }));
    nodeRepo.insert(makeNode("n2", cSmoke.id, { title: "What is the water cycle?", question: "What is the water cycle?" }));
    nodeRepo.insert(makeNode("n3", cUntitled.id, { status: "failed", answer_text: "", question: "Why do leaves change color in autumn? Answer in two sentences." }));
    nodeRepo.insert(makeNode("n4", cLegit.id, { title: "E2E Runs", question: "How do E2E runs work?" }));
    // cEmpty: no nodes at all

    // Boot the real app on this DB — the startup repair must run.
    const { close } = createApp(path.join(dir, "titles.db"));
    close();

    const after = Object.fromEntries(canvasRepo.list().map((c) => [c.id, c.title]));
    expect(after[cE2e.id]).toBe("Water and Its States");
    expect(after[cSmoke.id]).toBe("What is the water cycle?");
    expect(after[cUntitled.id]).toBe("Why do leaves change color in autumn?");
    expect(after[cLegit.id]).toBe("Playwright E2E Testing"); // meaningful topic — untouched
    expect(after[cEmpty.id]).toBe("Smoke Test"); // no real content — kept, not invented

    // Ids and conversation content preserved.
    expect(nodeRepo.get("n1")!.canvas_id).toBe(cE2e.id);
    expect(nodeRepo.get("n3")!.question).toBe("Why do leaves change color in autumn? Answer in two sentences.");

    // Idempotent: booting again changes nothing.
    const before = Object.fromEntries(canvasRepo.list().map((c) => [c.id, c.title]));
    const { close: close2 } = createApp(path.join(dir, "titles.db"));
    close2();
    const second = Object.fromEntries(canvasRepo.list().map((c) => [c.id, c.title]));
    expect(second).toEqual(before);
  }, 30_000);
});
