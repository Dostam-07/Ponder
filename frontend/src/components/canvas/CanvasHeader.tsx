import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useCanvasStore } from "../../stores/canvasStore";
import { SparkleIcon, PaletteIcon, ChevronRightIcon } from "../ui/Icons";

interface Props {
  onOpenPersonalize: () => void;
  personalizeOpen: boolean;
}

/**
 * Contextual canvas header (spec §3–4): the REAL canvas title from store state,
 * inline-editable (existing rename API), always visible while panning/scrolling.
 */
export function CanvasHeader({ onOpenPersonalize, personalizeOpen }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const title = useCanvasStore((s) => s.canvasTitle);
  const renameLocal = useCanvasStore((s) => s.renameCanvas);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // All hooks run unconditionally (Rules of Hooks) — the canvas-open check
  // happens at render time, not before hooks.
  const rename = useMutation({
    mutationFn: (t: string) => api.renameCanvas(canvasId ?? "", t),
    onSuccess: (_res, t) => {
      renameLocal(t);
      qc.invalidateQueries({ queryKey: ["canvases"] });
    },
  });

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // A canvas must be open; Home has no header.
  if (!canvasId) return null;

  const startEdit = () => {
    setValue(title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const t = value.trim();
    if (t && t !== title) rename.mutate(t);
  };

  const displayTitle = title.trim() ? title : "Untitled canvas";

  return (
    <div className="absolute top-3 left-14 lg:top-4 lg:left-4 z-10 flex items-center gap-2 max-w-[calc(100%-6rem)] lg:max-w-[calc(100%-18rem)]">
      {/* breadcrumb: Canvases / <title> — real title from state */}
      <nav
        className="flex items-center gap-1 bg-ink-850/95 backdrop-blur border border-ink-700 rounded-lg pl-2.5 pr-1.5 py-1.5 min-w-0"
        aria-label="Canvas location"
      >
        <a href="#/canvases" className="text-xs text-fog-400 hover:text-fog-100 transition-colors shrink-0" title="Back to canvas history">
          Canvases
        </a>
        <ChevronRightIcon className="w-3 h-3 text-fog-400 shrink-0" aria-hidden="true" />
        {editing ? (
          <input
            ref={inputRef}
            className="bg-transparent border-b border-spark-500 text-sm text-fog-100 focus:outline-none w-40 sm:w-56"
            value={value}
            aria-label="Canvas title"
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            className="flex items-center gap-1.5 min-w-0 text-sm font-medium text-fog-100 hover:text-spark-400 transition-colors"
            onClick={startEdit}
            title="Rename canvas"
            aria-label={`Rename canvas ${displayTitle}`}
          >
            <SparkleIcon className="w-3.5 h-3.5 ponder-mark shrink-0" aria-hidden="true" />
            <span className="truncate max-w-[9rem] sm:max-w-[14rem]">{displayTitle}</span>
          </button>
        )}
      </nav>

      {/* Personalize entry — opens the drawer (spec §1) */}
      <button
        className={`btn-ghost bg-ink-850/95 backdrop-blur border border-ink-700 rounded-lg text-xs px-2.5 py-1.5 flex items-center gap-1.5 ${
          personalizeOpen ? "!text-spark-400" : "text-fog-300 hover:text-spark-400"
        }`}
        onClick={onOpenPersonalize}
        title="Personalize how Ponder teaches you"
        aria-label="Personalize learning"
        aria-expanded={personalizeOpen}
        aria-haspopup="dialog"
      >
        <PaletteIcon className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Personalize</span>
      </button>

      {rename.isPending && <span className="text-[11px] text-fog-400">Renaming…</span>}
    </div>
  );
}
