import assert from "node:assert/strict";
import test from "node:test";
import {
  TargetWorkerScheduler,
  defaultTargetWorkerAssignment,
  localExecutionTargetRef,
  runWithOperationContext,
  setOperationLease,
} from "@relay/core";
import type { PreparedAppMapCombineCell } from "@relay/core";
import type { DeviceLease, LocalCampaignCapacityPreflight } from "@relay/protocol";
import { HttpError } from "./http.js";
import { admitAndStageLocalCombineCampaign } from "./local-combine-campaign-admission.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "human:planner",
  organizationId: "acme",
  projectId: "mobile",
  allowedProjects: ["mobile"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

const operation = {
  schemaVersion: 1 as const,
  actorId: "human:planner",
  actorKind: "human" as const,
  organizationId: scope.organizationId,
  projectId: scope.projectId,
  operationId: "job.combine.start",
  requestId: "combine-admission-affinity-test",
  idempotencyKey: "combine-admission-affinity-test",
  issuedAt: 1,
};

function cell(
  cellId: string,
  target: ReturnType<typeof localExecutionTargetRef>,
): PreparedAppMapCombineCell {
  return { cellId, executionTarget: target } as PreparedAppMapCombineCell;
}

function currentDuration(workItemDurationMs: number) {
  return {
    workItemDurationMs,
    provenance: "observed-p95" as const,
    observedAt: 1_000,
    sampleCount: 20,
    maxAgeMs: 60_000,
  };
}

function runtimeFor(targets: Array<{ targetId: string; platform: "android" | "ios" }>) {
  return {
    async listDevices() {
      return targets.map((target) => ({
        id: target.targetId,
        serial: target.targetId,
        name: target.targetId,
        kind: "Physical device",
        booted: true,
        platform: target.platform,
      }));
    },
    async listDeviceLeases() {
      return [];
    },
    listTargetWorkers() {
      return targets.map((target) => ({
        workerId: `local:${target.platform}:target:${target.targetId}`,
        capacity: 1,
        active: 0,
        queued: 0,
        activeTargets: [],
        queuedTargets: [],
      }));
    },
    async assertTargetControl() {
      throw new Error("an infeasible admission must not acquire a lease");
    },
    async admitTargetControl() {
      throw new Error("an infeasible admission must not acquire a lease");
    },
    async releaseDeviceLease() {
      throw new Error("an infeasible admission must not release a lease");
    },
  };
}

function preflights(error: HttpError): LocalCampaignCapacityPreflight[] {
  return (error.body?.targetPreflights ?? []) as LocalCampaignCapacityPreflight[];
}

test("target-affine admission rejects a deadline that pooled Android capacity would accept", async () => {
  const pixel = localExecutionTargetRef({ targetId: "pixel-a", platform: "android" });
  const tablet = localExecutionTargetRef({ targetId: "tablet-b", platform: "android" });
  const result = runWithOperationContext(operation, () =>
    admitAndStageLocalCombineCampaign({
      scope,
      cells: [cell("a-1", pixel), cell("a-2", pixel), cell("a-3", pixel), cell("b-1", tablet)],
      request: { deadlineMs: 2_000, duration: currentDuration(1_000) },
      runtime: runtimeFor([
        { targetId: "pixel-a", platform: "android" },
        { targetId: "tablet-b", platform: "android" },
      ]),
      at: 1_000,
      stage() {
        throw new Error("infeasible admission must not stage work");
      },
    }),
  );
  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE");
    const aggregate = error.body?.preflight as LocalCampaignCapacityPreflight;
    assert.equal(aggregate.deadline.achievableWithCurrentCapacity, true);
    const pixelPreflight = preflights(error).find(
      (preflight) => preflight.input.targets[0]?.targetId === "pixel-a",
    );
    assert.equal(pixelPreflight?.deadline.achievableWithCurrentCapacity, false);
    return true;
  });
});

test("mixed-platform admission uses the iOS timing bound rather than Android timing", async () => {
  const android = localExecutionTargetRef({ targetId: "pixel-a", platform: "android" });
  const ios = localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" });
  const result = runWithOperationContext(operation, () =>
    admitAndStageLocalCombineCampaign({
      scope,
      cells: [cell("android", android), cell("ios", ios)],
      request: {
        deadlineMs: 2_000,
        duration: currentDuration(10_000),
        durationsByPlatform: {
          android: currentDuration(1_000),
          ios: currentDuration(10_000),
        },
      },
      runtime: runtimeFor([
        { targetId: "pixel-a", platform: "android" },
        { targetId: "ipad-b", platform: "ios" },
      ]),
      at: 1_000,
      stage() {
        throw new Error("infeasible admission must not stage work");
      },
    }),
  );
  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE");
    const androidPreflight = preflights(error).find(
      (preflight) => preflight.input.targets[0]?.platform === "android",
    );
    const iosPreflight = preflights(error).find(
      (preflight) => preflight.input.targets[0]?.platform === "ios",
    );
    assert.equal(androidPreflight?.deadline.achievableWithCurrentCapacity, true);
    assert.equal(iosPreflight?.deadline.achievableWithCurrentCapacity, false);
    return true;
  });
});

test("same-target deadline admission holds capacity facts through scheduler staging", async () => {
  const target = localExecutionTargetRef({ targetId: "pixel-a", platform: "android" });
  const scheduler = new TargetWorkerScheduler();
  const admittedLease: DeviceLease = {
    id: "lease:pixel-a",
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    poolId: "local",
    deviceSerial: "pixel-a",
    ownerId: "human:planner",
    status: "leased",
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  };
  let workerFactReads = 0;
  let controlAdmissions = 0;
  let releaseFirstStage!: () => void;
  let signalFirstStage!: () => void;
  const firstStageEntered = new Promise<void>((resolve) => {
    signalFirstStage = resolve;
  });
  const allowFirstStage = new Promise<void>((resolve) => {
    releaseFirstStage = resolve;
  });
  const runtime = {
    async listDevices() {
      return [
        {
          id: "pixel-a",
          serial: "pixel-a",
          name: "pixel-a",
          kind: "Physical device",
          booted: true,
          platform: "android" as const,
        },
      ];
    },
    async listDeviceLeases() {
      return [];
    },
    listTargetWorkers() {
      workerFactReads += 1;
      return scheduler.statuses();
    },
    async assertTargetControl() {
      throw new Error("local admission should use exact target admission");
    },
    async admitTargetControl() {
      controlAdmissions += 1;
      setOperationLease(admittedLease.id, admittedLease.ownerId);
      return { lease: admittedLease, createdByThisCall: true };
    },
    async releaseDeviceLease() {
      return admittedLease;
    },
  };
  const first = runWithOperationContext(
    { ...operation, requestId: "staging-first", idempotencyKey: "staging-first" },
    () =>
      admitAndStageLocalCombineCampaign({
        scope,
        cells: [cell("first", target)],
        request: { deadlineMs: 1_000, duration: currentDuration(100) },
        runtime,
        at: 1_000,
        async stage() {
          const staged = scheduler.stageBatch([
            {
              id: "first-staged-cell",
              ...defaultTargetWorkerAssignment({ targetId: "pixel-a", platform: "android" }),
              run: async () => undefined,
            },
          ]);
          signalFirstStage();
          await allowFirstStage;
          return staged;
        },
      }),
  );
  await firstStageEntered;

  let secondStageCalled = false;
  const second = runWithOperationContext(
    { ...operation, requestId: "staging-second", idempotencyKey: "staging-second" },
    () =>
      admitAndStageLocalCombineCampaign({
        scope,
        cells: [cell("second", target)],
        request: { deadlineMs: 1_000, duration: currentDuration(100) },
        runtime,
        at: 1_000,
        stage() {
          secondStageCalled = true;
          throw new Error("second stage must not be reached");
        },
      }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(workerFactReads, 1, "second preflight must wait for first scheduler staging");

  releaseFirstStage();
  const firstResult = await first;
  try {
    await assert.rejects(second, (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE");
      return true;
    });
    assert.equal(secondStageCalled, false);
    assert.equal(
      controlAdmissions,
      1,
      "second request must reject before reusing the target lease",
    );
  } finally {
    firstResult.staged.rollback();
    await firstResult.admission.rollback();
  }
});

test("a staged iOS target reserves its shared host before another target is admitted", async () => {
  const previousHostCapacity = process.env.RELAY_IOS_HOST_CAPACITY;
  process.env.RELAY_IOS_HOST_CAPACITY = "1";
  const scheduler = new TargetWorkerScheduler();
  const releases: string[] = [];
  const leasesById = new Map<string, DeviceLease>();
  let controlAdmissions = 0;
  const runtime = {
    async listDevices() {
      return [
        {
          id: "ipad-a",
          serial: "ipad-a",
          name: "ipad-a",
          kind: "Physical device",
          booted: true,
          platform: "ios" as const,
        },
        {
          id: "ipad-b",
          serial: "ipad-b",
          name: "ipad-b",
          kind: "Physical device",
          booted: true,
          platform: "ios" as const,
        },
      ];
    },
    async listDeviceLeases() {
      return [];
    },
    listTargetWorkers() {
      return scheduler.statuses();
    },
    async assertTargetControl() {
      throw new Error("local admission should use exact target admission");
    },
    async admitTargetControl(_scope: RequestContext, targetId?: string) {
      if (!targetId) throw new Error("test target admission requires a target id");
      controlAdmissions += 1;
      const lease: DeviceLease = {
        id: `lease:${targetId}`,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        poolId: "local",
        deviceSerial: targetId,
        ownerId: "human:planner",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      };
      leasesById.set(lease.id, lease);
      setOperationLease(lease.id, lease.ownerId);
      return { lease, createdByThisCall: true };
    },
    async releaseDeviceLease(leaseId: string) {
      releases.push(leaseId);
      const lease = leasesById.get(leaseId);
      if (!lease) throw new Error(`unknown test lease ${leaseId}`);
      return { ...lease, status: "released" as const };
    },
  };

  try {
    const first = await runWithOperationContext(
      { ...operation, requestId: "staged-ipad-a", idempotencyKey: "staged-ipad-a" },
      () =>
        admitAndStageLocalCombineCampaign({
          scope,
          cells: [cell("ipad-a", localExecutionTargetRef({ targetId: "ipad-a", platform: "ios" }))],
          request: { deadlineMs: 1_000, duration: currentDuration(100) },
          runtime,
          at: 1_000,
          stage() {
            return scheduler.stageBatch([
              {
                id: "staged-ipad-a",
                ...defaultTargetWorkerAssignment({ targetId: "ipad-a", platform: "ios" }),
                run: async () => undefined,
              },
            ]);
          },
        }),
    );
    assert.equal(scheduler.statuses()[0]?.host?.queued, 1);

    let secondStageCalled = false;
    const second = runWithOperationContext(
      { ...operation, requestId: "staged-ipad-b", idempotencyKey: "staged-ipad-b" },
      () =>
        admitAndStageLocalCombineCampaign({
          scope,
          cells: [cell("ipad-b", localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" }))],
          request: { deadlineMs: 1_000, duration: currentDuration(100) },
          runtime,
          at: 1_000,
          stage() {
            secondStageCalled = true;
            throw new Error("a host-saturated admission must not stage work");
          },
        }),
    );
    await assert.rejects(second, (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE");
      return true;
    });
    assert.equal(secondStageCalled, false);
    assert.equal(controlAdmissions, 1, "second target must reject before leasing");

    first.staged.rollback();
    await first.admission.rollback();
    assert.deepEqual(releases, ["lease:ipad-a"]);
  } finally {
    if (previousHostCapacity === undefined) delete process.env.RELAY_IOS_HOST_CAPACITY;
    else process.env.RELAY_IOS_HOST_CAPACITY = previousHostCapacity;
  }
});

test("cross-project admission holds shared-host capacity through scheduler staging", async () => {
  const previousHostCapacity = process.env.RELAY_IOS_HOST_CAPACITY;
  process.env.RELAY_IOS_HOST_CAPACITY = "1";
  const otherScope: RequestContext = {
    ...scope,
    subject: "human:other-planner",
    organizationId: "globex",
    projectId: "tablet",
    allowedProjects: ["tablet"],
  };
  const otherOperation = {
    ...operation,
    actorId: "human:other-planner",
    organizationId: otherScope.organizationId,
    projectId: otherScope.projectId,
    requestId: "cross-project-ipad-b",
    idempotencyKey: "cross-project-ipad-b",
  };
  const scheduler = new TargetWorkerScheduler();
  const leasesById = new Map<string, DeviceLease>();
  let workerFactReads = 0;
  let controlAdmissions = 0;
  let signalFirstStage!: () => void;
  let releaseFirstStage!: () => void;
  const firstStageEntered = new Promise<void>((resolve) => {
    signalFirstStage = resolve;
  });
  const allowFirstStage = new Promise<void>((resolve) => {
    releaseFirstStage = resolve;
  });
  const runtime = {
    async listDevices() {
      return [
        {
          id: "ipad-a",
          serial: "ipad-a",
          name: "ipad-a",
          kind: "Physical device",
          booted: true,
          platform: "ios" as const,
        },
        {
          id: "ipad-b",
          serial: "ipad-b",
          name: "ipad-b",
          kind: "Physical device",
          booted: true,
          platform: "ios" as const,
        },
      ];
    },
    async listDeviceLeases() {
      return [];
    },
    listTargetWorkers() {
      workerFactReads += 1;
      return scheduler.statuses();
    },
    async assertTargetControl() {
      throw new Error("local admission should use exact target admission");
    },
    async admitTargetControl(controlScope: RequestContext, targetId?: string) {
      if (!targetId) throw new Error("test target admission requires a target id");
      controlAdmissions += 1;
      const lease: DeviceLease = {
        id: `lease:${controlScope.projectId}:${targetId}`,
        organizationId: controlScope.organizationId,
        projectId: controlScope.projectId,
        poolId: "local",
        deviceSerial: targetId,
        ownerId: controlScope.subject,
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      };
      leasesById.set(lease.id, lease);
      setOperationLease(lease.id, lease.ownerId);
      return { lease, createdByThisCall: true };
    },
    async releaseDeviceLease(leaseId: string) {
      const lease = leasesById.get(leaseId);
      if (!lease) throw new Error(`unknown test lease ${leaseId}`);
      return { ...lease, status: "released" as const };
    },
  };

  try {
    const first = runWithOperationContext(
      { ...operation, requestId: "cross-project-ipad-a", idempotencyKey: "cross-project-ipad-a" },
      () =>
        admitAndStageLocalCombineCampaign({
          scope,
          cells: [cell("ipad-a", localExecutionTargetRef({ targetId: "ipad-a", platform: "ios" }))],
          request: { deadlineMs: 1_000, duration: currentDuration(100) },
          runtime,
          at: 1_000,
          async stage() {
            const staged = scheduler.stageBatch([
              {
                id: "cross-project-ipad-a",
                ...defaultTargetWorkerAssignment({ targetId: "ipad-a", platform: "ios" }),
                run: async () => undefined,
              },
            ]);
            signalFirstStage();
            await allowFirstStage;
            return staged;
          },
        }),
    );
    await firstStageEntered;

    let secondStageCalled = false;
    const second = runWithOperationContext(otherOperation, () =>
      admitAndStageLocalCombineCampaign({
        scope: otherScope,
        cells: [cell("ipad-b", localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" }))],
        request: { deadlineMs: 1_000, duration: currentDuration(100) },
        runtime,
        at: 1_000,
        stage() {
          secondStageCalled = true;
          throw new Error("a host-saturated admission must not stage work");
        },
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(workerFactReads, 1, "second project must wait before reading capacity");
    assert.equal(controlAdmissions, 1, "second project must wait before leasing capacity");

    releaseFirstStage();
    const firstResult = await first;
    try {
      await assert.rejects(second, (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE");
        return true;
      });
      assert.equal(secondStageCalled, false);
      assert.equal(controlAdmissions, 1, "second project must reject before leasing");
    } finally {
      firstResult.staged.rollback();
      await firstResult.admission.rollback();
    }
  } finally {
    if (previousHostCapacity === undefined) delete process.env.RELAY_IOS_HOST_CAPACITY;
    else process.env.RELAY_IOS_HOST_CAPACITY = previousHostCapacity;
  }
});
