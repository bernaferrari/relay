import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChangeProofPublicationReceipt } from "@relay/protocol";
import {
  claimChangeProofPublicationOutbox,
  enqueueChangeProofPublicationOutbox,
  listChangeProofPublicationOutbox,
  markChangeProofPublicationPublished,
  markChangeProofPublicationRetry,
  readChangeProofPublicationOutbox,
  recoverChangeProofPublicationOutbox,
  requestChangeProofPublicationRecovery,
  runNextChangeProofPublicationOutbox,
} from "./change-proof-publication-outbox.js";
import { canonicalSha256 } from "./canonical-json.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";

const scope = { organizationId: "acme", projectId: "relay" } as const;
const headSha = "a".repeat(40);

function check(conclusion: "success" | "failure" | "action-required" = "success") {
  return {
    schemaVersion: 1 as const,
    name: "Relay Proof" as const,
    externalId: "proof-1",
    headSha,
    status: "completed" as const,
    conclusion,
    classification: conclusion === "success" ? ("proved" as const) : ("rejected" as const),
    title: "Relay Proof",
    summary: "The exact terminal Proof was evaluated.",
    text: "All required cases passed.",
  };
}

function receipt(
  conclusion: "success" | "failure" | "action-required" = "success",
  publishedAt = 300,
): ChangeProofPublicationReceipt {
  const value = check(conclusion);
  return {
    schemaVersion: 1,
    sequence: 1,
    ...scope,
    proofId: "proof-1",
    proofVersion: 4,
    provider: "github",
    repository: "acme/settings",
    headSha,
    externalId: "proof-1",
    checkRunId: 42,
    checkDigest: canonicalSha256(value),
    conclusion,
    publishedAt,
  };
}

async function withState<T>(fn: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-publication-outbox-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    return await fn();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function enqueueInput(overrides: Record<string, unknown> = {}) {
  return {
    ...scope,
    proofId: "proof-1",
    proofVersion: 4,
    provider: "github" as const,
    repository: "acme/settings",
    headSha,
    externalId: "proof-1",
    check: check(),
    createdAt: 100,
    ...overrides,
  };
}

test("enqueues one deterministic, token-free intent and isolates scopes", async () => {
  await withState(async () => {
    const first = await enqueueChangeProofPublicationOutbox(enqueueInput());
    const repeated = await enqueueChangeProofPublicationOutbox({
      ...enqueueInput(),
      id: "a-different-caller-id",
    });
    assert.equal(repeated.id, first.id);
    assert.equal(first.status, "pending");
    assert.equal(first.attempts, 0);
    assert.equal(JSON.stringify(first).includes("ghp_secret_token"), false);
    assert.equal((await listChangeProofPublicationOutbox(scope)).length, 1);
    const otherScope = await enqueueChangeProofPublicationOutbox({
      ...enqueueInput(),
      id: first.id,
      organizationId: "other",
    });
    assert.equal(otherScope.id, first.id);
    assert.deepEqual(
      await listChangeProofPublicationOutbox({ organizationId: "other", projectId: "relay" }),
      [otherScope],
    );
    assert.deepEqual(
      await readChangeProofPublicationOutbox(
        { organizationId: "other", projectId: "relay" },
        first.id,
      ),
      otherScope,
    );
    await assert.rejects(
      () => enqueueChangeProofPublicationOutbox(enqueueInput({ check: check("failure") })),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "OUTBOX_INTENT_CONFLICT",
    );
  });
});

test("a later terminal Proof version receives its own durable publication intent", async () => {
  await withState(async () => {
    const first = await enqueueChangeProofPublicationOutbox(enqueueInput());
    const later = await enqueueChangeProofPublicationOutbox(
      enqueueInput({ proofVersion: 5, check: check("failure"), createdAt: 200 }),
    );
    assert.notEqual(later.id, first.id);
    assert.equal(later.proofVersion, 5);
    assert.deepEqual(
      (await listChangeProofPublicationOutbox(scope)).map(({ proofVersion }) => proofVersion),
      [4, 5],
    );
  });
});

test("claims, recovers an expired lease, retries with bounded backoff, and reconciles a receipt", async () => {
  await withState(async () => {
    const pending = await enqueueChangeProofPublicationOutbox(enqueueInput({ maxAttempts: 3 }));
    const claimed = await claimChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-a",
      now: 1_000,
      leaseMs: 100,
    });
    assert.equal(claimed?.id, pending.id);
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.attempts, 1);
    assert.equal(claimed?.lease?.workerId, "worker-a");
    const recovered = await recoverChangeProofPublicationOutbox({ ...scope, at: 1_101 });
    assert.equal(recovered[0]?.status, "retry");
    assert.equal(recovered[0]?.nextAttemptAt, 1_101);

    const reclaimed = await claimChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-b",
      now: 1_102,
      leaseMs: 1_000,
    });
    assert.equal(reclaimed?.attempts, 2);
    const retried = await markChangeProofPublicationRetry({
      ...scope,
      id: pending.id,
      workerId: "worker-b",
      leaseToken: reclaimed!.lease!.token,
      at: 2_000,
    });
    assert.equal(retried.status, "retry");
    assert.equal(retried.nextAttemptAt, 4_000);

    const notDue = await claimChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-c",
      now: 3_999,
    });
    assert.equal(notDue, undefined);
    const due = await claimChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-c",
      now: 4_000,
    });
    assert.equal(due?.attempts, 3);
    const published = await markChangeProofPublicationPublished({
      ...scope,
      id: pending.id,
      workerId: "worker-c",
      leaseToken: due!.lease!.token,
      receipt: receipt(),
      at: 5_000,
    });
    assert.equal(published.status, "published");
    assert.equal(published.receipt?.checkRunId, 42);
    assert.deepEqual(
      await markChangeProofPublicationPublished({
        ...scope,
        id: pending.id,
        receipt: receipt(),
        at: 5_001,
      }),
      published,
    );
  });
});

test("worker catches provider failures without persisting provider error text", async () => {
  await withState(async () => {
    await enqueueChangeProofPublicationOutbox(enqueueInput({ maxAttempts: 1 }));
    const result = await runNextChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-a",
      now: 10_000,
      publish: async () => {
        throw new Error("Authorization: Bearer ghp_secret_token");
      },
    });
    assert.equal(result.status, "retry");
    assert.equal(result.record.attempts, 1);
    assert.equal(result.record.nextAttemptAt, undefined);
    assert.equal(
      JSON.stringify(await listChangeProofPublicationOutbox(scope)).includes("ghp_secret_token"),
      false,
    );
  });
});

test("explicit recovery grants one idempotent attempt without changing publication identity", async () => {
  await withState(async () => {
    const original = await enqueueChangeProofPublicationOutbox(enqueueInput({ maxAttempts: 1 }));
    await runNextChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-a",
      now: 10_000,
      publish: async () => {
        throw new Error("provider unavailable");
      },
    });
    const request = {
      ...scope,
      id: original.id,
      proofId: original.proofId,
      proofVersion: original.proofVersion,
      actorId: "human:reviewer",
      requestId: "recover-1",
      requestDigest: canonicalSha256({ intent: "retry exact publication" }),
      at: 20_000,
    } as const;
    const recovered = await requestChangeProofPublicationRecovery(request);
    assert.equal(recovered.disposition, "retry-scheduled");
    assert.equal(recovered.record.attempts, 1);
    assert.equal(recovered.record.maxAttempts, 2);
    assert.equal(recovered.record.nextAttemptAt, 20_000);
    assert.equal(recovered.record.id, original.id);
    assert.equal(recovered.record.externalId, original.externalId);
    assert.deepEqual(recovered.record.check, original.check);
    assert.deepEqual(recovered.record.recovery, {
      requestId: "recover-1",
      requestDigest: request.requestDigest,
      requestedBy: "human:reviewer",
      requestedAt: 20_000,
    });

    const repeated = await requestChangeProofPublicationRecovery(request);
    assert.equal(repeated.disposition, "existing");
    assert.deepEqual(repeated.record, recovered.record);
    await assert.rejects(
      requestChangeProofPublicationRecovery({
        ...request,
        requestDigest: canonicalSha256({ intent: "different" }),
      }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "OUTBOX_INTENT_CONFLICT",
    );
  });
});

test("worker heartbeats the exact claim while the provider call is in flight", async () => {
  await withState(async () => {
    await enqueueChangeProofPublicationOutbox(enqueueInput({ maxAttempts: 2 }));
    const result = await runNextChangeProofPublicationOutbox({
      ...scope,
      workerId: "worker-heartbeat",
      leaseMs: 20,
      heartbeatMs: 5,
      publish: async () => {
        await new Promise((resolve) => setTimeout(resolve, 55));
        const rows = await listChangeProofPublicationOutbox(scope);
        const claimed = rows[0];
        assert.ok(claimed);
        const live = await readChangeProofPublicationOutbox(scope, claimed.id);
        assert.equal(live?.id, claimed.id);
        assert.equal(claimed?.status, "claimed");
        assert.equal(claimed?.lease?.workerId, "worker-heartbeat");
        assert.ok(
          claimed?.lease && claimed.lease.expiresAt > claimed.lease.claimedAt + 20,
          "a long provider call must extend the original claim",
        );
        return receipt();
      },
    });
    assert.equal(result.status, "published");
  });
});
