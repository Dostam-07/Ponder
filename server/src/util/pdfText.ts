import { inflateSync } from "node:zlib";

/**
 * Minimal, dependency-free PDF text extractor for the research workspace.
 *
 * Strategy: scan the raw bytes for `stream … endstream` blocks, inflate the
 * FlateDecode ones, and pull text out of the content-stream operators
 * (`Tj`, `TJ`, plus `Td`/`TD`/`T*` for line breaks). This covers the common
 * case — text PDFs generated from Word / LaTeX / browser print — where text
 * is stored as literal strings in standard fonts.
 *
 * It is intentionally conservative: when it cannot find readable text it
 * throws, and the caller surfaces a clear "could not extract text" error
 * instead of inventing content.
 */

/** Decode a PDF literal string `( … )` honoring backslash escapes. */
function decodeLiteralString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n == null) break;
    switch (n) {
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "(": out += "("; break;
      case ")": out += ")"; break;
      case "\\": out += "\\"; break;
      case "\n": break; // line continuation
      case "\r":
        if (s[i + 1] === "\n") i++;
        break;
      default:
        if (n >= "0" && n <= "7") {
          // octal escape, up to 3 digits
          let oct = n;
          while (oct.length < 3) {
            const nx = s[i + 1];
            if (nx != null && nx >= "0" && nx <= "7") oct += nx;
            else break;
            i++;
          }
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += n;
        }
    }
  }
  return out;
}

/** Try to read a literal string starting at `s[pos] === '(' — returns [text, endIndex]. */
function readParenString(s: string, pos: number): [string, number] | null {
  if (s[pos] !== "(") return null;
  let depth = 1;
  let i = pos + 1;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return [decodeLiteralString(s.slice(pos + 1, i - 1)), i];
}

/**
 * Extract text from one (already inflated) content stream. Handles:
 *   (text) Tj            — show string
 *   [(a) -120 (b)] TJ    — show array with kerning gaps
 *   Td / TD / T*         — move to next line → newline
 */
function textFromContentStream(cs: string): string {
  const parts: string[] = [];
  // TJ arrays first (they contain the richest text)
  const tjRe = /\[((?:[^\]\\]|\\.)*)\]\s*TJ/g;
  for (const m of cs.matchAll(tjRe)) {
    const inner = m[1];
    if (!inner) continue;
    let text = "";
    let lastKern = 0; // spacing value (1/1000 em) between the previous string and the next
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === "(") {
        const r = readParenString(inner, i);
        if (!r) break;
        // A large negative kern is word spacing in most generated PDFs
        // (Helvetica's space ≈ -278 at 1000-units/em); small kerns are intra-word.
        if (text && lastKern <= -100) text += " ";
        text += r[0];
        lastKern = 0;
        i = r[1];
      } else {
        const num = /^-?\d+(\.\d+)?/.exec(inner.slice(i));
        if (num && (inner[i] === "-" || inner[i]! >= "0")) {
          lastKern = parseFloat(num[0]);
          i += num[0].length;
        } else i++;
      }
    }
    if (text.trim()) parts.push(text);
  }
  // Then simple `(...) Tj`. Scan with balanced-depth string reading rather than a
  // greedy regex: a regex that allows `)` inside the literal captures across
  // multiple `(text) Tj` occurrences and swallows the operators between them.
  for (let i = 0; i < cs.length; i++) {
    if (cs[i] !== "(") continue;
    const r = readParenString(cs, i);
    if (!r) {
      i++;
      continue;
    }
    const decoded = r[0];
    if (decoded.trim() && /^\s*Tj\b/.test(cs.slice(r[1], r[1] + 8))) parts.push(decoded);
    i = r[1];
  }
  if (!parts.length) return "";
  return parts.join("\n");
}

/** Pull all stream bodies out of raw PDF bytes, inflating Flate-compressed ones. */
function streamBodies(raw: Buffer): string[] {
  const bodies: string[] = [];
  const text = raw.toString("latin1"); // byte-preserving decode for scanning
  const startRe = /stream\r?\n/g;
  for (const m of text.matchAll(startRe)) {
    // "endstream" contains the substring "stream" — skip those matches.
    if (m.index! > 0 && text[m.index! - 1] === "d") continue;
    const begin = m.index! + m[0].length;
    const end = text.indexOf("endstream", begin);
    if (end === -1) continue;
    const chunk = raw.subarray(begin, end);
    // Most content streams are FlateDecode; try inflate, fall back to raw.
    try {
      const inflated = inflateSync(chunk);
      bodies.push(inflated.toString("latin1"));
    } catch {
      // Not flate (or already plain) — only worth scanning if it looks like a content stream.
      const plain = chunk.toString("latin1");
      if (/T[jJ]|\bTf\b/.test(plain)) bodies.push(plain);
    }
  }
  return bodies;
}

/**
 * Extract readable text from PDF bytes.
 * @throws Error when the bytes are not a PDF or no extractable text is found.
 */
export function extractPdfText(raw: Buffer): string {
  if (raw.length < 4 || raw.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("Not a valid PDF file");
  }
  const extracted: string[] = [];
  for (const body of streamBodies(raw)) {
    const t = textFromContentStream(body);
    if (t.trim()) extracted.push(t.trim());
  }
  const out = extracted.join("\n\n");
  // Require *words* — a PDF full of glyph codes or images yields nothing usable.
  const wordCount = out.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  if (wordCount < 3) {
    throw new Error("Could not extract readable text from this PDF (it may be scanned images or use unsupported fonts)");
  }
  return out;
}
