import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position as RFPosition, useStore, type NodeProps } from "@xyflow/react";
import type { NodeEntity, AskRequest, ThinkingMode } from "@canvas-learn/shared";
import { cardLoD } from "../../lib/viewport";
import { useCanvasStore } from "../../stores/canvasStore";
import { extractTerms, parseAnswerSegments, termExplanationContext } from "../../lib/termparser";
import { InlineExplanation } from "./InlineExplanation";
import { wheelShouldConsume } from "../../lib/wheel";
import { VisualRenderer } from "../visuals/VisualRenderer";
import { VisualGenerationError } from "../visuals/VisualGenerationError";
import { PracticeSheet } from "../practice/PracticeSheet";
import { RecallSheet } from "../practice/RecallSheet";
import { api, ApiError } from "../../lib/api";
import {
  SparkleIcon,
  TrashIcon,
  CollapseIcon,
  ExpandIcon,
  SaveIcon,
  RefreshIcon,
  PlusIcon,
  SendIcon,
  StarIcon,
  NoteIcon,
  SpeakerIcon,
  PracticeIcon,
  CardIcon,
  EyeIcon,
  ImageIcon,
  CloseIcon,
} from "../ui/Icons";
import { useCanvas } from "../canvas/CanvasContext";
import { Popover } from "../ui/Popover";
import { HelpIcon, ChallengeIcon, MoreIcon, MicIcon, PlayIcon, PauseIcon, CopyIcon } from "../ui/Icons";
import { VoiceInputButton } from "../ui/VoiceInputButton";
import { useSpeechStore } from "../../hooks/useSpeech";
import { usePrefs } from "../../hooks/usePrefs";

export interface FlowNodeData extends Record<string, unknown> {
  node: NodeEntity;
  streaming: boolean;
  onAsk: (req: Omit<AskRequest, "canvas_id">) => void;
  onPlus: (node: NodeEntity, direction: "top" | "left" | "right") => void;
  onToggleCollapse: (node: NodeEntity) => void;
  onDelete: (node: NodeEntity) => void;
  onSave: (node: NodeEntity) => void;
  onRegenerate: (node: NodeEntity) => void;
}

type Props = NodeProps & { data: FlowNodeData };

/** Deeper thinking modes offered in the "More" menu (thinking-spec §2) — real pipeline modes, not labels. */
const MODE_ACTIONS: { mode: ThinkingMode; label: string; hint: string; question: (title: string, answer: string) => string }[] = [
  { mode: "socratic", label: "Think with me", hint: "Socratic — Ponder asks, you reason. No answers handed over.", question: (t) => `I want to think through ${t} with you. Don't tell me the answer — ask me guiding questions one at a time.` },
  { mode: "explore", label: "Explore around it", hint: "Map the related ideas worth pulling on", question: (t) => `Explore around ${t}: what related ideas and sub-questions are worth pulling on?` },
  { mode: "compare", label: "Compare views", hint: "Competing explanations, side by side", question: (t) => `Compare the main competing explanations or approaches for ${t}` },
  { mode: "debate", label: "Both sides", hint: "Strongest case for and against", question: (t) => `Present the strongest case for and against the main view of ${t}` },
  { mode: "apply", label: "Apply it", hint: "See it working in a real situation", question: (t) => `Show how ${t} works in a concrete real situation` },
  { mode: "create", label: "Create with it", hint: "Make something from what you learned", question: (t) => `Help me create something using what I learned about ${t}` },
  { mode: "research", label: "Research it", hint: "What's known, disputed, uncertain — with sources", question: (t) => `Research ${t}: what is well-established, what is disputed, and what remains uncertain?` },
];

/**
 * Outer card wrapper (roadmap E — large-canvas performance):
 *
 * 1. LOD — the detail level is a pure function of zoom (lib/viewport.cardLoD).
 *    The store selector returns a PRIMITIVE ("full" | "compact"), so this
 *    component re-renders only when the level actually FLIPS while zooming —
 *    never on each wheel tick, and never on pan (pan changes transform[0..1],
 *    not the zoom this selector reads). Selected and streaming cards are always
 *    full: usability of the node being used never degrades.
 *
 * 2. Render dedupe — the memo comparator compares the entity + streaming flag
 *    + onAsk identity + selection, NOT the (always-new) `data` wrapper object.
 *    During streaming, only the card whose node object changed re-renders;
 *    the other ~149 cards on a large canvas skip entirely.
 */
export const NodeCard = memo(
  function NodeCard(props: Props) {
    const { data, selected } = props;
    const lod = useStore((s) => cardLoD(s.transform[2], { selected: !!selected, streaming: !!data.streaming }));
    if (lod === "compact") return <CompactCard node={data.node} />;
    return <FullCard {...props} />;
  },
  (prev, next) =>
    prev.data.node === next.data.node &&
    prev.data.streaming === next.data.streaming &&
    prev.data.onAsk === next.data.onAsk &&
    prev.selected === next.selected,
);

/**
 * Level-of-detail card: what a card reduces to when zoomed far out. Same width
 * (edge anchors + layout stay stable), minimal DOM: title, state dot, two-line
 * preview. No forms, buttons, or visuals — those are unusable at this scale
 * and are exactly the render cost this exists to remove.
 */
function CompactCard({ node }: { node: NodeEntity }) {
  const preview = (node.answer_text || node.question).replace(/\[\[|\]\]/g, "").slice(0, 160);
  const dot =
    node.status === "complete" ? (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" />
    ) : node.status === "failed" ? (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400/90" />
    ) : (
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-spark-400" />
    );
  return (
    <div
      className="node-card flex flex-col relative overflow-hidden"
      style={{ width: node.width || 420 }}
      data-lod="compact"
      data-node-id={node.id}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex-1 truncate text-xs font-medium text-fog-100">{node.title || node.question}</span>
        {dot}
      </div>
      <div className="px-3 pb-2 text-[10px] leading-snug text-fog-400 line-clamp-2">{preview}</div>
      <Handle type="target" position={RFPosition.Top} id="t" isConnectable={false} />
      <Handle type="source" position={RFPosition.Bottom} id="b" isConnectable={false} />
    </div>
  );
}

const FullCard = memo(function FullCard({ data }: Props) {
  const { node, streaming, onAsk, onPlus, onToggleCollapse, onDelete, onSave, onRegenerate } = data;
  const { openPath, toast, askBusy = false } = useCanvas();
  const patchNodeLocal = useCanvasStore((s) => s.patchNodeLocal);
  const automaticVisualError = useCanvasStore((s) => s.visualErrors[node.id]);
  const [followup, setFollowup] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [practicing, setPracticing] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualError, setVisualError] = useState<{ message: string; code?: string } | null>(null);
  const [visualKind, setVisualKind] = useState<"diagram" | "picture">(node.visual?.type === "image" ? "picture" : "diagram");
  const visualFailure = visualError ?? (node.visual?.type === "image" && node.visual.status === "failed" ? node.visual.error ?? { message: "Picture generation failed. Check your key and picture model in Settings, then retry." } : null);
  const visualAbortRef = useRef<AbortController | null>(null);
  // Synchronous in-flight lock: React state updates are async, so a double-click
  // inside one render tick would both see visualBusy=false and both fire. The
  // ref flips synchronously on the first click, which is the real dedupe gate;
  // visualBusy is only for rendering (skeleton, disabled button).
  const visualInFlightRef = useRef(false);
  const answerRef = useRef<HTMLDivElement>(null);
  const speech = useSpeechStore();
  const { audio } = usePrefs();

  // auto-scroll the answer pane while streaming
  useEffect(() => {
    if (streaming && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [node.answer_text, streaming]);

  // Wheel-over-text isolation (zoom-stability fix): React Flow's zoom handler is a
  // NATIVE pane listener that fires before React's synthetic onWheel can stop it,
  // so attach a native listener on the answer element itself and consume the wheel
  // only while the text can actually scroll in that direction. At the end of the
  // text the wheel hands back to the canvas (natural scroll chaining); the rest of
  // the canvas keeps zoom/pan exactly as before. Re-attaches on collapse/expand
  // because the element unmounts while collapsed.
  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (wheelShouldConsume(el, e.deltaY)) e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [node.collapsed]);

  // A card instance can be recycled for another node and unmounts on canvas
  // switch: transient visual state must never leak across nodes, and an
  // in-flight request is cancelled (cleanup on navigation away).
  useEffect(() => {
    visualAbortRef.current?.abort();
    visualInFlightRef.current = false;
    setVisualBusy(false);
    setVisualError(null);
    setVisualKind(node.visual?.type === "image" ? "picture" : "diagram");
  }, [node.id]);
  useEffect(() => () => visualAbortRef.current?.abort(), []);

  // auto-play completed answers ONLY when the user opted in (default off — never blast audio)
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && node.status === "complete" && audio.autoPlay && audio.voiceResponses && speech.supported) {
      speech.speak({ id: node.id, text: node.answer_text, volume: audio.volume, rate: audio.rate });
    }
    wasStreaming.current = streaming;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, node.status, node.id]);

  const keyTerms = [...node.key_terms, ...extractTerms(node.answer_text), ...node.sections.flatMap((section) => extractTerms(section.body))];
  const done = node.status === "complete";
  // Structured sections reshape a real answer (spec §4/§15) — they must never
  // substitute for one: no answer → render the answer area's own states only.
  const hasAnswer = node.answer_text.trim().length > 0;
  const answerLength = node.answer_text.replace(/\[\[[^\]]+\]\]/g, "").trim().length;
  const sectionLength = node.sections.reduce((total, section) => total + section.body.length, 0);
  // A small/failed restructuring call must not make a good streamed answer look
  // short. Fall back to the canonical answer unless the sections retain most of
  // its teaching content.
  const showSections = done && hasAnswer && node.sections.length > 0 && sectionLength >= answerLength * 0.7
    && (keyTerms.length === 0 || node.sections.some((section) => parseAnswerSegments(section.body, keyTerms).some((segment) => segment.kind === "term")));

  // Why-chain breadcrumb (thinking-spec §5): the ancestor trail behind this node.
  const allNodes = useCanvasStore((s) => s.nodes);
  const whyTrail = (() => {
    const trail: { id: string; title: string; q: string }[] = [];
    let cur: NodeEntity | undefined = node;
    while (cur && trail.length < 6) {
      trail.unshift({ id: cur.id, title: cur.title || cur.question.slice(0, 30), q: cur.question });
      cur = cur.parent_id ? allNodes[cur.parent_id] : undefined;
    }
    return trail;
  })();

  const submitFollowup = () => {
    const q = followup.trim();
    if (!q) return;
    setFollowup("");
    onAsk({
      parent_id: node.id,
      branch_origin: "followup_box",
      question: q,
      position: node.position,
      model_speed: "fast",
      web_search: false,
    });
  };

  const chipClick = (term: string, passage = node.answer_text) => {
    const question = `Explain ${term.slice(0, 180)}`;
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const existing = Object.values(allNodes).find((candidate) => candidate.parent_id === node.id && candidate.branch_origin === "term_chip" && normalize(candidate.question) === normalize(question));
    if (existing && existing.status !== "failed" && (existing.status !== "complete" || existing.answer_text.trim())) {
      if (existing.collapsed) useCanvasStore.getState().setCollapsed(existing.id, false);
      useCanvasStore.getState().requestFocus(existing.id);
      return;
    }
    if (askBusy) return;
    if (existing) { onRegenerate(existing); return; }
    onAsk({
      parent_id: node.id,
      branch_origin: "term_chip",
      question,
      position: node.position,
      model_speed: "fast",
      web_search: false,
      mode: "explain",
      context_text: termExplanationContext(passage, term),
      ...(node.material_id ? { material_id: node.material_id } : {}),
    });
  };

  const suggestionClick = (q: string) => {
    onAsk({
      parent_id: node.id,
      branch_origin: "suggested_question",
      question: q,
      position: node.position,
      model_speed: "fast",
      web_search: false,
    });
  };

  /** Contextual action: go one layer deeper on this concept (spec §15). */
  const goDeeper = () => {
    onAsk({
      parent_id: node.id,
      branch_origin: "suggested_question",
      question: `Go deeper on ${node.title || node.question}: explain the next layer of understanding, one level more advanced than the previous answer`,
      position: node.position,
      model_speed: "fast",
      web_search: false,
    });
  };

  /** Ask a branch question through a specific thinking mode (thinking-spec §2). */
  const askMode = (mode: ThinkingMode, question: string) => {
    onAsk({
      parent_id: node.id,
      branch_origin: "suggested_question",
      question,
      position: node.position,
      model_speed: "fast",
      web_search: mode === "research" || mode === "challenge",
      mode,
    });
  };

  /** Why-chain (thinking-spec §5): drill one mechanism-level down. */
  const askWhy = () => {
    onAsk({
      parent_id: node.id,
      branch_origin: "suggested_question",
      question: node.answer_text
        ? `Why? (Drill into the core mechanism behind: ${node.answer_text.slice(0, 120)}…)`
        : "Why?",
      position: node.position,
      model_speed: "fast",
      web_search: false,
    });
  };

  /**
   * Contextual action: visualize this node's content on demand (spec §5, §14).
   * Full lifecycle: skeleton appears immediately → the server generates + persists
   * → the real visual replaces the skeleton. On failure the slot shows the actual
   * error with a Retry action (no silent no-op, no false success, no leftover
   * skeleton). Repeated clicks while a request is in flight are no-ops.
   */
  const visualize = async (kind: "diagram" | "picture" = visualKind) => {
    if (visualInFlightRef.current) return; // dedupe: one in-flight request per node
    if (!node.answer_text.trim()) {
      setVisualError({ message: "This answer is empty — regenerate it first (↻), then visualize." });
      return;
    }
    const ctrl = new AbortController();
    visualAbortRef.current = ctrl;
    visualInFlightRef.current = true;
    setVisualBusy(true);
    setVisualError(null);
    setVisualKind(kind);
    try {
      // The server caps the text at 6000 chars — truncate mechanically instead of
      // letting a long answer 400 for that reason alone.
      const { visual } = await api.generateVisual({ node_id: node.id, kind, text: node.answer_text.slice(0, 6000) }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!visual) {
        // The server always returns a block; null means something unexpected —
        // report it rather than claim success.
        setVisualError({ message: "Visual generation returned no result — try again." });
        return;
      }
      patchNodeLocal(node.id, { visual });
      toast(visual.type === "none" ? "No visual fit this content — try asking a more structural question" : "Visual added");
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setVisualError({ message: err instanceof Error ? err.message : "Visual generation failed", ...(err instanceof ApiError ? { code: err.code } : {}) });
      }
    } finally {
      if (!ctrl.signal.aborted) {
        visualInFlightRef.current = false;
        setVisualBusy(false);
      }
    }
  };

  /** Contextual action: extract a Knowledge Card (spec §10). */
  const makeCard = async () => {
    toast("Creating a knowledge card…");
    try {
      const card = await api.createCard(node.id);
      toast(`Card saved: “${card.concept}” — review it in Library → Cards`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Card failed");
    }
  };

  /** Read the answer aloud via the shared speech store (spec §7): play/pause/stop, volume + rate from prefs. */
  const nodeSpeaking = speech.supported && speech.state === "speaking" && speech.activeId === node.id;
  const nodePaused = speech.supported && speech.state === "paused" && speech.activeId === node.id;
  const toggleListen = () => {
    if (!speech.supported) {
      toast("Audio isn't supported in this browser");
      return;
    }
    speech.toggle({ id: node.id, text: node.answer_text, volume: audio.voiceResponses ? audio.volume : 0, rate: audio.rate });
  };

  const answerPlain = node.answer_text.replace(/\[\[|\]\]/g, "");

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(answerPlain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy to clipboard");
    }
  };

  const saveNote = () => {
    const el = document.getElementById(`note-${node.id}`) as HTMLTextAreaElement | null;
    const note = el?.value ?? "";
    patchNodeLocal(node.id, { note });
    api.patchNode(node.id, { note }).catch(() => {});
    setNoteOpen(false);
  };

  const toggleImportant = () => {
    const important = !node.important;
    patchNodeLocal(node.id, { important });
    api.patchNode(node.id, { important }).catch(() => {});
  };

  return (
    <div
      className="node-card flex flex-col relative"
      // The React Flow node container is auto-sized; without an explicit width the
      // card (w-full) stretches to the pane and every answer renders 2.5x too wide
      // (and auto-focus then fits a box 2.5x bigger than the design). Pin it to the
      // entity's layout width (NODE_W = 420), which the position math already uses.
      style={{ width: node.width || 420 }}
      data-node-id={node.id}
    >
      {/* directional + buttons (spec §6: branch into related questions) */}
      {(["top", "left", "right"] as const).map((dir) => (
        <button
          key={dir}
          className={`absolute z-10 w-6 h-6 rounded-full bg-ink-700 hover:bg-spark-500 text-fog-200 flex items-center justify-center transition-colors ${
            dir === "top" ? "-top-3 left-1/2 -translate-x-1/2" : dir === "left" ? "-left-3 top-1/2 -translate-y-1/2" : "-right-3 top-1/2 -translate-y-1/2"
          }`}
          onClick={() => onPlus(node, dir)}
          title={`Branch here (${dir}) — ask a related question`}
          aria-label={`Branch ${dir} of ${node.title || node.question}`}
        >
          <PlusIcon className="w-3 h-3" />
        </button>
      ))}

      {/* header: title + actions (spec §6: notes, highlight, delete, open deeper) */}
      <div className="flex items-center gap-0.5 px-2.5 pt-2 pb-1.5 border-b border-ink-700">
        <span className="flex-1 text-sm font-medium text-fog-100 truncate pl-1" title={node.title || node.question}>
          {node.title || node.question}
        </span>
        <button className={`btn-ghost ${node.important ? "!text-star-500" : ""}`} title={node.important ? "Highlighted idea" : "Highlight as important"} aria-label="Highlight idea" aria-pressed={node.important} onClick={toggleImportant}>
          <StarIcon />
        </button>
        <button className={`btn-ghost ${node.note ? "!text-spark-400" : ""}`} title={node.note ? "Edit your note" : "Add a note"} aria-label="Note" onClick={() => setNoteOpen((v) => !v)}>
          <NoteIcon />
        </button>
        {done && (
          <>
            <button
              className={`btn-ghost ${nodeSpeaking || nodePaused ? "!text-spark-400" : "opacity-60 hover:opacity-100"}`}
              title={nodeSpeaking ? "Pause reading aloud" : nodePaused ? "Resume reading aloud" : "Listen to this answer"}
              aria-label={nodeSpeaking ? `Pause reading ${node.title || "this answer"} aloud` : nodePaused ? "Resume reading aloud" : `Listen to ${node.title || "this answer"}`}
              aria-pressed={nodeSpeaking || nodePaused}
              onClick={toggleListen}
            >
              {nodeSpeaking ? <PauseIcon /> : nodePaused ? <PlayIcon /> : <SpeakerIcon />}
            </button>
            <button
              className={`btn-ghost ${copied ? "!text-spark-400" : "opacity-60 hover:opacity-100"}`}
              title={copied ? "Copied!" : "Copy answer"}
              aria-label={copied ? "Answer copied" : "Copy answer"}
              onClick={() => void copyAnswer()}
            >
              <CopyIcon />
            </button>
          </>
        )}
        <button className="btn-ghost" title={node.collapsed ? "Expand branch" : "Collapse branch"} aria-label={node.collapsed ? "Expand branch" : "Collapse branch"} onClick={() => onToggleCollapse(node)}>
          {node.collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>
        <button className="btn-ghost" title="Save to library" aria-label="Save to library" onClick={() => onSave(node)}>
          <SaveIcon />
        </button>
        <button className="btn-ghost" title="Regenerate answer" aria-label="Regenerate answer" onClick={() => onRegenerate(node)}>
          <RefreshIcon />
        </button>
        <button className="btn-ghost hover:text-red-400" title="Delete node and branch" aria-label="Delete node and branch" onClick={() => onDelete(node)}>
          <TrashIcon />
        </button>
      </div>

      {/* note editor (spec §6: add notes) */}
      {noteOpen && (
        <div className="border-b border-ink-700 p-2">
          <textarea
            id={`note-${node.id}`}
            className="input-bar w-full text-xs"
            rows={3}
            placeholder="Your note on this idea…"
            aria-label="Node note"
            defaultValue={node.note}
          />
          <div className="flex justify-end mt-1.5 gap-1.5">
            <button className="text-xs text-fog-400 hover:text-fog-100 px-2 py-1" onClick={() => setNoteOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary !px-2.5 !py-1 !text-xs" onClick={saveNote}>
              Save note
            </button>
          </div>
        </div>
      )}
      {!noteOpen && node.note && (
        <p className="px-3 pt-2 text-xs text-fog-300 border-l-2 border-spark-500/50 ml-3 mr-3 mt-2 italic">{node.note}</p>
      )}

      {node.collapsed ? null : (
        <>
          {/* question bubble (spec §6) */}
          <div className="flex justify-end px-3 pt-2.5">
            <span className="question-bubble max-w-[85%]">{node.question}</span>
          </div>

          {/* thinking state (spec §9–10): calm, compact, honest — shown until the first real tokens arrive */}
          {streaming && node.answer_text.length === 0 && (
            <div className="px-3 pt-2.5 flex items-center gap-2" role="status" aria-live="polite" aria-label="Ponder is thinking">
              <SparkleIcon className="w-3.5 h-3.5 ponder-mark animate-pulse" aria-hidden="true" />
              <span className="text-xs text-fog-400">Ponder is thinking</span>
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 rounded-full bg-spark-400 animate-pulse-dot"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </span>
            </div>
          )}

          {/* answer: bite-sized sections when present (spec §4), plain prose otherwise.
              Sizing: the node grows with its content (React Flow re-measures and the
              stage gently re-fits) — the compact cap applies only WHILE streaming so
              the card doesn't jump every delta; completed answers expand to their
              natural height, with an internal scrollbar reserved for genuinely huge
              ones (>~1024px). wheel.ts + the native listener below isolate the text
              scroll from the canvas zoom. */}
          <div
            ref={answerRef}
            className={`ponder-selectable px-3 py-2 text-sm text-fog-200 whitespace-pre-line break-words overflow-y-auto space-y-2 ${streaming ? "max-h-64" : "max-h-[1024px]"}`}
            style={{ touchAction: "pan-y" }}
          >
            {!hasAnswer && streaming && <span className="sr-only">Generating response…</span>}
            {showSections ? (
              node.sections.map((s, i) => (
                <section key={i} className="ponder-selectable">
                  <h4 className="text-xs font-semibold text-fog-100 uppercase tracking-wide">{s.heading}</h4>
                  <p className="mt-0.5 leading-relaxed">
                    <InlineExplanation text={s.body} keyTerms={keyTerms} onExplain={chipClick} disabled={askBusy || node.status === "answering"} />
                  </p>
                </section>
              ))
            ) : (
              <InlineExplanation text={node.answer_text} keyTerms={keyTerms} onExplain={chipClick} disabled={askBusy || node.status === "answering"} />
            )}
            {streaming && node.answer_text.length > 0 && (
              <span className="inline-block w-[2px] h-[1em] align-middle bg-spark-400 animate-pulse ml-0.5" aria-hidden="true" />
            )}
            {/* complete but empty: honest technical error, not AI-faked filler (spec §14) */}
            {done && !hasAnswer && (
              <span className="text-red-400 text-xs block pt-1">
                Something went wrong while generating the explanation — try again with ↻.
              </span>
            )}
            {node.status === "failed" && (
              <span className="text-red-400 text-xs block pt-1">Generation failed — use ↻ to retry.</span>
            )}
          </div>

          {done && keyTerms.length > 0 && <p className="px-3 pb-2 text-[10px] text-fog-500">Click a highlighted term to open its explanation.</p>}

          {/* visual block (spec §5) — skeleton while generating, real error + Retry
              on failure, the actual visual when ready. All three occupy the same
              slot so the card stays anchored (no jumps) across the lifecycle. A
              previously good visual is kept visible if a regeneration fails. */}
          {visualBusy ? <VisualSkeleton kind={visualKind} /> : null}
          {!visualBusy && visualFailure ? <VisualGenerationError message={visualFailure.message} code={visualFailure.code} kind={visualKind} onRetry={() => void visualize(visualKind)} /> : null}
          {!visualBusy && (!visualFailure || node.visual?.status === "ready") ? <VisualRenderer visual={node.visual} error={automaticVisualError} /> : null}

          {/* why-chain breadcrumb (thinking-spec §5): visible trail back to the original question */}
          {done && whyTrail.length > 1 && (
            <div className="px-3 pt-2 flex flex-wrap items-center gap-1 text-[10px] text-fog-400" aria-label="Why chain">
              {whyTrail.map((t, i) => (
                <span key={t.id} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>→</span>}
                  <span className={i === whyTrail.length - 1 ? "text-spark-400" : ""} title={t.q}>{t.title}</span>
                </span>
              ))}
            </div>
          )}

          {/* knowledge gaps (thinking-spec §19): prerequisites worth learning first */}
          {done && (node.gaps ?? []).length > 0 && (
            <div className="px-3 pt-2">
              <p className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">Ideas that make this easier</p>
              <div className="flex flex-wrap gap-1">
                {(node.gaps ?? []).map((g) => (
                  <button
                    key={g.label}
                    className="text-[11px] text-fog-300 border border-ink-600 hover:border-spark-500 hover:text-spark-400 rounded-full px-2 py-0.5 transition-colors"
                    title={`Learn the prerequisite first: ${g.question}`}
                    onClick={() => askMode("explain", g.question)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* provenance (research-spec §1): where this answer's claims actually come from */}
          {done && node.provenance && (
            <div className="px-3 pt-2">
              <span
                className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border ${
                  node.provenance.status === "sourced"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : node.provenance.status === "context"
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}
                title={
                  node.provenance.status === "sourced"
                    ? "Grounded in one of your own sources"
                    : node.provenance.status === "context"
                      ? "Backed by retrieved web context"
                      : "Goes beyond what your sources support — verify before relying on it"
                }
              >
                {node.provenance.status === "sourced" ? "✓ From your source" : node.provenance.status === "context" ? "＋ Added context" : "？ Uncertain"}
              </span>
              {node.provenance.status === "sourced" && node.provenance.quote && (
                <p className="text-[11px] text-fog-300 italic leading-snug mt-1">“{node.provenance.quote}”</p>
              )}
            </div>
          )}

          {/* sources (thinking-spec §8): real retrieved snippets only, with attribution */}
          {done && (node.sources ?? []).length > 0 && (
            <div className="px-3 pt-2">
              <p className="text-[10px] uppercase tracking-wider text-fog-400 mb-1">Sources</p>
              <ul className="space-y-1">
                {(node.sources ?? []).map((s, i) => (
                  <li key={i} className="text-[11px] text-fog-300 leading-snug">
                    <span className="text-spark-400">·</span> <span className="font-medium text-fog-200">{s.title}</span> — {s.snippet.slice(0, 120)}
                    {s.snippet.length > 120 ? "…" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* contextual learning actions — subtle, only when complete (spec §14 + thinking-spec §1, §2) */}
          {done && (
            <div className="border-t border-ink-700 px-2.5 py-1.5 flex flex-wrap gap-1 items-center">
              <MiniAction icon={<EyeIcon />} label="Go deeper" title="One layer deeper on this concept" onClick={goDeeper} />
              <MiniAction icon={<HelpIcon />} label="Why?" title="Drill into why — build a chain of reasons" onClick={askWhy} />
              <MiniAction icon={<ChallengeIcon />} label="Challenge" title="Examine hidden assumptions and counterexamples in this answer" onClick={() => askMode("challenge", `Challenge this: "${node.answer_text.slice(0, 300)}" — surface its hidden assumptions, missing evidence, and one alternative explanation`)} />
              <MiniAction icon={<SparkleIcon />} label={visualBusy && visualKind === "diagram" ? "Creating…" : "Diagram"} title="Create a flowchart, chart, or simulation of this answer" onClick={() => void visualize("diagram")} disabled={visualBusy} />
              <MiniAction icon={<ImageIcon />} label={visualBusy && visualKind === "picture" ? "Painting…" : "Picture"} title="Generate an educational picture using OpenRouter (requires image-model credits)" onClick={() => void visualize("picture")} disabled={visualBusy} />
              <MiniAction icon={<PracticeIcon />} label="Practice" title="Generate exercises from this answer" onClick={() => setPracticing(true)} />
              <MiniAction icon={<HelpIcon />} label="Recall" title="Explain it back from memory — active recall" onClick={() => setRecalling(true)} />
              <MiniAction icon={<CardIcon />} label="Save card" title="Turn this into a Knowledge Card for review" onClick={() => void makeCard()} />
              {openPath && <MiniAction icon={<SaveIcon />} label="Learning path" title="Build a structured learning path on this canvas" onClick={() => openPath()} />}
              <Popover
                trigger={(props) => (
                  <button {...props} className="flex items-center gap-1 text-[11px] text-fog-400 hover:text-spark-400 border border-transparent hover:border-ink-600 rounded-md px-1.5 py-1 transition-colors" title="More ways to think about this" aria-label="More thinking modes">
                    <span className="w-3 h-3"><MoreIcon /></span>
                  </button>
                )}
                title="Think about this differently"
                hint="Each mode changes how Ponder responds"
                align="left"
              >
                <div className="grid grid-cols-2 gap-1">
                  {MODE_ACTIONS.map((m) => (
                    <button
                      key={m.mode}
                      className="text-left text-xs text-fog-300 hover:text-spark-400 hover:bg-ink-700/50 rounded-md px-2 py-1.5 transition-colors"
                      title={m.hint}
                      onClick={() => askMode(m.mode, m.question(node.title || node.question, node.answer_text))}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Popover>
            </div>
          )}

          {/* suggested follow-ups (spec §6) */}
          {node.suggested_followups.length > 0 && (
            <div className="border-t border-ink-700 px-3 py-2 space-y-1">
              {node.suggested_followups.map((q, i) => (
                <button
                  key={i}
                  className="block w-full text-left text-xs text-fog-400 hover:text-spark-400 truncate transition-colors"
                  onClick={() => suggestionClick(q)}
                  title={q}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* node-local follow-up input (spec §6) */}
          <form
            className="border-t border-ink-700 p-2 flex gap-1.5 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              submitFollowup();
            }}
          >
            <input
              className="input-bar flex-1 !py-1.5 !text-xs"
              placeholder="Ask a follow-up..."
              aria-label="Ask a follow-up"
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
            />
            <VoiceInputButton
              onTranscript={(text) => setFollowup((q) => (q.trim() ? `${q.trim()} ${text.trim()}` : text.trim()))}
            />
            <button type="submit" className="btn-ghost" title="Send follow-up" aria-label="Send follow-up">
              <SendIcon />
            </button>
          </form>
        </>
      )}

      {practicing && <PracticeSheet nodeId={node.id} title={node.title || node.question} onClose={() => setPracticing(false)} />}
      {recalling && <RecallSheet nodeId={node.id} title={node.title || node.question} onClose={() => setRecalling(false)} />}

      {/* invisible React Flow handles: edges anchor to card sides */}
      <Handle type="target" position={RFPosition.Top} id="t" isConnectable={false} />
      <Handle type="source" position={RFPosition.Bottom} id="b" isConnectable={false} />
    </div>
  );
});

function MiniAction({ icon, label, title, onClick, disabled }: { icon: React.ReactNode; label: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className={`flex items-center gap-1 text-[11px] border border-transparent rounded-md px-1.5 py-1 transition-colors ${
        disabled ? "text-fog-500/60 cursor-not-allowed" : "text-fog-400 hover:text-spark-400 hover:border-ink-600"
      }`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-busy={disabled || undefined}
    >
      <span className="w-3 h-3">{icon}</span>
      {label}
    </button>
  );
}

/**
 * Skeleton for in-flight visual generation: anchored in the node's visual slot
 * with stable dimensions (≈ a typical 200px render) and softly pulsing
 * placeholder blocks — no blank area, no fake progress, no fake visual.
 */
function VisualSkeleton({ kind = "diagram" }: { kind?: "diagram" | "picture" }) {
  return (
    <div className="border-t border-ink-700 px-3 py-3" role="status" aria-live="polite" aria-label="Creating visual">
      <div className="flex items-center gap-2 mb-2">
        <SparkleIcon className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
        <span className="text-xs text-fog-400">{kind === "picture" ? "Creating picture…" : "Creating diagram…"}</span>
      </div>
      <div className="space-y-2" aria-hidden="true">
        <div className="h-3 w-1/3 rounded bg-ink-700/80 animate-pulse" />
        <div className="h-24 rounded bg-ink-700/60 animate-pulse" style={{ animationDelay: "120ms" }} />
        <div className="h-3 w-2/3 rounded bg-ink-700/60 animate-pulse" style={{ animationDelay: "240ms" }} />
      </div>
    </div>
  );
}

// CloseIcon retained for future in-card dialogs
void CloseIcon;
