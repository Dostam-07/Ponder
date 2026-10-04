import { z } from "zod";
import { Provenance, ReviewState, SourceRef } from "./node.js";

/* ---------------- Personalization (spec §3) — modifies real prompts ---------------- */

export const LearningGoal = z.enum([
  "basics",
  "exam",
  "deep",
  "practical",
  "build",
  "review",
]);
export type LearningGoal = z.infer<typeof LearningGoal>;

export const LearningLevel = z.enum(["beginner", "intermediate", "advanced"]);
export type LearningLevel = z.infer<typeof LearningLevel>;

export const LearningStyle = z.enum([
  "simple",
  "analogy",
  "visual",
  "mathematical",
  "practical",
  "socratic",
]);
export type LearningStyle = z.infer<typeof LearningStyle>;

export const LearningTime = z.enum(["5", "15", "30", "deep"]);
export type LearningTime = z.infer<typeof LearningTime>;

export const LearningProfile = z.object({
  goal: LearningGoal,
  level: LearningLevel,
  style: LearningStyle,
  time: LearningTime,
});
export type LearningProfile = z.infer<typeof LearningProfile>;

export const DEFAULT_PROFILE: LearningProfile = {
  goal: "basics",
  level: "beginner",
  style: "simple",
  time: "15",
};

/* ---------------- Learning Paths (spec §2, §18) ---------------- */

export const PathSection = z.object({
  id: z.string(),
  title: z.string(),
  points: z.array(z.string()).min(1).max(6), // sub-bullets: what this section covers
  /** id of the node the section was started into (null until entered) */
  node_id: z.string().uuid().nullable().default(null),
});
export type PathSection = z.infer<typeof PathSection>;

export const LearningPath = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  /** source_material this path was built from, when applicable */
  source_id: z.string().uuid().nullable().default(null),
  title: z.string(),
  /** one-line framing of where the learner is heading */
  goal: z.string().default(""),
  sections: z.array(PathSection).min(1).max(12),
  created_at: z.number(),
});
export type LearningPath = z.infer<typeof LearningPath>;

/* ---------------- Exercises (spec §8) — generated from real material ---------------- */

export const ExerciseType = z.enum([
  "multiple_choice",
  "fill_blank",
  "order_steps",
  "short_answer",
  "scenario",
]);
export type ExerciseType = z.infer<typeof ExerciseType>;

const mc = z.object({
  type: z.literal("multiple_choice"),
  question: z.string(),
  options: z.array(z.string()).min(2).max(6),
  correct_index: z.number().int().min(0),
  explanation: z.string(),
});

const fill = z.object({
  type: z.literal("fill_blank"),
  question: z.string(), // contains "___" where the blank is
  answer: z.string(),
  explanation: z.string(),
});

const order = z.object({
  type: z.literal("order_steps"),
  question: z.string(),
  /** steps in the CORRECT order; the UI shuffles them */
  steps: z.array(z.string()).min(2).max(6),
  explanation: z.string(),
});

const short = z.object({
  type: z.literal("short_answer"),
  question: z.string(),
  /** model answer used for grading the learner's free-text response */
  answer: z.string(),
  explanation: z.string(),
});

const scenario = z.object({
  type: z.literal("scenario"),
  question: z.string(), // realistic situation
  answer: z.string(), // what a good response contains (grading rubric)
  explanation: z.string(),
});

const ExerciseUnion = z.discriminatedUnion("type", [mc, fill, order, short, scenario]);

/** Cross-field check kept at the union level so every exercise stays discriminated. */
export const Exercise = ExerciseUnion.superRefine((val, ctx) => {
  if (val.type === "multiple_choice" && val.correct_index >= val.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "correct_index out of range", path: ["correct_index"] });
  }
  if (val.type === "fill_blank" && !val.question.includes("___")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "fill_blank question must contain ___", path: ["question"] });
  }
});
export type Exercise = z.infer<typeof Exercise>;

/** How the learner's answer was judged — grading is AI-assisted for free text. */
export const GradeResult = z.object({
  correct: z.boolean(),
  /** for partially-correct free-text answers */
  partial: z.boolean().default(false),
  feedback: z.string(),
  /** concept label extracted for adaptive reinforcement (spec §9) */
  concept: z.string().default(""),
});
export type GradeResult = z.infer<typeof GradeResult>;

export const PracticeAttempt = z.object({
  id: z.string().uuid(),
  node_id: z.string().uuid().nullable(),
  canvas_id: z.string().uuid().nullable(),
  exercise: Exercise,
  /** what the user did */
  response: z.unknown().nullable(), // number | string | number[] | null (skipped)
  correct: z.boolean().nullable(), // null = not yet graded/skipped
  graded: GradeResult.nullable().default(null),
  created_at: z.number(),
});
export type PracticeAttempt = z.infer<typeof PracticeAttempt>;

/* ---------------- Knowledge Cards (spec §10) ---------------- */

export const KnowledgeCard = z.object({
  id: z.string().uuid(),
  node_id: z.string().uuid().nullable().default(null), // source conversation node
  canvas_id: z.string().uuid().nullable().default(null),
  concept: z.string(),
  explanation: z.string(), // 1-3 sentences
  example: z.string().default(""),
  /** source/context: canvas title + question, or material title */
  source: z.string().default(""),
  notes: z.string().default(""),
  /** FSRS-style scheduling (reuses the review tables' semantics) */
  due_at: z.number(),
  times_reviewed: z.number().default(0),
  last_reviewed_at: z.number().nullable().default(null),
  created_at: z.number(),
});
export type KnowledgeCard = z.infer<typeof KnowledgeCard>;

/* ---------------- Source Materials (spec §12) — real user content ---------------- */

export const MaterialKind = z.enum(["text", "url", "pdf", "image"]);
export type MaterialKind = z.infer<typeof MaterialKind>;

export const SourceMaterial = z.object({
  id: z.string().uuid(),
  kind: MaterialKind,
  title: z.string(),
  /** extracted plain text (fetched for URLs, extracted from PDFs) */
  content: z.string(),
  char_count: z.number(),
  /** canvas this source is attached to (null = global, available everywhere) */
  canvas_id: z.string().uuid().nullable().default(null),
  /** cached generation results so the Source Explorer lists them without re-invoking the LLM */
  summary: z.string().default(""),
  key_points: z.array(z.string()).max(8).default([]),
  concepts: z.array(z.string()).max(10).default([]),
  created_at: z.number(),
});
export type SourceMaterial = z.infer<typeof SourceMaterial>;

/** Summary payload generated for a material. */
export const MaterialSummary = z.object({
  summary: z.string(),
  key_points: z.array(z.string()).max(8),
  concepts: z.array(z.string()).max(10),
});
export type MaterialSummary = z.infer<typeof MaterialSummary>;

/** Body for POST /api/materials/upload — file contents arrive base64 (no multipart dependency). */
export const MaterialUploadInput = z.object({
  filename: z.string().min(1).max(300),
  content_base64: z.string().min(1),
  canvas_id: z.string().uuid().nullable().optional(),
});
export type MaterialUploadInput = z.infer<typeof MaterialUploadInput>;

/** One answer's audit row in the Source Explorer. */
export const CanvasSourceAnswer = z.object({
  node_id: z.string().uuid(),
  title: z.string(),
  question: z.string(),
  provenance: Provenance.nullable().default(null),
  sources: z.array(SourceRef).default([]),
  material_id: z.string().uuid().nullable().default(null),
});
export type CanvasSourceAnswer = z.infer<typeof CanvasSourceAnswer>;

/** GET /api/canvases/:id/sources — the full audit view: materials ↔ answers. */
export const CanvasSources = z.object({
  materials: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.string(),
      title: z.string(),
      char_count: z.number(),
      canvas_id: z.string().uuid().nullable(),
      summary: z.string(),
      key_points: z.array(z.string()),
      concepts: z.array(z.string()),
      /** how many answers on this canvas cite / are grounded in this material */
      cited_by: z.number(),
      created_at: z.number(),
    }),
  ),
  answers: z.array(CanvasSourceAnswer),
});
export type CanvasSources = z.infer<typeof CanvasSources>;

/* ---------------- Artifacts (roadmap: generated from real canvas nodes) ---------------- */

export const ArtifactKind = z.enum(["study_guide", "research_brief", "timeline", "flashcard_deck"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactContent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("study_guide"), sections: z.array(z.object({ heading: z.string(), body: z.string() })).min(1).max(10) }),
  z.object({
    kind: z.literal("research_brief"),
    summary: z.string(),
    findings: z.array(z.object({ claim: z.string(), support: z.string() })).min(1).max(12),
    open_questions: z.array(z.string()).max(6),
  }),
  z.object({ kind: z.literal("timeline"), entries: z.array(z.object({ when: z.string(), what: z.string() })).min(1).max(16) }),
  z.object({
    kind: z.literal("flashcard_deck"),
    cards: z
      .array(z.object({ concept: z.string(), explanation: z.string(), example: z.string() }))
      .min(1)
      .max(20),
  }),
]);
export type ArtifactContent = z.infer<typeof ArtifactContent>;

export const Artifact = z.object({
  id: z.string().uuid(),
  canvas_id: z.string().uuid(),
  kind: ArtifactKind,
  title: z.string(),
  content: ArtifactContent,
  /** how many completed nodes it was generated from */
  node_count: z.number(),
  created_at: z.number(),
});
export type Artifact = z.infer<typeof Artifact>;

/* ---------------- Stats (spec §19) — real numbers only ---------------- */

export const LearningStats = z.object({
  concepts_explored: z.number(), // completed nodes
  cards_count: z.number(),
  due_count: z.number(),
  attempts_count: z.number(),
  correct_count: z.number(),
  /** null until at least one graded attempt exists — never fabricate a percentage */
  accuracy: z.number().nullable(),
  weak_concepts: z.array(z.object({ concept: z.string(), misses: z.number() })).max(5),
});
export type LearningStats = z.infer<typeof LearningStats>;

/* ---------------- Knowledge graph (research-spec §12) ---------------- */

/**
 * A concept the user has actually explored: derived from REAL completed nodes
 * (title/tags/key terms), never fabricated. Edges come from the canvas hierarchy.
 */
export const ConceptNode = z.object({
  id: z.string(),
  label: z.string().max(80),
  /** how many real nodes back this concept */
  weight: z.number(),
  canvas_id: z.string().uuid(),
  canvas_title: z.string().default(""),
  /** representative node to open when clicked */
  node_id: z.string().uuid(),
});
export type ConceptNode = z.infer<typeof ConceptNode>;

export const ConceptEdge = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["parent", "related"]),
});
export type ConceptEdge = z.infer<typeof ConceptEdge>;

export const KnowledgeGraph = z.object({
  concepts: z.array(ConceptNode),
  edges: z.array(ConceptEdge),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraph>;

/* ---------------- Exam simulation (research-spec §19) ---------------- */

export const ExamQuestion = z.object({
  id: z.string(),
  exercise: Exercise,
  /** which explored topic this question came from */
  topic: z.string().max(80).default(""),
});
export type ExamQuestion = z.infer<typeof ExamQuestion>;

export const ExamResult = z.object({
  strong: z.array(z.string()).max(10),
  needs_review: z.array(z.string()).max(10),
  weak: z.array(z.string()).max(10),
  /** real counts behind the buckets */
  total: z.number(),
  correct: z.number(),
});
export type ExamResult = z.infer<typeof ExamResult>;

/** Body for POST /api/exam/generate. */
export const ExamRequest = z.object({
  count: z.number().int().min(3).max(10).default(5),
  canvas_id: z.string().uuid().optional(),
});
export type ExamRequest = z.infer<typeof ExamRequest>;

/* ---------------- Spaced-review integration (roadmap 6) ---------------- */

/**
 * Per-concept FSRS mastery: the knowledge-graph unit that resurfaces. Weak topics
 * (missed on exams / recall) get pulled forward; strong ones recede. Concept keys
 * are canonicalized lowercase-trimmed so "Transistor" and "transistor" merge.
 */
export const ConceptMastery = z.object({
  concept: z.string(),
  canvas_id: z.string().uuid().nullable().default(null),
  review_state: ReviewState,
  created_at: z.number(),
  updated_at: z.number(),
});
export type ConceptMastery = z.infer<typeof ConceptMastery>;

/** One exam answer piped into concept scheduling (topic = the knowledge-graph label). */
export const ExamAnswer = z.object({
  topic: z.string().min(1).max(80),
  correct: z.boolean(),
  partial: z.boolean().default(false),
});
export type ExamAnswer = z.infer<typeof ExamAnswer>;

/** Body for POST /api/exam/submit. */
export const ExamSubmitRequest = z.object({
  canvas_id: z.string().uuid().nullable().optional(),
  answers: z.array(ExamAnswer).min(1).max(20),
});
export type ExamSubmitRequest = z.infer<typeof ExamSubmitRequest>;

/** Canonical concept key: lowercase, trimmed, internal whitespace collapsed. */
export function conceptKey(concept: string): string {
  return concept.trim().toLowerCase().replace(/\s+/g, " ");
}
