import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "./Icons";

interface PopoverProps {
  /** The control that opens the popover (button). Receives aria wiring automatically. */
  trigger: (props: { onClick: () => void; ref: React.RefObject<HTMLButtonElement>; "aria-expanded": boolean; "aria-haspopup": "dialog" }) => ReactNode;
  /** Heading shown at the top of the popover — makes the open state self-explanatory. */
  title: string;
  /** Optional one-line hint under the title. */
  hint?: string;
  /** Called after the popover closes (via Esc, outside click, or close button). */
  onClose?: () => void;
  children: ReactNode;
  align?: "left" | "right";
  /** Which way the panel opens: "top" floats above the trigger (bottom bars), "bottom" below (top bars). */
  placement?: "top" | "bottom";
}

/**
 * Minimal accessible popover: labelled dialog, Escape to close, click-outside to close,
 * explicit close button, focus moved into the panel on open and restored on close.
 * Kept dependency-free on purpose — this is the only popover in the app.
 */
export function Popover({ trigger, title, hint, onClose, children, align = "left", placement = "top" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
    onClose?.();
  };

  // Escape + click-outside, only while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) {
        close(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {trigger({
        onClick: () => setOpen((o) => !o),
        ref: triggerRef,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
      })}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className={`absolute z-40 popover-surface p-3 w-64 ${
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div>
              <p id={titleId} className="text-sm font-medium text-fog-100">{title}</p>
              {hint && <p className="text-xs text-fog-400 mt-0.5">{hint}</p>}
            </div>
            <button className="btn-ghost shrink-0" title="Close" aria-label="Close" onClick={() => close(true)}>
              <CloseIcon />
            </button>
          </div>
          <div className="mt-2">{children}</div>
        </div>
      )}
    </>
  );
}
