import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Open (or create) a SQLite handle with the app's standard pragmas. */
export function openSqlite(resolved: string) {
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

/**
 * The database context. `db` is a STABLE proxy: repositories capture it once
 * and keep using it forever. When the live file is swapped (backup restore),
 * `swap()` closes the old connection, reopens the file and rebinds the proxy —
 * every repository then transparently talks to the new connection without any
 * wiring changes.
 */
export function createDb(dbPath: string) {
  // Relative paths resolve against the package root (server/), not src/ — so the DB
  // location is stable no matter which working directory or loader starts the server.
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.resolve(__dirname, "../..", dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  let sqlite = openSqlite(resolved);
  let db = drizzle(sqlite, { schema });
  const proxy = new Proxy({} as object, {
    get: (_t, prop) => (db as unknown as Record<PropertyKey, unknown>)[prop],
  });
  return {
    /** Stable reference — safe to hold for the process lifetime. */
    db: proxy as ReturnType<typeof drizzle<typeof schema>>,
    /** The CURRENT raw handle (changes after swap()). */
    get sqlite() {
      return sqlite;
    },
    /** Absolute path of the database file. */
    path: resolved,
    /**
     * Rebind to the file at `path` (backup restore): close the old connection
     * (its WAL checkpoints on close), open the new file, rebuild the drizzle
     * wrapper. Callers must ensure no writes are in flight.
     */
    swap() {
      sqlite.close();
      sqlite = openSqlite(resolved);
      db = drizzle(sqlite, { schema });
    },
    close: () => sqlite.close(),
  };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Sqlite = ReturnType<typeof openSqlite>;
