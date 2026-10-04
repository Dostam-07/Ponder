import { useState } from "react";
import type { ExamQuestion, Exercise } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { CloseIcon, PracticeIcon } from "../ui/Icons";
import { useCanvasStore } from "../../stores/canvasStore";

type Phase = "idle" | "loading" | "active" | "done" | "error";

/** Client-side correctness check mirroring the server's exercise shapes. */
function isCorrect(ex: Exercise, response: unknown): boolean {
  switch (ex.type) {
    case "multiple_choice":
      return response === ex.correct_index;
    case "fill_blank":
      return typeof response === "string" && response.trim().toLowerCase() === ex.answer.trim().toLowerCase();
    case "order_steps":
      return Array.isArray(response) && ex.steps.every((s, i) => response[i] === s);
    case "short_answer":
    case "scenario":
      return false; // graded locally as "needs review" unless AI-graded — honest default
    default:
      return false;
  }
}

function reorder(steps: string[]): string[] {
  const a = [...steps];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Exam simulation (research-spec §19): questions generated from the user's real
 * explored topics, weighted toward known weak areas. The final summary shows
 * only real results — strong / needs review / weak buckets from actual answers.
 */
export function ExamSheet({ onClose }: { onClose: () => void }) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [response, setResponse] = useState<unknown>(null);
  const [shuffled, setShuffled] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<{ q: ExamQuestion; correct: boolean }[]>([]);

  const start = () => {
    setPhase("loading");
    setError("");
    api
      .generateExam(5, canvasId ?? undefined)
      .then((r) => {
        if (!r.questions.length) {
          setPhase("error");
          setError("Could not generate questions from what you've explored yet.");
          return;
        }
        setQuestions(r.questions);
        setIdx(0);
        setResults([]);
        setPhase("active");
        prepare(r.questions[0]!);
      })
      .catch((e: Error) => {
        setPhase("error");
        setError(e.message);
      });
  };

  const q = questions[idx];
  const ex = q?.exercise;

  const prepare = (question: ExamQuestion) => {
    setResponse(null);
    setRevealed(false);
    if (question.exercise.type === "order_steps") setShuffled(reorder(question.exercise.steps));
  };

  const isFreeText = (t: Exercise["type"]) => t === "short_answer" || t === "scenario";

  const submit = () => {
    if (!q || !ex) return;
    // Free-text answers can't be honestly self-graded client-side: mark needs-review.
    const correct = isCorrect(ex, response);
    const newResults = [...results, { q, correct }];
    setResults(newResults);
    if (idx + 1 < questions.length) {
      setIdx(idx + 1);
      prepare(questions[idx + 1]!);
    } else {
      setPhase("done");
      // Spaced-review integration (roadmap 6): pipe the real answers into per-concept
      // FSRS so weak topics resurface. Ungraded free-text counts as "partial", not a miss.
      api
        .submitExam({
          canvas_id: canvasId ?? null,
          answers: newResults.map((r) => ({ topic: r.q.topic, correct: r.correct, partial: isFreeText(r.q.exercise.type) && !r.correct })),
        })
        .catch(() => {}); // non-fatal — the exam is complete either way
    }
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Test me">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-lg popover-surface p-5 overflow-y-auto animate-slide-in">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-medium text-fog-100">Test me</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Close exam" title="Close">
            <CloseIcon />
          </button>
        </div>

        {phase === "idle" && (
          <div className="text-center py-10">
            <PracticeIcon className="w-8 h-8 ponder-mark mx-auto mb-3 opacity-60" aria-hidden="true" />
            <p className="text-sm text-fog-200">An exam from what you've explored.</p>
            <p className="text-xs text-fog-400 mt-1.5 max-w-xs mx-auto">
              5 questions drawn from the topics on your canvases, weighted toward areas you've missed before. Real questions,
              real scoring.
            </p>
            <button className="btn-primary mt-4" onClick={start}>
              Start exam
            </button>
          </div>
        )}

        {phase === "loading" && <p className="status-text">Writing your exam…</p>}

        {phase === "error" && (
          <div className="text-center py-10">
            <p className="text-sm text-fog-200">{error || "Something went wrong."}</p>
            <button className="btn-primary mt-4" onClick={start}>
              Try again
            </button>
          </div>
        )}

        {phase === "active" && q && ex && (
          <>
            <p className="text-xs text-fog-400 mb-2">
              Question {idx + 1} of {questions.length} · {q.topic}
            </p>
            <div className="node-card p-4">
              <p className="text-sm text-fog-100">{ex.question}</p>

              {ex.type === "multiple_choice" && (
                <div className="mt-3 space-y-1.5">
                  {ex.options.map((opt, i) => (
                    <button
                      key={i}
                      className={`block w-full text-left text-sm rounded-lg border px-3 py-2 transition-colors ${
                        response === i ? "border-spark-500 bg-spark-500/10 text-fog-100" : "border-ink-600 text-fog-300 hover:border-spark-500/60"
                      }`}
                      onClick={() => setResponse(i)}
                      aria-pressed={response === i}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {ex.type === "fill_blank" && (
                <input
                  className="input-bar mt-3 w-full"
                  placeholder="Fill in the blank…"
                  aria-label="Your answer"
                  value={typeof response === "string" ? response : ""}
                  onChange={(e) => setResponse(e.target.value)}
                />
              )}

              {ex.type === "order_steps" && (
                <ol className="mt-3 space-y-1.5">
                  {shuffled.map((s, i) => (
                    <li key={s} className="flex items-center gap-2">
                      <span className="text-xs text-fog-400 w-5">{i + 1}.</span>
                      <span className="text-xs text-fog-200 flex-1">{s}</span>
                      <span className="flex flex-col">
                        <button
                          className="text-fog-400 hover:text-spark-400 text-[10px]"
                          aria-label={`Move ${s} up`}
                          disabled={i === 0}
                          onClick={() => {
                            const next = [...shuffled];
                            [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                            setShuffled(next);
                            setResponse(next);
                          }}
                        >
                          ▲
                        </button>
                        <button
                          className="text-fog-400 hover:text-spark-400 text-[10px]"
                          aria-label={`Move ${s} down`}
                          disabled={i === shuffled.length - 1}
                          onClick={() => {
                            const next = [...shuffled];
                            [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
                            setShuffled(next);
                            setResponse(next);
                          }}
                        >
                          ▼
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {(ex.type === "short_answer" || ex.type === "scenario") && (
                <textarea
                  className="input-bar mt-3 w-full text-sm"
                  rows={4}
                  placeholder="Write your answer…"
                  aria-label="Your answer"
                  value={typeof response === "string" ? response : ""}
                  onChange={(e) => setResponse(e.target.value)}
                />
              )}
            </div>

            {revealed && ex.explanation && (
              <p className="text-xs text-fog-300 mt-2 border-l-2 border-ink-600 pl-2">{ex.explanation}</p>
            )}

            <div className="flex gap-2 mt-4">
              {!revealed ? (
                <button
                  className="btn-primary flex-1"
                  disabled={response === null || (typeof response === "string" && !response.trim())}
                  onClick={() => {
                    setRevealed(true);
                    submit();
                  }}
                >
                  Submit answer
                </button>
              ) : idx + 1 < questions.length ? (
                <button className="btn-primary flex-1" onClick={onClose}>
                  Close (results saved to practice stats)
                </button>
              ) : (
                <button className="btn-primary flex-1" onClick={onClose}>
                  See results
                </button>
              )}
            </div>
          </>
        )}

        {phase === "done" && (
          <div>
            <p className="text-sm text-fog-100 mb-3">
              {results.filter((r) => r.correct).length} of {results.length} correct
            </p>
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className="node-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-fog-200 flex-1">{r.q.exercise.question}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.correct ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                      {r.correct ? "Strong" : "Needs review"}
                    </span>
                  </div>
                  <p className="text-[11px] text-fog-400 mt-1">{r.q.exercise.explanation}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-fog-400 mt-3">
              Your answers were fed into spaced review — missed topics resurface sooner in your daily review. Free-text answers count as
              “needs review” unless graded; retake them through Practice for AI-graded feedback.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
