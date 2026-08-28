import type { DatabaseSync } from "node:sqlite";
import type {
  AppMap,
  Build,
  CompatibilityMatrix,
  DeviceLease,
  DevicePool,
  DurableWorkflowAuditEvent,
  DurableWorkflowRecord,
  Project,
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
  Revisioned,
  TestData,
} from "@relay/protocol";
import { loadStoredAppMap, type StoredAppMapDisposition } from "./app-map/stored-map-repair.js";
import { notifyControlWrite, runControlWrite, type DeviceEvent } from "./events.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { join } from "node:path";
import {
  controlDatabasePath,
  ensureReviewedDocumentOriginMapEpoch,
  ensureControlDatabase,
  listControlEventRows,
  metaDelete,
  metaGet,
  insertReviewedDocumentOriginProjection,
  parseRowDocument,
  RECOVERED_FROM_BACKUP_META,
  REPAIRED_ON_MIGRATE_META,
  seedDefaultProject,
  appendReviewedDocumentOriginLedgerEvent,
  insertReviewedDocumentOriginRevocationTombstone,
  reviewedDocumentOriginLedgerEvents,
  reviewedDocumentOriginMapEpoch,
  reviewedDocumentOriginProjection,
  reviewedDocumentOriginProjections,
  reviewedDocumentOriginRevocationTombstone,
  rotateReviewedDocumentOriginMapEpoch,
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
  withControlDatabaseRead,
  type ControlEventRow,
} from "./collaboration-db.js";

export type DegradedAppMap = {
  key: string;
  id?: string;
  error: string;
  disposition: Extract<StoredAppMapDisposition, "read-only" | "quarantined">;
};

/** Opaque source bytes retained before a map was normalized or quarantined. */
export type AppMapRecoveryDocument = {
  document: string;
  disposition: StoredAppMapDisposition;
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

function degradedFromRaw(
  key: string,
  error: string,
  raw: unknown,
  disposition: Extract<StoredAppMapDisposition, "read-only" | "quarantined"> = "quarantined",
): DegradedAppMap {
  return {
    key,
    error,
    disposition,
    id: isRecord(raw) && typeof raw.id === "string" ? raw.id : undefined,
  };
}

function persistedDisposition(
  value: string | null | undefined,
): Extract<StoredAppMapDisposition, "read-only" | "quarantined"> {
  return value === "read-only" ? "read-only" : "quarantined";
}

function storedDisposition(value: string | null | undefined): StoredAppMapDisposition {
  switch (value) {
    case "migrated":
    case "read-only":
    case "quarantined":
      return value;
    default:
      return "ready";
  }
}

function parseAppMapDocument(source: string): unknown | undefined {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
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
  workflowRecord(workflowId: string): DurableWorkflowRecord | undefined;
  workflowRecordEvents(workflowId: string): DurableWorkflowAuditEvent[];
  insertWorkflowRecord(record: DurableWorkflowRecord, event: DurableWorkflowAuditEvent): boolean;
  compareAndSetWorkflowRecord(
    expectedVersion: number,
    record: DurableWorkflowRecord,
    event: DurableWorkflowAuditEvent,
  ): "updated" | "stale" | "missing";
  appMap(key: string): AppMap | undefined;
  appMapRecoveryDocument(key: string): AppMapRecoveryDocument | undefined;
  hasAppMap(key: string): boolean;
  upsertAppMap(key: string, appMap: AppMap): void;
  deleteAppMap(key: string): boolean;
  listAppMaps(projectId: string): { appMaps: AppMap[]; degraded: DegradedAppMap[] };
  persistAppMapRepairs(): boolean;
  seedDefaultProject(): void;
  degradedMaps(): DegradedAppMap[];
  takeMigrationFlags(): { recoveredFromBackup: boolean; repaired: boolean };
  reviewedDocumentOriginMapEpoch(mapKey: string): string | undefined;
  ensureReviewedDocumentOriginMapEpoch(mapKey: string, mapEpoch: string, at: number): string;
  rotateReviewedDocumentOriginMapEpoch(mapKey: string, mapEpoch: string, at: number): void;
  reviewedDocumentOriginProjections(mapKey: string): ReviewedDocumentOriginProjection[];
  reviewedDocumentOriginProjection(
    projectionId: string,
  ): ReviewedDocumentOriginProjection | undefined;
  insertReviewedDocumentOriginProjection(
    mapKey: string,
    projection: ReviewedDocumentOriginProjection,
  ): void;
  reviewedDocumentOriginLedgerEvents(projectionId: string): ReviewedDocumentOriginLedger[];
  reviewedDocumentOriginRevocationTombstone(
    projectionId: string,
  ): ReviewedDocumentOriginLedger | undefined;
  appendReviewedDocumentOriginLedgerEvent(
    mapKey: string,
    mapEpoch: string,
    ledger: ReviewedDocumentOriginLedger,
  ): void;
  insertReviewedDocumentOriginRevocationTombstone(
    mapKey: string,
    mapEpoch: string,
    ledger: ReviewedDocumentOriginLedger,
  ): void;
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
    workflowRecord(workflowId) {
      return parseRowDocument<DurableWorkflowRecord>(
        db
          .prepare("SELECT document FROM workflow_records WHERE workflow_id = ?")
          .get(workflowId) as { document?: string } | undefined,
      );
    },
    workflowRecordEvents(workflowId) {
      return documents<DurableWorkflowAuditEvent>(
        db
          .prepare(
            "SELECT document FROM workflow_record_events WHERE workflow_id = ? ORDER BY sequence",
          )
          .all(workflowId) as Array<{ document?: string }>,
      );
    },
    insertWorkflowRecord(record, event) {
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO workflow_records
           (workflow_id, organization_id, project_id, kind, version, status, expires_at, document, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.workflowId,
          record.organizationId,
          record.projectId,
          record.kind,
          record.version,
          record.status,
          record.expiresAt,
          JSON.stringify(record),
          record.updatedAt,
        ).changes;
      if (!inserted) return false;
      db.prepare(
        `INSERT INTO workflow_record_events
         (workflow_id, sequence, version, document, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(event.workflowId, event.sequence, event.version, JSON.stringify(event), event.at);
      return true;
    },
    compareAndSetWorkflowRecord(expectedVersion, record, event) {
      const existing = db
        .prepare("SELECT version FROM workflow_records WHERE workflow_id = ?")
        .get(record.workflowId) as { version?: number } | undefined;
      if (!existing) return "missing";
      const updated = db
        .prepare(
          `UPDATE workflow_records
           SET version = ?, status = ?, expires_at = ?, document = ?, updated_at = ?
           WHERE workflow_id = ? AND version = ? AND organization_id = ? AND project_id = ?`,
        )
        .run(
          record.version,
          record.status,
          record.expiresAt,
          JSON.stringify(record),
          record.updatedAt,
          record.workflowId,
          expectedVersion,
          record.organizationId,
          record.projectId,
        ).changes;
      if (!updated) return "stale";
      db.prepare(
        `INSERT INTO workflow_record_events
         (workflow_id, sequence, version, document, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(event.workflowId, event.sequence, event.version, JSON.stringify(event), event.at);
      return "updated";
    },
    appMap(key) {
      const row = db.prepare("SELECT document, status FROM app_maps WHERE map_key = ?").get(key) as
        | { document?: string; status?: string }
        | undefined;
      if (!row?.document || row.status !== "ok") return undefined;
      const document = parseAppMapDocument(row.document);
      if (document === undefined) return undefined;
      const loaded = loadStoredAppMap(document, key);
      return loaded.ok ? loaded.appMap : undefined;
    },
    appMapRecoveryDocument(key) {
      const row = db
        .prepare("SELECT document, source_document, disposition FROM app_maps WHERE map_key = ?")
        .get(key) as
        | {
            document?: string;
            source_document?: string | null;
            disposition?: string | null;
          }
        | undefined;
      if (!row?.document) return undefined;
      return {
        document: row.source_document ?? row.document,
        disposition: storedDisposition(row.disposition),
      };
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
          `SELECT map_key, status, error, document, disposition FROM app_maps
           WHERE project_id = ? ORDER BY updated_at DESC`,
        )
        .all(projectId) as Array<{
        map_key: string;
        status: string;
        error?: string | null;
        document: string;
        disposition?: string | null;
      }>;
      const appMaps: AppMap[] = [];
      const degraded: DegradedAppMap[] = [];
      for (const row of rows) {
        if (row.status === "degraded") {
          let raw: unknown = row.document;
          raw = parseAppMapDocument(row.document) ?? raw;
          degraded.push(
            degradedFromRaw(
              row.map_key,
              row.error ?? "unreadable App Map",
              raw,
              persistedDisposition(row.disposition),
            ),
          );
          continue;
        }
        const document = parseAppMapDocument(row.document);
        if (document === undefined) {
          degraded.push(
            degradedFromRaw(row.map_key, "app map document JSON could not be parsed", row.document),
          );
          continue;
        }
        const loaded = loadStoredAppMap(document, row.map_key);
        if (loaded.ok) {
          appMaps.push(loaded.appMap);
          continue;
        }
        degraded.push(degradedFromRaw(row.map_key, loaded.error, loaded.raw, loaded.disposition));
      }
      return { appMaps, degraded };
    },
    persistAppMapRepairs() {
      const rows = db
        .prepare("SELECT map_key, status, document, source_document, disposition FROM app_maps")
        .all() as Array<{
        map_key: string;
        status: string;
        document: string;
        source_document?: string | null;
        disposition?: string | null;
      }>;
      let repaired = false;
      for (const row of rows) {
        const raw = parseAppMapDocument(row.document);
        if (raw === undefined) {
          if (
            row.status !== "degraded" ||
            persistedDisposition(row.disposition) !== "quarantined"
          ) {
            upsertAppMapRow(
              db,
              row.map_key,
              row.document,
              "degraded",
              "app map document JSON could not be parsed",
              Date.now(),
              {
                sourceDocument: row.source_document ?? row.document,
                disposition: "quarantined",
              },
            );
            repaired = true;
          }
          continue;
        }
        const loaded = loadStoredAppMap(raw, row.map_key);
        if (loaded.ok) {
          if (loaded.repaired || loaded.migrated || row.status !== "ok") {
            upsertHealthyAppMap(db, row.map_key, loaded.appMap, {
              sourceDocument: row.source_document ?? JSON.stringify(loaded.original),
              disposition: loaded.disposition,
            });
            repaired = true;
          }
          continue;
        }
        if (
          row.status !== "degraded" ||
          persistedDisposition(row.disposition) !== loaded.disposition
        ) {
          upsertAppMapRow(db, row.map_key, row.document, "degraded", loaded.error, Date.now(), {
            sourceDocument: row.source_document ?? row.document,
            disposition: loaded.disposition,
          });
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
        .prepare(
          "SELECT map_key, error, document, disposition FROM app_maps WHERE status = 'degraded'",
        )
        .all() as Array<{
        map_key: string;
        error?: string | null;
        document: string;
        disposition?: string | null;
      }>;
      return rows.map((row) => {
        let raw: unknown = row.document;
        raw = parseAppMapDocument(row.document) ?? raw;
        return degradedFromRaw(
          row.map_key,
          row.error ?? "unreadable App Map",
          raw,
          persistedDisposition(row.disposition),
        );
      });
    },
    takeMigrationFlags() {
      const recoveredFromBackup = metaGet(db, RECOVERED_FROM_BACKUP_META) === "1";
      const repaired = metaGet(db, REPAIRED_ON_MIGRATE_META) === "1";
      if (recoveredFromBackup) metaDelete(db, RECOVERED_FROM_BACKUP_META);
      if (repaired) metaDelete(db, REPAIRED_ON_MIGRATE_META);
      return { recoveredFromBackup, repaired };
    },
    reviewedDocumentOriginMapEpoch(mapKey) {
      return reviewedDocumentOriginMapEpoch(db, mapKey);
    },
    ensureReviewedDocumentOriginMapEpoch(mapKey, mapEpoch, at) {
      return ensureReviewedDocumentOriginMapEpoch(db, mapKey, mapEpoch, at);
    },
    rotateReviewedDocumentOriginMapEpoch(mapKey, mapEpoch, at) {
      rotateReviewedDocumentOriginMapEpoch(db, mapKey, mapEpoch, at);
    },
    reviewedDocumentOriginProjections(mapKey) {
      return reviewedDocumentOriginProjections(db, mapKey);
    },
    reviewedDocumentOriginProjection(projectionId) {
      return reviewedDocumentOriginProjection(db, projectionId);
    },
    insertReviewedDocumentOriginProjection(mapKey, projection) {
      insertReviewedDocumentOriginProjection(db, mapKey, projection);
    },
    reviewedDocumentOriginLedgerEvents(projectionId) {
      return reviewedDocumentOriginLedgerEvents(db, projectionId);
    },
    reviewedDocumentOriginRevocationTombstone(projectionId) {
      return reviewedDocumentOriginRevocationTombstone(db, projectionId);
    },
    appendReviewedDocumentOriginLedgerEvent(mapKey, mapEpoch, ledger) {
      appendReviewedDocumentOriginLedgerEvent(db, mapKey, mapEpoch, ledger);
    },
    insertReviewedDocumentOriginRevocationTombstone(mapKey, mapEpoch, ledger) {
      insertReviewedDocumentOriginRevocationTombstone(db, mapKey, mapEpoch, ledger);
    },
  };
}

async function withReadyDatabase<T>(
  fn: (db: DatabaseSync) => T,
  access: "read" | "write",
): Promise<T> {
  const root = collaborationStateRoot();
  await ensureControlDatabase(root);
  const path = controlDatabasePath(root);
  return access === "write" ? withControlDatabase(path, fn) : withControlDatabaseRead(path, fn);
}

export async function readControlStore<T>(fn: (store: ControlStore) => T): Promise<T> {
  return withReadyDatabase((db) => fn(createStore(db)), "read");
}

export async function withControlStore<T>(fn: (store: ControlStore) => T): Promise<T> {
  let pending: DeviceEvent[] = [];
  const result = await withReadyDatabase((db) => {
    const written = runControlWrite(db, () => fn(createStore(db)));
    pending = written.pending;
    return written.result;
  }, "write");
  notifyControlWrite(pending);
  return result;
}

export async function listDurableControlEvents(
  afterSeq = 0,
  limit = 100,
): Promise<ControlEventRow[]> {
  return withReadyDatabase((db) => listControlEventRows(db, afterSeq, limit), "read");
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
