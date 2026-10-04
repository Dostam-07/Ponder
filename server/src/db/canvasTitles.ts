/**
 * Canvas conversation titles — derivation and repair.
 *
 * Two problems this module solves:
 *  1. New canvases stayed "Untitled canvas" forever: the title is now derived
 *     from the REAL first conversation (stage-2 AI title, else the cleaned
 *     user question) and set the moment the first answer settles.
 *  2. Test sessions left technical artifact titles ("E2E Water 2", "Smoke
 *     Test"): at startup, a conservative, idempotent repair re-derives those
 *     titles from the canvas's actual conversation content. Legitimate
 *     topic titles — including genuine "E2E testing" topics — are preserved.
 *
 * Everything here is pure and testable; the DB applies the plan.
 */

const MAX_TITLE = 60;

/** Trailing/leading instruction scaffolding that is not part of the topic. */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\s+answer in (one|two|three|a few|\d+) (words?|sentences?|paragraphs?)\.?\s*$/i,
  /\s+answer (briefly|shortly|in one word|with one word|in a word)\.?\s*$/i,
  /\s+in (one|two|three|a few|\d+) (words?|sentences?)\.?\s*$/i,
  /\s+keep it (short|brief|simple)\.?\s*$/i,
  /\s+be concise\.?\s*$/i,
  /^\s*please\s+/i,
];

/** Capitalize the first letter (titles display better; idempotent for AI titles). */
export function capitalizeFirst(t: string): string {
  t = (t ?? "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Clean a raw user question into a usable title fragment: strips instruction
 * scaffolding ("… Answer in two sentences."), collapses whitespace, and caps
 * at a word boundary (never mid-word). Returns "" if nothing usable remains.
 */
export function stripInstructions(question: string): string {
  let t = (question ?? "").replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed && t) {
    changed = false;
    for (const re of INSTRUCTION_PATTERNS) {
      const next = t.replace(re, " ").trim();
      if (next !== t) {
        t = next;
        changed = true;
      }
    }
  }
  return capAtWord(t, MAX_TITLE);
}

/** Cap at `max` characters, breaking at a word boundary (no dangling fragment). */
export function capAtWord(t: string, max: number): string {
  t = (t ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  // If the only break point is very early, prefer the hard cut over a 2-char title.
  if (space < Math.floor(max / 2)) return t.slice(0, max).trimEnd();
  return cut.slice(0, space).trimEnd();
}

/**
 * Derive a conversation title from REAL content only:
 * prefer the stage-2 AI title (an encyclopedia-style topic heading), fall back
 * to the cleaned user question. Never invents a topic; returns "" if both empty.
 */
export function deriveCanvasTitle(question: string, aiTitle?: string): string {
  const ai = (aiTitle ?? "").trim();
  if (ai) return capitalizeFirst(capAtWord(ai, MAX_TITLE));
  return capitalizeFirst(stripInstructions(question));
}

/**
 * True for technical/test ARTIFACT titles (labels a test run stamped on a
 * conversation), e.g. "E2E Water 2", "Smoke Test", "Test 1", "Session 3".
 *
 * Deliberately conservative:
 *  - "Playwright E2E Testing"      → false (topic word first — legit)
 *  - "E2E Testing in Playwright"   → false (real multi-word topic after prefix)
 *  - "E2E Water 2"                 → true  (prefix + short tail / trailing number)
 *  - "Testing in general"          → false (legit short topic, no junk markers)
 */
const ARTIFACT_PREFIX = /^(e2e|end[- ]to[- ]end|smoke|test|tests|testing|debug|diagnostic|session|chat|convo|conversation|thread|probe|scratch|temp|tmp|dev|qa|sample|demo|untitled)\b/i;
const ARTIFACT_TAIL_MARKERS = /\b(test|tests|run|runs|probe|check|fixture|artifact|copy|draft)\b/i;

export function isArtifactTitle(title: string): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  const m = ARTIFACT_PREFIX.exec(t);
  if (!m) return false;
  const rest = t.slice(m[0].length).replace(/^[- _–—:.]+/, "").trim();
  if (!rest) return true; // "Test", "E2E", "Smoke Test" (no — that has tail) ... "Debug"
  const words = rest.split(/\s+/);
  if (words.length <= 1) return true; // "E2E Water" ~ label; "Test 1"; "Session"
  if (words.length <= 4 && /\d/.test(words[words.length - 1]!)) return true; // "E2E Water 2"
  if (words.length <= 4 && ARTIFACT_TAIL_MARKERS.test(rest)) return true; // "E2E Water Test"
  return false;
}

/** Canvas shapes the repair needs (no DB types → pure planning). */
export interface TitleRepairCanvas {
  id: string;
  title: string;
}
export interface TitleRepairNode {
  /** Stage-2 AI title ("" until stage 2 succeeds). */
  title: string;
  question: string;
  status: string;
}

export interface TitleRepairPlan {
  id: string;
  from: string;
  to: string;
}

/**
 * Plan title repairs for a canvas. Returns null when the title should be kept:
 *  - meaningful titles (including legit E2E topics) are never touched;
 *  - canvases with no usable real content keep their title (we don't invent topics).
 */
/**
 * A title that is a truncated head of the canvas's own first question — the
 * artifact of the old `question.slice(0, 40)` fallback stored as a node title
 * ("What is a black hole? Answer in two sent"). Recognized so startup repair
 * can re-derive it cleanly.
 */
function isTruncatedQuestionArtifact(title: string, firstQuestion: string): boolean {
  const t = title.trim();
  return t.length >= 20 && firstQuestion.length > t.length && firstQuestion.startsWith(t);
}

export function planTitleRepair(canvas: TitleRepairCanvas, nodesInOrder: readonly TitleRepairNode[]): TitleRepairPlan | null {
  const { title } = canvas;
  const firstQuestion = nodesInOrder.find((n) => n.question.trim() !== "")?.question.trim() ?? "";
  const needsRepair =
    title === "Untitled canvas" ||
    title.trim() === "" ||
    isArtifactTitle(title) ||
    isTruncatedQuestionArtifact(title, firstQuestion);
  if (!needsRepair) return null;

  const normalized = title.trim();

  // Best real source: first completed node with a stage-2 topic title.
  // Skip node titles that are themselves truncated-question artifacts.
  const withAiTitle = nodesInOrder.find(
    (n) =>
      n.status === "complete" &&
      n.title.trim() !== "" &&
      !isTruncatedQuestionArtifact(n.title, n.question),
  );
  if (withAiTitle) {
    const to = capitalizeFirst(capAtWord(withAiTitle.title.trim(), MAX_TITLE));
    return to === normalized ? null : { id: canvas.id, from: title, to }; // no-op renames churn updated_at
  }

  // Fallback: first real question (any status), instruction scaffolding removed.
  const withQuestion = nodesInOrder.find((n) => n.question.trim() !== "");
  if (withQuestion) {
    const derived = deriveCanvasTitle(withQuestion.question);
    if (derived && derived !== normalized) return { id: canvas.id, from: title, to: derived };
  }
  return null;
}

/**
 * Plan repairs for many canvases (nodes ordered by created_at per canvas).
 * Idempotent: a repaired title no longer matches the artifact rule, and
 * meaningful titles are never in the plan.
 */
export function planTitleRepairs(
  canvases: readonly TitleRepairCanvas[],
  nodesByCanvas: ReadonlyMap<string, readonly TitleRepairNode[]>,
): TitleRepairPlan[] {
  const plan: TitleRepairPlan[] = [];
  for (const c of canvases) {
    const p = planTitleRepair(c, nodesByCanvas.get(c.id) ?? []);
    if (p) plan.push(p);
  }
  return plan;
}
