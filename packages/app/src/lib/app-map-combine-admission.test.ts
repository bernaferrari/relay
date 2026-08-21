import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type AppMapCombineCellTargetBinding,
} from "@relay/protocol";
import {
  combineAdmissionAction,
  combineAdmissionCohorts,
  combineAdmissionWorkItems,
  localAdmissionRequestForCombine,
} from "./app-map-combine-admission";

const bindings: AppMapCombineCellTargetBinding[] = [
  {
    testId: "settings",
    values: { language: "en" },
    target: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "pixel-1",
      platform: "android",
      identity: { kind: "device-serial", value: "pixel-1" },
    },
  },
  {
    testId: "settings",
    values: { language: "it" },
    target: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "pixel-1",
      platform: "android",
      identity: { kind: "device-serial", value: "pixel-1" },
    },
  },
];

test("Combine admission cohorts are concrete and stable across variable values", () => {
  const cohorts = combineAdmissionCohorts({
    appMapId: "settings",
    cells: bindings.map((binding) => ({ testId: binding.testId, values: binding.values })),
    bindings,
  });
  assert.deepEqual(cohorts, [
    {
      targetId: "pixel-1",
      platform: "android",
      testId: "settings",
      action: combineAdmissionAction("settings", "settings"),
    },
  ]);
});

test("local admission preview work items preserve each explicitly bound cell", () => {
  const cells = bindings.map((binding) => ({ testId: binding.testId, values: binding.values }));
  const workItems = combineAdmissionWorkItems({ appMapId: "settings", cells, bindings });
  assert.deepEqual(
    workItems?.map((item) => [item.target.targetId, item.testId, item.action]),
    [
      ["pixel-1", "settings", "app-map:settings:test:settings"],
      ["pixel-1", "settings", "app-map:settings:test:settings"],
    ],
  );
  assert.notEqual(workItems?.[0]?.id, workItems?.[1]?.id);
});

test("local admission only accepts complete current cohort evidence", () => {
  const cohorts = combineAdmissionCohorts({
    appMapId: "settings",
    cells: bindings.map((binding) => ({ testId: binding.testId, values: binding.values })),
    bindings,
  });
  const base = {
    draft: { deadlineMinutes: "3", setupHeadroomMinutes: "1", recoveryHeadroomMinutes: "" },
    cohorts,
  };
  const missing = localAdmissionRequestForCombine({ ...base, evidence: [] });
  assert.deepEqual(missing, {
    issue: "No measured timing evidence is available for pixel-1 · settings.",
  });
  const result = localAdmissionRequestForCombine({
    ...base,
    evidence: [
      {
        schemaVersion: 1,
        cohort: cohorts[0]!,
        duration: {
          workItemDurationMs: 12_000,
          provenance: "observed-p95",
          observedAt: 100,
          sampleCount: 5,
          maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
        },
        measurement: {
          estimator: "campaign-duration-estimate",
          recordSource: "persisted-runs",
          durationSource: "run-wall-clock",
          sampleIds: ["1", "2", "3", "4", "5"],
          observationWindow: { startedAt: 1, finishedAt: 100 },
        },
      },
    ],
  });
  assert.deepEqual(result, {
    request: {
      deadlineMs: 180_000,
      setupHeadroomMs: 60_000,
      durationEvidence: [
        {
          schemaVersion: 1,
          cohort: cohorts[0],
          duration: {
            workItemDurationMs: 12_000,
            provenance: "observed-p95",
            observedAt: 100,
            sampleCount: 5,
            maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
          },
          measurement: {
            estimator: "campaign-duration-estimate",
            recordSource: "persisted-runs",
            durationSource: "run-wall-clock",
            sampleIds: ["1", "2", "3", "4", "5"],
            observationWindow: { startedAt: 1, finishedAt: 100 },
          },
        },
      ],
    },
  });
});
