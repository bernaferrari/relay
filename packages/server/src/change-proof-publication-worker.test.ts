import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  advanceChangeVerification,
  createChangeVerification,
  listChangeProofPublicationOutbox,
  providerCheckForStoredChangeProof,
  readChangeProofPublications,
  recordChangeProofPublication,
  resetControlDatabaseCache,
  type ChangeVerificationScope,
} from "@relay/core";
import type { ChangeProofPublicationOutboxRecord, ChangeVerification } from "@relay/protocol";
import { processChangeProofPublicationRecord } from "./change-proof-publication-worker.js";

const scope: ChangeVerificationScope = { organizationId: "acme", projectId: "relay" };
const headSha = "2".repeat(40);
const requestDigest = `sha256:${"a".repeat(64)}` as const;

async function withStateRoot(operation: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-publication-worker-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  try {
    await operation();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function terminalProof(maxAttempts = 3): Promise<ChangeVerification> {
  const created = await createChangeVerification({
    ...scope,
    id: "proof-worker",
    change: {
      repository: "acme/settings",
      baseSha: "1".repeat(40),
      headSha,
    },
    policy: { id: "relay.verify-change", version: 1 },
    requestedBy: "agent:coder",
    actorId: "agent:coder",
    requestId: "request-start",
    requestDigest,
    at: 100,
  });
  return advanceChangeVerification({
    ...scope,
    proofId: created.id,
    expectedVersion: created.version,
    state: "insufficient-evidence",
    actorId: "system:relay",
    requestId: "request-decision",
    requestDigest,
    action: "record-decision",
    at: 200,
    coverageGaps: ["Exact build evidence is missing."],
    smallestNextVerification: { kind: "provide-build", reason: "Bind the exact head build." },
    publication: { provider: "github", maxAttempts },
  });
}

async function publicationRecord(): Promise<ChangeProofPublicationOutboxRecord> {
  const record = (await listChangeProofPublicationOutbox(scope))[0];
  assert.ok(record, "terminal Proof must enqueue one publication intent");
  return record;
}

test("worker publishes only after a matching durable provider receipt", async () => {
  await withStateRoot(async () => {
    const proof = await terminalProof();
    const record = await publicationRecord();
    let publishCalls = 0;

    await processChangeProofPublicationRecord({
      record,
      proof,
      workerId: "worker-success",
      publish: async ({ intent, proof: publishedProof }) => {
        publishCalls += 1;
        const check = providerCheckForStoredChangeProof({ proof: publishedProof });
        await recordChangeProofPublication({
          ...scope,
          proofId: publishedProof.id,
          repository: intent.repository,
          check,
          provider: "github",
          checkRunId: 42,
          externalId: intent.externalId,
          headSha: intent.headSha,
          publishedAt: 300,
        });
      },
    });

    const published = await publicationRecord();
    assert.equal(publishCalls, 1);
    assert.equal(published.status, "published");
    assert.equal(published.receipt?.checkRunId, 42);
    assert.equal((await readChangeProofPublications(scope, proof.id)).length, 1);
  });
});

test("provider failure becomes a bounded token-free retry", async () => {
  await withStateRoot(async () => {
    const proof = await terminalProof();
    const record = await publicationRecord();

    await processChangeProofPublicationRecord({
      record,
      proof,
      workerId: "worker-provider-failure",
      publish: async () => {
        throw new Error("Authorization: Bearer ghp_secret_token");
      },
    });

    const retry = await publicationRecord();
    assert.equal(retry.status, "retry");
    assert.equal(retry.lastFailure?.kind, "provider-error");
    assert.equal(retry.attempts, 1);
    assert.ok(retry.nextAttemptAt);
    assert.equal(JSON.stringify(retry).includes("ghp_secret_token"), false);
  });
});

test("provider success without a matching receipt becomes a reconciliation retry", async () => {
  await withStateRoot(async () => {
    const proof = await terminalProof(1);
    const record = await publicationRecord();

    await processChangeProofPublicationRecord({
      record,
      proof,
      workerId: "worker-reconciliation",
      publish: async () => {
        // Simulate a provider returning success before Relay's receipt write
        // commits. The worker must not infer that publication happened.
      },
    });

    const retry = await publicationRecord();
    assert.equal(retry.status, "retry");
    assert.equal(retry.lastFailure?.kind, "reconciliation-error");
    assert.equal(retry.attempts, 1);
    // At the attempt ceiling the row remains visible but cannot be claimed
    // again automatically, so a human/operator can reconcile it explicitly.
    assert.equal(retry.nextAttemptAt, undefined);
  });
});
