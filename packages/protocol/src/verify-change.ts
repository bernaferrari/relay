import type { ApprovalPolicyDecision, ExecutionRisk } from "./approval-policy.js";
import type { SourceRevision } from "./source-revision.js";
import type { TracePack } from "./trace-pack.js";

export const VERIFY_CHANGE_MAX_IDS = 128;
export const VERIFY_CHANGE_MAX_TRACE_PACKS = 32;
export const VERIFY_CHANGE_MAX_REPORT_ITEMS = 128;

export type VerifyChangeVerdict = "passed" | "regressions" | "review" | "insufficient";

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

export type VerifyChangeAffectedTest = {
  appMapId?: string;
  testId: string;
  executionRisk: ExecutionRisk;
  verdict: VerifyChangeVerdict;
  evidenceRunIds: readonly string[];
};

export type VerifyChangeSummary = {
  verdict: VerifyChangeVerdict;
  affectedTests: number;
  passed: number;
  regressions: number;
  review: number;
  insufficient: number;
};

export type VerifyChangeEvidenceCompleteness = {
  status: "complete" | "partial";
  complete: number;
  partial: number;
  missing: readonly string[];
};

export type VerifyChangeLiveVerification = {
  required: boolean;
  action:
    | "none"
    | "select-and-run-one-test"
    | "run-one-affected-test"
    | "capture-and-preview-selector"
    | "review-and-confirm";
  reason: string;
  appMapId?: string;
  testId?: string;
  evidenceNeeded: readonly string[];
};

export type VerifyChangeResult = {
  schemaVersion: 1;
  kind: "verify-change";
  mode: "offline";
  selection: { kind: VerifyChangeSelection["kind"]; sourceRevision?: SourceRevision };
  summary: VerifyChangeSummary;
  affectedTests: readonly VerifyChangeAffectedTest[];
  evidence: readonly VerifyChangeEvidence[];
  evidenceCompleteness: VerifyChangeEvidenceCompleteness;
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
  /** Confidence in the deterministic classification, not in future device behavior. */
  confidence: NonNullable<ApprovalPolicyDecision["confidence"]>;
  decision: ApprovalPolicyDecision["decision"];
  execution: ApprovalPolicyDecision["execution"];
  ruleIds: readonly string[];
  reasons: readonly string[];
  evidenceRefs: readonly string[];
  unresolvedUncertainty: readonly string[];
  smallestRequiredLiveVerification: VerifyChangeLiveVerification;
  mutation: "none";
  checkPosting: "none";
};
