import type { DatabaseSync } from "node:sqlite";
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
import { loadStoredAppMap } from "./app-map/stored-map-repair.js";
import { notifyControlWrite, runControlWrite, type DeviceEvent } from "./events.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { join } from "node:path";
import {
  controlDatabasePath,
  ensureControlDatabase,
  listControlEventRows,
  metaDelete,
  metaGet,
  parseRowDocument,
  RECOVERED_FROM_BACKUP_META,
  REPAIRED_ON_MIGRATE_META,
  seedDefaultProject,
  upsertAppMapRow,
  upsertBuildRow,
  upsertHealthyAppMap,
  upsertIdempotencyRow,
  upsertLeaseRow,
  upsertMatrixRow,
  upsertPoolRow,
  upsertProjectRow,
  upsertVariablesRow,
  withControlDatabase,
  type ControlEventRow,
} from "./collaboration-db.js";

export type DegradedAppMap = {
  key: string;
  id?: string;
  error: string;
};

export function collaborationStateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function documents<T>(rows: Array<{ document?: string }>): T[] {
  return rows
    .map((row) => parseRowDocument<T>(row))
    .filter((item): item is T => item !== undefined);
}

function degradedFromRaw(key: string, error: string, raw: unknown): DegradedAppMap {
  return {
    key,
    error,
    id: isRecord(raw) && typeof raw.id === "string" ? raw.id : undefined,
  };
}

export type ControlStore = {
  projects(): Project[];
  upsertProject(project: Project): void;
  builds(projectId?: string): Build[];
  upsertBuild(build: Build): void;
  pools(projectId?: string): DevicePool[];
  upsertPool(pool: DevicePool): void;
  matrices(projectId?: string): CompatibilityMatrix[];
  upsertMatrix(matrix: CompatibilityMatrix): void;
  deleteMatrix(projectId: string, id: string): boolean;
  leases(projectId?: string): DeviceLease[];
  lease(id: string): DeviceLease | undefined;
  activeLeaseOnDevice(serial: string, at: number): DeviceLease | undefined;
  upsertLease(lease: DeviceLease): void;
  variables(projectId: string): Revisioned<TestData[]> | undefined;
  upsertVariables(projectId: string, value: Revisioned<TestData[]>): void;
  idempotency(key: string): number | string | undefined;
  upsertIdempotency(key: string, value: number | string): void;
  appMap(key: string): AppMap | undefined;
  hasAppMap(key: string): boolean;
  upsertAppMap(key: string, appMap: AppMap): void;
  deleteAppMap(key: string): boolean;
  listAppMaps(projectId: string): { appMaps: AppMap[]; degraded: DegradedAppMap[] };
  persistAppMapRepairs(): boolean;
  seedDefaultProject(): void;
  degradedMaps(): DegradedAppMap[];
  takeMigrationFlags(): { recoveredFromBackup: boolean; repaired: boolean };
};

function createStore(db: DatabaseSync): ControlStore {
  return {
    projects() {
      return documents<Project>(
        db.prepare("SELECT document FROM projects").all() as Array<{ document?: string }>,
      );
    },
    upsertProject(project) {
      upsertProjectRow(db, project);
    },
    builds(projectId) {
      const rows = (
        projectId
          ? db.prepare("SELECT document FROM builds WHERE project_id = ?").all(projectId)
          : db.prepare("SELECT document FROM builds").all()
      ) as Array<{ document?: string }>;
      return documents<Build>(rows);
    },
    upsertBuild(build) {
      upsertBuildRow(db, build);
    },
    pools(projectId) {
      const rows = (
        projectId
          ? db.prepare("SELECT document FROM pools WHERE project_id = ?").all(projectId)
          : db.prepare("SELECT document FROM pools").all()
      ) as Array<{ document?: string }>;
      return documents<DevicePool>(rows);
    },
    upsertPool(pool) {
      upsertPoolRow(db, pool);
    },
    matrices(projectId) {
      const rows = (
        projectId
          ? db.prepare("SELECT document FROM matrices WHERE project_id = ?").all(projectId)
          : db.prepare("SELECT document FROM matrices").all()
      ) as Array<{ document?: string }>;
      return documents<CompatibilityMatrix>(rows);
    },
    upsertMatrix(matrix) {
      upsertMatrixRow(db, matrix);
    },
    deleteMatrix(projectId, id) {
      return (
        db.prepare("DELETE FROM matrices WHERE project_id = ? AND id = ?").run(projectId, id)
          .changes > 0
      );
    },
    leases(projectId) {
      const rows = (
        projectId
          ? db
              .prepare("SELECT document FROM leases WHERE project_id = ? ORDER BY rowid")
              .all(projectId)
          : db.prepare("SELECT document FROM leases ORDER BY rowid").all()
      ) as Array<{ document?: string }>;
      return documents<DeviceLease>(rows);
    },
    lease(id) {
      return parseRowDocument<DeviceLease>(
        db.prepare("SELECT document FROM leases WHERE id = ?").get(id) as
          | { document?: string }
          | undefined,
      );
    },
    activeLeaseOnDevice(serial, at) {
      return parseRowDocument<DeviceLease>(
        db
          .prepare(
            `SELECT document FROM leases
             WHERE device_serial = ? AND status = 'leased' AND expires_at > ?
             LIMIT 1`,
          )
          .get(serial, at) as { document?: string } | undefined,
      );
    },
    upsertLease(lease) {
      upsertLeaseRow(db, lease);
    },
    variables(projectId) {
      return parseRowDocument<Revisioned<TestData[]>>(
        db.prepare("SELECT document FROM variables WHERE project_id = ?").get(projectId) as
          | { document?: string }
          | undefined,
      );
    },
    upsertVariables(projectId, value) {
      upsertVariablesRow(db, projectId, value);
    },
    idempotency(key) {
      const row = db.prepare("SELECT value FROM idempotency WHERE key = ?").get(key) as
        | { value?: string }
        | undefined;
      if (row?.value === undefined) return undefined;
      return JSON.parse(row.value) as number | string;
    },
    upsertIdempotency(key, value) {
      upsertIdempotencyRow(db, key, value);
    },
    appMap(key) {
      const row = db.prepare("SELECT document, status FROM app_maps WHERE map_key = ?").get(key) as
        | { document?: string; status?: string }
        | undefined;
      if (!row?.document || row.status !== "ok") return undefined;
      const loaded = loadStoredAppMap(JSON.parse(row.document) as unknown, key);
      return loaded.ok ? loaded.appMap : undefined;
    },
    hasAppMap(key) {
      const row = db.prepare("SELECT 1 AS present FROM app_maps WHERE map_key = ?").get(key) as
        | { present?: number }
        | undefined;
      return Boolean(row);
    },
    upsertAppMap(key, appMap) {
      upsertHealthyAppMap(db, key, appMap);
    },
    deleteAppMap(key) {
      return db.prepare("DELETE FROM app_maps WHERE map_key = ?").run(key).changes > 0;
    },
    listAppMaps(projectId) {
      const rows = db
        .prepare(
          `SELECT map_key, status, error, document FROM app_maps
           WHERE project_id = ? ORDER BY updated_at DESC`,
        )
        .all(projectId) as Array<{
        map_key: string;
        status: string;
        error?: string | null;
        document: string;
      }>;
      const appMaps: AppMap[] = [];
      const degraded: DegradedAppMap[] = [];
      for (const row of rows) {
        if (row.status === "degraded") {
          let raw: unknown = row.document;
          try {
            raw = JSON.parse(row.document) as unknown;
          } catch {
            /* keep raw string */
          }
          degraded.push(degradedFromRaw(row.map_key, row.error ?? "unreadable App Map", raw));
          continue;
        }
        const loaded = loadStoredAppMap(JSON.parse(row.document) as unknown, row.map_key);
        if (loaded.ok) {
          appMaps.push(loaded.appMap);
          continue;
        }
        degraded.push(degradedFromRaw(row.map_key, loaded.error, loaded.raw));
      }
      return { appMaps, degraded };
    },
    persistAppMapRepairs() {
      const rows = db.prepare("SELECT map_key, status, document FROM app_maps").all() as Array<{
        map_key: string;
        status: string;
        document: string;
      }>;
      let repaired = false;
      for (const row of rows) {
        let raw: unknown;
        try {
          raw = JSON.parse(row.document) as unknown;
        } catch {
          continue;
        }
        const loaded = loadStoredAppMap(raw, row.map_key);
        if (loaded.ok) {
          if (loaded.repaired || row.status !== "ok") {
            upsertHealthyAppMap(db, row.map_key, loaded.appMap);
            repaired = true;
          }
          continue;
        }
        if (row.status !== "degraded") {
          upsertAppMapRow(db, row.map_key, row.document, "degraded", loaded.error, Date.now());
          repaired = true;
        }
      }
      return repaired;
    },
    seedDefaultProject() {
      seedDefaultProject(db);
    },
    degradedMaps() {
      const rows = db
        .prepare("SELECT map_key, error, document FROM app_maps WHERE status = 'degraded'")
        .all() as Array<{ map_key: string; error?: string | null; document: string }>;
      return rows.map((row) => {
        let raw: unknown = row.document;
        try {
          raw = JSON.parse(row.document) as unknown;
        } catch {
          /* keep raw string */
        }
        return degradedFromRaw(row.map_key, row.error ?? "unreadable App Map", raw);
      });
    },
    takeMigrationFlags() {
      const recoveredFromBackup = metaGet(db, RECOVERED_FROM_BACKUP_META) === "1";
      const repaired = metaGet(db, REPAIRED_ON_MIGRATE_META) === "1";
      if (recoveredFromBackup) metaDelete(db, RECOVERED_FROM_BACKUP_META);
      if (repaired) metaDelete(db, REPAIRED_ON_MIGRATE_META);
      return { recoveredFromBackup, repaired };
    },
  };
}

async function withReadyDatabase<T>(fn: (db: DatabaseSync) => T): Promise<T> {
  const root = collaborationStateRoot();
  await ensureControlDatabase(root);
  return withControlDatabase(controlDatabasePath(root), fn);
}

export async function readControlStore<T>(fn: (store: ControlStore) => T): Promise<T> {
  return withReadyDatabase((db) => fn(createStore(db)));
}

export async function withControlStore<T>(fn: (store: ControlStore) => T): Promise<T> {
  let pending: DeviceEvent[] = [];
  const result = await withReadyDatabase((db) => {
    const written = runControlWrite(db, () => fn(createStore(db)));
    pending = written.pending;
    return written.result;
  });
  notifyControlWrite(pending);
  return result;
}

export async function listDurableControlEvents(
  afterSeq = 0,
  limit = 100,
): Promise<ControlEventRow[]> {
  return withReadyDatabase((db) => listControlEventRows(db, afterSeq, limit));
}

/** Repair unknown fields and restore a last-known-good backup before serving. */
export async function recoverCollaborationState(): Promise<{
  recoveredFromBackup: boolean;
  repaired: boolean;
  degraded: DegradedAppMap[];
}> {
  const root = collaborationStateRoot();
  const migrated = await ensureControlDatabase(root);
  return withControlStore((store) => {
    store.seedDefaultProject();
    const flags = store.takeMigrationFlags();
    const repairedMaps = store.persistAppMapRepairs();
    return {
      recoveredFromBackup: migrated.recoveredFromBackup || flags.recoveredFromBackup,
      repaired: migrated.repaired || flags.repaired || repairedMaps,
      degraded: store.degradedMaps(),
    };
  });
}
