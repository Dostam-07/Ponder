const NODE_W = 420;
const GAP_X = 80;
const GAP_Y = 120;

/** Directional placement for the node-edge `+` buttons (PRD FR6). */
export type PlusDirection = "top" | "left" | "right";

/** Compute a child position relative to its parent, per PRD §10 (simple radial/offset layout). */
export function childPosition(
  parent: { position: { x: number; y: number }; width: number },
  origin: "thread" | "followup_box" | "term_chip" | "suggested_question" | "manual_plus" | "path_section" | "material",
  existingSiblings: { position: { x: number; y: number } }[],
  direction?: PlusDirection,
): { x: number; y: number } {
  const p = parent.position;
  const w = parent.width || NODE_W;

  if (origin === "manual_plus") {
    switch (direction) {
      case "top":
        return { x: p.x, y: p.y - GAP_Y * 2 };
      case "left":
        return { x: p.x - w - GAP_X, y: p.y };
      case "right":
      default:
        return { x: p.x + w + GAP_X, y: p.y };
    }
  }

  // content-driven branches cascade down-right, stacking per existing child count
  const idx = existingSiblings.length;
  return { x: p.x + idx * 60 + 40, y: p.y + GAP_Y * 2 + idx * 24 };
}

/** Position for a brand-new root node (free space to the right of existing roots). */
export function rootPosition(existingRoots: { position: { x: number; y: number } }[]): { x: number; y: number } {
  return { x: existingRoots.length * (NODE_W + GAP_X), y: 0 };
}
