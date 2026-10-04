// Temp performance fixture: one canvas with 150 real (pending) nodes in a grid.
// Created via the live API (normal code path); delete when measurements are done.
const BASE = "http://127.0.0.1:8787";

const canvas = await (await fetch(`${BASE}/api/canvases`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Perf Fixture — delete me" }),
})).json();

const COLS = 10;
const GAP_X = 560;
const GAP_Y = 460;
const topics = [
  "light", "water", "energy", "cells", "gravity", "sound", "heat", "magnetism", "electricity", "chemicals",
  "growth", "heredity", "ecosystems", "evolution", "motion", "forces", "waves", "radiation", "optics", "thermodynamics",
];
let count = 0;
for (let i = 0; i < 150; i++) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const t = topics[i % topics.length];
  const res = await fetch(`${BASE}/api/canvases/${canvas.id}/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      branch_origin: "manual_plus",
      question: `Explain ${t}: part ${i + 1} of the large-canvas performance fixture (node ${i + 1} of 150). This text exists to give the card realistic rendered content for the benchmark.`,
      position: { x: 80 + col * GAP_X, y: 80 + row * GAP_Y },
    }),
  });
  if (!res.ok) throw new Error(`node ${i}: HTTP ${res.status}`);
  count++;
}
console.log(JSON.stringify({ canvas_id: canvas.id, title: canvas.title, nodes: count }));
