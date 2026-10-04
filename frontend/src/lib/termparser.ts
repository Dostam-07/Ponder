export type Segment =
  | { kind: "text"; text: string }
  | { kind: "term"; term: string };

/**
 * Parse answer text containing [[term]] markup into render segments.
 * Tolerates a trailing unclosed "[[..." while streaming (renders as plain text
 * until the closing brackets arrive). Used by NodeCard during and after streaming.
 */
export function parseAnswerSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[\[([^\[\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ kind: "text", text: text.slice(last, m.index) });
    segments.push({ kind: "term", term: m[1] ?? "" });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  if (rest) segments.push({ kind: "text", text: rest });
  return segments;
}

/** Extract all closed [[term]] markers. */
export function extractTerms(text: string): string[] {
  return [...text.matchAll(/\[\[([^\[\]]+)\]\]/g)]
    .map((m) => m[1])
    .filter((t): t is string => typeof t === "string");
}
