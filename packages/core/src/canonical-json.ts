import { createHash } from "node:crypto";

export type CanonicalSha256 = `sha256:${string}`;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function serializeCanonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      // ECMAScript's default sort compares UTF-16 code units. Unlike
      // localeCompare(), it is independent of the host locale and ICU data.
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson(value[key]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonicalize a JSON-compatible value after applying the platform's normal
 * JSON projection (`toJSON`, omitted object `undefined`, array `null`). The
 * result is locale-independent and therefore safe as durable digest input. */
export function canonicalJson(value: unknown): string {
  const projected = JSON.stringify(value);
  if (projected === undefined) {
    throw new TypeError("Canonical JSON requires a JSON-compatible root value");
  }
  return serializeCanonicalJson(JSON.parse(projected) as JsonValue);
}

export function canonicalSha256(value: unknown): CanonicalSha256 {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
