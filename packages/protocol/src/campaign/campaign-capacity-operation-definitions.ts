import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

export type CampaignCapacityOperationId =
  | "campaign.capacity.preflight"
  | "campaign.duration.cohorts.estimate"
  | "campaign.local-admission.preflight";

/**
 * The capacity descriptor stays outside the monolithic registry, while
 * `operations.ts` remains the one place that composes every public operation.
 */
const { command } = createSchemaOperationBuilders<CampaignCapacityOperationId>();

export const campaignCapacityOperationDefinitions = [
  command(
    "campaign.capacity.preflight",
    "Preflight local campaign capacity",
    "POST",
    "/campaign-capacity/preflight",
    {
      category: "execution",
      idempotency: "inherent",
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
    },
  ),
] as const;
