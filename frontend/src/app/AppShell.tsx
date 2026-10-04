import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AskRequest, NodeEntity, ThinkingMap } from "@canvas-learn/shared";
import { api, streamAsk } from "../lib/api";
import { useCanvasStore } from "../stores/canvasStore";
import { childPosition, rootPosition } from "../lib/layout";
import { resolveAskTarget, pendingAskFor, type PendingAsk } from "../lib/askRouting";
import { useHashRoute } from "../hooks/useHashRoute";
import { useTextSelection } from "../hooks/useTextSelection";
import { Sidebar } from "../components/sidebar/Sidebar";
import { CanvasPage } from "./CanvasPage";
import { CanvasHistoryPage } from "./CanvasHistoryPage";
import { ReviewPage } from "./ReviewPage";
import { LibraryPage } from "./LibraryPage";
import { SettingsPage } from "./SettingsPage";
import { GraphPage } from "./GraphPage";
import { ExplorePage } from "./ExplorePage";
import { HomePage } from "./HomePage";
import { AskPonder, type SelectionAnchor, type AskOptions } from "../components/ask/AskPonder";
import { MenuIcon } from "../components/ui/Icons";

export function AppShell() {
  const [route, navigate] = useHashRoute();
  const [toast, setToast] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const qc = useQueryClient();
  const store = useCanvasStore();
  const askingRef = useRef(false);
  /** True while a Home-question canvas is being created (guards against double submits). */
  const creatingRef = useRef(false);
  /** Monotonic ask counter: late events/finish of an older stream must not unlock a newer ask. */
  const askSeqRef = useRef(0);
  const [askBusy, setAskBusy] = useState(false);
  /**
   * Question typed on Home, keyed to the canvas created for it. Consumed only when
   * that exact canvas loads — never by another canvas the user opens in the meantime.
   */
  const pendingAskRef = useRef<PendingAsk | null>(null);
  /**
   * Node to focus after a canvas loads, keyed to the canvas it belongs to —
   * set by global search (and any future "jump to node" entry point). Consumed
   * exactly once, by the graph-load effect for that exact canvas (never leaks
   * into a different canvas the user opens in the meantime).
   */
  const pendingFocusRef = useRef<{ canvasId: string; nodeId: string } | null>(null);

  const canvases = useQuery({ queryKey: ["canvases"], queryFn: api.listCanvases });

  // Ask Ponder: watch text selections in supported content areas.
  useTextSelection(setSelectionAnchor, () => setSelectionAnchor(null));

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshStats = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["stats"] });
    qc.invalidateQueries({ queryKey: ["canvases"] });
    qc.invalidateQueries({ queryKey: ["learning-stats"] });
    qc.invalidateQueries({ queryKey: ["dueCards"] });
  }, [qc]);

  /** Reload the current graph into the store (path sections create nodes server-side). */
  const reloadGraph = useCallback(() => {
    if (route.page !== "canvas") return;
    api
      .graph(route.canvasId)
      .then((g) => {
        store.loadGraph(g.canvas.id, g.canvas.title, g.nodes, {
          links: (g.links ?? []) as never,
          pathId: (g.path as { id?: string } | null)?.id ?? null,
          map: (g.map as ThinkingMap | null) ?? null,
        });
      })
      .catch(() => undefined);
  }, [route, store]);

  /** Central ask orchestrator: computes position, streams SSE into the store. */
  const onAsk = useCallback(
    async (partial: Omit<AskRequest, "canvas_id">) => {
      // In-canvas asks continue the CURRENT canvas's conversation (routing rule
      // lives in lib/askRouting.ts; off-canvas submits use askFromHome instead).
      const target = resolveAskTarget("canvas", route);
      if (target.kind !== "existing-canvas" || askingRef.current) return;
      const canvasId = target.canvasId;
      askingRef.current = true;
      setAskBusy(true);
      const seq = ++askSeqRef.current;
      const isCurrent = () => seq === askSeqRef.current;

      // resolve position
      const nodes = store.order.map((id) => store.nodes[id]).filter((n): n is NodeEntity => !!n);
      let position = partial.position;
      if (partial.branch_origin === "thread") {
        position = rootPosition(nodes.filter((n) => n.parent_id === null));
      } else if (partial.branch_origin === "manual_plus") {
        // direction already resolved by the caller via childPosition in CanvasStage
        position = partial.position;
      } else if (partial.branch_origin !== "regenerate" && partial.parent_id) {
        const parent = nodes.find((n) => n.id === partial.parent_id);
        const siblings = nodes.filter((n) => n.parent_id === partial.parent_id);
        if (parent) position = childPosition(parent, partial.branch_origin, siblings);
      }

      const req: AskRequest = { ...partial, position, canvas_id: canvasId };
      try {
        await streamAsk(req, {
          onEvent: (e) => {
            store.applyAskEvent(e);
            if (e.type === "done") refreshStats();
            // Conversation just got its real title — refresh the sidebar list.
            if (e.type === "canvas_titled") qc.invalidateQueries({ queryKey: ["canvases"] });
            // The turn is settled as soon as the answer completes (stage2) or
            // fails (error) — unlock the composer then, without waiting for the
            // post-answer enhancement stream (sections/gaps/visual) to finish.
            // Late events from this stream keep applying to their own node.
            if (isCurrent() && (e.type === "stage2" || e.type === "done" || e.type === "error")) {
              askingRef.current = false;
              setAskBusy(false);
            }
          },
          onError: (err) => showToast(err.message),
        });
      } finally {
        // Only the newest ask may clear the lock — an older stream ending late
        // (its enhancement calls still running) must not unlock a newer one.
        if (isCurrent()) {
          askingRef.current = false;
          setAskBusy(false);
        }
        refreshStats();
      }
    },
    [route, store, refreshStats, showToast, qc],
  );
  // Stable handle so the graph-load effect can consume pending asks without re-subscribing.
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;

  // Load graph when the canvas route changes; then stream the Home question onto
  // this canvas — and only this canvas — because it is the one created for it.
  useEffect(() => {
    if (route.page === "canvas") {
      api
        .graph(route.canvasId)
        .then((g) => {
          store.loadGraph(g.canvas.id, g.canvas.title, g.nodes, {
            links: (g.links ?? []) as never,
            pathId: (g.path as { id?: string } | null)?.id ?? null,
            map: (g.map as ThinkingMap | null) ?? null,
          });
          const ask = pendingAskFor(pendingAskRef.current, route.canvasId);
          if (ask) {
            pendingAskRef.current = null;
            void onAskRef.current(ask);
          }
          // Global-search "jump to node": focusRequest must be set AFTER loadGraph
          // (loadGraph deliberately clears it for the new canvas), and only for the
          // exact canvas it was queued for. The existing auto-focus mechanism then
          // pans/zooms to the node once its card is measured.
          const focus = pendingFocusRef.current;
          if (focus && focus.canvasId === route.canvasId) {
            pendingFocusRef.current = null;
            store.requestFocus(focus.nodeId);
          }
        })
        .catch(() => {
          // A failed load keeps the pending ask (it stays scoped to this canvas id
          // and can never leak into another canvas).
          showToast("Could not load that canvas");
          navigate({ page: "home" });
        });
    } else {
      store.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.page, route.page === "canvas" ? route.canvasId : null]);

  /**
   * Real ask flow from Home (composer, example prompts, Ask Ponder off-canvas):
   * ALWAYS creates a brand-new canvas — never reuses an existing one, no matter
   * which canvas was previously opened — and queues the question so it streams
   * onto the new canvas as soon as its (empty) graph loads. On failure the queued
   * question is dropped, never silently re-routed into an existing conversation.
   */
  const askFromHome = useCallback(
    (partial: Omit<AskRequest, "canvas_id">) => {
      const target = resolveAskTarget("home", route, (canvases.data ?? []).map((c) => c.id));
      if (target.kind !== "new-canvas" || askingRef.current || creatingRef.current || pendingAskRef.current) return;
      creatingRef.current = true;
      api
        .createCanvas()
        .then((c) => {
          qc.invalidateQueries({ queryKey: ["canvases"] });
          pendingAskRef.current = { canvasId: c.id, ask: partial };
          navigate({ page: "canvas", canvasId: c.id });
        })
        .catch(() => {
          pendingAskRef.current = null; // never leave a dangling question behind
          showToast("Could not create a canvas — is the server running?");
        })
        .finally(() => {
          creatingRef.current = false;
        });
    },
    [route, canvases.data, navigate, qc, showToast],
  );

  /** Canvas-wide "summarize what I learned" node (M7). */
  const onSummarize = useCallback(async () => {
    if (route.page !== "canvas") return;
    showToast("Generating session review… (may take a while on free models)");
    try {
      const node = await api.summarizeCanvas(route.canvasId);
      store.upsertNode(node);
      showToast("Session review added to the canvas");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Summarizer failed");
    }
  }, [route, store, showToast]);

  const openCanvas = useCallback((id: string, focusNodeId?: string) => {
    if (!focusNodeId) return navigate({ page: "canvas", canvasId: id });
    if (route.page === "canvas" && route.canvasId === id) {
      // Already viewing this canvas — the node is in the store; the existing
      // focus mechanism pans/zooms to it immediately.
      store.requestFocus(focusNodeId);
    } else {
      // Queued until this exact canvas's graph loads (the load effect consumes it).
      pendingFocusRef.current = { canvasId: id, nodeId: focusNodeId };
      navigate({ page: "canvas", canvasId: id });
    }
  }, [navigate, route, store]);
  const newCanvas = useCallback(() => {
    api.createCanvas().then((c) => {
      qc.invalidateQueries({ queryKey: ["canvases"] });
      navigate({ page: "canvas", canvasId: c.id });
    });
  }, [qc, navigate]);

  const deleteCanvas = useCallback(
    (id: string) => {
      api.deleteCanvas(id).then(() => {
        qc.invalidateQueries({ queryKey: ["canvases"] });
        if (route.page === "canvas" && route.canvasId === id) navigate({ page: "home" });
      }).catch((err) => showToast(err instanceof Error ? err.message : "Could not delete that canvas"));
    },
    [qc, route, navigate, showToast],
  );

  /**
   * Ask Ponder submit — explicit origin routing:
   * inside a canvas it continues THAT canvas (branch from the selected node, or a
   * new root thread on the same canvas — same behavior as the canvas prompt bar);
   * off-canvas it always starts a fresh canvas via askFromHome.
   */
  const onAskPonderSubmit = useCallback(
    (question: string, opts?: AskOptions) => {
      const anchor = selectionAnchor;
      setSelectionAnchor(null);
      if (route.page === "canvas") {
        void onAsk({
          parent_id: anchor?.nodeId ?? null,
          branch_origin: anchor?.nodeId ? "term_chip" : "thread",
          question,
          position: { x: 0, y: 0 },
          model_speed: "fast",
          web_search: opts?.mode === "research" || opts?.mode === "challenge",
          explain_like: opts?.explainLike,
          compare: opts?.compare,
          mode: opts?.mode,
        });
      } else {
        askFromHome({
          parent_id: null,
          branch_origin: "thread",
          question,
          position: { x: 0, y: 0 },
          model_speed: "fast",
          web_search: false,
          explain_like: opts?.explainLike,
        });
      }
    },
    [selectionAnchor, route, onAsk, askFromHome],
  );

  const content = useMemo(() => {
    if (route.page === "canvas")
      return <CanvasPage canvasId={route.canvasId} onAsk={onAsk} askBusy={askBusy} onSummarize={onSummarize} onGraphChanged={reloadGraph} />;
    if (route.page === "canvases") return <CanvasHistoryPage onNewCanvas={newCanvas} />;
    if (route.page === "review") return <ReviewPage />;
    if (route.page === "library") return <LibraryPage />;
    if (route.page === "graph") return <GraphPage />;
    if (route.page === "explore") return <ExplorePage />;
    if (route.page === "settings") return <SettingsPage />;
    return <HomePage creating={canvases.isLoading} askBusy={askBusy} onAsk={askFromHome} onOpenSettings={() => navigate({ page: "settings" })} />;
  }, [route, onAsk, askBusy, canvases.isLoading, onSummarize, askFromHome, navigate, reloadGraph, newCanvas]);

  return (
    <div className="flex h-full">
      {/* mobile nav trigger — the only chrome on the otherwise minimal pages */}
      <button
        className="lg:hidden absolute top-3 left-3 z-30 btn-ghost popover-surface !p-2"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation menu"
        title="Menu"
      >
        <MenuIcon />
      </button>

      <Sidebar
        activeCanvasId={route.page === "canvas" ? route.canvasId : null}
        activePage={route.page === "canvas" ? "canvases" : route.page}
        onOpenCanvas={openCanvas}
        onNewCanvas={newCanvas}
        onDeleteCanvas={deleteCanvas}
        onNav={(page) => navigate({ page })}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <main className="flex-1 relative min-w-0">{content}</main>

      <AskPonder
        anchor={selectionAnchor}
        onSubmit={onAskPonderSubmit}
        onDismiss={() => setSelectionAnchor(null)}
      />

      {toast && (
        <div
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 bg-ink-700 border border-ink-600 text-fog-100 text-sm rounded-lg px-4 py-2 shadow-xl"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
