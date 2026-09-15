/** Walk common invoke envelopes so preview PNGs are not dumped as JSON. */
export function pngScreenshotRecord(result: unknown): Record<string, unknown> | undefined {
  const seen = new Set<unknown>();
  let current: unknown = result;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object" || Array.isArray(current) || seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.mime === "image/png" && typeof record.base64 === "string") return record;
    current = record.result ?? record.data ?? record.payload;
  }
  return undefined;
}
