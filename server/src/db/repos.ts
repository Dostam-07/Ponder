import type { Db, Sqlite } from "./client.js";
import { and, eq, lte, desc, sql } from "drizzle-orm";
import type { NodeEntity, CanvasEntity, LibraryItem } from "@canvas-learn/shared";
import { libraryItems, canvases, nodes } from "./schema.js";

/** Map a flat DB row to the shared NodeEntity shape. */
export function rowToNode(r: any): NodeEntity {
  return {
    id: r.id,
    canvas_id: r.canvas_id,
    parent_id: r.parent_id ?? null,
    branch_origin: r.branch_origin,
    status: r.status,
    title: r.title,
    question: r.question,
    answer_text: r.answer_text,
    key_terms: safeParse(r.key_terms, []),
    suggested_followups: safeParse(r.suggested_followups, []),
    tags: safeParse(r.tags, []),
    visual:
      r.visual_type != null
        ? {
            type: r.visual_type,
            status: r.visual_status ?? "pending",
            spec: r.visual_spec ? safeParse(r.visual_spec, null) : null,
            ...(r.visual_error ? { error: safeParse(r.visual_error, undefined) } : {}),
          }
        : null,
    position: { x: r.position_x, y: r.position_y },
    width: r.width,
    collapsed: !!r.collapsed,
    saved_to_library: !!r.saved_to_library,
    model_used: r.model_used,
    web_search_used: !!r.web_search_used,
    context_summary: r.context_summary,
    mode: r.mode ?? "",
    sources: safeParse(r.sources, []),
    provenance: r.provenance ? safeParse(r.provenance, null) : null,
    gaps: safeParse(r.gaps, []),
    material_id: r.material_id ?? null,
    sections: safeParse(r.sections, []),
    note: r.note ?? "",
    important: !!r.important,
    review_state: {
      due_at: r.review_due_at,
      interval_days: r.review_interval_days,
      ease: r.review_ease,
      stability: r.review_stability,
      difficulty: r.review_difficulty,
      last_reviewed_at: r.review_last_reviewed_at,
      times_reviewed: r.review_times_reviewed,
    },
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Map a NodeEntity to a flat DB row (all fields covered). */
export function nodeToRow(n: NodeEntity) {
  return {
    id: n.id,
    canvas_id: n.canvas_id,
    parent_id: n.parent_id,
    branch_origin: n.branch_origin,
    status: n.status,
    title: n.title,
    question: n.question,
    answer_text: n.answer_text,
    key_terms: JSON.stringify(n.key_terms),
    suggested_followups: JSON.stringify(n.suggested_followups),
    tags: JSON.stringify(n.tags),
    visual_type: n.visual?.type ?? null,
    visual_status: n.visual?.status ?? null,
    visual_spec: n.visual ? JSON.stringify(n.visual.spec) : null,
    visual_error: n.visual?.error ? JSON.stringify(n.visual.error) : null,
    position_x: n.position.x,
    position_y: n.position.y,
    width: n.width,
    collapsed: n.collapsed,
    saved_to_library: n.saved_to_library,
    model_used: n.model_used,
    web_search_used: n.web_search_used,
    context_summary: n.context_summary,
    mode: n.mode ?? "",
    sources: JSON.stringify(n.sources ?? []),
    provenance: n.provenance != null ? JSON.stringify(n.provenance) : null,
    gaps: JSON.stringify(n.gaps ?? []),
    material_id: n.material_id ?? null,
    sections: JSON.stringify(n.sections ?? []),
    note: n.note ?? "",
    important: n.important ?? false,
    review_due_at: n.review_state.due_at,
    review_interval_days: n.review_state.interval_days,
    review_ease: n.review_state.ease,
    review_stability: n.review_state.stability,
    review_difficulty: n.review_state.difficulty,
    review_last_reviewed_at: n.review_state.last_reviewed_at,
    review_times_reviewed: n.review_state.times_reviewed,
    created_at: n.created_at,
    updated_at: n.updated_at,
  };
}

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export class CanvasRepo {
  constructor(private db: Db) {}

  list(): CanvasEntity[] {
    return this.db
      .select({
        id: canvases.id,
        title: canvases.title,
        created_at: canvases.created_at,
        updated_at: canvases.updated_at,
        node_count: sql<number>`(SELECT COUNT(*) FROM nodes WHERE nodes.canvas_id = canvases.id)`,
      })
      .from(canvases)
      .orderBy(desc(canvases.updated_at))
      .all() as CanvasEntity[];
  }

  get(id: string) {
    return this.db.select().from(canvases).where(eq(canvases.id, id)).get();
  }

  create(title: string): CanvasEntity {
    const now = Date.now();
    const c = { id: crypto.randomUUID(), title, created_at: now, updated_at: now };
    this.db.insert(canvases).values(c).run();
    return { ...c, node_count: 0 };
  }

  rename(id: string, title: string) {
    this.db.update(canvases).set({ title, updated_at: Date.now() }).where(eq(canvases.id, id)).run();
    return this.get(id);
  }

  touch(id: string) {
    this.db.update(canvases).set({ updated_at: Date.now() }).where(eq(canvases.id, id)).run();
  }

  delete(id: string) {
    this.db.delete(canvases).where(eq(canvases.id, id)).run();
  }
}

export class NodeRepo {
  constructor(private db: Db) {}

  listByCanvas(canvasId: string): NodeEntity[] {
    return this.db.select().from(nodes).where(eq(nodes.canvas_id, canvasId)).all().map(rowToNode);
  }

  /** Mark any node left in-flight by a previous server process as failed (startup hygiene). */
  markOrphanedAsFailed(): void {
    this.db
      .update(nodes)
      .set({ status: "failed", model_used: "" })
      .where(eq(nodes.status, "answering"))
      .run();
  }

  get(id: string): NodeEntity | undefined {
    const r = this.db.select().from(nodes).where(eq(nodes.id, id)).get();
    return r ? rowToNode(r) : undefined;
  }

  insert(n: NodeEntity) {
    this.db.insert(nodes).values(nodeToRow(n)).run();
  }

  /** Patch arbitrary fields on a node; re-maps through nodeToRow for correctness. */
  update(id: string, patch: Partial<NodeEntity>) {
    const existing = this.get(id);
    if (!existing) return;
    const merged: NodeEntity = { ...existing, ...patch, updated_at: Date.now() };
    this.db.update(nodes).set(nodeToRow(merged)).where(eq(nodes.id, id)).run();
  }

  delete(id: string) {
    this.db.delete(nodes).where(eq(nodes.id, id)).run();
  }

  /** Delete a node and its whole subtree (children cascade in the repo layer). */
  deleteSubtree(rootId: string): string[] {
    const all = this.db.select({ id: nodes.id, parent_id: nodes.parent_id }).from(nodes).all();
    const childrenOf = new Map<string | null, string[]>();
    for (const r of all) {
      const list = childrenOf.get(r.parent_id) ?? [];
      list.push(r.id);
      childrenOf.set(r.parent_id, list);
    }
    const doomed: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      doomed.push(cur);
      for (const child of childrenOf.get(cur) ?? []) stack.push(child);
    }
    for (const id of doomed) this.db.delete(nodes).where(eq(nodes.id, id)).run();
    return doomed;
  }

  /** Complete nodes whose review is due, oldest due first. */
  listDue(now: number, limit = 100): NodeEntity[] {
    return this.db
      .select()
      .from(nodes)
      .where(and(lte(nodes.review_due_at, now), eq(nodes.status, "complete")))
      .orderBy(nodes.review_due_at)
      .limit(limit)
      .all()
      .map(rowToNode);
  }
}

export class LibraryRepo {
  constructor(private db: Db) {}

  list(): LibraryItem[] {
    return this.db
      .select()
      .from(libraryItems)
      .orderBy(desc(libraryItems.saved_at))
      .all()
      .map((r) => ({
        id: r.id,
        canvas_id: r.canvas_id,
        node_id: r.node_id,
        title: r.title,
        question: r.question,
        answer_text: r.answer_text,
        visual_type: r.visual_type,
        visual_spec: r.visual_spec ? safeParse(r.visual_spec, null) : null,
        tags: safeParse(r.tags, []),
        saved_at: r.saved_at,
      }));
  }

  insert(item: LibraryItem) {
    this.db
      .insert(libraryItems)
      .values({
        ...item,
        tags: JSON.stringify(item.tags),
        visual_spec: item.visual_spec != null ? JSON.stringify(item.visual_spec) : null,
      })
      .run();
  }

  delete(id: string) {
    this.db.delete(libraryItems).where(eq(libraryItems.id, id)).run();
  }
}
