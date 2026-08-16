import { existsSync } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
import { withCollaborationLock } from "./collaboration-lock.js";
import {
  collaborationJsonPath,
  emptyCollaborationState,
  loadCollaborationJson,
  type CollaborationState,
} from "./collaboration-json.js";

export const CONTROL_DB_NAME = "control.sqlite";
export const JSON_MIGRATED_META = "json_migrated";
export const RECOVERED_FROM_BACKUP_META = "recovered_from_json_backup";
export const REPAIRED_ON_MIGRATE_META = "repaired_on_migrate";

const readyRoots = new Set<string>();

export function controlDatabasePath(root: string): string {
  return join(root, CONTROL_DB_NAME);
}

export function openControlDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  applyControlSchema(db);
  return db;
}

export function applyControlSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE IF NOT EXISTS matrices (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, id)
    );
    CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      device_serial TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      document TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS leases_device_status_expires
      ON leases(device_serial, status, expires_at);
    CREATE INDEX IF NOT EXISTS leases_project ON leases(project_id);
    CREATE TABLE IF NOT EXISTS variables (
      project_id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_maps (
      map_key TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_map_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'degraded')),
      error TEXT,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS app_maps_project_updated
      ON app_maps(project_id, updated_at DESC);
    PRAGMA user_version = 1;
  `);
}

export function metaGet(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as
    | { value?: string }
    | undefined;
  return row?.value;
}

export function metaSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)").run(key, value);
}

export function metaDelete(db: DatabaseSync, key: string): void {
  db.prepare("DELETE FROM metadata WHERE key = ?").run(key);
}

function documentOf(row: { document?: string } | undefined): string | undefined {
  return row?.document;
}

export function parseRowDocument<T>(row: { document?: string } | undefined): T | undefined {
  const document = documentOf(row);
  return document === undefined ? undefined : (JSON.parse(document) as T);
}

export function seedDefaultProject(db: DatabaseSync): void {
  const count = db.prepare("SELECT COUNT(*) AS total FROM projects").get() as { total: number };
  if (Number(count.total) > 0) return;
  const project = emptyCollaborationState().projects[0]!;
  upsertProjectRow(db, project);
}

export function upsertProjectRow(db: DatabaseSync, project: Project): void {
  db.prepare(
    `INSERT INTO projects(id, organization_id, document, updated_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       organization_id = excluded.organization_id,
       document = excluded.document,
       updated_at = excluded.updated_at`,
  ).run(project.id, project.organizationId, JSON.stringify(project), project.updatedAt);
}

export function upsertBuildRow(db: DatabaseSync, build: Build): void {
  db.prepare(
    `INSERT INTO builds(id, project_id, document, updated_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       document = excluded.document,
       updated_at = excluded.updated_at`,
  ).run(build.id, build.projectId, JSON.stringify(build), build.updatedAt);
}

export function upsertPoolRow(db: DatabaseSync, pool: DevicePool): void {
  db.prepare(
    `INSERT INTO pools(id, project_id, document, updated_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       document = excluded.document,
       updated_at = excluded.updated_at`,
  ).run(pool.id, pool.projectId, JSON.stringify(pool), pool.updatedAt);
}

export function upsertMatrixRow(db: DatabaseSync, matrix: CompatibilityMatrix): void {
  db.prepare(
    `INSERT INTO matrices(id, project_id, document, updated_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       document = excluded.document,
       updated_at = excluded.updated_at`,
  ).run(matrix.id, matrix.projectId, JSON.stringify(matrix), matrix.updatedAt);
}

export function upsertLeaseRow(db: DatabaseSync, lease: DeviceLease): void {
  db.prepare(
    `INSERT INTO leases(id, project_id, device_serial, owner_id, status, expires_at, document)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       device_serial = excluded.device_serial,
       owner_id = excluded.owner_id,
       status = excluded.status,
       expires_at = excluded.expires_at,
       document = excluded.document`,
  ).run(
    lease.id,
    lease.projectId,
    lease.deviceSerial,
    lease.ownerId,
    lease.status,
    lease.expiresAt,
    JSON.stringify(lease),
  );
}

export function upsertVariablesRow(
  db: DatabaseSync,
  projectId: string,
  value: Revisioned<TestData[]>,
): void {
  db.prepare(
    `INSERT INTO variables(project_id, document, updated_at) VALUES(?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       document = excluded.document,
       updated_at = excluded.updated_at`,
  ).run(projectId, JSON.stringify(value), value.updatedAt);
}

export function upsertIdempotencyRow(db: DatabaseSync, key: string, value: number | string): void {
  db.prepare(
    `INSERT INTO idempotency(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

export function splitAppMapKey(key: string): { projectId: string; appMapId: string } {
  const index = key.indexOf(":");
  if (index <= 0) return { projectId: "", appMapId: key };
  return { projectId: key.slice(0, index), appMapId: key.slice(index + 1) };
}

export function upsertAppMapRow(
  db: DatabaseSync,
  key: string,
  document: string,
  status: "ok" | "degraded",
  error: string | undefined,
  updatedAt: number,
): void {
  const { projectId, appMapId } = splitAppMapKey(key);
  db.prepare(
    `INSERT INTO app_maps(map_key, project_id, app_map_id, status, error, document, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(map_key) DO UPDATE SET
       project_id = excluded.project_id,
       app_map_id = excluded.app_map_id,
       status = excluded.status,
       error = excluded.error,
       document = excluded.document,
       updated_at = excluded.updated_at`,
  ).run(key, projectId, appMapId, status, error ?? null, document, updatedAt);
}

export function upsertHealthyAppMap(db: DatabaseSync, key: string, appMap: AppMap): void {
  upsertAppMapRow(db, key, JSON.stringify(appMap), "ok", undefined, appMap.updatedAt);
}

function importState(db: DatabaseSync, state: CollaborationState): void {
  for (const project of state.projects) upsertProjectRow(db, project);
  for (const build of state.builds) upsertBuildRow(db, build);
  for (const pool of state.pools) upsertPoolRow(db, pool);
  for (const matrix of state.matrices) upsertMatrixRow(db, matrix);
  for (const lease of state.leases) upsertLeaseRow(db, lease);
  for (const [projectId, value] of Object.entries(state.variables)) {
    upsertVariablesRow(db, projectId, value);
  }
  for (const [key, value] of Object.entries(state.idempotency)) {
    upsertIdempotencyRow(db, key, value);
  }
  for (const [key, appMap] of Object.entries(state.appMaps)) {
    upsertHealthyAppMap(db, key, appMap);
  }
  for (const [key, item] of Object.entries(state.degradedAppMaps)) {
    upsertAppMapRow(db, key, JSON.stringify(item.raw), "degraded", item.error, now());
  }
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

async function retireJsonFile(root: string): Promise<void> {
  const path = collaborationJsonPath(root);
  try {
    if (!(await stat(path)).isFile()) return;
  } catch {
    return;
  }
  const migrated = `${path}.migrated`;
  try {
    await rename(path, migrated);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      await unlink(path).catch(() => undefined);
      return;
    }
    throw error;
  }
}

export type ControlMigration = {
  recoveredFromBackup: boolean;
  repaired: boolean;
};

function alreadyMigrated(path: string): boolean {
  if (!existsSync(path)) return false;
  const db = openControlDatabase(path);
  try {
    return metaGet(db, JSON_MIGRATED_META) === "1";
  } finally {
    db.close();
  }
}

/**
 * OpenCode-style startup: apply schema, import legacy JSON once, then SQLite is
 * the control-plane source of truth. The file lock is only held for migration.
 */
export async function ensureControlDatabase(root: string): Promise<ControlMigration> {
  if (readyRoots.has(root)) return { recoveredFromBackup: false, repaired: false };
  await mkdir(root, { recursive: true });
  const dbPath = controlDatabasePath(root);
  if (alreadyMigrated(dbPath)) {
    await retireJsonFile(root);
    readyRoots.add(root);
    return { recoveredFromBackup: false, repaired: false };
  }

  return withCollaborationLock(root, async () => {
    await sweepStaleTempFiles(root);
    if (alreadyMigrated(dbPath)) {
      await retireJsonFile(root);
      readyRoots.add(root);
      return { recoveredFromBackup: false, repaired: false };
    }

    const loaded = await loadCollaborationJson(root);
    const db = openControlDatabase(dbPath);
    try {
      if (metaGet(db, JSON_MIGRATED_META) === "1") {
        readyRoots.add(root);
        return { recoveredFromBackup: false, repaired: false };
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (loaded) importState(db, loaded.state);
        else seedDefaultProject(db);
        metaSet(db, JSON_MIGRATED_META, "1");
        if (loaded?.recoveredFromBackup) metaSet(db, RECOVERED_FROM_BACKUP_META, "1");
        if (loaded?.repaired) metaSet(db, REPAIRED_ON_MIGRATE_META, "1");
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw error;
      }
    } finally {
      db.close();
    }
    if (loaded?.recoveredFromBackup) {
      await unlink(collaborationJsonPath(root)).catch(() => undefined);
    } else {
      await retireJsonFile(root);
    }
    readyRoots.add(root);
    return {
      recoveredFromBackup: Boolean(loaded?.recoveredFromBackup),
      repaired: Boolean(loaded?.repaired),
    };
  });
}

/** Test helper: forget that a state root already opened. */
export function resetControlDatabaseCache(): void {
  readyRoots.clear();
}
