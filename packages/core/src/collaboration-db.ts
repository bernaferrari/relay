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
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
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
export const CONTROL_SCHEMA_VERSION = 3;
export const JSON_MIGRATED_META = "json_migrated";
export const RECOVERED_FROM_BACKUP_META = "recovered_from_json_backup";
export const REPAIRED_ON_MIGRATE_META = "repaired_on_migrate";

export const CONTROL_EVENTS_RETAIN = 5_000;

const readyRoots = new Set<string>();

type CachedControlDatabase = {
  path: string;
  db: DatabaseSync;
};

let cachedWriter: CachedControlDatabase | undefined;
let writerGate = Promise.resolve();

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
    PRAGMA cache_size = -64000;
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
    CREATE TABLE IF NOT EXISTS app_map_reviewed_origin_scopes (
      map_key TEXT PRIMARY KEY,
      map_epoch TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviewed_document_origin_projections (
      id TEXT PRIMARY KEY,
      map_key TEXT NOT NULL,
      map_epoch TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      capture_id TEXT NOT NULL,
      document TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reviewed_document_origin_projections_map_capture
      ON reviewed_document_origin_projections(map_key, screen_id, variant_id, capture_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS reviewed_document_origin_ledger (
      projection_id TEXT PRIMARY KEY,
      map_key TEXT NOT NULL,
      map_epoch TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reviewed_document_origin_ledger_map_status
      ON reviewed_document_origin_ledger(map_key, map_epoch, status);
  `);
  migrateControlSchema(db);
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

function migrateControlSchema(db: DatabaseSync): void {
  let version = userVersion(db);
  if (version < 1) {
    db.exec("PRAGMA user_version = 1");
    version = 1;
  }
  if (version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS control_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        resource TEXT,
        resource_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS control_events_project_seq
        ON control_events(project_id, seq);
    `);
    db.exec("PRAGMA user_version = 2");
    version = 2;
  }
  if (version < 3) {
    db.exec("PRAGMA user_version = 3");
  }
}

export type ControlEventRow = {
  seq: number;
  id: string;
  at: number;
  projectId: string;
  type: string;
  resource?: string;
  resourceId?: string;
  payload: unknown;
};

export function listControlEventRows(
  db: DatabaseSync,
  afterSeq = 0,
  limit = 100,
): ControlEventRow[] {
  const rows = db
    .prepare(
      `SELECT seq, id, at, project_id, type, resource, resource_id, payload
       FROM control_events WHERE seq > ? ORDER BY seq LIMIT ?`,
    )
    .all(afterSeq, limit) as Array<{
    seq: number;
    id: string;
    at: number;
    project_id: string;
    type: string;
    resource?: string | null;
    resource_id?: string | null;
    payload: string;
  }>;
  return rows.map((row) => ({
    seq: Number(row.seq),
    id: row.id,
    at: Number(row.at),
    projectId: row.project_id,
    type: row.type,
    ...(row.resource ? { resource: row.resource } : {}),
    ...(row.resource_id ? { resourceId: row.resource_id } : {}),
    payload: JSON.parse(row.payload) as unknown,
  }));
}

export function pruneControlEvents(db: DatabaseSync, retain = CONTROL_EVENTS_RETAIN): void {
  if (retain < 1) return;
  db.prepare(
    `DELETE FROM control_events
     WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - ? FROM control_events)`,
  ).run(retain);
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

export function reviewedDocumentOriginMapEpoch(
  db: DatabaseSync,
  mapKey: string,
): string | undefined {
  const row = db
    .prepare("SELECT map_epoch FROM app_map_reviewed_origin_scopes WHERE map_key = ?")
    .get(mapKey) as { map_epoch?: string } | undefined;
  return row?.map_epoch;
}

export function ensureReviewedDocumentOriginMapEpoch(
  db: DatabaseSync,
  mapKey: string,
  mapEpoch: string,
  updatedAt: number,
): string {
  db.prepare(
    `INSERT INTO app_map_reviewed_origin_scopes(map_key, map_epoch, updated_at)
     VALUES(?, ?, ?) ON CONFLICT(map_key) DO NOTHING`,
  ).run(mapKey, mapEpoch, updatedAt);
  const current = reviewedDocumentOriginMapEpoch(db, mapKey);
  if (!current) throw new Error("Reviewed document-origin map scope was not persisted");
  return current;
}

export function rotateReviewedDocumentOriginMapEpoch(
  db: DatabaseSync,
  mapKey: string,
  mapEpoch: string,
  updatedAt: number,
): void {
  db.prepare(
    `INSERT INTO app_map_reviewed_origin_scopes(map_key, map_epoch, updated_at)
     VALUES(?, ?, ?) ON CONFLICT(map_key) DO UPDATE SET
       map_epoch = excluded.map_epoch,
       updated_at = excluded.updated_at`,
  ).run(mapKey, mapEpoch, updatedAt);
}

export function reviewedDocumentOriginProjections(
  db: DatabaseSync,
  mapKey: string,
): ReviewedDocumentOriginProjection[] {
  const rows = db
    .prepare(
      `SELECT document FROM reviewed_document_origin_projections
       WHERE map_key = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(mapKey) as Array<{ document?: string }>;
  return rows
    .map((row) => parseRowDocument<ReviewedDocumentOriginProjection>(row))
    .filter((value): value is ReviewedDocumentOriginProjection => value !== undefined);
}

export function reviewedDocumentOriginProjection(
  db: DatabaseSync,
  projectionId: string,
): ReviewedDocumentOriginProjection | undefined {
  return parseRowDocument<ReviewedDocumentOriginProjection>(
    db
      .prepare("SELECT document FROM reviewed_document_origin_projections WHERE id = ?")
      .get(projectionId) as { document?: string } | undefined,
  );
}

export function insertReviewedDocumentOriginProjection(
  db: DatabaseSync,
  mapKey: string,
  projection: ReviewedDocumentOriginProjection,
): void {
  db.prepare(
    `INSERT INTO reviewed_document_origin_projections(
      id, map_key, map_epoch, screen_id, variant_id, surface_id, capture_id, document, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    projection.id,
    mapKey,
    projection.binding.mapEpoch,
    projection.binding.screenId,
    projection.binding.variantId,
    projection.binding.surfaceId,
    projection.binding.captureId,
    JSON.stringify(projection),
    projection.approval.at,
  );
}

export function reviewedDocumentOriginLedger(
  db: DatabaseSync,
  projectionId: string,
): ReviewedDocumentOriginLedger | undefined {
  return parseRowDocument<ReviewedDocumentOriginLedger>(
    db
      .prepare("SELECT document FROM reviewed_document_origin_ledger WHERE projection_id = ?")
      .get(projectionId) as { document?: string } | undefined,
  );
}

export function upsertReviewedDocumentOriginLedger(
  db: DatabaseSync,
  mapKey: string,
  mapEpoch: string,
  ledger: ReviewedDocumentOriginLedger,
): void {
  db.prepare(
    `INSERT INTO reviewed_document_origin_ledger(
      projection_id, map_key, map_epoch, status, document, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(projection_id) DO UPDATE SET
      map_key = excluded.map_key,
      map_epoch = excluded.map_epoch,
      status = excluded.status,
      document = excluded.document,
      updated_at = excluded.updated_at`,
  ).run(
    ledger.projectionId,
    mapKey,
    mapEpoch,
    ledger.status,
    JSON.stringify(ledger),
    ledger.revocation?.at ?? ledger.activatedAt ?? ledger.createdAt,
  );
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
  if (cachedWriter?.path === path) return metaGet(cachedWriter.db, JSON_MIGRATED_META) === "1";
  if (!existsSync(path)) return false;
  const db = openControlDatabase(path);
  try {
    return metaGet(db, JSON_MIGRATED_META) === "1";
  } finally {
    db.close();
  }
}

function closeCached(entry: CachedControlDatabase | undefined): void {
  if (!entry) return;
  try {
    entry.db.close();
  } catch {
    /* ignore */
  }
}

function closeCachedIfPathChanged(path: string): void {
  if (cachedWriter && cachedWriter.path !== path) {
    closeCached(cachedWriter);
    cachedWriter = undefined;
  }
}

function acquireControlDatabase(path: string): DatabaseSync {
  closeCachedIfPathChanged(path);
  if (!cachedWriter) {
    const db = openControlDatabase(path);
    try {
      db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    } catch {
      /* ignore */
    }
    cachedWriter = { path, db };
  }
  return cachedWriter.db;
}

/** One writer at a time, OpenCode-style. Tests must reset the cache before deleting the file. */
export async function withControlDatabase<T>(
  path: string,
  fn: (db: DatabaseSync) => T,
): Promise<T> {
  let release!: () => void;
  const previous = writerGate;
  writerGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return fn(acquireControlDatabase(path));
  } finally {
    release();
  }
}

/** Skip the writer queue. Safe while writes stay synchronous on this connection. */
export async function withControlDatabaseRead<T>(
  path: string,
  fn: (db: DatabaseSync) => T,
): Promise<T> {
  return fn(acquireControlDatabase(path));
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

/** Close cached connections so tests can delete the state directory. */
export function resetControlDatabaseCache(): void {
  readyRoots.clear();
  closeCached(cachedWriter);
  cachedWriter = undefined;
}
