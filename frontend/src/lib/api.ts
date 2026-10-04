import type {
  AskEvent,
  GraphResponse,
  CanvasEntity,
  NodeEntity,
  AppStats,
  LibraryItem,
  LearningPath,
  Exercise,
  PracticeAttempt,
  KnowledgeCard,
  SourceMaterial,
  MaterialSummary,
  LearningStats,
  LearningProfile,
  ThinkingMap,
  KnowledgeGraph,
  ExamQuestion,
  CanvasSources,
  Artifact,
  ArtifactKind,
} from "@canvas-learn/shared";

/** Cross-canvas conceptual bridge (thinking-spec §6), served from real exploration history. */
export interface ConnectionIdea {
  from_node: string;
  a_title: string;
  b_title: string;
  why: string;
  question: string;
}

/** Effective model configuration for one role (mirrors server modelConfig.ts). */
export interface ModelRoleConfig {
  effective: string;
  source: "env" | "saved" | "default";
  saved: string | null;
  env: string | null;
  fallback: string;
  savedIgnored: boolean;
  savedIgnoreReason: "env_override" | "not_installed" | null;
}

export interface SettingsModels {
  fast: ModelRoleConfig;
  quality: ModelRoleConfig;
  installed: string[];
  ollamaReachable: boolean;
}

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** One search hit: a node matched by question / answer / terms, with its source canvas. */
export interface SearchHit {
  node_id: string;
  canvas_id: string;
  canvas_title: string;
  title: string;
  question: string;
  field: "question" | "answer" | "term" | "title";
  snippet: string;
  score: number;
}

/** A local backup snapshot of app.db (with the metadata gathered at backup time). */
export interface BackupInfo {
  name: string;
  created_at: number;
  size_bytes: number;
  canvases: number;
  nodes: number;
  integrity: "ok" | "unchecked";
}

export const api = {
  health: () => fetch(`${BASE}/health`).then((r) => r.json()),

  settingsModels: () => fetch(`${BASE}/settings/models`).then((r) => json<SettingsModels>(r)),
  saveSettingsModels: (body: { fast?: string | null; quality?: string | null }) =>
    fetch(`${BASE}/settings/models`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<SettingsModels>(r)),

  search: (q: string, limit = 20) =>
    fetch(`${BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`).then((r) =>
      r.ok ? json<{ results: SearchHit[] }>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  listBackups: () => fetch(`${BASE}/backups`).then((r) => json<{ backups: BackupInfo[] }>(r)),
  createBackup: (label?: string) =>
    fetch(`${BASE}/backups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label ?? null }),
    }).then((r) => (r.ok ? json<BackupInfo>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))))),
  restoreBackup: (name: string) =>
    fetch(`${BASE}/backups/${encodeURIComponent(name)}/restore`, { method: "POST" }).then((r) =>
      r.ok
        ? json<{ restored: string; safety_backup: string; canvases: number; nodes: number }>(r)
        : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  listCanvases: () => fetch(`${BASE}/canvases`).then((r) => json<CanvasEntity[]>(r)),
  createCanvas: (title?: string) =>
    fetch(`${BASE}/canvases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<CanvasEntity>(r)),
  renameCanvas: (id: string, title: string) =>
    fetch(`${BASE}/canvases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<CanvasEntity>(r)),
  deleteCanvas: (id: string) => fetch(`${BASE}/canvases/${id}`, { method: "DELETE" }),

  graph: (canvasId: string) => fetch(`${BASE}/canvases/${canvasId}/graph`).then((r) => json<GraphResponse>(r)),

  patchNode: (
    id: string,
    patch: Partial<Pick<NodeEntity, "position" | "width" | "collapsed" | "saved_to_library" | "title" | "note" | "important">>,
  ) =>
    fetch(`${BASE}/nodes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<NodeEntity>(r)),
  deleteNode: (id: string) =>
    fetch(`${BASE}/nodes/${id}`, { method: "DELETE" }).then((r) => json<{ deleted: string[] }>(r)),

  stats: () => fetch(`${BASE}/stats`).then((r) => json<AppStats>(r)),

  dueNodes: () => fetch(`${BASE}/review/due`).then((r) => json<NodeEntity[]>(r)),
  gradeReview: (nodeId: string, grade: "again" | "hard" | "good" | "easy") =>
    fetch(`${BASE}/review/${nodeId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade }),
    }).then((r) => r.json()),

  library: () => fetch(`${BASE}/library`).then((r) => json<LibraryItem[]>(r)),

  summarizeCanvas: (canvasId: string) =>
    fetch(`${BASE}/canvases/${canvasId}/summarize`, { method: "POST" }).then((r) => json<NodeEntity>(r)),

  // ---------- learning layer (spec §2-§12, §19) ----------

  getProfile: (canvasId: string) =>
    fetch(`${BASE}/canvases/${canvasId}/profile`).then((r) => json<{ profile: LearningProfile }>(r)),
  setProfile: (canvasId: string, profile: LearningProfile) =>
    fetch(`${BASE}/canvases/${canvasId}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }).then((r) => json<{ profile: LearningProfile }>(r)),

  buildPath: (canvasId: string, opts?: { topic?: string; source_id?: string; profile?: LearningProfile }) =>
    fetch(`${BASE}/canvases/${canvasId}/path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    }).then((r) => json<LearningPath>(r)),
  startPathSection: (pathId: string, sectionId: string) =>
    fetch(`${BASE}/paths/${pathId}/sections/${sectionId}/start`, { method: "POST" }).then((r) =>
      r.ok ? json<NodeEntity>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  // ---- thinking layer (thinking-spec) ----
  buildMap: (canvasId: string, topic?: string) =>
    fetch(`${BASE}/canvases/${canvasId}/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topic ? { topic } : {}),
    }).then((r) => (r.ok ? json<ThinkingMap>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))))),
  startMapBranch: (mapId: string, branchId: string) =>
    fetch(`${BASE}/maps/${mapId}/branches/${branchId}/start`, { method: "POST" }).then((r) =>
      r.ok ? json<NodeEntity>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  connections: () => fetch(`${BASE}/connections`).then((r) => json<{ connections: ConnectionIdea[] }>(r)),
  knowledgeGraph: () => fetch(`${BASE}/knowledge-graph`).then((r) => json<KnowledgeGraph>(r)),
  generateExam: (count = 5, canvasId?: string) =>
    fetch(`${BASE}/exam/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, canvas_id: canvasId }),
    }).then((r) =>
      r.ok ? json<{ questions: ExamQuestion[] }>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  /** Spaced-review integration (roadmap 6): pipe a completed exam's real answers into per-concept FSRS. */
  submitExam: (body: { canvas_id?: string | null; answers: { topic: string; correct: boolean; partial?: boolean }[] }) =>
    fetch(`${BASE}/exam/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) =>
      r.ok
        ? json<{ scheduled: { concept: string; correct: boolean; due_in_days: number }[]; due_now: string[] }>(r)
        : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  /** Concepts whose review is due — weak topics resurface here (roadmap 6). */
  reviewConcepts: () => fetch(`${BASE}/review/concepts`).then((r) => json<{ concepts: { concept: string; due_at: number; times_reviewed: number }[] }>(r)),

  /** All thinking maps across canvases — the Explore surface (roadmap 7). */
  maps: () =>
    fetch(`${BASE}/maps`).then((r) =>
      json<{
        maps: {
          id: string;
          canvas_id: string;
          canvas_title: string;
          topic: string;
          title: string;
          rationale: string;
          branch_count: number;
          created_at: number;
        }[];
      }>(r),
    ),

  submitRecall: (nodeId: string, explanation: string) =>
    fetch(`${BASE}/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, explanation }),
    }).then((r) =>
      r.ok
        ? json<{ understanding: "strong" | "partial" | "weak"; missing: string[]; misconception: string; feedback: string }>(r)
        : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  generatePractice: (nodeId: string, count = 3) =>
    fetch(`${BASE}/practice/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, count }),
    }).then((r) =>
      r.ok ? json<{ exercises: Exercise[] }>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  submitPractice: (body: { exercise: Exercise; response: unknown; node_id?: string | null; canvas_id?: string | null }) =>
    fetch(`${BASE}/practice/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) =>
      r.ok ? json<PracticeAttempt>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  reinforce: (concept: string) =>
    fetch(`${BASE}/practice/reinforce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept }),
    }).then((r) =>
      r.ok
        ? json<{ explanation: string; exercise: Exercise | null }>(r)
        : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  createCard: (nodeId: string) =>
    fetch(`${BASE}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId }),
    }).then((r) =>
      r.ok ? json<KnowledgeCard>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  cards: () => fetch(`${BASE}/cards`).then((r) => json<KnowledgeCard[]>(r)),
  dueCards: () => fetch(`${BASE}/cards/due`).then((r) => json<KnowledgeCard[]>(r)),
  updateCardNotes: (id: string, notes: string) =>
    fetch(`${BASE}/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    }).then((r) => json<KnowledgeCard>(r)),
  reviewCard: (id: string, correct: boolean) =>
    fetch(`${BASE}/cards/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correct }),
    }).then((r) => json<KnowledgeCard>(r)),
  deleteCard: (id: string) => fetch(`${BASE}/cards/${id}`, { method: "DELETE" }),

  createMaterial: (body: { kind: "text" | "url"; title?: string; content?: string; url?: string; canvas_id?: string | null }) =>
    fetch(`${BASE}/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) =>
      r.ok ? json<SourceMaterial>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  /** File upload (.txt/.md/.html/.pdf) — read the file as base64 first. */
  uploadMaterial: (filename: string, contentBase64: string, canvasId?: string | null) =>
    fetch(`${BASE}/materials/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content_base64: contentBase64, canvas_id: canvasId ?? null }),
    }).then((r) =>
      r.ok ? json<SourceMaterial>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  /** Source Explorer data: canvas materials + per-answer provenance audit. */
  canvasSources: (canvasId: string) => fetch(`${BASE}/canvases/${canvasId}/sources`).then((r) => json<CanvasSources>(r)),
  materials: () => fetch(`${BASE}/materials`).then((r) => json<Omit<SourceMaterial, "content">[]>(r)),
  material: (id: string) =>
    fetch(`${BASE}/materials/${id}`).then((r) =>
      r.ok ? json<SourceMaterial>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  deleteMaterial: (id: string) => fetch(`${BASE}/materials/${id}`, { method: "DELETE" }),
  materialSummary: (id: string) =>
    fetch(`${BASE}/materials/${id}/summary`, { method: "POST" }).then((r) =>
      r.ok ? json<MaterialSummary>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  createLink: (canvasId: string, source: string, target: string, label?: string) =>
    fetch(`${BASE}/canvases/${canvasId}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, target, label }),
    }).then((r) => json<{ id: string; source: string; target: string; label: string }>(r)),
  deleteLink: (id: string) => fetch(`${BASE}/links/${id}`, { method: "DELETE" }),

  generateVisual: (body: { node_id?: string; question?: string; text: string; compare?: boolean }, signal?: AbortSignal) =>
    fetch(`${BASE}/visual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then((r) =>
      r.ok
        ? json<{ visual: NodeEntity["visual"] }>(r)
        : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  // ---------- artifacts (generated from this canvas's real Q&A) ----------
  canvasArtifacts: (canvasId: string) => fetch(`${BASE}/canvases/${canvasId}/artifacts`).then((r) => json<Artifact[]>(r)),
  createArtifact: (canvasId: string, kind: ArtifactKind) =>
    fetch(`${BASE}/canvases/${canvasId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    }).then((r) =>
      r.ok ? json<Artifact>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),
  deleteArtifact: (id: string) => fetch(`${BASE}/artifacts/${id}`, { method: "DELETE" }),
  importArtifactCards: (id: string) =>
    fetch(`${BASE}/artifacts/${id}/import-cards`, { method: "POST" }).then((r) =>
      r.ok ? json<{ added: number; total: number }>(r) : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  /** Audio recap (roadmap 5): a short spoken summary of this canvas's real Q&A. */
  recap: (canvasId: string) =>
    fetch(`${BASE}/canvases/${canvasId}/recap`, { method: "POST" }).then((r) =>
      r.ok
        ? json<{ text: string; model_used: string; node_count: number }>(r)
        : json<{ error: string }>(r).then((b) => Promise.reject(new Error(b.error))),
    ),

  learningStats: () => fetch(`${BASE}/learning-stats`).then((r) => json<LearningStats>(r)),

  importData: (payload: unknown) =>
    fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) =>
      json<{
        canvases_imported: number;
        nodes_imported: number;
        maps_imported: number;
        links_imported: number;
        cards_imported: number;
        materials_imported: number;
      }>(r),
    ),

  exportUrl: `${BASE}/export`,
};

export interface AskStreamHandlers {
  onEvent: (e: AskEvent) => void;
  onError?: (err: Error) => void;
}

/**
 * POST /api/nodes/ask and consume the SSE stream (fetch ReadableStream — no EventSource,
 * because we need POST). Buffers partial `data:` lines like the server-side parser.
 */
export async function streamAsk(body: unknown, handlers: AskStreamHandlers, signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${BASE}/nodes/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error ?? `Ask failed: HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try {
          handlers.onEvent(JSON.parse(line.slice(5).trim()) as AskEvent);
        } catch {
          // ignore malformed frame
        }
      }
    }
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
