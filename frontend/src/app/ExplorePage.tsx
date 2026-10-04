import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useHashRoute } from "../hooks/useHashRoute";

/**
 * Explore (roadmap 7) — the local-first "discover" surface. No accounts, no cloud,
 * no fake community feed: it shows the learning maps YOU have actually built, and
 * sharing is a real file (export JSON → send it → import). Honest empty state when
 * nothing exists yet.
 */
export function ExplorePage() {
  const [, navigate] = useHashRoute();
  const queryClient = useQueryClient();
  const maps = useQuery({ queryKey: ["maps"], queryFn: api.maps });
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const onImportFile = async (file: File) => {
    setImportMsg(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const result = await api.importData(payload);
      const parts = [
        result.canvases_imported && `${result.canvases_imported} canvas${result.canvases_imported === 1 ? "" : "es"}`,
        result.nodes_imported && `${result.nodes_imported} answers`,
        result.maps_imported && `${result.maps_imported} map${result.maps_imported === 1 ? "" : "s"}`,
        result.cards_imported && `${result.cards_imported} cards`,
        result.materials_imported && `${result.materials_imported} source${result.materials_imported === 1 ? "" : "s"}`,
      ].filter(Boolean);
      setImportMsg(parts.length ? `Imported: ${parts.join(", ")}` : "File was valid — everything in it was already here (nothing new imported)");
      await Promise.all(["maps", "canvases", "cards", "materials", "knowledge-graph"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    } catch (err) {
      setImportMsg(`Couldn't import that file (${err instanceof Error ? err.message : "invalid export"})`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="workspace-page" data-page="explore">
      <div className="page-container">
      <header className="page-header"><div><p className="page-eyebrow">Follow the connections</p><h1 className="page-title">Explore</h1><p className="page-description">Revisit your learning maps, discover the next question, and share your workspace as a file.</p></div></header>

      {/* Share row */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <a
          href={api.exportUrl}
          className="btn-secondary"
          title="Download your whole learning workspace (canvases, maps, cards, sources) as one JSON file"
        >
          ⬇ Export my learning map
        </a>
        <button
          className="btn-secondary"
          onClick={() => fileRef.current?.click()}
          title="Import a ponder-learning-map.json someone sent you"
        >
          ⬆ Import a map
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
          }}
        />
        {importMsg && <span className="text-xs text-fog-300">{importMsg}</span>}
      </div>

      {/* Maps */}
      {maps.isLoading && <p className="text-sm text-fog-400">Loading your maps…</p>}
      {maps.isError && <p role="alert" className="settings-notice is-error">Could not load your learning maps. Refresh to try again.</p>}
      {maps.data && maps.data.maps.length === 0 && (
        <div className="empty-state max-w-xl">
          <p className="text-sm text-fog-200 mb-2">No learning maps yet.</p>
          <p className="text-xs text-fog-400 leading-relaxed">
            Open any canvas and use <span className="text-fog-200">Map</span> to decompose a topic into branches — each map appears here. When you're
            ready to share one, export it: the JSON file is the whole share, no account needed.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
        {maps.data?.maps.map((m) => (
          <div key={m.id} className="node-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">{m.canvas_title}</p>
            <h3 className="text-sm font-medium text-fog-100 mb-1">{m.title}</h3>
            {m.rationale && <p className="text-xs text-fog-400 line-clamp-3">{m.rationale}</p>}
            <p className="text-[11px] text-fog-500 mt-2">
              {m.branch_count} branch{m.branch_count === 1 ? "" : "es"} · {new Date(m.created_at).toLocaleDateString()}
            </p>
            <button
              className="btn-ghost text-xs text-spark-400 mt-2"
              onClick={() => navigate({ page: "canvas", canvasId: m.canvas_id })}
            >
              Open canvas →
            </button>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
