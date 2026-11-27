/** Display text for intentionally open command output values. */
export function unknownText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value) ?? "";
}

export function unknownErrorText(error: unknown): string {
  return error instanceof Error ? error.message : unknownText(error) || "Unknown error";
}
