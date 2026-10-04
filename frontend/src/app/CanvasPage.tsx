import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type { AskRequest, NodeEntity } from "@canvas-learn/shared";
import { conceptExplainQuestion, conceptVisualizeQuestion, findConceptNode } from "../lib/concepts";
import { CanvasStage } from "../components/canvas/CanvasStage";
import { CanvasProvider } from "../components/canvas/CanvasContext";
import { GlobalPromptBar } from "../components/canvas/GlobalPromptBar";
import { CanvasHeader } from "../components/canvas/CanvasHeader";
import { PathPanel } from "../components/learning/PathPanel";
import { ProfilePopover } from "../components/learning/ProfilePopover";
import { ThinkingMapPanel } from "../components/thinking/ThinkingMapPanel";
import { EvidenceBoard } from "../components/thinking/EvidenceBoard";
import { KnowledgeGraphPanel } from "../components/thinking/KnowledgeGraphPanel";
import { SourcesPanel } from "../components/thinking/SourcesPanel";
import { ArtifactsPanel } from "../components/thinking/ArtifactsPanel";
import { ExamSheet } from "../components/practice/ExamSheet";
import { PracticeSheet } from "../components/practice/PracticeSheet";
import { useHashRoute } from "../hooks/useHashRoute";
import { useSpeechStore } from "../hooks/useSpeech";
import { usePrefs } from "../hooks/usePrefs";
import { useCanvasStore } from "../stores/canvasStore";
import { api } from "../lib/api";

interface Props {
  canvasId: string;
  onAsk: (req: Omit<AskRequest, "canvas_id">) => void;
  askBusy: boolean;
  onSummarize: () => void;
  /** Refetch the graph into the store (used after path sections create nodes server-side). */
  onGraphChanged?: () => void;
}

export function CanvasPage({ canvasId, onAsk, askBusy, onSummarize, onGraphChanged }: Props) {
  const [pathOpen, setPathOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, navigate] = useHashRoute();
  const canvasTitle = useCanvasStore((s) => s.canvasTitle);
  const requestFocus = useCanvasStore((s) => s.requestFocus);
  const nodes = useCanvasStore((s) => s.nodes);
  // Concept chips (roadmap 3): practice sheet opened for a concept's node, and the
  // concept we're waiting for an explain-answer to complete before practice unlocks.
  const [conceptPractice, setConceptPractice] = useState<{ nodeId: string; title: string } | null>(null);
  const [pendingPractice, setPendingPractice] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const allNodes = useMemo(() => Object.values(nodes), [nodes]);

  // Audio recap (roadmap 5): generate a short spoken summary of this canvas, then read it aloud.
  const speech = useSpeechStore();
  const { audio } = usePrefs();
  const [recapBusy, setRecapBusy] = useState(false);
  const recapSpeaking = speech.supported && speech.state !== "idle" && speech.activeId === `recap:${canvasId}`;
  const playRecap = useCallback(async () => {
    if (!speech.supported) {
      showToast("Audio isn't supported in this browser");
      return;
    }
    if (recapSpeaking) {
      // currently speaking the recap → toggle pause/resume
      speech.toggle({ id: `recap:${canvasId}`, text: "", volume: audio.volume, rate: audio.rate });
      return;
    }
    setRecapBusy(true);
    showToast("Writing your recap…");
    try {
      const { text } = await api.recap(canvasId);
      speech.speak({ id: `recap:${canvasId}`, text, volume: audio.voiceResponses ? audio.volume : 0, rate: audio.rate });
      showToast("Playing your recap");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't make a recap");
    } finally {
      setRecapBusy(false);
    }
  }, [canvasId, speech, audio, recapSpeaking, showToast]);


  // New canvas → drop any in-flight concept-practice wait (the store resets too).
  useEffect(() => {
    setConceptPractice(null);
    setPendingPractice(null);
  }, [canvasId]);

  // When a concept explain-answer lands (status complete), open practice for it.
  useEffect(() => {
    if (!pendingPractice) return;
    const match = findConceptNode(allNodes, pendingPractice);
    if (match) {
      setConceptPractice({ nodeId: match.id, title: pendingPractice });
      setPendingPractice(null);
    }
  }, [allNodes, pendingPractice]);

  /** Ask a grounded, source-bound question as a new thread on THIS canvas. */
  const askConcept = useCallback(
    (question: string, materialId: string) => {
      onAsk({
        parent_id: null,
        branch_origin: "thread",
        question,
        position: { x: 0, y: 0 },
        model_speed: "fast",
        web_search: false,
        material_id: materialId,
      });
    },
    [onAsk],
  );

  /** Concept-chip actions — every one creates or targets a REAL canvas node. */
  const conceptActions = useMemo(
    () => ({
      explain: (concept: string, materialId: string, materialTitle: string) => {
        setSourcesOpen(false);
        askConcept(conceptExplainQuestion(concept, materialTitle), materialId);
      },
      visualize: (concept: string, materialId: string, materialTitle: string) => {
        setSourcesOpen(false);
        askConcept(conceptVisualizeQuestion(concept, materialTitle), materialId);
      },
      practice: (concept: string, materialId: string, materialTitle: string) => {
        const match = findConceptNode(allNodes, concept);
        setSourcesOpen(false);
        if (match) {
          setConceptPractice({ nodeId: match.id, title: concept });
          return;
        }
        // No node about this concept yet: explain it first, practice unlocks on completion.
        setPendingPractice(concept);
        showToast(`Explaining “${concept}” — practice unlocks when the answer lands`);
        askConcept(conceptExplainQuestion(concept, materialTitle), materialId);
      },
    }),
    [allNodes, askConcept, showToast],
  );

  const ctx = useMemo(
    () => ({
      openPath: () => setPathOpen(true),
      openMap: () => setMapOpen(true),
      toast: showToast,
    }),
    [showToast],
  );

  return (
    <CanvasProvider value={ctx}>
      <div className="w-full h-full" data-canvas={canvasId}>
        <ReactFlowProvider>
          <CanvasStage onAsk={onAsk} />
          <GlobalPromptBar onAsk={onAsk} disabled={askBusy} />
          {/* contextual header: real canvas title (editable) + Personalize (spec §3–4) */}
          <CanvasHeader onOpenPersonalize={() => setProfileOpen(true)} personalizeOpen={profileOpen} />
          {/* canvas-level learning controls (mobile-safe offsets from the menu button) */}
          <div className="absolute top-14 left-3 lg:top-16 lg:left-4 z-10 flex items-center gap-1.5 max-w-[calc(100%-1.5rem)] flex-nowrap overflow-x-auto lg:flex-wrap lg:overflow-visible">
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={onSummarize}
              disabled={askBusy}
              title="Generate a session-review node from every completed node on this canvas"
            >
              ✦ Summarize
            </button>
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={() => setMapOpen(true)}
              title="Map this question space — facets worth examining, each exploreable"
            >
              ⌘ Map
            </button>
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={() => setBoardOpen(true)}
              title="Evidence board — collect claims, sources, and counterarguments"
            >
              ⊞ Evidence
            </button>
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={() => setSourcesOpen(true)}
              title="Source Explorer — your sources and the provenance of every answer"
            >
              ◎ Sources
            </button>
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={() => setArtifactsOpen(true)}
              title="Study guides, research briefs, timelines, and flashcard decks from this canvas"
            >
              📄 Artifacts
            </button>
            <button
              className={`btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400 ${recapSpeaking ? "!text-spark-400" : ""}`}
              onClick={() => void playRecap()}
              disabled={recapBusy}
              title="Listen to a short spoken recap of what you learned here"
            >
              {recapBusy ? "✳ Recapping…" : recapSpeaking ? "⏸ Recap" : "🎧 Recap"}
            </button>
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={() => navigate({ page: "graph" })}
              title="Your knowledge graph — concepts you've explored, connected"
            >
              ◇ Graph
            </button>
            <button
              className="btn-ghost bg-ink-850 border border-ink-700 rounded-lg text-xs text-fog-300 px-3 py-1.5 hover:text-spark-400"
              onClick={() => setExamOpen(true)}
              title="Test me — an exam from what you've explored"
            >
              ✓ Test me
            </button>
          </div>
          {toast && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 popover-surface px-4 py-2 text-sm text-fog-100" role="status">
              {toast}
            </div>
          )}
        </ReactFlowProvider>
      </div>
      <PathPanel
        open={pathOpen}
        onClose={() => setPathOpen(false)}
        onNodeAdded={() => {
          onGraphChanged?.();
          showToast("Section added to the canvas");
        }}
      />
      <ThinkingMapPanel
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        onNodeAdded={() => onGraphChanged?.()}
      />
      <EvidenceBoard open={boardOpen} onClose={() => setBoardOpen(false)} />
      <SourcesPanel
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        canvasId={canvasId}
        canvasTitle={canvasTitle}
        onOpenNode={requestFocus}
        concepts={conceptActions}
      />
      {conceptPractice && (
        <PracticeSheet nodeId={conceptPractice.nodeId} title={conceptPractice.title} onClose={() => setConceptPractice(null)} />
      )}
      <ArtifactsPanel open={artifactsOpen} onClose={() => setArtifactsOpen(false)} canvasId={canvasId} canvasTitle={canvasTitle} />
      <KnowledgeGraphPanel open={graphOpen} onClose={() => setGraphOpen(false)} />
      {examOpen && <ExamSheet onClose={() => setExamOpen(false)} />}
      <ProfilePopover open={profileOpen} onClose={() => setProfileOpen(false)} />
    </CanvasProvider>
  );
}

/** Concept links (spec §6) rendered as soft dotted edges, visually distinct from hierarchy edges. */
export function linkEdges(links: { id: string; source: string; target: string; label: string }[]): Edge[] {
  return links.map((l) => ({
    id: `link-${l.id}`,
    source: l.source,
    sourceHandle: "b",
    target: l.target,
    targetHandle: "t",
    label: l.label || undefined,
    className: "concept-link",
    style: { strokeDasharray: "2 4", strokeWidth: 1.2, stroke: "rgb(var(--c-spark-400) / 0.6)" },
    zIndex: 0,
  }));
}
