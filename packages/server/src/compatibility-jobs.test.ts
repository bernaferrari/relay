import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  resetControlDatabaseCache,
  runWithOperationContext,
  saveCompatibilityMatrix,
  saveRecipe,
  setOperationLease,
  type ListedDevice,
  type TestJob,
} from "@relay/core";
import type { DeviceLease } from "@relay/protocol";
import { enqueueCompatibilityBatch, type CompatibilityBatchRuntime } from "./compatibility-jobs.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "human:qa",
  organizationId: "acme",
  projectId: "mobile",
  allowedProjects: ["mobile"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

const operation = {
  schemaVersion: 1 as const,
  actorId: "human:qa",
  actorKind: "human" as const,
  organizationId: scope.organizationId,
  projectId: scope.projectId,
  operationId: "job.start",
  requestId: "compatibility-parallel-test",
  idempotencyKey: "compatibility-parallel-test",
  issuedAt: 1,
};

const campaignOptions = { kind: "compatibility" as const, maxRepetitions: 3, maxJobs: 20 };

function devices(): ListedDevice[] {
  return [
    {
      id: "android-1",
      serial: "android-1",
      name: "Pixel",
      kind: "emulator",
      booted: true,
      platform: "android",
    },
    {
      id: "ios-1",
      serial: "ios-1",
      name: "iPhone",
      kind: "device",
      booted: true,
      platform: "ios",
    },
  ];
}

function lease(targetId: string, ownerId = `owner:${targetId}`): DeviceLease {
  return {
    id: `lease:${targetId}`,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    poolId: `pool:${targetId}`,
    deviceSerial: targetId,
    ownerId,
    status: "leased",
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return {
    promise: new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }),
    resolve,
    reject,
  };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function withCampaignFixture<T>(run: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "relay-compatibility-jobs-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousTests = process.env.RELAY_TESTS_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  resetControlDatabaseCache();
  try {
    await saveRecipe({
      id: "compatibility-smoke",
      expectedRevision: 0,
      title: "Compatibility smoke",
      steps: [{ kind: "script", source: "assert true" }],
    });
    await saveCompatibilityMatrix({
      id: "mobile-pair",
      projectId: scope.projectId,
      name: "Android and iOS",
      selectors: [{ targetIds: ["android-1", "ios-1"] }],
    });
    return await run();
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousTests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previousTests;
    await rm(root, { recursive: true, force: true });
  }
}

function baseRuntime(): Pick<
  CompatibilityBatchRuntime,
  "listDevices" | "listTargets" | "listDevicePools" | "listDeviceLeases"
> {
  return {
    async listDevices() {
      return devices();
    },
    async listTargets() {
      return [];
    },
    async listDevicePools() {
      return [];
    },
    async listDeviceLeases() {
      return [];
    },
  };
}

test("admits Android and iOS targets concurrently while preserving target lease provenance", async () => {
  await withCampaignFixture(async () => {
    const android = deferred<DeviceLease>();
    const ios = deferred<DeviceLease>();
    const admissions: string[] = [];
    const result = runWithOperationContext(operation, () =>
      enqueueCompatibilityBatch(
        scope,
        { recipe: "compatibility-smoke", matrixId: "mobile-pair" },
        campaignOptions,
        {
          ...baseRuntime(),
          async admitTargetControl(_scope, targetId) {
            if (!targetId) throw new Error("target id is required");
            admissions.push(targetId);
            const targetLease =
              targetId === "android-1" ? await android.promise : await ios.promise;
            setOperationLease(targetLease.id, targetLease.ownerId);
            return { lease: targetLease, createdByThisCall: true };
          },
          async releaseDeviceLease() {
            throw new Error("successful admissions must not release a lease");
          },
        },
      ),
    );

    await waitFor(() => admissions.length === 2, "both independent target admissions");
    assert.deepEqual([...admissions].sort(), ["android-1", "ios-1"]);

    ios.resolve(lease("ios-1"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    android.resolve(lease("android-1"));
    const batch = await result;
    assert.deepEqual(
      batch.jobs.map((job) => job.serial),
      ["android-1", "ios-1"],
    );
    assert.deepEqual(
      batch.jobs.map((job) => ({
        targetId: job.serial,
        leaseId: job.operationContext?.leaseId,
        leaseOwnerId: job.operationContext?.leaseOwnerId,
      })),
      [
        {
          targetId: "android-1",
          leaseId: "lease:android-1",
          leaseOwnerId: "owner:android-1",
        },
        { targetId: "ios-1", leaseId: "lease:ios-1", leaseOwnerId: "owner:ios-1" },
      ],
    );
  });
});

test("a failed target admission rolls back leases minted for other targets before queueing", async () => {
  await withCampaignFixture(async () => {
    const androidAdmission = deferred<DeviceLease>();
    const admissions: string[] = [];
    const activeLeaseIds = new Set<string>();
    const released: Array<{ id: string; ownerId?: string }> = [];

    const batch = runWithOperationContext(operation, () =>
      enqueueCompatibilityBatch(
        scope,
        { recipe: "compatibility-smoke", matrixId: "mobile-pair" },
        campaignOptions,
        {
          ...baseRuntime(),
          async admitTargetControl(_scope, targetId) {
            if (!targetId) throw new Error("target id is required");
            admissions.push(targetId);
            if (targetId === "ios-1") throw new Error("iOS lease rejected");
            const targetLease = await androidAdmission.promise;
            activeLeaseIds.add(targetLease.id);
            setOperationLease(targetLease.id, targetLease.ownerId);
            return { lease: targetLease, createdByThisCall: true };
          },
          async releaseDeviceLease(id, releaseScope) {
            released.push({ id, ownerId: releaseScope?.ownerId });
            activeLeaseIds.delete(id);
            return lease("android-1");
          },
        },
      ),
    );
    await waitFor(() => admissions.length === 2, "the accepted and rejected admissions");
    assert.deepEqual([...admissions].sort(), ["android-1", "ios-1"]);

    androidAdmission.resolve(lease("android-1"));
    await assert.rejects(batch, /iOS lease rejected/u);
    assert.deepEqual(activeLeaseIds, new Set());
    assert.deepEqual(released, [{ id: "lease:android-1", ownerId: "owner:android-1" }]);
  });
});

test("a failed target admission does not release an existing caller lease", async () => {
  await withCampaignFixture(async () => {
    const existing = lease("android-1", "existing-owner");
    const released: string[] = [];

    await assert.rejects(
      runWithOperationContext(operation, () =>
        enqueueCompatibilityBatch(
          scope,
          { recipe: "compatibility-smoke", matrixId: "mobile-pair" },
          campaignOptions,
          {
            ...baseRuntime(),
            async listDeviceLeases() {
              return [existing];
            },
            async admitTargetControl(_scope, targetId) {
              if (targetId === "ios-1") throw new Error("iOS lease rejected");
              setOperationLease(existing.id, existing.ownerId);
              return { lease: existing, createdByThisCall: false };
            },
            async releaseDeviceLease(id) {
              released.push(id);
              return existing;
            },
          },
        ),
      ),
      /iOS lease rejected/u,
    );
    assert.deepEqual(released, []);
  });
});

test("a staged compatibility activation failure releases only new leases before dispatch", async () => {
  await withCampaignFixture(async () => {
    const released: string[] = [];
    const calls = { activate: 0, dispatch: 0, rollback: 0 };

    await assert.rejects(
      runWithOperationContext(operation, () =>
        enqueueCompatibilityBatch(
          scope,
          { recipe: "compatibility-smoke", matrixId: "mobile-pair" },
          campaignOptions,
          {
            ...baseRuntime(),
            async admitTargetControl(_scope, targetId) {
              if (!targetId) throw new Error("target id is required");
              const targetLease = lease(targetId);
              setOperationLease(targetLease.id, targetLease.ownerId);
              return { lease: targetLease, createdByThisCall: targetId === "android-1" };
            },
            async releaseDeviceLease(id) {
              released.push(id);
              return lease("released");
            },
            prepareJobBatch(inputs) {
              assert.equal(inputs.length, 2);
              return {
                jobs: inputs.map(
                  (item, index) =>
                    ({ id: `staged:${index}`, serial: item.input.serial }) as TestJob,
                ),
                activate() {
                  calls.activate += 1;
                  throw new Error("injected staged compatibility activation failure");
                },
                dispatch() {
                  calls.dispatch += 1;
                  return [];
                },
                commit() {
                  return [];
                },
                rollback() {
                  calls.rollback += 1;
                },
              };
            },
          },
        ),
      ),
      /injected staged compatibility activation failure/u,
    );

    assert.deepEqual(released, ["lease:android-1"]);
    assert.deepEqual(calls, { activate: 1, dispatch: 0, rollback: 1 });
  });
});
