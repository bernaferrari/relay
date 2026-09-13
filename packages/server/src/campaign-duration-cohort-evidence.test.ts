import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type CampaignCapacityCohortDurationEvidence,
  type CampaignCapacityDurationCohort,
} from "@relay/protocol";
import type { CampaignDurationRunRecord } from "@relay/core";
import { RelayClient } from "@relay/client";
import { HttpError } from "./http.js";
import {
  campaignDurationCohortKey,
  estimateCampaignDurationCohorts,
  verifyCampaignDurationCohortEvidence,
} from "./campaign-duration-cohort-evidence.js";
import type { RequestContext } from "./security.js";
import { startServer } from "./index.js";

const NOW = 1_000_000;
const scope: RequestContext = {
  subject: "human:planner",
  organizationId: "acme",
  projectId: "mobile",
  allowedProjects: ["mobile"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

const iPadDeepTour: CampaignCapacityDurationCohort = {
  targetId: "ipad-slow",
  platform: "ios",
  testId: "deep-tour",
  action: "app-map:settings:test:deep-tour",
};

function run(input: {
  id: string;
  durationMs: number;
  finishedAt: number;
  targetId?: string;
  platform?: "android" | "ios";
  testId?: string;
  action?: string;
  projectId?: string;
  ownerId?: string;
}): CampaignDurationRunRecord & { projectId?: string; ownerId?: string } {
  const targetId = input.targetId ?? iPadDeepTour.targetId;
  const platform: "android" | "ios" = input.platform ?? "ios";
  const testId = input.testId ?? iPadDeepTour.testId;
  const action = input.action ?? iPadDeepTour.action;
  return {
    id: input.id,
    // Intentionally generated wrapper ids: exact cohort estimation must use
    // the frozen Test action below, never this mutable runtime action.
    action: `wrapper:${input.id}`,
    status: "ok",
    outcome: "passed",
    queuedAt: input.finishedAt - input.durationMs - 10,
    startedAt: input.finishedAt - input.durationMs,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    platform,
    serial: targetId,
    executionTarget: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId,
      platform,
      identity: { kind: "device-serial", value: targetId },
    },
    artifacts: [
      {
        kind: "frozen-inputs",
        data: {
          kind: "combine-cell",
          testId,
          durationCohortAction: action,
        },
      },
    ],
    writtenAt: input.finishedAt + 1,
    projectId: input.projectId ?? scope.projectId,
    ownerId: input.ownerId ?? scope.subject,
  };
}

function runtime(records: readonly CampaignDurationRunRecord[], at = NOW) {
  return {
    now: () => at,
    // The server boundary reads `PersistedRun`; this unit fixture deliberately
    // supplies only the estimator projection it consumes.
    listPersistedRuns: async () => records as never,
  };
}

test("read-only cohort estimation excludes fast neighboring devices and Tests", async () => {
  const records = [
    run({ id: "ipad-1", durationMs: 1_000, finishedAt: NOW - 500 }),
    run({ id: "ipad-2", durationMs: 1_200, finishedAt: NOW - 400 }),
    run({ id: "ipad-3", durationMs: 1_400, finishedAt: NOW - 300 }),
    run({ id: "ipad-4", durationMs: 1_600, finishedAt: NOW - 200 }),
    run({ id: "ipad-5", durationMs: 1_800, finishedAt: NOW - 100 }),
    run({ id: "fast-ipad", durationMs: 10, finishedAt: NOW - 50, targetId: "ipad-fast" }),
    run({
      id: "fast-test",
      durationMs: 10,
      finishedAt: NOW - 40,
      testId: "quick-tour",
      action: "app-map:settings:test:quick-tour",
    }),
    run({ id: "other-project", durationMs: 10, finishedAt: NOW - 30, projectId: "other" }),
  ];
  const result = await estimateCampaignDurationCohorts({
    scope,
    request: {
      cohorts: [iPadDeepTour],
      maxAgeMs: 1_000,
      minSamples: 5,
      maxSamples: 20,
      percentile: "p95",
    },
    runtime: runtime(records),
  });

  assert.equal(result.checkedAt, NOW);
  const estimate = result.estimates[0];
  assert.equal(estimate?.status, "current");
  assert.equal(estimate?.sampleCount, 5);
  assert.equal(estimate?.candidates?.p95.workItemDurationMs, 1_760);
  assert.deepEqual(estimate?.evidence?.cohort, iPadDeepTour);
  assert.equal(estimate?.evidence?.duration.provenance, "observed-p95");
  assert.deepEqual(estimate?.evidence?.measurement.sampleIds, [
    "ipad-5",
    "ipad-4",
    "ipad-3",
    "ipad-2",
    "ipad-1",
  ]);
  assert.deepEqual(estimate?.filtering.excludedByReason, {
    "target-mismatch": 1,
    "test-mismatch": 1,
  });
});

test("admission verification rejects caller-edited evidence and only accepts re-derived persisted samples", async () => {
  const records = [
    run({ id: "ipad-1", durationMs: 1_000, finishedAt: NOW - 500 }),
    run({ id: "ipad-2", durationMs: 1_200, finishedAt: NOW - 400 }),
    run({ id: "ipad-3", durationMs: 1_400, finishedAt: NOW - 300 }),
    run({ id: "ipad-4", durationMs: 1_600, finishedAt: NOW - 200 }),
    run({ id: "ipad-5", durationMs: 1_800, finishedAt: NOW - 100 }),
  ];
  const estimated = await estimateCampaignDurationCohorts({
    scope,
    request: { cohorts: [iPadDeepTour], maxAgeMs: 1_000, minSamples: 5 },
    runtime: runtime(records),
  });
  const evidence = estimated.estimates[0]?.evidence;
  assert.ok(evidence);
  const verified = await verifyCampaignDurationCohortEvidence({
    scope,
    evidence: [evidence],
    at: NOW,
    runtime: runtime(records),
  });
  assert.deepEqual(verified.get(campaignDurationCohortKey(iPadDeepTour)), evidence);

  const tampered = structuredClone(evidence);
  tampered.duration.workItemDurationMs = 1;
  await assert.rejects(
    verifyCampaignDurationCohortEvidence({
      scope,
      evidence: [tampered],
      at: NOW,
      runtime: runtime(records),
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.body?.code, "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_UNVERIFIED");
      return true;
    },
  );
});

test("a stale cohort remains visible for diagnosis but does not create a current evidence promise", async () => {
  const records = [1, 2, 3, 4, 5].map((index) =>
    run({ id: `old-${index}`, durationMs: 1_000, finishedAt: NOW - 100 - index * 10 }),
  );
  const result = await estimateCampaignDurationCohorts({
    scope,
    request: { cohorts: [iPadDeepTour], maxAgeMs: 10, minSamples: 5 },
    runtime: runtime(records),
  });
  assert.equal(result.estimates[0]?.status, "stale");
  assert.ok(result.estimates[0]?.evidence, "stale provenance remains inspectable");
});

test("the shared evidence-age ceiling rejects a client request before reading run history", async () => {
  let reads = 0;
  await assert.rejects(
    estimateCampaignDurationCohorts({
      scope,
      request: {
        cohorts: [iPadDeepTour],
        maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS + 1,
      },
      runtime: {
        now: () => NOW,
        async listPersistedRuns() {
          reads += 1;
          return [] as never;
        },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.body?.code, "CAMPAIGN_DURATION_COHORTS_INVALID");
      assert.equal(error.body?.maxAllowedMs, MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS);
      return true;
    },
  );
  assert.equal(reads, 0);
});

test("the registered read-only transport returns evidence usable by normal clients", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-duration-cohort-route-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const records = [
    run({ id: "ipad-1", durationMs: 1_000, finishedAt: NOW - 500 }),
    run({ id: "ipad-2", durationMs: 1_200, finishedAt: NOW - 400 }),
    run({ id: "ipad-3", durationMs: 1_400, finishedAt: NOW - 300 }),
    run({ id: "ipad-4", durationMs: 1_600, finishedAt: NOW - 200 }),
    run({ id: "ipad-5", durationMs: 1_800, finishedAt: NOW - 100 }),
  ];
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    campaignDurationRuntime: runtime(records),
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actorId: scope.subject,
      actorKind: "human",
    });
    const response = await client.invoke("campaign.duration.cohorts.estimate", {
      cohorts: [iPadDeepTour],
      maxAgeMs: 1_000,
      minSamples: 5,
    });
    assert.equal(response.checkedAt, NOW);
    assert.equal(response.estimates[0]?.evidence?.duration.workItemDurationMs, 1_760);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("the generic local-admission preflight route exposes target critical-path evidence without leasing", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-local-admission-preview-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const at = Date.now();
  const records = [
    run({ id: "ipad-1", durationMs: 1_000, finishedAt: at - 500 }),
    run({ id: "ipad-2", durationMs: 1_200, finishedAt: at - 400 }),
    run({ id: "ipad-3", durationMs: 1_400, finishedAt: at - 300 }),
    run({ id: "ipad-4", durationMs: 1_600, finishedAt: at - 200 }),
    run({ id: "ipad-5", durationMs: 1_800, finishedAt: at - 100 }),
  ];
  const evidence = (
    await estimateCampaignDurationCohorts({
      scope,
      request: { cohorts: [iPadDeepTour], maxAgeMs: 10_000, minSamples: 5 },
      runtime: runtime(records, at),
    })
  ).estimates[0]?.evidence;
  assert.ok(evidence);
  let targetControlCalls = 0;
  const verifySyntheticEvidence = async (input: {
    evidence: readonly CampaignCapacityCohortDurationEvidence[];
  }) => new Map(input.evidence.map((item) => [campaignDurationCohortKey(item.cohort), item]));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [
          {
            id: iPadDeepTour.targetId,
            serial: iPadDeepTour.targetId,
            name: "Slow iPad",
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
        return [];
      },
      async assertTargetControl() {
        targetControlCalls += 1;
        throw new Error("read-only preflight must not take target control");
      },
      verifyCampaignDurationCohortEvidence: verifySyntheticEvidence,
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      actorId: scope.subject,
      actorKind: "human",
    });
    const response = await client.invoke("campaign.local-admission.preflight", {
      workItems: [
        {
          id: "deep",
          target: {
            schemaVersion: 1,
            kind: "local-device",
            provider: { key: "relay.local.agent-device", scope: "local" },
            targetId: iPadDeepTour.targetId,
            platform: "ios",
            identity: { kind: "device-serial", value: iPadDeepTour.targetId },
          },
          testId: iPadDeepTour.testId,
          action: iPadDeepTour.action,
        },
      ],
      request: { deadlineMs: 2_000, durationEvidence: [evidence] },
    });
    assert.equal(targetControlCalls, 0);
    assert.equal(response.preflight.deadline.achievableWithCurrentCapacity, true);
    assert.deepEqual(response.targetPreflights[0]?.criticalPath.workItems[0]?.evidence, evidence);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
