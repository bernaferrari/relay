import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  currentDurableWorkerInstanceId,
  DurableWorkerAssignmentStore,
  RelayStateDirectoryInUseError,
  durableWorkerAssignmentsPath,
  resetDurableWorkerAssignmentStoreForTests,
  runsRoot,
} from "@relay/core";
import { startServer } from "./index.js";

test("server startup marks pre-existing worker assignments recovery-required", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-durable-worker-startup-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const path = durableWorkerAssignmentsPath(root);
  const store = new DurableWorkerAssignmentStore(path);
  store.queue({
    id: "queued-before-startup",
    projectId: "project-startup",
    executionTarget: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "emulator-5554",
      platform: "android",
      identity: { kind: "device-serial", value: "emulator-5554" },
    },
    lane: { workerId: "local:android:target:emulator-5554", capacity: 1 },
    queuedAt: 1_000,
  });
  store.queue({
    id: "manifest-before-startup",
    projectId: "project-startup",
    executionTarget: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "emulator-5556",
      platform: "android",
      identity: { kind: "device-serial", value: "emulator-5556" },
    },
    lane: { workerId: "local:android:target:emulator-5556", capacity: 1 },
    queuedAt: 1_000,
  });
  store.claimRunning("manifest-before-startup", "server-before-startup", 1_100);
  store.close();
  // The normal server test environment deliberately separates the durable
  // state directory from immutable run manifests. Write the completed
  // manifest where startup recovery actually reads it rather than assuming
  // the production-default `${RELAY_STATE_DIR}/runs` layout.
  const manifestDirectory = join(runsRoot(), "manifest-before-startup");
  const manifest = JSON.stringify({
    schemaVersion: 5,
    id: "manifest-before-startup",
    status: "ok",
  });
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(join(manifestDirectory, "run.json"), manifest);
  await writeFile(
    join(manifestDirectory, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id: "manifest-before-startup",
      digest: createHash("sha256").update(manifest).digest("hex"),
    }),
  );
  resetDurableWorkerAssignmentStoreForTests();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer({ host: "127.0.0.1", port: 0 });
    const reopened = new DurableWorkerAssignmentStore(path);
    try {
      const assignment = reopened.get("queued-before-startup");
      assert.equal(assignment?.status, "recovery-required");
      assert.equal(assignment?.terminal?.reason, "server-restart-before-dispatch");
      const committed = reopened.get("manifest-before-startup");
      assert.equal(committed?.status, "ok");
      assert.equal(committed?.terminal?.reason, "committed-run-manifest");
    } finally {
      reopened.close();
    }
  } finally {
    await server?.close();
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("same-process restart rotates worker ownership before recovering live work", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-durable-worker-live-peer-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const path = durableWorkerAssignmentsPath(root);
  resetDurableWorkerAssignmentStoreForTests();
  let first: Awaited<ReturnType<typeof startServer>> | undefined;
  let restarted: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    first = await startServer({ host: "127.0.0.1", port: 0 });
    const firstWorkerInstanceId = currentDurableWorkerInstanceId();
    const store = new DurableWorkerAssignmentStore(path);
    try {
      store.queue({
        id: "live-peer-assignment",
        projectId: "project-live-peer",
        executionTarget: {
          schemaVersion: 1,
          kind: "local-device",
          provider: { key: "relay.local.agent-device", scope: "local" },
          targetId: "emulator-5560",
          platform: "android",
          identity: { kind: "device-serial", value: "emulator-5560" },
        },
        lane: { workerId: "local:android:target:emulator-5560", capacity: 1 },
        queuedAt: 2_000,
      });
      store.claimRunning("live-peer-assignment", firstWorkerInstanceId, 2_100);
    } finally {
      store.close();
    }

    await assert.rejects(
      startServer({ host: "127.0.0.1", port: 0 }),
      (error: unknown) =>
        error instanceof RelayStateDirectoryInUseError &&
        error.code === "RELAY_STATE_DIRECTORY_IN_USE",
    );
    const afterRejectedStart = new DurableWorkerAssignmentStore(path);
    try {
      assert.equal(afterRejectedStart.get("live-peer-assignment")?.status, "running");
    } finally {
      afterRejectedStart.close();
    }

    await first.close();
    first = undefined;
    restarted = await startServer({ host: "127.0.0.1", port: 0 });
    assert.notEqual(currentDurableWorkerInstanceId(), firstWorkerInstanceId);
    const recovered = new DurableWorkerAssignmentStore(path);
    try {
      const assignment = recovered.get("live-peer-assignment");
      assert.equal(assignment?.status, "recovery-required");
      assert.equal(assignment?.terminal?.reason, "server-restart-during-execution");
    } finally {
      recovered.close();
    }
  } finally {
    await restarted?.close();
    await first?.close();
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
