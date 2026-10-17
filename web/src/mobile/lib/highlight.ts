/**
 * Splits `text` into plain and highlighted parts for the given terms (the
 * `highlights` a search hit carries). Longer terms win where they overlap, and
 * matching ignores case.
 */
export function splitHighlights(text: string, terms: readonly string[]): Array<{ text: string; hit: boolean }> {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (cleaned.length === 0 || !text) return text ? [{ text, hit: false }] : [];
  const pattern = new RegExp(`(${cleaned.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: cleaned.some((t) => t.toLowerCase() === part.toLowerCase()) }));
}
