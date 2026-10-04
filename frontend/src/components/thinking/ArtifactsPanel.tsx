import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Artifact, ArtifactKind } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { CloseIcon, TrashIcon } from "../ui/Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  canvasId: string;
  canvasTitle: string;
}

const KIND_META: Record<ArtifactKind, { label: string; icon: string; blurb: string }> = {
  study_guide: { label: "Study guide", icon: "📖", blurb: "Teach this canvas as a coherent unit" },
  research_brief: { label: "Research brief", icon: "📋", blurb: "Findings + support + open questions" },
  timeline: { label: "Timeline", icon: "🕑", blurb: "The explored material, in order" },
  flashcard_deck: { label: "Flashcard deck", icon: "🃏", blurb: "Reviewable cards for spaced practice" },
};

function ArtifactDoc({ a }: { a: Artifact }) {
  const c = a.content;
  switch (c.kind) {
    case "study_guide":
      return (
        <div className="space-y-3">
          {c.sections.map((s, i) => (
            <div key={i}>
              <h5 className="text-xs font-medium text-fog-100 mb-0.5">{s.heading}</h5>
              <p className="text-[11px] text-fog-300 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      );
    case "research_brief":
      return (
        <div className="space-y-3">
          <p className="text-[11px] text-fog-300 leading-relaxed">{c.summary}</p>
          <div>
            <h5 className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">Findings</h5>
            <ul className="space-y-1.5">
              {c.findings.map((f, i) => (
                <li key={i} className="text-[11px] leading-snug">
                  <span className="text-fog-100 font-medium">{f.claim}</span>
                  <span className="text-fog-400"> — {f.support}</span>
                </li>
              ))}
            </ul>
          </div>
          {c.open_questions.length > 0 && (
            <div>
              <h5 className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">Open questions</h5>
              <ul className="space-y-0.5">
                {c.open_questions.map((q, i) => (
                  <li key={i} className="text-[11px] text-amber-300/90">
                    · {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    case "timeline":
      return (
        <ol className="relative border-l border-ink-600 ml-1.5 space-y-2.5">
          {c.entries.map((e, i) => (
            <li key={i} className="ml-3">
              <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-spark-500/70 border border-spark-400" aria-hidden="true" />
              <span className="text-[10px] font-medium text-spark-400">{e.when}</span>
              <p className="text-[11px] text-fog-300 leading-snug">{e.what}</p>
            </li>
          ))}
        </ol>
      );
    case "flashcard_deck":
      return (
        <div className="grid grid-cols-1 gap-2">
          {c.cards.map((card, i) => (
            <div key={i} className="border border-ink-700 rounded-lg p-2.5 bg-ink-850/60">
              <p className="text-xs font-medium text-fog-100">{card.concept}</p>
              <p className="text-[11px] text-fog-300 leading-snug mt-1">{card.explanation}</p>
              {card.example && <p className="text-[11px] text-fog-400 italic leading-snug mt-1">e.g. {card.example}</p>}
            </div>
          ))}
        </div>
      );
  }
}

export function ArtifactsPanel({ open, onClose, canvasId, canvasTitle }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["artifacts", canvasId],
    queryFn: () => api.canvasArtifacts(canvasId),
    enabled: open,
  });

  const generate = useMutation({
    mutationFn: (kind: ArtifactKind) => api.createArtifact(canvasId, kind),
    onSuccess: (a) => {
      setError("");
      setExpanded(a.id);
      qc.invalidateQueries({ queryKey: ["artifacts", canvasId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const del = useMutation({
    mutationFn: api.deleteArtifact,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["artifacts", canvasId] }),
  });

  const importCards = useMutation({
    mutationFn: api.importArtifactCards,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["dueCards"] });
      alert(r.added > 0 ? `${r.added} card${r.added === 1 ? "" : "s"} added to your review queue.` : "All cards in this deck are already in your review queue.");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Artifacts">
      <div className="absolute inset-0 bg-black/40 lg:bg-transparent" onClick={onClose} aria-hidden="true" />
      <aside className="absolute inset-y-0 right-0 w-full max-w-md bg-ink-900 border-l border-ink-700 shadow-2xl flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-700">
          <span className="text-sm font-medium text-fog-100">Artifacts</span>
          <span className="text-[11px] text-fog-400">from “{canvasTitle}”</span>
          <div className="flex-1" />
          <button className="btn-ghost !p-1.5" onClick={onClose} title="Close" aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section>
            <h4 className="text-[10px] uppercase tracking-wider text-fog-400 mb-2">Generate from this canvas</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(KIND_META) as ArtifactKind[]).map((kind) => (
                <button
                  key={kind}
                  className="text-left border border-ink-700 hover:border-spark-500/60 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate(kind)}
                  title={KIND_META[kind].blurb}
                >
                  <span className="text-xs text-fog-100">
                    {KIND_META[kind].icon} {KIND_META[kind].label}
                  </span>
                  <p className="text-[10px] text-fog-400 mt-0.5 leading-snug">{generate.isPending ? "Generating…" : KIND_META[kind].blurb}</p>
                </button>
              ))}
            </div>
            {generate.isPending && <p className="text-[11px] text-fog-400 mt-1.5">Building from your real answers — slow local models can take a minute or two.</p>}
          </section>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {isLoading && <p className="text-xs text-fog-400">Loading artifacts…</p>}

          <section>
            <h4 className="text-[10px] uppercase tracking-wider text-fog-400 mb-2">
              Generated {data && data.length > 0 && <span className="normal-case">· {data.length}</span>}
            </h4>
            {!data || data.length === 0 ? (
              <p className="text-xs text-fog-400 leading-relaxed">Nothing generated yet. Each artifact is built strictly from the answers on this canvas — no invented content.</p>
            ) : (
              <div className="space-y-2">
                {data.map((a) => (
                  <div key={a.id} className="border border-ink-700 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-ink-850/60">
                      <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(expanded === a.id ? null : a.id)} aria-expanded={expanded === a.id} title="Expand / collapse">
                        <span className="text-xs font-medium text-fog-100 truncate block">
                          {KIND_META[a.kind].icon} {a.title}
                        </span>
                        <span className="text-[10px] text-fog-400">
                          {KIND_META[a.kind].label} · {a.node_count} answer{a.node_count === 1 ? "" : "s"} · {new Date(a.created_at).toLocaleDateString()}
                        </span>
                      </button>
                      <button className="btn-ghost hover:text-red-400" title="Delete artifact" aria-label="Delete artifact" onClick={() => del.mutate(a.id)}>
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {expanded === a.id && (
                      <div className="p-3 border-t border-ink-700">
                        <ArtifactDoc a={a} />
                        {a.kind === "flashcard_deck" && (
                          <button
                            className="btn-primary !text-xs mt-3"
                            disabled={importCards.isPending}
                            onClick={() => importCards.mutate(a.id)}
                          >
                            {importCards.isPending ? "Importing…" : "＋ Add deck to my review"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
