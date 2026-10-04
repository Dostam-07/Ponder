import type { AskRequest } from "@canvas-learn/shared";
import type { Route } from "../hooks/useHashRoute";

/** Where a question was submitted from: Home/other pages ("home") or from inside a canvas ("canvas"). */
export type AskOrigin = "home" | "canvas";

/** Explicit routing outcome for a submitted question. */
export type AskTarget =
  | /** Brand-new canvas + brand-new conversation. Never an existing canvas. */
    { kind: "new-canvas" }
  | /** Continue the conversation of this one specific canvas (follow-up). */
    { kind: "existing-canvas"; canvasId: string };

/**
 * THE single routing rule for question submission (fixes the Home→existing-canvas bug):
 *
 * - A question submitted from Home (or any non-canvas page) ALWAYS gets a brand-new
 *   canvas. `existingCanvasIds` is accepted only so tests can prove the decision
 *   never depends on it: a Home question must never fall back into an existing
 *   conversation, regardless of which canvas was last opened or is most recent.
 * - A question submitted from inside a canvas continues THAT canvas's conversation,
 *   keeping its full history, context, and branches.
 */
export function resolveAskTarget(origin: AskOrigin, route: Route, existingCanvasIds: readonly string[] = []): AskTarget {
  if (origin === "canvas" && route.page === "canvas") {
    return { kind: "existing-canvas", canvasId: route.canvasId };
  }
  void existingCanvasIds; // Home asks are deliberately independent of existing canvases
  return { kind: "new-canvas" };
}

/**
 * A Home question waits in this queue for ITS OWN canvas to load, then streams onto it.
 * Keying the pending ask to the canvas it was created for makes it impossible for a
 * different, previously-opened canvas to swallow it later.
 */
export interface PendingAsk {
  /** The exact canvas created for this question. */
  canvasId: string;
  ask: Omit<AskRequest, "canvas_id">;
}

/**
 * Returns the queued question only when `canvasId` is the canvas it was created for.
 * Any other canvas (history click, deep link, refresh) gets `null` — no stale consumption.
 */
export function pendingAskFor(pending: PendingAsk | null, canvasId: string): Omit<AskRequest, "canvas_id"> | null {
  return pending && pending.canvasId === canvasId ? pending.ask : null;
}
