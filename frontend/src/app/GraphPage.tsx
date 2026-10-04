import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useHashRoute } from "../hooks/useHashRoute";
import { GraphIcon } from "../components/ui/Icons";

interface Concept {
  id: string;
  label: string;
  weight: number;
  canvas_id: string;
  canvas_title: string | null;
}
interface GraphEdge {
  from: string;
  to: string;
  kind: "parent" | "related";
}

/**
 * Full-page knowledge graph: only concepts the user has actually explored
 * (real completed Q&As grouped by concept), with real parent-child edges.
 * Empty state is honest — nothing appears until exploration happens.
 */
export function GraphPage() {
  const [, navigate] = useHashRoute();
  const graph = useQuery({ queryKey: ["knowledge-graph"], queryFn: api.knowledgeGraph, staleTime: 60_000 });
  const [selected, setSelected] = useState<string | null>(null);

  const W = 900;
  const H = 560;

  const layout = useMemo(() => {
    const concepts = graph.data?.concepts ?? [];
    const edges = graph.data?.edges ?? [];
    const cx = W / 2;
    const cy = H / 2;
    const positions = new Map<string, { x: number; y: number }>();
    const sorted = [...concepts].sort((a, b) => b.weight - a.weight);
    sorted.forEach((c, i) => {
      if (i === 0) {
        positions.set(c.id, { x: cx, y: cy });
        return;
      }
      const perRing = 8;
      const ring = Math.ceil(i / perRing);
      const idxInRing = (i - 1) % perRing;
      const radius = 130 * ring;
      const angle = (idxInRing / perRing) * Math.PI * 2 + ring * 0.45;
      positions.set(c.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.72 });
    });
    return { concepts, positions, edges: edges.filter((e) => positions.has(e.from) && positions.has(e.to)) };
  }, [graph.data]);

  const selectedConcept = layout.concepts.find((c) => c.id === selected);

  return (
    <div className="workspace-page" data-page="graph">
      <div className="page-container">
        <header className="page-header"><div><p className="page-eyebrow">See the bigger picture</p><h1 className="page-title">Knowledge graph</h1><p className="page-description">The concepts you've explored, connected by the paths your curiosity took.</p></div></header>
        {graph.isError && <p role="alert" className="settings-notice is-error">Could not load the graph. Refresh to try again.</p>}

        {graph.isLoading ? (
          <p className="status-text">Mapping your concepts…</p>
        ) : layout.concepts.length === 0 ? (
          <div className="node-card mt-16 py-16 flex flex-col items-center text-center px-8">
            <GraphIcon className="w-10 h-10 ponder-mark mark-glow mb-4" aria-hidden="true" />
            <p className="text-base text-fog-200 font-medium">Your ideas will connect here as you explore.</p>
            <p className="text-sm text-fog-400 mt-1.5 max-w-sm">
              Ask Ponder a question and every concept you explore will start placing itself on this map.
            </p>
            <button className="btn-primary mt-5" onClick={() => navigate({ page: "home" })}>
              Start with a question
            </button>
          </div>
        ) : (
          <>
            <div
              className="relative rounded-2xl border border-ink-700/60 bg-ink-900/40 overflow-hidden"
              role="img"
              aria-label={`Graph of ${layout.concepts.length} explored concepts`}
            >
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-hidden="true">
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
                      stroke={e.kind === "parent" ? "rgb(var(--c-spark-400))" : "rgb(var(--c-fog-400))"}
                      strokeWidth={e.kind === "parent" ? 1.5 : 1}
                      opacity={e.kind === "parent" ? 0.45 : 0.2}
                      strokeDasharray={e.kind === "parent" ? undefined : "2 4"}
                    />
                  );
                })}
              </svg>
              {layout.concepts.map((c) => {
                const pos = layout.positions.get(c.id)!;
                const r = 9 + Math.min(c.weight, 6) * 2.5;
                const isSelected = selected === c.id;
                return (
                  <button
                    key={c.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-110 focus:scale-110"
                    style={{ left: `${(pos.x / W) * 100}%`, top: `${(pos.y / H) * 100}%`, width: r * 2, height: r * 2 }}
                    onClick={() => setSelected(isSelected ? null : c.id)}
                    aria-label={`${c.label} — explored ${c.weight === 1 ? "once" : `${c.weight} times`}. ${isSelected ? "Deselect" : "Show details"}`}
                    aria-pressed={isSelected}
                    title={c.label}
                  >
                    <span
                      className={`absolute inset-0 rounded-full transition-colors ${
                        isSelected ? "bg-spark-500 ring-2 ring-spark-400" : "bg-spark-500/40 hover:bg-spark-500/60"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
              {/* labels for the top concepts */}
              {layout.concepts.slice(0, 10).map((c) => {
                const pos = layout.positions.get(c.id)!;
                const r = 9 + Math.min(c.weight, 6) * 2.5;
                return (
                  <span
                    key={`label-${c.id}`}
                    className="absolute -translate-x-1/2 text-[10px] text-fog-300 pointer-events-none whitespace-nowrap"
                    style={{ left: `${(pos.x / W) * 100}%`, top: `${((pos.y + r + 5) / H) * 100}%` }}
                    aria-hidden="true"
                  >
                    {c.label.slice(0, 24)}
                  </span>
                );
              })}
            </div>

            {/* detail card */}
            <div className="mt-4 min-h-[92px]">
              {selectedConcept ? (
                <div className="node-card p-4">
                  <p className="text-sm font-medium text-fog-100">{selectedConcept.label}</p>
                  <p className="text-xs text-fog-400 mt-0.5">
                    Explored {selectedConcept.weight === 1 ? "once" : `${selectedConcept.weight} times`} ·{" "}
                    {selectedConcept.canvas_title || "canvas"}
                  </p>
                  <button
                    className="text-xs text-spark-400 hover:text-spark-300 mt-2 transition-colors"
                    onClick={() => navigate({ page: "canvas", canvasId: selectedConcept.canvas_id })}
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
      </div>
    </div>
  );
}
