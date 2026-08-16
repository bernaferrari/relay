import { validateAppMap } from "./validation.js";
import { APP_MAP_SCHEMA_VERSION, type AppMap } from "./model.js";

const UNKNOWN_FIELD = /^(.*) contains unknown field (\S+)$/;
const PATH_TOKEN = /([^.[\]]+)|\[(\d+)\]/g;
const MAX_REPAIRS = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Walk an App Map validation label and delete the named unknown field. */
export function deleteUnknownFieldAtLabel(root: unknown, label: string, field: string): boolean {
  const path = label.replace(/^App Map\.?/, "");
  if (!path || !field) return false;
  const tokens = [...path.matchAll(PATH_TOKEN)].map((match) =>
    match[1] === undefined ? Number(match[2]) : match[1],
  );
  let current: unknown = root;
  for (const token of tokens) {
    if (current == null || typeof current !== "object") return false;
    current = Array.isArray(current)
      ? current[typeof token === "number" ? token : Number(token)]
      : (current as Record<string, unknown>)[String(token)];
  }
  if (!isRecord(current) || !(field in current)) return false;
  delete current[field];
  return true;
}

export type AppMapLoadResult =
  | { ok: true; appMap: AppMap; repaired: boolean }
  | { ok: false; error: string; raw: unknown };

/**
 * Load a persisted App Map without taking down the collection.
 * Unknown fields left behind by schema tightening are stripped and retried.
 * Structural failures stay quarantined as raw JSON so the next persist cannot
 * silently delete a person's map.
 */
export function loadStoredAppMap(candidate: unknown, key: string): AppMapLoadResult {
  let value = candidate;
  let repaired = false;
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
    try {
      const appMap = validateAppMap(value);
      if (appMap.schemaVersion !== APP_MAP_SCHEMA_VERSION) {
        return {
          ok: false,
          error: `appMaps.${key} has an unsupported schema`,
          raw: candidate,
        };
      }
      if (key !== `${appMap.projectId}:${appMap.id}`) {
        return {
          ok: false,
          error: `appMaps.${key} does not match its project and id`,
          raw: candidate,
        };
      }
      return { ok: true, appMap, repaired };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = message.match(UNKNOWN_FIELD);
      if (!match) return { ok: false, error: message, raw: candidate };
      const clone = structuredClone(value);
      if (!deleteUnknownFieldAtLabel(clone, match[1]!, match[2]!)) {
        return { ok: false, error: message, raw: candidate };
      }
      value = clone;
      repaired = true;
    }
  }
  return { ok: false, error: `appMaps.${key} could not be repaired`, raw: candidate };
}
