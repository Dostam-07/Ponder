import type { NodeEntity } from "@canvas-learn/shared";

/**
 * Concept-chip helpers (roadmap item 3): a material's extracted concepts become
 * interactive chips whose actions target REAL canvas nodes — never invented ones.
 */

/**
 * Find the best completed node on this canvas that covers `concept`
 * (case-insensitive substring in question or title). Failed/pending nodes and
 * regenerations never qualify. Newest match wins.
 */
export function findConceptNode(nodes: Iterable<NodeEntity>, concept: string): NodeEntity | null {
  const key = concept.trim().toLowerCase();
  if (!key) return null;
  const matches = [...nodes].filter(
    (n) =>
      n.status === "complete" &&
      n.branch_origin !== "regenerate" &&
      ((n.question ?? "").toLowerCase().includes(key) || (n.title ?? "").toLowerCase().includes(key)),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.created_at - a.created_at);
  return matches[0] ?? null;
}

/** The question used for the "Explain" chip action — grounded in the source material. */
export function conceptExplainQuestion(concept: string, materialTitle: string): string {
  return `Explain "${concept}" as it appears in "${materialTitle}"`;
}

/** The question used for the "Visualize" chip action — the pipeline attaches a visual to the answer node. */
export function conceptVisualizeQuestion(concept: string, materialTitle: string): string {
  return `Create a clear visual — a diagram or chart — explaining "${concept}" from "${materialTitle}"`;
}
