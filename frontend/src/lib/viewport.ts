/**
 * Pure viewport math for auto-focusing the canvas on a newly generated answer.
 *
 * Everything here is DOM-free and testable: real node bounding boxes go in,
 * a React Flow viewport transform comes out. CanvasStage wires these to the
 * measured node sizes (onNodeMeasure) and to `setCenter`.
 */

/** Axis-aligned box in canvas (internal) coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Card size assumed when a node has no measured dimensions yet (NODE_W = 420,
 * a typical card height). Used for culling-safe viewport math: off-screen nodes
 * are never rendered, so their measured size is unknown — the layout truth is
 * their graph position plus this default.
 */
export const DEFAULT_CARD = { width: 420, height: 320 } as const;

/**
 * Bounding box over explicit graph-space rectangles (null when empty).
 * `padding` grows the box outward. This lets CanvasStage fit an entire canvas
 * from STORE data alone — no requirement that every node be rendered and
 * measured (which off-screen culling makes impossible on large canvases).
 */
export function entitiesBBox(entries: { x: number; y: number; width: number; height: number }[], padding = 0): Box | null {
  if (entries.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of entries) {
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.width);
    maxY = Math.max(maxY, e.y + e.height);
  }
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

/**
 * Level-of-detail threshold (roadmap E): below this zoom a 420px card is under
 * ~150px on screen — its text is unreadable, so cards render as compact
 * summaries instead of full fidelity. Selected and streaming cards always keep
 * full fidelity regardless of zoom (usability of the node being used).
 */
export const LOD_COMPACT_ZOOM = 0.35;

/** Which detail level a card renders at. Pure — unit-testable. */
export function cardLoD(zoom: number, opts: { selected: boolean; streaming: boolean }): "full" | "compact" {
  if (opts.selected || opts.streaming) return "full";
  return zoom < LOD_COMPACT_ZOOM ? "compact" : "full";
}

/** Breathing room (px) around the focused content so it never touches the viewport edges. */
export const FOCUS_PADDING = 96;
/** Never fit below this — text becomes unreadable for long answers. */
export const FOCUS_MIN_ZOOM = 0.4;
/** Never fit above this — short answers must not be blown up excessively. */
export const FOCUS_MAX_ZOOM = 1.1;

export function boxCenter(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Smallest box containing both — used to include the parent question card in the focus group. */
export function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: x2 - x, height: y2 - y };
}

/**
 * The "answer group" that auto-focus fits: the measured box of the new answer
 * node, unioned with its parent question card's box when measurable — so the
 * question stays visible alongside its answer. Without a measurable parent,
 * the answer alone is the group.
 */
export function answerGroupBox(node: Box, parent?: Box): Box {
  return parent ? unionBox(node, parent) : node;
}

/**
 * Viewport transform that centers `target` within `pane` at a readable scale.
 *
 * zoom = the largest zoom that fits target (incl. padding) into the pane,
 * clamped to [minZoom, maxZoom]. At the clamp bounds the content is still
 * centered — a very large answer overflows symmetrically rather than being
 * anchored to a corner, so it stays readable and not hidden behind UI.
 */
export function computeFocusViewport(
  target: Box,
  pane: Size,
  opts?: { padding?: number; minZoom?: number; maxZoom?: number },
): Viewport {
  const padding = opts?.padding ?? FOCUS_PADDING;
  const minZoom = opts?.minZoom ?? FOCUS_MIN_ZOOM;
  const maxZoom = opts?.maxZoom ?? FOCUS_MAX_ZOOM;

  const fitW = (pane.width - 2 * padding) / target.width;
  const fitH = (pane.height - 2 * padding) / target.height;
  const zoom = Math.max(Math.min(fitW, fitH, maxZoom), minZoom);

  return {
    x: (pane.width - target.width * zoom) / 2 - target.x * zoom,
    y: (pane.height - target.height * zoom) / 2 - target.y * zoom,
    zoom,
  };
}

/**
 * Viewport that fits `box` into `pane` with breathing room — the INITIAL
 * whole-canvas fit (vs computeFocusViewport's answer-fit clamps). `inset` is
 * the total fraction of the pane reserved as margin (0.3 → 15% per side, the
 * same proportion fitView's `padding: 0.15` uses).
 */
export function fitAllViewport(
  box: Box,
  pane: Size,
  opts?: { maxZoom?: number; minZoom?: number; inset?: number },
): Viewport {
  const maxZoom = opts?.maxZoom ?? 1;
  const minZoom = opts?.minZoom ?? 0.2; // must match ReactFlow's minZoom
  const inset = opts?.inset ?? 0.3;
  const fitW = (pane.width * (1 - inset)) / box.width;
  const fitH = (pane.height * (1 - inset)) / box.height;
  const zoom = Math.max(Math.min(fitW, fitH, maxZoom), minZoom);
  return {
    x: (pane.width - box.width * zoom) / 2 - box.x * zoom,
    y: (pane.height - box.height * zoom) / 2 - box.y * zoom,
    zoom,
  };
}

/**
 * Where a box lands on screen under a viewport transform. (Used by tests to
 * verify centering; the inverse of `computeFocusViewport`'s math.)
 */
export function boxOnScreen(box: Box, vp: Viewport): Box {
  return { x: box.x * vp.zoom + vp.x, y: box.y * vp.zoom + vp.y, width: box.width * vp.zoom, height: box.height * vp.zoom };
}

/**
 * Screen-space bounding rect (getBoundingClientRect) → graph-space box.
 * Fallback for when React Flow's cached measured sizes have not landed yet:
 * the element's own DOM rect IS the real measured bounding box, so focus math
 * stays grounded in what is actually on screen. (CanvasStage's nodeBox.)
 */
export function rectToGraphBox(
  rect: { left: number; top: number; width: number; height: number },
  vp: Viewport,
): Box | null {
  if (!vp.zoom || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 1 || rect.height < 1) {
    return null;
  }
  return {
    x: (rect.left - vp.x) / vp.zoom,
    y: (rect.top - vp.y) / vp.zoom,
    width: rect.width / vp.zoom,
    height: rect.height / vp.zoom,
  };
}

/**
 * Whether a box changed enough since the last focus to justify re-centering —
 * e.g. a visual/image rendered after the answer finished. Sub-pixel and
 * tiny measurement jitter must NOT re-trigger the animation.
 */
export function boxChanged(
  prev: Box | null,
  next: Box,
  opts?: { sizeDelta?: number; centerDelta?: number },
): boolean {
  if (!prev) return true;
  const sizeDelta = opts?.sizeDelta ?? 6;
  const centerDelta = opts?.centerDelta ?? 10;
  if (Math.abs(prev.width - next.width) > sizeDelta) return true;
  if (Math.abs(prev.height - next.height) > sizeDelta) return true;
  const a = boxCenter(prev);
  const b = boxCenter(next);
  return Math.abs(a.x - b.x) > centerDelta || Math.abs(a.y - b.y) > centerDelta;
}
