import { createOperationBuilders } from "./operation-builders.js";
import type { OperationInput, OperationOutput } from "./operation-map.js";
import {
  fail,
  number,
  objectFieldParser,
  objectParser,
  operationRecordParser,
  record,
  string,
} from "./operation-parser-primitives.js";

export type CampaignCapacityOperationId = "campaign.capacity.preflight";

const campaignCapacityPreflightInputParser = objectParser<
  OperationInput<"campaign.capacity.preflight">
>("campaign capacity preflight input", (input) => {
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    fail("campaign capacity targets", "must be a non-empty array");
  }
  for (const [index, value] of input.targets.entries()) {
    const target = record(value, `campaign capacity target ${index}`);
    string(target.targetId, `campaign capacity target ${index} targetId`);
    if (target.platform !== "android" && target.platform !== "ios") {
      fail(`campaign capacity target ${index} platform`, "must be android or ios");
    }
  }
  number(input.workItems, "campaign capacity workItems");
  const partition = record(input.workItemsByPlatform, "campaign capacity workItemsByPlatform");
  for (const platform of Object.keys(partition)) {
    if (platform !== "android" && platform !== "ios") {
      fail("campaign capacity workItemsByPlatform", "may contain only android and ios");
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

/**
 * The capacity descriptor stays outside the monolithic registry, while
 * `operations.ts` remains the one place that composes every public operation.
 */
const { command } = createOperationBuilders<CampaignCapacityOperationId>(operationRecordParser);

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
] as const;
