import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AskRequest, LearningStats } from "@canvas-learn/shared";
import { usePrefs } from "../hooks/usePrefs";
import { PONDER_ICONS, SunIcon, MoonIcon, CheckIcon, GearIcon } from "../components/ui/Icons";
import { Popover } from "../components/ui/Popover";
import { GlobalPromptBar } from "../components/canvas/GlobalPromptBar";
import { api } from "../lib/api";
import {
  OrbitIcon,
  DocIcon,
  MoonSpaceIcon,
  BrainIcon,
  ScalesIcon,
  FlaskIcon,
  TargetIcon,
  LinkIcon,
  SourceIcon,
  PenToolIcon,
} from "../components/ui/Icons";

interface Props {
  /** True while the app is creating the first canvas (no canvases loaded yet). */
  creating: boolean;
  /** True while another question is already streaming (one at a time by design). */
  askBusy?: boolean;
  /** Real ask flow: Ponder creates/uses a canvas and streams the answer onto it. */
  onAsk: (req: Omit<AskRequest, "canvas_id">) => void;
  onOpenSettings: () => void;
}

/** Starter prompts — intentionally static (spec §18); each launches the real ask flow. */
const EXAMPLES = [
  { q: "Why does time slow down near a black hole?", Icon: OrbitIcon, tint: "spark" },
  { q: "Explain quantum computing like I'm 15", Icon: FlaskIcon, tint: "sky" },
  { q: "Help me understand the causes of the French Revolution", Icon: DocIcon, tint: "amber" },
  { q: "What would happen if the Moon disappeared?", Icon: MoonSpaceIcon, tint: "sky" },
  { q: "Teach me how neural networks actually learn", Icon: BrainIcon, tint: "spark" },
  { q: "Compare classical and operant conditioning", Icon: ScalesIcon, tint: "green" },
] as const;

/** Capability strip — each entry routes to an experience that actually exists. */
const CAPABILITIES = [
  { title: "Think deeper", desc: "Challenge assumptions and explore alternatives.", Icon: TargetIcon, action: "challenge" },
  { title: "Make connections", desc: "See how ideas relate across topics.", Icon: LinkIcon, action: "graph" },
  { title: "Use real sources", desc: "Explore evidence and where it comes from.", Icon: SourceIcon, action: "library" },
  { title: "Turn ideas into action", desc: "Create notes, diagrams, practice, and artifacts.", Icon: PenToolIcon, action: "canvas" },
] as const;

const TINTS: Record<string, string> = {
  spark: "text-spark-400 bg-spark-500/12",
  sky: "text-sky-400 bg-sky-500/12",
  amber: "text-amber-500 bg-amber-500/12",
  green: "text-emerald-400 bg-emerald-500/12",
};

/**
 * The Ponder launchpad (home redesign): identity mark → curiosity headline →
 * hero composer → example questions → capability strip. Real data only —
 * the connections line, stats, and review invite all come from the backend.
 */
export function HomePage({ creating, askBusy = false, onAsk, onOpenSettings }: Props) {
  const { icon, setIcon, theme, setTheme } = usePrefs();
  const active = PONDER_ICONS.find((i) => i.id === icon) ?? PONDER_ICONS[0]!;
  const composerRef = useRef<HTMLDivElement>(null);
  const canvasesQ = useQuery({ queryKey: ["canvases"], queryFn: api.listCanvases });

  // real numbers only (spec §19): shown only when they exist
  const stats = useQuery({ queryKey: ["learning-stats"], queryFn: api.learningStats, refetchInterval: 60_000 });
  // Cross-canvas conceptual bridges: real, from actual exploration history.
  const connections = useQuery({ queryKey: ["connections"], queryFn: api.connections, staleTime: 120_000 });
  const s = stats.data as LearningStats | undefined;
  const hasStats = !!s && (s.concepts_explored > 0 || s.cards_count > 0 || s.due_count > 0);

  // Autofocus the composer once so choosing an example doesn't re-steal focus mid-flow.
  useEffect(() => {
    const t = window.setTimeout(() => {
      composerRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="h-full overflow-y-auto home-surface" data-page="home">
      {/* ---------- top-right utility area: pinned while the page scrolls ---------- */}
      <div className="sticky top-0 z-20 flex justify-end -mb-16 pointer-events-none">
        <div className="flex items-center gap-1.5 p-4 pointer-events-auto">
        <div className="flex items-center rounded-full border border-ink-700/80 bg-ink-900/70 backdrop-blur p-0.5">
          {(["light", "dark"] as const).map((t) => {
            const selected = theme === t;
            const Ic = t === "light" ? SunIcon : MoonIcon;
            return (
              <button
                key={t}
                onClick={() => setTheme(t)}
                aria-pressed={selected}
                aria-label={`${t} theme`}
                title={`${t === "light" ? "Light" : "Dark"} theme`}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  selected ? "bg-spark-500/25 text-spark-400" : "text-fog-400 hover:text-fog-200"
                }`}
              >
                <Ic className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <Popover
          align="right"
          placement="bottom"
          trigger={({ onClick, ref, ...aria }) => (
            <button
              ref={ref}
              onClick={onClick}
              {...aria}
              className="w-8 h-8 rounded-full bg-spark-500/20 border border-spark-500/40 text-spark-400 flex items-center justify-center hover:bg-spark-500/30 transition-colors"
              title="Your Ponder icon"
            >
              <active.Icon className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          title="Ponder icon"
          hint="Shown across the workspace, remembered on this device."
        >
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Ponder icon options">
            {PONDER_ICONS.map(({ id, label, Icon }) => {
              const selected = id === icon;
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={selected}
                  title={label}
                  aria-label={`${label}${selected ? " (selected)" : ""}`}
                  onClick={() => setIcon(id)}
                  className={`relative flex items-center justify-center rounded-lg p-2.5 transition-colors ${
                    selected
                      ? "bg-spark-500/20 text-spark-400 border border-spark-500"
                      : "text-fog-300 hover:bg-ink-700 hover:text-fog-100 border border-transparent"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {selected && (
                    <span className="absolute -top-1 -right-1 bg-spark-500 text-white rounded-full p-0.5">
                      <CheckIcon className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Popover>
        <button
          className="btn-ghost !p-2 text-fog-400 hover:text-fog-200"
          onClick={onOpenSettings}
          title="Settings — models, appearance, data"
          aria-label="Settings"
        >
          <GearIcon />
        </button>
        </div>
      </div>

      <div className="min-h-full flex flex-col">
        {/* ---------- hero ---------- */}
        <div className="flex-1 flex flex-col items-center justify-center px-5 pt-16 pb-6 sm:pt-20">
          <active.Icon className="w-11 h-11 ponder-mark mark-glow mb-5 animate-fade-up" aria-hidden="true" />

          <h1
            className="text-4xl sm:text-5xl font-semibold tracking-tight text-fog-100 text-center max-w-xl animate-fade-up"
            style={{ animationDelay: "40ms" }}
          >
            What are you <span className="headline-accent">curious</span> about?
          </h1>
          <p
            className="text-fog-300 mt-3 text-center text-base sm:text-lg max-w-lg animate-fade-up"
            style={{ animationDelay: "80ms" }}
          >
            Ask Ponder anything. Explore ideas, understand concepts, and think deeper.
          </p>

          {/* the main interaction on the page */}
          <div className="w-full max-w-2xl mt-7 animate-fade-up" style={{ animationDelay: "120ms" }} ref={composerRef}>
            <GlobalPromptBar
              variant="hero"
              placeholder={askBusy ? "Ponder is thinking about your last question…" : "Ask Ponder anything…"}
              disabled={creating || askBusy}
              onAsk={onAsk}
            />
          </div>

          {/* real status line: previous-question stream, first-canvas setup, or actual stats */}
          {creating ? (
            <p className="text-fog-400 text-sm mt-5 animate-pulse" role="status">
              Setting up your first canvas…
            </p>
          ) : askBusy ? (
            <p className="text-fog-400 text-sm mt-5 animate-pulse" role="status">
              Answering your previous question — open its canvas in the sidebar to watch it stream.
            </p>
          ) : hasStats && s ? (
            <p className="text-xs text-fog-400 mt-5" aria-label="Your learning progress">
              {s.concepts_explored > 0 && (
                <span>
                  {s.concepts_explored} concept{s.concepts_explored === 1 ? "" : "s"} explored
                </span>
              )}
              {s.cards_count > 0 && (
                <span>
                  {s.concepts_explored > 0 ? " · " : ""}
                  {s.due_count > 0 ? <span className="text-spark-400">{s.due_count} to review</span> : <span>{s.cards_count} knowledge card{s.cards_count === 1 ? "" : "s"}</span>}
                </span>
              )}
              {s.accuracy !== null && (
                <span>
                  {s.concepts_explored > 0 || s.cards_count > 0 ? " · " : ""}
                  {s.accuracy}% practice accuracy
                </span>
              )}
            </p>
          ) : null}
        </div>

        {/* ---------- try asking ---------- */}
        <section className="w-full max-w-3xl mx-auto px-5 pb-10" aria-labelledby="try-asking">
          <div className="flex items-baseline justify-between mb-3.5">
            <h2 id="try-asking" className="text-sm font-medium text-fog-300">
              Try asking
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {EXAMPLES.map(({ q, Icon, tint }, i) => (
              <button
                key={q}
                className="example-card group flex items-center gap-3 text-left rounded-xl border border-ink-700/80 bg-ink-900/50 hover:bg-ink-850/80 hover:border-spark-500/50 px-3.5 py-3 animate-fade-up"
                style={{ animationDelay: `${140 + i * 40}ms` }}
                onClick={() =>
                  onAsk({ parent_id: null, branch_origin: "thread", question: q, position: { x: 0, y: 0 }, model_speed: "fast", web_search: false })
                }
                title={`Ask: ${q}`}
              >
                <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${TINTS[tint]}`}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="flex-1 text-[13px] leading-snug text-fog-300 group-hover:text-fog-100 transition-colors">{q}</span>
                <span className="example-arrow shrink-0 text-fog-400" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ---------- capability strip ---------- */}
        <section className="w-full max-w-3xl mx-auto px-5 pb-8" aria-label="What Ponder can do">
          <div className="home-hairline mb-7" aria-hidden="true" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {CAPABILITIES.map(({ title, desc, Icon, action }) => (
              <button
                key={title}
                className="group text-left"
                onClick={() => {
                  if (action === "graph") window.location.hash = "#/graph";
                  else if (action === "library") window.location.hash = "#/library";
                  else if (action === "canvas") {
                    // open the most recent canvas; the graph-load flow handles the rest
                    const first = canvasesQ.data?.[0];
                    if (first) window.location.hash = `#/canvas/${first.id}`;
                    else {
                      api
                        .createCanvas()
                        .then((c) => {
                          window.location.hash = `#/canvas/${c.id}`;
                        })
                        .catch(() => undefined);
                    }
                  } else {
                    // Think deeper: focus the composer so the ask flow starts from curiosity
                    composerRef.current?.querySelector<HTMLInputElement>("input")?.focus();
                  }
                }}
                title={
                  action === "graph"
                    ? "Open your knowledge graph"
                    : action === "library"
                      ? "Open your library — saved ideas, cards, sources"
                      : action === "canvas"
                        ? "Open your canvas"
                        : "Type a question and ask Ponder to challenge it"
                }
              >
                <span className="w-8 h-8 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center text-fog-300 group-hover:text-spark-400 group-hover:border-spark-500/40 transition-colors">
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="block text-[13px] font-medium text-fog-200 mt-2.5 group-hover:text-fog-100 transition-colors">{title}</span>
                <span className="block text-xs text-fog-400 mt-0.5 leading-relaxed">{desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ---------- connections: real bridges only ---------- */}
        {connections.data && connections.data.connections.length > 0 && !askBusy && (
          <section className="w-full max-w-3xl mx-auto px-5 pb-10">
            <div className="rounded-xl border border-spark-500/25 bg-spark-500/[0.06] px-4 py-3.5">
              {connections.data.connections.slice(0, 1).map((c) => (
                <div key={c.question}>
                  <p className="text-sm text-fog-300 leading-relaxed">
                    <span className="text-spark-400 font-medium">Connection · </span>
                    {c.b_title ? (
                      <>
                        <span className="text-fog-100">{c.a_title}</span> and <span className="text-fog-100">{c.b_title}</span> share an idea.
                      </>
                    ) : (
                      <span className="text-fog-100">An idea worth pulling on from {c.a_title}.</span>
                    )}{" "}
                    {c.why}
                  </p>
                  <button
                    className="text-xs text-spark-400 hover:text-spark-300 mt-2 transition-colors"
                    onClick={() =>
                      onAsk({ parent_id: null, branch_origin: "thread", question: c.question, position: { x: 0, y: 0 }, model_speed: "fast", web_search: false })
                    }
                    title="Explore this connection on a new canvas"
                  >
                    Explore connection →
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="pb-6" />
      </div>
    </div>
  );
}
