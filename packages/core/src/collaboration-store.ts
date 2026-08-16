import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
import { findWorkspaceRoot } from "./workspace-root.js";
import { withCollaborationLock } from "./collaboration-lock.js";
import { loadStoredAppMap } from "./app-map/stored-map-repair.js";

export type DegradedAppMap = {
  key: string;
  id?: string;
  error: string;
};

export type CollaborationState = {
  projects: Project[];
  builds: Build[];
  pools: DevicePool[];
  matrices: CompatibilityMatrix[];
  leases: DeviceLease[];
  variables: Record<string, Revisioned<TestData[]>>;
  appMaps: Record<string, AppMap>;
  degradedAppMaps: Record<string, { error: string; raw: unknown }>;
  idempotency: Record<string, number | string>;
};

type LoadedCollaborationState = {
  state: CollaborationState;
  source?: string;
  recoveredFromBackup?: boolean;
  repaired?: boolean;
};

let queue = Promise.resolve();

export function collaborationStateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function statePath(): string {
  return join(collaborationStateRoot(), "collaboration.json");
}

function backupPath(): string {
  return `${statePath()}.bak`;
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

function parseState(source: string): { state: CollaborationState; repaired: boolean } {
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
  const degradedAppMaps: Record<string, { error: string; raw: unknown }> = {};
  let repaired = false;
  for (const [key, candidate] of Object.entries(rawAppMaps)) {
    const loaded = loadStoredAppMap(candidate, key);
    if (loaded.ok) {
      appMaps[key] = loaded.appMap;
      repaired ||= loaded.repaired;
      continue;
    }
    degradedAppMaps[key] = { error: loaded.error, raw: loaded.raw };
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
      degradedAppMaps,
      idempotency,
    },
  };
}

function serializeState(state: CollaborationState): string {
  const appMaps: Record<string, unknown> = { ...state.appMaps };
  for (const [key, item] of Object.entries(state.degradedAppMaps)) {
    if (!(key in appMaps)) appMaps[key] = item.raw;
  }
  return JSON.stringify(
    {
      projects: state.projects,
      builds: state.builds,
      pools: state.pools,
      matrices: state.matrices,
      leases: state.leases,
      variables: state.variables,
      appMaps,
      idempotency: state.idempotency,
    },
    null,
    2,
  );
}

async function sweepStaleTempFiles(root: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const stale = entries.filter((name) => /^collaboration\.json(?:\.bak)?\.\d+\.tmp$/.test(name));
  await Promise.all(stale.map((name) => unlink(join(root, name)).catch(() => undefined)));
}

async function quarantineCorruptFile(path: string, source: string): Promise<void> {
  const dest = `${path}.corrupt.${now()}`;
  await writeFile(dest, source, "utf8");
}

async function readSource(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function parseOrThrow(source: string): Promise<LoadedCollaborationState> {
  const parsed = parseState(source);
  return { state: parsed.state, source, repaired: parsed.repaired };
}

async function loadStateUnlocked(): Promise<LoadedCollaborationState> {
  const path = statePath();
  const source = await readSource(path);
  if (source === undefined) return { state: emptyCollaborationState() };
  try {
    return await parseOrThrow(source);
  } catch (error) {
    const jsonFailed = error instanceof Error && error.message.includes("JSON could not be parsed");
    if (!jsonFailed) throw error;
    const backup = await readSource(backupPath());
    if (backup === undefined) throw error;
    const recovered = await parseOrThrow(backup);
    await quarantineCorruptFile(path, source);
    return { ...recovered, recoveredFromBackup: true, source: backup };
  }
}

async function persist(state: CollaborationState, previousSource?: string): Promise<void> {
  const root = collaborationStateRoot();
  await mkdir(root, { recursive: true });
  const path = statePath();
  if (previousSource !== undefined) {
    const backup = backupPath();
    const backupTemp = `${backup}.${process.pid}.tmp`;
    await writeFile(backupTemp, previousSource, "utf8");
    await rename(backupTemp, backup);
  }
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, serializeState(state), "utf8");
  await rename(temp, path);
}

export async function readCollaborationState(): Promise<CollaborationState> {
  return (await loadStateUnlocked()).state;
}

export async function mutateCollaborationState<T>(
  fn: (state: CollaborationState) => Promise<T> | T,
): Promise<T> {
  const pending = queue.then(() =>
    withCollaborationLock(collaborationStateRoot(), async () => {
      await sweepStaleTempFiles(collaborationStateRoot());
      const loaded = await loadStateUnlocked();
      const result = await fn(loaded.state);
      await persist(loaded.state, loaded.source);
      return result;
    }),
  );
  queue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

/** Repair unknown fields and restore a last-known-good backup before serving. */
export async function recoverCollaborationState(): Promise<{
  recoveredFromBackup: boolean;
  repaired: boolean;
  degraded: DegradedAppMap[];
}> {
  const pending = queue.then(() =>
    withCollaborationLock(collaborationStateRoot(), async () => {
      await sweepStaleTempFiles(collaborationStateRoot());
      const loaded = await loadStateUnlocked();
      await persist(loaded.state, loaded.source);
      return {
        recoveredFromBackup: Boolean(loaded.recoveredFromBackup),
        repaired: Boolean(loaded.repaired),
        degraded: degradedAppMapsFrom(loaded.state),
      };
    }),
  );
  queue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function degradedAppMapsFrom(state: CollaborationState): DegradedAppMap[] {
  return Object.entries(state.degradedAppMaps).map(([key, item]) => ({
    key,
    error: item.error,
    id: isRecord(item.raw) && typeof item.raw.id === "string" ? item.raw.id : undefined,
  }));
}
