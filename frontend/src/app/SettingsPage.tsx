import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { usePrefs } from "../hooks/usePrefs";
import { useSpeechStore } from "../hooks/useSpeech";
import { PONDER_ICONS, SunIcon, MoonIcon, CheckIcon } from "../components/ui/Icons";

interface Health {
  ok: boolean;
  ollama_reachable: boolean;
  local_models: string[];
  fast_model: string;
  quality_model: string;
  openrouter_keyed: boolean;
  prefer_openrouter: boolean;
  openrouter_free_models: string[];
}

export function SettingsPage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000 });
  const { theme, setTheme, icon, setIcon, audio, setAudio } = usePrefs();
  const speech = useSpeechStore();

  const h = health.data as Health | undefined;
  const queryClient = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings-models"], queryFn: api.settingsModels, refetchInterval: 15_000 });
  const backupsQ = useQuery({ queryKey: ["backups"], queryFn: api.listBackups, staleTime: 30_000 });
  const m = settingsQ.data;
  const [modelError, setModelError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function saveModel(role: "fast" | "quality", value: string) {
    setModelError(null);
    try {
      await api.saveSettingsModels(role === "fast" ? { fast: value || null } : { quality: value || null });
      void settingsQ.refetch();
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Saving the model selection failed");
    }
  }

  async function doBackup() {
    setBusy(true);
    setBackupMsg(null);
    try {
      const b = await api.createBackup();
      setBackupMsg({ kind: "ok", text: `Saved ${b.name}` });
      void backupsQ.refetch();
    } catch (err) {
      setBackupMsg({ kind: "err", text: err instanceof Error ? err.message : "Backup failed" });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(name: string) {
    const ok = window.confirm(
      `Restore backup "${name}"?\n\nThis replaces the current data with the backup's contents. A safety backup of the current state is taken first, so nothing is lost.`,
    );
    if (!ok) return;
    setBusy(true);
    setBackupMsg(null);
    try {
      const r = await api.restoreBackup(name);
      setBackupMsg({ kind: "ok", text: `Restored ${r.canvases} canvases / ${r.nodes} nodes (safety backup: ${r.safety_backup})` });
      // The database was swapped server-side: resync everything the app has cached.
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch (err) {
      setBackupMsg({ kind: "err", text: err instanceof Error ? err.message : "Restore failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full w-full min-w-0 overflow-y-auto px-8 py-6">
      <h1 className="text-lg font-medium text-fog-100 mb-1">Settings</h1>
      <p className="text-fog-400 text-sm mb-6">Appearance, backend status, and data. Model choices can be overridden via the `.env` file (see `.env.example`).</p>

      <section className="node-card p-4 mb-4">
        <h2 className="text-sm font-medium text-fog-100 mb-2">Appearance</h2>
        <div className="flex items-center justify-between py-1.5 border-b border-ink-700/60">
          <span className="text-xs text-fog-400">Theme</span>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Theme">
            {(["light", "dark"] as const).map((t) => {
              const selected = theme === t;
              const Ic = t === "light" ? SunIcon : MoonIcon;
              return (
                <button
                  key={t}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(t)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors ${
                    selected ? "bg-spark-500/20 text-spark-400" : "text-fog-300 hover:bg-ink-700 hover:text-fog-100"
                  }`}
                >
                  <Ic className="w-3.5 h-3.5" aria-hidden="true" />
                  {t}
                  {selected && <CheckIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs text-fog-400">Ponder icon</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Ponder icon">
            {PONDER_ICONS.map(({ id, label, Icon }) => {
              const selected = id === icon;
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={selected}
                  title={label}
                  aria-label={label}
                  onClick={() => setIcon(id)}
                  className={`rounded-lg p-2 transition-colors ${
                    selected ? "bg-spark-500/20 text-spark-400 border border-spark-500" : "text-fog-300 hover:bg-ink-700 hover:text-fog-100 border border-transparent"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-fog-400 text-xs">Saved on this device and applied everywhere instantly.</p>
      </section>

      <section className="node-card p-4 mb-4">
        <h2 className="text-sm font-medium text-fog-100 mb-2">Voice</h2>
        <div className="flex items-center justify-between py-1.5 border-b border-ink-700/60">
          <span className="text-xs text-fog-400">Voice responses (Listen controls)</span>
          <button
            role="switch"
            aria-checked={audio.voiceResponses}
            onClick={() => setAudio({ voiceResponses: !audio.voiceResponses })}
            className={`relative w-9 h-5 rounded-full transition-colors ${audio.voiceResponses ? "bg-spark-500" : "bg-ink-600"}`}
            aria-label="Voice responses"
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                audio.voiceResponses ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-ink-700/60">
          <span className="text-xs text-fog-400">Auto-play responses (reads each answer aloud)</span>
          <button
            role="switch"
            aria-checked={audio.autoPlay}
            onClick={() => setAudio({ autoPlay: !audio.autoPlay })}
            className={`relative w-9 h-5 rounded-full transition-colors ${audio.autoPlay ? "bg-spark-500" : "bg-ink-600"}`}
            aria-label="Auto-play responses"
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                audio.autoPlay ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fog-400">Volume</span>
            <span className="text-xs text-fog-400">{Math.round(audio.volume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audio.volume}
            onChange={(e) => setAudio({ volume: Number(e.target.value) })}
            className="w-full mt-1 accent-[rgb(var(--c-spark-400))]"
            aria-label={`Voice volume: ${Math.round(audio.volume * 100)} percent`}
          />
        </div>
        {!speech.supported && <p className="text-[11px] text-amber-500">This browser doesn't support speech synthesis.</p>}
      </section>

      <section className="node-card p-4 mb-4">
        <h2 className="text-sm font-medium text-fog-100 mb-2">Backend</h2>
        <Row label="Server" value={h?.ok ? "Connected" : health.isError ? "Unreachable" : "Checking…"} ok={h?.ok} />
        <Row label="Ollama" value={h?.ollama_reachable ? "Running" : "Not reachable (start with `ollama serve`)"} ok={h?.ollama_reachable} />
        <Row
          label="OpenRouter key"
          value={h?.openrouter_keyed ? `Configured — ${h.openrouter_free_models.length} free models available` : "Not configured (local models only)"}
          ok={h?.openrouter_keyed}
        />
        <Row
          label="Free-model first"
          value={h?.prefer_openrouter ? "On — OpenRouter free tier first, Ollama fallback" : "Off — Ollama only"}
        />
      </section>

      <section className="node-card p-4 mb-4">
        <h2 className="text-sm font-medium text-fog-100 mb-2">Models</h2>
        {(["fast", "quality"] as const).map((role) => {
          const cfg = m?.[role];
          return (
            <div key={role} className="py-1.5 border-b border-ink-700/60">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fog-400">
                  {role === "fast" ? "Fast model (stages 1/2, quick calls)" : "Quality model (stage 3, full answers)"}
                </span>
                <select
                  className="max-w-[230px] rounded-lg border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-fog-100"
                  value={cfg?.saved ?? ""}
                  onChange={(e) => void saveModel(role, e.target.value)}
                  disabled={!h?.ollama_reachable}
                  aria-label={`Preferred ${role} model`}
                >
                  <option value="">Default ({cfg?.fallback ?? "…"})</option>
                  {(h?.local_models ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              {cfg && (
                <div className="mt-1 text-[11px] text-fog-500">
                  In use: <span className="text-fog-200">{cfg.effective}</span> ·{" "}
                  {cfg.source === "env" ? "environment variable" : cfg.source === "saved" ? "saved in Settings" : "default"}
                  {cfg.source === "env" && cfg.env && (
                    <div className="mt-0.5 text-amber-500">
                      {role === "fast" ? "CANVAS_FAST_MODEL" : "CANVAS_QUALITY_MODEL"} = "{cfg.env}" is overriding your
                      saved selection (set in the .env file).
                    </div>
                  )}
                  {cfg.savedIgnored && cfg.savedIgnoreReason === "not_installed" && (
                    <div className="mt-0.5 text-amber-500">
                      Saved model "{cfg.saved}" is not installed in Ollama — the default is used instead.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {modelError && <p className="mt-2 text-[11px] text-red-400">{modelError}</p>}
        {!h?.ollama_reachable && (
          <p className="mt-2 text-[11px] text-amber-500">Ollama is not reachable — the model list fills in once it is running.</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-fog-400">
            Choices come from live Ollama discovery and persist on this device. OpenRouter free models are still tried first
            when a key is configured.
          </p>
          <button
            onClick={() => {
              void health.refetch();
              void settingsQ.refetch();
            }}
            className="shrink-0 ml-3 text-xs text-spark-400 hover:text-spark-300"
          >
            Refresh
          </button>
        </div>
      </section>

      {h && h.openrouter_free_models.length > 0 && (
        <section className="node-card p-4 mb-4">
          <h2 className="text-sm font-medium text-fog-100 mb-2">OpenRouter free models ({h.openrouter_free_models.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {h.openrouter_free_models.map((m) => (
              <span key={m} className="text-xs bg-ink-700 text-fog-300 rounded-full px-2 py-0.5">
                {m.replace(":free", "")}
              </span>
            ))}
          </div>
          <p className="text-fog-400 text-xs mt-2">Discovered live from the OpenRouter catalog; refreshed every 10 minutes.</p>
        </section>
      )}

      <section className="node-card p-4 mb-4">
        <h2 className="text-sm font-medium text-fog-100 mb-2">Available local models ({h?.local_models.length ?? 0})</h2>
        <div className="flex flex-wrap gap-1.5">
          {h?.local_models.map((m) => (
            <span key={m} className="text-xs bg-ink-700 text-fog-300 rounded-full px-2 py-0.5">
              {m}
            </span>
          ))}
          {h && h.local_models.length === 0 && <p className="text-fog-400 text-xs">None detected.</p>}
        </div>
      </section>

      <section className="node-card p-4">
        <h2 className="text-sm font-medium text-fog-100 mb-2">Data & Backup</h2>
        <p className="text-xs text-fog-400 mb-3">
          Everything lives in a local SQLite file (<code>server/data/app.db</code>). Backups are consistent snapshots saved to{" "}
          <code>server/backups/</code> on this machine — no cloud involved.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={() => void doBackup()} disabled={busy} className="btn-primary">
            {busy ? "Working…" : "Back up now"}
          </button>
          {backupMsg && (
            <span className={`text-xs ${backupMsg.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{backupMsg.text}</span>
          )}
        </div>
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-medium text-fog-200">Backup history</h3>
          {backupsQ.data && backupsQ.data.backups.length === 0 && <p className="text-[11px] text-fog-500">No backups yet.</p>}
          <ul className="mt-1 space-y-1">
            {backupsQ.data?.backups.map((b) => (
              <li key={b.name} className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/60 px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-xs text-fog-200">{b.name}</div>
                  <div className="text-[11px] text-fog-500">
                    {new Date(b.created_at).toLocaleString()} · {(b.size_bytes / 1024).toFixed(0)} KB · {b.canvases} canvases ·{" "}
                    {b.nodes} nodes{b.integrity === "ok" ? " · verified" : ""}
                  </div>
                </div>
                <button
                  onClick={() => void doRestore(b.name)}
                  disabled={busy}
                  className="shrink-0 text-xs text-spark-400 hover:text-spark-300 disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3">
          <a href={api.exportUrl} className="btn-primary inline-block" download>
            Export all data as JSON
          </a>
          <p className="text-fog-400 text-xs mt-2">
            Restoring replaces the current database — a safety backup of the current state is always taken first.
          </p>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ink-700/60 last:border-0">
      <span className="text-xs text-fog-400">{label}</span>
      <span className={`text-xs ${ok === undefined ? "text-fog-200" : ok ? "text-emerald-400" : "text-fog-200"}`}>{value}</span>
    </div>
  );
}
