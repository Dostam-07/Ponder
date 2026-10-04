import { createTermMatcher } from "@canvas-learn/shared";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "term"; term: string };

/**
 * Parse [[term]] markup and saved key concepts into render segments. Metadata
 * keeps terms clickable when section formatting omits the original markers.
 * Tolerates a trailing unclosed "[[..." while streaming (renders as plain text
 * until the closing brackets arrive). Used by NodeCard during and after streaming.
 */
export function parseAnswerSegments(text: string, keyTerms: readonly string[] = []): Segment[] {
  const segments: Segment[] = [];
  const matcher = createTermMatcher(keyTerms);
  const plain = (value: string) => {
    // An unfinished marker is still streaming text, not an interactive term.
    const unfinished = value.indexOf("[[");
    const searchable = unfinished < 0 ? value : value.slice(0, unfinished);
    let cursor = 0;
    if (matcher) {
      matcher.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(searchable))) {
        if (match.index > cursor) segments.push({ kind: "text", text: value.slice(cursor, match.index) });
        segments.push({ kind: "term", term: match[0] });
        cursor = match.index + match[0].length;
      }
    }
    if (cursor < value.length) segments.push({ kind: "text", text: value.slice(cursor) });
  };
  const re = /\[\[([^\[\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) plain(text.slice(last, m.index));
    segments.push({ kind: "term", term: m[1] ?? "" });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  if (rest) plain(rest);
  return segments;
}

/** Extract all closed [[term]] markers. */
export function extractTerms(text: string): string[] {
  return [...text.matchAll(/\[\[([^\[\]]+)\]\]/g)]
    .map((m) => m[1])
    .filter((t): t is string => typeof t === "string");
}

/** Keep the clicked concept in the grounding excerpt, even near a long answer's end. */
export function termExplanationContext(text: string, term: string): string {
  const plain = text.replace(/\[\[|\]\]/g, "");
  const match = createTermMatcher([term])?.exec(plain);
  const start = Math.max(0, (match?.index ?? 0) - 400);
  return plain.slice(start, start + 1200);
}
