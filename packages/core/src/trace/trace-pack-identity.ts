import { createHash } from "node:crypto";
import type { TracePack, TracePackObject } from "@relay/protocol";

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function tracePackSha256(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function tracePackDigest(pack: Omit<TracePack, "digest">): `sha256:${string}` {
  return tracePackSha256(canonicalJson(pack));
}

export function tracePackObjectBytes(object: TracePackObject): Buffer {
  if (object.encoding === "base64") return Buffer.from(object.content as string, "base64");
  return Buffer.from(canonicalJson(object.content));
}
