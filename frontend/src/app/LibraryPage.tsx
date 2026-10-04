import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CloseIcon, SourceIcon, PlusIcon, TrashIcon } from "../components/ui/Icons";
import { MaterialDialog } from "../components/learning/MaterialDialog";

type Tab = "saved" | "cards" | "sources";

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>("saved");
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["library"], queryFn: api.library });
  const cards = useQuery({ queryKey: ["cards"], queryFn: api.cards });
  const materials = useQuery({ queryKey: ["materials"], queryFn: api.materials });

  const delMaterial = useMutation({
    mutationFn: api.deleteMaterial,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["materials"] }),
  });

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "saved", label: "Saved ideas", count: saved.data?.length ?? 0 },
    { id: "cards", label: "Knowledge cards", count: cards.data?.length ?? 0 },
    { id: "sources", label: "Sources", count: materials.data?.length ?? 0 },
  ];

  return (
    <div className="workspace-page" data-page="library">
      <div className="page-container">
      <header className="page-header"><div><p className="page-eyebrow">Ideas worth keeping</p><h1 className="page-title">Library</h1><p className="page-description">Your saved explanations, knowledge cards, and source material, together.</p></div></header>

      {/* lightweight tabs (spec §11) */}
      <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Library sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
              tab === t.id ? "border-spark-500 bg-spark-500/15 text-spark-400" : "border-ink-700 text-fog-300 hover:border-ink-600"
            }`}
          >
            {t.label} <span className="opacity-60">{t.count}</span>
          </button>
        ))}
      </div>

      {(tab === "saved" && saved.isError || tab === "cards" && cards.isError || tab === "sources" && materials.isError) && <p role="alert" className="settings-notice is-error">Could not load this part of your library. Refresh to try again.</p>}
      {(tab === "saved" && saved.isPending || tab === "cards" && cards.isPending || tab === "sources" && materials.isPending) && <p className="status-text py-8">Opening your library…</p>}
      {/* ---- saved ideas (from node bookmark) ---- */}
      {tab === "saved" && (
        <>
          {saved.data?.length === 0 && <Empty text="Nothing saved yet. Use the bookmark icon on any node you want to keep." />}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
            {saved.data?.map((item) => (
              <div key={item.id} className="node-card p-4 relative">
                <button
                  className="absolute top-2 right-2 btn-ghost"
                  title="Remove from library"
                  aria-label="Remove from library"
                  onClick={() => {
                    fetch(`/api/library/${item.id}`, { method: "DELETE" }).then(() => qc.invalidateQueries({ queryKey: ["library"] }));
                  }}
                >
                  <CloseIcon className="w-3.5 h-3.5" />
                </button>
                <h3 className="text-sm font-medium text-fog-100 pr-6 mb-1">{item.title}</h3>
                <p className="text-xs text-fog-400 mb-2">{item.question}</p>
                <p className="ponder-selectable text-xs text-fog-300 line-clamp-4">{item.answer_text.replace(/\[\[|\]\]/g, "")}</p>
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.tags.map((t: string) => (
                      <span key={t} className="text-[10px] bg-ink-700 text-fog-300 rounded-full px-1.5 py-0.5">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- knowledge cards (spec §10) ---- */}
      {tab === "cards" && (
        <>
          {cards.data?.length === 0 && <Empty text="No knowledge cards yet. Use “Save card” on any node to extract its key concept." />}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
            {cards.data?.map((card) => (
              <CardTile key={card.id} card={card} onDeleted={() => qc.invalidateQueries({ queryKey: ["cards"] })} />
            ))}
          </div>
        </>
      )}

      {/* ---- learning sources (spec §12) ---- */}
      {tab === "sources" && (
        <>
          <div className="flex justify-end mb-3 max-w-6xl">
            <AddMaterialButton onAdded={() => qc.invalidateQueries({ queryKey: ["materials"] })} />
          </div>
          {materials.data?.length === 0 && (
            <Empty text="No sources yet. Add study material — paste text or a web link — and ask questions grounded in it." />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
            {materials.data?.map((m) => (
              <div key={m.id} className="node-card p-4 relative">
                <button
                  className="absolute top-2 right-2 btn-ghost"
                  title="Delete source"
                  aria-label="Delete source"
                  onClick={() => delMaterial.mutate(m.id)}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
                <p className="flex items-center gap-1.5 text-xs text-fog-400 mb-1.5">
                  <SourceIcon className="w-3.5 h-3.5" aria-hidden="true" /> {m.kind} · {m.char_count.toLocaleString()} chars
                </p>
                <h3 className="text-sm font-medium text-fog-100 pr-6">{m.title}</h3>
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function CardTile({ card, onDeleted }: { card: { id: string; concept: string; explanation: string; example: string; source: string; due_at: number; times_reviewed: number; notes: string }; onDeleted: () => void }) {
  const [notes, setNotes] = useState(card.notes ?? "");
  const [dirty, setDirty] = useState(false);
  const dueIn = Math.ceil((card.due_at - Date.now()) / 86400000);
  return (
    <div className="node-card p-4 relative">
      <button
        className="absolute top-2 right-2 btn-ghost"
        title="Delete card"
        aria-label="Delete card"
        onClick={() => api.deleteCard(card.id).then(onDeleted)}
      >
        <CloseIcon className="w-3.5 h-3.5" />
      </button>
      <h3 className="text-sm font-medium text-fog-100 pr-6">{card.concept}</h3>
      <p className="text-xs text-fog-300 mt-1.5">{card.explanation}</p>
      {card.example && <p className="text-xs text-fog-400 mt-2 border-l-2 border-spark-500/40 pl-2">{card.example}</p>}
      {card.source && <p className="text-[10px] text-fog-400 mt-2">from {card.source}</p>}
      <p className="text-[10px] text-fog-400 mt-1">
        {card.times_reviewed === 0 ? "not reviewed yet" : `reviewed ${card.times_reviewed}×`} ·{" "}
        {dueIn <= 0 ? <span className="text-spark-400">due now</span> : `due in ${dueIn} day${dueIn === 1 ? "" : "s"}`}
      </p>
      <textarea
        className="input-bar w-full text-xs mt-2"
        rows={2}
        placeholder="Add your note…"
        aria-label="Card note"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (dirty && notes !== card.notes) api.updateCardNotes(card.id, notes);
        }}
      />
    </div>
  );
}

function AddMaterialButton({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-primary !text-xs flex items-center gap-1.5" onClick={() => setOpen(true)}>
        <PlusIcon className="w-3.5 h-3.5" /> Add source
      </button>
      <MaterialDialog open={open} onClose={() => setOpen(false)} onAdded={onAdded} />
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center py-14 max-w-sm mx-auto">
      <p className="text-sm text-fog-300">{text}</p>
    </div>
  );
}
