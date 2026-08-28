import type { ApprovalPolicyDecision, ExecutionRisk } from "./approval-policy.js";
import type { SourceRevision } from "./source-revision.js";
import type { TracePack } from "./trace-pack.js";

export const VERIFY_CHANGE_MAX_IDS = 128;
export const VERIFY_CHANGE_MAX_TRACE_PACKS = 32;

export type VerifyChangeSelection =
  | { kind: "tests"; appMapId: string; testIds: readonly string[] }
  | { kind: "runs"; runIds: readonly string[] }
  | { kind: "trace-packs"; tracePacks: readonly TracePack[] }
  | { kind: "source-revision"; sourceRevision: SourceRevision; appMapId?: string };

export type VerifyChangeIntent = {
  kind: "verify-change";
  selection: VerifyChangeSelection;
  /** Confirmation is never inferred from a historical mutation. */
  confirmationSatisfied?: boolean;
};

export type VerifyChangeEvidence = {
  runId: string;
  tracePackDigest: string;
  status: "complete" | "partial";
  historicalVerdict: "proved" | "failed" | "insufficient-evidence";
  appMapId?: string;
  testId?: string;
};

export type VerifyChangeResult = {
  schemaVersion: 1;
  kind: "verify-change";
  mode: "offline";
  selection: { kind: VerifyChangeSelection["kind"]; sourceRevision?: SourceRevision };
  affectedTests: ReadonlyArray<{
    appMapId?: string;
    testId: string;
    executionRisk: ExecutionRisk;
  }>;
  evidence: readonly VerifyChangeEvidence[];
  firstCausalFailure?: {
    runId: string;
    testId?: string;
    checkId: string;
    title: string;
    kind: "action-no-op" | "transition-unproved" | "unproved-pass" | "recorded-failure";
    error?: string;
    evidence: readonly string[];
  };
  policy: ApprovalPolicyDecision["policy"];
  decision: ApprovalPolicyDecision["decision"];
  execution: ApprovalPolicyDecision["execution"];
  ruleIds: readonly string[];
  reasons: readonly string[];
  evidenceRefs: readonly string[];
  unresolvedUncertainty: readonly string[];
  mutation: "none";
  checkPosting: "none";
};
