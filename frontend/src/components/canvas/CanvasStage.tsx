import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  useNodes,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type Node as RFNode,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { shallow } from "zustand/shallow";
import "@xyflow/react/dist/style.css";
import type { NodeEntity, AskRequest } from "@canvas-learn/shared";
import { useCanvasStore } from "../../stores/canvasStore";
import { NodeCard, type FlowNodeData } from "./NodeCard";
import { childPosition, type PlusDirection } from "../../lib/layout";
import {
  answerGroupBox,
  boxChanged,
  boxCenter,
  computeFocusViewport,
  DEFAULT_CARD,
  entitiesBBox,
  fitAllViewport,
  rectToGraphBox,
  type Box,
} from "../../lib/viewport";
import { ZoomInIcon, ZoomOutIcon, MaximizeIcon, UndoIcon, RedoIcon } from "../ui/Icons";
import { api } from "../../lib/api";

/** How long the layout must be size-stable before the focus animation runs (debounce, not a content wait — it resets on every re-measure). */
const FOCUS_STABLE_MS = 450;
/** Duration of the pan-and-zoom animation. */
const FOCUS_ANIM_MS = 600;

const nodeTypes = { card: NodeCard };

interface Props {
  onAsk: (req: Omit<AskRequest, "canvas_id">) => void;
}

type CardNode = RFNode<FlowNodeData>;

export function CanvasStage({ onAsk }: Props) {
  const store = useCanvasStore();
  const canvasId = useCanvasStore((s) => s.canvasId);
  const focusRequest = useCanvasStore((s) => s.focusRequest);
  const streamingIds = useCanvasStore((s) => s.streamingIds);
  const { zoomIn, zoomOut, setCenter, setViewport } = useReactFlow();
  const flowStore = useStoreApi();

  const paneRef = useRef<HTMLDivElement>(null);

  // React Flow v12 (controlled `nodes` prop): measured dimensions live in the
  // flow store's `nodeLookup`, NOT on the nodes we pass as props. To make the
  // flow aware of sizes — and to re-render this component exactly when a node
  // is (re)measured (card grows while streaming, visual renders later) — we
  // subscribe to a derived size list and carry `measured` back onto our node
  // props (see the nodes memo below). This is the event source for all
  // viewport logic; no polling, no arbitrary waits.
  const measuredDims = useStore(
    useCallback(
      (s) => store.order.map((id) => {
        const m = s.nodeLookup.get(id)?.measured;
        return m?.width && m?.height ? `${m.width}x${m.height}` : "";
      }),
      [store.order],
    ),
    shallow,
  );

  // Reactive view of the flow's nodes (positions + the carried-over `measured` sizes).
  const flowNodes = useNodes();

  // Roadmap E — collapse measurement BURSTS into one re-adopt. Under culling,
  // zooming across the LOD threshold remounts many cards at once, and each
  // measurement event used to re-adopt the nodes array mid-zoom-animation —
  // which swallowed the zoom (live E2E: zoom-in needed 2-4 clicks per step,
  // sometimes stuck until reload). The flow now receives updated sizes at most
  // once per 80ms of quiescence: auto-focus (450ms debounce) is unaffected,
  // and the viewport animation completes before the single re-adopt lands.
  const [debouncedDims, setDebouncedDims] = useState<string[]>([]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedDims(measuredDims), 80);
    return () => window.clearTimeout(t);
  }, [measuredDims]);

  // Culling-safe canvas bounds (roadmap E): positions come from the entity store
  // (the layout truth), sizes from the measured cache where known and DEFAULT_CARD
  // elsewhere. Off-screen nodes are NEVER rendered under `onlyRenderVisibleElements`,
  // so waiting for every node to be measured (the old `allMeasured` gate) would
  // block the initial fit forever on large canvases.
  const allBoxInfo = useMemo(() => {
    if (store.order.length === 0) return { box: null, allMeasured: false };
    const lookup = flowStore.getState().nodeLookup;
    const entries: { x: number; y: number; width: number; height: number }[] = [];
    let allMeasured = true;
    for (const id of store.order) {
      const n = store.nodes[id];
      if (!n) continue;
      const m = lookup.get(id)?.measured;
      if (!m?.width || !m?.height) allMeasured = false;
      entries.push({
        x: n.position.x,
        y: n.position.y,
        width: m?.width ?? n.width ?? DEFAULT_CARD.width,
        height: m?.height ?? DEFAULT_CARD.height,
      });
    }
    return {
      box: entitiesBBox(entries, 40),
      // True when every node of this canvas has a measured size — the signal
      // that an ESTIMATED fit (below) can be corrected to the exact one.
      allMeasured: entries.length > 0 && allMeasured,
    };
    // debouncedDims re-runs this when nodes (re)measure (batched) — only
    // matters if the one-shot fit has not fired yet.
  }, [store.order, store.nodes, debouncedDims, flowStore]);
  const allBox = allBoxInfo.box;
  const allMeasuredNow = allBoxInfo.allMeasured;

  // One initial fit per canvas visit (guard against re-fit loops as nodes
  // re-measure); new answers are handled by the auto-focus effect below.
  const fittedRef = useRef<{ canvasId: string; exact: boolean } | null>(null);

  // ---- initial viewport on canvas load: restore the saved one, or fit-all on first visit ----
  useEffect(() => {
    if (!canvasId) return;
    const saved = useCanvasStore.getState().viewports[canvasId];
    if (saved) {
      fittedRef.current = { canvasId, exact: true };
      setViewport(saved, { duration: 0 }); // back where the user left off — no cross-canvas animation
      return;
    }
    const pane = paneRef.current;
    if (!pane || pane.clientWidth === 0 || !allBox) return; // re-runs once layout / first card lands
    const cur = fittedRef.current;
    if (cur?.canvasId === canvasId && cur.exact) return; // this visit is done (exact fit or saved)

    if (allMeasuredNow) {
      // Every node has a measured size → EXACT fit. This is either the first
      // shot (small canvases — identical to the pre-culling behavior) or the
      // one-time correction of an estimated fit (lands within ~2 frames, so it
      // is an invisible snap, never a post-focus yank).
      fittedRef.current = { canvasId, exact: true };
      setViewport(fitAllViewport(allBox, { width: pane.clientWidth, height: pane.clientHeight }), {
        duration: cur?.canvasId === canvasId ? 0 : 400,
      });
    } else if (cur?.canvasId !== canvasId) {
      // First visit, sizes not all known yet — on a large canvas under culling
      // this NEVER changes (off-screen nodes are never measured), so take the
      // estimated fit now instead of the old behavior (wait forever → viewport
      // stuck at {0,0,1}). The correction above runs if measurements do land.
      // An EMPTY canvas (allBox null) never gets here — preserving the
      // "fresh answer stuck top-left" fix: the fit fires when the first card exists.
      fittedRef.current = { canvasId, exact: false };
      setViewport(fitAllViewport(allBox, { width: pane.clientWidth, height: pane.clientHeight }), { duration: 400 });
    }
    // Deliberately NOT fitting on every nodes change — new answers are handled
    // by the auto-focus effect below (fitting everything is exactly the old bug).
  }, [canvasId, allBox, allMeasuredNow, setViewport]);

  // ---- auto-focus: pan/zoom to the newest answer once its layout is stable ----
  const userOverrideSeqRef = useRef(0);
  const lastFocusedBoxRef = useRef<Box | null>(null);

  // User-initiated pan/zoom cancels auto-focus for the CURRENT request only
  // (programmatic viewport changes pass no event, so they never cancel it).
  const onMoveStart = useCallback((event?: unknown) => {
    if (event) {
      userOverrideSeqRef.current = useCanvasStore.getState().focusRequest?.seq ?? 0;
    }
  }, []);

  // Remember where the user left the viewport, per canvas. (onMoveEnd only fires
  // for user gestures in this React Flow version; programmatic auto-focus saves
  // its own final viewport explicitly, below.)
  const onMoveEnd = useCallback((_event?: unknown, vp?: { x: number; y: number; zoom: number }) => {
    const st = useCanvasStore.getState();
    if (st.canvasId && vp) st.setCanvasViewport(st.canvasId, vp);
  }, []);

  /**
   * Graph-space box of one node: prefers React Flow's cached measured size,
   * and — when that cache has not landed yet (observed live: missing for
   * minutes on a rendered card, which silently killed auto-focus) — falls
   * back to the element's own DOM bounding rect: the real measured box.
   */
  const nodeBox = useCallback(
    (id: string): Box | null => {
      const fn = flowNodes.find((n) => n.id === id);
      const m = fn?.measured;
      if (fn?.position && m?.width && m?.height) {
        return { x: fn.position.x, y: fn.position.y, width: m.width, height: m.height };
      }
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      if (!el) return null;
      const [tx, ty, tz] = flowStore.getState().transform; // v12: transform [x, y, zoom]
      return rectToGraphBox(el.getBoundingClientRect(), { x: tx, y: ty, zoom: tz });
    },
    [flowNodes, flowStore],
  );

  /** Measured box of `nodeId` — the "answer group" (policy in lib/viewport.ts), keeping the question in view. */
  const buildFocusBox = useCallback(
    (nodeId: string): Box | null => {
      const box = nodeBox(nodeId);
      if (!box) return null;
      const parentId = (flowNodes.find((n) => n.id === nodeId)?.data as FlowNodeData | undefined)?.node?.parent_id;
      if (!parentId) return box;
      const parent = nodeBox(parentId);
      return parent ? answerGroupBox(box, parent) : box;
    },
    [nodeBox, flowNodes],
  );

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.seq <= userOverrideSeqRef.current) return; // user took control of the view
    // Settle gate: focus as soon as the ANSWER is done (stage2 → status complete,
    // or a failure). Deliberately NOT "stream fully closed" — the SSE stream
    // stays open for post-answer enhancements (gaps/sections/visual), which can
    // take minutes on local models; waiting for that left the viewport parked on
    // the old position long after the answer was on screen. A visual rendering
    // later grows the card → re-measure → boxChanged → one gentle re-fit below
    // (still cancelled if the user has taken control).
    const focusNode = useCanvasStore.getState().nodes[focusRequest.nodeId];
    const settled = !!focusNode && (focusNode.status === "complete" || focusNode.status === "failed");
    if (!settled) return; // answer still in flight — re-runs as each render/measurement lands
    const box = buildFocusBox(focusRequest.nodeId);
    if (!box) {
      // Culling (roadmap E): the target sits off-screen, so React Flow has not
      // rendered it — no measured box exists yet. Its graph position IS known
      // from the entity store: center there (default-size guess) so the node
      // enters the viewport and renders; the measurement landing then re-runs
      // this effect and the precise answer-group fit happens via the normal
      // path below (lastFocusedBoxRef is still null → it will fire).
      const ent = useCanvasStore.getState().nodes[focusRequest.nodeId];
      const pane0 = paneRef.current;
      if (!ent || !pane0 || pane0.clientWidth === 0) return;
      const guess: Box = { x: ent.position.x, y: ent.position.y, width: ent.width ?? DEFAULT_CARD.width, height: DEFAULT_CARD.height };
      const vp = computeFocusViewport(guess, { width: pane0.clientWidth, height: pane0.clientHeight });
      const c = boxCenter(guess);
      setCenter(c.x, c.y, { zoom: vp.zoom, duration: FOCUS_ANIM_MS });
      return;
    }
    if (!boxChanged(lastFocusedBoxRef.current, box)) return; // nothing meaningfully new (no animation loops)
    const pane = paneRef.current;
    if (!pane || pane.clientWidth === 0) return;

    // Debounce: sections/visuals can still grow the card after the answer settles.
    // Every re-measure re-renders us (useNodes) and resets this timer, so the
    // animation fires only when the layout has actually settled.
    const timer = window.setTimeout(() => {
      const st = useCanvasStore.getState();
      if (st.focusRequest?.seq !== focusRequest.seq) return; // a newer question superseded this one
      if (focusRequest.seq <= userOverrideSeqRef.current) return; // user took control while we waited
      const fresh = buildFocusBox(focusRequest.nodeId);
      if (!fresh) return;
      lastFocusedBoxRef.current = fresh;
      const c = boxCenter(fresh);
      const vp = computeFocusViewport(fresh, { width: pane.clientWidth, height: pane.clientHeight });
      // Save the final viewport now (setCenter animates toward it), so navigating
      // away and back restores this focused position.
      if (st.canvasId) st.setCanvasViewport(st.canvasId, vp);
      setCenter(c.x, c.y, { zoom: vp.zoom, duration: FOCUS_ANIM_MS });
    }, FOCUS_STABLE_MS);
    return () => window.clearTimeout(timer);
    // flowNodes in the effect's trigger chain via buildFocusBox's identity:
    // any (re)measurement changes flowNodes → new buildFocusBox → effect re-runs.
  }, [focusRequest, streamingIds, buildFocusBox, setCenter, flowNodes]);

  // ----- action callbacks (defined before the memo so closures are stable) -----
  // Roadmap E: these read state via getState() INSIDE the handler instead of
  // subscribing through `useCanvasStore()` / store fields in the dependency
  // list. That keeps their identity STABLE across streaming deltas, which is
  // what lets NodeCard's memo actually skip re-rendering unchanged cards.
  const handlePlus = useCallback(
    (parent: NodeEntity, direction: PlusDirection) => {
      const st = useCanvasStore.getState();
      const siblings = st.order.map((id) => st.nodes[id]).filter((n): n is NodeEntity => !!n && n.parent_id === parent.id);
      const position = childPosition(parent, "manual_plus", siblings, direction);
      onAsk({
        parent_id: parent.id,
        branch_origin: "manual_plus",
        question: "What would you like to explore in this branch?",
        position,
        model_speed: "fast",
        web_search: false,
      });
    },
    [onAsk],
  );

  const handleToggleCollapse = useCallback(
    (node: NodeEntity) => {
      useCanvasStore.getState().setCollapsed(node.id, !node.collapsed);
      api.patchNode(node.id, { collapsed: !node.collapsed }).catch(() => {});
    },
    [],
  );

  const handleDelete = useCallback(
    (node: NodeEntity) => {
      const label = node.title || node.question;
      if (!window.confirm(`Delete "${label}" and its whole branch?`)) return;
      const doomed = useCanvasStore.getState().deleteNodeSubtree(node.id);
      for (const id of doomed) api.deleteNode(id).catch(() => {});
    },
    [],
  );

  const handleSave = useCallback(
    (node: NodeEntity) => {
      api
        .patchNode(node.id, { saved_to_library: true })
        .then(() => useCanvasStore.getState().upsertNode({ ...node, saved_to_library: true }))
        .catch(() => {});
    },
    [],
  );

  const handleRegenerate = useCallback(
    (node: NodeEntity) => {
      onAsk({
        parent_id: node.parent_id,
        branch_origin: "regenerate",
        question: node.question,
        position: node.position,
        model_speed: "fast",
        web_search: false,
        regenerate_of: node.id,
      });
    },
    [onAsk],
  );

  // ----- nodes/edges derived from the entity store -----
  const nodes: CardNode[] = useMemo(() => {
    const lookup = flowStore.getState().nodeLookup;
    return store.order
      .map((id) => store.nodes[id])
      .filter((n): n is NodeEntity => !!n)
      .map((n) => {
        const m = lookup.get(n.id)?.measured;
        return {
          id: n.id,
          type: "card",
          position: n.position,
          // Controlled mode: selection lives in our selectedIds (applied from
          // `select` node changes) — carry it onto the node so React Flow sets
          // the .selected class AND our NodeCard LOD sees it (selected = full).
          selected: selectedIds.has(n.id),
          // Carry the flow's measured dimensions onto our node props. In v12
          // controlled mode every prop change re-adopts the nodes and WIPES
          // their measurements (and `useNodes()` never re-renders on
          // measure-only changes) — without this, `buildFocusBox` below can
          // never see sizes and auto-focus is silently dead. Re-adopting with
          // `measured` present preserves both the sizes and the handle bounds.
          ...(m?.width && m?.height ? { measured: { width: m.width, height: m.height } } : {}),
          data: {
            node: n,
            streaming: store.streamingIds.has(n.id),
            onAsk,
            onPlus: handlePlus,
            onToggleCollapse: handleToggleCollapse,
            onDelete: handleDelete,
            onSave: handleSave,
            onRegenerate: handleRegenerate,
          } satisfies FlowNodeData,
        };
      });
    // debouncedDims re-runs this memo (and re-adopts the flow) when any node is
    // (re)measured — BATCHED: at most one re-adopt per 80ms of quiescence, so
    // measurement bursts during LOD flips / culling remounts can no longer
    // interrupt viewport animations.
  }, [flowStore, store.order, store.nodes, store.streamingIds, debouncedDims, selectedIds, onAsk, handlePlus, handleToggleCollapse, handleDelete, handleSave, handleRegenerate]);

  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = [];
    for (const id of store.order) {
      const n = store.nodes[id];
      if (n?.parent_id && store.nodes[n.parent_id]) {
        list.push({
          id: `e-${n.parent_id}-${n.id}`,
          source: n.parent_id,
          sourceHandle: "b",
          target: n.id,
          targetHandle: "t",
          animated: false,
          style: { strokeDasharray: "6 6", strokeWidth: 1.5 },
        });
      }
    }
    // concept links (spec §6) — soft dotted lines between related ideas
    for (const l of store.links) {
      if (store.nodes[l.source] && store.nodes[l.target]) {
        list.push({
          id: `link-${l.id}`,
          source: l.source,
          sourceHandle: "b",
          target: l.target,
          targetHandle: "t",
          label: l.label || undefined,
          className: "concept-link",
          style: { strokeDasharray: "2 4", strokeWidth: 1.2, stroke: "rgb(139 124 246 / 0.55)" },
          zIndex: 0,
        });
      }
    }
    return list;
  }, [store.order, store.nodes, store.links]);

  // Selection (roadmap E): React Flow v12 reports it as `select` node changes,
  // and in CONTROLLED mode the prop is the source of truth — a select change
  // that isn't applied to the nodes array never surfaces (no .selected class,
  // no selected prop, no LOD exception). Live E2E caught exactly this: clicks
  // produced zero selection. We track selected ids locally and carry them onto
  // the controlled node objects below.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setSelectedIds(new Set()); // canvas switch — selection never leaks across canvases
  }, [canvasId]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          store.moveNode(ch.id, { x: ch.position.x ?? 0, y: ch.position.y ?? 0 });
        } else if (ch.type === "select") {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (ch.selected) next.add(ch.id);
            else next.delete(ch.id);
            return next;
          });
        }
      }
    },
    [store],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: CardNode) => {
      api.patchNode(node.id, { position: node.position }).catch(() => {});
    },
    [],
  );

  return (
    <div ref={paneRef} className="relative w-full h-full dot-grid">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        // No `fitView` prop: it refit the ENTIRE canvas on every nodes change,
        // zooming out on each new answer. Viewport is driven explicitly:
        // restore/fit on canvas load + auto-focus on new answers.
        // Culling ON (roadmap E): off-screen nodes are not mounted, which is
        // what makes large canvases cheap. Its two hazards are handled:
        //   1) the initial fit uses the store-computed `allBox` (never requires
        //      off-screen nodes to be rendered/measured),
        //   2) auto-focus has a position-based fallback that pans a culled
        //      target into view so it renders, measures, and gets its
        //      precise fit through the normal path.
        onlyRenderVisibleElements
      />

      {/* zoom/fullscreen bottom-right (PRD FR1) */}
      <div className="absolute bottom-4 right-4 flex gap-1 bg-ink-850 border border-ink-700 rounded-lg p-1">
        {/* Instant (duration 0): with culling + LOD, an animated zoom crosses the
            level-of-detail threshold mid-flight and the re-measurement re-adopt
            that follows would interrupt it. Instant steps complete in one frame. */}
        <button className="btn-ghost" title="Zoom in" onClick={() => zoomIn({ duration: 0 })}>
          <ZoomInIcon />
        </button>
        <button className="btn-ghost" title="Zoom out" onClick={() => zoomOut({ duration: 0 })}>
          <ZoomOutIcon />
        </button>
        <button className="btn-ghost" title="Fullscreen" onClick={toggleFullscreen}>
          <MaximizeIcon />
        </button>
      </div>

      {/* undo/redo top-right (PRD FR1) */}
      <div className="absolute top-4 right-4 flex gap-1 bg-ink-850 border border-ink-700 rounded-lg p-1">
        <button className="btn-ghost" title="Undo" onClick={store.undo} disabled={!store.past.length}>
          <UndoIcon />
        </button>
        <button className="btn-ghost" title="Redo" onClick={store.redo} disabled={!store.future.length}>
          <RedoIcon />
        </button>
      </div>

      {/* empty state (PRD §7 step 2) */}
      {store.order.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-md px-6">
            <h2 className="text-lg font-medium text-fog-100">Canvas — A visual way to understand things in parallel</h2>
            <p className="text-fog-400 text-sm mt-2">
              Ask a question below to start your first thread. Branch from any answer with term chips, follow-ups, or the
              + buttons.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
