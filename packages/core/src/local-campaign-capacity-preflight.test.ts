import assert from "node:assert/strict";
import test from "node:test";
import type {
  CampaignCapacityCohortDurationEvidence,
  DeviceLease,
  TargetRuntimeReadiness,
} from "@relay/protocol";
import {
  preflightLocalCampaignCapacity,
  preflightLocalCampaignTargetCriticalPath,
} from "./local-campaign-capacity-preflight.js";
import type { ListedDevice } from "./workspace-devices.js";

function device(
  serial: string,
  platform: "android" | "ios",
  extra: Partial<ListedDevice> = {},
): ListedDevice {
  return {
    id: serial,
    serial,
    name: serial,
    kind: "Physical device",
    booted: true,
    platform,
    ...extra,
  };
}

function staleReadiness(): TargetRuntimeReadiness {
  return {
    previewPixels: {
      mode: "pixels",
      state: "proven",
      freshness: "stale",
      proof: { at: 1 },
      invalidated: { at: 2, reason: "visual-changed" },
    },
    semanticControl: {
      mode: "accessibility",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
    evidenceCapture: {
      mode: "evidence",
      state: "unproven",
      freshness: "unproven",
      reason: "not-yet-proven",
    },
  };
}

function lease(serial: string, expiresAt: number): DeviceLease {
  return {
    id: `lease-${serial}`,
    projectId: "project",
    poolId: "pool",
    deviceSerial: serial,
    ownerId: "other-actor",
    status: "leased",
    leasedAt: 1,
    expiresAt,
  };
}

function cohortEvidence(input: {
  targetId: string;
  platform: "android" | "ios";
  testId: string;
  action: string;
  workItemDurationMs: number;
}): CampaignCapacityCohortDurationEvidence {
  return {
    schemaVersion: 1,
    cohort: {
      targetId: input.targetId,
      platform: input.platform,
      testId: input.testId,
      action: input.action,
    },
    duration: {
      workItemDurationMs: input.workItemDurationMs,
      provenance: "observed-p95",
      observedAt: 1_000,
      sampleCount: 5,
      maxAgeMs: 1_000,
    },
    measurement: {
      estimator: "campaign-duration-estimate",
      recordSource: "persisted-runs",
      durationSource: "run-wall-clock",
      sampleIds: Array.from({ length: 5 }, (_, index) => `${input.testId}:${index}`),
      observationWindow: { startedAt: 900, finishedAt: 1_000 },
    },
  };
}

test("preflights a current measured Android/iOS partition with explicit critical-path headroom", () => {
  const preflight = preflightLocalCampaignCapacity({
    targets: [
      { targetId: "pixel-a", platform: "android" },
      { targetId: "ipad-a", platform: "ios" },
    ],
    workItems: 4,
    workItemsByPlatform: { android: 2, ios: 2 },
    duration: {
      workItemDurationMs: 1_000,
      provenance: "observed-p95",
      observedAt: 950,
      sampleCount: 24,
      maxAgeMs: 500,
    },
    deadlineMs: 5_000,
    setupHeadroomMs: 500,
    recoveryHeadroomMs: 500,
    devices: [device("pixel-a", "android"), device("ipad-a", "ios")],
    leases: [],
    workers: [],
    at: 1_000,
  });

  assert.deepEqual(preflight.plan.slots, [
    {
      targetId: "ipad-a",
      platform: "ios",
      workerId: "local:ios:target:ipad-a",
    },
    {
      targetId: "pixel-a",
      platform: "android",
      workerId: "local:android:target:pixel-a",
    },
  ]);
  assert.equal(preflight.duration.assurance, "measured-current");
  assert.deepEqual(preflight.deadline, {
    requestedMs: 5_000,
    reservedHeadroomMs: 1_000,
    workBudgetMs: 4_000,
    estimatedParallelDurationMs: 3_000,
    capacity: "within-budget",
    assurance: "measured-current",
    achievableWithCurrentCapacity: true,
  });
  assert.deepEqual(
    preflight.targets.map((target) => [target.targetId, target.workerFact]),
    [
      ["pixel-a", "derived-local-lane"],
      ["ipad-a", "derived-local-lane"],
    ],
  );
});

test("excludes missing, stale, and leased targets before sizing a deadline", () => {
  const preflight = preflightLocalCampaignCapacity({
    targets: [
      { targetId: "pixel-ready", platform: "android" },
      { targetId: "pixel-stale", platform: "android" },
      { targetId: "pixel-missing", platform: "android" },
      { targetId: "ipad-leased", platform: "ios" },
    ],
    workItems: 4,
    workItemsByPlatform: { android: 3, ios: 1 },
    duration: {
      workItemDurationMs: 1_000,
      provenance: "observed-p50",
      observedAt: 1_000,
      sampleCount: 8,
      maxAgeMs: 1_000,
    },
    deadlineMs: 4_000,
    devices: [
      device("pixel-ready", "android"),
      device("pixel-stale", "android", { readiness: staleReadiness() }),
      device("ipad-leased", "ios"),
    ],
    leases: [lease("ipad-leased", 10_000)],
    workers: [],
    at: 1_500,
  });

  assert.deepEqual(
    preflight.targets.map((target) => ({
      targetId: target.targetId,
      availability: target.availability,
      lease: target.lease,
      reason: target.reason,
    })),
    [
      { targetId: "pixel-ready", availability: "available", lease: "available", reason: undefined },
      {
        targetId: "pixel-stale",
        availability: "stale",
        lease: "available",
        reason: "stale-readiness",
      },
      {
        targetId: "pixel-missing",
        availability: "unavailable",
        lease: "available",
        reason: "missing",
      },
      { targetId: "ipad-leased", availability: "available", lease: "leased", reason: undefined },
    ],
  );
  assert.deepEqual(preflight.plan.excludedTargets, [
    { targetId: "ipad-leased", platform: "ios", reasons: ["leased"] },
    { targetId: "pixel-missing", platform: "android", reasons: ["unavailable"] },
    { targetId: "pixel-stale", platform: "android", reasons: ["stale"] },
  ]);
  assert.equal(preflight.deadline.capacity, "outside-budget");
  assert.equal(preflight.deadline.achievableWithCurrentCapacity, false);
});

test("a supplied or stale measurement never becomes a deadline SLA", () => {
  const base = {
    targets: [{ targetId: "pixel-a", platform: "android" as const }],
    workItems: 1,
    workItemsByPlatform: { android: 1 },
    deadlineMs: 2_000,
    devices: [device("pixel-a", "android")],
    leases: [],
    workers: [],
    at: 1_000,
  };
  const supplied = preflightLocalCampaignCapacity({
    ...base,
    duration: { workItemDurationMs: 500, provenance: "supplied" },
  });
  assert.equal(supplied.deadline.capacity, "within-budget");
  assert.equal(supplied.deadline.assurance, "supplied-estimate");
  assert.equal(supplied.deadline.achievableWithCurrentCapacity, false);

  const stale = preflightLocalCampaignCapacity({
    ...base,
    duration: {
      workItemDurationMs: 500,
      provenance: "observed-p95",
      observedAt: 1,
      sampleCount: 10,
      maxAgeMs: 10,
    },
  });
  assert.equal(stale.deadline.capacity, "within-budget");
  assert.equal(stale.deadline.assurance, "measurement-stale");
  assert.equal(stale.deadline.achievableWithCurrentCapacity, false);
});

test("keeps heterogeneous slow-Test evidence visible on a concrete iPad serial path", () => {
  const target = { targetId: "ipad-slow", platform: "ios" as const };
  const preflight = preflightLocalCampaignTargetCriticalPath({
    target,
    workItems: [
      {
        workItemId: "quick",
        evidence: cohortEvidence({
          ...target,
          testId: "quick-tour",
          action: "app-map:settings:test:quick-tour",
          workItemDurationMs: 100,
        }),
      },
      {
        workItemId: "deep",
        evidence: cohortEvidence({
          ...target,
          testId: "deep-tour",
          action: "app-map:settings:test:deep-tour",
          workItemDurationMs: 2_000,
        }),
      },
    ],
    deadlineMs: 2_050,
    devices: [device(target.targetId, target.platform)],
    leases: [],
    workers: [],
    scheduledTargetIds: [target.targetId],
    at: 1_000,
  });

  assert.equal(preflight.scheduled, true);
  assert.equal(preflight.criticalPath.estimatedWorkDurationMs, 2_100);
  assert.equal(preflight.deadline.achievableWithCurrentCapacity, false);
  assert.deepEqual(
    preflight.criticalPath.workItems.map((item) => [
      item.workItemId,
      item.evidence.cohort.testId,
      item.evidence.duration.workItemDurationMs,
      item.evidence.measurement.sampleIds.length,
    ]),
    [
      ["quick", "quick-tour", 100, 5],
      ["deep", "deep-tour", 2_000, 5],
    ],
  );
});
