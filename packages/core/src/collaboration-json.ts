import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppMap,
  Build,
  CompatibilityMatrix,
  DeviceLease,
  DevicePool,
  Project,
  Revisioned,
  TestData,
} from "@relay/protocol";
import { now } from "./events.js";
import { loadStoredAppMap, type StoredAppMapDisposition } from "./app-map/stored-map-repair.js";

export type DegradedAppMapRecord = {
  error: string;
  raw: unknown;
  disposition?: Extract<StoredAppMapDisposition, "read-only" | "quarantined">;
};

/** The original source is retained separately from the canonical App Map. */
export type AppMapSourceRecord = {
  original: unknown;
  disposition: Extract<StoredAppMapDisposition, "ready" | "migrated">;
};

export type CollaborationState = {
  projects: Project[];
  builds: Build[];
  pools: DevicePool[];
  matrices: CompatibilityMatrix[];
  leases: DeviceLease[];
  variables: Record<string, Revisioned<TestData[]>>;
  appMaps: Record<string, AppMap>;
  appMapSources: Record<string, AppMapSourceRecord>;
  degradedAppMaps: Record<string, DegradedAppMapRecord>;
  idempotency: Record<string, number | string>;
};

export type LoadedCollaborationState = {
  state: CollaborationState;
  source?: string;
  recoveredFromBackup?: boolean;
  repaired?: boolean;
};

export function collaborationJsonPath(root: string): string {
  return join(root, "collaboration.json");
}

export function collaborationBackupPath(root: string): string {
  return `${collaborationJsonPath(root)}.bak`;
}

export function emptyCollaborationState(): CollaborationState {
  const at = now();
  return {
    projects: [
      { id: "default", organizationId: "local", name: "Mobile QA", createdAt: at, updatedAt: at },
    ],
    builds: [],
    pools: [],
    matrices: [],
    leases: [],
    variables: {},
    appMaps: {},
    appMapSources: {},
    degradedAppMaps: {},
    idempotency: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidState(message: string): never {
  throw new Error(`Invalid collaboration state: ${message}`);
}

function objectArray<T>(state: Record<string, unknown>, key: string, fallback: T[]): T[] {
  const value = state[key];
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    invalidState(`${key} must be an array of objects`);
  }
  return value as T[];
}

function objectRecord<T>(
  state: Record<string, unknown>,
  key: string,
  fallback: Record<string, T>,
): Record<string, T> {
  const value = state[key];
  if (value === undefined) return fallback;
  if (!isRecord(value)) invalidState(`${key} must be an object`);
  return value as Record<string, T>;
}

export function parseCollaborationJson(source: string): {
  state: CollaborationState;
  repaired: boolean;
} {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error("Invalid collaboration state: JSON could not be parsed", { cause: error });
  }
  if (!isRecord(value)) invalidState("top level must be an object");

  const empty = emptyCollaborationState();
  const variables = objectRecord<Revisioned<TestData[]>>(value, "variables", {});
  for (const [projectId, revision] of Object.entries(variables)) {
    if (
      !isRecord(revision) ||
      typeof revision.revision !== "number" ||
      !Number.isSafeInteger(revision.revision) ||
      typeof revision.updatedAt !== "number" ||
      !Number.isFinite(revision.updatedAt) ||
      !Array.isArray(revision.value)
    ) {
      invalidState(`variables.${projectId} must be revisioned variable data`);
    }
  }

  const rawAppMaps = objectRecord<unknown>(value, "appMaps", {});
  const appMaps: Record<string, AppMap> = {};
  const appMapSources: Record<string, AppMapSourceRecord> = {};
  const degradedAppMaps: Record<string, DegradedAppMapRecord> = {};
  let repaired = false;
  for (const [key, candidate] of Object.entries(rawAppMaps)) {
    const loaded = loadStoredAppMap(candidate, key);
    if (loaded.ok) {
      appMaps[key] = loaded.appMap;
      appMapSources[key] = { original: loaded.original, disposition: loaded.disposition };
      repaired ||= loaded.repaired || loaded.migrated;
      continue;
    }
    degradedAppMaps[key] = {
      error: loaded.error,
      raw: loaded.raw,
      disposition: loaded.disposition,
    };
  }

  // A short-lived JSON migration may already have quarantined a map before
  // SQLite became authoritative. Preserve those entries verbatim rather than
  // letting an otherwise valid top-level state erase their recovery source.
  const rawDegradedMaps = objectRecord<unknown>(value, "degradedAppMaps", {});
  for (const [key, candidate] of Object.entries(rawDegradedMaps)) {
    if (key in appMaps || key in degradedAppMaps) continue;
    if (!isRecord(candidate) || typeof candidate.error !== "string" || !("raw" in candidate)) {
      invalidState(`degradedAppMaps.${key} must include error and raw`);
    }
    const disposition = candidate.disposition === "read-only" ? "read-only" : "quarantined";
    degradedAppMaps[key] = { error: candidate.error, raw: candidate.raw, disposition };
  }

  const idempotency = objectRecord<number | string>(value, "idempotency", {});
  if (
    Object.values(idempotency).some((item) => typeof item !== "number" && typeof item !== "string")
  ) {
    invalidState("idempotency values must be strings or numbers");
  }

  return {
    repaired,
    state: {
      projects: objectArray<Project>(value, "projects", empty.projects),
      builds: objectArray<Build>(value, "builds", []),
      pools: objectArray<DevicePool>(value, "pools", []),
      matrices: objectArray<CompatibilityMatrix>(value, "matrices", []),
      leases: objectArray<DeviceLease>(value, "leases", []),
      variables,
      appMaps,
      appMapSources,
      degradedAppMaps,
      idempotency,
    },
  };
}

async function readSource(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function quarantineCorruptFile(path: string, source: string): Promise<void> {
  await writeFile(`${path}.corrupt.${now()}`, source, "utf8");
}

/** Load legacy collaboration.json, falling back to .bak when JSON is unreadable. */
export async function loadCollaborationJson(
  root: string,
): Promise<LoadedCollaborationState | undefined> {
  const path = collaborationJsonPath(root);
  const source = await readSource(path);
  if (source === undefined) {
    const backup = await readSource(collaborationBackupPath(root));
    if (backup === undefined) return undefined;
    const parsed = parseCollaborationJson(backup);
    return {
      state: parsed.state,
      source: backup,
      recoveredFromBackup: true,
      repaired: parsed.repaired,
    };
  }
  try {
    const parsed = parseCollaborationJson(source);
    return { state: parsed.state, source, repaired: parsed.repaired };
  } catch (error) {
    const jsonFailed = error instanceof Error && error.message.includes("JSON could not be parsed");
    if (!jsonFailed) throw error;
    const backup = await readSource(collaborationBackupPath(root));
    if (backup === undefined) throw error;
    const recovered = parseCollaborationJson(backup);
    await quarantineCorruptFile(path, source);
    return {
      state: recovered.state,
      recoveredFromBackup: true,
      source: backup,
      repaired: recovered.repaired,
    };
  }
}
