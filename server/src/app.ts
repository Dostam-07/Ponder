import express, { type Request, type Response } from "express";
import cors from "cors";
import type { Db } from "./db/client.js";

import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { canvases, appState, learningPaths, thinkingMaps, nodes } from "./db/schema.js";
import { eq, desc, or, like, sql } from "drizzle-orm";
import path from "node:path";
import { CanvasRepo, NodeRepo, LibraryRepo, rowToNode } from "./db/repos.js";
import { deriveCanvasTitle, planTitleRepair } from "./db/canvasTitles.js";
import { PathRepo, PracticeRepo, CardRepo, MaterialRepo, LinkRepo, ThinkingMapRepo, ArtifactRepo, ConceptMasteryRepo } from "./db/learningRepos.js";
import { StatsRepo } from "./db/stats.js";
import { FsrsScheduler } from "./review/fsrs.js";
import { ModelRouter } from "./llm/router.js";
import { PictureGenerationError } from "./llm/openrouter.js";
import { runPipeline, generatePicture, generateVisual } from "./pipeline/pipeline.js";
import { generateJsonLenient } from "./pipeline/llmJson.js";
import {
  PRACTICE_SYSTEM,
  practicePrompt,
  GRADE_SYSTEM,
  gradePrompt,
  CARD_SYSTEM,
  cardPrompt,
  PATH_SYSTEM,
  pathPrompt,
  MAP_SYSTEM,
  mapPrompt,
  CONNECTIONS_SYSTEM,
  connectionsPrompt,
  RECALL_SYSTEM,
  recallPrompt,
  ARTIFACT_SYSTEMS,
  artifactPrompt,
  RECAP_SYSTEM,
  recapPrompt,
} from "./pipeline/prompts.js";
import {
  AskRequest,
  NodeEntity,
  type AskEvent,
  type Position,
  LearningProfile,
  Exercise,
  DEFAULT_PROFILE,
  type LearningPath,
  type KnowledgeCard,
  type SourceMaterial,
  type MaterialSummary,
  type PracticeAttempt,
  type ThinkingMap,
  type MapBranch,
  ExamRequest,
  ExamSubmitRequest,
  conceptKey,
  MaterialUploadInput,
  CanvasSources,
  Artifact,
  ArtifactContent,
  OpenRouterPreferences,
  UpdateOpenRouterPreferences,
} from "@canvas-learn/shared";
import { z } from "zod";
import { extractPdfText } from "./util/pdfText.js";
import { createBackupManager } from "./backup.js";

/** req.params with noUncheckedIndexedAccess handled. */
function p(req: Request, name: string): string {
  return req.params[name] as string;
}

function safeJson(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Saved model preferences shape (Settings → Models), validated defensively. */
function parseSavedModels(value: unknown): { fast: string | null; quality: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ok = (x: unknown) => x === null || (typeof x === "string" && x.length > 0 && x.length <= 120);
  if (ok(v.fast) && ok(v.quality)) return { fast: v.fast as string | null, quality: v.quality as string | null };
  return null;
}

function loadSavedModels(database: Db, router: ModelRouter): void {
  const row = database.select().from(appState).where(eq(appState.key, "models")).get();
  const saved = parseSavedModels(safeJson(row?.value));
  if (saved) router.setSavedModels(saved.fast, saved.quality);
}

function readOpenRouterPreferences(database: Db): OpenRouterPreferences {
  const row = database.select().from(appState).where(eq(appState.key, "openrouter")).get();
  const parsed = OpenRouterPreferences.safeParse(safeJson(row?.value) ?? {});
  return parsed.success ? parsed.data : { api_key: null, image_model: null, prefer_openrouter: null };
}

/** Load a canvas's stored personalization profile (defaults when unset). */
function makeProfileLoader(database: Db) {
  return (canvasId: string): LearningProfile => {
    const row = database.select().from(appState).where(eq(appState.key, `profile:${canvasId}`)).get();
    const parsed = row ? LearningProfile.safeParse(safeJson(row.value)) : null;
    return parsed?.success ? parsed.data : DEFAULT_PROFILE;
  };
}

/** Fetch a web page and extract readable text for study material (spec §12). */
async function fetchMaterialUrl(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Ponder study material fetcher)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.trim().slice(0, 160) : "";
  // strip scripts/styles/tags, collapse whitespace — plain readable text only
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: text.slice(0, 200_000) };
}

export function createApp(dbPath: string) {
  const ctx = createDb(dbPath);
  const { db } = ctx;
  runMigrations(ctx.sqlite);

  const canvasRepo = new CanvasRepo(db);
  const nodeRepo = new NodeRepo(db);
  const libraryRepo = new LibraryRepo(db);
  const pathRepo = new PathRepo(db);
  const practiceRepo = new PracticeRepo(db);
  const cardRepo = new CardRepo(db);
  const materialRepo = new MaterialRepo(db);
  const linkRepo = new LinkRepo(db);
  const mapRepo = new ThinkingMapRepo(db);
  const artifactRepo = new ArtifactRepo(db);
  const conceptMasteryRepo = new ConceptMasteryRepo(db);
  const statsRepo = new StatsRepo(db, practiceRepo, cardRepo, () => nodeRepo.listDue(Date.now()).length);
  // Any node left "answering" by a previous process can never finish — surface it as failed so the user can Regenerate.
  nodeRepo.markOrphanedAsFailed();

  // Repair conversation titles left by test sessions ("E2E Water 2", "Smoke Test")
  // and untitled canvases that already have a real conversation. Titles are derived
  // from actual node content (stage-2 title, else cleaned question) — never invented.
  // Idempotent: a repaired title no longer matches the artifact rule.
  for (const c of canvasRepo.list()) {
    const nodesInOrder = nodeRepo.listByCanvas(c.id).sort((a, b) => a.created_at - b.created_at);
    const plan = planTitleRepair(c, nodesInOrder.map((n) => ({ title: n.title, question: n.question, status: n.status })));
    if (plan) {
      canvasRepo.rename(plan.id, plan.to);
      console.log(`[titles] "${plan.from}" → "${plan.to}" (canvas ${plan.id})`);
    }
  }
  const fsrs = new FsrsScheduler();
  const router = new ModelRouter();
  // Restore saved model preferences (Settings → Models) — the second rung of the
  // precedence ladder (env var > saved > documented default, see modelConfig.ts).
  loadSavedModels(db, router);
  router.setOpenRouterSettings(readOpenRouterPreferences(db));
  const profileOf = makeProfileLoader(db);
  // Local backup & restore (roadmap C): consistent snapshots in <data>/../backups
  // (i.e. server/backups/ for the default data dir). Optional scheduled local
  // snapshots via CANVAS_BACKUP_EVERY_HOURS=<n> (off by default).
  const backups = createBackupManager(() => ctx.sqlite, path.join(path.dirname(ctx.path), "..", "backups"), ctx.path);
  const backupHours = Number(process.env.CANVAS_BACKUP_EVERY_HOURS);
  if (Number.isFinite(backupHours) && backupHours > 0) backups.startScheduled(backupHours);

  const app = express();
  app.use(cors({ origin: true }));
  // Picture data is embedded in workspace exports. Allow image-bearing imports
  // through this parser before the small-body default used by other routes.
  app.use("/api/import", express.json({ limit: "64mb" }));
  app.use(express.json({ limit: "1mb" }));
  // API responses must never be cached — graphs change constantly.
  app.use("/api", (_req: Request, res: Response, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // ---------- health & config ----------
  app.get("/api/health", async (_req: Request, res: Response) => {
    const caps = await router.capabilities();
    res.json({ ok: true, ...caps });
  });

  // ---------- OpenRouter connection (write-only key; redacted reads) ----------
  app.get("/api/settings/openrouter", (_req: Request, res: Response) => {
    res.json(router.openRouterSettings());
  });

  app.put("/api/settings/openrouter", (req: Request, res: Response) => {
    const parsed = UpdateOpenRouterPreferences.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid OpenRouter settings", detail: parsed.error.flatten() });
    const next = { ...readOpenRouterPreferences(db), ...parsed.data };
    db.insert(appState)
      .values({ key: "openrouter", value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: appState.key, set: { value: JSON.stringify(next) } })
      .run();
    router.setOpenRouterSettings(next);
    res.json(router.openRouterSettings());
  });

  app.post("/api/settings/openrouter/test", async (_req: Request, res: Response) => {
    try {
      await router.openrouter.testConnection();
      res.json({ ok: true, message: "OpenRouter accepted your API key. Your connection is ready." });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Could not reach OpenRouter" });
    }
  });

  // ---------- model preferences (Settings → Models) ----------
  // Precedence: env var > saved preference (if still installed) > documented
  // default. `effectiveModels()` reports the source so the UI can explain
  // exactly what is in effect (e.g. env overriding the saved choice).
  app.get("/api/settings/models", async (req: Request, res: Response) => {
    await router.ensureInstalledModels(req.query.refresh === "1");
    res.json(router.effectiveModels());
  });

  app.put("/api/settings/models", async (req: Request, res: Response) => {
    const parsed = z
      .object({
        fast: z.string().min(1).max(120).nullable().optional(),
        quality: z.string().min(1).max(120).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid model settings", detail: parsed.error.flatten() });
    const body = parsed.data;
    const installed = await router.ensureInstalledModels();
    if (installed.length === 0) {
      return res.status(503).json({ error: "Ollama unreachable — cannot validate the selected models (start it and retry)" });
    }
    // Omitted roles keep their current saved preference.
    const current = router.effectiveModels();
    const next: { fast: string | null; quality: string | null } = {
      fast: body.fast !== undefined ? body.fast : current.fast.saved,
      quality: body.quality !== undefined ? body.quality : current.quality.saved,
    };
    for (const role of ["fast", "quality"] as const) {
      if (next[role] && !installed.includes(next[role]!)) {
        return res.status(400).json({ error: `${role} model "${next[role]}" is not installed in Ollama — pick from the detected list` });
      }
    }
    db.insert(appState)
      .values({ key: "models", value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: appState.key, set: { value: JSON.stringify(next) } })
      .run();
    router.setSavedModels(next.fast, next.quality);
    res.json(router.effectiveModels());
  });

  // ---------- local backup & restore (roadmap C) ----------
  app.get("/api/backups", (_req: Request, res: Response) => {
    res.json({ backups: backups.list(), database_path: ctx.path, backups_path: backups.dir });
  });

  app.post("/api/backups", async (req: Request, res: Response) => {
    const body = z.object({ label: z.string().max(60).nullable().optional() }).parse(req.body ?? {});
    res.status(201).json(await backups.create(body.label ?? null));
  });

  app.post("/api/backups/:name/restore", async (req: Request, res: Response) => {
    const name = p(req, "name");
    const verr = backups.validate(name);
    if (verr) return res.status(400).json({ error: verr });
    try {
      // 1) re-validate + 2) safety snapshot of the CURRENT database (live handle)
      const { safetyName, backupFile } = await backups.prepareRestore(name);
      // 3) close the live connection (WAL checkpoints on close). The DbContext
      //    proxy keeps every repository wired across the swap.
      ctx.close();
      try {
        // 4) stage the copy, re-validate it, atomically swap the file
        backups.performSwap(backupFile);
      } catch (err) {
        // The original file is still in place — reopen so the server keeps serving.
        ctx.swap();
        throw err;
      }
      // 5) reopen the restored file and bring in-memory state in line with it.
      ctx.swap();
      runMigrations(ctx.sqlite); // idempotent — the backup may predate schema additions
      loadSavedModels(db, router); // model preferences come from the restored app_state
      router.setOpenRouterSettings(readOpenRouterPreferences(db));
      nodeRepo.markOrphanedAsFailed(); // in-flight nodes can't survive the swap
      const canvases = canvasRepo.list();
      res.json({
        restored: name,
        safety_backup: safetyName,
        canvases: canvases.length,
        nodes: canvases.reduce((a, c) => a + c.node_count, 0),
      });
    } catch (err) {
      res.status(500).json({ error: `Restore failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ---------- global search across the learning map (roadmap B) ----------
  // SQL LIKE over every node (question, answer, key terms, title) joined to its
  // canvas — fully local, over the same rows the app already stores. Ranked:
  // question > title > key term > answer body, with a bonus for front-of-text hits.
  app.get("/api/search", (req: Request, res: Response) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ results: [] as object[] });
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 50);
    const pat = `%${q.replace(/[%_\\]/g, "")}%`;
    const rows = db
      .select({
        id: nodes.id,
        canvas_id: nodes.canvas_id,
        title: nodes.title,
        question: nodes.question,
        answer_text: nodes.answer_text,
        key_terms: nodes.key_terms,
        created_at: nodes.created_at,
        canvas_title: canvases.title,
      })
      .from(nodes)
      .innerJoin(canvases, eq(nodes.canvas_id, canvases.id))
      .where(or(like(nodes.question, pat), like(nodes.title, pat), like(nodes.key_terms, pat), like(nodes.answer_text, pat)))
      .all();

    const ql = q.toLowerCase();
    const scored = rows.map((r) => {
      const termText = Array.isArray(safeJson(r.key_terms)) ? (safeJson(r.key_terms) as string[]).join(" ") : r.key_terms;
      const has = (s: string) => s.toLowerCase().includes(ql);
      const qHit = has(r.question);
      const tHit = has(r.title);
      const termHit = has(termText);
      const aHit = has(r.answer_text);
      // field priority for display: question > title > term > answer
      const field = qHit ? "question" : tHit ? "title" : termHit ? "term" : "answer";
      const sourceText = field === "answer" ? r.answer_text : field === "term" ? termText : field === "title" ? r.title : r.question;
      let score = (qHit ? 40 : 0) + (tHit ? 30 : 0) + (termHit ? 25 : 0) + (aHit ? 10 : 0);
      if (q.length >= 4 && sourceText.toLowerCase().slice(0, 80).includes(ql)) score += 15;
      // ~120-char snippet centered on the first match
      const idx = sourceText.toLowerCase().indexOf(ql);
      const start = Math.max(0, idx - 40);
      const snippet =
        (start > 0 ? "…" : "") + sourceText.slice(start, start + 120).replace(/\s+/g, " ").trim() +
        (start + 120 < sourceText.length ? "…" : "");
      return {
        node_id: r.id,
        canvas_id: r.canvas_id,
        canvas_title: r.canvas_title,
        title: r.title,
        question: r.question,
        field,
        snippet: snippet || r.question.slice(0, 120),
        score,
        created_at: r.created_at,
      };
    });
    scored.sort((a, b) => b.score - a.score || b.created_at - a.created_at);
    res.json({ results: scored.slice(0, limit) });
  });

  app.get("/api/stats", (_req: Request, res: Response) => {
    res.json(statsRepo.getStats());
  });

  // ---------- canvases ----------
  app.get("/api/canvases", (_req: Request, res: Response) => {
    res.json(canvasRepo.list());
  });

  app.post("/api/canvases", (req: Request, res: Response) => {
    const body = z.object({ title: z.string().min(1).max(120).optional() }).parse(req.body ?? {});
    res.status(201).json(canvasRepo.create(body.title ?? "Untitled canvas"));
  });

  app.get("/api/canvases/:id", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    res.json(canvas);
  });

  app.patch("/api/canvases/:id", (req: Request, res: Response) => {
    const body = z.object({ title: z.string().min(1).max(120) }).parse(req.body);
    const updated = canvasRepo.rename(p(req, "id"), body.title);
    if (!updated) return res.status(404).json({ error: "Canvas not found" });
    res.json(updated);
  });

  app.delete("/api/canvases/:id", (req: Request, res: Response) => {
    canvasRepo.delete(p(req, "id"));
    res.status(204).end();
  });

  // ---------- nodes / graph ----------
  app.get("/api/canvases/:id/graph", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const nodes = nodeRepo.listByCanvas(p(req, "id"));
    res.json({
      canvas: { id: canvas.id, title: canvas.title, created_at: canvas.created_at, updated_at: canvas.updated_at },
      nodes,
      links: linkRepo.forCanvas(canvas.id),
      path: pathRepo.forCanvas(canvas.id),
      map: mapRepo.forCanvas(canvas.id),
    });
  });

  app.post("/api/canvases/:id/nodes", (req: Request, res: Response) => {
    const body = z
      .object({
        branch_origin: z.enum(["thread", "followup_box", "term_chip", "suggested_question", "manual_plus", "regenerate", "path_section", "material"]),
        question: z.string().min(1).max(2000),
        position: z.object({ x: z.number(), y: z.number() }),
        parent_id: z.string().uuid().nullable().optional(),
        material_id: z.string().uuid().optional(),
        profile: LearningProfile.optional(),
        explain_like: z.string().max(120).optional(),
      })
      .parse(req.body);
    const now = Date.now();
    const node: NodeEntity = {
      id: crypto.randomUUID(),
      canvas_id: p(req, "id"),
      parent_id: body.parent_id ?? null,
      branch_origin: body.branch_origin,
      status: "pending",
      title: "",
      question: body.question,
      answer_text: "",
      key_terms: [],
      suggested_followups: [],
      tags: [],
      visual: null,
      position: body.position satisfies Position,
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
      material_id: body.material_id ?? null,
      sections: [],
      note: "",
      important: false,
      review_state: fsrs.initial(),
      created_at: now,
      updated_at: now,
    };
    nodeRepo.insert(node);
    canvasRepo.touch(p(req, "id"));
    statsRepo.registerActivity();
    statsRepo.addStars(1); // +1 star per node created
    res.status(201).json(node);
  });

  app.patch("/api/nodes/:id", (req: Request, res: Response) => {
    const body = z
      .object({
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        width: z.number().min(280).max(900).optional(),
        collapsed: z.boolean().optional(),
        saved_to_library: z.boolean().optional(),
        title: z.string().max(120).optional(),
        note: z.string().max(2000).optional(),
        important: z.boolean().optional(),
      })
      .parse(req.body);
    const existing = nodeRepo.get(p(req, "id"));
    if (!existing) return res.status(404).json({ error: "Node not found" });
    nodeRepo.update(p(req, "id"), body);
    if (body.saved_to_library) {
      const n = nodeRepo.get(p(req, "id"))!;
      libraryRepo.insert({
        id: crypto.randomUUID(),
        canvas_id: n.canvas_id,
        node_id: n.id,
        title: n.title || n.question.slice(0, 60),
        question: n.question,
        answer_text: n.answer_text,
        visual_type: n.visual?.type ?? null,
        visual_spec: n.visual?.spec ?? null,
        tags: n.tags,
        saved_at: Date.now(),
      });
    }
    res.json(nodeRepo.get(p(req, "id")));
  });

  app.delete("/api/nodes/:id", (req: Request, res: Response) => {
    const doomed = nodeRepo.deleteSubtree(p(req, "id"));
    res.json({ deleted: doomed });
  });

  // ---------- ask (SSE pipeline) ----------
  app.post("/api/nodes/ask", (req: Request, res: Response) => {
    const parsed = AskRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid ask request", detail: parsed.error.flatten() });
    }
    const ask = parsed.data;
    const canvas = canvasRepo.get(ask.canvas_id);
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emit = (e: AskEvent) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const abort = new AbortController();
    // NB: req "close" fires as soon as the body is consumed; only abort when the
    // client actually disconnects before the stream ends.
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    // Title the conversation from the FIRST real Q&A content, and only while
    // the canvas is still "Untitled canvas" — so follow-up questions never
    // rename (title stability) and nothing is ever invented.
    const titleConversation = (canvasId: string, question: string, aiTitle?: string): void => {
      const derived = deriveCanvasTitle(question, aiTitle);
      if (!derived) return;
      const c = canvasRepo.get(canvasId);
      if (!c || (c.title !== "Untitled canvas" && c.title.trim() !== "")) return;
      canvasRepo.rename(canvasId, derived);
      emit({ type: "canvas_titled", canvas_id: canvasId, title: derived });
    };

    (async () => {
      // Declared outside the try so the finally (fallback naming) can see the
      // node whether it was created here or resolved for regeneration.
      let node: NodeEntity | undefined;
      try {
        let chain: NodeEntity[] = [];

        if (ask.branch_origin === "regenerate" && ask.regenerate_of) {
          node = nodeRepo.get(ask.regenerate_of);
          if (!node) return emit({ type: "error", node_id: null, message: "Node to regenerate not found" });
          nodeRepo.update(node.id, { status: "answering", answer_text: "", key_terms: [], suggested_followups: [] });
        } else {
          // material grounding (spec §12): resolve the source before creating the node
          node = {
            id: crypto.randomUUID(),
            canvas_id: ask.canvas_id,
            parent_id: ask.parent_id,
            branch_origin: ask.branch_origin,
            status: "answering",
            title: "",
            question: ask.question,
            answer_text: "",
            key_terms: [],
            suggested_followups: [],
            tags: [],
            visual: null,
            position: ask.position,
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
            material_id: ask.material_id ?? null,
            sections: [],
            note: "",
            important: false,
            review_state: fsrs.initial(),
            created_at: Date.now(),
            updated_at: Date.now(),
          };
          nodeRepo.insert(node);
          canvasRepo.touch(ask.canvas_id);
          statsRepo.registerActivity();
          statsRepo.addStars(1);
        }

        emit({ type: "node_created", node });

        // ancestor chain: root → ... → parent
        let cur = node.parent_id ? nodeRepo.get(node.parent_id) : undefined;
        while (cur) {
          chain.unshift(cur);
          cur = cur.parent_id ? nodeRepo.get(cur.parent_id) : undefined;
        }

        // personalization: request-level profile wins over the canvas default (spec §3)
        const profile = ask.profile ?? DEFAULT_PROFILE;
        const material = ask.material_id
          ? (() => {
              const m = materialRepo.get(ask.material_id);
              return m ? { title: m.title, content: m.content } : undefined;
            })()
          : undefined;

        await runPipeline(
          node,
          chain,
          {
            request: ask,
            abort: abort.signal,
            profile,
            material,
            // Name the conversation the moment the answer settles — not at
            // pipeline end (the post-answer enhancements can take minutes).
            onAnswerSettled: (_nodeId, title, question) => titleConversation(ask.canvas_id, question, title),
          },
          { router, nodes: nodeRepo },
          emit,
        );
      } catch (err) {
        emit({ type: "error", node_id: null, message: err instanceof Error ? err.message : String(err) });
      } finally {
        // Fallback naming: if the pipeline failed before the answer settled
        // (no onAnswerSettled), still title the conversation from the real
        // question. On the success path the canvas is already named → no-op.
        if (node) {
          const settled = nodeRepo.get(node.id);
          titleConversation(ask.canvas_id, settled?.question ?? ask.question, (settled?.title ?? "").trim() || undefined);
        }
        res.end();
      }
    })();
  });

  // ---------- review (FSRS) ----------
  app.get("/api/review/due", (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 50);
    res.json(nodeRepo.listDue(Date.now(), Math.min(Math.max(limit, 1), 200)));
  });

  app.post("/api/review/:nodeId", (req: Request, res: Response) => {
    const body = z.object({ grade: z.enum(["again", "hard", "good", "easy"]) }).parse(req.body);
    const node = nodeRepo.get(p(req, "nodeId"));
    if (!node) return res.status(404).json({ error: "Node not found" });
    const next = fsrs.grade(node.review_state, body.grade);
    nodeRepo.update(node.id, { review_state: next });
    statsRepo.registerActivity();
    statsRepo.addStars(2); // +2 stars per completed review
    res.json({ review_state: next, stats: statsRepo.getStats() });
  });

  // ---------- library ----------
  app.get("/api/library", (_req: Request, res: Response) => {
    res.json(libraryRepo.list());
  });

  app.delete("/api/library/:id", (req: Request, res: Response) => {
    libraryRepo.delete(p(req, "id"));
    res.status(204).end();
  });

  // ---------- export / import (PRD FR21) ----------
  /**
   * Shareable export (roadmap 7): the full learning workspace as one JSON file —
   * canvases + nodes + per-canvas thinking maps + concept links + knowledge cards +
   * source materials (with content). Local-first: a file you send to someone IS the share.
   */
  app.get("/api/export", (req: Request, res: Response) => {
    const canvases = canvasRepo.list();
    const all = canvases.map((c) => ({
      canvas: c,
      nodes: nodeRepo.listByCanvas(c.id),
      maps: mapRepo.forCanvas(c.id),
      links: linkRepo.forCanvasFull(c.id),
    }));
    res.setHeader("Content-Disposition", 'attachment; filename="ponder-learning-map.json"');
    res.json({
      app: "ponder",
      version: 2,
      exported_at: new Date().toISOString(),
      canvases: all,
      cards: cardRepo.list(),
      materials: materialRepo.listFull(),
    });
  });

  app.post("/api/import", (req: Request, res: Response) => {
    const raw = req.body as {
      canvases?: {
        canvas: { id: string; title?: string; created_at?: number; updated_at?: number };
        nodes?: NodeEntity[];
        maps?: ThinkingMap | null;
        links?: { id: string; source: string; target: string; label?: string; created_at?: number }[];
      }[];
      cards?: KnowledgeCard[];
      materials?: SourceMaterial[];
    };
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.canvases)) {
      return res.status(400).json({ error: "Not a valid Ponder export file" });
    }
    // Incompatible schema versions are rejected explicitly, never mis-imported:
    // legacy v1 files (no version field) and v2 are supported; anything else is
    // a different Ponder version.
    const version = (raw as { version?: unknown }).version;
    if (version != null && version !== 1 && version !== 2) {
      return res.status(400).json({ error: `Unsupported export version ${String(version)} — this file came from a different Ponder version` });
    }
    const now = Date.now();
    let canvasesImported = 0;
    let nodesImported = 0;
    let mapsImported = 0;
    let linksImported = 0;
    let cardsImported = 0;
    let materialsImported = 0;
    for (const c of raw.canvases.slice(0, 200)) {
      const cv = c?.canvas;
      if (!cv?.id || canvasRepo.get(cv.id)) continue; // id collision → skip (idempotent re-import)
      db.insert(canvases)
        .values({ id: cv.id, title: cv.title ?? "Imported canvas", created_at: cv.created_at ?? now, updated_at: cv.updated_at ?? now })
        .run();
      canvasesImported++;
      for (const n of c.nodes ?? []) {
        if (!n?.id || n.canvas_id !== cv.id || nodeRepo.get(n.id)) continue;
        nodeRepo.insert(n);
        nodesImported++;
      }
      if (c.maps?.id) {
        mapRepo.create(c.maps);
        mapsImported++;
      }
      for (const l of c.links ?? []) {
        if (!l?.id || !l.source || !l.target || linkRepo.getLink(l.id)) continue;
        linkRepo.insertLink({ id: l.id, canvas_id: cv.id, source: l.source, target: l.target, label: l.label ?? "", created_at: l.created_at ?? now });
        linksImported++;
      }
    }
    for (const m of raw.materials ?? []) {
      if (!m?.id || materialRepo.get(m.id)) continue;
      materialRepo.insert(m);
      materialsImported++;
    }
    for (const k of raw.cards ?? []) {
      if (!k?.id || cardRepo.get(k.id)) continue;
      cardRepo.insert(k);
      cardsImported++;
    }
    res.json({
      canvases_imported: canvasesImported,
      nodes_imported: nodesImported,
      maps_imported: mapsImported,
      links_imported: linksImported,
      cards_imported: cardsImported,
      materials_imported: materialsImported,
    });
  });

  // ---------- canvas-wide summary node (M7) ----------
  app.post("/api/canvases/:id/summarize", async (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const nodes = nodeRepo.listByCanvas(canvas.id).filter((n) => n.status === "complete");
    if (nodes.length === 0) return res.status(400).json({ error: "No completed nodes to summarize" });
    const material = nodes.map((n) => `Q: ${n.question}\nA: ${n.answer_text.slice(0, 500)}`).join("\n\n").slice(0, 12000);
    try {
      const meta = (await generateJsonLenient(router, "fast", {
        system:
          'You output ONLY a JSON object, no other text. Shape: {"summary": "<max 150 words reviewing what the learner explored on this canvas, second person, encouraging tone>", "title": "<max 4 words, like Session Review: Topic>"}',
        prompt: `Canvas: ${canvas.title}\n\nQ&A exchanges:\n${material}`,
        temperature: 0.3,
        maxTokens: 350,
      })) as { summary?: string; title?: string };
      const now = Date.now();
      const node: NodeEntity = {
        id: crypto.randomUUID(),
        canvas_id: canvas.id,
        parent_id: null,
        branch_origin: "thread",
        status: "complete",
        title: (meta.title ?? "Session Review").slice(0, 60),
        question: `Summarize what I learned on "${canvas.title}"`,
        answer_text: meta.summary ?? "",
        key_terms: [],
        suggested_followups: [],
        tags: ["review"],
        visual: null,
        position: { x: 0, y: 800 },
        width: 420,
        collapsed: false,
        saved_to_library: false,
        model_used: "canvas:summarizer",
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
        review_state: fsrs.initial(),
        created_at: now,
        updated_at: now,
      };
      nodeRepo.insert(node);
      canvasRepo.touch(canvas.id);
      res.status(201).json(node);
    } catch (err) {
      res.status(502).json({ error: `Summarizer failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ---------- personalization: canvas profile (spec §3) ----------
  app.get("/api/canvases/:id/profile", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    res.json({ profile: profileOf(canvas.id) });
  });

  app.put("/api/canvases/:id/profile", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const profile = LearningProfile.parse(req.body);
    db.insert(appState)
      .values({ key: `profile:${canvas.id}`, value: JSON.stringify(profile) })
      .onConflictDoUpdate({ target: appState.key, set: { value: JSON.stringify(profile) } })
      .run();
    res.json({ profile });
  });

  // ---------- learning paths (spec §2, §18) ----------
  app.post("/api/canvases/:id/path", async (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const body = z
      .object({
        topic: z.string().min(1).max(300).optional(),
        source_id: z.string().uuid().optional(),
        profile: LearningProfile.optional(),
      })
      .parse(req.body ?? {});
    // topic: explicit, or derived from the canvas's existing nodes
    let topic = body.topic?.trim() ?? "";
    let material: string | null = null;
    if (body.source_id) {
      const m = materialRepo.get(body.source_id);
      if (!m) return res.status(404).json({ error: "Source material not found" });
      material = `${m.title}\n\n${m.content}`;
      if (!topic) topic = m.title;
    }
    if (!topic) {
      const done = nodeRepo.listByCanvas(canvas.id).filter((n) => n.status === "complete");
      if (done.length === 0) return res.status(400).json({ error: "Ask a question first — a learning path needs something to build from" });
      topic = done.map((n) => n.title || n.question).slice(0, 6).join(", ");
    }
    try {
      const meta = (await generateJsonLenient(router, "fast", {
        system: PATH_SYSTEM,
        prompt: pathPrompt(topic, body.profile ?? DEFAULT_PROFILE, material),
        temperature: 0.4,
        maxTokens: 800,
      })) as { title?: string; goal?: string; sections?: { title?: string; points?: string[] }[] };
      const sections = (meta.sections ?? [])
        .filter((s) => s?.title)
        .slice(0, 8)
        .map((s) => ({
          id: crypto.randomUUID(),
          title: String(s.title).slice(0, 80),
          points: (s.points ?? []).filter((x) => typeof x === "string").slice(0, 4),
          node_id: null,
        }));
      if (!sections.length) return res.status(502).json({ error: "Could not generate a learning path" });
      const existing = pathRepo.forCanvas(canvas.id);
      if (existing) pathRepo.delete(existing.id);
      const path: LearningPath = {
        id: crypto.randomUUID(),
        canvas_id: canvas.id,
        source_id: body.source_id ?? null,
        title: (meta.title ?? topic).slice(0, 80),
        goal: (meta.goal ?? "").slice(0, 200),
        sections,
        created_at: Date.now(),
      };
      pathRepo.create(path);
      res.status(201).json(path);
    } catch (err) {
      res.status(502).json({ error: `Path generation failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  /** Start a path section: creates a real node and runs the pipeline for it (spec §2). */
  app.post("/api/paths/:id/sections/:sectionId/start", (req: Request, res: Response) => {
    const path = db.select().from(learningPaths).where(eq(learningPaths.id, p(req, "id"))).get();
    if (!path) return res.status(404).json({ error: "Path not found" });
    const sections = JSON.parse(path.sections) as { id: string; title: string; points: string[]; node_id: string | null }[];
    const section = sections.find((s) => s.id === p(req, "sectionId"));
    if (!section) return res.status(404).json({ error: "Section not found" });
    if (section.node_id) {
      const existing = nodeRepo.get(section.node_id);
      if (existing && existing.status !== "failed") return res.json(existing);
      // A failed node (e.g. killed mid-stream) gets replaced by a fresh attempt below.
      if (existing) nodeRepo.delete(existing.id);
    }
    const question = `Teach me: ${section.title}`;
    const now = Date.now();
    const node: NodeEntity = {
      id: crypto.randomUUID(),
      canvas_id: path.canvas_id,
      parent_id: null,
      branch_origin: "path_section",
      status: "answering",
      title: "",
      question,
      answer_text: "",
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
      material_id: path.source_id,
      sections: [],
      note: "",
      important: false,
      review_state: fsrs.initial(),
      created_at: now,
      updated_at: now,
    };
    nodeRepo.insert(node);
    pathRepo.startSection(path.id, section.id, node.id);
    res.status(201).json(node);
    // Run the real pipeline for the new section node (background — the HTTP response
    // is already sent; the node streams into the store when the client reloads the
    // graph or via the canvas's normal polling/refresh flows).
    const material = path.source_id ? materialRepo.get(path.source_id) : undefined;
    void runPipeline(
      node,
      [],
      {
        request: {
          canvas_id: path.canvas_id,
          parent_id: null,
          branch_origin: "path_section",
          question,
          position: node.position,
          model_speed: "fast",
          web_search: false,
        },
        abort: new AbortController().signal,
        profile: profileOf(path.canvas_id),
        material: material ? { title: material.title, content: material.content } : undefined,
      },
      { router, nodes: nodeRepo },
      () => {}, // no SSE client here; events persist via nodeRepo
    );
  });

  // ---------- practice (spec §8, §9) ----------
  app.post("/api/practice/generate", async (req: Request, res: Response) => {
    const body = z
      .object({ node_id: z.string().uuid(), count: z.number().int().min(1).max(5).default(3) })
      .parse(req.body);
    const node = nodeRepo.get(body.node_id);
    if (!node) return res.status(404).json({ error: "Node not found" });
    if (node.status !== "complete") return res.status(400).json({ error: "Answer must complete before practicing" });
    // context: the node's own material when grounded, otherwise node + ancestor chain
    let source = node.answer_text;
    if (node.material_id) {
      const m = materialRepo.get(node.material_id);
      if (m) source = `${m.title}\n\n${m.content.slice(0, 4000)}`;
    } else {
      const chain: NodeEntity[] = [];
      let cur = node.parent_id ? nodeRepo.get(node.parent_id) : undefined;
      while (cur) {
        chain.unshift(cur);
        cur = cur.parent_id ? nodeRepo.get(cur.parent_id) : undefined;
      }
      if (chain.length) source = `${chain.map((c) => `Q: ${c.question}\nA: ${c.answer_text.slice(0, 300)}`).join("\n")}\n\n${node.answer_text}`;
    }
    try {
      const r = (await generateJsonLenient(router, "fast", {
        system: PRACTICE_SYSTEM,
        prompt: practicePrompt(`Topic: ${node.title || node.question}\n\n${source}`, body.count),
        temperature: 0.5,
        maxTokens: 900,
      })) as { exercises?: unknown[] };
      const exercises = (r.exercises ?? [])
        .map((e) => Exercise.safeParse(e))
        .filter((x) => x.success)
        .map((x) => x.data)
        .slice(0, body.count);
      if (!exercises.length) return res.status(502).json({ error: "Could not generate valid exercises" });
      res.json({ exercises });
    } catch (err) {
      res.status(502).json({ error: `Practice generation failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.post("/api/practice/answer", async (req: Request, res: Response) => {
    const body = z
      .object({
        exercise: Exercise,
        response: z.unknown(),
        node_id: z.string().uuid().nullable().optional(),
        canvas_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const ex = body.exercise;
    let correct: boolean | null = null;
    let graded = null as null | { correct: boolean; partial: boolean; feedback: string; concept: string };
    // objective types grade deterministically; free text uses the AI grader (spec §9)
    if (ex.type === "multiple_choice") {
      correct = body.response === ex.correct_index;
    } else if (ex.type === "fill_blank") {
      correct = typeof body.response === "string" && body.response.trim().toLowerCase() === ex.answer.trim().toLowerCase();
    } else if (ex.type === "order_steps") {
      correct =
        Array.isArray(body.response) &&
        body.response.length === ex.steps.length &&
        body.response.every((v, i) => v === i);
    }
    if (correct === null) {
      // free-text (short_answer / scenario): AI-assisted grading against the model answer
      try {
        const g = (await generateJsonLenient(router, "fast", {
          system: GRADE_SYSTEM,
          prompt: gradePrompt(ex, body.response, ""),
          temperature: 0.1,
          maxTokens: 250,
        })) as { correct?: boolean; partial?: boolean; feedback?: string; concept?: string };
        graded = {
          correct: g.correct === true,
          partial: g.partial === true,
          feedback: (g.feedback ?? "").slice(0, 600),
          concept: (g.concept ?? "").slice(0, 60),
        };
        correct = graded.correct;
      } catch {
        return res.status(502).json({ error: "Grading failed — try again" });
      }
    } else {
      graded = { correct, partial: false, feedback: correct ? "Correct." : "Not quite.", concept: "" };
    }
    const attempt: PracticeAttempt = {
      id: crypto.randomUUID(),
      node_id: body.node_id ?? null,
      canvas_id: body.canvas_id ?? null,
      exercise: ex,
      response: body.response ?? null,
      correct,
      graded,
      created_at: Date.now(),
    };
    practiceRepo.insert(attempt);
    statsRepo.registerActivity();
    if (correct) statsRepo.addStars(2);
    res.json(attempt);
  });

  app.get("/api/practice/weak", (_req: Request, res: Response) => {
    res.json(practiceRepo.weakConcepts());
  });

  /** Reinforcement (spec §9): a simpler re-explanation plus a fresh exercise for a weak concept. */
  app.post("/api/practice/reinforce", async (req: Request, res: Response) => {
    const body = z.object({ concept: z.string().min(1).max(120) }).parse(req.body);
    try {
      const r = (await generateJsonLenient(router, "fast", {
        system:
          'You output ONLY a JSON object. Shape: {"explanation": "<max 120 words, simpler re-explanation with a contrasting example>", "exercise": <one multiple_choice or fill_blank exercise object testing the same idea differently>}',
        prompt: `The learner has repeatedly missed this concept: "${body.concept}". Re-teach it more simply and generate one fresh exercise.`,
        temperature: 0.4,
        maxTokens: 500,
      })) as { explanation?: string; exercise?: unknown };
      const ex = Exercise.safeParse(r.exercise);
      res.json({ explanation: r.explanation ?? "", exercise: ex.success ? ex.data : null });
    } catch (err) {
      res.status(502).json({ error: `Reinforcement failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ---------- active recall / explain-back (research-spec §15) ----------
  app.post("/api/recall", async (req: Request, res: Response) => {
    const body = z
      .object({ node_id: z.string().uuid(), explanation: z.string().min(1).max(3000) })
      .parse(req.body);
    const node = nodeRepo.get(body.node_id);
    if (!node) return res.status(404).json({ error: "Node not found" });
    const sourceText = node.answer_text || node.question;
    try {
      const r = (await generateJsonLenient(router, "fast", {
        system: RECALL_SYSTEM,
        prompt: recallPrompt(sourceText, body.explanation),
        temperature: 0.2,
        maxTokens: 400,
      })) as { understanding?: string; missing?: string[]; misconception?: string; feedback?: string };
      // Small local models sometimes return missing as a string — normalize defensively.
      const missingRaw: unknown = r.missing;
      const missing = Array.isArray(missingRaw)
        ? missingRaw.filter((m): m is string => typeof m === "string").slice(0, 4)
        : typeof missingRaw === "string" && missingRaw.trim()
          ? [missingRaw.trim().slice(0, 120)]
          : [];
      const understanding = r.understanding === "strong" || r.understanding === "partial" || r.understanding === "weak" ? r.understanding : "partial";
      if (understanding === "strong") statsRepo.addStars(2);
      // Spaced-review integration (roadmap 6): pipe the recall grade into the node's
      // FSRS scheduler so a shaky explanation resurfaces sooner than a strong one.
      const gradeMap = { strong: "good", partial: "hard", weak: "again" } as const;
      const next = fsrs.grade(node.review_state, gradeMap[understanding]);
      nodeRepo.update(node.id, { review_state: next });
      res.json({
        understanding,
        missing,
        misconception: typeof r.misconception === "string" ? r.misconception.slice(0, 300) : "",
        feedback: typeof r.feedback === "string" ? r.feedback.slice(0, 800) : "",
        review_state: next,
      });
    } catch (err) {
      res.status(502).json({ error: `Recall grading failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ---------- knowledge cards (spec §10) ----------
  app.post("/api/cards", async (req: Request, res: Response) => {
    const body = z
      .object({ node_id: z.string().uuid(), concept: z.string().max(80).optional() })
      .parse(req.body);
    const node = nodeRepo.get(body.node_id);
    if (!node) return res.status(404).json({ error: "Node not found" });
    let source = `${node.question}\n${node.answer_text.slice(0, 3000)}`;
    if (node.material_id) {
      const m = materialRepo.get(node.material_id);
      if (m) source = `${m.title}\n\n${m.content.slice(0, 3000)}`;
    }
    try {
      const meta = (await generateJsonLenient(router, "fast", {
        system: CARD_SYSTEM,
        prompt: cardPrompt(node.title || node.question, source),
        temperature: 0.3,
        maxTokens: 300,
      })) as { concept?: string; explanation?: string; example?: string };
      if (!meta.concept) return res.status(502).json({ error: "Could not extract a concept" });
      const canvas = canvasRepo.get(node.canvas_id);
      const card: KnowledgeCard = {
        id: crypto.randomUUID(),
        node_id: node.id,
        canvas_id: node.canvas_id,
        concept: meta.concept.slice(0, 80),
        explanation: (meta.explanation ?? "").slice(0, 600),
        example: (meta.example ?? "").slice(0, 400),
        source: `${canvas?.title ?? "Canvas"} — ${node.title || node.question.slice(0, 60)}`,
        notes: "",
        due_at: Date.now() + 24 * 60 * 60 * 1000, // first review tomorrow
        times_reviewed: 0,
        last_reviewed_at: null,
        created_at: Date.now(),
      };
      cardRepo.insert(card);
      res.status(201).json(card);
    } catch (err) {
      res.status(502).json({ error: `Card creation failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.get("/api/cards", (_req: Request, res: Response) => {
    res.json(cardRepo.list());
  });

  app.get("/api/cards/due", (_req: Request, res: Response) => {
    res.json(cardRepo.due(Date.now()));
  });

  app.patch("/api/cards/:id", (req: Request, res: Response) => {
    const body = z.object({ notes: z.string().max(2000).optional() }).parse(req.body);
    if (body.notes !== undefined) cardRepo.updateNotes(p(req, "id"), body.notes);
    const card = cardRepo.get(p(req, "id"));
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  });

  app.post("/api/cards/:id/review", (req: Request, res: Response) => {
    const body = z.object({ correct: z.boolean() }).parse(req.body);
    const card = cardRepo.review(p(req, "id"), body.correct);
    if (!card) return res.status(404).json({ error: "Card not found" });
    statsRepo.registerActivity();
    if (body.correct) statsRepo.addStars(2);
    res.json(card);
  });

  app.delete("/api/cards/:id", (req: Request, res: Response) => {
    cardRepo.delete(p(req, "id"));
    res.status(204).end();
  });

  // ---------- source materials (spec §12, research-spec §1) ----------
  app.post("/api/materials", async (req: Request, res: Response) => {
    const body = z
      .object({
        kind: z.enum(["text", "url"]),
        title: z.string().min(1).max(160).optional(),
        content: z.string().min(1).max(200_000).optional(),
        url: z.string().url().max(600).optional(),
        canvas_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    let content = body.content ?? "";
    let title = body.title ?? "";
    if (body.kind === "url") {
      if (!body.url) return res.status(400).json({ error: "url required for kind=url" });
      try {
        const fetched = await fetchMaterialUrl(body.url);
        content = fetched.text;
        if (!title) title = fetched.title || body.url;
      } catch {
        return res.status(502).json({ error: "Could not fetch that URL" });
      }
    }
    if (!content.trim()) return res.status(400).json({ error: "Material content is empty" });
    if (!title) title = content.trim().split(/\s+/).slice(0, 6).join(" ");
    const m: SourceMaterial = {
      id: crypto.randomUUID(),
      kind: body.kind,
      title: title.slice(0, 160),
      content,
      char_count: content.length,
      canvas_id: body.canvas_id ?? null,
      summary: "",
      key_points: [],
      concepts: [],
      created_at: Date.now(),
    };
    materialRepo.insert(m);
    res.status(201).json(m);
  });

  /** File upload (research-spec §1): .txt/.md/.html/.pdf → extracted text. base64 body, no multipart deps. */
  app.post("/api/materials/upload", (req: Request, res: Response) => {
    const body = MaterialUploadInput.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Invalid upload", detail: body.error.flatten() });
    const { filename, content_base64, canvas_id } = body.data;
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    if (!["txt", "md", "markdown", "html", "htm", "pdf"].includes(ext)) {
      return res.status(400).json({ error: "Supported files: .txt, .md, .html, .pdf" });
    }
    if (Buffer.byteLength(content_base64, "base64") > 25_000_000) {
      return res.status(400).json({ error: "File too large (max 25 MB)" });
    }
    const raw = Buffer.from(content_base64, "base64");
    let content: string;
    let kind: "text" | "pdf";
    try {
      if (ext === "pdf") {
        content = extractPdfText(raw);
        kind = "pdf";
      } else if (ext === "html" || ext === "htm") {
        content = raw
          .toString("utf8")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim();
        kind = "text";
      } else {
        content = raw.toString("utf8");
        kind = "text";
      }
    } catch (err) {
      return res.status(422).json({ error: err instanceof Error ? err.message : "Could not read that file" });
    }
    if (!content.trim()) return res.status(422).json({ error: "No readable text in that file" });
    const title = filename.replace(/\.[^.]+$/, "").slice(0, 160);
    const m: SourceMaterial = {
      id: crypto.randomUUID(),
      kind,
      title,
      content: content.slice(0, 200_000),
      char_count: content.length,
      canvas_id: canvas_id ?? null,
      summary: "",
      key_points: [],
      concepts: [],
      created_at: Date.now(),
    };
    materialRepo.insert(m);
    res.status(201).json(m);
  });

  /** Source Explorer data (research-spec §1): this canvas's materials + every answer's provenance. */
  app.get("/api/canvases/:id/sources", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const nodesInCanvas = nodeRepo.listByCanvas(canvas.id);
    const materials = materialRepo.listForCanvas(canvas.id).map((m) => ({
      id: m.id,
      kind: m.kind,
      title: m.title,
      char_count: m.char_count,
      canvas_id: m.canvas_id,
      summary: m.summary,
      key_points: m.key_points,
      concepts: m.concepts,
      cited_by: nodesInCanvas.filter((n) => n.provenance?.material_id === m.id || n.material_id === m.id).length,
      created_at: m.created_at,
    }));
    const answers = nodesInCanvas
      .filter((n) => n.status === "complete" && (n.provenance || n.sources.length > 0 || n.material_id))
      .map((n) => ({
        node_id: n.id,
        title: n.title || n.question.slice(0, 80),
        question: n.question,
        provenance: n.provenance,
        sources: n.sources,
        material_id: n.material_id,
      }));
    res.json({ materials, answers } satisfies CanvasSources);
  });

  app.get("/api/materials", (_req: Request, res: Response) => {
    res.json(materialRepo.list());
  });

  app.get("/api/materials/:id", (req: Request, res: Response) => {
    const m = materialRepo.get(p(req, "id"));
    if (!m) return res.status(404).json({ error: "Material not found" });
    res.json(m);
  });

  app.delete("/api/materials/:id", (req: Request, res: Response) => {
    materialRepo.delete(p(req, "id"));
    res.status(204).end();
  });

  /** Explain / summarize / concepts from a material — grounded strictly in its content. */
  app.post("/api/materials/:id/summary", async (req: Request, res: Response) => {
    const m = materialRepo.get(p(req, "id"));
    if (!m) return res.status(404).json({ error: "Material not found" });
    try {
      const s = (await generateJsonLenient(router, "fast", {
        system:
          'You output ONLY a JSON object. Shape: {"summary": "<max 150 words, strictly from the material>", "key_points": ["<max 6 points from the material>"], "concepts": ["<up to 8 concept names present in the material>"]}',
        prompt: `Material: "${m.title}"\n\n"""\n${m.content.slice(0, 9000)}\n"""`,
        temperature: 0.2,
        maxTokens: 600,
      })) as { summary?: string; key_points?: string[]; concepts?: string[] };
      const out: MaterialSummary = {
        summary: (s.summary ?? "").slice(0, 1500),
        key_points: (s.key_points ?? []).filter((x) => typeof x === "string").slice(0, 6),
        concepts: (s.concepts ?? []).filter((x) => typeof x === "string").slice(0, 8),
      };
      materialRepo.updateMeta(m.id, out); // cached: the Source Explorer lists it without re-calling the LLM
      res.json(out);
    } catch (err) {
      res.status(502).json({ error: `Summarization failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ---------- concept links (spec §6) ----------
  app.post("/api/canvases/:id/links", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const body = z
      .object({ source: z.string().uuid(), target: z.string().uuid(), label: z.string().max(60).optional() })
      .parse(req.body);
    if (body.source === body.target) return res.status(400).json({ error: "Cannot link a node to itself" });
    if (!nodeRepo.get(body.source) || !nodeRepo.get(body.target)) {
      return res.status(404).json({ error: "Both nodes must exist" });
    }
    res.status(201).json(linkRepo.create(canvas.id, body.source, body.target, body.label ?? ""));
  });

  app.delete("/api/links/:id", (req: Request, res: Response) => {
    linkRepo.delete(p(req, "id"));
    res.status(204).end();
  });

  // ---------- on-demand visual for any content (spec §5, §14) ----------
  app.post("/api/visual", async (req: Request, res: Response) => {
    // safeParse, not parse: Express 4 does NOT forward async-handler rejections
    // to the error middleware, so a malformed body (e.g. empty text) would have
    // crashed the whole server process. It must 400 like every other route.
    const parsed = z
      .object({
        node_id: z.string().uuid().optional(),
        question: z.string().max(500).optional(),
        text: z.string().min(1).max(6000),
        kind: z.enum(["diagram", "picture"]).default("diagram"),
        compare: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid visual request", detail: parsed.error.flatten() });
    const body = parsed.data;
    let existing: NodeEntity | undefined;
    if (body.node_id) {
      existing = nodeRepo.get(body.node_id);
      if (!existing) return res.status(404).json({ error: "Node not found" });
    }
    const question = existing?.question ?? body.question ?? "Explain visually";
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    let block: Awaited<ReturnType<typeof generateVisual>> | Awaited<ReturnType<typeof generatePicture>>;
    try {
      block = body.kind === "picture"
        ? await generatePicture(question, body.text, controller.signal, router)
        : await generateVisual(question, body.text, "quality", controller.signal, router, body.compare === true ? "comparison_table" : undefined);
    } catch (err) {
      // Real failure (no model response / unparseable model output) → 502 with
      // the actionable message. A node with NO usable visual gets an honest
      // persisted "failed" block (the card shows the state after refresh and
      // the Visualize action is the retry path); a previously GOOD visual is
      // never destroyed by a failed regeneration.
      if (controller.signal.aborted) return;
      const failure = { message: err instanceof Error ? err.message : "Visual generation failed", ...(err instanceof PictureGenerationError ? { code: err.code } : {}) };
      if (existing && (!existing.visual || existing.visual.type === "none" || existing.visual.status === "failed")) {
        nodeRepo.update(existing.id, { visual: { type: body.kind === "picture" ? "image" : "none", status: "failed", spec: null, ...(err instanceof PictureGenerationError ? { error: failure } : {}) } });
      }
      return res.status(failure.code === "credits_required" ? 402 : 502).json({ error: failure.message, ...(failure.code ? { code: failure.code } : {}) });
    } finally {
      res.off("close", onClose);
    }
    if (existing) {
      nodeRepo.update(existing.id, { visual: block });
    }
    res.json({ visual: block });
  });

  // ---------- artifacts (roadmap) — generated STRICTLY from this canvas's real Q&A ----------
  app.post("/api/canvases/:id/artifacts", async (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const body = z.object({ kind: z.enum(["study_guide", "research_brief", "timeline", "flashcard_deck"]) }).parse(req.body);
    const nodes = nodeRepo.listByCanvas(canvas.id).filter((n) => n.status === "complete" && n.branch_origin !== "regenerate");
    if (nodes.length === 0) return res.status(400).json({ error: "This canvas has no completed answers to build from yet" });
    const qa = nodes
      .map((n) => `Q: ${n.question}\nA: ${n.answer_text}${n.key_terms.length ? `\nKey terms: ${n.key_terms.join(", ")}` : ""}`)
      .join("\n\n")
      .slice(0, 14000);
    try {
      const raw = (await generateJsonLenient(router, "fast", {
        system: ARTIFACT_SYSTEMS[body.kind],
        prompt: artifactPrompt(body.kind, qa),
        temperature: 0.3,
        maxTokens: 1400,
      })) as { title?: string };
      const content = ArtifactContent.safeParse(raw);
      if (!content.success || content.data.kind !== body.kind) {
        return res.status(502).json({ error: "The model's artifact didn't match the expected shape — try again" });
      }
      const artifact: Artifact = {
        id: crypto.randomUUID(),
        canvas_id: canvas.id,
        kind: body.kind,
        title: (raw.title ?? `${body.kind} · ${canvas.title}`).slice(0, 120),
        content: content.data,
        node_count: nodes.length,
        created_at: Date.now(),
      };
      artifactRepo.insert(artifact);
      res.status(201).json(artifact);
    } catch (err) {
      res.status(502).json({ error: `Artifact generation failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.get("/api/canvases/:id/artifacts", (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    res.json(artifactRepo.forCanvas(canvas.id));
  });

  /** Audio recap (roadmap 5): a short spoken summary of a canvas's real Q&A. Free-form prose, not JSON. */
  app.post("/api/canvases/:id/recap", async (req: Request, res: Response) => {
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const nodes = nodeRepo.listByCanvas(canvas.id).filter((n) => n.status === "complete" && n.branch_origin !== "regenerate");
    if (nodes.length === 0) return res.status(400).json({ error: "This canvas has no completed answers to recap yet" });
    const qa = nodes
      .map((n) => `Q: ${n.question}\nA: ${n.answer_text}${n.key_terms.length ? `\nKey terms: ${n.key_terms.join(", ")}` : ""}`)
      .join("\n\n")
      .slice(0, 10000);
    try {
      const { text, provider, model } = await router.generateWithFailover("fast", {
        system: RECAP_SYSTEM,
        prompt: recapPrompt(qa),
        temperature: 0.4,
        maxTokens: 400,
      });
      const recap = text.replace(/\[\[|\]\]|\*|`|#+\s/g, "").replace(/\s+/g, " ").trim();
      if (!recap) return res.status(502).json({ error: "The recap came back empty — try again" });
      res.status(201).json({ text: recap, model_used: `${provider}:${model}`, node_count: nodes.length });
    } catch (err) {
      res.status(502).json({ error: `Recap generation failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.delete("/api/artifacts/:id", (req: Request, res: Response) => {
    artifactRepo.delete(p(req, "id"));
    res.status(204).end();
  });

  /** Import a flashcard deck into the FSRS review queue (one card per flashcard, idempotent per concept). */
  app.post("/api/artifacts/:id/import-cards", (req: Request, res: Response) => {
    const a = artifactRepo.get(p(req, "id"));
    if (!a) return res.status(404).json({ error: "Artifact not found" });
    if (a.content.kind !== "flashcard_deck") return res.status(400).json({ error: "Only flashcard decks can be imported into review" });
    const existing = new Set(cardRepo.list().filter((c) => c.canvas_id === a.canvas_id).map((c) => c.concept.trim().toLowerCase()));
    let added = 0;
    const now = Date.now();
    for (const card of a.content.cards) {
      const key = card.concept.trim().toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      cardRepo.insert({
        id: crypto.randomUUID(),
        node_id: null,
        canvas_id: a.canvas_id,
        concept: card.concept.slice(0, 80),
        explanation: card.explanation.slice(0, 400),
        example: card.example.slice(0, 200),
        source: a.title,
        notes: "",
        due_at: now + 86_400_000,
        times_reviewed: 0,
        last_reviewed_at: null,
        created_at: now,
      });
      added++;
    }
    res.json({ added, total: a.content.cards.length });
  });

  // ---------- learning stats (spec §19) ----------
  app.get("/api/learning-stats", (_req: Request, res: Response) => {
    res.json(statsRepo.learning());
  });

  // ---------- knowledge graph (research-spec §12) — real concepts from real exploration ----------
  app.get("/api/knowledge-graph", (_req: Request, res: Response) => {
    const completed: NodeEntity[] = db
      .select()
      .from(nodes)
      .where(eq(nodes.status, "complete"))
      .all()
      .map(rowToNode);
    const canvasTitles = new Map(canvasRepo.list().map((c) => [c.id, c.title]));

    // Group completed nodes by their auto-title (the AI-derived concept label).
    const groups = new Map<string, { nodeIds: string[]; canvasId: string }>();
    for (const n of completed) {
      const label = (n.title || n.question).trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const g = groups.get(key);
      if (g) g.nodeIds.push(n.id);
      else groups.set(key, { nodeIds: [n.id], canvasId: n.canvas_id });
    }

    const concepts = [...groups.entries()]
      .map(([, g]) => {
        const rep = nodeRepo.get(g.nodeIds[0]!)!;
        return {
          id: rep.id,
          label: (rep.title || rep.question).slice(0, 80),
          weight: g.nodeIds.length,
          canvas_id: g.canvasId,
          canvas_title: canvasTitles.get(g.canvasId) ?? "",
          node_id: rep.id,
        };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 40);

    // Edges: real parent-child hierarchy between the representative nodes.
    const conceptIds = new Set(concepts.map((c) => c.id));
    const edges: { from: string; to: string; kind: "parent" | "related" }[] = [];
    for (const n of completed) {
      if (n.parent_id && conceptIds.has(n.id) && conceptIds.has(n.parent_id)) {
        edges.push({ from: n.parent_id, to: n.id, kind: "parent" });
      }
    }
    // Same-canvas peers become "related" edges (limited to keep the graph readable).
    const byCanvas = new Map<string, string[]>();
    for (const c of concepts) {
      const list = byCanvas.get(c.canvas_id) ?? [];
      list.push(c.id);
      byCanvas.set(c.canvas_id, list);
    }
    for (const list of byCanvas.values()) {
      for (let i = 0; i < list.length - 1; i++) {
        if (!edges.some((e) => e.from === list[i] && e.to === list[i + 1])) {
          edges.push({ from: list[i]!, to: list[i + 1]!, kind: "related" });
        }
      }
    }

    res.json({ concepts, edges });
  });

  // ---------- exam simulation (research-spec §19) — real questions, real scoring ----------
  app.post("/api/exam/generate", async (req: Request, res: Response) => {
    const body = ExamRequest.parse(req.body ?? {});
    const completed = body.canvas_id
      ? nodeRepo.listByCanvas(body.canvas_id).filter((n) => n.status === "complete")
      : (db.select().from(nodes).where(eq(nodes.status, "complete")).all().map(rowToNode) as NodeEntity[]);
    if (!completed.length) return res.status(400).json({ error: "Explore something first — an exam needs real material" });

    // Weight topics by known weak spots so the exam targets what needs work.
    const weak = new Set(practiceRepo.weakConcepts(5).map((w) => w.concept.toLowerCase()));
    const ordered = [...completed].sort((a, b) => {
      const aw = weak.has((a.title || a.question).toLowerCase()) ? 1 : 0;
      const bw = weak.has((b.title || b.question).toLowerCase()) ? 1 : 0;
      return bw - aw;
    });

    const picked: NodeEntity[] = [];
    for (let i = 0; i < ordered.length && picked.length < 3; i++) picked.push(ordered[i]!);
    const per = Math.max(1, Math.ceil(body.count / picked.length));

    const questions: { id: string; exercise: unknown; topic: string }[] = [];
    for (const node of picked) {
      const material = node.material_id
        ? (() => {
            const m = materialRepo.get(node.material_id);
            return m ? `${m.title}\n${m.content.slice(0, 2000)}` : "";
          })()
        : `Q: ${node.question}\nA: ${node.answer_text.slice(0, 1500)}`;
      try {
        const r = (await generateJsonLenient(router, "fast", {
          system:
            'You output ONLY a JSON object. Shape: {"exercises": [<exercise objects>]}. Each exercise is one of: {"type":"multiple_choice","question":"...","options":["...","...","..."],"correct_index":0,"explanation":"..."} or {"type":"fill_blank","question":"Sentence with ___","answer":"word","explanation":"..."} or {"type":"short_answer","question":"...","answer":"model answer","explanation":"..."}. Generate exercises that test DEEP understanding (application, comparison, why) — not just recall. Only from the material.',
          prompt: `Generate ${per} exam question(s) from this explored topic: "${node.title || node.question}"\n\nMaterial:\n"""\n${material.slice(0, 2500)}\n"""`,
          temperature: 0.4,
          maxTokens: 600,
        })) as { exercises?: unknown[] };
        for (const e of (r.exercises ?? []).slice(0, per)) {
          const parsed = Exercise.safeParse(e);
          if (parsed.success) {
            questions.push({ id: crypto.randomUUID(), exercise: parsed.data, topic: (node.title || node.question).slice(0, 80) });
          }
        }
      } catch {
        // skip this topic on failure — exam continues with what generated
      }
      if (questions.length >= body.count) break;
    }
    if (!questions.length) return res.status(502).json({ error: "Could not generate exam questions" });
    res.json({ questions: questions.slice(0, body.count) });
  });

  /**
   * Spaced-review integration (roadmap 6): pipe a completed exam's real answers into
   * the per-concept FSRS scheduler. A miss (or partial) pulls the topic's next review
   * forward; a correct answer pushes it out. Nothing is invented — only topics the
   * exam actually covered are scheduled.
   */
  app.post("/api/exam/submit", (req: Request, res: Response) => {
    const body = ExamSubmitRequest.parse(req.body ?? {});
    const now = Date.now();
    const gradeFor = (a: (typeof body.answers)[number]): "again" | "hard" | "good" =>
      a.correct ? "good" : a.partial ? "hard" : "again";
    const scheduled: { concept: string; correct: boolean; due_in_days: number }[] = [];
    for (const a of body.answers) {
      const key = conceptKey(a.topic);
      if (!key) continue;
      const existing = conceptMasteryRepo.get(key);
      const base = existing?.review_state ?? fsrs.initial();
      const next = fsrs.grade(base, gradeFor(a));
      conceptMasteryRepo.upsert({
        concept: key,
        canvas_id: body.canvas_id ?? null,
        review_state: next,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      scheduled.push({ concept: a.topic, correct: a.correct, due_in_days: Math.max(0, Math.round((next.due_at - now) / 86400000)) });
    }
    statsRepo.registerActivity();
    res.json({ scheduled, due_now: conceptMasteryRepo.due(now).map((c) => c.concept) });
  });

  /** Due concepts for the review surface — weak topics resurface here (roadmap 6). */
  app.get("/api/review/concepts", (_req: Request, res: Response) => {
    const due = conceptMasteryRepo.due(Date.now());
    res.json({ concepts: due.map((c) => ({ concept: c.concept, due_at: c.review_state.due_at, times_reviewed: c.review_state.times_reviewed })) });
  });

  // ---------- thinking map (thinking-spec §3) ----------
  app.post("/api/canvases/:id/map", async (req: Request, res: Response) => {
    const body = z.object({ topic: z.string().min(1).max(300).optional() }).parse(req.body ?? {});
    const canvas = canvasRepo.get(p(req, "id"));
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });

    const nodes = nodeRepo.listByCanvas(canvas.id).filter((n) => n.status === "complete");
    // Map needs something real to decompose: completed Q&As or an explicit topic.
    if (!nodes.length && !body.topic) {
      return res.status(400).json({ error: "Ask a question first, or provide a topic to map" });
    }
    const topic =
      body.topic ??
      (canvas.title + "\n" +
        nodes.map((n) => `Q: ${n.question}\nA: ${n.answer_text.slice(0, 300)}`).join("\n\n"));

    try {
      const raw = await generateJsonLenient(router, "quality", {
        system: MAP_SYSTEM,
        prompt: mapPrompt(topic.slice(0, 3000), nodes.map((n) => `- ${n.title || n.question}`).join("\n")),
        temperature: 0.4,
        maxTokens: 900,
      });
      const meta = raw as { title?: string; rationale?: string; branches?: { label?: string; question?: string }[] };
      const branches = (meta.branches ?? [])
        .filter((b) => b && typeof b.label === "string" && typeof b.question === "string")
        .slice(0, 7)
        .map((b) => ({
          id: crypto.randomUUID(),
          label: b.label!.slice(0, 60),
          question: b.question!.slice(0, 300),
          node_id: null as string | null,
        }));
      if (!branches.length) return res.status(502).json({ error: "Could not generate a thinking map" });

      const existing = mapRepo.forCanvas(canvas.id);
      if (existing) mapRepo.delete(existing.id);
      const map = {
        id: crypto.randomUUID(),
        canvas_id: canvas.id,
        topic: (body.topic ?? canvas.title).slice(0, 300),
        title: (meta.title ?? topic.split("\n")[0] ?? "Question map").slice(0, 80),
        rationale: (meta.rationale ?? "").slice(0, 400),
        branches,
        created_at: Date.now(),
      };
      mapRepo.create(map);
      res.status(201).json(map);
    } catch (err) {
      res.status(502).json({ error: `Map generation failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  /** All thinking maps (Explore surface, roadmap 7): what you've actually explored, never invented. */
  app.get("/api/maps", (_req: Request, res: Response) => {
    const rows = db.select().from(thinkingMaps).orderBy(desc(thinkingMaps.created_at)).all();
    const maps = rows.map((r) => {
      const canvas = canvasRepo.get(r.canvas_id);
      const branches = JSON.parse(r.branches) as MapBranch[];
      return {
        id: r.id,
        canvas_id: r.canvas_id,
        canvas_title: canvas?.title ?? "Imported canvas",
        topic: r.topic,
        title: r.title,
        rationale: r.rationale,
        branch_count: branches.length,
        created_at: r.created_at,
      };
    });
    res.json({ maps });
  });

  /** Start a map branch: creates a real node and runs the pipeline for it (thinking-spec §3). */
  app.post("/api/maps/:id/branches/:branchId/start", (req: Request, res: Response) => {
    const m = db.select().from(thinkingMaps).where(eq(thinkingMaps.id, p(req, "id"))).get();
    if (!m) return res.status(404).json({ error: "Map not found" });
    const branches = JSON.parse(m.branches) as { id: string; label: string; question: string; node_id: string | null }[];
    const branch = branches.find((b) => b.id === p(req, "branchId"));
    if (!branch) return res.status(404).json({ error: "Branch not found" });
    if (branch.node_id) {
      const existing = nodeRepo.get(branch.node_id);
      if (existing && existing.status !== "failed") return res.json(existing);
      if (existing) nodeRepo.delete(existing.id);
    }

    const canvas = canvasRepo.get(m.canvas_id);
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const question = branch.question;
    const now = Date.now();
    const node: NodeEntity = {
      id: crypto.randomUUID(),
      canvas_id: canvas.id,
      parent_id: null,
      branch_origin: "thread",
      status: "answering",
      title: "",
      question,
      answer_text: "",
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
      review_state: fsrs.initial(),
      created_at: now,
      updated_at: now,
    };
    nodeRepo.insert(node);
    mapRepo.attachBranch(m.id, branch.id, node.id);
    canvasRepo.touch(canvas.id);
    statsRepo.registerActivity();
    statsRepo.addStars(1);
    res.status(201).json(node);
    void runPipeline(
      node,
      [],
      {
        request: {
          canvas_id: canvas.id,
          parent_id: null,
          branch_origin: "thread",
          question,
          position: node.position,
          model_speed: "fast",
          web_search: false,
        },
        abort: new AbortController().signal,
        profile: profileOf(canvas.id),
      },
      { router, nodes: nodeRepo },
      () => {},
    );
  });

  /** Cross-canvas conceptual connections (thinking-spec §6) — real bridges only, from actual history. */
  let connectionsCache: { at: number; data: unknown } | null = null;
  app.get("/api/connections", async (_req: Request, res: Response) => {
    // This endpoint runs a live LLM call; cache briefly so the home page stays instant.
    if (connectionsCache && Date.now() - connectionsCache.at < 120_000) {
      return res.json(connectionsCache.data);
    }
    const completed = db
      .select({ id: nodes.id, canvas_id: nodes.canvas_id, title: nodes.title, question: nodes.question, answer_text: nodes.answer_text, created_at: nodes.created_at })
      .from(nodes)
      .where(eq(nodes.status, "complete"))
      .orderBy(desc(nodes.created_at))
      .limit(40)
      .all();
    if (completed.length < 2) return res.json({ connections: [] });

    // Use the most recent complete node as the current thread of curiosity.
    const current = completed[0]!;
    const others = completed.slice(1).filter((n) => n.id !== current.id);
    if (!others.length) return res.json({ connections: [] });

    try {
      const raw = await generateJsonLenient(router, "fast", {
        system: CONNECTIONS_SYSTEM,
        prompt: connectionsPrompt(
          `${current.question}\n${current.answer_text.slice(0, 600)}`,
          others.map((n) => `- ${n.title || n.question}: ${n.answer_text.slice(0, 150)}`).join("\n"),
        ),
        temperature: 0.3,
        maxTokens: 400,
      });
      const conns = raw as { connections?: { a_title?: string; b_title?: string; why?: string; question?: string }[] };
      const trimSentence = (s: string, max: number) => {
        const clipped = s.slice(0, max);
        const lastDot = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
        return (lastDot > 40 ? clipped.slice(0, lastDot + 1) : clipped).trim();
      };
      const list = (conns.connections ?? [])
        .filter((c) => c && typeof c.why === "string" && typeof c.question === "string")
        .slice(0, 2)
        .map((c) => ({
          from_node: current.id,
          a_title: (c.a_title ?? (current.title || current.question)).slice(0, 80),
          b_title: (c.b_title ?? "").slice(0, 80),
          why: trimSentence(c.why!, 220),
          question: c.question!.slice(0, 200),
        }));
      const payload = { connections: list };
      connectionsCache = { at: Date.now(), data: payload };
      res.json(payload);
    } catch {
      const payload = { connections: [] };
      connectionsCache = { at: Date.now(), data: payload };
      res.json(payload); // no connection surfaced when generation fails — never fabricated client-side
    }
  });

  // Central error handler: zod → 400, anything else → 500
  app.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", detail: err.flatten() });
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return {
    app,
    repos: { canvasRepo, nodeRepo, libraryRepo, statsRepo, conceptMasteryRepo, mapRepo, linkRepo, cardRepo, materialRepo },
    router,
    close: () => ctx.close(),
  };
}
