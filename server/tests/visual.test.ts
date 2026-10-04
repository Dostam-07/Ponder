import { describe, it, expect } from "vitest";
import { parseVisualSpec } from "@canvas-learn/shared";
import { STAGE3_SYSTEM } from "../src/pipeline/prompts.js";
import { normalizeVisualPayload } from "../src/pipeline/pipeline.js";

describe("normalizeVisualPayload — flattened model output (regression, live gemma3:4b finding)", () => {
  it("repairs the exact observed quirk: top-level mermaid instead of spec.mermaid", () => {
    // verbatim shape observed from the live model on 2026-10-03 (Create Visual failure)
    const raw = {
      type: "cycle_diagram",
      mermaid: "flowchart LR\nA[Transfer of Electrons] --> B[Imbalance of Charges] --> C[Buildup of Electric Charge]",
    };
    const r = parseVisualSpec(normalizeVisualPayload(raw));
    expect(r.ok).toBe(true);
    expect(r.block?.type).toBe("cycle_diagram");
    expect((r.block?.spec as { mermaid: string }).mermaid).toContain("flowchart LR");
  });

  it("repairs flattened chart and comparison-table specs", () => {
    const chart = parseVisualSpec(normalizeVisualPayload({ type: "chart", chart_type: "bar", labels: ["a", "b"], values: [1, 2] }));
    expect(chart.ok).toBe(true);
    const table = parseVisualSpec(normalizeVisualPayload({ type: "comparison_table", headers: ["A", "B"], rows: [["1", "2"]] }));
    expect(table.ok).toBe(true);
  });

  it("unwraps one level of wrapping around the payload", () => {
    const r = parseVisualSpec(normalizeVisualPayload({ result: { type: "flowchart", spec: "flowchart TD\nA --> B" } }));
    expect(r.ok).toBe(true);
    expect(r.block?.type).toBe("flowchart");
  });

  it("leaves already-shaped and invalid payloads untouched (no invented data)", () => {
    const shaped = { type: "flowchart", spec: { mermaid: "flowchart TD\nA --> B" } };
    expect(normalizeVisualPayload(shaped)).toEqual(shaped);
    // unknown types must still be rejected after normalization
    expect(parseVisualSpec(normalizeVisualPayload({ type: "watercolor", mermaid: "flowchart TD" })).ok).toBe(false);
  });
});

describe("parseVisualSpec", () => {
  it("accepts a persisted picture and rejects missing or non-image data", () => {
    const spec = {
      data_url: "data:image/png;base64,iVBORw0KGgo=",
      media_type: "image/png",
      prompt: "A water cycle illustration",
      alt: "An illustrated water cycle",
      model: "test/image-model",
    };
    expect(parseVisualSpec({ type: "image", spec }).block).toEqual({ type: "image", status: "ready", spec });
    expect(parseVisualSpec({ type: "image", spec: { ...spec, data_url: "https://example.com/placeholder.png" } }).ok).toBe(false);
    expect(parseVisualSpec({ type: "image", spec: null }).ok).toBe(false);
  });

  it("accepts a valid chart spec with numeric values", () => {
    const r = parseVisualSpec({
      type: "chart",
      spec: { chart_type: "donut", labels: ["Ocean", "Freshwater"], values: [96.5, 2.5] },
    });
    expect(r.ok).toBe(true);
    expect(r.block?.type).toBe("chart");
  });

  it("coerces numeric strings and drops non-numeric chart entries", () => {
    const r = parseVisualSpec({
      type: "chart",
      spec: { chart_type: "bar", labels: ["a", "b", "c"], values: ["50%", "33", "oops"] },
    });
    expect(r.ok).toBe(true);
    const spec = r.block?.spec as { labels: string[]; values: number[] };
    expect(spec.labels).toEqual(["a", "b"]);
    expect(spec.values).toEqual([50, 33]);
  });

  it("unwraps a bare mermaid string for flowcharts", () => {
    const r = parseVisualSpec({ type: "flowchart", spec: "flowchart TD\nA[Step 1] --> B[Step 2]" });
    expect(r.ok).toBe(true);
    expect((r.block?.spec as { mermaid: string }).mermaid).toContain("flowchart TD");
  });

  it("strips mermaid code fences", () => {
    const r = parseVisualSpec({
      type: "cycle_diagram",
      spec: "```mermaid\nflowchart LR\nA[X] --> B[Y] --> A\n```",
    });
    expect(r.ok).toBe(true);
    expect((r.block?.spec as { mermaid: string }).mermaid).not.toContain("```");
  });

  it("accepts type none with null spec", () => {
    const r = parseVisualSpec({ type: "none", spec: null });
    expect(r.ok).toBe(true);
    expect(r.block?.type).toBe("none");
  });

  it("accepts a valid comparison table", () => {
    const r = parseVisualSpec({
      type: "comparison_table",
      spec: { headers: ["Aspect", "A", "B"], rows: [["size", "big", "small"]] },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects unknown types and malformed specs", () => {
    expect(parseVisualSpec({ type: "watercolor", spec: null }).ok).toBe(false);
    expect(parseVisualSpec({ type: "chart", spec: { chart_type: "donut" } }).ok).toBe(false);
    expect(parseVisualSpec(null).ok).toBe(false);
    expect(parseVisualSpec("hello").ok).toBe(false);
    expect(
      parseVisualSpec({ type: "comparison_table", spec: { headers: ["only-one"], rows: [] } }).ok,
    ).toBe(false);
  });

  it("accepts illustration spec shape (deferred renderer)", () => {
    const r = parseVisualSpec({
      type: "illustration",
      spec: { scene: "water cycle", elements: [{ icon: "cloud", label: "evaporation", x: 10, y: 20 }] },
    });
    expect(r.ok).toBe(true);
  });

  describe("interactive_sim", () => {
    it("accepts a valid sim spec and clamps out-of-range values", () => {
      const r = parseVisualSpec({
        type: "interactive_sim",
        spec: {
          sim: "projectile",
          title: "How a throw works",
          params: [
            { key: "v0", label: "Speed", min: 5, max: 80, step: 1, value: 120 }, // above max → clamped
            { key: "angle", label: "Angle", min: 10, max: 80, step: 1, value: 45 },
          ],
        },
      });
      expect(r.ok).toBe(true);
      const spec = r.block!.spec as { sim: string; params: { key: string; value: number; max: number }[] };
      expect(spec.sim).toBe("projectile");
      const v0 = spec.params.find((p) => p.key === "v0")!;
      expect(v0.value).toBe(v0.max); // 120 → 80
    });

    it("recovers a bare sim name / missing params into canonical defaults", () => {
      const r = parseVisualSpec({ type: "interactive_sim", spec: { sim: "binomial", params: [] } });
      expect(r.ok).toBe(true);
      const spec = r.block!.spec as { sim: string; params: { key: string; value: number }[]; title: string };
      expect(spec.sim).toBe("binomial");
      expect(spec.params.length).toBeGreaterThanOrEqual(2); // canonical n + p
      expect(spec.title).toBeTruthy();
    });

    it("rejects an unknown sim name (falls back to none in the pipeline)", () => {
      const r = parseVisualSpec({ type: "interactive_sim", spec: { sim: "black_hole", params: [] } });
      expect(r.ok).toBe(false);
    });

    it("recovers the new sims (sir_model etc.) into canonical defaults with correct keys", () => {
      const r = parseVisualSpec({ type: "interactive_sim", spec: { sim: "sir_model", params: [] } });
      expect(r.ok).toBe(true);
      const spec = r.block!.spec as { sim: string; params: { key: string }[] };
      expect(spec.sim).toBe("sir_model");
      expect(spec.params.map((p) => p.key).sort()).toEqual(["beta", "gamma", "initial_infected", "population"]);
      const sir = parseVisualSpec({ type: "interactive_sim", spec: { sim: "logistic_growth", params: [] } });
      expect(sir.ok).toBe(true);
      expect((sir.block!.spec as { params: { key: string }[] }).params.map((p) => p.key).sort()).toEqual(["k", "p0", "r"]);
      const pend = parseVisualSpec({ type: "interactive_sim", spec: { sim: "pendulum", params: [] } });
      expect(pend.ok).toBe(true);
      expect((pend.block!.spec as { params: { key: string }[] }).params.map((p) => p.key).sort()).toEqual([
        "damping",
        "gravity",
        "length",
        "start_angle",
      ]);
      const rc = parseVisualSpec({ type: "interactive_sim", spec: { sim: "rc_circuit", params: [] } });
      expect(rc.ok).toBe(true);
      expect((rc.block!.spec as { params: { key: string }[] }).params.map((p) => p.key).sort()).toEqual([
        "capacitance",
        "resistance",
        "voltage",
      ]);
    });

    it("clamps out-of-range values on the new sims", () => {
      const r = parseVisualSpec({
        type: "interactive_sim",
        spec: { sim: "sir_model", params: [{ key: "beta", label: "β", min: 0.05, max: 0.8, step: 0.01, value: 5 }] },
      });
      expect(r.ok).toBe(true);
      const spec = r.block!.spec as { params: { key: string; value: number; max: number }[] };
      const beta = spec.params.find((p) => p.key === "beta")!;
      expect(beta.value).toBe(beta.max); // 5 → 0.8
    });
  });

  describe("stage-3 prompt offers the full simulation library", () => {
    it("lists every sim name exactly once so the model can select them", () => {
      for (const name of [
        "projectile",
        "compound_interest",
        "binomial",
        "pendulum",
        "rc_circuit",
        "logistic_growth",
        "sir_model",
      ]) {
        expect(STAGE3_SYSTEM).toContain(`"${name}"`);
      }
    });
  });

  describe("illustration (schema-ready, renderer intentionally deferred — ADR-005)", () => {
    it("still parses and preserves legacy illustration specs (persisted data must not break)", () => {
      const r = parseVisualSpec({
        type: "illustration",
        spec: { scene: "cell structure", elements: [{ icon: "orbit", label: "nucleus", x: 50, y: 50 }] },
      });
      expect(r.ok).toBe(true);
      const spec = r.block!.spec as { scene: string; elements: { label?: string }[] };
      expect(spec.scene).toBe("cell structure");
      expect(spec.elements[0]!.label).toBe("nucleus");
    });

    it("accepts the extended metadata (caption, style) for a future renderer", () => {
      const r = parseVisualSpec({
        type: "illustration",
        spec: {
          scene: "water cycle over a landscape",
          elements: [{ icon: "orbit", label: "cloud", x: 30, y: 20 }],
          caption: "Evaporation → condensation → precipitation",
          style: "schematic cross-section",
        },
      });
      expect(r.ok).toBe(true);
      const spec = r.block!.spec as { caption?: string; style?: string };
      expect(spec.caption).toBe("Evaporation → condensation → precipitation");
      expect(spec.style).toBe("schematic cross-section");
    });

    it("the stage-3 prompt never offers illustration to the model (no fake illustration content)", () => {
      expect(STAGE3_SYSTEM).not.toMatch(/"illustration"/);
      // spatial/structural cases are explicitly routed to real diagram types instead
      expect(STAGE3_SYSTEM).toContain("cycle_diagram or flowchart");
    });
  });
});
