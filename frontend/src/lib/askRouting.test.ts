import { describe, it, expect } from "vitest";
import type { AskRequest } from "@canvas-learn/shared";
import { resolveAskTarget, pendingAskFor, type PendingAsk } from "./askRouting";
import { parseHash, routeToHash } from "../hooks/useHashRoute";

const CANVAS_A = "11111111-1111-4111-8111-111111111111";
const CANVAS_B = "22222222-2222-4222-8222-222222222222";

const homeAsk: Omit<AskRequest, "canvas_id"> = {
  parent_id: null,
  branch_origin: "thread",
  question: "Why is the sky blue?",
  position: { x: 0, y: 0 },
  model_speed: "fast",
  web_search: false,
};

describe("resolveAskTarget — Home questions always get a fresh canvas", () => {
  it("routes a Home question to a NEW canvas even when canvases already exist (regression)", () => {
    // Canvas list arrives most-recent-first: CANVAS_A is the one the bug routed into.
    expect(resolveAskTarget("home", { page: "home" }, [CANVAS_A, CANVAS_B])).toEqual({ kind: "new-canvas" });
    expect(resolveAskTarget("home", { page: "home" }, [CANVAS_A])).toEqual({ kind: "new-canvas" });
  });

  it("routes a Home question to a new canvas when no canvases exist", () => {
    expect(resolveAskTarget("home", { page: "home" }, [])).toEqual({ kind: "new-canvas" });
  });

  it("routes questions from other non-canvas pages (library/graph/review) to a new canvas", () => {
    for (const page of ["library", "graph", "review", "settings", "canvases"] as const) {
      expect(resolveAskTarget("home", { page }, [CANVAS_A])).toEqual({ kind: "new-canvas" });
    }
  });

  it("never returns an existing canvas id for a Home ask", () => {
    const targets = [
      resolveAskTarget("home", { page: "home" }, [CANVAS_A, CANVAS_B]),
      resolveAskTarget("home", { page: "library" }, [CANVAS_B]),
    ];
    for (const t of targets) {
      expect(t.kind).toBe("new-canvas");
      if (t.kind === "existing-canvas") throw new Error("Home ask must never reuse a canvas");
    }
  });
});

describe("resolveAskTarget — in-canvas follow-ups stay in the current canvas", () => {
  it("keeps a follow-up on the canvas the user is viewing", () => {
    expect(resolveAskTarget("canvas", { page: "canvas", canvasId: CANVAS_A })).toEqual({
      kind: "existing-canvas",
      canvasId: CANVAS_A,
    });
  });

  it("stays on the current canvas even when another canvas is more recent", () => {
    // CANVAS_B was touched most recently, but the user is on CANVAS_A — the
    // follow-up must NOT jump to the most recent canvas.
    expect(resolveAskTarget("canvas", { page: "canvas", canvasId: CANVAS_A }, [CANVAS_B, CANVAS_A])).toEqual({
      kind: "existing-canvas",
      canvasId: CANVAS_A,
    });
  });

  it("treats a canvas-origin submit while on a non-canvas page as a new-canvas ask", () => {
    // Defensive: if origin=canvas ever reaches us off a canvas page, fail safe to a
    // fresh canvas rather than inventing a target id.
    expect(resolveAskTarget("canvas", { page: "home" }, [CANVAS_A])).toEqual({ kind: "new-canvas" });
  });
});

describe("pendingAskFor — queued Home questions only stream onto their own canvas", () => {
  it("returns the question when the canvas it was created for loads", () => {
    const pending: PendingAsk = { canvasId: CANVAS_A, ask: homeAsk };
    expect(pendingAskFor(pending, CANVAS_A)).toEqual(homeAsk);
  });

  it("returns null for any other canvas (no stale consumption)", () => {
    const pending: PendingAsk = { canvasId: CANVAS_A, ask: homeAsk };
    expect(pendingAskFor(pending, CANVAS_B)).toBeNull();
    expect(pendingAskFor(pending, "99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  it("returns null when nothing is pending", () => {
    expect(pendingAskFor(null, CANVAS_A)).toBeNull();
  });
});

describe("parseHash / routeToHash — refresh and direct-link safety", () => {
  it("restores a canvas deep link on refresh", () => {
    expect(parseHash(`#/canvas/${CANVAS_A}`)).toEqual({ page: "canvas", canvasId: CANVAS_A });
  });

  it("restores home for empty or bare hashes", () => {
    expect(parseHash("")).toEqual({ page: "home" });
    expect(parseHash("#")).toEqual({ page: "home" });
    expect(parseHash("#/")).toEqual({ page: "home" });
  });

  it("opens history for Canvas navigation without choosing an existing canvas", () => {
    expect(parseHash("#/canvases")).toEqual({ page: "canvases" });
    expect(parseHash("#/canvas")).toEqual({ page: "canvases" });
    expect(routeToHash({ page: "canvases" })).toBe("#/canvases");
  });

  it("round-trips every route", () => {
    const routes = [
      { page: "canvas" as const, canvasId: CANVAS_A },
      { page: "home" as const },
      { page: "canvases" as const },
      { page: "library" as const },
      { page: "graph" as const },
      { page: "settings" as const },
      { page: "review" as const },
    ];
    for (const r of routes) {
      expect(parseHash(routeToHash(r))).toEqual(r);
    }
  });
});
