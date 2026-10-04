import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvasEntity } from "@canvas-learn/shared";
import { api } from "../lib/api";
import { routeToHash } from "../hooks/useHashRoute";
import { AtomIcon, ChevronRightIcon, PlusIcon, SearchIcon, GridIcon, ListIcon, NoteIcon, TrashIcon, CheckIcon, CloseIcon } from "../components/ui/Icons";

type HistoryView = "grid" | "list";
const VIEW_KEY = "ponder.canvas-history-view";

function readView(): HistoryView {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; }
  catch { return "grid"; }
}

export function CanvasHistoryPage({ onNewCanvas }: { onNewCanvas: () => void }) {
  const queryClient = useQueryClient();
  const canvases = useQuery({ queryKey: ["canvases"], queryFn: api.listCanvases });
  const [search, setSearch] = useState("");
  const [view, setView] = useState<HistoryView>(readView);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<{ id: string; kind: "rename" | "delete" } | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const inFlight = useRef(false);
  const query = search.trim().toLocaleLowerCase();
  const history = [...(canvases.data ?? [])]
    .filter((canvas) => canvas.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.updated_at - a.updated_at);

  function changeView(next: HistoryView) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* Browser storage may be unavailable. */ }
  }

  async function saveRename(canvas: CanvasEntity) {
    const title = draft.trim();
    if (!title || inFlight.current) return;
    if (title === canvas.title) { setRenaming(null); return; }
    inFlight.current = true;
    setBusy({ id: canvas.id, kind: "rename" });
    setMessage(null);
    try {
      const saved = await api.renameCanvas(canvas.id, title);
      queryClient.setQueryData<CanvasEntity[]>(["canvases"], (current) => current?.map((item) => item.id === saved.id ? { ...item, ...saved } : item));
      setRenaming(null);
      setMessage({ kind: "success", text: `Canvas renamed to “${saved.title}”.` });
      void queryClient.invalidateQueries({ queryKey: ["canvases"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      void queryClient.invalidateQueries({ queryKey: ["maps"] });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not rename this canvas" });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function deleteCanvas(canvas: CanvasEntity) {
    if (inFlight.current || !window.confirm(`Delete “${canvas.title}” and all its answers? This cannot be undone.`)) return;
    inFlight.current = true;
    setBusy({ id: canvas.id, kind: "delete" });
    setMessage(null);
    try {
      await api.deleteCanvas(canvas.id);
      queryClient.setQueryData<CanvasEntity[]>(["canvases"], (current) => current?.filter((item) => item.id !== canvas.id));
      if (renaming === canvas.id) setRenaming(null);
      setMessage({ kind: "success", text: `“${canvas.title}” deleted.` });
      void queryClient.invalidateQueries();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not delete this canvas" });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="workspace-page" data-page="canvases">
      <div className="page-container">
        <header className="page-header">
          <div>
            <p className="page-eyebrow">Pick up where you left off</p>
            <h1 className="page-title">Canvas history</h1>
            <p className="page-description">Browse your past explorations and choose a canvas to continue.</p>
          </div>
          <button type="button" className="btn-primary" onClick={onNewCanvas}>
            <PlusIcon className="h-4 w-4" /> New exploration
          </button>
        </header>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-500" aria-hidden="true" />
            <input
              type="search"
              className="input-bar w-full !pl-10"
              aria-label="Search canvas history"
              placeholder="Search your canvases…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canvases.data && <p className="text-xs text-fog-400">{canvases.data.length} saved canvas{canvases.data.length === 1 ? "" : "es"} · Recently updated first</p>}
            <div className="inline-flex gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1" role="group" aria-label="Canvas history view">
              {([{ id: "grid", label: "Grid", Icon: GridIcon }, { id: "list", label: "List", Icon: ListIcon }] as const).map(({ id, label, Icon }) => (
                <button key={id} type="button" aria-label={`${label} view`} aria-pressed={view === id} onClick={() => changeView(id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${view === id ? "bg-spark-500/15 text-spark-400" : "text-fog-400 hover:bg-ink-800 hover:text-fog-100"}`}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {message && <p className={`settings-notice ${message.kind === "error" ? "is-error" : "is-success"}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}

        {canvases.isPending && <p className="text-sm text-fog-400" role="status">Loading your canvas history…</p>}
        {canvases.isError && (
          <div className="settings-notice is-error" role="alert">
            <p>Could not load your canvas history. {canvases.error.message}</p>
            <button type="button" className="btn-secondary mt-3 !text-xs" disabled={canvases.isFetching} onClick={() => void canvases.refetch()}>Try again</button>
          </div>
        )}
        {canvases.data && history.length === 0 && (
          <div className="empty-state">
            <AtomIcon className="mb-3 h-8 w-8 text-spark-400" aria-hidden="true" />
            <h2 className="text-base font-medium text-fog-200">{canvases.data.length ? "No matching canvases" : "Your canvas history starts here"}</h2>
            <p className="mt-2 max-w-md text-sm text-fog-400">{canvases.data.length ? "Try another title or clear your search to see all your explorations." : "Start a new exploration. Your canvases will be saved here so you can return to them anytime."}</p>
          </div>
        )}
        <div data-history-view={view} className={view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3"}>
          {history.map((canvas) => {
            const editing = renaming === canvas.id;
            const href = routeToHash({ page: "canvas", canvasId: canvas.id });
            return (
              <article key={canvas.id} data-history-canvas={canvas.id} className={`surface-panel group min-w-0 transition-colors hover:border-spark-500/50 ${view === "grid" ? "flex flex-col p-5" : "flex flex-col gap-4 p-4 sm:flex-row sm:items-center"}`}>
                {editing ? (
                  <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); void saveRename(canvas); }} onKeyDown={(event) => { if (event.key === "Escape" && !busy) setRenaming(null); }}>
                    <label className="field-label" htmlFor={`history-title-${canvas.id}`}>Canvas title</label>
                    <input id={`history-title-${canvas.id}`} autoFocus className="input-bar mt-2 w-full" value={draft} maxLength={120} required disabled={!!busy} onChange={(event) => setDraft(event.target.value)} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="submit" className="btn-primary !px-3 !py-2 !text-xs" disabled={!!busy || !draft.trim()}><CheckIcon /> {busy?.kind === "rename" ? "Saving…" : "Save name"}</button>
                      <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" disabled={!!busy} onClick={() => setRenaming(null)}><CloseIcon /> Cancel</button>
                    </div>
                  </form>
                ) : (
                  <a href={href} data-history-open className={`min-w-0 flex-1 ${view === "grid" ? "block" : "flex items-start gap-3 sm:items-center"}`}>
                    <div className={view === "grid" ? "mb-4 flex items-center justify-between" : "shrink-0"}>
                      <span className="settings-section-icon"><AtomIcon className="h-4 w-4" /></span>
                      {view === "grid" && <ChevronRightIcon className="h-4 w-4 text-fog-500 group-hover:text-spark-400" />}
                    </div>
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-medium text-fog-100">{canvas.title || "Untitled canvas"}</h2>
                      <div className={view === "grid" ? "mt-2 space-y-3" : "mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"}>
                        <p className="text-xs text-fog-400">{canvas.node_count} answer{canvas.node_count === 1 ? "" : "s"}</p>
                        <p className="text-[11px] text-fog-500">Updated <time dateTime={new Date(canvas.updated_at).toISOString()}>{new Date(canvas.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time></p>
                      </div>
                    </div>
                  </a>
                )}
                {!editing && (
                  <div className={`flex shrink-0 flex-wrap items-center gap-1 ${view === "grid" ? "mt-4 border-t border-ink-700 pt-3" : "border-t border-ink-700 pt-3 sm:border-0 sm:pt-0"}`}>
                    <a href={href} aria-label={`Edit canvas ${canvas.title}`} className="btn-ghost inline-flex items-center gap-1.5 !px-2 !py-2 !text-xs"><NoteIcon className="h-3.5 w-3.5" /> Edit</a>
                    <button type="button" aria-label={`Rename canvas ${canvas.title}`} className="btn-ghost inline-flex items-center gap-1.5 !px-2 !py-2 !text-xs" disabled={!!busy} onClick={() => { setRenaming(canvas.id); setDraft(canvas.title); setMessage(null); }}>Rename</button>
                    <button type="button" aria-label={`Delete canvas ${canvas.title}`} className="btn-ghost inline-flex items-center gap-1.5 !px-2 !py-2 !text-xs hover:!text-red-400" disabled={!!busy} onClick={() => void deleteCanvas(canvas)}><TrashIcon className="h-3.5 w-3.5" /> {busy?.id === canvas.id && busy.kind === "delete" ? "Deleting…" : "Delete"}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
