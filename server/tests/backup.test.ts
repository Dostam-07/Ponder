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
    title: "Test node",
    question: "A question?",
    answer_text: "An answer.",
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
  // <dir>/data/app.db → backups land in <dir>/backups (same layout as production: server/data + server/backups)
  const created = createApp(path.join(dir, "data", "app.db"));
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

interface Backup {
  name: string;
  created_at: number;
  size_bytes: number;
  canvases: number;
  nodes: number;
  integrity: "ok" | "unchecked";
  label: string | null;
}

describe("local backup & restore (roadmap C)", () => {
  let dir: string;
  let h: AppHandle;
  const backupsDir = () => path.join(dir, "backups");

  const listBackups = async (): Promise<Backup[]> => {
    const res = await fetch(`${h.base}/api/backups`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { backups: Backup[] }).backups;
  };

  const canvasTitles = async (): Promise<string[]> => {
    const res = await fetch(`${h.base}/api/canvases`);
    return (((await res.json()) as { title: string }[]).map((c) => c.title));
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-backup-"));
    h = await bootApp(dir);
    // seed: canvas Alpha + one real node
    const alpha = h.created.repos.canvasRepo.create("Alpha canvas");
    h.created.repos.nodeRepo.insert(makeNode(alpha.id, "11111111-1111-1111-1111-111111111111", { question: "Q1", answer_text: "A1" }));
  });

  afterAll(async () => {
    await shutdown(h);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("backs up now: consistent snapshot in the documented local folder, with metadata", async () => {
    const res = await fetch(`${h.base}/api/backups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "first" }),
    });
    expect(res.status).toBe(201);
    const b = (await res.json()) as Backup;
    expect(b.name).toMatch(/^ponder-\d{4}-\d{2}-\d{2}-\d{6}-first\.db$/);
    expect(b.canvases).toBe(1);
    expect(b.nodes).toBe(1);
    expect(b.integrity).toBe("ok"); // validated from the NEW file
    expect(b.size_bytes).toBeGreaterThan(0);
    // the file physically exists in server/…/backups (here: <tmp>/backups)
    const file = path.join(backupsDir(), b.name);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBe(b.size_bytes);
    // sidecar metadata exists too
    expect(fs.existsSync(file.replace(/\.db$/, ".meta.json"))).toBe(true);
  });

  it("restore: rolls the database back, and ALWAYS takes a safety backup of the current state first", async () => {
    // mutate AFTER the backup
    const beta = h.created.repos.canvasRepo.create("Beta canvas");
    h.created.repos.nodeRepo.insert(makeNode(beta.id, "22222222-2222-2222-2222-222222222222", { question: "Q2", answer_text: "A2" }));
    expect(await canvasTitles()).toHaveLength(2);

    const first = (await listBackups()).find((b) => b.label === "first")!;
    const res = await fetch(`${h.base}/api/backups/${encodeURIComponent(first.name)}/restore`, { method: "POST" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { restored: string; safety_backup: string; canvases: number; nodes: number };
    expect(out.restored).toBe(first.name);
    expect(out.canvases).toBe(1);
    expect(out.nodes).toBe(1);

    // the restore is real: Beta is gone
    expect(await canvasTitles()).toEqual(["Alpha canvas"]);
    // the server is still serving (reopened on the restored file)
    const canvases = await fetch(`${h.base}/api/canvases`);
    expect(canvases.status).toBe(200);

    // the safety backup captured the PRE-restore state (2 canvases)
    const safety = (await listBackups()).find((b) => b.name === out.safety_backup);
    expect(safety).toBeDefined();
    expect(safety!.label).toBe(`safety-before-restore-${first.name.replace(/\.db$/, "")}`);
    expect(safety!.canvases).toBe(2);
    expect(safety!.nodes).toBe(2);
    expect(safety!.integrity).toBe("ok");
  });

  it("restoring the safety backup brings the post-restore data back (restore is not a one-way door)", async () => {
    const safety = (await listBackups()).find((b) => (b.label ?? "").startsWith("safety-before-restore"))!;
    const res = await fetch(`${h.base}/api/backups/${encodeURIComponent(safety.name)}/restore`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await canvasTitles()).sort()).toEqual(["Alpha canvas", "Beta canvas"]);
  });

  it("backup history lists all snapshots newest-first with metadata", async () => {
    const list = await listBackups();
    expect(list.length).toBeGreaterThanOrEqual(3); // first + 2 safety backups
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.created_at).toBeGreaterThanOrEqual(list[i]!.created_at);
    for (const b of list) {
      expect(b.size_bytes).toBeGreaterThan(0);
      expect(["ok", "unchecked"]).toContain(b.integrity);
    }
  });

  it("a corrupt backup is rejected BEFORE it can touch the live database", async () => {
    const corrupt = path.join(backupsDir(), "ponder-corrupt.db");
    fs.writeFileSync(corrupt, "this is not a sqlite database");
    const res = await fetch(`${h.base}/api/backups/ponder-corrupt.db/restore`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/integrity|not a database|could not be opened/i);
    // nothing changed
    expect((await canvasTitles()).sort()).toEqual(["Alpha canvas", "Beta canvas"]);
  });

  it("a valid SQLite file without the expected tables is also rejected", async () => {
    // build a real sqlite file that has none of the app's tables
    const Database = (await import("better-sqlite3")).default;
    const stray = path.join(backupsDir(), "ponder-stray.db");
    const d = new Database(stray);
    d.exec("CREATE TABLE unrelated (x INTEGER)");
    d.close();
    const res = await fetch(`${h.base}/api/backups/ponder-stray.db/restore`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/tables/i);
  });

  it("unknown and path-traversal backup names are rejected", async () => {
    expect((await fetch(`${h.base}/api/backups/ponder-nope.db/restore`, { method: "POST" })).status).toBe(400);
    const up = await fetch(`${h.base}/api/backups/${encodeURIComponent("../evil.db")}/restore`, { method: "POST" });
    expect(up.status).toBe(400);
  });

  it("no stray temp files are left behind after restores", () => {
    const dbFile = path.join(dir, "data", "app.db");
    expect(fs.existsSync(`${dbFile}.restore-tmp`)).toBe(false);
    // (WAL files may legitimately exist while the live handle is open; the tmp must not)
  });
});
