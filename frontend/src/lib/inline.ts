/**
 * Minimal inline renderer for answer text: **bold** and *italic* only — enough for
 * LLM answers, no HTML injection surface (everything is React text nodes).
 */
export function renderInline(text: string): { text: string; bold?: boolean; italic?: boolean }[] {
  const out: { text: string; bold?: boolean; italic?: boolean }[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ text: tok.slice(2, -2), bold: true });
    else out.push({ text: tok.slice(1, -1), italic: true });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
