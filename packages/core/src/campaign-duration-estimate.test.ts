import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceChannel, EvidenceManifest } from "@relay/protocol";
import type { CampaignDurationRunRecord } from "./campaign-duration-estimate.js";
import {
  campaignCohortDurationEvidenceForPreflight,
  campaignDurationInputForPreflight,
  estimateCampaignDuration,
  estimateCampaignDurationForCohort,
} from "./campaign-duration-estimate.js";
import { preflightLocalCampaignCapacity } from "./local-campaign-capacity-preflight.js";
import type { ListedDevice } from "./workspace-devices.js";

const NOW = 1_000_000;

function run(
  id: string,
  durationMs: number,
  finishedAt: number,
  extra: Partial<CampaignDurationRunRecord> = {},
): CampaignDurationRunRecord {
  return {
    id,
    action: "app-map:settings:locale-tour",
    platform: "android",
    status: "ok",
    outcome: "passed",
    queuedAt: finishedAt - durationMs - 20,
    startedAt: finishedAt - durationMs,
    finishedAt,
    durationMs,
    writtenAt: finishedAt + 1,
    ...extra,
  };
}

function device(serial: string): ListedDevice {
  return {
    id: serial,
    serial,
    name: serial,
    kind: "Physical device",
    platform: "android",
    booted: true,
  };
}

function evidence(runId: string, startedAt: number, finishedAt: number): EvidenceManifest {
  const channels = [
    "input",
    "screenshot",
    "video",
    "ui-tree",
    "logs",
    "network",
    "performance",
    "crash",
    "audio",
  ] as EvidenceChannel[];
  return {
    schemaVersion: 1,
    runId,
    target: { kind: "device", platform: "android" },
    startedAt,
    finishedAt,
    channels: Object.fromEntries(
      channels.map((channel) => [
        channel,
        {
          channel,
          status: channel === "input" ? "captured" : "unsupported",
          entries: 0,
          bytes: 0,
          dropped: 0,
          redactions: 0,
        },
      ]),
    ) as EvidenceManifest["channels"],
    events: [],
  };
}

test("derives bounded p50/p95 candidates from recent successful persisted-run records", () => {
  const fixture = [
    run("run-1", 100, NOW - 500),
    run("run-2", 200, NOW - 400),
    run("run-3", 300, NOW - 300),
    run("run-4", 400, NOW - 200),
    run("run-5", 500, NOW - 100),
  ];
  const before = structuredClone(fixture);
  const estimate = estimateCampaignDuration({
    platform: "android",
    action: "app-map:settings:locale-tour",
    runs: fixture,
    source: "persisted-runs",
    at: NOW,
    maxAgeMs: 1_000,
    minSamples: 5,
  });

  assert.equal(estimate.status, "current");
  assert.equal(estimate.sampleCount, 5);
  assert.equal(estimate.observedAt, NOW - 100);
  assert.deepEqual(estimate.observationWindow, { startedAt: NOW - 500, finishedAt: NOW - 100 });
  assert.deepEqual(estimate.candidates, {
    p50: {
      workItemDurationMs: 300,
      provenance: "observed-p50",
      observedAt: NOW - 100,
      sampleCount: 5,
      maxAgeMs: 1_000,
    },
    p95: {
      workItemDurationMs: 480,
      provenance: "observed-p95",
      observedAt: NOW - 100,
      sampleCount: 5,
      maxAgeMs: 1_000,
    },
  });
  assert.equal(estimate.filtering.durationSource, "run-wall-clock");
  assert.deepEqual(fixture, before, "estimation is read-only");
});

test("rejects uncertain, non-terminal, failed, and mixed-platform records from a measured cohort", () => {
  const estimate = estimateCampaignDuration({
    platform: "android",
    action: "app-map:settings:locale-tour",
    source: "mixed-read-only-records",
    at: NOW,
    maxAgeMs: 1_000,
    minSamples: 5,
    runs: [
      run("accepted-1", 100, NOW - 500),
      run("accepted-2", 200, NOW - 400),
      run("accepted-3", 300, NOW - 300),
      run("accepted-4", 400, NOW - 200),
      run("accepted-5", 500, NOW - 100),
      run("ios", 9_999, NOW - 50, { platform: "ios" }),
      run("browser", 9_999, NOW - 50, { platform: "browser" }),
      run("pending", 9_999, NOW - 50, { status: "running" }),
      run("uncertain", 9_999, NOW - 50, { outcome: "uncertain" }),
      run("needs-review", 9_999, NOW - 50, {
        review: {
          schemaVersion: 1,
          status: "pending",
          capability: "visual",
          reason: "missing frame",
          requestedAt: NOW - 50,
        },
      }),
      run("harness-failure", 9_999, NOW - 50, { status: "error", outcome: "harness-failure" }),
    ],
  });

  assert.equal(estimate.status, "current");
  assert.equal(estimate.candidates?.p95.workItemDurationMs, 480);
  assert.deepEqual(estimate.filtering.excludedByReason, {
    "platform-mismatch": 2,
    "non-terminal": 1,
    uncertain: 2,
    "non-successful-terminal": 1,
  });
});

test("can use the existing evidence completion metric without mixing it with insufficient evidence", () => {
  const records = [10, 20, 30, 40, 50].map((durationMs, index) => {
    const finishedAt = NOW - 500 + index * 100;
    return run(`evidence-${index}`, 1_000, finishedAt, {
      evidence: evidence(`evidence-${index}`, finishedAt - durationMs, finishedAt),
    });
  });
  const insufficient = evidence("insufficient", NOW - 10, NOW);
  insufficient.channels.input.dropped = 1;
  records.push(
    run("insufficient", 1_000, NOW - 10, {
      evidence: insufficient,
    }),
  );

  const estimate = estimateCampaignDuration({
    platform: "android",
    action: "app-map:settings:locale-tour",
    source: "persisted-runs",
    durationSource: "evidence-completion",
    at: NOW,
    maxAgeMs: 1_000,
    minSamples: 5,
    runs: records,
  });

  assert.equal(estimate.status, "current");
  assert.equal(estimate.candidates?.p50.workItemDurationMs, 30);
  assert.equal(estimate.candidates?.p95.workItemDurationMs, 48);
  assert.deepEqual(estimate.filtering.excludedByReason, {
    "evidence-duration-unavailable": 1,
  });
});

test("returns no preflight candidate when the homogeneous completed cohort is insufficient", () => {
  const estimate = estimateCampaignDuration({
    platform: "ios",
    action: "app-map:settings:locale-tour",
    source: "run-summaries",
    at: NOW,
    maxAgeMs: 1_000,
    minSamples: 5,
    runs: [
      run("android-1", 100, NOW - 100),
      run("android-2", 100, NOW - 90),
      run("android-3", 100, NOW - 80),
      run("android-4", 100, NOW - 70),
    ],
  });

  assert.equal(estimate.status, "insufficient-samples");
  assert.equal(estimate.sampleCount, 0);
  assert.equal(estimate.candidates, undefined);
  assert.equal(campaignDurationInputForPreflight(estimate, "p95"), undefined);
  assert.deepEqual(estimate.filtering.excludedByReason, { "platform-mismatch": 4 });
});

test("a stale observation can size a plan but cannot turn the deadline into a current SLA", () => {
  const estimate = estimateCampaignDuration({
    platform: "android",
    action: "app-map:settings:locale-tour",
    source: "persisted-runs",
    at: NOW,
    maxAgeMs: 100,
    minSamples: 5,
    runs: [
      run("run-1", 100, NOW - 500),
      run("run-2", 200, NOW - 400),
      run("run-3", 300, NOW - 300),
      run("run-4", 400, NOW - 200),
      run("run-5", 500, NOW - 150),
    ],
  });
  const duration = campaignDurationInputForPreflight(estimate, "p95");
  assert.equal(estimate.status, "stale");
  assert.ok(duration);

  const preflight = preflightLocalCampaignCapacity({
    targets: [{ targetId: "pixel-a", platform: "android" }],
    workItems: 1,
    workItemsByPlatform: { android: 1 },
    duration,
    deadlineMs: 2_000,
    devices: [device("pixel-a")],
    leases: [],
    workers: [],
    at: NOW,
  });
  assert.equal(preflight.deadline.capacity, "within-budget");
  assert.equal(preflight.deadline.assurance, "measurement-stale");
  assert.equal(preflight.deadline.achievableWithCurrentCapacity, false);
});

test("derives locale timing only from the immutable per-target frozen cohort", () => {
  const cohort = {
    targetId: "pixel-locale",
    platform: "android" as const,
    testId: "app-map:settings:flow:locale",
    action: "app-map:settings:flow:locale",
  };
  const records = [100, 200, 300, 400, 500].map((durationMs, index) =>
    run(`locale-${index}`, durationMs, NOW - 500 + index * 100, {
      // Locale wrapper ids intentionally rotate per matrix; their stable
      // timing identity is the frozen cohort, not this transient action.
      action: `locale-wrapper-${index}`,
      serial: cohort.targetId,
      executionTarget: {
        schemaVersion: 1,
        kind: "local-device",
        provider: { key: "relay.local.agent-device", scope: "local" },
        targetId: cohort.targetId,
        platform: cohort.platform,
        identity: { kind: "device-serial", value: cohort.targetId },
      },
      artifacts: [
        {
          kind: "frozen-inputs",
          data: {
            kind: "combine",
            durationCohort: { testId: cohort.testId, action: cohort.action },
          },
        },
      ],
    }),
  );

  const estimate = estimateCampaignDurationForCohort({
    cohort,
    runs: records,
    source: "persisted-runs",
    at: NOW,
    maxAgeMs: 1_000,
    minSamples: 5,
  });

  assert.equal(estimate.status, "current");
  assert.deepEqual(estimate.sampleIds, [
    "locale-4",
    "locale-3",
    "locale-2",
    "locale-1",
    "locale-0",
  ]);
  const evidence = campaignCohortDurationEvidenceForPreflight(estimate, "p95");
  assert.deepEqual(evidence?.cohort, cohort);
  assert.equal(evidence?.duration.workItemDurationMs, 480);
  assert.deepEqual(evidence?.measurement.sampleIds, estimate.sampleIds);
});
