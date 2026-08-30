import type { DatabaseSync } from "node:sqlite";
import type { ChangeProofExecutionRecord } from "./change-proof-execution-types.js";

export type ChangeProofExecutionUpdateGuard = {
  status: ChangeProofExecutionRecord["status"];
  cursor: number;
  leaseToken?: string;
};

function parseRowDocument<T>(row: { document?: string } | undefined): T | undefined {
  const document = row?.document;
  return document === undefined ? undefined : (JSON.parse(document) as T);
}

type ExecutionColumns = [
  string,
  string,
  string,
  string,
  number,
  string,
  string,
  string,
  number,
  number,
  number,
  string | null,
  string | null,
  number | null,
  number | null,
  number,
  number,
  string,
];

function columns(record: ChangeProofExecutionRecord): ExecutionColumns {
  return [
    record.id,
    record.organizationId,
    record.projectId,
    record.proofId,
    record.proofVersion,
    record.requestId,
    record.requestDigest,
    record.status,
    record.cursor,
    record.total,
    record.deadlineAt,
    record.lease?.workerId ?? null,
    record.lease?.token ?? null,
    record.lease?.claimedAt ?? null,
    record.lease?.expiresAt ?? null,
    record.createdAt,
    record.updatedAt,
    JSON.stringify(record),
  ];
}

export function changeProofExecution(
  db: DatabaseSync,
  organizationId: string,
  projectId: string,
  id: string,
): ChangeProofExecutionRecord | undefined {
  return parseRowDocument<ChangeProofExecutionRecord>(
    db
      .prepare(
        `SELECT document FROM change_proof_executions
         WHERE organization_id = ? AND project_id = ? AND id = ?`,
      )
      .get(organizationId, projectId, id) as { document?: string } | undefined,
  );
}

export function changeProofExecutionByProof(
  db: DatabaseSync,
  organizationId: string,
  projectId: string,
  proofId: string,
): ChangeProofExecutionRecord | undefined {
  return parseRowDocument<ChangeProofExecutionRecord>(
    db
      .prepare(
        `SELECT document FROM change_proof_executions
         WHERE organization_id = ? AND project_id = ? AND proof_id = ?`,
      )
      .get(organizationId, projectId, proofId) as { document?: string } | undefined,
  );
}

export function changeProofExecutions(
  db: DatabaseSync,
  organizationId?: string,
  projectId?: string,
): ChangeProofExecutionRecord[] {
  const rows = (
    organizationId === undefined || projectId === undefined
      ? db
          .prepare(
            `SELECT document FROM change_proof_executions
             ORDER BY updated_at DESC, id ASC`,
          )
          .all()
      : db
          .prepare(
            `SELECT document FROM change_proof_executions
             WHERE organization_id = ? AND project_id = ?
             ORDER BY updated_at DESC, id ASC`,
          )
          .all(organizationId, projectId)
  ) as Array<{ document?: string }>;
  return rows
    .map((row) => parseRowDocument<ChangeProofExecutionRecord>(row))
    .filter((record): record is ChangeProofExecutionRecord => record !== undefined);
}

export function insertChangeProofExecution(
  db: DatabaseSync,
  record: ChangeProofExecutionRecord,
): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO change_proof_executions(
          id, organization_id, project_id, proof_id, proof_version, request_id,
          request_digest, status, cursor, total, deadline_at, worker_id,
          lease_token, lease_claimed_at, lease_expires_at, created_at, updated_at,
          document
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...columns(record)).changes > 0
  );
}

export function updateChangeProofExecution(
  db: DatabaseSync,
  record: ChangeProofExecutionRecord,
  guard?: ChangeProofExecutionUpdateGuard,
): boolean {
  const values = columns(record);
  const guardSql = guard
    ? ` AND status = ? AND cursor = ?
        AND ((lease_token IS NULL AND ? IS NULL) OR lease_token = ?)`
    : "";
  const guardValues = guard
    ? [guard.status, guard.cursor, guard.leaseToken ?? null, guard.leaseToken ?? null]
    : [];
  return (
    db
      .prepare(
        `UPDATE change_proof_executions SET
           proof_id = ?, proof_version = ?, request_id = ?, request_digest = ?,
           status = ?, cursor = ?, total = ?, deadline_at = ?, worker_id = ?,
           lease_token = ?, lease_claimed_at = ?, lease_expires_at = ?,
           created_at = ?, updated_at = ?, document = ?
         WHERE organization_id = ? AND project_id = ? AND id = ?${guardSql}`,
      )
      .run(...values.slice(3), record.organizationId, record.projectId, record.id, ...guardValues)
      .changes > 0
  );
}
