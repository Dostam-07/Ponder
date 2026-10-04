// Temp: seed one canvas with 4 COMPLETE nodes, each carrying a persisted
// interactive_sim visual (the 4 new sims from roadmap A). This exercises the
// REAL persisted-data → renderer path (same columns the Stage-3 pipeline
// writes: visual_type / visual_status / visual_spec). Delete the canvas when
// the visual check is done.
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve("data/app.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const now = Date.now();
const canvasId = crypto.randomUUID();
db.prepare("INSERT INTO canvases (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(canvasId, "Sim Renderer Check — delete me", now, now);

const sims = [
  { q: "How does a pendulum clock keep time so steadily?", a: "A pendulum's swing period depends almost only on its length and gravity, not on how hard it is pushed — that regularity is what makes pendulum clocks accurate. Damping slowly shrinks the swing, which is why clocks need an escapement to add energy each cycle.", sim: "pendulum", title: "Pendulum clock swing" },
  { q: "Why does a camera flash charge up slowly but fire instantly?", a: "The flash capacitor charges through a large resistor (slow, safe), then discharges through the xenon tube (fast, brilliant). The time constant τ = R·C sets how quickly the capacitor approaches its working voltage.", sim: "rc_circuit", title: "Flash capacitor charge & discharge" },
  { q: "Why does a petri dish of bacteria stop growing at some point?", a: "Growth starts exponentially, but nutrients and space are finite, so the population levels off at the carrying capacity K — the S-shaped logistic curve. The fastest growth happens at half capacity, the inflection point.", sim: "logistic_growth", title: "Bacteria in a petri dish" },
  { q: "Why do colds spike in winter and then burn out?", a: "An outbreak follows the SIR pattern: susceptibles meet infected people, cases climb to a peak, then fall as the pool of susceptible people is used up. The peak height and timing depend on the reproduction number R0 = β/γ.", sim: "sir_model", title: "Seasonal cold outbreak" },
];

const ins = db.prepare(`
  INSERT INTO nodes (
    id, canvas_id, parent_id, branch_origin, status, title, question, answer_text,
    key_terms, suggested_followups, tags, visual_type, visual_status, visual_spec,
    position_x, position_y, width, collapsed, saved_to_library, model_used,
    web_search_used, context_summary, mode, sources, provenance, gaps, material_id,
    sections, note, important, review_due_at, review_last_reviewed_at, created_at, updated_at
  ) VALUES (
    ?, ?, NULL, 'thread', 'complete', ?, ?, ?,
    '[]', '[]', '[]', 'interactive_sim', 'ready', ?,
    ?, ?, 420, 0, 0, 'e2e-renderer-check',
    0, '', '', '[]', 'null', '[]', NULL,
    '[]', '', 0, ?, NULL, ?, ?
  )`);

const PARAMS = {
  pendulum: [
    { key: "length", label: "Length", min: 0.2, max: 3, step: 0.1, value: 1 },
    { key: "gravity", label: "Gravity", min: 1, max: 25, step: 0.1, value: 9.8 },
    { key: "damping", label: "Damping", min: 0, max: 2, step: 0.05, value: 0.1 },
    { key: "start_angle", label: "Start angle", min: 5, max: 90, step: 1, value: 30 },
  ],
  rc_circuit: [
    { key: "voltage", label: "Voltage", min: 1, max: 24, step: 1, value: 9 },
    { key: "resistance", label: "Resistance", min: 100, max: 100000, step: 100, value: 10000 },
    { key: "capacitance", label: "Capacitance", min: 1, max: 1000, step: 1, value: 100 },
  ],
  logistic_growth: [
    { key: "p0", label: "Initial population", min: 1, max: 1000, step: 1, value: 10 },
    { key: "k", label: "Carrying capacity", min: 100, max: 10000, step: 100, value: 1000 },
    { key: "r", label: "Growth rate", min: 0.05, max: 1.5, step: 0.05, value: 0.5 },
  ],
  sir_model: [
    { key: "population", label: "Population", min: 1000, max: 10000, step: 500, value: 10000 },
    { key: "initial_infected", label: "Initial infected", min: 1, max: 100, step: 1, value: 5 },
    { key: "beta", label: "Infection rate β", min: 0.05, max: 0.8, step: 0.01, value: 0.4 },
    { key: "gamma", label: "Recovery rate γ", min: 0.05, max: 1, step: 0.05, value: 0.25 },
  ],
};

sims.forEach((s, i) => {
  const spec = JSON.stringify({ sim: s.sim, title: s.title, params: PARAMS[s.sim] });
  const x = 80 + (i % 2) * 560;
  const y = 80 + Math.floor(i / 2) * 560;
  ins.run(crypto.randomUUID(), canvasId, s.q.slice(0, 60), s.q, s.a, spec, x, y, now + 7 * 86400000, now, now);
});

console.log(JSON.stringify({ canvas_id: canvasId, nodes: sims.length }));
db.close();
