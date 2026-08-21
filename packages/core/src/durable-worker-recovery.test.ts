import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableWorkerAssignmentContentionError,
  DurableWorkerAssignmentStore,
  durableWorkerAssignmentsPath,
} from "./durable-worker-assignments.js";
import { recoverDurableWorkerAssignments } from "./durable-worker-recovery.js";

function assignment(id: string, targetId: string) {
  return {
    id,
    projectId: "project-recovery",
    executionTarget: {
      schemaVersion: 1 as const,
      kind: "local-device" as const,
      provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
      targetId,
      platform: "android" as const,
      identity: { kind: "device-serial" as const, value: targetId },
    },
    lane: { workerId: `local:android:target:${targetId}`, capacity: 1 },
    queuedAt: 1_000,
  };
}

async function withStore(
  operation: (store: DurableWorkerAssignmentStore) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-durable-worker-recovery-"));
  const store = new DurableWorkerAssignmentStore(durableWorkerAssignmentsPath(root));
  try {
    await operation(store);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("startup recovery checks every active/fenced row before quarantining and honors only valid committed manifests", async () => {
  await withStore(async (store) => {
    store.queue(assignment("manifest-after-crash", "manifest-target"));
    store.claimRunning("manifest-after-crash", "server-before-restart", 1_100);

    store.queue(assignment("interrupted", "fenced-target"));
    store.claimRunning("interrupted", "server-before-restart", 1_200);
    store.setPaused("interrupted", "server-before-restart", true, 1_250);

    store.queue(assignment("queued-before-dispatch", "queued-target"));

    store.queue(assignment("fenced-manifest", "fenced-manifest-target"));
    store.claimRunning("fenced-manifest", "server-before-restart", 1_300);
    store.reconcileAfterRestart({
      workerInstanceId: "server-intermediate-restart",
      at: 1_350,
      assignmentIds: ["fenced-manifest"],
    });

    // A same-shaped document with the wrong job ID must never free a target.
    store.queue(assignment("wrong-manifest-id", "wrong-manifest-target"));
    store.claimRunning("wrong-manifest-id", "server-before-restart", 1_400);

    let started = 0;
    let releaseReaders!: () => void;
    const readersReleased = new Promise<void>((resolve) => {
      releaseReaders = resolve;
    });
    let allReadersStarted!: () => void;
    const readersStarted = new Promise<void>((resolve) => {
      allReadersStarted = resolve;
    });
    const recovery = recoverDurableWorkerAssignments({
      store,
      workerInstanceId: "server-after-restart",
      at: 2_000,
      readManifest: async (id) => {
        started += 1;
        if (started === 5) allReadersStarted();
        await readersReleased;
        if (id === "manifest-after-crash" || id === "fenced-manifest") {
          return { id, status: "ok" };
        }
        if (id === "wrong-manifest-id") return { id: "another-job", status: "ok" };
        return null;
      },
    });

    await readersStarted;
    assert.equal(
      store.get("queued-before-dispatch")?.status,
      "queued",
      "no row is quarantined until all startup manifest checks have completed",
    );
    assert.equal(store.get("manifest-after-crash")?.status, "running");
    releaseReaders();

    const result = await recovery;
    assert.deepEqual(result.inspectedAssignmentIds.sort(), [
      "fenced-manifest",
      "interrupted",
      "manifest-after-crash",
      "queued-before-dispatch",
      "wrong-manifest-id",
    ]);
    assert.deepEqual(
      result.manifestFinalized.map((item) => [item.id, item.status, item.terminal?.reason]).sort(),
      [
        ["fenced-manifest", "ok", "committed-run-manifest"],
        ["manifest-after-crash", "ok", "committed-run-manifest"],
      ],
    );
    assert.deepEqual(
      result.recoveryRequired.map((item) => [item.id, item.terminal?.reason]).sort(),
      [
        ["interrupted", "server-restart-during-execution"],
        ["queued-before-dispatch", "server-restart-before-dispatch"],
        ["wrong-manifest-id", "server-restart-during-execution"],
      ],
    );

    const committed = store.get("manifest-after-crash");
    assert.equal(committed?.status, "ok");
    assert.equal(committed?.terminal?.reason, "committed-run-manifest");
    const interrupted = store.get("interrupted");
    assert.equal(interrupted?.status, "recovery-required");
    assert.equal(interrupted?.execution?.workerInstanceId, "server-before-restart");
    assert.equal(interrupted?.recoveryFenceRelease, undefined);
    const queued = store.get("queued-before-dispatch");
    assert.equal(queued?.status, "recovery-required");
    assert.equal(queued?.execution, undefined, "queued work must not reserve a recovery fence");

    // Manifest terminality frees its lane immediately; an uncertain in-flight
    // assignment continues to fence its target until independently reproven.
    store.queue(assignment("after-manifest", "manifest-target"));
    assert.equal(
      store.claimRunning("after-manifest", "server-after-restart", 2_100).status,
      "running",
    );
    store.queue(assignment("after-queued", "queued-target"));
    assert.equal(
      store.claimRunning("after-queued", "server-after-restart", 2_200).status,
      "running",
    );
    store.queue(assignment("after-interruption", "fenced-target"));
    assert.throws(
      () => store.claimRunning("after-interruption", "server-after-restart", 2_300),
      (error: unknown) =>
        error instanceof DurableWorkerAssignmentContentionError && error.scope === "target",
    );
  });
});
