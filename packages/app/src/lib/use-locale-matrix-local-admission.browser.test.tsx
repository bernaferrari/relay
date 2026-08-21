import { createRoot, createSignal } from "solid-js";
import { expect, test } from "vitest";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type CampaignCapacityCohortDurationEvidence,
  type CampaignCapacityCohortDurationEstimateRequest,
  type CampaignCapacityCohortDurationEstimateResponse,
  type LocalCampaignAdmissionPreflightRequest,
  type LocalCampaignAdmissionPreflightResponse,
  type LocaleMatrixMaterialization,
} from "@relay/protocol";
import { createLocaleMatrixLocalAdmission } from "./use-locale-matrix-local-admission";

const materialization: LocaleMatrixMaterialization = {
  schemaVersion: 1,
  materializedAt: 1,
  source: { kind: "recipe", recipeId: "settings" },
  scope: {
    locales: ["en", "Italiano\n(Italy)"],
    entryPath: [{ kind: "tap" }],
    restoreLocale: "en",
  },
  cases: [
    { caseIndex: 0, locale: "en" },
    { caseIndex: 1, locale: "Italiano\n(Italy)" },
    { caseIndex: 2, locale: "en" },
  ],
  durationCohort: { testId: "settings", action: "settings" },
};

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

test("locale local admission keeps partial evidence useful but requires every frozen restore case to start", async () => {
  const estimateRequests: CampaignCapacityCohortDurationEstimateRequest[] = [];
  const preflightRequests: LocalCampaignAdmissionPreflightRequest[] = [];
  let dispose!: () => void;
  const admission = createRoot((nextDispose) => {
    dispose = nextDispose;
    return createLocaleMatrixLocalAdmission({
      materialization: () => materialization,
      server: {
        // Deliberately no selected-device accessor: this API has no serial fallback seam.
        devices: () => [
          { serial: "pixel-1", platform: "android", booted: true },
          { serial: "ipad-1", platform: "ios", booted: true },
        ],
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
                criticalPath: { estimatedWorkDurationMs: 12_000, workItems: [] },
                deadline: { achievableWithCurrentCapacity: true, reservedHeadroomMs: 0 },
              },
              {
                target: { targetId: "ipad-1", platform: "ios" },
                scheduled: true,
                criticalPath: { estimatedWorkDurationMs: 12_000, workItems: [] },
                deadline: { achievableWithCurrentCapacity: true, reservedHeadroomMs: 0 },
              },
            ],
          } as unknown as LocalCampaignAdmissionPreflightResponse;
        },
      },
    });
  });
  try {
    const pixel = admission
      .localTargets()
      .find((item) => item.target.targetId === "pixel-1")?.target;
    const ipad = admission.localTargets().find((item) => item.target.targetId === "ipad-1")?.target;
    if (!pixel || !ipad) throw new Error("expected attached targets");

    admission.bindCaseTarget(materialization.cases[0]!, pixel);
    await admission.refreshEvidence();
    expect(estimateRequests).toHaveLength(1);
    expect(estimateRequests[0]?.cohorts).toEqual([
      { targetId: "pixel-1", platform: "android", testId: "settings", action: "settings" },
    ]);
    expect(await admission.prepareForStart()).toBeUndefined();
    expect(admission.feedback()).toContain("every materialized locale case");
    expect(preflightRequests).toHaveLength(0);

    admission.bindCaseTarget(materialization.cases[1]!, ipad);
    admission.bindCaseTarget(materialization.cases[2]!, pixel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await admission.refreshEvidence();
    const selected = await admission.prepareForStart();
    if (!selected) throw new Error(admission.feedback());
    expect(selected.bindings.map((binding) => binding.caseIndex)).toEqual([0, 1, 2]);
    expect(preflightRequests).toHaveLength(1);
    expect(preflightRequests[0]?.workItems.map((item) => item.id)).toEqual([
      "locale:0",
      "locale:1",
      "locale:2",
    ]);
    expect(preflightRequests[0]?.request).toEqual(selected.request);
    expect(admission.previewIsReady()).toBe(true);
  } finally {
    dispose();
  }
});

test("an invalidated explicit target plan stays fail-closed until it is explicitly reset", async () => {
  const estimateRequests: CampaignCapacityCohortDurationEstimateRequest[] = [];
  const preflightRequests: LocalCampaignAdmissionPreflightRequest[] = [];
  let dispose!: () => void;
  let replaceMaterialization!: (next: LocaleMatrixMaterialization | undefined) => void;
  const initialMaterialization: LocaleMatrixMaterialization = {
    ...materialization,
    targetPlatform: "android",
  };
  const admission = createRoot((nextDispose) => {
    dispose = nextDispose;
    const [activeMaterialization, setActiveMaterialization] = createSignal<
      LocaleMatrixMaterialization | undefined
    >(initialMaterialization);
    replaceMaterialization = (next) => setActiveMaterialization(next);
    return createLocaleMatrixLocalAdmission({
      materialization: activeMaterialization,
      server: {
        devices: () => [
          { serial: "pixel-1", platform: "android", booted: true },
          { serial: "ipad-1", platform: "ios", booted: true },
        ],
        health: () => "online",
        async estimateCampaignDurationCohorts(input) {
          estimateRequests.push(structuredClone(input));
          return { checkedAt: 100, estimates: [] };
        },
        async preflightLocalCampaignAdmission(input) {
          preflightRequests.push(structuredClone(input));
          return {} as LocalCampaignAdmissionPreflightResponse;
        },
      },
    });
  });
  try {
    expect(admission.localTargets().map((item) => item.target.platform)).toEqual(["android"]);
    const pixel = admission
      .localTargets()
      .find((item) => item.target.targetId === "pixel-1")?.target;
    if (!pixel) throw new Error("expected attached target");

    admission.bindCaseTarget(materialization.cases[0]!, pixel);
    expect(admission.localCampaignMode()).toBe(true);

    // The same case index with different canonical content invalidates the
    // binding. It must not make this interaction fall back to selectedDevice.
    replaceMaterialization({
      ...materialization,
      materializedAt: 2,
      scope: { ...materialization.scope, locales: ["fr"] },
      cases: [{ caseIndex: 0, locale: "fr" }],
      targetPlatform: "ios",
    });

    expect(admission.caseTargetBindings()).toEqual([]);
    expect(admission.localCampaignMode()).toBe(true);
    expect(admission.localTargets().map((item) => item.target.platform)).toEqual(["ios"]);
    expect("issue" in admission.fullRequest()).toBe(true);
    expect(await admission.prepareForStart()).toBeUndefined();
    expect(admission.feedback()).toContain("Bind every materialized locale case");
    expect(estimateRequests).toHaveLength(0);
    expect(preflightRequests).toHaveLength(0);

    admission.resetBindings();
    expect(admission.localCampaignMode()).toBe(false);
  } finally {
    dispose();
  }
});
