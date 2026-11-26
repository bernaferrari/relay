import type { DatabaseSync } from "node:sqlite";
import type { ChangeProofPublicationOutboxRecord } from "@relay/protocol";

function parseRowDocument<T>(row: { document?: string } | undefined): T | undefined {
  const document = row?.document;
  return document === undefined ? undefined : (JSON.parse(document) as T);
}

function outboxColumns(
  record: ChangeProofPublicationOutboxRecord,
): [
  string,
  string,
  string,
  string,
  number,
  string,
  string,
  number,
  number,
  number,
  number | null,
  string | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number,
  string,
] {
  return [
    record.id,
    record.organizationId,
    record.projectId,
    record.proofId,
    record.proofVersion,
    record.provider,
    record.status,
    record.attempts,
    record.maxAttempts,
    record.createdAt,
    record.nextAttemptAt ?? null,
    record.lease?.workerId ?? null,
    record.lease?.token ?? null,
    record.lease?.claimedAt ?? null,
    record.lease?.expiresAt ?? null,
    record.publishedAt ?? null,
    record.updatedAt,
    JSON.stringify(record),
  ];
}

export function changeProofPublicationOutbox(
  db: DatabaseSync,
  organizationId: string,
  projectId: string,
  id: string,
): ChangeProofPublicationOutboxRecord | undefined {
  return parseRowDocument<ChangeProofPublicationOutboxRecord>(
    db
      .prepare(
        `SELECT document FROM change_proof_publication_outbox
         WHERE organization_id = ? AND project_id = ? AND id = ?`,
      )
      .get(organizationId, projectId, id) as { document?: string } | undefined,
  );
}

export function changeProofPublicationOutboxes(
  db: DatabaseSync,
  organizationId?: string,
  projectId?: string,
): ChangeProofPublicationOutboxRecord[] {
  const rows = (
    organizationId === undefined || projectId === undefined
      ? db
          .prepare(
            `SELECT document FROM change_proof_publication_outbox
             ORDER BY created_at ASC, id ASC`,
          )
          .all()
      : db
          .prepare(
            `SELECT document FROM change_proof_publication_outbox
             WHERE organization_id = ? AND project_id = ?
             ORDER BY created_at ASC, id ASC`,
          )
          .all(organizationId, projectId)
  ) as Array<{ document?: string }>;
  return rows
    .map((row) => parseRowDocument<ChangeProofPublicationOutboxRecord>(row))
    .filter((record): record is ChangeProofPublicationOutboxRecord => record !== undefined);
}

export function insertChangeProofPublicationOutbox(
  db: DatabaseSync,
  record: ChangeProofPublicationOutboxRecord,
): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO change_proof_publication_outbox(
          id, organization_id, project_id, proof_id, proof_version, provider, status,
          attempts, max_attempts, created_at, next_attempt_at, lease_worker_id, lease_token,
          lease_claimed_at, lease_expires_at, published_at, updated_at, document
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...outboxColumns(record)).changes > 0
  );
}

export function updateChangeProofPublicationOutbox(
  db: DatabaseSync,
  record: ChangeProofPublicationOutboxRecord,
): boolean {
  const values = outboxColumns(record);
  return (
    db
      .prepare(
        `UPDATE change_proof_publication_outbox SET
           organization_id = ?, project_id = ?, proof_id = ?, proof_version = ?, provider = ?, status = ?,
           attempts = ?, max_attempts = ?, created_at = ?, next_attempt_at = ?, lease_worker_id = ?,
           lease_token = ?, lease_claimed_at = ?, lease_expires_at = ?, published_at = ?,
           updated_at = ?, document = ?
         WHERE organization_id = ? AND project_id = ? AND id = ?`,
      )
      .run(...values.slice(1), record.organizationId, record.projectId, record.id).changes > 0
  );
}

export function changeProofPublicationOutboxByLogicalKey(
  db: DatabaseSync,
  organizationId: string,
  projectId: string,
  proofId: string,
  proofVersion: number,
  provider: ChangeProofPublicationOutboxRecord["provider"],
): ChangeProofPublicationOutboxRecord | undefined {
  return parseRowDocument<ChangeProofPublicationOutboxRecord>(
    db
      .prepare(
        `SELECT document FROM change_proof_publication_outbox
         WHERE organization_id = ? AND project_id = ? AND proof_id = ? AND proof_version = ? AND provider = ?`,
      )
      .get(organizationId, projectId, proofId, proofVersion, provider) as
      | { document?: string }
      | undefined,
  );
}
