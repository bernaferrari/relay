import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableWorkerAssignmentContentionError,
  DurableWorkerAssignmentStore,
  durableWorkerAssignmentsPath,
  type DurableWorkerAssignment,
} from "./durable-worker-assignments.js";

function localAndroidTarget(id = "emulator-5554") {
  return {
    schemaVersion: 1 as const,
    kind: "local-device" as const,
    provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
    targetId: id,
    platform: "android" as const,
    identity: { kind: "device-serial" as const, value: id },
  };
}

function input(id = "job-1") {
  return {
    id,
    projectId: "project-local",
    executionTarget: localAndroidTarget(),
    lane: {
      workerId: "local:android:target:emulator-5554",
      capacity: 1,
      host: { workerId: "mac-local", capacity: 2 },
    },
    lease: {
      leaseId: "lease-1",
      ownerId: "agent:runner",
      actorId: "agent:runner",
    },
    queuedAt: 1_000,
  };
}

async function withStore(
  operation: (store: DurableWorkerAssignmentStore, path: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-durable-workers-"));
  const path = durableWorkerAssignmentsPath(root);
  const store = new DurableWorkerAssignmentStore(path);
  try {
    await operation(store, path);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("persists queued and running provider-scoped assignments with frozen lease provenance", async () => {
  await withStore((store, path) => {
    const queued = store.queue(input());
    assert.equal(queued.status, "queued");
    assert.equal(
      queued.executionTargetKey,
      '["relay.local.agent-device","local-device","android","device-serial","emulator-5554"]',
    );
    assert.deepEqual(queued.lease, {
      leaseId: "lease-1",
      ownerId: "agent:runner",
      actorId: "agent:runner",
    });

    const running = store.claimRunning("job-1", "server-a", 1_100);
    assert.deepEqual(running.execution, {
      workerInstanceId: "server-a",
      claimedAt: 1_100,
      heartbeatAt: 1_100,
    });
    store.close();

    const reopened = new DurableWorkerAssignmentStore(path);
    try {
      assert.deepEqual(reopened.get("job-1"), running);
    } finally {
      reopened.close();
    }
  });
});

test("only the worker that claimed an assignment can heartbeat, pause, and finish it", async () => {
  await withStore((store) => {
    store.queue(input());
    store.claimRunning("job-1", "server-a", 2_000);
    assert.throws(() => store.heartbeat("job-1", "server-b", 2_100), /owned by another worker/u);
    assert.equal(store.heartbeat("job-1", "server-a", 2_100).execution?.heartbeatAt, 2_100);
    assert.equal(store.setPaused("job-1", "server-a", true, 2_200).status, "paused");
    assert.equal(store.setPaused("job-1", "server-a", false, 2_300).status, "running");
    const terminal = store.finish({
      id: "job-1",
      status: "ok",
      workerInstanceId: "server-a",
      at: 2_400,
    });
    assert.deepEqual(terminal.terminal, { status: "ok", at: 2_400, reason: "job-finished" });
    assert.equal(store.get("job-1")?.status, "ok");
  });
});

test("restart reconciliation fails closed for queued and in-flight work while retaining evidence to recover", async () => {
  await withStore((store, path) => {
    store.queue(input("queued-before-restart"));
    store.queue(input("running-before-restart"));
    store.claimRunning("running-before-restart", "server-before-restart", 3_000);
    store.heartbeat("running-before-restart", "server-before-restart", 3_100);
    store.close();

    const restarted = new DurableWorkerAssignmentStore(path);
    try {
      const reconciliation = restarted.reconcileAfterRestart({
        workerInstanceId: "server-after-restart",
        at: 4_000,
      });
      assert.deepEqual(
        reconciliation.assignments.map((assignment) => [
          assignment.id,
          assignment.status,
          assignment.terminal?.reason,
          assignment.lease?.ownerId,
        ]),
        [
          [
            "queued-before-restart",
            "recovery-required",
            "server-restart-before-dispatch",
            "agent:runner",
          ],
          [
            "running-before-restart",
            "recovery-required",
            "server-restart-during-execution",
            "agent:runner",
          ],
        ],
      );
      assert.equal(
        restarted.reconcileAfterRestart({ workerInstanceId: "server-after-restart", at: 4_100 })
          .assignments.length,
        0,
        "restart reconciliation is idempotent once every active record has a durable verdict",
      );
      const preserved = restarted.get("running-before-restart") as DurableWorkerAssignment;
      assert.equal(preserved.execution?.heartbeatAt, 3_100);
      assert.equal(preserved.executionTarget.targetId, "emulator-5554");
    } finally {
      restarted.close();
    }
  });
});

test("two Relay processes cannot claim the same provider-scoped target concurrently", async () => {
  await withStore((firstStore, path) => {
    const secondStore = new DurableWorkerAssignmentStore(path);
    try {
      firstStore.queue(input("process-a"));
      secondStore.queue(input("process-b"));
      firstStore.claimRunning("process-a", "relay-process-a", 5_000);

      assert.throws(
        () => secondStore.claimRunning("process-b", "relay-process-b", 5_100),
        (error: unknown) =>
          error instanceof DurableWorkerAssignmentContentionError &&
          error.scope === "target" &&
          error.blockingAssignmentId === "process-a",
      );
      assert.equal(secondStore.get("process-b")?.status, "queued");

      firstStore.finish({
        id: "process-a",
        status: "ok",
        workerInstanceId: "relay-process-a",
        at: 5_200,
      });
      assert.equal(
        secondStore.claimRunning("process-b", "relay-process-b", 5_300).status,
        "running",
      );
    } finally {
      secondStore.close();
    }
  });
});

test("two Relay processes respect the lowest frozen host ceiling across distinct targets", async () => {
  await withStore((firstStore, path) => {
    const secondStore = new DurableWorkerAssignmentStore(path);
    try {
      firstStore.queue(input("host-a"));
      secondStore.queue({
        ...input("host-b"),
        executionTarget: localAndroidTarget("emulator-5556"),
        lane: {
          workerId: "local:android:target:emulator-5556",
          capacity: 1,
          host: { workerId: "mac-local", capacity: 1 },
        },
      });
      firstStore.claimRunning("host-a", "relay-process-a", 6_000);

      assert.throws(
        () => secondStore.claimRunning("host-b", "relay-process-b", 6_100),
        (error: unknown) =>
          error instanceof DurableWorkerAssignmentContentionError && error.scope === "host",
      );
      assert.equal(secondStore.get("host-b")?.status, "queued");
    } finally {
      secondStore.close();
    }
  });
});

test("restart quarantine retains the prior execution fence until a fresh reproof releases it", async () => {
  await withStore((store) => {
    store.queue(input("interrupted"));
    store.claimRunning("interrupted", "server-before-restart", 7_000);
    store.reconcileAfterRestart({ workerInstanceId: "server-after-restart", at: 7_100 });
    store.queue(input("fresh-attempt"));

    assert.throws(
      () => store.claimRunning("fresh-attempt", "server-after-restart", 7_200),
      (error: unknown) =>
        error instanceof DurableWorkerAssignmentContentionError && error.scope === "target",
    );
    const released = store.releaseRecoveryFence({
      id: "interrupted",
      releasedBy: "agent:operator",
      reproofId: "screen-observation:after-reconnect",
      at: 7_300,
    });
    assert.deepEqual(released.recoveryFenceRelease, {
      releasedAt: 7_300,
      releasedBy: "agent:operator",
      reproofId: "screen-observation:after-reconnect",
    });
    assert.equal(
      store.claimRunning("fresh-attempt", "server-after-restart", 7_400).status,
      "running",
    );
  });
});
