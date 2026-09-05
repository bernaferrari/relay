import type { StoredAppMapDisposition } from "./app-map/stored-map-repair.js";
import { parseRowDocument } from "./collaboration-db.js";

export type DegradedAppMap = {
  key: string;
  id?: string;
  error: string;
  disposition: Extract<StoredAppMapDisposition, "read-only" | "quarantined">;
};

export function documents<T>(rows: Array<{ document?: string }>): T[] {
  return rows
    .map((row) => parseRowDocument<T>(row))
    .filter((item): item is T => item !== undefined);
}

export function degradedFromRaw(
  key: string,
  error: string,
  raw: unknown,
  disposition: Extract<StoredAppMapDisposition, "read-only" | "quarantined"> = "quarantined",
): DegradedAppMap {
  return {
    key,
    error,
    disposition,
    id:
      Boolean(raw) &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      typeof (raw as { id?: unknown }).id === "string"
        ? (raw as { id: string }).id
        : undefined,
  };
}

export function persistedDisposition(
  value: string | null | undefined,
): Extract<StoredAppMapDisposition, "read-only" | "quarantined"> {
  return value === "read-only" ? "read-only" : "quarantined";
}

export function storedDisposition(value: string | null | undefined): StoredAppMapDisposition {
  switch (value) {
    case "migrated":
    case "read-only":
    case "quarantined":
      return value;
    default:
      return "ready";
  }
}

export function parseAppMapDocument(source: string): unknown | undefined {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}
