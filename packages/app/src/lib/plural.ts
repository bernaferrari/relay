/**
 * "1 languages" is the kind of thing that makes a careful product look
 * unfinished, and it was appearing in toasts, footers and summaries across the
 * app because each one hand-rolled its own count string. One helper so a count
 * and its noun are never written apart.
 */
export function plural(count: number, one: string, many?: string): string {
  return `${count} ${pluralNoun(count, one, many)}`;
}

/** The noun on its own, for the places that format the number separately (a
 * tabular-nums span, say, so the digits do not shift as a sweep progresses). */
export function pluralNoun(count: number, one: string, many?: string): string {
  return count === 1 ? one : (many ?? `${one}s`);
}
