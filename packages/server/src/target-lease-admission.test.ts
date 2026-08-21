import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  listDeviceLeases,
  releaseDeviceLease,
  resetControlDatabaseCache,
  runWithOperationContext,
  setOperationLease,
} from "@relay/core";
import type { DeviceLease } from "@relay/protocol";
import { admitTargetControl, assertTargetControl } from "./access-control.js";
import { acquireTargetLeasesAtomically } from "./target-lease-admission.js";
import { noteTargetLeaseControlUse } from "./target-lease-admission-state.js";
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
  operationId: "job.combine.start",
  requestId: "target-lease-admission-test",
  idempotencyKey: "target-lease-admission-test",
  issuedAt: 1,
};

function lease(targetId: string): DeviceLease {
  return {
    id: `lease:${targetId}`,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    poolId: "local",
    deviceSerial: targetId,
    ownerId: "human:qa",
    status: "leased",
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  };
}

async function withControlState(run: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-target-lease-admission-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  try {
    await run();
  } finally {
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
}

test("atomic target admission releases only newly minted leases when one target rejects", async () => {
  const released: Array<{ id: string; ownerId?: string }> = [];
  const result = runWithOperationContext(operation, () =>
    acquireTargetLeasesAtomically({
      scope,
      targetIds: ["android-a", "ios-b"],
      async listDeviceLeases() {
        return [];
      },
      async admitTargetControl(_scope, targetId) {
        if (targetId === "ios-b") throw new Error("iOS lease rejected");
        const accepted = lease(targetId ?? "missing");
        setOperationLease(accepted.id, accepted.ownerId);
        return { lease: accepted, createdByThisCall: true };
      },
      async releaseDeviceLease(id, releaseScope) {
        released.push({ id, ownerId: releaseScope?.ownerId });
        return lease("android-a");
      },
    }),
  );
  await assert.rejects(result, /iOS lease rejected/u);
  assert.deepEqual(released, [{ id: "lease:android-a", ownerId: "human:qa" }]);
});

test("overlapping admissions never release a lease minted by the first caller", async () => {
  let activeLeases: DeviceLease[] = [];
  const released: string[] = [];
  let firstControlStarted!: () => void;
  let allowFirstControl!: () => void;
  const firstControl = new Promise<void>((resolve) => {
    firstControlStarted = resolve;
  });
  const allowControl = new Promise<void>((resolve) => {
    allowFirstControl = resolve;
  });
  const runtime = {
    async listDeviceLeases() {
      return [...activeLeases];
    },
    async admitTargetControl(_scope: RequestContext, targetId?: string) {
      if (targetId === "android-a" && activeLeases.length === 0) {
        firstControlStarted();
        await allowControl;
        const accepted = lease("android-a");
        activeLeases = [accepted];
        setOperationLease(accepted.id, accepted.ownerId);
        return { lease: accepted, createdByThisCall: true };
      }
      if (targetId === "android-a") {
        const accepted = activeLeases[0];
        if (!accepted) throw new Error("expected first admission lease");
        setOperationLease(accepted.id, accepted.ownerId);
        return { lease: accepted, createdByThisCall: false };
      }
      throw new Error("second target rejected");
    },
    async releaseDeviceLease(id: string) {
      released.push(id);
      activeLeases = activeLeases.filter((item) => item.id !== id);
      return lease("released");
    },
  };
  const first = runWithOperationContext(
    { ...operation, requestId: "first", idempotencyKey: "first" },
    () =>
      acquireTargetLeasesAtomically({
        scope,
        targetIds: ["android-a"],
        ...runtime,
      }),
  );
  await firstControl;
  const second = runWithOperationContext(
    { ...operation, requestId: "second", idempotencyKey: "second" },
    () =>
      acquireTargetLeasesAtomically({
        scope,
        targetIds: ["android-a", "ios-b"],
        ...runtime,
      }),
  );
  allowFirstControl();
  const firstAdmission = await first;
  await assert.rejects(second, /second target rejected/u);
  assert.deepEqual(released, []);
  assert.deepEqual(
    activeLeases.map((item) => item.id),
    ["lease:android-a"],
  );
  await firstAdmission.commit();
  await firstAdmission.finalize();
});

test("the final uncommitted overlapping admission releases a lease minted by either caller", async () => {
  let active: DeviceLease | undefined;
  const released: string[] = [];
  const runtime = {
    async listDeviceLeases() {
      return active ? [active] : [];
    },
    async admitTargetControl(_scope: RequestContext, targetId?: string) {
      if (targetId !== "android-a") throw new Error("unexpected target");
      if (!active) {
        active = lease("android-a");
        setOperationLease(active.id, active.ownerId);
        return { lease: active, createdByThisCall: true };
      }
      setOperationLease(active.id, active.ownerId);
      return { lease: active, createdByThisCall: false };
    },
    async releaseDeviceLease(id: string) {
      released.push(id);
      if (active?.id === id) active = undefined;
      return lease("released");
    },
  };
  const first = await runWithOperationContext(
    { ...operation, requestId: "rollback-a", idempotencyKey: "rollback-a" },
    () => acquireTargetLeasesAtomically({ scope, targetIds: ["android-a"], ...runtime }),
  );
  const second = await runWithOperationContext(
    { ...operation, requestId: "rollback-b", idempotencyKey: "rollback-b" },
    () => acquireTargetLeasesAtomically({ scope, targetIds: ["android-a"], ...runtime }),
  );

  await first.rollback();
  assert.equal(active?.id, "lease:android-a");
  await second.rollback();
  assert.deepEqual(released, ["lease:android-a"]);
  assert.equal(active, undefined);
});

test("rollback retains a pending lease observed by non-campaign target control", async () => {
  let active: DeviceLease | undefined;
  const released: string[] = [];
  const admission = await runWithOperationContext(
    { ...operation, requestId: "external-control", idempotencyKey: "external-control" },
    () =>
      acquireTargetLeasesAtomically({
        scope,
        targetIds: ["android-a"],
        async listDeviceLeases() {
          return active ? [active] : [];
        },
        async admitTargetControl() {
          active = lease("android-a");
          setOperationLease(active.id, active.ownerId);
          return { lease: active, createdByThisCall: true };
        },
        async releaseDeviceLease(id: string) {
          released.push(id);
          active = undefined;
          return lease("released");
        },
      }),
  );

  // This is what a normal assertTargetControl/admitTargetControl call records
  // when it reuses the pending local-control lease outside the campaign.
  noteTargetLeaseControlUse("lease:android-a");
  await admission.rollback();
  assert.deepEqual(released, []);
  assert.equal(active?.id, "lease:android-a");
});

test("ordinary control waits until a new campaign lease is tracked before it can reuse it", async () => {
  await withControlState(async () => {
    let signalCreated!: () => void;
    let allowAdmissionToReturn!: () => void;
    const created = new Promise<void>((resolve) => {
      signalCreated = resolve;
    });
    const allowReturn = new Promise<void>((resolve) => {
      allowAdmissionToReturn = resolve;
    });
    const first = runWithOperationContext(
      { ...operation, requestId: "race-first", idempotencyKey: "race-first" },
      () =>
        acquireTargetLeasesAtomically({
          scope,
          targetIds: ["race-pixel"],
          listDeviceLeases,
          releaseDeviceLease,
          async admitTargetControl(controlScope, targetId) {
            const accepted = await admitTargetControl(controlScope, targetId);
            signalCreated();
            await allowReturn;
            return accepted;
          },
        }),
    );
    await created;

    let externalSettled = false;
    const external = runWithOperationContext(
      { ...operation, requestId: "race-external", idempotencyKey: "race-external" },
      async () => {
        const accepted = await assertTargetControl(scope, "race-pixel");
        externalSettled = true;
        return accepted;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(externalSettled, false, "ordinary control must wait for admission tracking");

    allowAdmissionToReturn();
    const admission = await first;
    const externalLease = await external;
    assert.equal(externalLease.id, admission.leasesByTargetId.get("race-pixel")?.id);

    await admission.rollback();
    assert.equal(
      (await listDeviceLeases(scope.projectId)).some((item) => item.id === externalLease.id),
      true,
      "rollback must retain a lease already observed by ordinary control",
    );
  });
});

test("a durable campaign commit remains compensable until scheduler dispatch finalizes it", async () => {
  const released: string[] = [];
  const admission = await runWithOperationContext(
    { ...operation, requestId: "commit-then-rollback", idempotencyKey: "commit-then-rollback" },
    () =>
      acquireTargetLeasesAtomically({
        scope,
        targetIds: ["commit-pixel"],
        async listDeviceLeases() {
          return [];
        },
        async admitTargetControl() {
          const accepted = lease("commit-pixel");
          setOperationLease(accepted.id, accepted.ownerId);
          return { lease: accepted, createdByThisCall: true };
        },
        async releaseDeviceLease(id: string) {
          released.push(id);
          return lease("released");
        },
      }),
  );

  await admission.commit();
  await admission.rollback();
  assert.deepEqual(released, ["lease:commit-pixel"]);
});
