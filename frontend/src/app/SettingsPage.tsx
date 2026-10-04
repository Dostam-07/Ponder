import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateOpenRouterPreferences } from "@canvas-learn/shared";
import { api } from "../lib/api";
import { usePrefs } from "../hooks/usePrefs";
import { useSpeechStore } from "../hooks/useSpeech";
import {
  PONDER_ICONS, SunIcon, MoonIcon, CheckIcon, GlobeIcon, ImageIcon,
  GearIcon, SpeakerIcon, SaveIcon, RefreshIcon, EyeIcon, KeyIcon,
} from "../components/ui/Icons";

const SECTIONS = [
  { id: "connections", label: "AI & connections", Icon: GlobeIcon },
  { id: "appearance", label: "Appearance", Icon: SunIcon },
  { id: "voice", label: "Voice & audio", Icon: SpeakerIcon },
  { id: "data", label: "Data & backups", Icon: SaveIcon },
] as const;
type Section = typeof SECTIONS[number]["id"];
type Message = { kind: "ok" | "err"; text: string } | null;

export function SettingsPage() {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  const models = useQuery({ queryKey: ["settings-models"], queryFn: api.settingsModels });
  const connection = useQuery({ queryKey: ["settings-openrouter"], queryFn: api.settingsOpenRouter });
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.listBackups, staleTime: 30_000 });
  const { theme, setTheme, icon, setIcon, audio, setAudio } = usePrefs();
  const speech = useSpeechStore();

  const [section, setSection] = useState<Section>("connections");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [imageModel, setImageModel] = useState<string | null>(null);
  const [preferRemote, setPreferRemote] = useState<boolean | null>(null);
  const [connectionBusy, setConnectionBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<Message>(null);
  const [modelBusy, setModelBusy] = useState<string | null>(null);
  const [modelMessage, setModelMessage] = useState<Message>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState<Message>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const cloud = connection.data;
  const local = models.data;
  const h = health.data;

  async function saveConnection(patch: UpdateOpenRouterPreferences, action: "save" | "remove" = "save") {
    setConnectionBusy(action);
    setConnectionMessage(null);
    try {
      const saved = await api.saveSettingsOpenRouter(patch);
      queryClient.setQueryData(["settings-openrouter"], saved);
      setApiKey("");
      setShowKey(false);
      setImageModel(null);
      setPreferRemote(null);
      setConnectionMessage({ kind: "ok", text: saved.configured ? "Connection settings saved. They apply immediately." : "OpenRouter key removed. You can add a new key whenever you like." });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch (err) {
      setConnectionMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not save connection settings" });
    } finally {
      setConnectionBusy(null);
    }
  }

  async function testConnection() {
    setConnectionBusy("test");
    setConnectionMessage(null);
    try {
      const result = await api.testOpenRouter();
      setConnectionMessage({ kind: "ok", text: result.message });
    } catch (err) {
      setConnectionMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not connect to OpenRouter" });
    } finally {
      setConnectionBusy(null);
    }
  }

  async function saveModel(role: "fast" | "quality", value: string) {
    setModelBusy(role);
    setModelMessage(null);
    try {
      const saved = await api.saveSettingsModels({ [role]: value || null });
      queryClient.setQueryData(["settings-models"], saved);
      setModelMessage({ kind: "ok", text: "Model preference saved." });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch (err) {
      setModelMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not save model preference" });
    } finally {
      setModelBusy(null);
    }
  }

  async function refreshConnections() {
    setModelBusy("refresh");
    setModelMessage(null);
    try {
      const refreshed = await api.refreshSettingsModels();
      queryClient.setQueryData(["settings-models"], refreshed);
      await Promise.all([health.refetch(), connection.refetch()]);
    } catch (err) {
      setModelMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not refresh connections" });
    } finally {
      setModelBusy(null);
    }
  }

  async function createBackup() {
    setDataBusy(true);
    setDataMessage(null);
    try {
      const backup = await api.createBackup();
      setDataMessage({ kind: "ok", text: `Backup saved: ${backup.name}` });
      await backups.refetch();
    } catch (err) {
      setDataMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not create backup" });
    } finally {
      setDataBusy(false);
    }
  }

  async function restoreBackup(name: string) {
    if (!window.confirm(`Restore “${name}”?\n\nYour current database will be replaced. Ponder saves a safety backup first.`)) return;
    setDataBusy(true);
    setDataMessage(null);
    try {
      await api.restoreBackup(name);
      await queryClient.invalidateQueries();
      window.location.reload();
    } catch (err) {
      setDataMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not restore backup" });
    } finally {
      setDataBusy(false);
    }
  }

  async function importWorkspace(file: File) {
    setDataBusy(true);
    setDataMessage(null);
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("Choose a Ponder export smaller than 64 MB");
      const result = await api.importData(JSON.parse(await file.text()));
      setDataMessage({ kind: "ok", text: `Imported ${result.canvases_imported} canvases, ${result.nodes_imported} answers, and ${result.cards_imported} cards.` });
      await queryClient.invalidateQueries();
    } catch (err) {
      setDataMessage({ kind: "err", text: err instanceof Error ? err.message : "Could not import workspace" });
    } finally {
      setDataBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  const selectedSection = SECTIONS.find((s) => s.id === section)!;
  const voicePreviewActive = speech.activeId === "settings-preview" && speech.state !== "idle";

  return (
    <div className="workspace-page" data-page="settings">
      <div className="page-container">
        <header className="page-header">
          <div>
            <p className="page-eyebrow">Your workspace, your way</p>
            <h1 className="page-title">Settings</h1>
            <p className="page-description">Connect your AI, find your look, and keep your learning close.</p>
          </div>
          <StatusBadge tone={health.isError ? "warning" : h?.ok ? "success" : "neutral"}>
            {health.isError ? "Server offline" : h?.ok ? "Server connected" : "Checking server…"}
          </StatusBadge>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" role="tablist" aria-label="Settings categories" aria-orientation="horizontal">
            {SECTIONS.map(({ id, label, Icon }, index) => (
              <button
                key={id}
                id={`settings-tab-${id}`}
                role="tab"
                aria-selected={section === id}
                aria-controls={`settings-panel-${id}`}
                tabIndex={section === id ? 0 : -1}
                onClick={() => setSection(id)}
                onKeyDown={(event) => {
                  const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                  if (!offset && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const next = event.key === "Home" ? SECTIONS[0]! : event.key === "End" ? SECTIONS[SECTIONS.length - 1]! : SECTIONS[(index + offset + SECTIONS.length) % SECTIONS.length]!;
                  setSection(next.id);
                  document.getElementById(`settings-tab-${next.id}`)?.focus();
                }}
                className={`settings-nav-item ${section === id ? "is-active" : ""}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
            <p className="hidden xl:block mt-5 px-3 text-xs leading-relaxed text-fog-500">Changes to connections and models apply right away. Appearance and audio stay on this browser.</p>
          </nav>

          <div id={`settings-panel-${section}`} role="tabpanel" aria-labelledby={`settings-tab-${section}`} className="min-w-0 space-y-5">
            <h2 className="sr-only">{selectedSection.label}</h2>
            {section === "connections" && (
              <>
                <SettingsCard title="OpenRouter" description="One connection for free text models and on-demand pictures." icon={<GlobeIcon />} action={<StatusBadge tone={cloud?.configured ? "accent" : "neutral"}>{cloud?.configured ? "Key configured" : "Not configured"}</StatusBadge>} highlighted>
                  {connection.isError && <Notice message={{ kind: "err", text: connection.error.message }} />}
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    void saveConnection({
                      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
                      ...(imageModel !== null ? { image_model: imageModel.trim() || null } : {}),
                      ...(preferRemote !== null ? { prefer_openrouter: preferRemote } : {}),
                    });
                  }} className="space-y-5">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <label className="field-label" htmlFor="openrouter-api-key">OpenRouter API key</label>
                        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-xs font-medium text-spark-400 hover:underline">Get an API key ↗</a>
                      </div>
                      <div className="relative">
                        <KeyIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-500" aria-hidden="true" />
                        <input
                          id="openrouter-api-key"
                          type={showKey ? "text" : "password"}
                          autoComplete="off"
                          maxLength={512}
                          spellCheck={false}
                          value={apiKey}
                          onChange={(event) => { setApiKey(event.target.value); setConnectionMessage(null); }}
                          placeholder={cloud?.configured ? `Saved key ${cloud.key_hint} — paste to replace` : "sk-or-v1-…"}
                          disabled={!!connectionBusy || connection.isPending || connection.isError}
                          aria-describedby="openrouter-key-help"
                          className="input-bar w-full !py-3 !pl-10 !pr-12 font-mono"
                        />
                        <button type="button" className="btn-ghost absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide API key" : "Show API key"} aria-pressed={showKey} title={showKey ? "Hide key" : "Show typed key"}>
                          <EyeIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <p id="openrouter-key-help" className="field-help">Stored in your local database, unencrypted. The saved key is never returned to the browser or included in workspace JSON exports.</p>
                      {cloud?.configured && <p className="mt-1 text-xs text-fog-400">Using a key from <span className="text-fog-200">{cloud.key_source === "env" ? "the environment" : "Settings"}</span>. Leave this field empty to keep it.</p>}
                    </div>

                    <div className="rounded-xl border border-ink-700 bg-ink-800/40 p-4">
                      <label htmlFor="openrouter-image-model" className="field-label flex items-center gap-2"><ImageIcon className="h-4 w-4 text-spark-400" /> Picture model</label>
                      <input id="openrouter-image-model" className="input-bar mt-2 w-full font-mono" value={imageModel ?? cloud?.image_model ?? ""} onChange={(event) => { setImageModel(event.target.value); setConnectionMessage(null); }} disabled={!!connectionBusy || !cloud} placeholder="google/gemini-2.5-flash-image" spellCheck={false} />
                      <p className="field-help">Pictures are generated only when you click <strong className="font-medium text-fog-200">Picture</strong> on an answer. Image models use OpenRouter credits.</p>
                      <a href="https://openrouter.ai/models?output_modalities=image" target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-spark-400 hover:underline">Browse image models ↗</a>
                    </div>

                    <SettingsSwitch label="Prefer free OpenRouter text models" description="Try free cloud models first, then fall back to your local Ollama models." checked={preferRemote ?? cloud?.prefer_openrouter ?? true} disabled={!!connectionBusy || !cloud} onChange={(value) => { setPreferRemote(value); setConnectionMessage(null); }} />

                    <Notice message={connectionMessage} />
                    <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 pt-4">
                      <button className="btn-primary" type="submit" disabled={!!connectionBusy || !cloud}>
                        <SaveIcon className="h-4 w-4" /> {connectionBusy === "save" ? "Saving…" : "Save connection"}
                      </button>
                      <button className="btn-secondary" type="button" onClick={() => void testConnection()} disabled={!!connectionBusy || !cloud?.configured || !!apiKey.trim()} title={apiKey.trim() ? "Save the new key before testing it" : "Checks authentication without generating content"}>
                        {connectionBusy === "test" ? "Testing…" : "Test connection"}
                      </button>
                      {cloud?.configured && <button className="ml-auto text-xs text-fog-400 hover:text-red-400 disabled:opacity-50" type="button" onClick={() => void saveConnection({ api_key: "" }, "remove")} disabled={!!connectionBusy}>Remove key</button>}
                      {cloud?.has_env_key && cloud.key_source === "settings" && <button className="text-xs text-fog-400 hover:text-spark-400" type="button" onClick={() => void saveConnection({ api_key: null })} disabled={!!connectionBusy}>Use environment key</button>}
                    </div>
                  </form>
                </SettingsCard>

                <SettingsCard title="Local models" description="Use models already installed in Ollama for answers and diagrams." icon={<GearIcon />} action={<button className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => void refreshConnections()} disabled={!!modelBusy}><RefreshIcon className={`h-3.5 w-3.5 ${modelBusy === "refresh" ? "animate-spin" : ""}`} /> Refresh</button>}>
                  {models.isError && <Notice message={{ kind: "err", text: models.error.message }} />}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(["fast", "quality"] as const).map((role) => {
                      const cfg = local?.[role];
                      return (
                        <div key={role} className="rounded-xl border border-ink-700 bg-ink-800/30 p-4">
                          <label className="field-label" htmlFor={`model-${role}`}>{role === "fast" ? "Fast model" : "Quality model"}</label>
                          <p className="mt-1 mb-3 text-xs text-fog-400">{role === "fast" ? "Quick answers and teaching enhancements." : "Deeper explanations and on-demand diagrams."}</p>
                          <select id={`model-${role}`} className="input-bar w-full" value={cfg?.saved ?? ""} onChange={(event) => void saveModel(role, event.target.value)} disabled={!!modelBusy || !local?.ollamaReachable || !(local.installed.length > 0)}>
                            <option value="">Default ({cfg?.fallback ?? "loading…"})</option>
                            {cfg?.saved && !local?.installed.includes(cfg.saved) && <option value={cfg.saved}>{cfg.saved} (unavailable)</option>}
                            {local?.installed.map((name) => <option key={name} value={name}>{name}</option>)}
                          </select>
                          {cfg && <p className="mt-2 break-all text-xs text-fog-400">Effective: <span className="text-fog-200">{cfg.effective}</span><span className="block mt-0.5 text-fog-500">{cfg.source === "env" ? "Set by environment" : cfg.source === "saved" ? "Saved in Settings" : "Default model"}</span></p>}
                          {cfg?.source === "env" && <p className="mt-2 text-xs text-amber-500">{role === "fast" ? "CANVAS_FAST_MODEL" : "CANVAS_QUALITY_MODEL"} overrides this preference.</p>}
                          {cfg?.savedIgnored && cfg.savedIgnoreReason === "not_installed" && <p className="mt-2 text-xs text-amber-500">Your saved model is no longer installed.</p>}
                        </div>
                      );
                    })}
                  </div>
                  <Notice message={modelMessage} />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <StatusBadge tone={h?.ollama_reachable ? "success" : "neutral"}>{h?.ollama_reachable ? "Ollama running" : "Ollama unavailable"}</StatusBadge>
                    <span className="text-xs text-fog-400">{local?.installed.length ?? 0} installed models · {h?.openrouter_free_models?.length ?? 0} free cloud models discovered</span>
                  </div>
                  {!h?.ollama_reachable && <p className="field-help">Start Ollama with <code>ollama serve</code>, install a model, then refresh this list.</p>}
                  {h?.openrouter_quota_limited && <p className="field-help">The free text-model quota is temporarily limited. Local fallback remains available.</p>}
                </SettingsCard>
              </>
            )}

            {section === "appearance" && (
              <>
                <SettingsCard title="Choose your atmosphere" description="A comfortable workspace for bright mornings or late-night curiosity." icon={<SunIcon />}>
                  <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="Theme">
                    {(["light", "dark"] as const).map((choice) => (
                      <button key={choice} role="radio" aria-checked={theme === choice} tabIndex={theme === choice ? 0 : -1} onKeyDown={navigateRadioGroup} onClick={() => setTheme(choice)} className={`theme-choice ${theme === choice ? "is-active" : ""}`}>
                        <div className={`theme-preview ${choice === "light" ? "theme-preview-light" : "theme-preview-dark"}`} aria-hidden="true"><div className="theme-preview-sidebar" /><div className="theme-preview-body"><span /><div /><div /></div></div>
                        <span className="flex items-center gap-2 px-3 py-3 text-sm font-medium">{choice === "light" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />} {choice === "light" ? "Light" : "Dark"}{theme === choice && <CheckIcon className="ml-auto h-4 w-4 text-spark-400" />}</span>
                      </button>
                    ))}
                  </div>
                </SettingsCard>
                <SettingsCard title="Your Ponder mark" description="Choose the little symbol that follows your ideas around the workspace." icon={<GearIcon />}>
                  <div className="grid grid-cols-4 gap-2 sm:gap-3" role="radiogroup" aria-label="Ponder icon">
                    {PONDER_ICONS.map(({ id, label, Icon }) => (
                      <button key={id} role="radio" aria-checked={icon === id} aria-label={label} tabIndex={icon === id ? 0 : -1} onKeyDown={navigateRadioGroup} onClick={() => setIcon(id)} className={`icon-choice ${icon === id ? "is-active" : ""}`}>
                        <Icon className="h-6 w-6" aria-hidden="true" /><span className="text-[11px]">{label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="field-help mt-4">Appearance is remembered on this browser and applied instantly.</p>
                </SettingsCard>
              </>
            )}

            {section === "voice" && (
              <SettingsCard title="Listen and learn" description="Read answers aloud, or settle in with an audio recap of your canvas." icon={<SpeakerIcon />} action={<StatusBadge tone={speech.supported ? "success" : "warning"}>{speech.supported ? "Browser audio ready" : "Not supported"}</StatusBadge>}>
                <div className="space-y-5">
                  <SettingsSwitch label="Voice responses" description="Enable the Listen controls on completed answers." checked={audio.voiceResponses} onChange={(value) => setAudio({ voiceResponses: value })} />
                  <SettingsSwitch label="Auto-play new answers" description="Read each completed explanation aloud automatically." checked={audio.autoPlay} disabled={!audio.voiceResponses} onChange={(value) => setAudio({ autoPlay: value })} />
                  <div className="grid gap-5 border-t border-ink-700 pt-5 sm:grid-cols-2">
                    <Slider label="Volume" value={audio.volume} min={0} max={1} step={0.05} valueLabel={`${Math.round(audio.volume * 100)}%`} onChange={(value) => setAudio({ volume: value })} />
                    <Slider label="Reading speed" value={audio.rate} min={0.6} max={1.6} step={0.05} valueLabel={`${audio.rate.toFixed(2)}×`} onChange={(value) => setAudio({ rate: value })} />
                  </div>
                  <button className="btn-secondary" disabled={!speech.supported || !audio.voiceResponses} onClick={() => voicePreviewActive ? speech.stop() : speech.speak({ id: "settings-preview", text: "Welcome to Ponder. A little curiosity can lead to a whole new understanding.", volume: audio.volume, rate: audio.rate })}><SpeakerIcon className="h-4 w-4" />{voicePreviewActive ? "Stop preview" : "Preview voice"}</button>
                  {!speech.supported && <p className="field-help">This browser does not support speech synthesis. Try a browser with Web Speech support.</p>}
                </div>
              </SettingsCard>
            )}

            {section === "data" && (
              <>
                <SettingsCard title="Your learning stays with you" description="Export a portable workspace or bring one back into Ponder." icon={<SaveIcon />}>
                  <div className="flex flex-wrap gap-2">
                    <a className="btn-primary" href={api.exportUrl} download><SaveIcon className="h-4 w-4" /> Export workspace</a>
                    <button className="btn-secondary" disabled={dataBusy} onClick={() => importRef.current?.click()}>Import workspace</button>
                    <input ref={importRef} type="file" accept=".json,application/json" className="hidden" aria-label="Import Ponder workspace" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importWorkspace(file); }} />
                  </div>
                  <p className="field-help">JSON exports include your canvases, answers, pictures, cards, maps, and sources. Connection keys stay on this server. Imports add new content without overwriting existing canvases.</p>
                  <Notice message={dataMessage} />
                </SettingsCard>
                <SettingsCard title="Local backups" description="Create a consistent snapshot of the entire database, including your settings." icon={<SaveIcon />} action={<button className="btn-secondary !text-xs" onClick={() => void createBackup()} disabled={dataBusy}>{dataBusy ? "Working…" : "Back up now"}</button>}>
                  {backups.isError && <Notice message={{ kind: "err", text: backups.error.message }} />}
                  <div className="space-y-3">
                    {backups.isPending && <p className="text-sm text-fog-400">Loading backups…</p>}
                    {backups.data?.backups.length === 0 && <div className="empty-state !py-7"><SaveIcon className="h-7 w-7 text-fog-500 mb-2" /><p className="text-sm text-fog-200">A fresh start for your backup history.</p><p className="text-xs text-fog-400 mt-1">Create your first snapshot with Back up now.</p></div>}
                    {backups.data?.backups.map((backup) => (
                      <div key={backup.name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 p-3.5">
                        <div className="min-w-0 flex-1"><p className="truncate text-sm text-fog-200" title={backup.name}>{backup.name}</p><p className="mt-1 text-xs text-fog-500">{new Date(backup.created_at).toLocaleString()} · {(backup.size_bytes / 1024).toFixed(0)} KB · {backup.canvases} canvases · {backup.nodes} answers</p></div>
                        <button className="btn-secondary !px-3 !py-1.5 !text-xs" disabled={dataBusy} onClick={() => void restoreBackup(backup.name)}>Restore</button>
                      </div>
                    ))}
                  </div>
                  <p className="field-help mt-4">Backups include saved connection keys. Restoring replaces the database and its settings; a safety snapshot is created first.</p>
                  {backups.data && <details className="mt-4 border-t border-ink-700 pt-3 text-xs text-fog-400"><summary className="cursor-pointer font-medium text-fog-300">Storage locations</summary><p className="mt-2 break-all">Database: <code>{backups.data.database_path}</code></p><p className="mt-1 break-all">Backups: <code>{backups.data.backups_path}</code></p></details>}
                </SettingsCard>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, description, icon, action, children, highlighted = false }: { title: string; description: string; icon: ReactNode; action?: ReactNode; children: ReactNode; highlighted?: boolean }) {
  return <section className={`surface-panel ${highlighted ? "settings-featured" : ""}`}><div className="flex flex-wrap items-start gap-3 border-b border-ink-700 px-5 py-5 sm:px-6"><span className="settings-section-icon">{icon}</span><div className="min-w-0 flex-1"><h3 className="text-base font-semibold text-fog-100">{title}</h3><p className="mt-1 text-xs leading-relaxed text-fog-400">{description}</p></div>{action}</div><div className="px-5 py-5 sm:px-6">{children}</div></section>;
}

function StatusBadge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "success" | "warning"; children: ReactNode }) {
  const tones = { neutral: "", accent: "status-pill-accent", success: "status-pill-success", warning: "status-pill-warning" };
  return <span className={`status-pill ${tones[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{children}</span>;
}

function Notice({ message }: { message: Message }) {
  return message ? <p className={`settings-notice ${message.kind === "err" ? "is-error" : "is-success"}`} role={message.kind === "err" ? "alert" : "status"}>{message.text}</p> : null;
}

function SettingsSwitch({ label, description, checked, onChange, disabled = false }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><div><p className="field-label">{label}</p><p className="field-help !mt-1">{description}</p></div><button type="button" className={`settings-switch ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span aria-hidden="true" /></button></div>;
}

function Slider({ label, value, min, max, step, valueLabel, onChange }: { label: string; value: number; min: number; max: number; step: number; valueLabel: string; onChange: (value: number) => void }) {
  return <label className="block"><span className="flex items-center justify-between"><span className="field-label">{label}</span><span className="text-xs tabular-nums text-spark-400">{valueLabel}</span></span><input type="range" className="mt-3 w-full accent-[rgb(var(--c-spark-400))]" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} aria-valuetext={valueLabel} /></label>;
}

function navigateRadioGroup(event: KeyboardEvent<HTMLButtonElement>) {
  const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!offset && event.key !== "Home" && event.key !== "End") return;
  const choices = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
  if (!choices.length) return;
  event.preventDefault();
  const index = choices.indexOf(event.currentTarget);
  const next = event.key === "Home" ? choices[0] : event.key === "End" ? choices[choices.length - 1] : choices[(index + offset + choices.length) % choices.length];
  next?.focus();
  next?.click();
}
