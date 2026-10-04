import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NodeEntity, KnowledgeCard } from "@canvas-learn/shared";
import { api } from "../lib/api";
import { parseAnswerSegments } from "../lib/termparser";
import { VisualRenderer } from "../components/visuals/VisualRenderer";

export function ReviewPage() {
  const qc = useQueryClient();
  const dueCards = useQuery({ queryKey: ["dueCards"], queryFn: api.dueCards });
  const dueNodes = useQuery({ queryKey: ["due"], queryFn: api.dueNodes });
  const weak = useQuery({ queryKey: ["weak"], queryFn: () => fetch("/api/practice/weak").then((r) => r.json()) as Promise<{ concept: string; misses: number }[]> });
  const dueConcepts = useQuery({ queryKey: ["reviewConcepts"], queryFn: api.reviewConcepts });
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);

  const cards: KnowledgeCard[] = dueCards.data ?? [];
  const nodes: NodeEntity[] = dueNodes.data ?? [];
  const card = cards[index];
  // card flow first; node review afterwards (both real data sources)
  const nodeFlow = index >= cards.length;
  const node = nodes[index - cards.length];

  useEffect(() => {
    setRevealed(false);
  }, [index]);

  const finish = useCallback(() => {
    setDone((d) => d + 1);
    setIndex((i) => i + 1);
    qc.invalidateQueries({ queryKey: ["dueCards"] });
    qc.invalidateQueries({ queryKey: ["due"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }, [qc]);

  const gradeCard = useCallback(
    async (correct: boolean) => {
      if (!card) return;
      await api.reviewCard(card.id, correct);
      finish();
    },
    [card, finish],
  );

  const gradeNode = useCallback(
    async (g: "again" | "hard" | "good" | "easy") => {
      if (!node) return;
      await api.gradeReview(node.id, g);
      finish();
    },
    [node, finish],
  );

  if (dueCards.isLoading || dueNodes.isLoading) return <Centered>Loading due reviews…</Centered>;

  const weakList = (weak.data ?? []).filter((w) => w.misses >= 2).slice(0, 3);

  if (!card && !node) {
    return (
      <Centered>
        <div className="text-center max-w-md px-6">
          <h2 className="text-lg font-medium text-fog-100 mb-2">
            {done > 0 ? `Reviewed ${done} card${done === 1 ? "" : "s"} — nice work.` : "Nothing due right now."}
          </h2>
          <p className="text-fog-400 text-sm">
            {done > 0
              ? "Cards return on a spaced schedule — the ones you know less often, the ones you miss sooner."
              : "Concepts you save as Knowledge Cards come back here for review over time."}
          </p>
          {weakList.length > 0 && (
            <div className="mt-5 text-left node-card p-4">
              <p className="text-xs font-semibold text-fog-100 uppercase tracking-wide mb-2">Needs reinforcement</p>
              {weakList.map((w) => (
                <p key={w.concept} className="text-sm text-fog-300 py-0.5">
                  {w.concept} <span className="text-fog-500 text-xs">· missed {w.misses}×</span>
                </p>
              ))}
              <p className="text-[11px] text-fog-400 mt-2">Practice these again from the node where they came up.</p>
            </div>
          )}
          {dueConcepts.data && dueConcepts.data.concepts.length > 0 && (
            <div className="mt-4 text-left node-card p-4">
              <p className="text-xs font-semibold text-fog-100 uppercase tracking-wide mb-2">Concepts due for review</p>
              {dueConcepts.data.concepts.slice(0, 6).map((c) => (
                <p key={c.concept} className="text-sm text-fog-300 py-0.5">
                  {c.concept} <span className="text-fog-500 text-xs">· reviewed {c.times_reviewed}×</span>
                </p>
              ))}
              <p className="text-[11px] text-fog-400 mt-2">Pulled back by FSRS because you missed these on exams or recall — go deeper and they reschedule.</p>
            </div>
          )}
        </div>
      </Centered>
    );
  }

  // ---- knowledge-card review (spec §10) ----
  if (!nodeFlow && card) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 dot-grid">
        <p className="text-xs text-fog-400 mb-2">
          Knowledge card {index + 1} of {cards.length}
        </p>
        <div className="node-card w-full max-w-xl p-5 min-h-[280px] flex flex-col">
          <h2 className="text-base font-semibold text-fog-100 mb-1">{card.concept}</h2>
          {card.source && <p className="text-[11px] text-fog-400 mb-3">from {card.source}</p>}
          {revealed ? (
            <div className="text-sm text-fog-200 space-y-2 overflow-y-auto">
              <p>{card.explanation}</p>
              {card.example && (
                <p className="text-fog-300 border-l-2 border-spark-500/50 pl-2">
                  <span className="text-xs uppercase tracking-wide text-fog-400 block">Example</span>
                  {card.example}
                </p>
              )}
              {card.notes && (
                <p className="text-fog-300 border-l-2 border-ink-600 pl-2">
                  <span className="text-xs uppercase tracking-wide text-fog-400 block">Your note</span>
                  {card.notes}
                </p>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <button className="btn-primary" onClick={() => setRevealed(true)}>
                Reveal
              </button>
            </div>
          )}
        </div>
        {revealed && (
          <div className="flex gap-2 mt-4">
            <GradeButton label="Still learning" className="hover:!text-red-400" onClick={() => void gradeCard(false)} />
            <GradeButton label="I know this" onClick={() => void gradeCard(true)} />
          </div>
        )}
      </div>
    );
  }

  // ---- legacy node review (FSRS flashcards from saved conversations) ----
  if (!node) return null;
  const segments = revealed ? parseAnswerSegments(node.answer_text) : [];
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 dot-grid">
      <p className="text-xs text-fog-400 mb-2">
        Card {index + 1} of {cards.length + nodes.length} · {node.title || node.question.slice(0, 40)}
      </p>
      <div className="node-card w-full max-w-xl p-5 min-h-[280px] flex flex-col">
        <div className="flex justify-end mb-3">
          <span className="question-bubble max-w-[85%]">{node.question}</span>
        </div>
        {revealed ? (
          <div className="ponder-selectable text-sm text-fog-200 space-y-1.5 overflow-y-auto max-h-64">
            {segments.map((seg, i) =>
              seg.kind === "text" ? <span key={i}>{seg.text}</span> : <span key={i} className="term-chip">{seg.term}</span>,
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <button className="btn-primary" onClick={() => setRevealed(true)}>
              Reveal answer
            </button>
          </div>
        )}
        {revealed && node.visual && <div className="mt-3 border-t border-ink-700 pt-2"><VisualRenderer visual={node.visual} /></div>}
      </div>
      {revealed && (
        <div className="flex gap-2 mt-4">
          <GradeButton label="Again" className="hover:!text-red-400" onClick={() => void gradeNode("again")} />
          <GradeButton label="Hard" onClick={() => void gradeNode("hard")} />
          <GradeButton label="Good" onClick={() => void gradeNode("good")} />
          <GradeButton label="Easy" onClick={() => void gradeNode("easy")} />
        </div>
      )}
    </div>
  );
}

function GradeButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      className={`bg-ink-800 border border-ink-600 hover:border-spark-500 text-fog-200 text-sm rounded-lg px-4 py-2 transition-colors ${className ?? ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center">{children}</div>;
}
