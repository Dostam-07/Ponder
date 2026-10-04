import { and, eq, lte, desc, sql, or, isNull } from "drizzle-orm";
import type {
  LearningPath,
  PathSection,
  PracticeAttempt,
  GradeResult,
  KnowledgeCard,
  SourceMaterial,
  MaterialSummary,
  Artifact,
  ArtifactContent,
  Exercise,
  ThinkingMap,
  MapBranch,
  ConceptMastery,
  ReviewState,
} from "@canvas-learn/shared";
import { learningPaths, practiceAttempts, knowledgeCards, sourceMaterials, conceptLinks, thinkingMaps, artifacts, conceptMastery } from "./schema.js";
import type { Db } from "./client.js";

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/* ---------------- Learning paths (spec §2) ---------------- */

export class PathRepo {
  constructor(private db: Db) {}

  forCanvas(canvasId: string): LearningPath | null {
    const r = this.db
      .select()
      .from(learningPaths)
      .where(eq(learningPaths.canvas_id, canvasId))
      .orderBy(desc(learningPaths.created_at))
      .get();
    if (!r) return null;
    return {
      id: r.id,
      canvas_id: r.canvas_id,
      source_id: r.source_id ?? null,
      title: r.title,
      goal: r.goal,
      sections: safeParse<PathSection[]>(r.sections, []),
      created_at: r.created_at,
    };
  }

  create(p: LearningPath): LearningPath {
    this.db.insert(learningPaths).values({
      id: p.id,
      canvas_id: p.canvas_id,
      source_id: p.source_id,
      title: p.title,
      goal: p.goal,
      sections: JSON.stringify(p.sections),
      created_at: p.created_at,
    }).run();
    return p;
  }

  /** Mark a section as started (stores the node it opened). */
  startSection(pathId: string, sectionId: string, nodeId: string) {
    const p = this.db.select().from(learningPaths).where(eq(learningPaths.id, pathId)).get();
    if (!p) return;
    const sections = safeParse<PathSection[]>(p.sections, []);
    const next = sections.map((s) => (s.id === sectionId ? { ...s, node_id: nodeId } : s));
    this.db.update(learningPaths).set({ sections: JSON.stringify(next) }).where(eq(learningPaths.id, pathId)).run();
  }

  delete(id: string) {
    this.db.delete(learningPaths).where(eq(learningPaths.id, id)).run();
  }
}

/* ---------------- Thinking maps (thinking-spec §3) ---------------- */

export class ThinkingMapRepo {
  constructor(private db: Db) {}

  forCanvas(canvasId: string): ThinkingMap | null {
    const r = this.db
      .select()
      .from(thinkingMaps)
      .where(eq(thinkingMaps.canvas_id, canvasId))
      .orderBy(desc(thinkingMaps.created_at))
      .get();
    if (!r) return null;
    return {
      id: r.id,
      canvas_id: r.canvas_id,
      topic: r.topic,
      title: r.title,
      rationale: r.rationale,
      branches: safeParse<MapBranch[]>(r.branches, []),
      created_at: r.created_at,
    };
  }

  create(m: ThinkingMap): ThinkingMap {
    this.db.insert(thinkingMaps).values({
      id: m.id,
      canvas_id: m.canvas_id,
      topic: m.topic ?? "",
      title: m.title,
      rationale: m.rationale,
      branches: JSON.stringify(m.branches),
      created_at: m.created_at,
    }).run();
    return m;
  }

  /** Link a started branch to the node it opened. */
  attachBranch(mapId: string, branchId: string, nodeId: string) {
    const r = this.db.select().from(thinkingMaps).where(eq(thinkingMaps.id, mapId)).get();
    if (!r) return;
    const branches = safeParse<MapBranch[]>(r.branches, []);
    const next = branches.map((b) => (b.id === branchId ? { ...b, node_id: nodeId } : b));
    this.db.update(thinkingMaps).set({ branches: JSON.stringify(next) }).where(eq(thinkingMaps.id, mapId)).run();
  }

  delete(id: string) {
    this.db.delete(thinkingMaps).where(eq(thinkingMaps.id, id)).run();
  }
}

/* ---------------- Practice attempts (spec §8, §9) ---------------- */

export class PracticeRepo {
  constructor(private db: Db) {}

  insert(a: PracticeAttempt) {
    this.db.insert(practiceAttempts).values({
      id: a.id,
      node_id: a.node_id,
      canvas_id: a.canvas_id,
      exercise: JSON.stringify(a.exercise),
      response: a.response === undefined || a.response === null ? null : JSON.stringify(a.response),
      correct: a.correct === null ? null : a.correct ? 1 : 0,
      graded: a.graded ? JSON.stringify(a.graded) : null,
      created_at: a.created_at,
    }).run();
  }

  /** Attempts whose grading flagged a weak concept, most-missed first (spec §9). */
  weakConcepts(limit = 5): { concept: string; misses: number }[] {
    const rows = this.db
      .select({ graded: practiceAttempts.graded })
      .from(practiceAttempts)
      .where(and(eq(practiceAttempts.correct, 0)))
      .orderBy(desc(practiceAttempts.created_at))
      .limit(200)
      .all();
    const counts = new Map<string, number>();
    for (const r of rows) {
      const g = safeParse<GradeResult | null>(r.graded, null);
      const c = g?.concept?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([concept, misses]) => ({ concept, misses }))
      .sort((a, b) => b.misses - a.misses)
      .slice(0, limit);
  }

  stats(): { attempts: number; correct: number } {
    const r = this.db
      .select({
        attempts: sql<number>`COUNT(*)`,
        correct: sql<number>`COALESCE(SUM(correct), 0)`,
      })
      .from(practiceAttempts)
      .get();
    return { attempts: r?.attempts ?? 0, correct: r?.correct ?? 0 };
  }
}

/* ---------------- Knowledge cards (spec §10) ---------------- */

export class CardRepo {
  constructor(private db: Db) {}

  list(): KnowledgeCard[] {
    return this.db.select().from(knowledgeCards).orderBy(desc(knowledgeCards.created_at)).all().map(cardFromRow);
  }

  due(now: number): KnowledgeCard[] {
    return this.db
      .select()
      .from(knowledgeCards)
      .where(lte(knowledgeCards.due_at, now))
      .orderBy(knowledgeCards.due_at)
      .all()
      .map(cardFromRow);
  }

  get(id: string): KnowledgeCard | undefined {
    const r = this.db.select().from(knowledgeCards).where(eq(knowledgeCards.id, id)).get();
    return r ? cardFromRow(r) : undefined;
  }

  insert(c: KnowledgeCard) {
    this.db.insert(knowledgeCards).values(cardToRow(c)).run();
  }

  updateNotes(id: string, notes: string) {
    this.db.update(knowledgeCards).set({ notes }).where(eq(knowledgeCards.id, id)).run();
  }

  /** FSRS-lite spacing: interval grows with successful reviews, resets on a miss. */
  review(id: string, correct: boolean): KnowledgeCard | undefined {
    const card = this.get(id);
    if (!card) return undefined;
    const now = Date.now();
    const streak = correct ? Math.min(card.times_reviewed + 1, 8) : 0;
    const intervalDays = correct ? Math.min(1 * 2 ** streak, 60) : 1;
    const updated: KnowledgeCard = {
      ...card,
      times_reviewed: card.times_reviewed + 1,
      last_reviewed_at: now,
      due_at: now + intervalDays * 24 * 60 * 60 * 1000,
    };
    this.db
      .update(knowledgeCards)
      .set({
        times_reviewed: updated.times_reviewed,
        last_reviewed_at: updated.last_reviewed_at,
        due_at: updated.due_at,
      })
      .where(eq(knowledgeCards.id, id))
      .run();
    return updated;
  }

  delete(id: string) {
    this.db.delete(knowledgeCards).where(eq(knowledgeCards.id, id)).run();
  }
}

/* ---------------- Concept mastery (roadmap 6) — per-concept FSRS state ---------------- */

type ConceptRow = typeof conceptMastery.$inferSelect;

function conceptFromRow(r: ConceptRow): ConceptMastery {
  return {
    concept: r.concept,
    canvas_id: null,
    review_state: safeParse<ReviewState>(r.review_state, {
      due_at: r.due_at,
      interval_days: 0,
      ease: 2.5,
      stability: 0,
      difficulty: 0,
      last_reviewed_at: null,
      times_reviewed: r.times_reviewed,
    }),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Stores a full FSRS ReviewState per canonical concept. The route applies the
 * grade (via FsrsScheduler); this repo only persists + queries so weak topics can
 * resurface in the review queue independent of which canvas raised them.
 */
export class ConceptMasteryRepo {
  constructor(private db: Db) {}

  get(concept: string): ConceptMastery | undefined {
    const r = this.db.select().from(conceptMastery).where(eq(conceptMastery.concept, concept)).get();
    return r ? conceptFromRow(r) : undefined;
  }

  upsert(cm: ConceptMastery): ConceptMastery {
    this.db
      .insert(conceptMastery)
      .values({
        concept: cm.concept,
        review_state: JSON.stringify(cm.review_state),
        due_at: cm.review_state.due_at,
        times_reviewed: cm.review_state.times_reviewed,
        created_at: cm.created_at,
        updated_at: cm.updated_at,
      })
      .onConflictDoUpdate({
        target: conceptMastery.concept,
        set: {
          review_state: JSON.stringify(cm.review_state),
          due_at: cm.review_state.due_at,
          times_reviewed: cm.review_state.times_reviewed,
          updated_at: cm.updated_at,
        },
      })
      .run();
    return cm;
  }

  /** Concepts whose FSRS due time has arrived, soonest first (weak topics first). */
  due(now: number): ConceptMastery[] {
    return this.db
      .select()
      .from(conceptMastery)
      .where(lte(conceptMastery.due_at, now))
      .orderBy(conceptMastery.due_at)
      .all()
      .map(conceptFromRow);
  }

  all(): ConceptMastery[] {
    return this.db.select().from(conceptMastery).orderBy(desc(conceptMastery.updated_at)).all().map(conceptFromRow);
  }
}

type CardRow = typeof knowledgeCards.$inferSelect;

function cardFromRow(r: CardRow): KnowledgeCard {
  return {
    id: r.id,
    node_id: r.node_id ?? null,
    canvas_id: r.canvas_id ?? null,
    concept: r.concept,
    explanation: r.explanation,
    example: r.example,
    source: r.source,
    notes: r.notes,
    due_at: r.due_at,
    times_reviewed: r.times_reviewed,
    last_reviewed_at: r.last_reviewed_at ?? null,
    created_at: r.created_at,
  };
}

function cardToRow(c: KnowledgeCard) {
  return {
    id: c.id,
    node_id: c.node_id,
    canvas_id: c.canvas_id,
    concept: c.concept,
    explanation: c.explanation,
    example: c.example,
    source: c.source,
    notes: c.notes,
    due_at: c.due_at,
    times_reviewed: c.times_reviewed,
    last_reviewed_at: c.last_reviewed_at,
    created_at: c.created_at,
  };
}

/* ---------------- Source materials (spec §12) ---------------- */

export class MaterialRepo {
  constructor(private db: Db) {}

  get(id: string): SourceMaterial | undefined {
    const r = this.db.select().from(sourceMaterials).where(eq(sourceMaterials.id, id)).get();
    return r ? materialFromRow(r) : undefined;
  }

  list(): Omit<SourceMaterial, "content">[] {
    return this.db
      .select()
      .from(sourceMaterials)
      .orderBy(desc(sourceMaterials.created_at))
      .all()
      .map((r) => materialMeta(r));
  }

  /** Full materials (with content) — used for shareable export (roadmap 7). */
  listFull(): SourceMaterial[] {
    return this.db
      .select()
      .from(sourceMaterials)
      .orderBy(desc(sourceMaterials.created_at))
      .all()
      .map(materialFromRow);
  }

  /** Canvas-attached sources + global ones (null canvas) — what the Source Explorer for a canvas shows. */
  listForCanvas(canvasId: string): SourceMaterial[] {
    return this.db
      .select()
      .from(sourceMaterials)
      .where(or(eq(sourceMaterials.canvas_id, canvasId), isNull(sourceMaterials.canvas_id)))
      .orderBy(desc(sourceMaterials.created_at))
      .all()
      .map(materialFromRow);
  }

  insert(m: SourceMaterial) {
    this.db
      .insert(sourceMaterials)
      .values({
        id: m.id,
        kind: m.kind,
        title: m.title,
        content: m.content,
        char_count: m.char_count,
        canvas_id: m.canvas_id ?? null,
        summary: m.summary ?? "",
        key_points: JSON.stringify(m.key_points ?? []),
        concepts: JSON.stringify(m.concepts ?? []),
        created_at: m.created_at,
      })
      .run();
  }

  /** Persist cached generation results (summary/key points/concepts) after the LLM call. */
  updateMeta(id: string, meta: { summary: string; key_points: string[]; concepts: string[] }) {
    this.db
      .update(sourceMaterials)
      .set({ summary: meta.summary, key_points: JSON.stringify(meta.key_points), concepts: JSON.stringify(meta.concepts) })
      .where(eq(sourceMaterials.id, id))
      .run();
  }

  delete(id: string) {
    this.db.delete(sourceMaterials).where(eq(sourceMaterials.id, id)).run();
  }
}

type MaterialRow = {
  id: string;
  kind: string;
  title: string;
  content: string;
  char_count: number;
  canvas_id: string | null;
  summary: string | null;
  key_points: string | null;
  concepts: string | null;
  created_at: number;
};

function materialFromRow(r: MaterialRow): SourceMaterial {
  return {
    id: r.id,
    kind: r.kind as SourceMaterial["kind"],
    title: r.title,
    content: r.content,
    char_count: r.char_count,
    canvas_id: r.canvas_id ?? null,
    summary: r.summary ?? "",
    key_points: jsonStrArr(r.key_points),
    concepts: jsonStrArr(r.concepts),
    created_at: r.created_at,
  };
}

/** Metadata view (no content) for lists. */
function materialMeta(r: MaterialRow): Omit<SourceMaterial, "content"> {
  return {
    id: r.id,
    kind: r.kind as SourceMaterial["kind"],
    title: r.title,
    char_count: r.char_count,
    canvas_id: r.canvas_id ?? null,
    summary: r.summary ?? "",
    key_points: jsonStrArr(r.key_points),
    concepts: jsonStrArr(r.concepts),
    created_at: r.created_at,
  };
}

function jsonStrArr(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/* ---------------- Artifacts (roadmap: generated from real canvas nodes) ---------------- */

export class ArtifactRepo {
  constructor(private db: Db) {}

  forCanvas(canvasId: string): Artifact[] {
    return this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.canvas_id, canvasId))
      .orderBy(desc(artifacts.created_at))
      .all()
      .map((r) => ({
        id: r.id,
        canvas_id: r.canvas_id,
        kind: r.kind as Artifact["kind"],
        title: r.title,
        content: safeParse<ArtifactContent>(r.content, { kind: "study_guide", sections: [] }) as ArtifactContent,
        node_count: r.node_count,
        created_at: r.created_at,
      }));
  }

  get(id: string): Artifact | undefined {
    const r = this.db.select().from(artifacts).where(eq(artifacts.id, id)).get();
    if (!r) return undefined;
    return {
      id: r.id,
      canvas_id: r.canvas_id,
      kind: r.kind as Artifact["kind"],
      title: r.title,
      content: safeParse<ArtifactContent>(r.content, { kind: "study_guide", sections: [] }) as ArtifactContent,
      node_count: r.node_count,
      created_at: r.created_at,
    };
  }

  insert(a: Artifact) {
    this.db
      .insert(artifacts)
      .values({ id: a.id, canvas_id: a.canvas_id, kind: a.kind, title: a.title, content: JSON.stringify(a.content), node_count: a.node_count, created_at: a.created_at })
      .run();
  }

  delete(id: string) {
    this.db.delete(artifacts).where(eq(artifacts.id, id)).run();
  }
}

/* ---------------- Concept links (spec §6) ---------------- */

export class LinkRepo {
  constructor(private db: Db) {}

  forCanvas(canvasId: string) {
    return this.db
      .select({
        id: conceptLinks.id,
        source: conceptLinks.source,
        target: conceptLinks.target,
        label: conceptLinks.label,
      })
      .from(conceptLinks)
      .where(eq(conceptLinks.canvas_id, canvasId))
      .all();
  }

  /** Full links (with canvas_id + created_at) for shareable export (roadmap 7). */
  forCanvasFull(canvasId: string) {
    return this.db.select().from(conceptLinks).where(eq(conceptLinks.canvas_id, canvasId)).all();
  }

  getLink(id: string) {
    return this.db.select().from(conceptLinks).where(eq(conceptLinks.id, id)).get();
  }

  insertLink(l: { id: string; canvas_id: string; source: string; target: string; label: string; created_at: number }) {
    this.db.insert(conceptLinks).values(l).run();
  }

  create(canvasId: string, source: string, target: string, label: string) {
    const link = { id: crypto.randomUUID(), canvas_id: canvasId, source, target, label, created_at: Date.now() };
    this.db.insert(conceptLinks).values(link).run();
    return { id: link.id, source: link.source, target: link.target, label: link.label };
  }

  delete(id: string) {
    this.db.delete(conceptLinks).where(eq(conceptLinks.id, id)).run();
  }
}
