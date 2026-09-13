import { createOperationBuilders } from "./operation-builders.js";
import { isExecutionTargetRef } from "./execution-target.js";
import type { OperationInput, OperationOutput, RelayOperationMap } from "./operation-map.js";
import {
  fail,
  number,
  objectFieldParser,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

export type CampaignCapacityOperationId =
  | "campaign.capacity.preflight"
  | "campaign.duration.cohorts.estimate"
  | "campaign.local-admission.preflight";

const campaignCapacityPreflightInputParser = objectParser<
  OperationInput<"campaign.capacity.preflight">
>("campaign capacity preflight input", (input) => {
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    fail("campaign capacity targets", "must be a non-empty array");
  }
  for (const [index, value] of input.targets.entries()) {
    const target = record(value, `campaign capacity target ${index}`);
    string(target.targetId, `campaign capacity target ${index} targetId`);
    if (
      target.platform !== "android" &&
      target.platform !== "ios" &&
      target.platform !== "browser"
    ) {
      fail(`campaign capacity target ${index} platform`, "must be android, ios, or browser");
    }
  }
  number(input.workItems, "campaign capacity workItems");
  const partition = record(input.workItemsByPlatform, "campaign capacity workItemsByPlatform");
  for (const platform of Object.keys(partition)) {
    if (platform !== "android" && platform !== "ios" && platform !== "browser") {
      fail("campaign capacity workItemsByPlatform", "may contain only android, ios, or browser");
    }
    number(partition[platform], `campaign capacity ${platform} workItems`);
  }
  const duration = record(input.duration, "campaign capacity duration");
  number(duration.workItemDurationMs, "campaign capacity duration workItemDurationMs");
  if (
    duration.provenance !== "observed-p50" &&
    duration.provenance !== "observed-p95" &&
    duration.provenance !== "supplied"
  ) {
    fail(
      "campaign capacity duration provenance",
      "must be observed-p50, observed-p95, or supplied",
    );
  }
  if (duration.provenance !== "supplied") {
    number(duration.observedAt, "campaign capacity duration observedAt");
    number(duration.sampleCount, "campaign capacity duration sampleCount");
    number(duration.maxAgeMs, "campaign capacity duration maxAgeMs");
  }
  number(input.deadlineMs, "campaign capacity deadlineMs");
  if (input.setupHeadroomMs !== undefined) {
    number(input.setupHeadroomMs, "campaign capacity setupHeadroomMs");
  }
  if (input.recoveryHeadroomMs !== undefined) {
    number(input.recoveryHeadroomMs, "campaign capacity recoveryHeadroomMs");
  }
});

function assertDurationCohort(value: unknown, label: string): void {
  const cohort = record(value, label);
  string(cohort.targetId, `${label} targetId`);
  if (cohort.platform !== "android" && cohort.platform !== "ios" && cohort.platform !== "browser") {
    fail(`${label} platform`, "must be android, ios, or browser");
  }
  string(cohort.testId, `${label} testId`);
  string(cohort.action, `${label} action`);
}

const campaignDurationCohortsEstimateInputParser = objectParser<
  OperationInput<"campaign.duration.cohorts.estimate">
>("campaign duration cohorts estimate input", (input) => {
  if (!Array.isArray(input.cohorts) || input.cohorts.length === 0) {
    fail("campaign duration cohorts", "must be a non-empty array");
  }
  input.cohorts.forEach((cohort, index) =>
    assertDurationCohort(cohort, `campaign duration cohort ${index}`),
  );
  number(input.maxAgeMs, "campaign duration maxAgeMs");
  if (input.minSamples !== undefined) {
    number(input.minSamples, "campaign duration minSamples");
  }
  if (input.maxSamples !== undefined) {
    number(input.maxSamples, "campaign duration maxSamples");
  }
  if (input.percentile !== undefined && input.percentile !== "p50" && input.percentile !== "p95") {
    fail("campaign duration percentile", "must be p50 or p95");
  }
  if (
    input.durationSource !== undefined &&
    input.durationSource !== "run-wall-clock" &&
    input.durationSource !== "evidence-completion"
  ) {
    fail("campaign duration source", "must be run-wall-clock or evidence-completion");
  }
});

const campaignDurationCohortsEstimateOutputParser = objectParser<
  OperationOutput<"campaign.duration.cohorts.estimate">
>("campaign duration cohorts estimate response", (input) => {
  number(input.checkedAt, "campaign duration checkedAt");
  if (!Array.isArray(input.estimates)) {
    fail("campaign duration estimates", "must be an array");
  }
  input.estimates.forEach((value, index) => {
    const estimate = record(value, `campaign duration estimate ${index}`);
    assertDurationCohort(estimate.cohort, `campaign duration estimate ${index} cohort`);
    number(estimate.checkedAt, `campaign duration estimate ${index} checkedAt`);
    if (
      estimate.status !== "current" &&
      estimate.status !== "stale" &&
      estimate.status !== "insufficient-samples"
    ) {
      fail(`campaign duration estimate ${index} status`, "is unsupported");
    }
    number(estimate.minSamples, `campaign duration estimate ${index} minSamples`);
    number(estimate.maxAgeMs, `campaign duration estimate ${index} maxAgeMs`);
    number(estimate.sampleCount, `campaign duration estimate ${index} sampleCount`);
    if (estimate.evidence !== undefined) {
      const evidence = record(estimate.evidence, `campaign duration estimate ${index} evidence`);
      if (evidence.schemaVersion !== 1) {
        fail(`campaign duration estimate ${index} evidence schemaVersion`, "must be 1");
      }
      assertDurationCohort(evidence.cohort, `campaign duration estimate ${index} evidence cohort`);
    }
  });
});

const localCampaignAdmissionPreflightInputParser = objectParser<
  OperationInput<"campaign.local-admission.preflight">
>("local campaign admission preflight input", (input) => {
  if (!Array.isArray(input.workItems) || !input.workItems.length) {
    fail("local campaign admission workItems", "must be a non-empty array");
  }
  input.workItems.forEach((value, index) => {
    const workItem = record(value, `local campaign admission work item ${index}`);
    string(workItem.id, `local campaign admission work item ${index} id`);
    string(workItem.testId, `local campaign admission work item ${index} testId`);
    string(workItem.action, `local campaign admission work item ${index} action`);
    const target = workItem.target;
    if (!isExecutionTargetRef(target) || target.kind !== "local-device") {
      fail(
        `local campaign admission work item ${index} target`,
        "must be a canonical local-device target",
      );
    }
  });
  const request = record(input.request, "local campaign admission request");
  number(request.deadlineMs, "local campaign admission deadlineMs");
  if (!Array.isArray(request.durationEvidence)) {
    fail("local campaign admission durationEvidence", "must be an array");
  }
});

const localCampaignAdmissionPreflightOutputParser = objectParser<
  OperationOutput<"campaign.local-admission.preflight">
>("local campaign admission preflight response", (input) => {
  record(input.preflight, "local campaign admission preflight");
  if (!Array.isArray(input.targetPreflights)) {
    fail("local campaign admission targetPreflights", "must be an array");
  }
});

/**
 * The capacity descriptor stays outside the monolithic registry, while
 * `operations.ts` remains the one place that composes every public operation.
 */
const { command } = createOperationBuilders<Pick<RelayOperationMap, CampaignCapacityOperationId>>();

export const campaignCapacityOperationDefinitions = [
  command(
    "campaign.capacity.preflight",
    "Preflight local campaign capacity",
    "POST",
    "/campaign-capacity/preflight",
    {
      category: "execution",
      idempotency: "inherent",
      input: campaignCapacityPreflightInputParser,
      output: objectFieldParser<OperationOutput<"campaign.capacity.preflight">>(
        "campaign capacity preflight response",
        "preflight",
      ),
    },
  ),
  command(
    "campaign.duration.cohorts.estimate",
    "Estimate target/Test duration cohorts",
    "POST",
    "/campaign-duration/cohorts/estimate",
    {
      category: "evidence",
      minimumRole: "viewer",
      idempotency: "inherent",
      input: campaignDurationCohortsEstimateInputParser,
      output: campaignDurationCohortsEstimateOutputParser,
    },
  ),
  command(
    "campaign.local-admission.preflight",
    "Preflight exact local campaign admission",
    "POST",
    "/jobs/local-admission/preflight",
    {
      category: "execution",
      idempotency: "inherent",
      input: localCampaignAdmissionPreflightInputParser,
      output: localCampaignAdmissionPreflightOutputParser,
    },
  ),
] as const;
