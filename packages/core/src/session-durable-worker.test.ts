import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableWorkerAssignmentStore,
  durableWorkerAssignmentStore,
  resetDurableWorkerAssignmentStoreForTests,
} from "./durable-worker-assignments.js";
import {
  claimDurableSessionJob,
  finishDurableSessionJob,
  queueDurableSessionJob,
  runScheduledSessionJob,
} from "./session-durable-worker.js";
import type { TestJob } from "./session-contract.js";

function remoteJob(id: string): TestJob {
  const target = {
    schemaVersion: 1 as const,
    kind: "provider-session" as const,
    provider: { key: "example.device-farm" as const, scope: "remote" as const },
    // Deliberately the same shape as a plausible local serial. The provider
    // scope is what makes this a distinct durable identity.
    targetId: "emulator-5554",
    platform: "ios" as const,
    identity: { kind: "provider-session" as const, value: "emulator-5554" },
  };
  return {
    id,
    projectId: "project-device-farm",
    ownerId: "agent:runner",
    operationContext: {
      schemaVersion: 1,
      actorId: "agent:runner",
      actorKind: "agent",
      organizationId: "org-device-farm",
      projectId: "project-device-farm",
      operationId: "job.start",
      requestId: `request-${id}`,
      idempotencyKey: `idempotency-${id}`,
      issuedAt: 1_000,
      leaseId: `lease-${id}`,
      leaseOwnerId: "agent:lease-owner",
    },
    targetContext: {
      kind: "cloud",
      provider: "example.device-farm",
      sessionId: "emulator-5554",
      platform: "ios",
    },
    executionTarget: target,
    action: "app-map:test:remote",
    recipeId: "app-map:test:remote",
    platform: "ios",
    targetKind: "device",
    workerId: "remote:example.device-farm:target:emulator-5554",
    workerCapacity: 1,
    hostWorkerId: "remote:example.device-farm:host:us-east",
    hostWorkerCapacity: 4,
    status: "queued",
    queuedAt: 1_000,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: ["ai"],
    kind: "Replay",
    tone: "acc",
    title: "Remote target test",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

async function withStateRoot(operation: () => Promise<void> | void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-session-durable-worker-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetDurableWorkerAssignmentStoreForTests();
  try {
    await operation();
  } finally {
    resetDurableWorkerAssignmentStoreForTests();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("queue bridge freezes provider-scoped target, lane, and lease provenance before dispatch", async () => {
  await withStateRoot(() => {
    const job = remoteJob("remote-queued");
    queueDurableSessionJob(job);

    const assignment = durableWorkerAssignmentStore().get(job.id);
    assert.ok(assignment);
    assert.equal(assignment.status, "queued");
    assert.deepEqual(assignment.executionTarget, job.executionTarget);
    assert.equal(
      assignment.executionTargetKey,
      '["example.device-farm","provider-session","ios","provider-session","emulator-5554"]',
    );
    assert.deepEqual(assignment.lane, {
      workerId: "remote:example.device-farm:target:emulator-5554",
      capacity: 1,
      host: { workerId: "remote:example.device-farm:host:us-east", capacity: 4 },
    });
    assert.deepEqual(assignment.lease, {
      leaseId: "lease-remote-queued",
      ownerId: "agent:lease-owner",
      actorId: "agent:runner",
    });
  });
});

test("terminal bridge requires the durable worker owner that claimed the assignment", async () => {
  await withStateRoot(() => {
    const job = remoteJob("remote-terminal");
    queueDurableSessionJob(job);
    const owner = claimDurableSessionJob(job);
    assert.equal(durableWorkerAssignmentStore().get(job.id)?.status, "running");

    job.status = "ok";
    assert.throws(() => finishDurableSessionJob(job, "another-server"), /owned by another worker/u);
    finishDurableSessionJob(job, owner);

    const assignment = durableWorkerAssignmentStore().get(job.id);
    assert.equal(assignment?.status, "ok");
    assert.deepEqual(assignment?.terminal?.status, "ok");
    assert.equal(assignment?.execution?.workerInstanceId, owner);
  });
});

test("a cross-process claim collision records a no-input dispatch failure instead of leaving a queued journal row", async () => {
  await withStateRoot(async () => {
    const job = remoteJob("contended-job");
    const root = process.env.RELAY_STATE_DIR!;
    const other = new DurableWorkerAssignmentStore(join(root, "worker-assignments.sqlite"));
    try {
      const blocking = remoteJob("blocking-job");
      queueDurableSessionJob(blocking);
      other.claimRunning(blocking.id, "other-relay-process", 2_000);
      queueDurableSessionJob(job);

      let executed = false;
      await runScheduledSessionJob({
        job,
        execute: async () => {
          executed = true;
        },
        onDispatchFailure: async () => {
          job.status = "error";
          job.persisted = true;
        },
        onDurabilityFailure: (error) => {
          throw error;
        },
      });

      assert.equal(executed, false);
      const assignment = durableWorkerAssignmentStore().get(job.id);
      assert.equal(assignment?.status, "error");
      assert.equal(assignment?.terminal?.reason, "job-dispatch-failed-before-execution");
    } finally {
      other.close();
    }
  });
});
