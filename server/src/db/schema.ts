import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  canvas_id: text("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  parent_id: text("parent_id"),
  branch_origin: text("branch_origin").notNull(),
  status: text("status").notNull().default("pending"),
  title: text("title").notNull().default(""),
  question: text("question").notNull(),
  answer_text: text("answer_text").notNull().default(""),
  key_terms: text("key_terms").notNull().default("[]"), // JSON array
  suggested_followups: text("suggested_followups").notNull().default("[]"), // JSON array
  tags: text("tags").notNull().default("[]"), // JSON array
  visual_type: text("visual_type"), // VisualType | null
  visual_status: text("visual_status"), // VisualStatus | null
  visual_spec: text("visual_spec"), // JSON | null
  visual_error: text("visual_error"), // JSON: safe failure message/code | null
  position_x: real("position_x").notNull().default(0),
  position_y: real("position_y").notNull().default(0),
  width: real("width").notNull().default(420),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
  saved_to_library: integer("saved_to_library", { mode: "boolean" }).notNull().default(false),
  model_used: text("model_used").notNull().default(""),
  web_search_used: integer("web_search_used", { mode: "boolean" }).notNull().default(false),
  context_summary: text("context_summary").notNull().default(""),
  mode: text("mode").notNull().default(""), // ThinkingMode | ""
  sources: text("sources").notNull().default("[]"), // JSON: SourceRef[]
  provenance: text("provenance"), // JSON: Provenance | null
  gaps: text("gaps").notNull().default("[]"), // JSON: KnowledgeGap[]
  material_id: text("material_id"),
  sections: text("sections").notNull().default("[]"), // JSON: [{heading, body}]
  note: text("note").notNull().default(""),
  important: integer("important", { mode: "boolean" }).notNull().default(false),
  review_due_at: integer("review_due_at").notNull(),
  review_interval_days: real("review_interval_days").notNull().default(1),
  review_ease: real("review_ease").notNull().default(2.5),
  review_stability: real("review_stability").notNull().default(0),
  review_difficulty: real("review_difficulty").notNull().default(0),
  review_last_reviewed_at: integer("review_last_reviewed_at"),
  review_times_reviewed: integer("review_times_reviewed").notNull().default(0),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const libraryItems = sqliteTable("library_items", {
  id: text("id").primaryKey(),
  canvas_id: text("canvas_id").notNull(),
  node_id: text("node_id").notNull(),
  title: text("title").notNull(),
  question: text("question").notNull(),
  answer_text: text("answer_text").notNull(),
  visual_type: text("visual_type"),
  visual_spec: text("visual_spec"),
  tags: text("tags").notNull().default("[]"),
  saved_at: integer("saved_at").notNull(),
});

export const learningPaths = sqliteTable("learning_paths", {
  id: text("id").primaryKey(),
  canvas_id: text("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  source_id: text("source_id"),
  title: text("title").notNull(),
  goal: text("goal").notNull().default(""),
  sections: text("sections").notNull().default("[]"), // JSON: PathSection[]
  created_at: integer("created_at").notNull(),
});

export const practiceAttempts = sqliteTable("practice_attempts", {
  id: text("id").primaryKey(),
  node_id: text("node_id"),
  canvas_id: text("canvas_id"),
  exercise: text("exercise").notNull(), // JSON Exercise
  response: text("response"), // JSON-encoded response
  correct: integer("correct"), // null = ungraded/skipped
  graded: text("graded"), // JSON GradeResult
  created_at: integer("created_at").notNull(),
});

export const knowledgeCards = sqliteTable("knowledge_cards", {
  id: text("id").primaryKey(),
  node_id: text("node_id"),
  canvas_id: text("canvas_id"),
  concept: text("concept").notNull(),
  explanation: text("explanation").notNull().default(""),
  example: text("example").notNull().default(""),
  source: text("source").notNull().default(""),
  notes: text("notes").notNull().default(""),
  due_at: integer("due_at").notNull(),
  times_reviewed: integer("times_reviewed").notNull().default(0),
  last_reviewed_at: integer("last_reviewed_at"),
  created_at: integer("created_at").notNull(),
});

export const sourceMaterials = sqliteTable("source_materials", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  char_count: integer("char_count").notNull().default(0),
  canvas_id: text("canvas_id"), // attached canvas (null = global)
  summary: text("summary").notNull().default(""),
  key_points: text("key_points").notNull().default("[]"), // JSON: string[]
  concepts: text("concepts").notNull().default("[]"), // JSON: string[]
  created_at: integer("created_at").notNull(),
});

export const conceptLinks = sqliteTable("concept_links", {
  id: text("id").primaryKey(),
  canvas_id: text("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  source: text("source")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  target: text("target")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  created_at: integer("created_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  canvas_id: text("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default("{}"), // JSON: ArtifactContent
  node_count: integer("node_count").notNull().default(0),
  created_at: integer("created_at").notNull(),
});

export const conceptMastery = sqliteTable("concept_mastery", {
  concept: text("concept").notNull().primaryKey(), // canonicalized lowercase concept key
  review_state: text("review_state").notNull().default("{}"), // JSON: ReviewState (full FSRS)
  due_at: integer("due_at").notNull(), // denormalized for the due(now) query
  times_reviewed: integer("times_reviewed").notNull().default(0),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const thinkingMaps = sqliteTable("thinking_maps", {
  id: text("id").primaryKey(),
  canvas_id: text("canvas_id")
    .notNull()
    .references(() => canvases.id, { onDelete: "cascade" }),
  topic: text("topic").notNull().default(""),
  title: text("title").notNull(),
  rationale: text("rationale").notNull().default(""),
  branches: text("branches").notNull().default("[]"), // JSON: MapBranch[]
  created_at: integer("created_at").notNull(),
});
