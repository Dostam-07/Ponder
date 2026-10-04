import { describe, it, expect } from "vitest";
import {
  answerGroupBox,
  boxCenter,
  boxChanged,
  boxOnScreen,
  cardLoD,
  computeFocusViewport,
  entitiesBBox,
  fitAllViewport,
  rectToGraphBox,
  unionBox,
  DEFAULT_CARD,
  FOCUS_MIN_ZOOM,
  FOCUS_MAX_ZOOM,
  FOCUS_PADDING,
  LOD_COMPACT_ZOOM,
  type Box,
} from "./viewport";

const PANE = { width: 1200, height: 800 };

describe("computeFocusViewport", () => {
  it("centers a short answer and caps the zoom (AC5: no excessive zoom-in)", () => {
    // A 420x300 card in a 1200x800 pane would fit at ~2.0x — must be capped at FOCUS_MAX_ZOOM.
    const target: Box = { x: 1000, y: 500, width: 420, height: 300 };
    const vp = computeFocusViewport(target, PANE);
    expect(vp.zoom).toBe(FOCUS_MAX_ZOOM);
    const onScreen = boxOnScreen(target, vp);
    // Centered both axes, inside the pane, with room to spare.
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 3);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 3);
    expect(onScreen.x).toBeGreaterThanOrEqual(0);
    expect(onScreen.y).toBeGreaterThanOrEqual(0);
    expect(onScreen.x + onScreen.width).toBeLessThanOrEqual(PANE.width);
    expect(onScreen.y + onScreen.height).toBeLessThanOrEqual(PANE.height);
  });

  it("fits a medium answer exactly with padding respected (AC1: readable scale)", () => {
    // 800x600 target: fitW = 1008/800 = 1.26, fitH = 608/600 ≈ 1.013 → zoom 1.013 (uncapped, height is the fitting axis).
    const target: Box = { x: -300, y: 200, width: 800, height: 600 };
    const vp = computeFocusViewport(target, PANE);
    expect(vp.zoom).toBeCloseTo(608 / 600, 5);
    const onScreen = boxOnScreen(target, vp);
    // Padding (96px) between content and pane edges on the fitting (vertical) axis.
    expect(onScreen.y).toBeCloseTo(96, 1);
    expect(PANE.height - (onScreen.y + onScreen.height)).toBeCloseTo(96, 1);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 1);
  });

  it("never zooms below the readable minimum for very long answers (AC4/AC8)", () => {
    // A 420x2400 card (long answer + visual) fits at 0.253 — must clamp up to FOCUS_MIN_ZOOM.
    const target: Box = { x: 0, y: 0, width: 420, height: 2400 };
    const vp = computeFocusViewport(target, PANE);
    expect(vp.zoom).toBe(FOCUS_MIN_ZOOM);
    const onScreen = boxOnScreen(target, vp);
    // Still centered; overflow is symmetric (never anchored to a corner or hidden).
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 3);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 3);
    expect(onScreen.y).toBeLessThan(0); // overflows top
    expect(onScreen.y + onScreen.height).toBeGreaterThan(PANE.height); // and bottom, equally
  });

  it("handles small panes (mobile) without going below min zoom (AC8: different screen sizes)", () => {
    const target: Box = { x: 50, y: 40, width: 300, height: 120 };
    const vp = computeFocusViewport(target, { width: 300, height: 240 });
    expect(vp.zoom).toBeGreaterThanOrEqual(FOCUS_MIN_ZOOM);
    const onScreen = boxOnScreen(target, vp);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(150, 1);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(120, 1);
  });

  it("respects custom clamps", () => {
    const target: Box = { x: 0, y: 0, width: 100, height: 100 };
    const vp = computeFocusViewport(target, PANE, { minZoom: 0.2, maxZoom: 0.8 });
    expect(vp.zoom).toBe(0.8);
  });
});

describe("unionBox (answer group: new answer + its parent question)", () => {
  it("unions parent and child into one box", () => {
    const parent: Box = { x: 100, y: 100, width: 420, height: 300 };
    const child: Box = { x: 140, y: 340, width: 420, height: 200 };
    const u = unionBox(parent, child);
    expect(u).toEqual({ x: 100, y: 100, width: 460, height: 440 });
  });

  it("is commutative and absorbs containment", () => {
    const a: Box = { x: 0, y: 0, width: 100, height: 100 };
    const b: Box = { x: 20, y: 20, width: 30, height: 30 };
    expect(unionBox(a, b)).toEqual(a);
    expect(unionBox(b, a)).toEqual(a);
    const c: Box = { x: 500, y: 300, width: 10, height: 10 };
    const u = unionBox(a, c);
    expect(u.x).toBe(0);
    expect(u.y).toBe(0);
    expect(u.width).toBe(510);
    expect(u.height).toBe(310);
  });

  it("center of the union is what gets placed at the pane center", () => {
    const u = unionBox({ x: 100, y: 100, width: 420, height: 300 }, { x: 140, y: 340, width: 420, height: 200 });
    const vp = computeFocusViewport(u, PANE);
    const onScreen = boxOnScreen(u, vp);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 1);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 1);
  });
});

describe("answerGroupBox (focus target selection)", () => {
  const answer: Box = { x: 140, y: 340, width: 420, height: 200 };

  it("is the answer alone when no parent is measurable", () => {
    expect(answerGroupBox(answer)).toEqual(answer);
    expect(answerGroupBox(answer, undefined)).toEqual(answer);
  });

  it("unions the parent question card into the focus target", () => {
    const parent: Box = { x: 100, y: 100, width: 420, height: 300 };
    expect(answerGroupBox(answer, parent)).toEqual(unionBox(answer, parent));
  });

  it("keeps the whole group inside the viewport with padding after focus (AC8: nothing clipped)", () => {
    const group = answerGroupBox(answer, { x: 100, y: 100, width: 420, height: 300 });
    const vp = computeFocusViewport(group, PANE);
    const onScreen = boxOnScreen(group, vp);
    // Group is medium-sized → fits with at least FOCUS_PADDING on the limiting axis.
    expect(onScreen.y).toBeGreaterThanOrEqual(FOCUS_PADDING - 0.5);
    expect(PANE.height - (onScreen.y + onScreen.height)).toBeGreaterThanOrEqual(FOCUS_PADDING - 0.5);
    expect(onScreen.x).toBeGreaterThanOrEqual(0);
    expect(onScreen.x + onScreen.width).toBeLessThanOrEqual(PANE.width);
    // Both cards' centers land on the group's center → question stays in view with the answer.
    const c = boxCenter(group);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 1);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 1);
    expect(c).toEqual(boxCenter(group));
  });
});

describe("consecutive answers — each new focus target is fitted independently", () => {
  it("a second, larger answer re-fits without re-using the first focus", () => {
    const first: Box = { x: 0, y: 0, width: 420, height: 260 };
    const second: Box = { x: 40, y: 560, width: 460, height: 900 }; // follow-up lower-right, taller
    const vp1 = computeFocusViewport(first, PANE);
    const vp2 = computeFocusViewport(second, PANE);
    expect(vp2).not.toEqual(vp1);
    // The second focus is centered on the NEW answer, not the old one.
    const onScreen = boxOnScreen(second, vp2);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 1);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 1);
    // boxChanged flags the switch (position moved far beyond jitter) so the animation runs.
    expect(boxChanged(first, second)).toBe(true);
  });

  it("identical re-focus (same layout, same node) is a no-op — no animation loop", () => {
    const box: Box = { x: 0, y: 0, width: 420, height: 260 };
    expect(boxChanged(box, { ...box })).toBe(false);
    expect(computeFocusViewport(box, PANE)).toEqual(computeFocusViewport({ ...box }, PANE));
  });
});

describe("boxChanged (stability detection — no animation loops)", () => {
  const base: Box = { x: 100, y: 100, width: 420, height: 600 };

  it("first focus of a new box always counts as changed", () => {
    expect(boxChanged(null, base)).toBe(true);
  });

  it("identical box does not re-focus", () => {
    expect(boxChanged(base, { ...base })).toBe(false);
  });

  it("sub-pixel / tiny measurement jitter does not re-focus", () => {
    expect(boxChanged(base, { x: base.x, y: base.y + 3, width: base.width + 2, height: base.height + 4 })).toBe(false);
  });

  it("a rendered visual (height grows) re-focuses", () => {
    expect(boxChanged(base, { ...base, height: base.height + 320 })).toBe(true);
  });

  it("a repositioned node re-focuses", () => {
    expect(boxChanged(base, { ...base, x: base.x + 60 })).toBe(true);
  });

  it("boxCenter math", () => {
    expect(boxCenter({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: 60, y: 45 });
  });
});

describe("rectToGraphBox (DOM rect → graph box, focus fallback)", () => {
  it("identity viewport: rect offset is the graph position", () => {
    const box = rectToGraphBox({ left: 100, top: 50, width: 420, height: 176 }, { x: 0, y: 0, zoom: 1 });
    expect(box).toEqual({ x: 100, y: 50, width: 420, height: 176 });
  });

  it("panned viewport: screen offset minus pan", () => {
    const box = rectToGraphBox({ left: 100, top: 50, width: 200, height: 100 }, { x: 40, y: 20, zoom: 1 });
    expect(box).toEqual({ x: 60, y: 30, width: 200, height: 100 });
  });

  it("zoomed viewport: everything divides by zoom", () => {
    const box = rectToGraphBox({ left: 40, top: 20, width: 100, height: 50 }, { x: 0, y: 0, zoom: 2 });
    expect(box).toEqual({ x: 20, y: 10, width: 50, height: 25 });
  });

  it("round-trips with boxOnScreen (screen → graph → screen)", () => {
    const vp = { x: -363, y: 238, zoom: 1.1 };
    const graph: Box = { x: -200, y: 120, width: 420, height: 200 };
    const screen = boxOnScreen(graph, vp);
    const back = rectToGraphBox({ left: screen.x, top: screen.y, width: screen.width, height: screen.height }, vp)!;
    expect(back.x).toBeCloseTo(graph.x, 5);
    expect(back.y).toBeCloseTo(graph.y, 5);
    expect(back.width).toBeCloseTo(graph.width, 5);
    expect(back.height).toBeCloseTo(graph.height, 5);
  });

  it("rejects zero/degenerate rects", () => {
    expect(rectToGraphBox({ left: 0, top: 0, width: 0, height: 100 }, { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(rectToGraphBox({ left: 0, top: 0, width: 100, height: 0 }, { x: 0, y: 0, zoom: 1 })).toBeNull();
    expect(rectToGraphBox({ left: 0, top: 0, width: 100, height: 100 }, { x: 0, y: 0, zoom: 0 })).toBeNull();
  });
});

describe("entitiesBBox (roadmap E — culling-safe canvas fit)", () => {
  it("returns null for no entries (empty canvas must not fit)", () => {
    expect(entitiesBBox([])).toBeNull();
  });

  it("wraps a single rectangle, with and without padding", () => {
    const one = [{ x: 10, y: 20, width: 100, height: 50 }];
    expect(entitiesBBox(one)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(entitiesBBox(one, 40)).toEqual({ x: -30, y: -20, width: 180, height: 130 });
  });

  it("unions many rectangles across quadrants (negative coords included)", () => {
    const entries = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 300, y: -50, width: 50, height: 40 },
      { x: -80, y: 200, width: 60, height: 60 },
    ];
    const box = entitiesBBox(entries)!;
    // x: -80 .. 350  y: -50 .. 260
    expect(box).toEqual({ x: -80, y: -50, width: 430, height: 310 });
  });
});

describe("fitAllViewport (roadmap E — initial whole-canvas fit)", () => {
  const PANE = { width: 1200, height: 800 };

  it("caps at maxZoom for a small box and keeps it centered", () => {
    const vp = fitAllViewport({ x: 0, y: 0, width: 300, height: 200 }, PANE);
    expect(vp.zoom).toBe(1);
    const onScreen = boxOnScreen({ x: 0, y: 0, width: 300, height: 200 }, vp);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 3);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 3);
  });

  it("zooms out to fit a large canvas, clamped at the min zoom", () => {
    // 4000x3000 canvas in a 1200x800 pane: fitW=1200*0.7/4000=0.21, fitH=800*0.7/3000≈0.186 → 0.186 < 0.2 → clamped to 0.2.
    const vp = fitAllViewport({ x: 0, y: 0, width: 4000, height: 3000 }, PANE);
    expect(vp.zoom).toBe(0.2);
  });

  it("keeps the canvas centered at a non-trivial graph offset", () => {
    const box = { x: 500, y: 300, width: 2000, height: 1000 };
    const vp = fitAllViewport(box, PANE);
    const onScreen = boxOnScreen(box, vp);
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(PANE.width / 2, 3);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(PANE.height / 2, 3);
  });
});

describe("cardLoD (roadmap E — level of detail)", () => {
  it("is compact below the threshold, full at/above it", () => {
    expect(cardLoD(LOD_COMPACT_ZOOM - 0.01, { selected: false, streaming: false })).toBe("compact");
    expect(cardLoD(LOD_COMPACT_ZOOM, { selected: false, streaming: false })).toBe("full");
    expect(cardLoD(1, { selected: false, streaming: false })).toBe("full");
  });

  it("selected cards are ALWAYS full, even far zoomed out (usability preserved)", () => {
    expect(cardLoD(0.2, { selected: true, streaming: false })).toBe("full");
  });

  it("streaming cards are ALWAYS full, even far zoomed out (the live answer stays usable)", () => {
    expect(cardLoD(0.2, { selected: false, streaming: true })).toBe("full");
  });
});

describe("DEFAULT_CARD", () => {
  it("is the 420-wide layout width the position math already uses", () => {
    expect(DEFAULT_CARD.width).toBe(420);
    expect(DEFAULT_CARD.height).toBeGreaterThan(0);
  });
});
