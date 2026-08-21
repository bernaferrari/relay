import { validateAppMap } from "./validation.js";
import { APP_MAP_SCHEMA_VERSION, type AppMap } from "./model.js";

const UNKNOWN_FIELD = /^(.*) contains unknown field (\S+)$/;
const OBSOLETE_INSTRUCTION_CLEANUP = /^(.*)\.cleanup\.kind must be routine$/;
const PATH_TOKEN = /([^.[\]]+)|\[(\d+)\]/g;
const MAX_REPAIRS = 24;
const FIRST_VERSIONED_APP_MAP_SCHEMA_VERSION = 1;

/**
 * A persisted map can be valid for this Relay, converted from a known older
 * shape, deliberately left read-only because it is newer than this Relay, or
 * quarantined because it cannot be proven safe to use.  Keeping this separate
 * from the database row status lets the store retain both broken and future
 * documents without pretending they are interchangeable.
 */
export type StoredAppMapDisposition = "ready" | "migrated" | "read-only" | "quarantined";

type StoredAppMapSchemaVersion = number | "unversioned";

/** A pure, one-way migration from one persisted App Map shape to the next. */
export type StoredAppMapMigrator = Readonly<{
  fromVersion: StoredAppMapSchemaVersion;
  toVersion: number;
  migrate: (candidate: Record<string, unknown>) => unknown;
}>;

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
  | {
      ok: true;
      appMap: AppMap;
      repaired: boolean;
      migrated: boolean;
      disposition: "ready" | "migrated";
      /** The source before any migration or schema repair, retained for recovery/export. */
      original: unknown;
    }
  | {
      ok: false;
      error: string;
      raw: unknown;
      disposition: "read-only" | "quarantined";
    };

/**
 * The only historical App Map migration currently known is the pre-versioned
 * document. It merely stamps schema v1; validation still has to accept every
 * remaining field, so an arbitrary unversioned object can never become a map.
 *
 * Future migrations belong here as small, independently tested, forward-only
 * steps. Do not use this registry to down-convert a newer document.
 */
export const STORED_APP_MAP_MIGRATORS: readonly StoredAppMapMigrator[] = [
  {
    fromVersion: "unversioned",
    toVersion: FIRST_VERSIONED_APP_MAP_SCHEMA_VERSION,
    migrate(candidate) {
      const { schemaVersion: _ignored, ...legacy } = candidate;
      return { ...legacy, schemaVersion: FIRST_VERSIONED_APP_MAP_SCHEMA_VERSION };
    },
  },
];

function schemaVersionOf(
  candidate: unknown,
): { ok: true; version: StoredAppMapSchemaVersion } | { ok: false; error: string } {
  if (!isRecord(candidate)) return { ok: false, error: "must be an object" };
  if (!("schemaVersion" in candidate) || candidate.schemaVersion === undefined) {
    return { ok: true, version: "unversioned" };
  }
  if (
    typeof candidate.schemaVersion !== "number" ||
    !Number.isSafeInteger(candidate.schemaVersion)
  ) {
    return { ok: false, error: "schemaVersion must be a safe integer" };
  }
  return { ok: true, version: candidate.schemaVersion };
}

function migrateStoredAppMap(
  candidate: unknown,
  key: string,
):
  | { ok: true; value: unknown; migrated: boolean }
  | { ok: false; error: string; disposition: "read-only" | "quarantined" } {
  const sourceVersion = schemaVersionOf(candidate);
  if (!sourceVersion.ok) {
    return {
      ok: false,
      error: `appMaps.${key} ${sourceVersion.error}`,
      disposition: "quarantined",
    };
  }
  if (typeof sourceVersion.version === "number" && sourceVersion.version > APP_MAP_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `appMaps.${key} uses newer schemaVersion ${sourceVersion.version}; ` +
        `this Relay supports ${APP_MAP_SCHEMA_VERSION} and will keep the source read-only`,
      disposition: "read-only",
    };
  }

  let version = sourceVersion.version;
  let value: unknown = candidate;
  let migrated = false;
  const visited = new Set<StoredAppMapSchemaVersion>();
  while (version !== APP_MAP_SCHEMA_VERSION) {
    if (visited.has(version)) {
      return {
        ok: false,
        error: `appMaps.${key} migration registry loops at schemaVersion ${String(version)}`,
        disposition: "quarantined",
      };
    }
    visited.add(version);
    const migrator = STORED_APP_MAP_MIGRATORS.find((item) => item.fromVersion === version);
    if (!migrator) {
      return {
        ok: false,
        error: `appMaps.${key} has unsupported historical schemaVersion ${String(version)}`,
        disposition: "quarantined",
      };
    }
    const input = isRecord(value) ? structuredClone(value) : undefined;
    if (!input) {
      return {
        ok: false,
        error: `appMaps.${key} schemaVersion ${String(version)} is not an object`,
        disposition: "quarantined",
      };
    }
    value = migrator.migrate(input);
    if (!isRecord(value) || value.schemaVersion !== migrator.toVersion) {
      return {
        ok: false,
        error:
          `appMaps.${key} migration from ${String(version)} did not produce ` +
          `schemaVersion ${migrator.toVersion}`,
        disposition: "quarantined",
      };
    }
    version = migrator.toVersion;
    migrated = true;
  }
  return { ok: true, value, migrated };
}

/**
 * Load a persisted App Map without taking down the collection.
 * Unknown fields left behind by schema tightening are stripped and retried.
 * Structural failures stay quarantined as raw JSON so the next persist cannot
 * silently delete a person's map.
 */
export function loadStoredAppMap(candidate: unknown, key: string): AppMapLoadResult {
  const migrated = migrateStoredAppMap(candidate, key);
  if (!migrated.ok) {
    return {
      ok: false,
      error: migrated.error,
      raw: candidate,
      disposition: migrated.disposition,
    };
  }

  let value = migrated.value;
  let repaired = false;
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
    try {
      const appMap = validateAppMap(value);
      if (appMap.schemaVersion !== APP_MAP_SCHEMA_VERSION) {
        return {
          ok: false,
          error: `appMaps.${key} has an unsupported schema`,
          raw: candidate,
          disposition: "quarantined",
        };
      }
      if (key !== `${appMap.projectId}:${appMap.id}`) {
        return {
          ok: false,
          error: `appMaps.${key} does not match its project and id`,
          raw: candidate,
          disposition: "quarantined",
        };
      }
      return {
        ok: true,
        appMap,
        repaired,
        migrated: migrated.migrated,
        disposition: migrated.migrated ? "migrated" : "ready",
        original: candidate,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const clone = structuredClone(value);
      const unknownField = message.match(UNKNOWN_FIELD);
      const obsoleteCleanup = message.match(OBSOLETE_INSTRUCTION_CLEANUP);
      const repairedField = unknownField
        ? deleteUnknownFieldAtLabel(clone, unknownField[1]!, unknownField[2]!)
        : obsoleteCleanup
          ? deleteUnknownFieldAtLabel(clone, obsoleteCleanup[1]!, "cleanup")
          : false;
      if (!repairedField) {
        return { ok: false, error: message, raw: candidate, disposition: "quarantined" };
      }
      value = clone;
      repaired = true;
    }
  }
  return {
    ok: false,
    error: `appMaps.${key} could not be repaired`,
    raw: candidate,
    disposition: "quarantined",
  };
}
