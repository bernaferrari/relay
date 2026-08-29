import { createOperationBuilders } from "./operation-builders.js";
import type {
  EvidenceCollectionPolicyDto,
  RedactionPolicyDto,
  RelayOperationMap,
} from "./operation-map.js";
import {
  boolean,
  emptyInputParser,
  fail,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

type WorkspaceOperationId =
  | "workspace.privacy.get"
  | "workspace.privacy.update"
  | "workspace.evidence.get"
  | "workspace.change.inspect"
  | "workspace.evidence.update";

const enabledInputParser = objectParser<{ enabled: boolean }>("enabled input", (input) => {
  boolean(input.enabled, "enabled");
});

const redactionPolicyParser = objectParser<{ policy: RedactionPolicyDto }>(
  "redaction policy response",
  (input) => {
    const policy = record(input.policy, "redaction policy");
    boolean(policy.enabled, "redaction enabled");
    string(policy.source, "redaction source");
    boolean(policy.locked, "redaction locked");
  },
);

const evidencePolicyParser = objectParser<{ policy: EvidenceCollectionPolicyDto }>(
  "evidence policy response",
  (input) => {
    const policy = record(input.policy, "evidence policy");
    if (policy.schemaVersion !== 1) fail("evidence policy schemaVersion", "must be 1");
    record(policy.sensitive, "evidence policy sensitive grants");
  },
);

const { command, query } = createOperationBuilders<Pick<RelayOperationMap, WorkspaceOperationId>>();

export const workspaceOperationDefinitions = [
  query("workspace.privacy.get", "Get privacy policy", "/settings/privacy", {
    minimumRole: "admin",
    input: emptyInputParser,
    output: redactionPolicyParser,
  }),
  command("workspace.privacy.update", "Update privacy policy", "PUT", "/settings/privacy", {
    input: enabledInputParser,
    output: redactionPolicyParser,
  }),
  query("workspace.evidence.get", "Get evidence policy", "/settings/evidence", {
    minimumRole: "admin",
    input: emptyInputParser,
    output: evidencePolicyParser,
  }),
  query("workspace.change.inspect", "Inspect the active workspace change", "/workspace/change", {
    category: "workspace",
    minimumRole: "viewer",
  }),
  command("workspace.evidence.update", "Update evidence consent", "PUT", "/settings/evidence", {
    input: objectParser("evidence consent", (input) => {
      string(input.channel, "evidence channel");
      boolean(input.enabled, "evidence enabled");
    }),
    output: evidencePolicyParser,
    confirmation: "confirm",
  }),
] as const;
