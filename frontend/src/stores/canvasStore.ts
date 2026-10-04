import { create } from "zustand";
import type { NodeEntity, AskEvent, VisualBlock, LearningProfile, ThinkingMap } from "@canvas-learn/shared";

export interface CanvasLink {
  id: string;
  source: string;
  target: string;
  label: string;
}

/** React Flow viewport transform ({x, y, zoom}) — kept in its own shape so the store doesn't import the canvas lib. */
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/** A question just created this node; the canvas should pan/zoom to its answer. */
export interface FocusRequest {
  nodeId: string;
  /** Monotonic — lets the stage ignore stale requests (consecutive questions). */
  seq: number;
}

export interface CanvasState {
  canvasId: string | null;
  canvasTitle: string;
  nodes: Record<string, NodeEntity>;
  order: string[]; // insertion order for stable rendering
  links: CanvasLink[];
  pathId: string | null;
  profile: LearningProfile | null;
  /** this canvas's thinking map (thinking-spec §3), when generated */
  map: ThinkingMap | null;
  streamingIds: Set<string>;
  /** Set on `node_created`; consumed by CanvasStage once the node's layout is stable. */
  focusRequest: FocusRequest | null;
  /** Last viewport per canvas (in-session memory; restored when navigating back). */
  viewports: Record<string, CanvasViewport>;
  past: Snapshot[];
  future: Snapshot[];
}

type Snapshot = { nodes: Record<string, NodeEntity>; order: string[] };

interface CanvasActions {
  loadGraph: (
    canvasId: string,
    canvasTitle: string,
    nodes: NodeEntity[],
    opts?: { links?: CanvasLink[]; pathId?: string | null; profile?: LearningProfile | null; map?: ThinkingMap | null },
  ) => void;
  reset: () => void;
  upsertNode: (n: NodeEntity) => void;
  setProfile: (p: LearningProfile) => void;
  addLink: (l: CanvasLink) => void;
  removeLink: (id: string) => void;
  patchNodeLocal: (id: string, patch: Partial<NodeEntity>) => void;
  applyAskEvent: (e: AskEvent) => void;
  /**
   * Pan/zoom to an EXISTING node (e.g. the Source Explorer opening an answer).
   * The stage's auto-focus effect resolves it: the node is already settled, so
   * it frames on the next stable layout — same path as a fresh answer.
   */
  requestFocus: (nodeId: string) => void;
  moveNode: (id: string, position: { x: number; y: number }, recordHistory?: boolean) => void;
  setCollapsed: (id: string, collapsed: boolean) => void;
  deleteNodeSubtree: (id: string) => string[];
  renameCanvas: (title: string) => void;
  setCanvasViewport: (canvasId: string, vp: CanvasViewport) => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => void;
}

export type CanvasStore = CanvasState & CanvasActions;

const HISTORY_LIMIT = 50;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
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

  loadGraph: (canvasId, canvasTitle, nodes, opts) => {
    const map: Record<string, NodeEntity> = {};
    const order: string[] = [];
    for (const n of nodes) {
      map[n.id] = n;
      order.push(n.id);
    }
    set({
      canvasId,
      canvasTitle,
      nodes: map,
      order,
      links: opts?.links ?? [],
      pathId: opts?.pathId ?? null,
      profile: opts?.profile ?? null,
      map: opts?.map ?? null,
      // A different canvas loaded: any pending auto-focus belongs to the old one.
      focusRequest: null,
      past: [],
      future: [],
      streamingIds: new Set(),
    });
  },

  reset: () =>
    set({
      canvasId: null,
      canvasTitle: "",
      nodes: {},
      order: [],
      links: [],
      pathId: null,
      profile: null,
      map: null,
      focusRequest: null,
      past: [],
      future: [],
    }),

  upsertNode: (n) =>
    set((s) => ({
      nodes: { ...s.nodes, [n.id]: n },
      order: s.nodes[n.id] ? s.order : [...s.order, n.id],
    })),

  snapshot: () =>
    set((s) => ({
      past: [...s.past.slice(-HISTORY_LIMIT + 1), { nodes: s.nodes, order: s.order }],
      future: [],
    })),

  applyAskEvent: (e) => {
    const s = get();
    switch (e.type) {
      case "node_created": {
        s.upsertNode(e.node);
        set((st) => ({
          streamingIds: new Set(st.streamingIds).add(e.node.id),
          // This question owns a new node: the canvas should follow it once its
          // answer renders. Bumped seq = the newest request always wins.
          focusRequest: { nodeId: e.node.id, seq: (st.focusRequest?.seq ?? 0) + 1 },
        }));
        break;
      }
      case "delta": {
        const cur = s.nodes[e.node_id];
        if (!cur) break;
        set((st) => ({
          nodes: { ...st.nodes, [e.node_id]: { ...cur, answer_text: cur.answer_text + e.text } },
        }));
        break;
      }
      case "reset": {
        // failover: clear partial tokens from the failed candidate and restart streaming
        const rcur = s.nodes[e.node_id];
        if (!rcur) break;
        set((st) => ({ nodes: { ...st.nodes, [e.node_id]: { ...rcur, answer_text: "" } } }));
        break;
      }
      case "stage2": {
        const cur = s.nodes[e.node_id];
        if (!cur) break;
        set((st) => ({
          nodes: {
            ...st.nodes,
            [e.node_id]: {
              ...cur,
              title: e.title || cur.title,
              suggested_followups: e.followups.length ? e.followups : cur.suggested_followups,
              tags: e.tags.length ? e.tags : cur.tags,
              status: "complete",
            },
          },
        }));
        break;
      }
      case "visual_status": {
        const cur = s.nodes[e.node_id];
        if (!cur) break;
        const visual: VisualBlock = {
          type: cur.visual?.type ?? "none",
          status: e.status,
          spec: cur.visual?.spec ?? null,
        };
        set((st) => ({ nodes: { ...st.nodes, [e.node_id]: { ...cur, visual } } }));
        break;
      }
      case "visual": {
        const cur = s.nodes[e.node_id];
        if (!cur) break;
        set((st) => ({ nodes: { ...st.nodes, [e.node_id]: { ...cur, visual: e.block as VisualBlock } } }));
        break;
      }
      case "done": {
        set((st) => {
          const streaming = new Set(st.streamingIds);
          streaming.delete(e.node_id);
          // The done event carries the FINAL node (provenance/gaps/sections land
          // after stage 2) — upsert it so the card renders without a refetch.
          const nodes = e.node ? { ...st.nodes, [e.node_id]: e.node } : st.nodes;
          return { streamingIds: streaming, nodes };
        });
        break;
      }
      case "canvas_titled":
        // Server derived the conversation title from the first real Q&A —
        // update the header live when this is the canvas we're viewing.
        if (e.canvas_id === s.canvasId) set({ canvasTitle: e.title });
        break;
      case "error": {
        const failedId = e.node_id;
        if (failedId) {
          const cur = s.nodes[failedId];
          set((st) => ({
            nodes: cur ? { ...st.nodes, [failedId]: { ...cur, status: "failed" } } : st.nodes,
            streamingIds: new Set([...st.streamingIds].filter((id) => id !== failedId)),
          }));
        }
        break;
      }
    }
  },

  requestFocus: (nodeId) =>
    set((s) => ({ focusRequest: { nodeId, seq: (s.focusRequest?.seq ?? 0) + 1 } })),

  setProfile: (p) => set({ profile: p }),

  addLink: (l) => set((s) => ({ links: [...s.links, l] })),

  removeLink: (id) => set((s) => ({ links: s.links.filter((l) => l.id !== id) })),

  patchNodeLocal: (id, patch) => {
    const cur = get().nodes[id];
    if (!cur) return;
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...cur, ...patch } } }));
  },

  moveNode: (id, position, recordHistory = false) => {
    if (recordHistory) get().snapshot();
    const cur = get().nodes[id];
    if (!cur) return;
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...cur, position } } }));
  },

  setCollapsed: (id, collapsed) => {
    get().snapshot();
    const cur = get().nodes[id];
    if (!cur) return;
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...cur, collapsed } } }));
  },

  deleteNodeSubtree: (id) => {
    get().snapshot();
    const { nodes, order } = get();
    const doomed = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      doomed.add(cur);
      for (const other of order) {
        if (!doomed.has(other) && nodes[other]?.parent_id === cur) stack.push(other);
      }
    }
    const nextNodes: Record<string, NodeEntity> = {};
    for (const key of order) {
      if (!doomed.has(key) && nodes[key]) nextNodes[key] = nodes[key]!;
    }
    set((s) => ({
      nodes: nextNodes,
      order: order.filter((k) => !doomed.has(k)),
      // A pending focus on a deleted node can never resolve — drop it.
      focusRequest: s.focusRequest && doomed.has(s.focusRequest.nodeId) ? null : s.focusRequest,
    }));
    return [...doomed];
  },

  renameCanvas: (title) => set({ canvasTitle: title }),

  setCanvasViewport: (canvasId, vp) =>
    set((s) => {
      const cur = s.viewports[canvasId];
      return cur && cur.x === vp.x && cur.y === vp.y && cur.zoom === vp.zoom ? s : { viewports: { ...s.viewports, [canvasId]: vp } };
    }),

  undo: () => {
    const { past, nodes, order, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1]!;
    set({
      nodes: prev.nodes,
      order: prev.order,
      past: past.slice(0, -1),
      future: [...future, { nodes, order }],
    });
  },

  redo: () => {
    const { past, nodes, order, future } = get();
    if (!future.length) return;
    const next = future[future.length - 1]!;
    set({
      nodes: next.nodes,
      order: next.order,
      future: future.slice(0, -1),
      past: [...past, { nodes, order }],
    });
  },
}));
