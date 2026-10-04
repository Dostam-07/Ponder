import type { Sqlite } from "./client.js";

/**
 * Initial schema (v1). Matches server/src/db/schema.ts exactly.
 * Idempotent: safe to run on every startup.
 */
export function runMigrations(sqlite: Sqlite): void {
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      parent_id TEXT,
      branch_origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL,
      answer_text TEXT NOT NULL DEFAULT '',
      key_terms TEXT NOT NULL DEFAULT '[]',
      suggested_followups TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      visual_type TEXT,
      visual_status TEXT,
      visual_spec TEXT,
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 420,
      collapsed INTEGER NOT NULL DEFAULT 0,
      saved_to_library INTEGER NOT NULL DEFAULT 0,
      model_used TEXT NOT NULL DEFAULT '',
      web_search_used INTEGER NOT NULL DEFAULT 0,
      context_summary TEXT NOT NULL DEFAULT '',
      review_due_at INTEGER NOT NULL,
      review_interval_days REAL NOT NULL DEFAULT 1,
      review_ease REAL NOT NULL DEFAULT 2.5,
      review_stability REAL NOT NULL DEFAULT 0,
      review_difficulty REAL NOT NULL DEFAULT 0,
      review_last_reviewed_at INTEGER,
      review_times_reviewed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_canvas ON nodes(canvas_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_due ON nodes(review_due_at);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      visual_type TEXT,
      visual_spec TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      saved_at INTEGER NOT NULL
    );
  `);

  // ---- v2: learning layer (paths, exercises, cards, materials, links, node extras) ----
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS learning_paths (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      source_id TEXT,
      title TEXT NOT NULL,
      goal TEXT NOT NULL DEFAULT '',
      sections TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS practice_attempts (
      id TEXT PRIMARY KEY,
      node_id TEXT,
      canvas_id TEXT,
      exercise TEXT NOT NULL,
      response TEXT,
      correct INTEGER,
      graded TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_concept ON practice_attempts(graded);

    CREATE TABLE IF NOT EXISTS knowledge_cards (
      id TEXT PRIMARY KEY,
      node_id TEXT,
      canvas_id TEXT,
      concept TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      example TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      due_at INTEGER NOT NULL,
      times_reviewed INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_due ON knowledge_cards(due_at);

    CREATE TABLE IF NOT EXISTS source_materials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      char_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS concept_links (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);

  // additive column migrations (skip when already present)
  const TABLES = new Set(["canvases", "nodes", "app_state", "library_items", "learning_paths", "practice_attempts", "knowledge_cards", "source_materials", "concept_links", "thinking_maps"]);
  const cols = (table: string): string[] =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const addCol = (table: string, ddl: string) => {
    if (!TABLES.has(table)) throw new Error(`addCol: unknown table ${table}`);
    const name = ddl.split(" ")[0]!;
    if (!cols(table).includes(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  };
  addCol("nodes", "material_id TEXT");
  addCol("nodes", "sections TEXT NOT NULL DEFAULT '[]'");
  addCol("nodes", "note TEXT NOT NULL DEFAULT ''");
  addCol("nodes", "important INTEGER NOT NULL DEFAULT 0");
  addCol("nodes", "visual_error TEXT");

  // ---- v3: thinking layer (modes, sources, gaps, thinking maps) ----
  addCol("nodes", "mode TEXT NOT NULL DEFAULT ''");
  addCol("nodes", "sources TEXT NOT NULL DEFAULT '[]'");
  addCol("nodes", "gaps TEXT NOT NULL DEFAULT '[]'");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS thinking_maps (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      topic TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      branches TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maps_canvas ON thinking_maps(canvas_id);
  `);

  // ---- v4: research workspace — claim provenance + source metadata (roadmap: sources) ----
  addCol("nodes", "provenance TEXT");
  addCol("source_materials", "canvas_id TEXT");
  addCol("source_materials", "summary TEXT NOT NULL DEFAULT ''");
  addCol("source_materials", "key_points TEXT NOT NULL DEFAULT '[]'");
  addCol("source_materials", "concepts TEXT NOT NULL DEFAULT '[]'");

  // ---- v5: artifacts generated from real canvas nodes (roadmap: artifacts) ----
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      node_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_canvas ON artifacts(canvas_id);
  `);

  // ---- v6: per-concept FSRS mastery so weak topics resurface (roadmap: spaced review) ----
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS concept_mastery (
      concept TEXT PRIMARY KEY,
      review_state TEXT NOT NULL DEFAULT '{}',
      due_at INTEGER NOT NULL,
      times_reviewed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concept_due ON concept_mastery(due_at);
  `);
}
