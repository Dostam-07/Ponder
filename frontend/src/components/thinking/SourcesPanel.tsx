import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvasSources } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { MaterialDialog } from "../learning/MaterialDialog";
import { CloseIcon, PlusIcon } from "../ui/Icons";

/** Concept-chip actions (roadmap 3) — implemented in CanvasPage against real canvas nodes. */
export interface ConceptActions {
  explain: (concept: string, materialId: string, materialTitle: string) => void;
  visualize: (concept: string, materialId: string, materialTitle: string) => void;
  practice: (concept: string, materialId: string, materialTitle: string) => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasTitle: string;
  /** Jump the canvas to this node (auto-focus handles the framing). */
  onOpenNode: (nodeId: string) => void;
  concepts?: ConceptActions;
}

type MaterialMeta = CanvasSources["materials"][number];

function ProvenanceBadge({ status }: { status: "sourced" | "context" | "uncertain" }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] rounded-full px-1.5 py-0.5 border whitespace-nowrap ${
        status === "sourced"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : status === "context"
            ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
            : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {status === "sourced" ? "From your source" : status === "context" ? "Added context" : "Uncertain"}
    </span>
  );
}

const KIND_LABEL: Record<string, string> = { pdf: "PDF", url: "Web", text: "Text", image: "Image" };

function MaterialCard({ m, canvasId, concepts }: { m: MaterialMeta; canvasId: string; concepts?: ConceptActions }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [activeConcept, setActiveConcept] = useState<string | null>(null);
  const excerpt = useQuery({
    queryKey: ["material", m.id],
    queryFn: () => api.material(m.id),
    enabled: expanded,
  });

  const summarize = useMutation({
    mutationFn: () => api.materialSummary(m.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canvas-sources", canvasId] }),
  });

  return (
    <div className="border border-ink-700 rounded-lg p-3 bg-ink-850/60">
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider border border-ink-600 rounded px-1.5 py-0.5 text-fog-300 mt-0.5">
          {KIND_LABEL[m.kind] ?? m.kind}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fog-100 truncate" title={m.title}>
            {m.title}
          </p>
          <p className="text-[10px] text-fog-400 mt-0.5">
            {Math.max(1, Math.round(m.char_count / 1000))}K chars
            {m.canvas_id ? (m.canvas_id === canvasId ? " · attached here" : " · attached elsewhere") : " · shared across canvases"}
            {m.cited_by > 0 && ` · grounds ${m.cited_by} answer${m.cited_by === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {m.summary ? (
        <>
          <p className="text-[11px] text-fog-300 leading-snug mt-2">{m.summary}</p>
          {m.key_points.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {m.key_points.slice(0, 6).map((k, i) => (
                <li key={i} className="text-[11px] text-fog-300 leading-snug">
                  <span className="text-spark-400">·</span> {k}
                </li>
              ))}
            </ul>
          )}
          {m.concepts.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">
                Core concepts {concepts ? "— click one to dive in" : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                {m.concepts.map((c) => {
                  const active = activeConcept === c;
                  return (
                    <button
                      key={c}
                      className={`text-[10px] rounded-full px-2 py-0.5 border transition-colors ${
                        active
                          ? "border-spark-500 bg-spark-500/10 text-spark-300"
                          : "border-ink-600 text-fog-300 hover:border-spark-500/60 hover:text-fog-100"
                      }`}
                      onClick={() => setActiveConcept(active ? null : c)}
                      title={concepts ? `Dive into “${c}”` : c}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {activeConcept && concepts && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <button
                    className="text-[10px] text-fog-300 border border-ink-600 hover:border-spark-500 hover:text-fog-100 rounded-full px-2 py-0.5 transition-colors"
                    title="Explain this concept in the context of this source"
                    onClick={() => {
                      concepts.explain(activeConcept, m.id, m.title);
                      setActiveConcept(null);
                    }}
                  >
                    Explain
                  </button>
                  <button
                    className="text-[10px] text-fog-300 border border-ink-600 hover:border-spark-500 hover:text-fog-100 rounded-full px-2 py-0.5 transition-colors"
                    title="Generate a visual (diagram/chart) for this concept"
                    onClick={() => {
                      concepts.visualize(activeConcept, m.id, m.title);
                      setActiveConcept(null);
                    }}
                  >
                    Visualize
                  </button>
                  <button
                    className="text-[10px] text-fog-300 border border-ink-600 hover:border-spark-500 hover:text-fog-100 rounded-full px-2 py-0.5 transition-colors"
                    title="Practice this concept (opens once a node exists)"
                    onClick={() => {
                      concepts.practice(activeConcept, m.id, m.title);
                      setActiveConcept(null);
                    }}
                  >
                    Practice
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <button
          className="text-[11px] text-spark-400 hover:text-spark-300 mt-2"
          disabled={summarize.isPending}
          onClick={() => summarize.mutate()}
          title="Generate a summary, key points, and core concepts from this source"
        >
          {summarize.isPending ? "Summarizing…" : "Summarize this source →"}
        </button>
      )}

      <button className="text-[11px] text-fog-400 hover:text-fog-200 mt-2" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        {expanded ? "Hide excerpt" : "Read excerpt"}
      </button>
      {expanded && (
        <p className="text-[11px] text-fog-300 leading-relaxed mt-1.5 whitespace-pre-wrap max-h-48 overflow-y-auto border-t border-ink-700 pt-1.5">
          {excerpt.isPending ? "Loading…" : (excerpt.data?.content ?? "").slice(0, 2000) || "(no readable text)"}
        </p>
      )}
    </div>
  );
}

export function SourcesPanel({ open, onClose, canvasId, canvasTitle, onOpenNode, concepts }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["canvas-sources", canvasId],
    queryFn: () => api.canvasSources(canvasId),
    enabled: open,
  });

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Source Explorer">
        <div className="absolute inset-0 bg-black/40 lg:bg-transparent" onClick={onClose} aria-hidden="true" />
        <aside className="absolute inset-y-0 right-0 w-full max-w-md bg-ink-900 border-l border-ink-700 shadow-2xl flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-700">
            <span className="text-sm font-medium text-fog-100">Source Explorer</span>
            {data && (
              <span className="text-[11px] text-fog-400">
                {data.materials.length} source{data.materials.length === 1 ? "" : "s"} · {data.answers.length} audited answer{data.answers.length === 1 ? "" : "s"}
              </span>
            )}
            <div className="flex-1" />
            <button className="btn-ghost !p-1.5" onClick={() => setAddOpen(true)} title="Add a source to this canvas" aria-label="Add source">
              <PlusIcon className="w-4 h-4" />
            </button>
            <button className="btn-ghost !p-1.5" onClick={onClose} title="Close" aria-label="Close">
              <CloseIcon />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {isLoading && <p className="text-xs text-fog-400">Loading sources…</p>}
            {error && <p className="text-xs text-red-400">Could not load sources: {(error as Error).message}</p>}
            {data && (
              <>
                <section>
                  <h4 className="text-[10px] uppercase tracking-wider text-fog-400 mb-2">Your sources</h4>
                  {data.materials.length === 0 ? (
                    <p className="text-xs text-fog-400 leading-relaxed">
                      No sources attached yet. Add notes, a PDF, or a web page — answers grounded in them get provenance labels you can audit below.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {data.materials.map((m) => (
                        <MaterialCard key={m.id} m={m} canvasId={canvasId} concepts={concepts} />
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <h4 className="text-[10px] uppercase tracking-wider text-fog-400 mb-2">Answer provenance</h4>
                  {data.answers.length === 0 ? (
                    <p className="text-xs text-fog-400 leading-relaxed">
                      Nothing to audit yet. Ask questions against a source (or with web search on) and each answer's evidential status lands here.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {data.answers.map((a) => (
                        <button
                          key={a.node_id}
                          className="w-full text-left border border-ink-700 hover:border-spark-500/60 rounded-lg px-3 py-2 transition-colors"
                          onClick={() => {
                            onOpenNode(a.node_id);
                            onClose();
                          }}
                          title="Jump to this answer on the canvas"
                        >
                          <div className="flex items-center gap-2">
                            {a.provenance ? (
                              <ProvenanceBadge status={a.provenance.status} />
                            ) : (
                              <span className="text-[10px] text-fog-400 border border-ink-600 rounded-full px-1.5 py-0.5">Grounded</span>
                            )}
                            <span className="text-xs text-fog-200 truncate flex-1">{a.title}</span>
                          </div>
                          {a.provenance?.status === "sourced" && a.provenance.quote && (
                            <p className="text-[11px] text-fog-400 italic leading-snug mt-1">“{a.provenance.quote}”</p>
                          )}
                          {a.sources.length > 0 && (
                            <p className="text-[11px] text-fog-400 leading-snug mt-1">
                              Web: {a.sources.map((s) => s.title).join("; ").slice(0, 120)}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <button className="text-[11px] text-fog-400 hover:text-fog-200" onClick={() => refetch()}>
                  Refresh
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
      <MaterialDialog open={addOpen} onClose={() => setAddOpen(false)} canvasId={canvasId} canvasTitle={canvasTitle} onAdded={() => refetch()} />
    </>
  );
}
