/** Match actual key concepts without splitting larger words. Longer phrases win,
 * and whitespace may vary between prose and formatted answer sections. */
export function createTermMatcher(terms: readonly string[]): RegExp | null {
  const unique = new Map<string, string>();
  for (const value of terms) {
    const term = value.trim().replace(/\s+/g, " ");
    if (!term || term.length > 120) continue;
    unique.set(term.toLowerCase(), term);
    if (unique.size >= 32) break;
  }
  const alternatives = [...unique.values()]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  return alternatives.length
    ? new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}\\p{M}_])`, "giu")
    : null;
}
