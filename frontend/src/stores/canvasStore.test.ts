import { describe, it, expect, beforeEach } from "vitest";
import type { NodeEntity } from "@canvas-learn/shared";
import { useCanvasStore } from "./canvasStore";

const CANVAS_A = "11111111-1111-4111-8111-111111111111";
const CANVAS_B = "22222222-2222-4222-8222-222222222222";
const NODE_A1 = "33333333-3333-4333-8333-333333333333";
const NODE_A2 = "44444444-4444-4444-8444-444444444444";
const NODE_B1 = "55555555-5555-4555-8555-555555555555";

function makeNode(over: Partial<NodeEntity> & { id: string; canvas_id: string }): NodeEntity {
  return {
    parent_id: null,
    branch_origin: "thread",
    status: "answering",
    title: "",
    question: "q",
    answer_text: "",
    key_terms: [],
    suggested_followups: [],
    tags: [],
    visual: null,
    position: { x: 0, y: 0 },
    width: 420,
    collapsed: false,
    saved_to_library: false,
    model_used: "",
    web_search_used: false,
    context_summary: "",
    mode: "",
    sources: [],
    provenance: null,
    gaps: [],
    material_id: null,
    sections: [],
    note: "",
    important: false,
    review_state: { due_at: 0, interval_days: 1, ease: 0, stability: 0, difficulty: 0, last_reviewed_at: null, times_reviewed: 0 },
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

const node = (id: string, canvasId: string, over: Partial<NodeEntity> = {}): NodeEntity =>
  makeNode({ id, canvas_id: canvasId, ...over });

beforeEach(() => {
  useCanvasStore.setState({
    canvasId: null,
    canvasTitle: "",
    nodes: {},
    order: [],
    links: [],
    pathId: null,
    profile: null,
    map: null,
    streamingIds: new Set<string>(),
    focusRequest: null,
    viewports: {},
    past: [],
    future: [],
  });
});

describe("focusRequest — new answer routing (AC1/AC2/AC3)", () => {
  it("starts with no focus request", () => {
    expect(useCanvasStore.getState().focusRequest).toBeNull();
  });

  it("a node_created event requests focus on that node (seq 1)", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", []);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A1, CANVAS_A) });
    const st = useCanvasStore.getState();
    expect(st.focusRequest).toEqual({ nodeId: NODE_A1, seq: 1 });
    expect(st.streamingIds.has(NODE_A1)).toBe(true); // auto-focus waits for the answer to finish
  });

  it("consecutive questions: each new node bumps seq — the newest request always wins", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", []);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A1, CANVAS_A) });
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A, { parent_id: NODE_A1, branch_origin: "followup_box" }) });
    const st = useCanvasStore.getState();
    expect(st.focusRequest?.nodeId).toBe(NODE_A2);
    expect(st.focusRequest?.seq).toBe(2);
    // Both are still streaming; focus for the first stays deferred behind the second's seq.
    expect(st.streamingIds.has(NODE_A1)).toBe(true);
    expect(st.streamingIds.has(NODE_A2)).toBe(true);
  });

  it("done frees the streaming guard for the focused node without dropping the request", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", []);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A1, CANVAS_A) });
    useCanvasStore.getState().applyAskEvent({ type: "done", node_id: NODE_A1 });
    const st = useCanvasStore.getState();
    expect(st.streamingIds.has(NODE_A1)).toBe(false);
    expect(st.focusRequest?.nodeId).toBe(NODE_A1); // still pending for the stage to consume
  });

  it("done carrying the final node upserts it (provenance lands on the card without a refetch)", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", []);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A1, CANVAS_A) });
    expect(useCanvasStore.getState().nodes[NODE_A1]?.provenance).toBeNull();
    // The pipeline writes provenance after stage 2 and sends it inside `done`.
    useCanvasStore.getState().applyAskEvent({
      type: "done",
      node_id: NODE_A1,
      node: {
        ...node(NODE_A1, CANVAS_A, { status: "complete" }),
        provenance: { status: "sourced", quote: "the powerhouse of the cell", material_id: null },
      },
    });
    const st = useCanvasStore.getState();
    expect(st.streamingIds.has(NODE_A1)).toBe(false);
    expect(st.nodes[NODE_A1]?.provenance).toEqual({ status: "sourced", quote: "the powerhouse of the cell", material_id: null });
    expect(st.nodes[NODE_A1]?.status).toBe("complete");
  });

  it("a failed node (error) also frees the streaming guard", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", []);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A1, CANVAS_A) });
    useCanvasStore.getState().applyAskEvent({ type: "error", node_id: NODE_A1, message: "boom" });
    const st = useCanvasStore.getState();
    expect(st.streamingIds.has(NODE_A1)).toBe(false);
    expect(st.nodes[NODE_A1]?.status).toBe("failed");
  });

  it("stage2 settles the node (complete + title/followups/tags) while the focus request survives for the visual re-fit", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", []);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A1, CANVAS_A) });
    useCanvasStore.getState().applyAskEvent({ type: "stage2", node_id: NODE_A1, title: "Why the sky is blue", followups: ["f1"], tags: ["optics"] });
    const n = useCanvasStore.getState().nodes[NODE_A1]!;
    expect(n.status).toBe("complete");
    expect(n.title).toBe("Why the sky is blue");
    expect(n.suggested_followups).toEqual(["f1"]);
    expect(n.tags).toEqual(["optics"]);
    expect(useCanvasStore.getState().focusRequest?.nodeId).toBe(NODE_A1);
  });
});

describe("focusRequest — canvas navigation safety (AC4/AC6/AC7)", () => {
  it("loading a different canvas drops the stale focus request (no cross-canvas focus)", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", [node(NODE_A1, CANVAS_A)]);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A, { parent_id: NODE_A1 }) });
    expect(useCanvasStore.getState().focusRequest?.nodeId).toBe(NODE_A2);

    // User navigates to canvas B before the focus animates.
    useCanvasStore.getState().loadGraph(CANVAS_B, "B", [node(NODE_B1, CANVAS_B)]);
    const st = useCanvasStore.getState();
    expect(st.focusRequest).toBeNull();
    expect(st.streamingIds.size).toBe(0);
    // And B's own history is intact.
    expect(st.order).toEqual([NODE_B1]);
  });

  it("deleting the focused node clears the request (a focus that can never resolve)", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", [node(NODE_A1, CANVAS_A)]);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A, { parent_id: NODE_A1 }) });
    expect(useCanvasStore.getState().focusRequest?.nodeId).toBe(NODE_A2);
    useCanvasStore.getState().deleteNodeSubtree(NODE_A2);
    expect(useCanvasStore.getState().focusRequest).toBeNull();
  });

  it("deleting the focused node's ancestor (whole subtree) also clears the request", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", [node(NODE_A1, CANVAS_A)]);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A, { parent_id: NODE_A1 }) });
    useCanvasStore.getState().deleteNodeSubtree(NODE_A1); // takes the focus target (A2) with it
    expect(useCanvasStore.getState().focusRequest).toBeNull();
  });

  it("deleting an unrelated node keeps the focus request", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", [node(NODE_A1, CANVAS_A, { parent_id: NODE_B1 })]);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A) });
    useCanvasStore.getState().deleteNodeSubtree(NODE_A1);
    expect(useCanvasStore.getState().focusRequest?.nodeId).toBe(NODE_A2);
  });
});

describe("canvas_titled event — live conversation naming", () => {
  it("updates the header title when the viewed canvas gets its real title", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "Untitled canvas", []);
    useCanvasStore.getState().applyAskEvent({ type: "canvas_titled", canvas_id: CANVAS_A, title: "Gravity" });
    expect(useCanvasStore.getState().canvasTitle).toBe("Gravity");
  });

  it("ignores canvas_titled for other canvases (no cross-canvas crosstalk)", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "Untitled canvas", []);
    useCanvasStore.getState().applyAskEvent({ type: "canvas_titled", canvas_id: CANVAS_B, title: "Moon" });
    expect(useCanvasStore.getState().canvasTitle).toBe("Untitled canvas");
  });

  it("does not touch node state or streaming (title events are metadata-only)", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "Untitled canvas", [node(NODE_A1, CANVAS_A)]);
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A) });
    useCanvasStore.getState().applyAskEvent({ type: "canvas_titled", canvas_id: CANVAS_A, title: "Black Hole" });
    const st = useCanvasStore.getState();
    expect(st.canvasTitle).toBe("Black Hole");
    expect(st.streamingIds.has(NODE_A2)).toBe(true);
    expect(st.order).toEqual([NODE_A1, NODE_A2]);
  });
});

describe("per-canvas viewport memory (AC5: refresh/navigation restores the right view)", () => {
  it("stores one viewport per canvas, independently", () => {
    const st = useCanvasStore.getState();
    st.setCanvasViewport(CANVAS_A, { x: 10, y: 20, zoom: 0.8 });
    st.setCanvasViewport(CANVAS_B, { x: -30, y: 40, zoom: 1.1 });
    const s = useCanvasStore.getState();
    expect(s.viewports[CANVAS_A]).toEqual({ x: 10, y: 20, zoom: 0.8 });
    expect(s.viewports[CANVAS_B]).toEqual({ x: -30, y: 40, zoom: 1.1 });
  });

  it("setting the identical viewport is a no-op (no state churn)", () => {
    useCanvasStore.getState().setCanvasViewport(CANVAS_A, { x: 1, y: 2, zoom: 1 });
    const before = useCanvasStore.getState();
    useCanvasStore.getState().setCanvasViewport(CANVAS_A, { x: 1, y: 2, zoom: 1 });
    expect(useCanvasStore.getState()).toBe(before);
  });

  it("loading a canvas does not wipe other canvases' saved viewports", () => {
    useCanvasStore.getState().setCanvasViewport(CANVAS_A, { x: 1, y: 2, zoom: 1 });
    useCanvasStore.getState().loadGraph(CANVAS_B, "B", [node(NODE_B1, CANVAS_B)]);
    expect(useCanvasStore.getState().viewports[CANVAS_A]).toEqual({ x: 1, y: 2, zoom: 1 });
  });
});

describe("requestFocus — jumping to an existing node (Source Explorer)", () => {
  it("requests focus with a fresh, monotonically increasing seq", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", [node(NODE_A1, CANVAS_A, { status: "complete" })]);
    useCanvasStore.getState().requestFocus(NODE_A1);
    expect(useCanvasStore.getState().focusRequest).toEqual({ nodeId: NODE_A1, seq: 1 });
    useCanvasStore.getState().requestFocus(NODE_A1);
    expect(useCanvasStore.getState().focusRequest).toEqual({ nodeId: NODE_A1, seq: 2 });
  });

  it("a later node_created beats an earlier manual focus request", () => {
    useCanvasStore.getState().loadGraph(CANVAS_A, "A", [node(NODE_A1, CANVAS_A, { status: "complete" })]);
    useCanvasStore.getState().requestFocus(NODE_A1); // seq 1
    useCanvasStore.getState().applyAskEvent({ type: "node_created", node: node(NODE_A2, CANVAS_A, { parent_id: NODE_A1, branch_origin: "followup_box" }) });
    expect(useCanvasStore.getState().focusRequest).toEqual({ nodeId: NODE_A2, seq: 2 });
  });
});
