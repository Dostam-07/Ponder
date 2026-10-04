import { useState } from "react";
import type { ThinkingMap } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { useCanvasStore } from "../../stores/canvasStore";
import { MapIcon, CloseIcon } from "../ui/Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a branch creates a node so the canvas can refetch the graph. */
  onNodeAdded: () => void;
}

/**
 * Thinking Map (thinking-spec §3): a dynamic map of the question space derived from
 * what the user actually explored. Each branch starts a REAL streamed answer on the
 * canvas; the map evolves as branches are started.
 */
export function ThinkingMapPanel({ open, onClose, onNodeAdded }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const storeMap = useCanvasStore((s) => s.map);
  const nodes = useCanvasStore((s) => s.nodes);
  const [building, setBuilding] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Live store data — updates when a branch is started or the graph refetches.
  const map = storeMap;

  const build = async () => {
    if (!canvasId) return;
    setBuilding(true);
    setError("");
    try {
      const fresh = await api.buildMap(canvasId);
      // Show it immediately; the graph refetch will confirm/store it too.
      useCanvasStore.setState({ map: fresh });
      onNodeAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the map");
    } finally {
      setBuilding(false);
    }
  };

  const start = async (branchId: string) => {
    if (!map) return;
    setStartingId(branchId);
    setError("");
    try {
      await api.startMapBranch(map.id, branchId);
      onNodeAdded();
      onClose(); // the new node is streaming on the canvas — show it
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the branch");
    } finally {
      setStartingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Thinking map">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md popover-surface p-5 overflow-y-auto animate-slide-in">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 ponder-mark" aria-hidden="true" />
            <h2 className="text-sm font-medium text-fog-100">Thinking map</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close thinking map" title="Close">
            <CloseIcon />
          </button>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {!map && !building && (
          <div className="text-center py-10">
            <MapIcon className="w-8 h-8 ponder-mark mx-auto mb-3 opacity-60" aria-hidden="true" />
            <p className="text-sm text-fog-200">Map the question space.</p>
            <p className="text-xs text-fog-400 mt-1.5 max-w-xs mx-auto">
              Ponder decomposes what you've explored into the facets a careful thinker would examine — causes, evidence,
              counterpoints, open questions. Click any branch to explore it for real.
            </p>
            <button className="btn-primary mt-4" onClick={() => void build()}>
              Build thinking map
            </button>
          </div>
        )}

        {building && <p className="status-text">Mapping your question…</p>}

        {map && (
          <>
            <h3 className="text-base font-semibold text-fog-100">{map.title}</h3>
            {map.rationale && <p className="text-xs text-fog-400 mt-1">{map.rationale}</p>}
            <ul className="mt-4 space-y-2">
              {map.branches.map((b) => {
                const node = b.node_id ? nodes[b.node_id] : undefined;
                const started = !!node;
                const complete = node?.status === "complete";
                return (
                  <li key={b.id} className="node-card p-3">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 w-5 h-5 shrink-0 rounded-full text-[10px] flex items-center justify-center ${
                          complete ? "bg-emerald-500/20 text-emerald-400" : started ? "bg-spark-500/20 text-spark-400" : "bg-ink-700 text-fog-400"
                        }`}
                        aria-label={complete ? "Explored" : started ? "In progress" : "Not explored"}
                      >
                        {complete ? "✓" : started ? "…" : "·"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-fog-100">{b.label}</p>
                        <p className="text-xs text-fog-400 mt-0.5">{b.question}</p>
                        {started && !complete && <p className="text-[11px] text-spark-400 mt-1">Answering on the canvas…</p>}
                      </div>
                      {!started && (
                        <button
                          className="btn-primary !px-2.5 !py-1 !text-xs shrink-0"
                          disabled={startingId === b.id}
                          onClick={() => void start(b.id)}
                        >
                          {startingId === b.id ? "Starting…" : "Explore"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              className="text-xs text-fog-400 hover:text-spark-400 mt-4 transition-colors"
              onClick={() => void build()}
              disabled={building}
            >
              ↻ Rebuild map from current canvas
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
