# Ponder — Run Doc

Monorepo: npm workspaces (`packages/shared`, `server`, `frontend`). Server = Express + better-sqlite3 on `127.0.0.1:8787`. Frontend = Vite (React + React Flow) — auto-increments to 5174/5175… if 5173 is busy. All data local (SQLite + Ollama); no accounts.

**Data location:** the SQLite DB is always `server/data/app.db` (relative `DB_PATH` resolves against the `server/` package root, not the cwd). Gitignored.

## How to reproduce the artifacts (fresh checkout)

1. Install dependencies (workspaces install together):
   ```
   npm install
   ```
   (No env file is required — `server/src/index.ts` falls back to defaults. Optional: copy `.env.example` to `.env` for an OpenRouter key or model overrides. Never commit `.env`.)

2. No build or migration step is needed: `server/src/db/migrate.ts` runs idempotently on server startup and creates `server/data/app.db`.

## How to run the servers

- Full stack (both processes, colored logs):
  ```
  npm run dev
  ```
- API only: `npm run dev:server` · Frontend only: `npm run dev:frontend`

- Ports: API fixed on 8787; Vite picks 5173 if free, else auto-increments (5174, …). The frontend proxies `/api/*` to `127.0.0.1:8787`, so any Vite port works.

- Requirements: Node >= 22 and Ollama running (`ollama serve`) with the models listed by `GET /api/health` (defaults: `qwen2.5:7b` fast, `qwen2.5:14b-instruct-q4_K_M` quality — override via `CANVAS_FAST_MODEL` / `CANVAS_QUALITY_MODEL` in `.env`).

- Verify: `curl http://127.0.0.1:8787/api/health` → `{"ok":true,"ollama_reachable":true,...}` then open the Vite URL.

- Tests: `npm test` (vitest, 37 tests across both workspaces). Typecheck: `npm run typecheck`.
