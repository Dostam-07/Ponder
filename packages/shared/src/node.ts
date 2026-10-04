import { z } from "zod";
import { VisualBlock } from "./visual.js";

export const BranchOrigin = z.enum([
  "thread", // global prompt bar → root node
  "followup_box", // node-local follow-up input
  "term_chip", // inline key-term chip click
  "suggested_question", // suggested follow-up row click
  "manual_plus", // directional + button
  "regenerate", // re-run pipeline on an existing node
  "path_section", // node created by starting a learning-path section
  "material", // node asking about user-provided source material
]);
export type BranchOrigin = z.infer<typeof BranchOrigin>;

export const NodeStatus = z.enum(["pending", "answering", "complete", "failed"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

/**
 * Thinking modes (thinking-spec §2) — each one changes HOW stage 1 answers,
 * not just its label. See modeDirective in server/src/pipeline/prompts.ts.
 */
export const ThinkingMode = z.enum([
  "explain",
  "explore",
  "challenge",
  "compare",
  "debate",
  "apply",
  "create",
  "practice",
  "research",
  "socratic",
]);
export type ThinkingMode = z.infer<typeof ThinkingMode>;

/** A retrieved web source attached to an answer (thinking-spec §8). Real snippets only. */
export const SourceRef = z.object({
  title: z.string(),
  snippet: z.string(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * Claim-level provenance for an answer (research-spec §1): where does this
 * answer's substance actually come from?
 * - "sourced"   — grounded in one of the user's own sources (a supporting quote is stored)
 * - "context"   — backed by retrieved web context (see node.sources)
 * - "uncertain" — the answer goes beyond what the user's sources support
 * null = no source research was involved in this answer (plain tutoring).
 */
export const Provenance = z.object({
  status: z.enum(["sourced", "context", "uncertain"]),
  /** short supporting quote from the user's source (≤120 chars), when status="sourced" */
  quote: z.string().default(""),
  /** which material the answer was grounded in, when status="sourced" */
  material_id: z.string().uuid().nullable().default(null),
});
export type Provenance = z.infer<typeof Provenance>;

/** A missing prerequisite the learner hasn't established yet (thinking-spec §19). */
export const KnowledgeGap = z.object({
  label: z.string(),
  question: z.string(),
});
export type KnowledgeGap = z.infer<typeof KnowledgeGap>;

export const ReviewState = z.object({
  due_at: z.number(), // epoch ms
  interval_days: z.number(),
  ease: z.number(), // legacy PRD field; kept = difficulty rounding for display
  /** FSRS memory state (PRD §5.2 names FSRS; ts-fsrs needs stability+difficulty) */
  stability: z.number().default(0),
  difficulty: z.number().default(0),
  last_reviewed_at: z.number().nullable(),
  times_reviewed: z.number(),
});
export type ReviewState = z.infer<typeof ReviewState>;

export const Position = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof Position>;

export const NodeEntity = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(), // null = root node (new thread)
  branch_origin: BranchOrigin,
  status: NodeStatus,
  title: z.string().default(""), // auto-generated short title, set once the answer completes
  question: z.string(),
  answer_text: z.string().default(""), // markdown incl. inline [[term]] markup
  key_terms: z.array(z.string()).default([]),
  suggested_followups: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  visual: VisualBlock.nullable().default(null),
  position: Position,
  width: z.number().default(420),
  collapsed: z.boolean().default(false),
  saved_to_library: z.boolean().default(false),
  model_used: z.string().default(""),
  web_search_used: z.boolean().default(false),
  context_summary: z.string().default(""), // cached ancestor-chain summary (context > 5 nodes)
  /** thinking mode this node was answered with (thinking-spec §2); "" = classic explain */
  mode: z.string().default(""),
  /** retrieved web sources backing the answer (thinking-spec §8); real snippets only */
  sources: z.array(SourceRef).default([]),
  /** where the answer's claims come from (research-spec §1); null = no source research involved */
  provenance: Provenance.nullable().default(null),
  /** prerequisite ideas not yet established (thinking-spec §19) */
  gaps: z.array(KnowledgeGap).default([]),
  /** id of the source_material this node is grounded in (spec §12) */
  material_id: z.string().uuid().nullable().default(null),
  /** bite-sized structured answer (spec §4): concept/why/example/mental model/go deeper */
  sections: z
    .array(z.object({ heading: z.string(), body: z.string() }))
    .default([]),
  /** user note attached to the node (canvas notes, spec §6) */
  note: z.string().default(""),
  /** user stars the node as an important idea (spec §6) */
  important: z.boolean().default(false),
  review_state: ReviewState,
  created_at: z.number(),
  updated_at: z.number(),
});
export type NodeEntity = z.infer<typeof NodeEntity>;

/** Shape sent to POST /api/canvases/:id/nodes to create a node (question part supplied by client). */
export const CreateNodeInput = z.object({
  parent_id: z.string().uuid().nullable(),
  branch_origin: BranchOrigin,
  question: z.string().min(1).max(2000),
  position: Position,
  model_speed: z.enum(["fast", "quality"]).default("fast"),
  web_search: z.boolean().default(false),
  /** regenerate: re-run the pipeline on this node instead of creating a new one */
  regenerate_of: z.string().uuid().optional(),
});
export type CreateNodeInput = z.infer<typeof CreateNodeInput>;

export const CanvasEntity = z.object({
  id: z.string().uuid(),
  title: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  node_count: z.number().default(0),
});
export type CanvasEntity = z.infer<typeof CanvasEntity>;

/** Saved node summary in the Library (PRD FR3 "save to library"). */
export const LibraryItem = z.object({
  id: z.string(),
  canvas_id: z.string(),
  node_id: z.string(),
  title: z.string(),
  question: z.string(),
  answer_text: z.string(),
  visual_type: z.string().nullable(),
  visual_spec: z.unknown().nullable(),
  tags: z.array(z.string()),
  saved_at: z.number(),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

/** app_state key/value rows (global counters per ADR-001: streak/stars are app-global, not per-canvas) */
export const AppStats = z.object({
  streak_count: z.number(),
  stars_count: z.number(),
  last_active_date: z.string(), // YYYY-MM-DD local
  due_count: z.number(),
});
export type AppStats = z.infer<typeof AppStats>;
