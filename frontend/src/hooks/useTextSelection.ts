import { useEffect, useRef } from "react";
import type { SelectionAnchor } from "../components/ask/AskPonder";

/**
 * Watches text selections inside elements marked `.ponder-selectable` and reports
 * them as Ask-Ponder anchors. Handles mouse and keyboard (shift+arrow) selection,
 * ignores collapsed selections and selections inside the Ask Ponder panel itself.
 */
export function useTextSelection(
  onSelection: (anchor: SelectionAnchor) => void,
  onClear: () => void,
) {
  // Latest callbacks without resubscribing.
  const cbRef = useRef({ onSelection, onClear });
  cbRef.current = { onSelection, onClear };

  useEffect(() => {
    let hadSelection = false;
    // Dedupe: reporting the same selection twice would re-render the app and
    // (in React Flow) recreate the text nodes, destroying the live selection.
    let lastSignature = "";

    const check = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";

      if (!sel || sel.isCollapsed || text.length < 2) {
        // If focus sits in an input/textarea, the field took the document selection
        // (e.g. the Ask Ponder panel auto-focusing its input) — that is not a
        // user dismissal, so keep the current anchor.
        const ae = document.activeElement;
        const typing =
          ae instanceof HTMLElement &&
          (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
        if (typing) return;
        if (hadSelection) {
          hadSelection = false;
          lastSignature = "";
          cbRef.current.onClear();
        }
        return;
      }

      // Must live inside a supported content area…
      const anchorNode = sel.anchorNode;
      const el =
        anchorNode instanceof Element
          ? anchorNode
          : anchorNode?.parentElement ?? null;
      const area = el?.closest(".ponder-selectable");
      if (!area) return;

      // …and not inside the Ask Ponder panel itself.
      if (area.closest("[role='dialog']")) return;

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const nodeId = (area.closest("[data-node-id]") as HTMLElement | null)?.dataset.nodeId ?? "";
      // Round the rect so sub-pixel jitter doesn't count as a change.
      const signature = `${text}|${nodeId}|${Math.round(rect.top)}|${Math.round(rect.left)}`;
      if (signature === lastSignature) return;

      hadSelection = true;
      lastSignature = signature;
      cbRef.current.onSelection({
        text: text.slice(0, 1200),
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        nodeId,
      });
    };

    const onUp = () => window.setTimeout(check, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === "Escape") window.setTimeout(check, 0);
    };
    // selectionchange catches everything mouseup/keyup miss: mobile long-press,
    // double-click word selection, select-all, IME selections…
    let scTimer: number | undefined;
    const onSelectionChange = () => {
      window.clearTimeout(scTimer);
      scTimer = window.setTimeout(check, 150);
    };

    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKey);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      window.clearTimeout(scTimer);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);
}
