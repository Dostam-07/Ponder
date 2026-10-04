import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AskRequest } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { usePrefs } from "../../hooks/usePrefs";
import { PONDER_ICONS } from "../ui/Icons";
import { GlobeIcon, SendIcon, SourceIcon, CloseIcon, SocraticIcon, PaperclipIcon } from "../ui/Icons";
import { VoiceInputButton } from "../ui/VoiceInputButton";

interface Props {
  onAsk: (req: Omit<AskRequest, "canvas_id">) => void;
  disabled?: boolean;
  /** "docked" = floating bar at the canvas bottom (default). "hero" = inline block on the homepage. */
  variant?: "docked" | "hero";
  placeholder?: string;
  autoFocus?: boolean;
  /** Show the study-source picker (canvas prompt bar only). */
  withSources?: boolean;
  /** Active material id (controlled by CanvasPage when a source is pinned). */
  materialId?: string | null;
  onMaterialChange?: (id: string | null) => void;
}

/** Global prompt bar: "Start another thread..." on the canvas (PRD FR2); hero composer on Home. */
export function GlobalPromptBar({ onAsk, disabled, variant = "docked", placeholder = "Start another thread…", autoFocus, withSources, materialId, onMaterialChange }: Props) {
  const [question, setQuestion] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [socratic, setSocratic] = useState(false);
  const [speed, setSpeed] = useState<"fast" | "quality">("fast");
  const [pickerOpen, setPickerOpen] = useState(false);
  const { icon } = usePrefs();
  const identity = PONDER_ICONS.find((i) => i.id === icon) ?? PONDER_ICONS[0]!;

  const materials = useQuery({
    queryKey: ["materials"],
    queryFn: api.materials,
    enabled: withSources === true,
  });
  const activeMaterial = materials.data?.find((m) => m.id === materialId);

  const submit = () => {
    const q = question.trim();
    if (!q || disabled) return;
    setQuestion("");
    onAsk({
      parent_id: null,
      branch_origin: materialId ? "material" : "thread",
      question: socratic ? `${q} (Think with me — ask me guiding questions instead of giving the answer.)` : q,
      position: { x: 0, y: 0 }, // resolved to real free space by the caller
      model_speed: speed,
      web_search: webSearch,
      material_id: materialId ?? undefined,
      mode: socratic ? "socratic" : undefined,
    });
  };

  const shell =
    variant === "docked"
      ? "absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-10 w-[560px] max-w-[92vw]"
      : "relative w-full";

  const hero = variant === "hero";

  return (
    <div className={shell}>
      {activeMaterial && (
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <span className="flex items-center gap-1.5 text-xs text-spark-400 bg-spark-500/10 border border-spark-500/40 rounded-full px-2.5 py-1 max-w-full">
            <SourceIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Answering from “{activeMaterial.title}”</span>
            <button onClick={() => onMaterialChange?.(null)} className="shrink-0 hover:text-fog-100" aria-label="Stop using this source" title="Stop using this source">
              <CloseIcon className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}
      <form
        className={`composer-shell flex items-center gap-2 rounded-2xl shadow-2xl ${
          hero
            ? "bg-ink-900/90 backdrop-blur border border-ink-600 px-4 sm:px-5 py-3.5"
            : "bg-ink-850/95 backdrop-blur border border-ink-600 p-2"
        }`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* identity mark leads the composer (home hero) */}
        {hero && <identity.Icon className="w-5 h-5 ponder-mark shrink-0" aria-hidden="true" />}
        {withSources && (materials.data?.length ?? 0) > 0 && (
          <button
            type="button"
            className={`btn-ghost ${materialId ? "!text-spark-400" : ""}`}
            title={materialId ? "Change study source" : "Answer from a study source"}
            aria-label="Pick study source"
            onClick={() => setPickerOpen((v) => !v)}
          >
            <SourceIcon />
          </button>
        )}
        <input
          className={`flex-1 min-w-0 bg-transparent text-fog-100 placeholder:text-fog-400 focus:outline-none ${
            hero ? "text-base sm:text-[17px] py-1" : "text-sm"
          }`}
          placeholder={placeholder}
          aria-label={placeholder}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
        />
        {hero && (
          <button
            type="button"
            className="btn-ghost !p-2 text-fog-400"
            title="Attach study material — add files in Library → Sources"
            aria-label="Attach a study source"
            onClick={() => {
              window.location.hash = "#/library";
            }}
          >
            <PaperclipIcon />
          </button>
        )}
        {/* real voice input (spec §5): transcribes into the composer for editing before sending */}
        <VoiceInputButton
          onTranscript={(text) =>
            setQuestion((q) => (q.trim() ? `${q.trim()} ${text.trim()}` : text.trim()))
          }
          disabled={disabled}
        />
        <button
          type="button"
          className={`btn-ghost ${hero ? "!p-2" : ""} ${webSearch ? "!text-spark-400" : "text-fog-400"}`}
          title={webSearch ? "Web search: on — answers can consult the web" : "Web search: off"}
          aria-pressed={webSearch}
          aria-label="Toggle web search"
          onClick={() => setWebSearch((v) => !v)}
        >
          <GlobeIcon />
        </button>
        <button
          type="button"
          className={`btn-ghost ${hero ? "!p-2" : ""} ${socratic ? "!text-spark-400" : "text-fog-400"}`}
          title={socratic ? "Think with me: on — Ponder guides you with questions" : "Think with me — Ponder asks guiding questions instead of answering"}
          aria-pressed={socratic}
          aria-label="Toggle Socratic mode"
          onClick={() => setSocratic((v) => !v)}
        >
          <SocraticIcon />
        </button>
        <select
          className={`bg-ink-800 border border-ink-600 rounded-lg text-xs text-fog-300 px-2 py-1.5 focus:outline-none hidden sm:block`}
          value={speed}
          onChange={(e) => setSpeed(e.target.value as "fast" | "quality")}
          aria-label="Model speed"
          title="Model speed — Fast answers quicker, Quality thinks longer"
        >
          <option value="fast">Fast</option>
          <option value="quality">Quality</option>
        </select>
        <button
          type="submit"
          className={`btn-primary !p-0 flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40 ${
            hero ? "w-10 h-10 rounded-xl" : "!px-3 !py-1.5"
          }`}
          disabled={disabled || !question.trim()}
          aria-label="Ask Ponder"
          title="Ask Ponder (Enter)"
        >
          <SendIcon className={hero ? "w-[18px] h-[18px]" : "w-4 h-4"} />
        </button>
      </form>

      {pickerOpen && (
        <div className="absolute bottom-full mb-2 left-0 z-30 popover-surface p-2 w-72" role="dialog" aria-label="Choose a study source">
          <p className="text-xs font-medium text-fog-100 px-1.5 pt-0.5 pb-1">Answer from a source</p>
          {materials.data?.map((m) => (
            <button
              key={m.id}
              className="w-full text-left text-xs text-fog-300 hover:bg-ink-700 hover:text-fog-100 rounded-lg px-2 py-1.5 flex items-center gap-1.5"
              onClick={() => {
                onMaterialChange?.(m.id);
                setPickerOpen(false);
              }}
            >
              <SourceIcon className="w-3.5 h-3.5 shrink-0 ponder-mark" aria-hidden="true" />
              <span className="truncate">{m.title}</span>
            </button>
          ))}
          {materialId && (
            <button
              className="w-full text-left text-xs text-fog-400 hover:text-fog-100 rounded-lg px-2 py-1.5"
              onClick={() => {
                onMaterialChange?.(null);
                setPickerOpen(false);
              }}
            >
              No source (normal answers)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
