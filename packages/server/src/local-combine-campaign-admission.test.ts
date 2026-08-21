import assert from "node:assert/strict";
import test from "node:test";
import {
  TargetWorkerScheduler,
  defaultTargetWorkerAssignment,
  localExecutionTargetRef as createLocalExecutionTargetRef,
  runWithOperationContext,
  setOperationLease,
} from "@relay/core";
import type { PreparedAppMapCombineCell } from "@relay/core";
import type {
  CampaignCapacityCohortDurationEvidence,
  DeviceLease,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionRequest,
  LocalCampaignCapacityPreflight,
  LocalCampaignCapacityTargetCriticalPathPreflight,
} from "@relay/protocol";
import { HttpError } from "./http.js";
import {
  admitAndStageLocalCampaign,
  admitAndStageLocalCombineCampaign,
  localCampaignAdmissionRequestForActiveWorkItems,
  preflightLocalCampaignAdmission,
} from "./local-combine-campaign-admission.js";
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

function localExecutionTargetRef(input: {
  targetId: string;
  platform: "android" | "ios";
}): LocalAgentDeviceExecutionTargetRef {
  const target = createLocalExecutionTargetRef(input);
  if (target.kind !== "local-device") throw new Error("test expected a local device target");
  return target;
}

function cell(
  cellId: string,
  target: ReturnType<typeof localExecutionTargetRef>,
): PreparedAppMapCombineCell {
  return {
    cellId,
    executionTarget: target,
    testId: "settings-tour",
    recipeSnapshot: { id: "app-map:settings:test:settings-tour" },
    childIntent: { sourcePlan: { appMapId: "settings" } },
  } as PreparedAppMapCombineCell;
}

function currentDuration(
  target: LocalAgentDeviceExecutionTargetRef,
  workItemDurationMs: number,
  input: { testId?: string; action?: string; observedAt?: number } = {},
) {
  const testId = input.testId ?? "settings-tour";
  const action = input.action ?? `app-map:settings:test:${testId}`;
  const observedAt = input.observedAt ?? 1_000;
  return {
    schemaVersion: 1 as const,
    cohort: {
      targetId: target.targetId,
      platform: target.platform,
      testId,
      action,
    },
    duration: {
      workItemDurationMs,
      provenance: "observed-p95" as const,
      observedAt,
      sampleCount: 20,
      maxAgeMs: 60_000,
    },
    measurement: {
      estimator: "campaign-duration-estimate" as const,
      recordSource: "persisted-runs" as const,
      durationSource: "run-wall-clock" as const,
      sampleIds: Array.from({ length: 20 }, (_, index) => `${target.targetId}:${testId}:${index}`),
      observationWindow: { startedAt: observedAt - 1_000, finishedAt: observedAt },
    },
  };
}

function admissionRequest(
  deadlineMs: number,
  evidence: ReturnType<typeof currentDuration>[],
): LocalCampaignAdmissionRequest {
  return { deadlineMs, durationEvidence: evidence };
}

function evidenceKey(evidence: CampaignCapacityCohortDurationEvidence): string {
  const { cohort } = evidence;
  return JSON.stringify([cohort.targetId, cohort.platform, cohort.testId, cohort.action]);
}

/** Admission's production verifier re-derives artifacts from persisted runs.
 * These scheduling unit tests deliberately isolate capacity behavior, so their
 * synthetic evidence is explicitly verified by this deterministic seam. */
async function verifySyntheticCohortEvidence(input: {
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
}): Promise<Map<string, CampaignCapacityCohortDurationEvidence>> {
  return new Map(
    input.evidence.map((evidence) => [evidenceKey(evidence), structuredClone(evidence)]),
  );
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
    verifyCampaignDurationCohortEvidence: verifySyntheticCohortEvidence,
  };
}

function preflights(error: HttpError): LocalCampaignCapacityTargetCriticalPathPreflight[] {
  return (error.body?.targetPreflights ?? []) as LocalCampaignCapacityTargetCriticalPathPreflight[];
}

test("target-affine admission rejects a deadline that pooled Android capacity would accept", async () => {
  const pixel = localExecutionTargetRef({ targetId: "pixel-a", platform: "android" });
  const tablet = localExecutionTargetRef({ targetId: "tablet-b", platform: "android" });
  const result = runWithOperationContext(operation, () =>
    admitAndStageLocalCombineCampaign({
      scope,
      cells: [cell("a-1", pixel), cell("a-2", pixel), cell("a-3", pixel), cell("b-1", tablet)],
      request: admissionRequest(2_000, [
        currentDuration(pixel, 1_000),
        currentDuration(tablet, 1_000),
      ]),
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
      (preflight) => preflight.target.targetId === "pixel-a",
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
      request: admissionRequest(2_000, [
        currentDuration(android, 1_000),
        currentDuration(ios, 10_000),
      ]),
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
      (preflight) => preflight.target.requestedPlatform === "android",
    );
    const iosPreflight = preflights(error).find(
      (preflight) => preflight.target.requestedPlatform === "ios",
    );
    assert.equal(androidPreflight?.deadline.achievableWithCurrentCapacity, true);
    assert.equal(iosPreflight?.deadline.achievableWithCurrentCapacity, false);
    assert.equal(iosPreflight?.criticalPath.estimatedWorkDurationMs, 10_000);
    assert.deepEqual(
      iosPreflight?.criticalPath.workItems.map((item) => item.evidence.cohort),
      [
        {
          targetId: "ipad-b",
          platform: "ios",
          testId: "settings-tour",
          action: "app-map:settings:test:settings-tour",
        },
      ],
    );
    return true;
  });
});

test("a slow Test on an otherwise fast target is summed into its own target critical path", async () => {
  const target = localExecutionTargetRef({ targetId: "ipad-slow", platform: "ios" });
  const quick = {
    id: "quick",
    target,
    testId: "quick-tour",
    action: "app-map:settings:test:quick-tour",
  };
  const deep = {
    id: "deep",
    target,
    testId: "deep-tour",
    action: "app-map:settings:test:deep-tour",
  };
  let staged = false;
  const result = runWithOperationContext(
    { ...operation, requestId: "slow-test", idempotencyKey: "slow-test" },
    () =>
      admitAndStageLocalCampaign({
        scope,
        workItems: [quick, deep],
        request: admissionRequest(2_050, [
          currentDuration(target, 100, { testId: quick.testId, action: quick.action }),
          currentDuration(target, 2_000, { testId: deep.testId, action: deep.action }),
        ]),
        runtime: runtimeFor([{ targetId: target.targetId, platform: target.platform }]),
        at: 1_000,
        stage() {
          staged = true;
          throw new Error("a slow critical path must reject before staging");
        },
      }),
  );
  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_DEADLINE_INFEASIBLE");
    const targetPreflight = preflights(error)[0];
    assert.equal(targetPreflight?.target.targetId, "ipad-slow");
    assert.equal(targetPreflight?.criticalPath.estimatedWorkDurationMs, 2_100);
    assert.deepEqual(
      targetPreflight?.criticalPath.workItems.map((item) => [
        item.workItemId,
        item.evidence.cohort.testId,
        item.evidence.cohort.action,
        item.evidence.duration.workItemDurationMs,
      ]),
      [
        ["quick", "quick-tour", "app-map:settings:test:quick-tour", 100],
        ["deep", "deep-tour", "app-map:settings:test:deep-tour", 2_000],
      ],
    );
    return true;
  });
  assert.equal(staged, false);
});

test("admission refuses missing, stale, and incompatible cohort evidence before any capacity stage", async () => {
  const target = localExecutionTargetRef({ targetId: "pixel-a", platform: "android" });
  const workItem = {
    id: "settings",
    target,
    testId: "settings-tour",
    action: "app-map:settings:test:settings-tour",
  };
  const runtime = runtimeFor([{ targetId: target.targetId, platform: target.platform }]);
  const attempt = (request: LocalCampaignAdmissionRequest) =>
    runWithOperationContext(
      { ...operation, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() },
      () =>
        admitAndStageLocalCampaign({
          scope,
          workItems: [workItem],
          request,
          runtime,
          at: 1_000,
          stage() {
            throw new Error("invalid evidence must never stage");
          },
        }),
    );

  await assert.rejects(attempt({ deadlineMs: 2_000, durationEvidence: [] }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED");
    return true;
  });

  const stale = currentDuration(target, 100, { observedAt: 1 });
  stale.duration.maxAgeMs = 1;
  await assert.rejects(attempt(admissionRequest(2_000, [stale])), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_STALE");
    return true;
  });

  const incompatible = currentDuration(target, 100, {
    testId: "other-tour",
    action: "app-map:settings:test:other-tour",
  });
  await assert.rejects(attempt(admissionRequest(2_000, [incompatible])), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_INCOMPATIBLE");
    return true;
  });
});

test("pilot narrowing retains only active evidence while requiring a complete known campaign proof", () => {
  const pilotTarget = localExecutionTargetRef({ targetId: "pixel-pilot", platform: "android" });
  const coverageTarget = localExecutionTargetRef({ targetId: "ipad-coverage", platform: "ios" });
  const pilot = {
    id: "pilot",
    target: pilotTarget,
    testId: "settings-tour",
    action: "app-map:settings:test:settings-tour",
  };
  const coverage = {
    id: "coverage",
    target: coverageTarget,
    testId: "settings-tour",
    action: "app-map:settings:test:settings-tour",
  };
  const fullRequest = admissionRequest(10_000, [
    currentDuration(pilotTarget, 100),
    currentDuration(coverageTarget, 2_000),
  ]);
  const activeRequest = localCampaignAdmissionRequestForActiveWorkItems({
    request: fullRequest,
    activeWorkItems: [pilot],
    knownWorkItems: [pilot, coverage],
  });
  assert.deepEqual(
    activeRequest.durationEvidence.map((evidence) => evidence.cohort.targetId),
    ["pixel-pilot"],
  );
  assert.equal(fullRequest.durationEvidence.length, 2, "durable request remains complete");

  assert.throws(
    () =>
      localCampaignAdmissionRequestForActiveWorkItems({
        request: admissionRequest(10_000, [currentDuration(pilotTarget, 100)]),
        activeWorkItems: [pilot],
        knownWorkItems: [pilot, coverage],
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.body?.code === "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED",
  );
});

test("read-only admission preflight exposes exact evidence without acquiring target control", async () => {
  const target = localExecutionTargetRef({ targetId: "pixel-preview", platform: "android" });
  let controlCalls = 0;
  const runtime = {
    ...runtimeFor([{ targetId: target.targetId, platform: target.platform }]),
    async admitTargetControl() {
      controlCalls += 1;
      throw new Error("read-only preflight must not lease a target");
    },
  };
  const result = await preflightLocalCampaignAdmission({
    scope,
    workItems: [
      {
        id: "preview",
        target,
        testId: "settings-tour",
        action: "app-map:settings:test:settings-tour",
      },
    ],
    request: admissionRequest(2_000, [currentDuration(target, 100)]),
    runtime,
    at: 1_000,
  });
  assert.equal(controlCalls, 0);
  assert.equal(result.preflight.deadline.achievableWithCurrentCapacity, true);
  assert.deepEqual(result.targetPreflights[0]?.criticalPath.workItems[0]?.evidence.cohort, {
    targetId: "pixel-preview",
    platform: "android",
    testId: "settings-tour",
    action: "app-map:settings:test:settings-tour",
  });
});

test("local admission rejects a forged local target before capacity facts or target control", async () => {
  const target = localExecutionTargetRef({ targetId: "pixel-forged", platform: "android" });
  const forgedTarget = {
    ...target,
    provider: { key: "example.device-farm", scope: "remote" },
  } as unknown as LocalAgentDeviceExecutionTargetRef;
  let factsRead = 0;
  const runtime = {
    ...runtimeFor([{ targetId: target.targetId, platform: target.platform }]),
    async listDevices() {
      factsRead += 1;
      return [];
    },
  };

  await assert.rejects(
    preflightLocalCampaignAdmission({
      scope,
      workItems: [
        {
          id: "forged",
          target: forgedTarget,
          testId: "settings-tour",
          action: "app-map:settings:test:settings-tour",
        },
      ],
      request: admissionRequest(1_000, [currentDuration(target, 100)]),
      runtime,
      at: 1_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_TARGET_UNSUPPORTED");
      return true;
    },
  );
  assert.equal(factsRead, 0);
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
    verifyCampaignDurationCohortEvidence: verifySyntheticCohortEvidence,
  };
  const first = runWithOperationContext(
    { ...operation, requestId: "staging-first", idempotencyKey: "staging-first" },
    () =>
      admitAndStageLocalCombineCampaign({
        scope,
        cells: [cell("first", target)],
        request: admissionRequest(1_000, [currentDuration(target, 100)]),
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
        request: admissionRequest(1_000, [currentDuration(target, 100)]),
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
    verifyCampaignDurationCohortEvidence: verifySyntheticCohortEvidence,
  };

  try {
    const first = await runWithOperationContext(
      { ...operation, requestId: "staged-ipad-a", idempotencyKey: "staged-ipad-a" },
      () =>
        admitAndStageLocalCombineCampaign({
          scope,
          cells: [cell("ipad-a", localExecutionTargetRef({ targetId: "ipad-a", platform: "ios" }))],
          request: admissionRequest(1_000, [
            currentDuration(localExecutionTargetRef({ targetId: "ipad-a", platform: "ios" }), 100),
          ]),
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
          request: admissionRequest(1_000, [
            currentDuration(localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" }), 100),
          ]),
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
    verifyCampaignDurationCohortEvidence: verifySyntheticCohortEvidence,
  };

  try {
    const first = runWithOperationContext(
      { ...operation, requestId: "cross-project-ipad-a", idempotencyKey: "cross-project-ipad-a" },
      () =>
        admitAndStageLocalCombineCampaign({
          scope,
          cells: [cell("ipad-a", localExecutionTargetRef({ targetId: "ipad-a", platform: "ios" }))],
          request: admissionRequest(1_000, [
            currentDuration(localExecutionTargetRef({ targetId: "ipad-a", platform: "ios" }), 100),
          ]),
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
        request: admissionRequest(1_000, [
          currentDuration(localExecutionTargetRef({ targetId: "ipad-b", platform: "ios" }), 100),
        ]),
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
