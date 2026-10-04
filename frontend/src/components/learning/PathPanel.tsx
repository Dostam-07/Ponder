import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LearningPath } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { useCanvasStore } from "../../stores/canvasStore";
import { CloseIcon, RouteIcon, CheckIcon } from "../ui/Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onNodeAdded: () => void;
}

/**
 * Structured learning path for the current canvas (spec §2). Sections are generated
 * from the canvas's real content; starting a section creates a real node and streams
 * a real answer onto the canvas. Progress reflects actual node statuses.
 */
export function PathPanel({ open, onClose, onNodeAdded }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const nodes = useCanvasStore((s) => s.nodes);
  const [building, setBuilding] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const path = useQuery({
    queryKey: ["path", canvasId],
    queryFn: () => fetch(`/api/canvases/${canvasId}/graph`).then((r) => r.json()) as Promise<{ path: LearningPath | null }>,
    enabled: open && !!canvasId,
    select: (d) => d.path,
  });

  const build = async () => {
    if (!canvasId) return;
    setBuilding(true);
    setError("");
    try {
      await api.buildPath(canvasId);
      await path.refetch();
      onNodeAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the path");
    } finally {
      setBuilding(false);
    }
  };

  const start = async (sectionId: string) => {
    const pathId = path.data?.id;
    if (!pathId) return;
    setStartingId(sectionId);
    setError("");
    try {
      await api.startPathSection(pathId, sectionId);
      onNodeAdded();
      onClose(); // the new node is streaming on the canvas — show it
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the section");
    } finally {
      setStartingId(null);
    }
  };

  if (!open) return null;

  const data = path.data ?? null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Learning path">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md popover-surface p-5 overflow-y-auto animate-slide-in">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <RouteIcon className="w-4 h-4 ponder-mark" aria-hidden="true" />
            <h2 className="text-sm font-medium text-fog-100">Learning path</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close learning path" title="Close">
            <CloseIcon />
          </button>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {!data && !building && (
          <div className="text-center py-10">
            <RouteIcon className="w-8 h-8 ponder-mark mx-auto mb-3 opacity-60" aria-hidden="true" />
            <p className="text-sm text-fog-200">Turn this canvas into a structured path.</p>
            <p className="text-xs text-fog-400 mt-1.5 max-w-xs mx-auto">
              Ponder builds a section-by-section route through your topic from what you've explored — each section becomes
              a real lesson on the canvas.
            </p>
            <button className="btn-primary mt-4" onClick={() => void build()}>
              Build learning path
            </button>
          </div>
        )}

        {building && <p className="status-text">Designing your path…</p>}

        {data && (
          <>
            <h3 className="text-base font-semibold text-fog-100">{data.title}</h3>
            {data.goal && <p className="text-xs text-fog-400 mt-1">{data.goal}</p>}
            <ol className="mt-4 space-y-2">
              {data.sections.map((s, i) => {
                const node = s.node_id ? nodes[s.node_id] : undefined;
                const started = !!node;
                const complete = node?.status === "complete";
                return (
                  <li key={s.id} className={`node-card p-3 ${started ? "" : "opacity-90"}`}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center shrink-0 ${
                          complete ? "bg-emerald-500/20 text-emerald-400" : started ? "bg-spark-500/20 text-spark-400" : "bg-ink-700 text-fog-400"
                        }`}
                        aria-label={complete ? "Completed" : started ? "In progress" : "Not started"}
                      >
                        {complete ? <CheckIcon className="w-3 h-3" /> : i + 1}
                      </span>
                      <span className="flex-1 text-sm text-fog-100 font-medium">{s.title}</span>
                    </div>
                    <ul className="mt-1.5 ml-7 space-y-0.5">
                      {s.points.map((pt, j) => (
                        <li key={j} className="text-xs text-fog-400 flex gap-1.5">
                          <span className="text-fog-600 select-none">·</span>
                          {pt}
                        </li>
                      ))}
                    </ul>
                    {!started && (
                      <button
                        className="btn-primary !py-1 !px-2.5 !text-xs mt-2 ml-7"
                        disabled={startingId === s.id}
                        onClick={() => void start(s.id)}
                      >
                        {startingId === s.id ? "Starting…" : "Start section"}
                      </button>
                    )}
                    {started && !complete && <p className="text-[11px] text-spark-400 mt-1.5 ml-7">Lesson streaming on the canvas…</p>}
                    {complete && <p className="text-[11px] text-emerald-400 mt-1.5 ml-7">Completed on the canvas</p>}
                  </li>
                );
              })}
            </ol>
            <button className="btn-ghost text-xs mt-3 mx-auto block" onClick={() => void build()} disabled={building}>
              {building ? "Rebuilding…" : "Rebuild path"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
