import type {
  CampaignRepairProposalInput,
  CampaignRepairTarget,
  CampaignRepairTargetSummary,
} from "./campaign-repair.js";
import type { AppMap } from "./app-map.js";
import { createOperationBuilders } from "./operation-builders.js";
import type { OperationRecord } from "./operation-contract.js";

export type CampaignRepairOperationMap = {
  "run.repair.list": {
    input: { limit?: number };
    output: { repairs: CampaignRepairTargetSummary[] };
  };
  "run.repair.get": {
    input: { runId: string; checkId: string };
    output: { repair: CampaignRepairTarget };
  };
  "run.repair.retry": {
    input: { runId: string; checkId: string };
    output: { repair: CampaignRepairTarget; job: OperationRecord };
  };
  "run.repair.propose": {
    input: CampaignRepairProposalInput;
    output: { repair: CampaignRepairTarget; appMap: AppMap; proposalId: string };
  };
};

function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}

function record(value: unknown, label: string): OperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(label, "must be an object");
  }
  return value as OperationRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) fail(label, "must be a non-empty string");
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(label, "must be a number");
  return value;
}

const operationRecordParser = {
  description: "operation record",
  parse(value: unknown) {
    return record(value, this.description);
  },
};

function objectParser<T extends OperationRecord>(
  description: string,
  validate?: (input: OperationRecord) => void,
) {
  return {
    description,
    parse(value: unknown): T {
      const input = record(value, description);
      validate?.(input);
      return input as T;
    },
  };
}

const { command, query } =
  createOperationBuilders<keyof CampaignRepairOperationMap>(operationRecordParser);

const runRepairInputParser = objectParser<CampaignRepairOperationMap["run.repair.get"]["input"]>(
  "run repair input",
  (input) => {
    string(input.runId, "run repair runId");
    string(input.checkId, "run repair checkId");
  },
);

const runRepairProposalInputParser = objectParser<
  CampaignRepairOperationMap["run.repair.propose"]["input"]
>("run repair proposal input", (input) => {
  string(input.runId, "run repair proposal runId");
  string(input.checkId, "run repair proposal checkId");
  string(input.reason, "run repair proposal reason");
  if (!(["retarget", "accept-current", "disable"] as unknown[]).includes(input.kind)) {
    fail("run repair proposal kind", "must be retarget, accept-current, or disable");
  }
  if (input.kind === "retarget") record(input.selector, "run repair proposal selector");
  if (input.equivalentTargets !== undefined) {
    if (!Array.isArray(input.equivalentTargets) || input.equivalentTargets.length > 100) {
      fail("run repair proposal equivalentTargets", "must be an array of at most 100 targets");
    }
    input.equivalentTargets.forEach((target, index) => {
      const item = record(target, `run repair proposal equivalentTargets[${index}]`);
      string(item.runId, `run repair proposal equivalentTargets[${index}].runId`);
      string(item.checkId, `run repair proposal equivalentTargets[${index}].checkId`);
    });
  }
});

const runRepairListInputParser = objectParser<
  CampaignRepairOperationMap["run.repair.list"]["input"]
>("run repair list input", (input) => {
  if (input.limit === undefined) return;
  const value =
    typeof input.limit === "string"
      ? Number(input.limit)
      : number(input.limit, "run repair list limit");
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    fail("run repair list limit", "must be an integer between 1 and 500");
  }
  input.limit = value;
});

function assertRepairTarget(value: unknown, label: string): void {
  const target = record(value, label);
  if (target.schemaVersion !== 1) fail(`${label} schemaVersion`, "must be 1");
  string(target.id, `${label} id`);
  const source = record(target.source, `${label} source`);
  string(source.runId, `${label} source runId`);
  string(source.checkId, `${label} source checkId`);
  if (!Array.isArray(target.actions)) fail(`${label} actions`, "must be an array");
}

function assertRepairSummary(value: unknown, label: string): void {
  const target = record(value, label);
  if (target.schemaVersion !== 1) fail(`${label} schemaVersion`, "must be 1");
  string(target.id, `${label} id`);
  string(target.error, `${label} error`);
  number(target.priorAttemptCount, `${label} priorAttemptCount`);
  const source = record(target.source, `${label} source`);
  string(source.runId, `${label} source runId`);
  string(source.checkId, `${label} source checkId`);
}

const runRepairListOutputParser = objectParser<
  CampaignRepairOperationMap["run.repair.list"]["output"]
>("run repair list response", (input) => {
  if (!Array.isArray(input.repairs)) fail("run repairs", "must be an array");
  input.repairs.forEach((repair, index) => assertRepairSummary(repair, `run repair ${index}`));
});

const runRepairOutputParser = objectParser<CampaignRepairOperationMap["run.repair.get"]["output"]>(
  "run repair response",
  (input) => assertRepairTarget(input.repair, "run repair"),
);

const runRepairRetryOutputParser = objectParser<
  CampaignRepairOperationMap["run.repair.retry"]["output"]
>("run repair retry response", (input) => {
  assertRepairTarget(input.repair, "run repair");
  record(input.job, "run repair job");
});

const runRepairProposalOutputParser = objectParser<
  CampaignRepairOperationMap["run.repair.propose"]["output"]
>("run repair proposal response", (input) => {
  assertRepairTarget(input.repair, "run repair");
  record(input.appMap, "run repair proposal appMap");
  string(input.proposalId, "run repair proposal proposalId");
});

export const runRepairOperationDefinitions = [
  query("run.repair.list", "List failed check repair targets", "/runs/repairs", {
    category: "evidence",
    input: runRepairListInputParser,
    output: runRepairListOutputParser,
  }),
  query(
    "run.repair.get",
    "Get one failed check repair target",
    "/runs/:runId/checks/:checkId/repair",
    {
      category: "evidence",
      input: runRepairInputParser,
      output: runRepairOutputParser,
    },
  ),
  command(
    "run.repair.retry",
    "Retry only one failed check",
    "POST",
    "/runs/:runId/checks/:checkId/retry",
    {
      category: "execution",
      input: runRepairInputParser,
      output: runRepairRetryOutputParser,
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
      input: runRepairProposalInputParser,
      output: runRepairProposalOutputParser,
    },
  ),
];
