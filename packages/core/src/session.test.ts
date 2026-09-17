import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JobRegistry } from "./job-registry.js";
import { leaseDevice } from "./collaboration.js";
import {
  durableWorkerAssignmentStore,
  resetDurableWorkerAssignmentStoreForTests,
} from "./durable-worker-assignments.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import { runWithOperationContext } from "./operation-context.js";
import type { Device } from "./device.js";
import type { RecipeRuntimeState, VerifiedScreenCheckpoint } from "./recipe-runner-context.js";
import { captureAutomaticState, enqueueJob, waitForJobCompletion } from "./session.js";
import type { TestJob } from "./session-contract.js";
import { runWithTargetContext } from "./target-context.js";
import type { TraceStep } from "./trace.js";
import { attachScreenshotPayload, type ScreenshotPayload } from "./workspace-capture.js";

type RegistryJob = {
  id: string;
  status: "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";
  persisted?: boolean;
};

for (const count of [101, 200, 500]) {
  test(`retains all ${count} queued jobs until they become terminal`, () => {
    const registry = new JobRegistry<RegistryJob>(100);
    const jobs = Array.from({ length: count }, (_, index): RegistryJob => ({
      id: `job-${index}`,
      status: "queued",
    }));
    for (const job of jobs) registry.remember(job);

    assert.equal(registry.size, count);
    assert.equal(registry.list(count).length, count);
    assert.equal(registry.listAll().length, count);
    assert.ok(jobs.every((job) => registry.get(job.id) === job));

    const cancellable = registry.get("job-0");
    assert.ok(cancellable);
    cancellable.status = "cancelled";
    registry.pruneTerminalHistory();
    assert.equal(registry.get(cancellable.id), cancellable, "unpersisted cancellation is retained");

    for (const job of jobs) {
      job.status = "cancelled";
      job.persisted = true;
      registry.pruneTerminalHistory();
    }
    assert.equal(registry.size, Math.min(count, 100));
    assert.ok(registry.get(jobs.at(-1)!.id), "newest terminal job remains in history");
    if (count > 100) assert.equal(registry.get(jobs[0]!.id), undefined);
  });
}

test("bounds persisted terminal history without evicting active work", () => {
  const registry = new JobRegistry<RegistryJob>(100);
  const running: RegistryJob = { id: "running", status: "running" };
  registry.remember(running);
  for (let index = 0; index < 500; index += 1) {
    registry.remember({ id: `terminal-${index}`, status: "ok", persisted: true });
  }

  assert.equal(registry.size, 101, "the active job sits outside the terminal history bound");
  assert.equal(registry.get(running.id), running);
  assert.equal(registry.get("terminal-0"), undefined);
  assert.ok(registry.get("terminal-499"));
});

test("retains terminal jobs until persistence succeeds", () => {
  const registry = new JobRegistry<RegistryJob>(2);
  const failedWrite: RegistryJob = { id: "failed-write", status: "error" };
  registry.remember(failedWrite);
  registry.remember({ id: "durable-1", status: "ok", persisted: true });
  registry.remember({ id: "durable-2", status: "ok", persisted: true });

  assert.equal(registry.get(failedWrite.id), failedWrite);
  assert.equal(registry.size, 2);
  failedWrite.persisted = true;
  registry.remember({ id: "durable-3", status: "ok", persisted: true });
  assert.equal(registry.size, 2);
  assert.equal(registry.get(failedWrite.id), undefined);
});

test("automatic evidence reuses one verified tree and raster without device latency", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-observation-cache-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    let snapshots = 0;
    let screenshots = 0;
    const device = {
      capture: {
        snapshot: async () => {
          snapshots += 1;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          return { nodes: [] };
        },
        screenshot: async () => {
          screenshots += 1;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          return { base64: Buffer.from("unexpected").toString("base64") };
        },
      },
    } as unknown as Device;
    const nodes = [
      {
        role: "button",
        label: "Continue",
        hittable: true,
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
    ];
    const raster = Buffer.from("one exact raster").toString("base64");
    const checkpoint: VerifiedScreenCheckpoint = {
      screenId: "source",
      screenTitle: "Source",
      nodes,
      observedAt: 123,
      verifiedAt: 123,
      screenshot: {
        capturedAt: 124,
        mime: "image/png",
        base64: raster,
        path: join(root, "ephemeral.png"),
        bytes: Buffer.byteLength(raster, "base64"),
      },
    };
    const runtime: RecipeRuntimeState = {
      navigationCursor: {
        status: "proven",
        screenId: checkpoint.screenId,
        proofToken: "test:source:123",
        source: "screen-observation",
        updatedAt: checkpoint.verifiedAt,
        checkpoint,
      },
    };
    const job = {
      id: "observation-cache",
      action: "test",
      platform: "android",
      queuedAt: Date.now(),
      artifacts: [],
      frames: [],
    } as unknown as TestJob;
    const step = {
      id: "tap-source",
      title: "Tap Continue",
      frames: [],
      glyphs: [],
    } as unknown as TraceStep;

    await captureAutomaticState(job, device, step, "before", () => {}, runtime);

    assert.equal(snapshots, 0);
    assert.equal(screenshots, 0);
    assert.deepEqual(
      job.artifacts.map((artifact) => [artifact.kind, artifact.capturedAt]),
      [["ui-tree", 123]],
    );
    assert.equal(job.frames.length, 1);
    assert.equal(step.frames.length, 1);
    assert.equal(step.frames[0]?.path, job.frames[0]?.path);
  } finally {
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("an ephemeral screenshot payload attaches exactly once", async () => {
  const payload: ScreenshotPayload = {
    capturedAt: 1,
    mime: "image/png",
    base64: Buffer.from("one raster").toString("base64"),
    path: "/tmp/one-raster.png",
    bytes: 10,
  };
  let attachments = 0;
  const attach = async () => {
    attachments += 1;
    return { path: "frames/0001.png" };
  };

  await Promise.all([
    attachScreenshotPayload(payload, "job-1", "Destination", attach),
    attachScreenshotPayload(payload, "job-1", "Destination repeated", attach),
  ]);
  await attachScreenshotPayload(payload, "job-1", "Destination later", attach);

  assert.equal(attachments, 1);
  assert.equal(payload.jobId, "job-1");
  assert.equal(payload.framePath, "frames/0001.png");
});

test("a rejected screenshot attachment is not retried", async () => {
  const payload: ScreenshotPayload = {
    capturedAt: 1,
    mime: "image/png",
    base64: Buffer.from("rejected raster").toString("base64"),
    path: "/tmp/rejected-raster.png",
    bytes: 15,
  };
  let attachments = 0;
  const attach = async (): Promise<never> => {
    attachments += 1;
    throw new Error("attachment rejected");
  };

  await assert.rejects(
    attachScreenshotPayload(payload, "job-2", "Rejected", attach),
    /attachment rejected/,
  );
  await assert.rejects(
    attachScreenshotPayload(payload, "job-2", "Rejected again", attach),
    /attachment rejected/,
  );
  assert.equal(attachments, 1);
  assert.equal(payload.framePath, undefined);
});

test("automatic failure evidence captures a fresh tree and raster after invalidation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-observation-failure-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    let snapshots = 0;
    let screenshots = 0;
    const freshNodes = [{ role: "heading", label: "Failure destination" }];
    const device = {
      capture: {
        snapshot: async () => {
          snapshots += 1;
          return { nodes: freshNodes };
        },
        screenshot: async ({ path }: { path: string }) => {
          screenshots += 1;
          const { writeFile } = await import("node:fs/promises");
          await writeFile(path, Buffer.from("fresh failure raster"));
          return {};
        },
      },
    } as unknown as Device;
    const job = {
      id: "observation-failure",
      action: "test",
      platform: "android",
      queuedAt: Date.now(),
      artifacts: [],
      frames: [],
    } as unknown as TestJob;
    const step = {
      id: "failed-tap",
      title: "Failed tap",
      frames: [],
      glyphs: [],
    } as unknown as TraceStep;

    const logs: string[] = [];
    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "observation-failure" },
      () => captureAutomaticState(job, device, step, "after", (line) => logs.push(line), {}),
    );

    assert.equal(snapshots, 1, logs.join("; "));
    assert.equal(screenshots, 1, logs.join("; "));
    const treeArtifact = job.artifacts.find((artifact) => artifact.kind === "ui-tree");
    assert.ok(treeArtifact, "fresh failure evidence includes a UI-tree artifact");
    assert.deepEqual((treeArtifact.data as { nodes: unknown }).nodes, freshNodes);
    assert.equal(job.frames.length, 1);
    assert.equal(step.frames.length, 1);
  } finally {
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("an expired frozen lease fails before device execution starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-session-lease-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  try {
    const jobs = [];
    for (let index = 0; index < 20; index += 1) {
      const serial = `unreachable-device-${index}`;
      const lease = await leaseDevice({
        projectId: "project-a",
        poolId: "local",
        deviceSerial: serial,
        ownerId: "agent:runner",
        expiresAt: Date.now() - 1,
      });
      jobs.push(
        runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "agent:runner",
            actorKind: "agent",
            organizationId: "org-a",
            projectId: "project-a",
            operationId: "job.start",
            requestId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            issuedAt: Date.now(),
            leaseId: lease.id,
          },
          () =>
            enqueueJob({
              recipe: "lease-preflight",
              serial,
              platform: "android",
              projectId: "project-a",
              ownerId: "agent:runner",
              recipeSnapshot: {
                id: "lease-preflight",
                title: "Lease preflight",
                source: "builtin",
                steps: [],
                createdAt: 1,
                updatedAt: 1,
              },
              recipeGraph: {},
            }),
        ),
      );
    }

    const completed = await Promise.all(jobs.map((job) => waitForJobCompletion(job.id)));
    for (const terminal of completed) {
      assert.equal(terminal.status, "error");
      assert.equal(terminal.error, "Job control lease is no longer valid");
      assert.equal(terminal.persisted, true, "completion includes durable run persistence");
      assert.equal(
        terminal.logs.some((line) => line.includes("device missing")),
        false,
        "device discovery never became the failure path",
      );
      const assignment = durableWorkerAssignmentStore().get(terminal.id);
      assert.equal(assignment?.status, "error");
      assert.equal(assignment?.terminal?.reason, "job-finished");
      assert.equal(assignment?.execution?.workerInstanceId.includes("relay:"), true);
    }
  } finally {
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("an unregistered provider session is rejected before durable queueing or any local device session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-provider-session-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  resetDurableWorkerAssignmentStoreForTests();
  try {
    let localFactoryCalls = 0;
    setLocalDeviceProvider({
      kind: "device",
      create: () => {
        localFactoryCalls += 1;
        throw new Error("provider admission must never create a local device");
      },
    });
    assert.throws(
      () =>
        runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "agent:provider-test",
            actorKind: "agent",
            organizationId: "org-provider-test",
            projectId: "project-provider-test",
            operationId: "job.start",
            requestId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            issuedAt: Date.now(),
          },
          () =>
            enqueueJob({
              recipe: "provider-driver-required",
              executionTarget: {
                schemaVersion: 1,
                kind: "provider-session",
                provider: { key: "example.device-farm", scope: "remote" },
                targetId: "ios-session-42",
                platform: "ios",
                identity: { kind: "provider-session", value: "ios-session-42" },
              },
              targetKind: "device",
              platform: "ios",
              projectId: "project-provider-test",
              ownerId: "agent:provider-test",
              recipeSnapshot: {
                id: "provider-driver-required",
                title: "Provider driver required",
                source: "builtin",
                steps: [],
                createdAt: 1,
                updatedAt: 1,
              },
              recipeGraph: {},
            }),
        ),
      /Target driver example\.device-farm cannot control.*not-configured/u,
    );
    assert.equal(localFactoryCalls, 0);
    assert.deepEqual(
      durableWorkerAssignmentStore().list(),
      [],
      "capability rejection happens before any durable provider assignment is written",
    );
  } finally {
    setLocalDeviceProvider(undefined);
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});
