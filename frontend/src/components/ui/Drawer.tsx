import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./Icons";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  hint?: string;
  children: ReactNode;
  /** Desktop width class (default 384px). Full-width sheet under the sm breakpoint. */
  widthClass?: string;
}

/**
 * Right-side application drawer (spec §1/§18/§20/§21): slides in from the right,
 * always inside the viewport (fixed inset-y-0 right-0 within the app shell), never
 * clipped, above all page content (z-50), dimmed backdrop, Escape + backdrop + close
 * button, focus moved into the panel on open and restored to the opener on close.
 */
export function Drawer({ open, onClose, title, hint, children, widthClass = "max-w-[400px]" }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the panel so keyboard users land inside; Escape closes.
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* dimmed backdrop — the conversation stays visible underneath */}
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={`absolute right-0 top-0 h-full w-full sm:w-[92vw] ${widthClass} max-w-full popover-surface !rounded-none sm:!rounded-l-2xl border-l border-ink-700 overflow-y-auto animate-slide-in outline-none flex flex-col`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-ink-700/70">
          <div>
            <h2 id={titleId} className="text-sm font-medium text-fog-100">
              {title}
            </h2>
            {hint && <p className="text-xs text-fog-400 mt-0.5">{hint}</p>}
          </div>
          <button className="btn-ghost shrink-0" title="Close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
