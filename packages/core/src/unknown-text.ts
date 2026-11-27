/** Lossless display text for values whose schema is intentionally open. */
export function unknownText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function unknownErrorText(error: unknown): string {
  return error instanceof Error ? error.message : unknownText(error) || "Unknown error";
}
