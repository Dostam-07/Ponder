import { useEffect, useState } from "react";
import type { Exercise, GradeResult } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { CloseIcon, PracticeIcon } from "../ui/Icons";
import { useCanvasStore } from "../../stores/canvasStore";

interface Props {
  nodeId: string;
  title: string;
  onClose: () => void;
}

type Phase = "loading" | "active" | "empty" | "error";

/** Order-steps shuffling (Fisher-Yates, stable for tiny arrays). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Interactive practice for one node (spec §8, §9). Exercises are generated from the
 * node's real material; wrong answers trigger an AI-generated simpler re-explanation.
 */
export function PracticeSheet({ nodeId, title, onClose }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [idx, setIdx] = useState(0);
  const [response, setResponse] = useState<unknown>(null);
  const [shuffledSteps, setShuffledSteps] = useState<string[]>([]);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reinforce, setReinforce] = useState<{ explanation: string; exercise: Exercise | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const ex = exercises[idx];
  const finished = idx >= exercises.length;

  const load = () => {
    setPhase("loading");
    api
      .generatePractice(nodeId, 3)
      .then((r) => {
        if (!r.exercises.length) {
          setPhase("empty");
          return;
        }
        setExercises(r.exercises);
        setIdx(0);
        prep(0, r.exercises);
        setPhase("active");
      })
      .catch((e: Error) => {
        setError(e.message);
        setPhase("error");
      });
  };

  // load once on open
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function prep(i: number, list: Exercise[]) {
    setResponse(null);
    setResult(null);
    setFeedback("");
    setReinforce(null);
    const e = list[i];
    if (e?.type === "order_steps") setShuffledSteps(shuffle(e.steps));
  }

  const canSubmit = (): boolean => {
    if (!ex) return false;
    if (ex.type === "multiple_choice") return typeof response === "number";
    if (ex.type === "fill_blank" || ex.type === "short_answer" || ex.type === "scenario")
      return typeof response === "string" && response.trim().length > 0;
    if (ex.type === "order_steps") return Array.isArray(response) && response.length === ex.steps.length;
    return false;
  };

  const submit = async () => {
    if (!ex || !canSubmit()) return;
    setBusy(true);
    try {
      const attempt = await api.submitPractice({ exercise: ex, response, node_id: nodeId, canvas_id: canvasId });
      setResult(attempt.graded ?? { correct: attempt.correct === true, partial: false, feedback: "", concept: "" });
      setFeedback(attempt.graded?.feedback ?? "");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Grading failed");
    } finally {
      setBusy(false);
    }
  };

  /** Adaptive reinforcement (spec §9): re-teach simply, optionally retry a fresh exercise. */
  const getReinforce = async () => {
    const concept = result?.concept || (ex?.type === "multiple_choice" ? ex.question.slice(0, 60) : title);
    setBusy(true);
    try {
      const r = await api.reinforce(concept);
      setReinforce(r);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Reinforcement failed");
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const i = idx + 1;
    setIdx(i);
    prep(i, exercises);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Practice: ${title}`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative popover-surface w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 animate-pop">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <PracticeIcon className="w-4 h-4 ponder-mark" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-medium text-fog-100">Practice: {title}</h3>
              <p className="text-xs text-fog-400">Generated from what you just learned</p>
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close practice" title="Close">
            <CloseIcon />
          </button>
        </div>

        {phase === "loading" && <p className="status-text">Generating exercises…</p>}

        {phase === "empty" && (
          <div className="text-center py-8">
            <p className="text-sm text-fog-200">Nothing to practice yet.</p>
            <p className="text-xs text-fog-400 mt-1.5">Finish asking about this topic first, then try again.</p>
          </div>
        )}

        {phase === "error" && (
          <div className="text-center py-8">
            <p className="text-sm text-fog-200">Practice generation failed.</p>
            <p className="text-xs text-fog-400 mt-1.5">{error}</p>
            <button className="btn-primary mt-4" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {phase === "active" && ex && (
          <>
            <p className="text-xs text-fog-400 mb-2">
              Exercise {idx + 1} of {exercises.length} · {ex.type.replace("_", " ")}
            </p>

            <p className="text-sm text-fog-100 mb-3">{ex.question}</p>

            {/* ---- response inputs per type ---- */}
            {result === null && (
              <>
                {ex.type === "multiple_choice" && (
                  <div className="space-y-1.5" role="radiogroup" aria-label="Answer options">
                    {ex.options.map((opt, i) => (
                      <button
                        key={i}
                        role="radio"
                        aria-checked={response === i}
                        onClick={() => setResponse(i)}
                        className={`w-full text-left text-sm rounded-lg px-3 py-2 border transition-colors ${
                          response === i ? "border-spark-500 bg-spark-500/10 text-fog-100" : "border-ink-700 text-fog-300 hover:border-ink-600"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {ex.type === "fill_blank" && (
                  <input
                    className="input-bar w-full"
                    aria-label="Fill in the blank"
                    placeholder="Type the missing word…"
                    onChange={(e) => setResponse(e.target.value)}
                  />
                )}

                {ex.type === "short_answer" && (
                  <textarea
                    className="input-bar w-full"
                    rows={3}
                    aria-label="Your answer"
                    placeholder="Explain in your own words…"
                    onChange={(e) => setResponse(e.target.value)}
                  />
                )}

                {ex.type === "scenario" && (
                  <textarea
                    className="input-bar w-full"
                    rows={4}
                    aria-label="What would you do"
                    placeholder="What would you do, and why?"
                    onChange={(e) => setResponse(e.target.value)}
                  />
                )}

                {ex.type === "order_steps" && (
                  <div className="space-y-1.5">
                    {shuffledSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          className="bg-ink-800 border border-ink-600 rounded-lg text-xs text-fog-200 px-2 py-1.5"
                          aria-label={`Position for step ${i + 1}`}
                          value={typeof (response as number[] | null)?.[i] === "number" ? (response as number[])[i] : ""}
                          onChange={(e) => {
                            const arr = [...((response as number[] | null) ?? [])];
                            arr[i] = Number(e.target.value);
                            setResponse(arr);
                          }}
                        >
                          <option value="" disabled>
                            —
                          </option>
                          {ex.steps.map((_, pos) => (
                            <option key={pos} value={pos}>
                              {pos + 1}
                            </option>
                          ))}
                        </select>
                        <span className="text-sm text-fog-300">{step}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end mt-4">
                  <button className="btn-primary" disabled={!canSubmit() || busy} onClick={() => void submit()}>
                    {busy ? "Checking…" : "Check answer"}
                  </button>
                </div>
              </>
            )}

            {/* ---- graded feedback (spec §9: teach, don't just mark) ---- */}
            {result !== null && (
              <div>
                <p className={`text-sm font-medium ${result.correct ? "text-emerald-400" : result.partial ? "text-star-500" : "text-red-400"}`}>
                  {result.correct ? "Correct" : result.partial ? "Partly right" : "Not quite"}
                </p>
                {(feedback || result.feedback) && <p className="text-sm text-fog-200 mt-1.5">{feedback || result.feedback}</p>}
                <p className="text-xs text-fog-400 mt-2">
                  <span className="font-medium text-fog-300">Model answer:</span>{" "}
                  {ex.type === "multiple_choice" ? ex.options[ex.correct_index] : ex.type === "order_steps" ? ex.steps.join(" → ") : ex.answer}
                </p>

                {/* adaptive reinforcement after a miss */}
                {!result.correct && !reinforce && (
                  <button className="btn-primary mt-3 !text-xs" disabled={busy} onClick={() => void getReinforce()}>
                    {busy ? "Preparing…" : "Help me understand this"}
                  </button>
                )}
                {reinforce && (
                  <div className="mt-3 border-l-2 border-spark-500/60 pl-3">
                    <p className="text-xs font-semibold text-fog-100 uppercase tracking-wide">Simpler take</p>
                    <p className="text-sm text-fog-200 mt-1">{reinforce.explanation}</p>
                    {reinforce.exercise && (
                      <p className="text-xs text-fog-400 mt-2">
                        Fresh exercise available on your next practice round for this concept.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-end mt-4">
                  {idx + 1 < exercises.length ? (
                    <button className="btn-primary" onClick={next}>
                      Next exercise
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={onClose}>
                      Done
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
