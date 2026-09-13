/** Content-assertion matching used by grok-web `assert-content` steps. */

export type ContentAssertionMatch =
  | "exact"
  | "equals"
  | "contains"
  | "not-contains"
  | "number-equals"
  | "field";

const INTEGER_NEEDLE = /^\d+$/u;
const PURE_NUMBER = /^\d+(?:\.\d+)?$/u;

/** Digit-only needles match a numeric token, not a substring of a larger number. */
export function contentContains(actual: string, expected: string): boolean {
  if (!INTEGER_NEEDLE.test(expected)) return actual.includes(expected);
  return new RegExp(`(?<!\\d)${expected}(?!\\d)`, "u").test(actual);
}

function numberEquals(actual: string, expected: string): boolean {
  const trimmed = actual.trim();
  if (!PURE_NUMBER.test(trimmed)) return false;
  return Number(trimmed) === Number(expected);
}

function fieldValue(actual: string, field: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(actual);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && field in parsed) {
      const value = (parsed as Record<string, unknown>)[field];
      return value === undefined || value === null ? undefined : String(value);
    }
  } catch {
    // Not JSON: fall through to labeled lines.
  }
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*[:=]\\s*(.*)$`, "imu").exec(actual);
  return match?.[1]?.trim();
}

export function contentAssertionPassed(
  actual: string,
  expected: string,
  match: ContentAssertionMatch,
  field?: string,
): boolean {
  if (match === "exact" || match === "equals") return actual === expected;
  if (match === "number-equals") return numberEquals(actual, expected);
  if (match === "field") {
    if (!field?.trim()) return false;
    const value = fieldValue(actual, field.trim());
    return value === expected;
  }
  const contained = contentContains(actual, expected);
  return match === "contains" ? contained : !contained;
}
