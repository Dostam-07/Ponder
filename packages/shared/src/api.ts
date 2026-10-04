import { z } from "zod";
import { NodeEntity, Position } from "./node.js";
import { VisualStatus } from "./visual.js";
import { LearningProfile } from "./learning.js";
import { ThinkingMode } from "./node.js";

/** Events streamed by POST /api/nodes/ask (SSE over fetch ReadableStream). */
export const AskEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("node_created"), node: NodeEntity }),
  z.object({ type: z.literal("delta"), node_id: z.string(), text: z.string() }),
  /** emitted when failover restarts stage 1 mid-stream; client clears the partial answer */
  z.object({ type: z.literal("reset"), node_id: z.string() }),
  z.object({
    type: z.literal("stage2"),
    node_id: z.string(),
    title: z.string(),
    followups: z.array(z.string()),
    tags: z.array(z.string()),
  }),
  z.object({ type: z.literal("visual_status"), node_id: z.string(), status: VisualStatus, message: z.string() }),
  z.object({ type: z.literal("visual"), node_id: z.string(), block: z.unknown() }),
  // `node` (optional) carries the FINAL persisted node — provenance/gaps/sections
  // are written after `stage2`, so without it the client's card stays stale.
  z.object({ type: z.literal("done"), node_id: z.string(), node: NodeEntity.optional() }),
  z.object({ type: z.literal("error"), node_id: z.string().nullable(), message: z.string() }),
  /**
   * Emitted once when a canvas that was still "Untitled canvas" gets its
   * conversation title derived from the first real question/answer. The title
   * is set on the server; this lets the open canvas + sidebar update live.
   */
  z.object({ type: z.literal("canvas_titled"), canvas_id: z.string().uuid(), title: z.string() }),
]);
export type AskEvent = z.infer<typeof AskEvent>;

/** Body for POST /api/nodes/ask. */
export const AskRequest = z.object({
  canvas_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  branch_origin: z.enum(["thread", "followup_box", "term_chip", "suggested_question", "manual_plus", "regenerate", "path_section", "material"]),
  question: z.string().min(1).max(2000),
  position: Position,
  model_speed: z.enum(["fast", "quality"]).default("fast"),
  web_search: z.boolean().default(false),
  regenerate_of: z.string().uuid().optional(),
  /** Selected text passed as grounding context (Ask Ponder on content). Not shown as the question. */
  context_text: z.string().max(2000).optional(),
  /** Personalization for this ask (spec §3); falls back to canvas profile when omitted. */
  profile: LearningProfile.optional(),
  /** Grounding source material (spec §12): answers must stay faithful to this content. */
  material_id: z.string().uuid().optional(),
  /** Ask style override (spec §17) — rephrases stage-1 instructions for this ask only. */
  explain_like: z.string().max(120).optional(),
  /** Compare request (spec §16): "A vs B" becomes a comparison-table visual. */
  compare: z.boolean().optional(),
  /** Thinking mode (thinking-spec §2, research-spec §7): changes HOW the answer is produced. */
  mode: ThinkingMode.optional(),
  /** Challenge/why/apply/create/research extras: the claim or reasoning to inspect. */
  challenge_of: z.string().max(2000).optional(),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const GraphResponse = z.object({
  canvas: z.object({
    id: z.string().uuid(),
    title: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  }),
  nodes: z.array(NodeEntity),
  /** concept links drawn on the canvas (spec §6) */
  links: z.array(z.object({ id: z.string().uuid(), source: z.string().uuid(), target: z.string().uuid(), label: z.string().default("") })).default([]),
  /** the canvas's learning path, when one exists (spec §2) */
  path: z.unknown().nullable().default(null),
  /** this canvas's thinking map (thinking-spec §3), when generated */
  map: z.unknown().nullable().default(null),
});
export type GraphResponse = z.infer<typeof GraphResponse>;

/** A branch of the thinking map (thinking-spec §3): real questions derived from the user's canvas content. */
export const MapBranch = z.object({
  id: z.string(),
  label: z.string().max(60),
  /** the concrete question this branch explores — clicking it starts a real ask */
  question: z.string().max(300),
  /** node that grew out of this branch, once started */
  node_id: z.string().uuid().nullable().default(null),
});
export type MapBranch = z.infer<typeof MapBranch>;

export const ThinkingMap = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  /** the topic/question the map decomposes */
  topic: z.string().max(300).default(""),
  title: z.string().max(80),
  /** why this question is worth mapping, from the AI */
  rationale: z.string().max(400).default(""),
  branches: z.array(MapBranch).default([]),
  created_at: z.number(),
});
export type ThinkingMap = z.infer<typeof ThinkingMap>;

/** Body for POST /api/canvases/:id/map (thinking-spec §3). */
export const CreateMapInput = z.object({
  topic: z.string().min(1).max(300).optional(),
});
export type CreateMapInput = z.infer<typeof CreateMapInput>;

/** Body for POST /api/canvases/:id/links (concept links on the canvas). */
export const CreateLinkInput = z.object({
  source: z.string().uuid(),
  target: z.string().uuid(),
  label: z.string().max(60).optional(),
});
export type CreateLinkInput = z.infer<typeof CreateLinkInput>;

/** Practice generation request (spec §8). */
export const PracticeRequest = z.object({
  node_id: z.string().uuid(),
  count: z.number().int().min(1).max(5).default(3),
});
export type PracticeRequest = z.infer<typeof PracticeRequest>;
