/**
 * Pure text-cleaning for speech synthesis (roadmap 5). The browser TTS engine reads
 * characters, not Markdown — so we strip wikilinks/bold/code/headings down to plain
 * words before speaking. Kept as a pure function so it's unit-testable without audio.
 */
export function sanitizeForSpeech(text: string, maxChars = 4500): string {
  if (!text) return "";
  const cleaned = text
    .replace(/\[\[([^\]]*)\]\]/g, "$1") // [[term]] → term
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/\*([^*\n]+)\*/g, "$1") // *soft* → soft
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    .replace(/^\s*#{1,6}\s+/gm, "") // "# Heading" → "Heading"
    .replace(/^[-*]\s+/gm, "") // list bullets → plain
    .replace(/[*_`]/g, "") // safety net: drop any leftover emphasis/code markers
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  // Truncate at a word boundary (never mid-word) and signal the cut.
  const cut = cleaned.slice(0, maxChars);
  const stop = cut.lastIndexOf(" ");
  return (stop > maxChars * 0.6 ? cut.slice(0, stop) : cut).trim() + "…";
}

/**
 * Join several spoken chunks (e.g. a recap intro + per-node summaries) into one
 * clean utterance, dropping empties and collapsing whitespace.
 */
export function joinForSpeech(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
}
