// Large-canvas performance measurement (roadmap E). Headless Chrome via puppeteer-core.
// Usage: npx tsx tmp-perf-measure.mjs <canvasId> [label]
//
// Metrics (all measured, nothing claimed):
//  - open_ms: navigation → first node element rendered
//  - mounted: .react-flow__node elements in the DOM after the canvas fits & settles
//  - compact: [data-lod="compact"] cards (LOD) — 0 before the LOD change
//  - total_dom: document.getElementsByTagName('*').length (render weight)
//  - pan: scripted 1.2s background drag; rAF frame deltas → avg / worst / dropped (>34ms)
//  - zoom-out: wheel-zoom to min zoom; re-count mounted/compact; pan again
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANVAS = process.argv[2];
const LABEL = process.argv[3] ?? "run";
if (!CANVAS) {
  console.error("usage: npx tsx tmp-perf-measure.mjs <canvasId> [label]");
  process.exit(1);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-perf-"));

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  userDataDir,
  args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const startedAt = Date.now();
  await page.goto(`http://localhost:5173/#/canvas/${CANVAS}`, { waitUntil: "domcontentloaded" });

  // time to first rendered node
  const openMs = await page
    .waitForFunction(() => document.querySelector(".react-flow__node") !== null, { timeout: 30_000 })
    .then(() => Date.now() - startedAt)
    .catch(() => null);

  // let the initial fit + measurements settle
  await new Promise((r) => setTimeout(r, 4000));

  const snap = (label) =>
    page.evaluate((lbl) => {
      const nodes = document.querySelectorAll(".react-flow__node").length;
      const compact = document.querySelectorAll('[data-lod="compact"]').length;
      const full = document.querySelectorAll(".node-card").length - compact;
      const totalDom = document.getElementsByTagName("*").length;
      const vp = document.querySelector(".react-flow__viewport");
      const tf = vp ? getComputedStyle(vp).transform : "none";
      return { label: lbl, mounted: nodes, compact, fullCards: full, totalDom, transform: tf };
    }, label);

  const fitSnap = await snap("fit");

  // frame probe + scripted pan on the background (left-drag pans in React Flow)
  await page.evaluate(() => {
    window.__frames = [];
    window.__panning = false;
    let last = performance.now();
    const tick = (t) => {
      if (window.__panning) window.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const pan = async (label) => {
    await page.evaluate(() => {
      window.__frames = [];
      window.__panning = true;
    });
    await page.mouse.move(900, 450);
    await page.mouse.down();
    const t0 = Date.now();
    while (Date.now() - t0 < 1200) {
      await page.mouse.move(900 - (Date.now() - t0) * 0.5, 450 - (Date.now() - t0) * 0.2, { steps: 2 });
      await new Promise((r) => setTimeout(r, 16));
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => (window.__panning = false));
    const frames = await page.evaluate(() => window.__frames);
    if (frames.length === 0) return { label, frames: 0, avg_ms: 0, worst_ms: 0, dropped: 0 };
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const worst = Math.max(...frames);
    const dropped = frames.filter((f) => f > 34).length;
    return { label, frames: frames.length, avg_ms: +avg.toFixed(2), worst_ms: +worst.toFixed(1), dropped };
  };

  const panFit = await pan("pan@fit");

  // zoom all the way out (LOD + more culling), settle, re-measure
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(800, 500);
    await page.mouse.wheel({ deltaY: 240 });
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 2500));
  const zoomedSnap = await snap("zoomed-out");
  const panZoomed = await pan("pan@zoomed-out");

  console.log(
    JSON.stringify(
      {
        label: LABEL,
        open_ms: openMs,
        fit: fitSnap,
        pan_fit: panFit,
        zoomed_out: zoomedSnap,
        pan_zoomed: panZoomed,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}
