import { useMemo, useState } from "react";
import { CloseIcon, PlusIcon, TrashIcon } from "../ui/Icons";
import { useCanvasStore } from "../../stores/canvasStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** One item on the evidence board (thinking-spec §9). */
interface Entry {
  id: string;
  kind: "claim" | "for" | "against" | "question" | "conclusion";
  text: string;
}

const KIND_LABEL: Record<Entry["kind"], string> = {
  claim: "Claim",
  for: "Evidence for",
  against: "Evidence against",
  question: "Open question",
  conclusion: "Conclusion",
};

const KIND_ORDER: Entry["kind"][] = ["claim", "for", "against", "question", "conclusion"];

const KIND_CLASS: Record<Entry["kind"], string> = {
  claim: "border-spark-500/40 bg-spark-500/5",
  for: "border-emerald-500/30 bg-emerald-500/5",
  against: "border-red-400/30 bg-red-400/5",
  question: "border-ink-600 bg-ink-800/40",
  conclusion: "border-star-500/40 bg-star-500/5",
};

/**
 * Evidence Board (thinking-spec §9): a per-canvas thinking surface for claims,
 * supporting/contradicting evidence, open questions and conclusions. Entries are
 * authored by the user from real canvas content (insert from node, or write your own)
 * and persist with the canvas via PATCH app state — stored per canvas in app_state.
 */
export function EvidenceBoard({ open, onClose }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const nodes = useCanvasStore((s) => s.nodes);
  const order = useCanvasStore((s) => s.order);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<Entry["kind"]>("claim");
  const [draftText, setDraftText] = useState("");
  const [insertOpen, setInsertOpen] = useState(false);

  const storageKey = canvasId ? `board:${canvasId}` : null;

  // Load once per canvas (localStorage: user-authored thinking, client-side by design).
  if (storageKey && loaded !== storageKey) {
    setLoaded(storageKey);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setEntries(JSON.parse(raw) as Entry[]);
    } catch {
      // corrupt storage → start clean
    }
  }

  const persist = (next: Entry[]) => {
    setEntries(next);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const addDraft = () => {
    const text = draftText.trim();
    if (!text) return;
    persist([...entries, { id: crypto.randomUUID(), kind: draftKind, text }]);
    setDraftText("");
  };

  const insertFromNode = (nodeId: string) => {
    const n = nodes[nodeId];
    if (!n) return;
    persist([...entries, { id: crypto.randomUUID(), kind: "claim", text: `${n.title || n.question}: ${n.answer_text.slice(0, 200)}` }]);
    setInsertOpen(false);
  };

  const completed = useMemo(() => order.map((id) => nodes[id]).filter((n) => n && n.status === "complete"), [order, nodes]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Evidence board">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-lg popover-surface p-5 overflow-y-auto animate-slide-in">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-medium text-fog-100">Evidence board</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close evidence board" title="Close">
            <CloseIcon />
          </button>
        </div>
        <p className="text-xs text-fog-400 mb-4">
          Collect claims, weigh evidence for and against, and track what would settle the question. Saved with this canvas.
        </p>

        {/* add entry */}
        <div className="flex gap-1.5 mb-3">
          <label className="sr-only" htmlFor="board-kind">Entry type</label>
          <select
            id="board-kind"
            className="input-bar !py-1.5 !text-xs w-36"
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as Entry["kind"])}
          >
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <input
            className="input-bar flex-1 !py-1.5 !text-xs"
            placeholder={draftKind === "question" ? "What would settle this?" : "Write the claim, evidence, or conclusion…"}
            aria-label="Entry text"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDraft()}
          />
          <button className="btn-primary !px-2.5" onClick={addDraft} disabled={!draftText.trim()} title="Add to the board" aria-label="Add entry">
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* insert from canvas */}
        <div className="relative mb-4">
          <button
            className="text-xs text-fog-400 hover:text-spark-400 transition-colors"
            onClick={() => setInsertOpen((v) => !v)}
            aria-expanded={insertOpen}
            aria-haspopup="dialog"
          >
            + Insert a claim from this canvas…
          </button>
          {insertOpen && (
            <div className="absolute z-10 mt-1 w-72 popover-surface p-2 max-h-56 overflow-y-auto" role="dialog" aria-label="Insert from canvas">
              {completed.length === 0 ? (
                <p className="text-xs text-fog-400 p-2">Nothing explored on this canvas yet.</p>
              ) : (
                completed.map((n) => (
                  <button
                    key={n!.id}
                    className="block w-full text-left text-xs text-fog-300 hover:text-spark-400 hover:bg-ink-700/40 rounded-md px-2 py-1.5 truncate transition-colors"
                    title={n!.question}
                    onClick={() => insertFromNode(n!.id)}
                  >
                    {n!.title || n!.question}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* the board */}
        {entries.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-fog-200">Collect claims and sources while you research.</p>
            <p className="text-xs text-fog-400 mt-1.5 max-w-xs mx-auto">
              Add a claim, weigh evidence for and against it, and write down the question that would settle it.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {KIND_ORDER.map((kind) => {
              const items = entries.filter((e) => e.kind === kind);
              if (!items.length) return null;
              return (
                <section key={kind}>
                  <h3 className="text-[10px] uppercase tracking-wider text-fog-400 mb-1.5">{KIND_LABEL[kind]}</h3>
                  <ul className="space-y-1.5">
                    {items.map((e) => (
                      <li key={e.id} className={`group flex items-start gap-2 border rounded-lg px-3 py-2 ${KIND_CLASS[e.kind]}`}>
                        <p className="flex-1 text-xs text-fog-200 leading-relaxed">{e.text}</p>
                        <button
                          className="btn-ghost opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          onClick={() => persist(entries.filter((x) => x.id !== e.id))}
                          title="Remove from board"
                          aria-label={`Remove ${KIND_LABEL[e.kind]} entry`}
                        >
                          <TrashIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}
