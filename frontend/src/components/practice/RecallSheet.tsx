import { useState } from "react";
import { api } from "../../lib/api";
import { CloseIcon } from "../ui/Icons";

interface Props {
  nodeId: string;
  title: string;
  onClose: () => void;
}

type Result = {
  understanding: "strong" | "partial" | "weak";
  missing: string[];
  misconception: string;
  feedback: string;
};

/**
 * Active recall (research-spec §15): "Can you explain it without looking?" The
 * learner writes their explanation from memory; Ponder grades it against the real
 * source material — correctness, missing pieces, misconceptions — with targeted
 * feedback. No fabricated praise.
 */
export function RecallSheet({ nodeId, title, onClose }: Props) {
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const submit = () => {
    const text = explanation.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    api
      .submitRecall(nodeId, text)
      .then((r) => setResult(r))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const badge =
    result?.understanding === "strong"
      ? { cls: "bg-emerald-500/20 text-emerald-400", label: "Strong recall" }
      : result?.understanding === "partial"
        ? { cls: "bg-amber-500/20 text-amber-400", label: "Partial — some gaps" }
        : { cls: "bg-red-400/20 text-red-400", label: "Worth another look" };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Active recall">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-lg popover-surface p-5 overflow-y-auto animate-slide-in">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-medium text-fog-100">Can you explain it without looking?</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close recall" title="Close">
            <CloseIcon />
          </button>
        </div>
        <p className="text-xs text-fog-400 mb-3">
          Explain “{title}” in your own words, from memory. Ponder compares it with what you actually studied and tells you
          what's missing.
        </p>

        {!result && (
          <>
            <textarea
              className="input-bar w-full text-sm"
              rows={7}
              placeholder="Write your explanation from memory…"
              aria-label="Your explanation from memory"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              disabled={busy}
            />
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            <button className="btn-primary mt-3 w-full" disabled={!explanation.trim() || busy} onClick={submit}>
              {busy ? "Checking against what you learned…" : "Check my recall"}
            </button>
          </>
        )}

        {result && (
          <div>
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
            <p className="text-sm text-fog-200 mt-3 leading-relaxed">{result.feedback}</p>
            {result.missing.length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">You left out</p>
                <ul className="space-y-1">
                  {result.missing.map((m, i) => (
                    <li key={i} className="text-xs text-fog-300">
                      · {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.misconception && (
              <div className="mt-3 node-card p-3 border-red-400/30">
                <p className="text-[10px] uppercase tracking-wider text-red-400 mb-1">Misconception to watch</p>
                <p className="text-xs text-fog-200">{result.misconception}</p>
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button
                className="btn-ghost border border-ink-600 rounded-lg text-xs px-3 py-1.5"
                onClick={() => {
                  setResult(null);
                  setExplanation("");
                }}
              >
                Try again
              </button>
              <button className="btn-primary flex-1" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
