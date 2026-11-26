import type {
  CampaignRepairTarget,
  CampaignRepairTargetSummary,
} from "../campaign/campaign-repair.js";
import type { AppMap } from "../app-map/app-map.js";
import { createSchemaOperationBuilders } from "../operation/operation-builders.js";
import type { OperationRecord } from "../operation/operation-contract.js";
import type { OperationSchemaInput } from "../operation/operation-input-schemas.js";

export type CampaignRepairOperationMap = {
  "run.repair.list": {
    input: OperationSchemaInput<"run.repair.list">;
    output: { repairs: CampaignRepairTargetSummary[] };
  };
  "run.repair.get": {
    input: OperationSchemaInput<"run.repair.get">;
    output: { repair: CampaignRepairTarget };
  };
  "run.repair.retry": {
    input: OperationSchemaInput<"run.repair.retry">;
    output: { repair: CampaignRepairTarget; job: OperationRecord };
  };
  "run.repair.propose": {
    input: OperationSchemaInput<"run.repair.propose">;
    output: { repair: CampaignRepairTarget; appMap: AppMap; proposalId: string };
  };
};

const { command, query } = createSchemaOperationBuilders<
  keyof CampaignRepairOperationMap & string
>();

export const runRepairOperationDefinitions = [
  query("run.repair.list", "List failed check repair targets", "/runs/repairs", {
    category: "evidence",
  }),
  query(
    "run.repair.get",
    "Get one failed check repair target",
    "/runs/:runId/checks/:checkId/repair",
    {
      category: "evidence",
    },
  ),
  command(
    "run.repair.retry",
    "Retry only one failed check",
    "POST",
    "/runs/:runId/checks/:checkId/retry",
    {
      category: "execution",
      progress: true,
      cancellable: true,
      lease: "exclusive",
      targetCapabilities: ["tap", "snapshot", "screenshot"],
    },
  ),
  command(
    "run.repair.propose",
    "Propose a reversible failed-check repair",
    "POST",
    "/runs/:runId/checks/:checkId/proposals",
    {
      category: "authoring",
    },
  ),
];
