import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { extractPdfText } from "../src/util/pdfText.js";
import { runPipeline } from "../src/pipeline/pipeline.js";
import type { ModelRouter } from "../src/llm/router.js";
import type { GenerateOptions } from "../src/llm/provider.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";
import { NodeRepo } from "../src/db/repos.js";
import { MaterialRepo } from "../src/db/learningRepos.js";
import { FsrsScheduler } from "../src/review/fsrs.js";
import type { AskEvent, NodeEntity, AskRequest, SourceMaterial } from "@canvas-learn/shared";
import { sql } from "drizzle-orm";

/* ---------------- minimal real PDF builder (for extraction tests) ---------------- */

function makePdf(contentStream: string): Buffer {
  const stream = deflateSync(Buffer.from(contentStream, "latin1"));
  const head =
    `%PDF-1.4\n` +
    `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n` +
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n` +
    `4 0 obj << /Length ${stream.length} /Filter /FlateDecode >> stream\n`;
  const tail =
    `\nendstream\nendobj\n` +
    `5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n` +
    `trailer << /Root 1 0 R /Size 6 >>\n%%EOF`;
  return Buffer.concat([Buffer.from(head, "latin1"), stream, Buffer.from(tail, "latin1")]);
}

const PDF_CONTENT =
  "BT\n/F1 12 Tf\n72 700 Td\n(The mitochondria is the powerhouse of the cell.) Tj\n0 -20 Td\n[(Photosynthesis) -250 (converts light energy.)] TJ\nET";

describe("extractPdfText (real PDF bytes, no fixtures)", () => {
  it("extracts Tj and TJ text from a FlateDecode content stream", () => {
    const text = extractPdfText(makePdf(PDF_CONTENT));
    expect(text).toContain("The mitochondria is the powerhouse of the cell.");
    expect(text).toContain("Photosynthesis converts light energy.");
  });

  it("extracts every line from a multi-line (text) Tj T* stream without swallowing operators", () => {
    // Regression: the old greedy regex captured from the first `(` to the LAST
    // `) Tj` in the stream, pulling `) Tj T*` operator text into the result.
    const multi =
      "BT /F1 11 Tf 72 740 Td 16 TL\n" +
      "(Osmosis Study Notes) Tj T*\n" +
      "() Tj T*\n" +
      "(Osmosis is the movement of water across a semipermeable membrane.) Tj T*\n" +
      "(A cell in a hypotonic solution gains water.) Tj\n" +
      "ET";
    const text = extractPdfText(makePdf(multi));
    expect(text).toContain("Osmosis Study Notes");
    expect(text).toContain("Osmosis is the movement of water across a semipermeable membrane.");
    expect(text).toContain("A cell in a hypotonic solution gains water.");
    // no PDF operator text may leak into the extraction
    expect(text).not.toMatch(/Tj|T\*|Tf|Td/);
    // the empty () line must not produce a stray line
    expect(text).not.toMatch(/\n\s*\n\s*\n/);
  });

  it("rejects non-PDF bytes", () => {
    expect(() => extractPdfText(Buffer.from("hello world, definitely not a pdf"))).toThrow(/Not a valid PDF/);
  });

  it("rejects a PDF with no readable literal text (hex strings only) — never invents content", () => {
    expect(() => extractPdfText(makePdf("BT /F1 12 Tf 72 700 Td <00410042> Tj ET"))).toThrow(/Could not extract/);
  });
});

/* ---------------- pipeline provenance (stub router, real DB) ---------------- */

function provRouter(prov: unknown): ModelRouter {
  return {
    generateWithFailover: async (_s: string, genOpts: GenerateOptions, onDelta?: (c: string) => void) => {
      if (genOpts.system.includes("friendly, precise learning tutor")) {
        const full = "The cell makes ATP in its mitochondria.";
        for (const c of full.match(/.{1,6}/gs) ?? []) onDelta?.(c);
        return { text: full, provider: "fake", model: "fake" };
      }
      return { text: "", provider: "fake", model: "fake" }; // visual stage → empty → "none"
    },
    generateJson: async (_s: string, genOpts: GenerateOptions) => {
      if (genOpts.system.includes("auditing the provenance")) return prov;
      return { title: "Mitochondria", followups: [], tags: [] };
    },
  } as unknown as ModelRouter;
}

function pipelineSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-sources-"));
  const { sqlite, db, close } = createDb(path.join(dir, "sources.db"));
  runMigrations(sqlite);
  const nodes = new NodeRepo(db);
  const now = Date.now();
  const canvasId = crypto.randomUUID();
  db.run(sql`INSERT INTO canvases (id, title, created_at, updated_at) VALUES (${canvasId}, ${"Sources test"}, ${now}, ${now})`);
  const base: NodeEntity = {
    id: crypto.randomUUID(),
    canvas_id: canvasId,
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "Root",
    question: "What is a cell?",
    answer_text: "A cell is the basic unit of life.",
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
    created_at: now,
    updated_at: now,
  };
  nodes.insert(base);
  return { nodes, base, dir, close };
}

const baseReq: AskRequest = {
  canvas_id: "00000000-0000-0000-0000-000000000000",
  parent_id: null,
  branch_origin: "thread",
  question: "Where does the cell make ATP?",
  position: { x: 0, y: 0 },
  model_speed: "fast",
  web_search: false,
};

describe("pipeline provenance audit", () => {
  it("stores a sourced provenance record with the verbatim quote when grounded in a material", async () => {
    const { nodes, base, dir, close } = pipelineSetup();
    const child: NodeEntity = { ...base, id: crypto.randomUUID(), question: baseReq.question, answer_text: "", status: "answering", material_id: crypto.randomUUID() };
    nodes.insert(child);
    const events: AskEvent[] = [];
    await runPipeline(
      child,
      [base],
      {
        request: baseReq,
        abort: new AbortController().signal,
        material: { title: "Biology notes", content: "The mitochondria is the powerhouse of the cell. It makes ATP." },
      },
      { router: provRouter({ status: "sourced", quote: "powerhouse of the cell" }), nodes },
      (e) => events.push(e),
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(stored?.status).toBe("complete");
    expect(stored?.provenance).toEqual({ status: "sourced", quote: "powerhouse of the cell", material_id: child.material_id });
    // Regression: the done event must carry the FINAL node, otherwise the client
    // card keeps provenance: null (the audit is written after stage 2) and the
    // "From your source" badge never renders without a full refetch.
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.node?.provenance).toEqual({ status: "sourced", quote: "powerhouse of the cell", material_id: child.material_id });
      expect(done.node?.status).toBe("complete");
    }
  });

  it("leaves provenance null for plain answers (no material, no web) — nothing to audit", async () => {
    const { nodes, base, dir, close } = pipelineSetup();
    const child: NodeEntity = { ...base, id: crypto.randomUUID(), answer_text: "", status: "answering" };
    nodes.insert(child);
    await runPipeline(child, [base], { request: baseReq, abort: new AbortController().signal }, { router: provRouter({ status: "sourced" }), nodes }, () => undefined);
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(stored?.provenance).toBeNull();
  });

  it("ignores a malformed provenance response (never invents an audit) and the ask still completes", async () => {
    const { nodes, base, dir, close } = pipelineSetup();
    const child: NodeEntity = { ...base, id: crypto.randomUUID(), answer_text: "", status: "answering", material_id: crypto.randomUUID() };
    nodes.insert(child);
    await runPipeline(
      child,
      [base],
      { request: baseReq, abort: new AbortController().signal, material: { title: "M", content: "content" } },
      { router: provRouter({ status: "definitely-not-valid" }), nodes },
      () => undefined,
    );
    const stored = nodes.get(child.id);
    close();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(stored?.provenance).toBeNull();
    expect(stored?.status).toBe("complete");
  });
});

/* ---------------- upload + Source Explorer routes (createApp, real HTTP) ---------------- */

describe("source workspace routes", () => {
  let dir: string;
  let url: string;
  let server: import("node:http").Server | undefined;
  let closeDb: () => void;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-src-app-"));
    const created = createApp(path.join(dir, "app.db"));
    closeDb = created.close;
    await new Promise<void>((resolve, reject) => {
      const srv = created.app.listen(0, "127.0.0.1", () => resolve());
      srv.once("error", reject);
      server = srv;
    });
    const addr = server!.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    url = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    closeDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly
    }
  });

  const canvasId = async (): Promise<string> => {
    const r = await fetch(`${url}/api/canvases`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return ((await r.json()) as { id: string }).id;
  };

  it("uploads a .txt file with extracted text and canvas attachment", async () => {
    const cid = await canvasId();
    const content = "Mitochondria produce most of the cell's ATP through cellular respiration.";
    const r = await fetch(`${url}/api/materials/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "cell notes.txt", content_base64: Buffer.from(content, "utf8").toString("base64"), canvas_id: cid }),
    });
    expect(r.status).toBe(201);
    const m = (await r.json()) as SourceMaterial;
    expect(m.kind).toBe("text");
    expect(m.title).toBe("cell notes");
    expect(m.content).toBe(content);
    expect(m.canvas_id).toBe(cid);
  });

  it("uploads a real PDF and extracts its text", async () => {
    const r = await fetch(`${url}/api/materials/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "bio.pdf", content_base64: makePdf(PDF_CONTENT).toString("base64") }),
    });
    expect(r.status).toBe(201);
    const m = (await r.json()) as SourceMaterial;
    expect(m.kind).toBe("pdf");
    expect(m.title).toBe("bio");
    expect(m.content).toContain("mitochondria is the powerhouse");
  });

  it("rejects unsupported extensions and unreadable PDFs with clear errors", async () => {
    const exe = await fetch(`${url}/api/materials/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "virus.exe", content_base64: Buffer.from("MZ...").toString("base64") }),
    });
    expect(exe.status).toBe(400);
    const badPdf = await fetch(`${url}/api/materials/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "broken.pdf", content_base64: Buffer.from("not a pdf at all").toString("base64") }),
    });
    expect(badPdf.status).toBe(422);
  });

  it("GET /api/canvases/:id/sources aggregates materials; pending nodes are not audited", async () => {
    const cid = await canvasId();
    const up = await fetch(`${url}/api/materials/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "phys.txt", content_base64: Buffer.from("Static electricity is a buildup of electric charge on surfaces.", "utf8").toString("base64"), canvas_id: cid }),
    });
    const mat = (await up.json()) as SourceMaterial;
    // pending nodes via the public endpoint (same path the app uses)
    const n1 = await fetch(`${url}/api/canvases/${cid}/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_origin: "material", question: "What is static electricity?", position: { x: 0, y: 0 }, material_id: mat.id }),
    });
    expect(n1.status).toBe(201);
    const n2 = await fetch(`${url}/api/canvases/${cid}/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_origin: "thread", question: "How do magnets work?", position: { x: 0, y: 200 } }),
    });
    expect(n2.status).toBe(201);

    const src = await fetch(`${url}/api/canvases/${cid}/sources`);
    expect(src.status).toBe(200);
    const body = (await src.json()) as {
      materials: { id: string; title: string; canvas_id: string | null; cited_by: number; summary: string }[];
      answers: { node_id: string; provenance: unknown }[];
    };
    const mine = body.materials.find((m) => m.id === mat.id)!;
    expect(mine).toBeDefined();
    expect(mine.canvas_id).toBe(cid);
    expect(typeof mine.cited_by).toBe("number");
    // neither node is complete yet → the audit list must be empty (no invented rows)
    expect(body.answers).toEqual([]);
  });

  it("MaterialRepo: listForCanvas = attached + global only; updateMeta persists generation results", () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-matrepo-"));
    const { sqlite, db, close } = createDb(path.join(dir2, "m.db"));
    runMigrations(sqlite);
    const mat = new MaterialRepo(db);
    const now = Date.now();
    const cid = crypto.randomUUID();
    const global: SourceMaterial = { id: crypto.randomUUID(), kind: "text", title: "G", content: "g", char_count: 1, canvas_id: null, summary: "", key_points: [], concepts: [], created_at: now };
    const attached: SourceMaterial = { ...global, id: crypto.randomUUID(), title: "A", canvas_id: cid };
    mat.insert(global);
    mat.insert(attached);
    mat.insert({ ...global, id: crypto.randomUUID(), title: "O", canvas_id: crypto.randomUUID() });

    expect(mat.listForCanvas(cid).map((m) => m.title).sort()).toEqual(["A", "G"]);
    mat.updateMeta(attached.id, { summary: "An attached source.", key_points: ["p1"], concepts: ["c1"] });
    const re = mat.get(attached.id);
    expect(re?.summary).toBe("An attached source.");
    expect(re?.key_points).toEqual(["p1"]);
    expect(re?.concepts).toEqual(["c1"]);
    close();
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});
