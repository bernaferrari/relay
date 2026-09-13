/** Content-assertion matching used by grok-web `assert-content` steps. */

export type ContentAssertionMatch = "exact" | "contains" | "not-contains";

const INTEGER_NEEDLE = /^\d+$/u;

/** Digit-only needles match a numeric token, not a substring of a larger number. */
export function contentContains(actual: string, expected: string): boolean {
  if (!INTEGER_NEEDLE.test(expected)) return actual.includes(expected);
  return new RegExp(`(?<!\\d)${expected}(?!\\d)`, "u").test(actual);
}

export function contentAssertionPassed(
  actual: string,
  expected: string,
  match: ContentAssertionMatch,
): boolean {
  if (match === "exact") return actual === expected;
  const contained = contentContains(actual, expected);
  return match === "contains" ? contained : !contained;
}
