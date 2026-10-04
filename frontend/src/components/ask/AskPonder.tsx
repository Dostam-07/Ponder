import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloseIcon, SparkleIcon } from "../ui/Icons";
import { VoiceInputButton } from "../ui/VoiceInputButton";

export interface SelectionAnchor {
  /** Selected text, already trimmed. */
  text: string;
  /** Viewport rect of the selection — used to position the panel without layout shift. */
  rect: { top: number; bottom: number; left: number; right: number };
  /** Node whose content was selected (branch target when a canvas is open). */
  nodeId: string;
}

export interface AskOptions {
  explainLike?: string;
  compare?: boolean;
  /** Thinking mode for this ask (thinking-spec §2, research-spec §7). */
  mode?: "explain" | "explore" | "challenge" | "compare" | "debate" | "apply" | "create" | "practice" | "research" | "socratic";
}

const ACTIONS: { label: string; title: string; build: (quote: string) => string; mode?: AskOptions["mode"] }[] = [
  { label: "Explain this", title: "A clearer explanation of the selection", build: (q) => `Explain this: "${q}"` },
  { label: "Why?", title: "The mechanism behind this — drill one level down", build: (q) => `Why is this true? Explain the mechanism behind: "${q}"` },
  { label: "Challenge this", title: "Hidden assumptions and counterexamples", build: (q) => `Challenge this: "${q}" — surface hidden assumptions, missing evidence, and one alternative explanation`, mode: "challenge" },
  { label: "Simplify this", title: "The same idea, much simpler", build: (q) => `Simplify this as much as possible: "${q}"` },
  { label: "Give me an example", title: "A concrete example", build: (q) => `Give me a concrete example of this: "${q}"` },
  { label: "Why does this matter?", title: "Why the idea matters", build: (q) => `Why does this matter? "${q}"` },
  { label: "Connect this to what I'm learning", title: "Relate it to the conversation so far", build: (q) => `How does this connect to what I've been learning? "${q}"` },
  { label: "Quiz me on this", title: "Test your understanding", build: (q) => `Quiz me on this: "${q}"` },
  { label: "Go deeper", title: "One layer deeper", build: (q) => `Go deeper on this: "${q}"` },
];

/** Explain-it-like styles (spec §17) — each becomes a real prompt directive. */
const LIKE_STYLES: { label: string; directive: string }[] = [
  { label: "Like I'm 12", directive: "explain like I'm 12 years old" },
  { label: "Analogy", directive: "explain using a vivid analogy" },
  { label: "Visually", directive: "explain visually, so it could be drawn" },
  { label: "Mathematically", directive: "explain mathematically" },
  { label: "Real-world", directive: "explain with a real-world example" },
  { label: "For an exam", directive: "explain for an exam" },
];

const QUICK_QUESTIONS = [
  "Explain this",
  "Why?",
  "Give me an example",
  "Simplify this",
  "Quiz me on this",
  "How does this connect to what I was reading?",
];

interface Props {
  anchor: SelectionAnchor | null;
  onSubmit: (question: string, opts?: AskOptions) => void;
  onDismiss: () => void;
}

/**
 * Floating "Ask Ponder" panel for text selections. Appears near the selection, stays
 * inside the viewport, closes on Esc / outside click / clear button. The selected text
 * is sent to the real pipeline as grounding context; every action is a real request.
 */
export function AskPonder({ anchor, onSubmit, onDismiss }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position near the selection, clamped to the viewport; recompute on scroll/resize.
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const W = Math.min(340, window.innerWidth - 16);
      const H = 300;
      const margin = 8;
      const a = anchor.rect;
      // centered on the selection midpoint, clamped to the viewport
      let left = (a.left + a.right) / 2 - W / 2;
      left = Math.min(Math.max(left, margin), window.innerWidth - W - margin);
      // prefer below the selection; flip above if it would overflow
      let top = a.bottom + 8;
      if (top + H > window.innerHeight - margin) top = a.top - H - 8;
      top = Math.max(top, margin);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Focus the input on open; Escape closes.
  useEffect(() => {
    if (!anchor) {
      setQuestion("");
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  if (!anchor || !pos) return null;

  const quote = anchor.text.length > 140 ? `${anchor.text.slice(0, 140)}…` : anchor.text;

  const submit = (q: string, opts?: AskOptions) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    onSubmit(trimmed, opts);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Ask Ponder about the selected text"
      className="fixed z-50 popover-surface p-3 animate-pop"
      style={{ top: pos.top, left: pos.left, width: 340 }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-fog-100 flex items-center gap-1.5">
          <SparkleIcon className="w-4 h-4 ponder-mark" aria-hidden="true" />
          Ask Ponder
        </p>
        <button className="btn-ghost shrink-0" title="Close" aria-label="Close" onClick={onDismiss}>
          <CloseIcon />
        </button>
      </div>

      <blockquote className="mt-2 text-xs text-fog-300 border-l-2 border-ink-600 pl-2 line-clamp-3">“{quote}”</blockquote>

      <p className="text-xs text-fog-400 mt-2">What would you like to know about this?</p>

      <form
        className="mt-1.5 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <input
          ref={inputRef}
          className="input-bar flex-1 !py-1.5"
          placeholder="Ask about the selected text…"
          aria-label="Your question about the selected text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <VoiceInputButton
          onTranscript={(text) => setQuestion((q) => (q.trim() ? `${q.trim()} ${text.trim()}` : text.trim()))}
        />
        <button type="submit" className="btn-primary !px-2.5 !py-1.5" disabled={!question.trim()} title="Ask Ponder">
          Ask
        </button>
      </form>

      {/* quick learning actions (spec §7) */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            className="text-xs text-fog-300 border border-ink-700 hover:border-spark-500 hover:text-fog-100 rounded-full px-2 py-0.5 transition-colors"
            onClick={() => submit(a.build(anchor.text), a.mode ? { mode: a.mode } : undefined)}
            title={a.title}
          >
            {a.label}
          </button>
        ))}
        {/* compare prefill (spec §16) */}
        <button
          className="text-xs text-fog-300 border border-ink-700 hover:border-spark-500 hover:text-fog-100 rounded-full px-2 py-0.5 transition-colors"
          onClick={() => {
            setQuestion(`Compare this with `);
            inputRef.current?.focus();
          }}
          title="Compare the selection with another idea — type the other idea and ask"
        >
          Compare this with…
        </button>
      </div>

      {/* explain-it-like styles (spec §17) — real prompt directives for this ask */}
      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-ink-700/70">
        {LIKE_STYLES.map((s) => (
          <button
            key={s.label}
            className="text-[11px] text-fog-400 hover:text-spark-400 rounded-full px-1.5 py-0.5 hover:bg-ink-700 transition-colors"
            onClick={() =>
              submit(
                question.trim() || `Explain this: "${anchor.text}"`,
                { explainLike: s.directive },
              )
            }
            title={`Ask with this style: ${s.directive}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* plain quick questions kept minimal — the actions above cover most intents */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {QUICK_QUESTIONS.filter((q) => q === "How does this connect to what I was reading?").map((q) => (
          <button
            key={q}
            className="text-xs text-fog-300 border border-ink-700 hover:border-spark-500 hover:text-fog-100 rounded-full px-2 py-0.5 transition-colors"
            onClick={() => submit(q)}
            title={`Ask Ponder: ${q}`}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
