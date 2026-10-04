import { describe, it, expect } from "vitest";
import { findConceptNode, conceptExplainQuestion, conceptVisualizeQuestion } from "./concepts";
import type { NodeEntity } from "@canvas-learn/shared";

function node(over: Partial<NodeEntity> & { id: string }): NodeEntity {
  return {
    canvas_id: "c",
    parent_id: null,
    branch_origin: "thread",
    status: "complete",
    title: "",
    question: "",
    answer_text: "",
    key_terms: [],
    suggested_followups: [],
    tags: [],
    visual: null,
    position: { x: 0, y: 0 },
    width: 420,
    collapsed: false,
    saved_to_library: false,
    model_used: "",
    web_search_used: false,
    context_summary: "",
    mode: "",
    sources: [],
    provenance: null,
    gaps: [],
    material_id: null,
    sections: [],
    note: "",
    important: false,
    review_state: { due_at: Date.now(), interval_days: 0, ease: 2.5, stability: 0, difficulty: 0, last_reviewed_at: null, times_reviewed: 0 },
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

describe("findConceptNode", () => {
  const older = node({ id: "1", question: "What is the transistor?", created_at: 100 });
  const newer = node({ id: "2", title: "Transistor basics", created_at: 200 });
  const pending = node({ id: "3", question: "Explain the transistor more", status: "answering", created_at: 300 });
  const regen = node({ id: "4", question: "transistor again", branch_origin: "regenerate", created_at: 400 });
  const failed = node({ id: "5", question: "transistor failed", status: "failed", created_at: 500 });

  it("matches completed nodes by question or title, case-insensitively", () => {
    expect(findConceptNode([older, newer], "TRANSISTOR")?.id).toBe("2"); // newest wins
    expect(findConceptNode([older], "the transistor")?.id).toBe("1");
  });

  it("never matches pending, failed, or regeneration nodes", () => {
    expect(findConceptNode([pending, regen, failed], "transistor")).toBeNull();
    expect(findConceptNode([older, pending, regen, failed], "transistor")?.id).toBe("1");
  });

  it("returns null for blank concepts and empty node sets", () => {
    expect(findConceptNode([older], "   ")).toBeNull();
    expect(findConceptNode([], "transistor")).toBeNull();
  });
});

describe("chip question builders", () => {
  it("embeds both the concept and the material title", () => {
    expect(conceptExplainQuestion("Field effect", "History of the Transistor")).toBe(
      `Explain "Field effect" as it appears in "History of the Transistor"`,
    );
    expect(conceptVisualizeQuestion("JFET", "Notes")).toBe(
      `Create a clear visual — a diagram or chart — explaining "JFET" from "Notes"`,
    );
  });
});
