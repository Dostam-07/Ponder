import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Sqlite } from "./db/client.js";

/**
 * Local backup & restore for the single app.db (roadmap: "Local backup and restore").
 *
 * Reliability contract:
 *  - BACKUP: SQLite's online backup protocol (`Database.backup`) — a consistent
 *    snapshot even while the live DB is in WAL mode and being written. Never a
 *    blind file copy of a live database.
 *  - LIST:   metadata (timestamp, size, canvas/node counts, integrity) is gathered
 *    from the NEW backup file itself and stored in a .meta.json sidecar.
 *  - RESTORE: the backup is validated first (integrity_check + required tables),
 *    a safety backup of the current DB is always taken first, the live connection
 *    is closed, the file is swapped only after the copy re-validates, and the
 *    server reopens the new file (via the DbContext proxy — see db/client.ts).
 *  - All paths are local.
 */
export interface BackupInfo {
  name: string;
  created_at: number;
  size_bytes: number;
  canvases: number;
  nodes: number;
  integrity: "ok" | "unchecked";
  label: string | null;
}

const REQUIRED_TABLES = ["canvases", "nodes"];

export interface BackupManager {
  dir: string;
  list(): BackupInfo[];
  /** Async: better-sqlite3's backup API is async by default — the snapshot must be complete before we probe it. */
  create(label?: string | null): Promise<BackupInfo>;
  /** null = valid; string = human-readable validation error. */
  validate(name: string): string | null;
  /** Validate + take the pre-restore safety backup. Throws with a reason if invalid. */
  prepareRestore(name: string): Promise<{ safetyName: string; backupFile: string }>;
  /** Swap the live DB file with the (already validated) backup. Live connection must be closed first. */
  performSwap(backupFile: string): void;
  /** Optional scheduled local snapshots. Returns a stop function; timer is unref'd. */
  startScheduled(everyHours: number): () => void;
}

export function createBackupManager(liveSqlite: () => Sqlite, backupsDir: string, dbFile: string): BackupManager {
  fs.mkdirSync(backupsDir, { recursive: true });

  const sidecar = (name: string): string => path.join(backupsDir, name.replace(/\.db$/, ".meta.json"));

  function readMeta(name: string): Partial<BackupInfo> | null {
    try {
      return JSON.parse(fs.readFileSync(sidecar(name), "utf8")) as Partial<BackupInfo>;
    } catch {
      return null;
    }
  }

  /** Open a backup read-only for probing; closes itself. */
  function probe(file: string, fn: (probe: InstanceType<typeof Database>) => void): void {
    const p = new Database(file, { readonly: true });
    try {
      fn(p);
    } finally {
      p.close();
    }
  }

  function integrityOf(file: string): "ok" | "unchecked" {
    let result: "ok" | "unchecked" = "unchecked";
    try {
      probe(file, (p) => {
        result = (p.pragma("integrity_check", { simple: true }) as string) === "ok" ? "ok" : "unchecked";
      });
    } catch {
      result = "unchecked";
    }
    return result;
  }

  function list(): BackupInfo[] {
    return fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith(".db"))
      .map((name) => {
        const meta = readMeta(name) ?? {};
        const st = fs.statSync(path.join(backupsDir, name));
        return {
          name,
          created_at: meta.created_at ?? st.mtimeMs,
          size_bytes: meta.size_bytes ?? st.size,
          canvases: meta.canvases ?? 0,
          nodes: meta.nodes ?? 0,
          integrity: (meta.integrity === "ok" ? "ok" : "unchecked") as "ok" | "unchecked",
          label: meta.label ?? null,
        };
      })
      .sort((a, b) => b.created_at - a.created_at || b.name.localeCompare(a.name));
  }

  /** Consistent snapshot via the online backup protocol (safe under WAL + live writes). */
  async function create(label: string | null = null): Promise<BackupInfo> {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const safe = (label ?? "").replace(/[^\w\- ]+/g, "").trim().slice(0, 40);
    let name = safe ? `ponder-${ts}-${safe}.db` : `ponder-${ts}.db`;
    if (fs.existsSync(path.join(backupsDir, name))) name = `ponder-${ts}-${Date.now()}${safe ? `-${safe}` : ""}.db`;
    const dest = path.join(backupsDir, name);

    // The LIVE handle performs the backup — a consistent snapshot even under
    // WAL + concurrent writes. better-sqlite3's backup() is ASYNC by default;
    // we must await it before probing the destination file.
    await liveSqlite().backup(dest);

    const created_at = Date.now();
    const integrity = integrityOf(dest);
    let canvases = 0;
    let nodes = 0;
    if (integrity === "ok") {
      probe(dest, (p) => {
        canvases = (p.prepare("SELECT COUNT(*) AS n FROM canvases").get() as { n: number }).n;
        nodes = (p.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n;
      });
    }
    const size_bytes = fs.statSync(dest).size;
    fs.writeFileSync(sidecar(name), JSON.stringify({ created_at, size_bytes, canvases, nodes, integrity, label }, null, 2));
    return { name, created_at, size_bytes, canvases, nodes, integrity, label };
  }

  function validate(name: string): string | null {
    if (!name.endsWith(".db") || path.dirname(path.join(backupsDir, name)) !== path.resolve(backupsDir)) {
      return "Invalid backup name";
    }
    const file = path.join(backupsDir, name);
    if (!fs.existsSync(file)) return "Backup file not found";
    let err: string | null = null;
    try {
      probe(file, (p) => {
        const r = p.pragma("integrity_check", { simple: true }) as string;
        if (r !== "ok") {
          err = `Backup failed the integrity check (${r})`;
          return;
        }
        const tables = new Set(
          (p.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
        );
        const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
        if (missing.length > 0) err = `Backup is missing required tables: ${missing.join(", ")}`;
      });
    } catch (e) {
      err = `Backup could not be opened: ${e instanceof Error ? e.message : String(e)}`;
    }
    return err;
  }

  async function prepareRestore(name: string): Promise<{ safetyName: string; backupFile: string }> {
    const err = validate(name);
    if (err) throw new Error(err);
    // A safety snapshot of the CURRENT database — restore is never a one-way door.
    const safety = await create(`safety-before-restore-${name.replace(/\.db$/, "")}`.slice(0, 60));
    return { safetyName: safety.name, backupFile: path.join(backupsDir, name) };
  }

  /**
   * File swap after the live connection has been closed:
   * copy to a temp file, RE-VALIDATE the copy, then delete the old file
   * (safe — nothing holds it open) and atomically rename the copy into place.
   */
  function performSwap(backupFile: string): void {
    const tmp = `${dbFile}.restore-tmp`;
    fs.copyFileSync(backupFile, tmp);
    const copyErr = validateNameless(tmp);
    if (copyErr) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`Restore aborted — the staged copy is invalid (${copyErr}); the current database is untouched`);
    }
    for (const f of [`${dbFile}-wal`, `${dbFile}-shm`, dbFile]) {
      if (fs.existsSync(f)) fs.rmSync(f);
    }
    fs.renameSync(tmp, dbFile);
  }

  /** Integrity + required tables for an arbitrary file (performSwap cannot use validate()'s name check). */
  function validateNameless(file: string): string | null {
    try {
      let err: string | null = null;
      probe(file, (p) => {
        const r = p.pragma("integrity_check", { simple: true }) as string;
        if (r !== "ok") {
          err = `integrity check: ${r}`;
          return;
        }
        const tables = new Set(
          (p.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
        );
        const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
        if (missing.length > 0) err = `missing tables: ${missing.join(", ")}`;
      });
      return err;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  function startScheduled(everyHours: number): () => void {
    const iv = setInterval(() => {
      void (async () => {
        try {
          const last = list()[0];
          if (!last || Date.now() - last.created_at >= everyHours * 3_600_000) await create("scheduled");
        } catch {
          // A failed snapshot is logged; scheduled work must never crash the server.
          console.error("[backup] scheduled snapshot failed", new Error().stack);
        }
      })();
    }, 3_600_000);
    iv.unref();
    return () => clearInterval(iv);
  }

  return { dir: backupsDir, list, create, validate, prepareRestore, performSwap, startScheduled };
}
