import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { CloseIcon } from "../ui/Icons";
import { useHashRoute } from "../../hooks/useHashRoute";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Knowledge graph (research-spec §12): the concepts the user has ACTUALLY explored,
 * grouped from real completed Q&As, with real parent-child edges. Empty state is
 * honest — nothing appears until exploration happens.
 */
export function KnowledgeGraphPanel({ open, onClose }: Props) {
  const [, navigate] = useHashRoute();
  const graph = useQuery({ queryKey: ["knowledge-graph"], queryFn: api.knowledgeGraph, enabled: open, staleTime: 60_000 });
  const [selected, setSelected] = useState<string | null>(null);

  const layout = useMemo(() => {
    const concepts = graph.data?.concepts ?? [];
    const edges = graph.data?.edges ?? [];
    // Radial layout: heaviest concept at the center, others in rings by weight.
    const cx = 260;
    const cy = 240;
    const positions = new Map<string, { x: number; y: number }>();
    const sorted = [...concepts].sort((a, b) => b.weight - a.weight);
    sorted.forEach((c, i) => {
      if (i === 0) {
        positions.set(c.id, { x: cx, y: cy });
        return;
      }
      const ring = Math.ceil(i / 7);
      const idxInRing = (i - 1) % 7;
      const radius = 110 * ring;
      const angle = (idxInRing / 7) * Math.PI * 2 + ring * 0.5;
      positions.set(c.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.75 });
    });
    return { positions, edges: edges.filter((e) => positions.has(e.from) && positions.has(e.to)) };
  }, [graph.data]);

  if (!open) return null;

  const concepts = graph.data?.concepts ?? [];
  const selectedConcept = concepts.find((c) => c.id === selected);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Knowledge graph">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl popover-surface p-5 overflow-hidden flex flex-col animate-slide-in">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-medium text-fog-100">Your knowledge graph</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close knowledge graph" title="Close">
            <CloseIcon />
          </button>
        </div>
        <p className="text-xs text-fog-400 mb-3">Every dot is a concept you actually explored. Bigger circles = explored more.</p>

        {graph.isLoading ? (
          <p className="status-text">Mapping your concepts…</p>
        ) : concepts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm text-fog-200">Your ideas will connect here as you explore.</p>
            <p className="text-xs text-fog-400 mt-1.5 max-w-xs">
              Ask a question and Ponder will start placing the concepts you explore onto this map.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 relative overflow-hidden rounded-xl border border-ink-700/60 bg-ink-900/30" role="img" aria-label={`Graph of ${concepts.length} explored concepts`}>
              <svg className="absolute inset-0 w-full h-full" aria-hidden="true">
                {layout.edges.map((e, i) => {
                  const a = layout.positions.get(e.from)!;
                  const b = layout.positions.get(e.to)!;
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={e.kind === "parent" ? "stroke-[rgb(var(--c-spark-400))] stroke-[1.5] opacity-50" : "stroke-[rgb(var(--c-fog-400))] stroke-[1] opacity-25 stroke-dasharray-2-4"}
                    />
                  );
                })}
              </svg>
              {concepts.map((c) => {
                const pos = layout.positions.get(c.id)!;
                const r = 8 + Math.min(c.weight, 5) * 2.5;
                const isSelected = selected === c.id;
                return (
                  <button
                    key={c.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:scale-110"
                    style={{ left: pos.x, top: pos.y, width: r * 2, height: r * 2 }}
                    onClick={() => setSelected(isSelected ? null : c.id)}
                    aria-label={`${c.label} — from ${c.canvas_title || "a canvas"}. ${isSelected ? "Deselect" : "Show details"}`}
                    aria-pressed={isSelected}
                    title={c.label}
                  >
                    <span
                      className={`absolute inset-0 rounded-full ${isSelected ? "bg-spark-500/60" : "bg-spark-500/30"} transition-colors`}
                      aria-hidden="true"
                    />
                    <span className={`relative ${isSelected ? "text-[9px]" : ""} ${r > 11 ? "text-[9px]" : ""} text-fog-100 font-medium`} aria-hidden="true">
                      {isSelected ? "" : ""}
                    </span>
                  </button>
                );
              })}
              {/* labels for the top concepts */}
              {concepts.slice(0, 8).map((c) => {
                const pos = layout.positions.get(c.id)!;
                return (
                  <span
                    key={`label-${c.id}`}
                    className="absolute -translate-x-1/2 text-[9px] text-fog-300 pointer-events-none whitespace-nowrap"
                    style={{ left: pos.x, top: pos.y + (8 + Math.min(c.weight, 5) * 2.5) + 4 }}
                    aria-hidden="true"
                  >
                    {c.label.slice(0, 22)}
                  </span>
                );
              })}
            </div>

            {/* detail card */}
            <div className="mt-3 min-h-[86px]">
              {selectedConcept ? (
                <div className="node-card p-3">
                  <p className="text-sm text-fog-100">{selectedConcept.label}</p>
                  <p className="text-xs text-fog-400 mt-0.5">
                    Explored {selectedConcept.weight === 1 ? "once" : `${selectedConcept.weight} times`} · {selectedConcept.canvas_title || "canvas"}
                  </p>
                  <button
                    className="text-xs text-spark-400 hover:text-spark-300 mt-1.5 transition-colors"
                    onClick={() => {
                      onClose();
                      navigate({ page: "canvas", canvasId: selectedConcept.canvas_id });
                    }}
                  >
                    Open on its canvas →
                  </button>
                </div>
              ) : (
                <p className="text-xs text-fog-400 px-1">Click a concept to see where it came from.</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
