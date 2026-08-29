import {
  claimChangeProofPublicationOutbox,
  listAllChangeProofPublicationOutbox,
  listChangeProofPublicationOutbox,
  markChangeProofPublicationRetry,
  reconcileChangeProofPublicationOutbox,
  type ChangeVerificationScope,
} from "@relay/core";
import type {
  ChangeProofPublicationIntent,
  ChangeProofPublicationOutboxRecord,
  ChangeVerification,
} from "@relay/protocol";

export type ChangeProofTerminalPublisher = (input: {
  scope: ChangeVerificationScope;
  proof: ChangeVerification;
  intent: ChangeProofPublicationIntent;
}) => Promise<void>;

async function retryClaim(
  record: ChangeProofPublicationOutboxRecord,
  kind: "provider-error" | "reconciliation-error",
): Promise<void> {
  if (!record.lease) return;
  try {
    await markChangeProofPublicationRetry({
      organizationId: record.organizationId,
      projectId: record.projectId,
      id: record.id,
      workerId: record.lease.workerId,
      leaseToken: record.lease.token,
      kind,
    });
  } catch {
    // The lease itself is durable. A competing recovery or shutdown can win;
    // startup recovery will make an expired claim retryable without guessing.
  }
}

export async function processChangeProofPublicationRecord(input: {
  record: ChangeProofPublicationOutboxRecord;
  proof: ChangeVerification;
  publish: ChangeProofTerminalPublisher;
  workerId: string;
}): Promise<void> {
  const scope = {
    organizationId: input.record.organizationId,
    projectId: input.record.projectId,
  };
  const claimed = await claimChangeProofPublicationOutbox({
    ...scope,
    id: input.record.id,
    workerId: input.workerId,
  });
  if (!claimed) return;
  try {
    await input.publish({ scope, proof: input.proof, intent: claimed });
  } catch {
    await retryClaim(claimed, "provider-error");
    return;
  }
  try {
    const reconciled = await reconcileChangeProofPublicationOutbox({ ...scope, id: claimed.id });
    if (reconciled?.status === "published") return;
  } catch {
    await retryClaim(claimed, "reconciliation-error");
    return;
  }
  await retryClaim(claimed, "reconciliation-error");
}

/** Best-effort fast path after a terminal transaction. Provider failure never
 * changes the already durable Proof response; the outbox remains retryable. */
export async function processTerminalChangeProofPublication(input: {
  scope: ChangeVerificationScope;
  proof: ChangeVerification;
  publish?: ChangeProofTerminalPublisher;
  workerId?: string;
}): Promise<void> {
  if (!input.publish) return;
  const record = (await listChangeProofPublicationOutbox(input.scope)).find(
    (candidate) =>
      candidate.proofId === input.proof.id && candidate.proofVersion === input.proof.version,
  );
  if (!record || record.status === "published") return;
  await processChangeProofPublicationRecord({
    record,
    proof: input.proof,
    publish: input.publish,
    workerId: input.workerId ?? `relay-proof-route:${process.pid}`,
  });
}

/** Bounded restart-safe worker pass. Historical terminal versions are loaded
 * explicitly so a later Proof revision cannot rewrite an older provider intent. */
export async function drainChangeProofPublicationOutbox(input: {
  publish: ChangeProofTerminalPublisher;
  loadProof: (
    record: ChangeProofPublicationOutboxRecord,
  ) => Promise<ChangeVerification | undefined>;
  workerId?: string;
  limit?: number;
}): Promise<number> {
  const now = Date.now();
  const due = (await listAllChangeProofPublicationOutbox())
    .filter(
      (record) =>
        record.status === "pending" ||
        (record.status === "retry" &&
          record.nextAttemptAt !== undefined &&
          record.nextAttemptAt <= now),
    )
    .slice(0, Math.max(1, Math.min(100, input.limit ?? 10)));
  let processed = 0;
  for (const record of due) {
    const proof = await input.loadProof(record);
    if (!proof) continue;
    await processChangeProofPublicationRecord({
      record,
      proof,
      publish: input.publish,
      workerId: input.workerId ?? `relay-proof-worker:${process.pid}`,
    });
    processed += 1;
  }
  return processed;
}
