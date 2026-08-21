import { createRoot } from "solid-js";
import { expect, test } from "vitest";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type CampaignCapacityCohortDurationEstimateRequest,
  type CampaignCapacityCohortDurationEstimateResponse,
  type CampaignCapacityCohortDurationEvidence,
  type LocalCampaignAdmissionPreflightRequest,
  type LocalCampaignAdmissionPreflightResponse,
} from "@relay/protocol";
import { createAppMapCombineLocalAdmission } from "./use-app-map-combine-local-admission";

function evidenceFor(
  cohort: CampaignCapacityCohortDurationEvidence["cohort"],
): CampaignCapacityCohortDurationEvidence {
  return {
    schemaVersion: 1,
    cohort,
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
      sampleIds: ["run-1", "run-2", "run-3", "run-4", "run-5"],
      observationWindow: { startedAt: 1, finishedAt: 100 },
    },
  };
}

test("local Combine admission refreshes immutable evidence and preflights the same exact contract", async () => {
  const cells = [
    { testId: "settings", values: { language: "it" } },
    { testId: "settings", values: { language: "en" } },
  ];
  const estimateRequests: CampaignCapacityCohortDurationEstimateRequest[] = [];
  const preflightRequests: LocalCampaignAdmissionPreflightRequest[] = [];
  let dispose!: () => void;
  const admission = createRoot((nextDispose) => {
    dispose = nextDispose;
    return createAppMapCombineLocalAdmission({
      appMapId: () => "settings",
      cells: () => cells,
      server: {
        devices: () => [{ serial: "pixel-1", platform: "android", booted: true }],
        health: () => "online",
        async estimateCampaignDurationCohorts(input) {
          estimateRequests.push(structuredClone(input));
          return {
            checkedAt: 100,
            estimates: input.cohorts.map((cohort) => ({
              schemaVersion: 1,
              cohort,
              checkedAt: 100,
              status: "current",
              minSamples: 5,
              maxAgeMs: input.maxAgeMs,
              sampleCount: 5,
              observedAt: 100,
              observationWindow: { startedAt: 1, finishedAt: 100 },
              filtering: {
                recordSource: "persisted-runs",
                durationSource: "run-wall-clock",
                totalRecords: 5,
                acceptedBeforeSampleCap: 5,
                excludedByReason: {},
                sampleCap: 5,
                omittedBySampleCap: 0,
              },
              evidence: evidenceFor(cohort),
            })),
          } satisfies CampaignCapacityCohortDurationEstimateResponse;
        },
        async preflightLocalCampaignAdmission(input) {
          preflightRequests.push(structuredClone(input));
          return {
            preflight: {} as LocalCampaignAdmissionPreflightResponse["preflight"],
            targetPreflights: [
              {
                target: { targetId: "pixel-1", platform: "android" },
                scheduled: true,
                criticalPath: {
                  estimatedWorkDurationMs: 12_000,
                  workItems: [],
                },
                deadline: {
                  achievableWithCurrentCapacity: true,
                  reservedHeadroomMs: 0,
                },
              },
            ],
          } as unknown as LocalCampaignAdmissionPreflightResponse;
        },
      },
    });
  });
  try {
    const target = admission.localTargets()[0]?.target;
    if (!target) throw new Error("attached Android target is selectable");
    admission.bindCellTarget("settings", { language: "it" }, target);
    expect(admission.cellTargetBindings()).toHaveLength(1);
    const fullSelection = admission.fullSelection();
    expect("issue" in fullSelection).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await admission.refreshEvidence();
    expect(admission.evidence(), admission.feedback()).toHaveLength(1);
    expect(await admission.prepareForStart(cells)).toBeUndefined();
    expect(admission.feedback()).toContain("Bind each selected cell");
    const selected = await admission.prepareForStart([cells[0]!]);

    if (!selected) throw new Error(admission.feedback());
    expect(estimateRequests).toHaveLength(1);
    expect(estimateRequests[0]).toEqual({
      cohorts: [
        {
          targetId: "pixel-1",
          platform: "android",
          testId: "settings",
          action: "app-map:settings:test:settings",
        },
      ],
      maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
      percentile: "p95",
      minSamples: 5,
    });
    expect(preflightRequests).toHaveLength(1);
    expect(preflightRequests[0]?.workItems[0]?.target.targetId).toBe("pixel-1");
    expect(preflightRequests[0]?.workItems[0]?.action).toBe("app-map:settings:test:settings");
    expect(preflightRequests[0]?.request).toEqual(selected.request);
    expect(admission.previewIsReady()).toBe(true);
  } finally {
    dispose();
  }
});
