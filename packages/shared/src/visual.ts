import { z } from "zod";

/** Visual types supported by the canvas. Pictures are generated only on demand. */
export const VisualType = z.enum([
  "cycle_diagram",
  "flowchart",
  "image",
  "illustration",
  "chart",
  "comparison_table",
  "timeline",
  "interactive_sim",
  "none",
]);
export type VisualType = z.infer<typeof VisualType>;

export const VisualStatus = z.enum(["pending", "generating", "ready", "failed"]);
export type VisualStatus = z.infer<typeof VisualStatus>;

/** cycle_diagram / flowchart / timeline → a valid Mermaid flowchart definition */
export const DiagramSpec = z.object({
  mermaid: z.string().min(1),
});
export type DiagramSpec = z.infer<typeof DiagramSpec>;

/**
 * illustration → schema-ready scene spec, renderer INTENTIONALLY DEFERRED
 * (product decision: no placeholder-quality renderer; see README ADR-005).
 * The spec preserves intent (scene), composition (elements), related content
 * (caption) and rendering requirements (style) so a real renderer can arrive
 * later without breaking persisted canvases or shared JSON files.
 */
export const IllustrationSpec = z.object({
  /** what the illustration depicts — the intent */
  scene: z.string(),
  /** composition: labeled parts with relative positions (0-100) */
  elements: z
    .array(
      z.object({
        icon: z.string(),
        label: z.string().optional(),
        x: z.number(),
        y: z.number(),
      }),
    )
    .max(24),
  /** related content shown alongside the deferred notice */
  caption: z.string().max(240).optional(),
  /** rendering requirements for a future renderer, e.g. "schematic cross-section" */
  style: z.string().max(80).optional(),
});
export type IllustrationSpec = z.infer<typeof IllustrationSpec>;

/** A generated picture stored as a data URL so it survives refresh and export. */
export const ImageSpec = z.object({
  data_url: z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/, "Expected a base64 image data URL"),
  media_type: z.string().startsWith("image/").max(80),
  prompt: z.string().max(8000),
  alt: z.string().min(1).max(500),
  model: z.string().min(1).max(200),
});
export type ImageSpec = z.infer<typeof ImageSpec>;

export const ChartType = z.enum(["donut", "bar", "line"]);
export type ChartType = z.infer<typeof ChartType>;

export const ChartSpec = z.object({
  chart_type: ChartType,
  labels: z.array(z.string()).min(1).max(12),
  values: z.array(z.number()).min(1).max(12),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const ComparisonTableSpec = z.object({
  headers: z.array(z.string()).min(2).max(5),
  rows: z.array(z.array(z.string()).min(2).max(5)).min(1).max(10),
});
export type ComparisonTableSpec = z.infer<typeof ComparisonTableSpec>;

/**
 * Interactive simulations (roadmap 4): manipulable models where dragging a slider
 * recomputes the deterministic render. The LLM picks `sim` + a starting `params`;
 * the frontend owns the math (see frontend/src/lib/simulations.ts) so changing an
 * input changes the picture, not just text.
 */
export const SimName = z.enum([
  "projectile",
  "compound_interest",
  "binomial",
  "pendulum",
  "rc_circuit",
  "logistic_growth",
  "sir_model",
]);
export type SimName = z.infer<typeof SimName>;

export const SimParam = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  value: z.number(),
  unit: z.string().max(12).optional(),
});
export type SimParam = z.infer<typeof SimParam>;

export const SimSpec = z.object({
  sim: SimName,
  params: z.array(SimParam).min(1).max(8),
  title: z.string().max(80).optional(),
  caption: z.string().max(240).optional(),
});
export type SimSpec = z.infer<typeof SimSpec>;

export const NoneSpec = z.null();

/** Per-type spec validators used by the Stage-3 pipeline (server) before render (frontend). */
export const VisualSpecSchemas = {
  cycle_diagram: DiagramSpec,
  flowchart: DiagramSpec,
  timeline: DiagramSpec,
  image: ImageSpec,
  illustration: IllustrationSpec,
  chart: ChartSpec,
  comparison_table: ComparisonTableSpec,
  interactive_sim: SimSpec,
  none: NoneSpec,
} as const;

export const PictureErrorCode = z.enum(["credits_required", "key_required", "key_rejected", "model_unavailable", "rate_limited", "provider_unavailable", "no_image"]);
export type PictureErrorCode = z.infer<typeof PictureErrorCode>;

export const VisualBlock = z.object({
  type: VisualType,
  status: VisualStatus,
  spec: z.unknown(),
  /** Safe, actionable picture failure metadata, retained across refresh/export. */
  error: z.object({ message: z.string().max(600), code: PictureErrorCode.optional() }).optional(),
});
export type VisualBlock = z.infer<typeof VisualBlock>;

/**
 * Validate + coerce a raw visual payload from the LLM into a typed VisualBlock.
 * Coercions applied to survive small-model quirks:
 * - chart: numeric strings coerced to numbers, non-numeric entries dropped (keeping labels/values aligned)
 * - diagram: strips ```mermaid fences
 * - null spec allowed only for type "none"
 * Returns { ok: true, block } or { ok: false }.
 */
export function parseVisualSpec(raw: unknown): { ok: boolean; block?: VisualBlock } {
  if (typeof raw !== "object" || raw === null) return { ok: false };
  const obj = raw as Record<string, unknown>;
  const type = VisualType.safeParse(obj.type);
  if (!type.success) return { ok: false };
  const t = type.data;

  if (t === "none") return { ok: true, block: { type: "none", status: "ready", spec: null } };

  // Try both key conventions: mermaid spec may nest as {spec:{mermaid}} or {spec:"graph..."}
  let spec: unknown = obj.spec;
  if (t === "cycle_diagram" || t === "flowchart" || t === "timeline") {
    if (typeof spec === "string") {
      spec = { mermaid: stripMermaidFences(spec) };
    } else if (typeof spec === "object" && spec !== null && "mermaid" in (spec as object)) {
      // already shaped; pass through to schema
    } else if (typeof spec === "object" && spec !== null) {
      // model may have wrapped the mermaid source deeper, e.g. {code: "..."} or {diagram: "..."}
      const inner = spec as Record<string, unknown>;
      const candidate = inner.mermaid ?? inner.code ?? inner.diagram ?? inner.source;
      if (typeof candidate === "string") spec = { mermaid: stripMermaidFences(candidate) };
    }
  }

  if (t === "chart" && typeof spec === "object" && spec !== null) {
    spec = coerceChartSpec(spec as Record<string, unknown>);
  }

  if (t === "interactive_sim") {
    spec = coerceSimSpec(spec);
  }

  const schema = VisualSpecSchemas[t];
  const result = schema.safeParse(spec);
  if (!result.success) return { ok: false };
  return { ok: true, block: { type: t, status: "ready", spec: result.data } };
}

function stripMermaidFences(s: string): string {
  let out = s.trim();
  // ```mermaid\n...\n``` or ```\n...\n```
  const fence = /^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/.exec(out);
  if (fence?.[1]) out = fence[1];
  return out.trim();
}

function coerceChartSpec(o: Record<string, unknown>): Record<string, unknown> {
  const labelsRaw = o.labels;
  const valuesRaw = o.values;
  if (!Array.isArray(labelsRaw) || !Array.isArray(valuesRaw)) return o;
  const labels: string[] = [];
  const values: number[] = [];
  const n = Math.min(labelsRaw.length, valuesRaw.length, 12);
  for (let i = 0; i < n; i++) {
    const l = labelsRaw[i];
    const vRaw = valuesRaw[i];
    const v = typeof vRaw === "string" ? Number(vRaw.replace(/[%\s,]/g, "")) : vRaw;
    if (typeof l === "string" && typeof v === "number" && Number.isFinite(v)) {
      labels.push(l);
      values.push(v);
    }
  }
  const chartType = typeof o.chart_type === "string" ? o.chart_type : "donut";
  return { chart_type: chartType, labels, values };
}

/**
 * Canonical per-simulation parameter definitions. The LLM is told these exact keys,
 * the schema falls back to a param's defaults when the model omits/mangles one, and
 * the frontend math reads the same keys — so a sim always renders, even partially.
 */
export const SIM_PARAM_DEFS: Record<SimName, SimParam[]> = {
  projectile: [
    { key: "v0", label: "Launch speed", min: 5, max: 80, step: 1, value: 35, unit: "m/s" },
    { key: "angle", label: "Launch angle", min: 10, max: 80, step: 1, value: 45, unit: "°" },
  ],
  compound_interest: [
    { key: "principal", label: "Starting amount", min: 100, max: 100000, step: 100, value: 1000, unit: "$" },
    { key: "annual_rate", label: "Annual rate", min: 0, max: 20, step: 0.5, value: 7, unit: "%" },
    { key: "years", label: "Years", min: 1, max: 50, step: 1, value: 20 },
    { key: "compounding", label: "Compounds / year", min: 1, max: 12, step: 1, value: 12 },
    { key: "contribution", label: "Monthly add", min: 0, max: 2000, step: 50, value: 100, unit: "$" },
  ],
  binomial: [
    { key: "n", label: "Trials", min: 1, max: 20, step: 1, value: 10 },
    { key: "p", label: "Success chance", min: 0.05, max: 0.95, step: 0.05, value: 0.5 },
  ],
  pendulum: [
    { key: "length", label: "String length", min: 0.2, max: 3, step: 0.1, value: 1, unit: "m" },
    { key: "gravity", label: "Gravity", min: 1, max: 25, step: 0.5, value: 9.8, unit: "m/s²" },
    { key: "damping", label: "Damping", min: 0, max: 2, step: 0.05, value: 0.1 },
    { key: "start_angle", label: "Start angle", min: 5, max: 90, step: 1, value: 30, unit: "°" },
  ],
  rc_circuit: [
    { key: "voltage", label: "Supply voltage", min: 1, max: 24, step: 1, value: 9, unit: "V" },
    { key: "resistance", label: "Resistance", min: 100, max: 100000, step: 100, value: 10000, unit: "Ω" },
    { key: "capacitance", label: "Capacitance", min: 1, max: 1000, step: 1, value: 100, unit: "µF" },
  ],
  logistic_growth: [
    { key: "p0", label: "Initial population", min: 1, max: 1000, step: 1, value: 10 },
    { key: "k", label: "Carrying capacity", min: 100, max: 10000, step: 100, value: 1000 },
    { key: "r", label: "Growth rate", min: 0.05, max: 1.5, step: 0.05, value: 0.5 },
  ],
  sir_model: [
    { key: "population", label: "Population", min: 1000, max: 10000, step: 500, value: 10000 },
    { key: "initial_infected", label: "Initially infected", min: 1, max: 100, step: 1, value: 5 },
    { key: "beta", label: "Contact rate β", min: 0.05, max: 0.8, step: 0.01, value: 0.4 },
    { key: "gamma", label: "Recovery rate γ", min: 0.05, max: 1, step: 0.05, value: 0.25 },
  ],
};

const SIM_TITLES: Record<SimName, string> = {
  projectile: "Projectile motion",
  compound_interest: "Compound interest",
  binomial: "Binomial distribution",
  pendulum: "Damped pendulum",
  rc_circuit: "RC circuit charge & discharge",
  logistic_growth: "Logistic population growth",
  sir_model: "SIR epidemic model",
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[%$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clampVal(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Rebuild a trustworthy SimSpec from whatever the model emitted. Unknown/garbage
 * specs fall back to the canonical defaults for a valid sim; a bad sim name →
 * nothing (parse fails → pipeline falls back to "none"). Never invents data.
 */
function coerceSimSpec(spec: unknown): unknown {
  const defaults = (sim: SimName): SimParam[] =>
    SIM_PARAM_DEFS[sim].map((d) => ({ ...d }));

  let sim: SimName | null = null;
  let rawParams: Record<string, Record<string, unknown>> = {};
  let title: string | undefined;

  if (typeof spec === "object" && spec !== null) {
    const o = spec as Record<string, unknown>;
    const parsedSim = SimName.safeParse(o.sim);
    if (parsedSim.success) sim = parsedSim.data;
    if (Array.isArray(o.params)) {
      for (const p of o.params) {
        if (typeof p === "object" && p !== null) {
          const po = p as Record<string, unknown>;
          const k = typeof po.key === "string" ? po.key : null;
          if (k) rawParams[k] = po;
        }
      }
    }
    if (typeof o.title === "string" && o.title.trim()) title = o.title.trim().slice(0, 80);
  }
  // Tolerate a bare sim name at the top level: { "sim": "projectile" }.
  if (!sim && typeof spec === "string") sim = SimName.safeParse(spec).success ? (spec as SimName) : null;
  if (!sim) return { __invalid: true };

  const defs = defaults(sim);
  const params = defs.map((d) => {
    const raw = rawParams[d.key];
    const value = clampVal(num(raw?.value) ?? num(raw) ?? d.value, d.min, d.max);
    const label = typeof raw?.label === "string" && (raw.label as string).trim() ? (raw.label as string).trim().slice(0, 60) : d.label;
    const unit = typeof raw?.unit === "string" ? (raw.unit as string).slice(0, 12) : d.unit;
    return { key: d.key, label, min: d.min, max: d.max, step: d.step, value, ...(unit ? { unit } : {}) } as SimParam;
  });

  return { sim, params, title: title ?? SIM_TITLES[sim] };
}
