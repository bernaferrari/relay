import type { DatabaseSync } from "node:sqlite";
import type { ChangeProofExecutionConfirmationReceipt } from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";

export type ChangeProofConfirmationRecord = {
  receipt: ChangeProofExecutionConfirmationReceipt;
  consumedAt?: number;
};

function parse(row: { document?: string } | undefined): ChangeProofConfirmationRecord | undefined {
  if (!row?.document) return undefined;
  return JSON.parse(row.document) as ChangeProofConfirmationRecord;
}

export function changeProofConfirmation(
  db: DatabaseSync,
  receiptId: string,
): ChangeProofConfirmationRecord | undefined {
  return parse(
    db
      .prepare(
        `SELECT document FROM change_proof_confirmation_receipts
         WHERE receipt_id = ?`,
      )
      .get(receiptId) as { document?: string } | undefined,
  );
}

export function changeProofConfirmations(
  db: DatabaseSync,
  organizationId: string,
  projectId: string,
  proofId: string,
): ChangeProofConfirmationRecord[] {
  return (
    db
      .prepare(
        `SELECT document FROM change_proof_confirmation_receipts
       WHERE organization_id = ? AND project_id = ? AND proof_id = ?
       ORDER BY issued_at, receipt_id`,
      )
      .all(organizationId, projectId, proofId) as Array<{ document?: string }>
  ).flatMap((row) => {
    const value = parse(row);
    return value ? [value] : [];
  });
}

export function insertChangeProofConfirmation(
  db: DatabaseSync,
  record: ChangeProofConfirmationRecord,
): boolean {
  const receipt = record.receipt;
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO change_proof_confirmation_receipts(
          receipt_id, organization_id, project_id, proof_id, cell_id,
          actor_id, preview_digest, issued_at, expires_at, consumed_at, document
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.receiptId,
        receipt.scope.organizationId,
        receipt.scope.projectId,
        receipt.scope.proofId,
        receipt.scope.cellId,
        receipt.actorId,
        receipt.previewDigest,
        receipt.issuedAt,
        receipt.expiresAt,
        record.consumedAt ?? null,
        JSON.stringify(record),
      ).changes > 0
  );
}

/** Atomically consume one issued receipt only when its complete immutable
 * payload matches. A forged payload or a second use returns false. */
export function consumeChangeProofConfirmation(
  db: DatabaseSync,
  receipt: ChangeProofExecutionConfirmationReceipt,
  consumedAt: number,
): boolean {
  const stored = changeProofConfirmation(db, receipt.receiptId);
  if (!stored || stored.consumedAt !== undefined) return false;
  if (canonicalSha256(stored.receipt) !== canonicalSha256(receipt)) return false;
  const updated = { ...stored, consumedAt };
  return (
    db
      .prepare(
        `UPDATE change_proof_confirmation_receipts
         SET consumed_at = ?, document = ?
         WHERE receipt_id = ? AND consumed_at IS NULL`,
      )
      .run(consumedAt, JSON.stringify(updated), receipt.receiptId).changes > 0
  );
}
