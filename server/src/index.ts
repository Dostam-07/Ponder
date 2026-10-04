import { createApp } from "./app.js";
import fs from "node:fs";

const RAW_PORT = Number(process.env.PORT);
const PORT = Number.isInteger(RAW_PORT) && RAW_PORT > 0 ? RAW_PORT : 8787;
const DB_PATH = process.env.DB_PATH ?? "./data/app.db";

// Minimal .env loader (no dotenv dependency): KEY=VALUE lines
try {
  const envFile = fs.readFileSync(new URL("../../.env", import.meta.url), "utf8");
  for (const line of envFile.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
} catch {
  // no .env — fine, everything has defaults
}

const { app } = createApp(DB_PATH);

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Ponder server listening on http://127.0.0.1:${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} on 127.0.0.1 is already in use.\n` +
        "Another process (often an old dev server from a previous run) is holding it.\n\n" +
        "Find and stop it:\n" +
        `  Windows (PowerShell):  Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n` +
        `  macOS / Linux:         lsof -ti:${PORT} | xargs kill -9\n` +
        `Or run on a different port:  set PORT=${PORT + 1} && npm run dev -w server\n`,
    );
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown: on Windows, Ctrl+C in `tsx watch` can orphan the child
// node process and leave the port held. Closing explicitly avoids that.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down...`);
    server.close(() => process.exit(0));
    // Force-exit if open connections keep the server alive.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
