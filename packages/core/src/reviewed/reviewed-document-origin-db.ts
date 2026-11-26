import { DatabaseSync } from "node:sqlite";
import type {
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
} from "@relay/protocol";

function parseDocument<T>(row: { document?: string } | undefined): T | undefined {
  return row?.document ? (JSON.parse(row.document) as T) : undefined;
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
    .map((row) => parseDocument<ReviewedDocumentOriginProjection>(row))
    .filter((value): value is ReviewedDocumentOriginProjection => value !== undefined);
}

export function reviewedDocumentOriginProjection(
  db: DatabaseSync,
  projectionId: string,
): ReviewedDocumentOriginProjection | undefined {
  return parseDocument<ReviewedDocumentOriginProjection>(
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

export function reviewedDocumentOriginLedgerEvents(
  db: DatabaseSync,
  projectionId: string,
): ReviewedDocumentOriginLedger[] {
  const rows = db
    .prepare(
      `SELECT document FROM reviewed_document_origin_ledger_events
       WHERE projection_id = ? ORDER BY event_sequence ASC`,
    )
    .all(projectionId) as Array<{ document?: string }>;
  return rows
    .map((row) => parseDocument<ReviewedDocumentOriginLedger>(row))
    .filter((value): value is ReviewedDocumentOriginLedger => value !== undefined);
}

export function appendReviewedDocumentOriginLedgerEvent(
  db: DatabaseSync,
  mapKey: string,
  mapEpoch: string,
  ledger: ReviewedDocumentOriginLedger,
): void {
  db.prepare(
    `INSERT INTO reviewed_document_origin_ledger_events(
      projection_id, event_sequence, map_key, map_epoch, status, document, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ledger.projectionId,
    ledger.sequence,
    mapKey,
    mapEpoch,
    ledger.status,
    JSON.stringify(ledger),
    ledger.revocation?.at ?? ledger.activatedAt ?? ledger.createdAt,
  );
}

export function reviewedDocumentOriginRevocationTombstone(
  db: DatabaseSync,
  projectionId: string,
): ReviewedDocumentOriginLedger | undefined {
  return parseDocument<ReviewedDocumentOriginLedger>(
    db
      .prepare(
        `SELECT document FROM reviewed_document_origin_revocation_tombstones
         WHERE projection_id = ?`,
      )
      .get(projectionId) as { document?: string } | undefined,
  );
}

export function insertReviewedDocumentOriginRevocationTombstone(
  db: DatabaseSync,
  mapKey: string,
  mapEpoch: string,
  ledger: ReviewedDocumentOriginLedger,
): void {
  db.prepare(
    `INSERT INTO reviewed_document_origin_revocation_tombstones(
      projection_id, map_key, map_epoch, document, revoked_at
    ) VALUES(?, ?, ?, ?, ?)`,
  ).run(
    ledger.projectionId,
    mapKey,
    mapEpoch,
    JSON.stringify(ledger),
    ledger.revocation?.at ?? ledger.createdAt,
  );
}
