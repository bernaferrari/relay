import assert from "node:assert/strict";
import test from "node:test";
import type { CombineCampaign } from "./combine-campaign.js";
import { combineCampaignSchema } from "./execution-operation-output-schemas.js";
import { repeatFailureClusterReportSchema } from "./repeat-failure.js";

const target = {
  schemaVersion: 1 as const,
  kind: "local-device" as const,
  provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
  targetId: "pixel-1",
  platform: "android" as const,
  identity: { kind: "device-serial" as const, value: "pixel-1" },
};

const duration = { workItemDurationMs: 10_000, provenance: "supplied" as const };
const deadline = {
  requestedMs: 60_000,
  reservedHeadroomMs: 0,
  workBudgetMs: 60_000,
  estimatedParallelDurationMs: 10_000,
  capacity: "within-budget" as const,
  assurance: "supplied-estimate" as const,
  achievableWithCurrentCapacity: false,
};
const targetFact = {
  targetId: "pixel-1",
  requestedPlatform: "android" as const,
  observedPlatform: "android" as const,
  availability: "available" as const,
  lease: "available" as const,
  workerId: "worker-1",
  workerFact: "scheduler" as const,
};
const plan = {
  workItems: 1,
  estimatedWorkItemDurationMs: 10_000,
  slots: [{ targetId: "pixel-1", platform: "android" as const, workerId: "worker-1" }],
  excludedTargets: [],
  workers: [
    { workerId: "worker-1", capacity: 1, active: 0, queued: 0, freeCapacity: 1, slotCount: 1 },
  ],
  hosts: [
    { workerId: "worker-1", capacity: 1, active: 0, queued: 0, freeCapacity: 1, slotCount: 1 },
  ],
  platforms: [{ platform: "android" as const, scheduledSlots: 1, excludedTargets: 0 }],
  serial: { slots: 1, estimatedDurationMs: 10_000 },
  parallel: { slots: 1, estimatedDurationMs: 10_000, idealSpeedup: 1 },
  assumptions: [],
};

const campaign: CombineCampaign = {
  schemaVersion: 1,
  id: "campaign-1",
  projectId: "default",
  appMapId: "settings",
  combineId: "language-settings",
  sourceRevision: 3,
  latestRevision: 3,
  status: "ready-to-resume",
  createdAt: 1,
  updatedAt: 2,
  cases: [],
  lineage: [],
  execution: {
    selectedCellIds: [],
    seed: 7,
    repeat: {
      schemaVersion: 1,
      requestedAppMapRevision: 2,
      executionAppMapRevision: 3,
      testId: "settings-test",
      testPlanDigest: "plan-settings",
      rootRecipeId: "settings-root",
      target: { kind: "device", platform: "android", targetId: "pixel-1" },
      spec: { dimensions: [{ id: "language", values: ["en"] }] },
      resolved: {
        dimensions: [{ id: "language", valueIds: ["en"] }],
        strategy: "zip",
        pilot: { mode: "representative" },
        resume: "untouched",
      },
      evidence: "visual",
      pilotJobId: "pilot-1",
      selectedCaseIds: ["case-en"],
    },
    localAdmission: {
      request: { deadlineMs: 60_000, durationEvidence: [] },
      preflight: {
        checkedAt: 1,
        input: {
          targets: [{ targetId: "pixel-1", platform: "android" }],
          workItems: 1,
          workItemsByPlatform: { android: 1 },
          duration,
          deadlineMs: 60_000,
        },
        duration: { ...duration, assurance: "supplied-estimate" },
        targets: [targetFact],
        deadline,
        plan,
        assumptions: [],
      },
      targetPreflights: [
        {
          checkedAt: 1,
          target: targetFact,
          criticalPath: { workItems: [], estimatedWorkDurationMs: 0 },
          scheduled: true,
          deadline,
          assumptions: [],
        },
      ],
      targets: [target],
    },
  },
};

test("Combine campaign output parses to the canonical protocol type", () => {
  const parsed: CombineCampaign = combineCampaignSchema.parse(campaign);
  assert.deepEqual(parsed, campaign);
});

test("Combine campaign output rejects truncated admission evidence", () => {
  const truncated = structuredClone(campaign) as unknown as {
    execution: { localAdmission: { request: { durationEvidence?: unknown } } };
  };
  delete truncated.execution.localAdmission.request.durationEvidence;
  assert.throws(() => combineCampaignSchema.parse(truncated), /durationEvidence/);
});

test("Repeat failure clusters require immutable digest and retain per-cell evidence", () => {
  const signature = {
    schemaVersion: 1 as const,
    kind: "causal" as const,
    digest: `sha256:${"a".repeat(64)}`,
    key: '{"checks":[{"id":"check-1"}]}',
    summary: "causal failure in check-1",
    checkIds: ["check-1"],
  };
  const report = {
    schemaVersion: 1 as const,
    campaignId: "campaign-1",
    clusters: [
      {
        schemaVersion: 1 as const,
        id: "repeat-cluster:causal:pixel-1",
        kind: "causal" as const,
        signature,
        cohort: "pixel-1",
        representativeCellId: "cell-1",
        representativeRunId: "run-1",
        cases: [
          {
            cellId: "cell-1",
            runId: "run-1",
            priorRunIds: ["old-run-1"],
            values: { language: "en" },
            world: "English",
            targetProfileId: "pixel-1",
            status: "failed" as const,
            signature,
            evidenceRefs: ["run:run-1", "run:run-1#frame:0"],
            decision: { status: "pending" as const, reason: "Review this case" },
          },
        ],
      },
    ],
  };
  assert.deepEqual(repeatFailureClusterReportSchema.parse(report), report);
  assert.throws(
    () =>
      repeatFailureClusterReportSchema.parse({
        ...report,
        clusters: [{ ...report.clusters[0]!, signature: { ...signature, digest: "not-a-digest" } }],
      }),
    /digest/u,
  );
});
