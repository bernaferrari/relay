export const EXECUTION_RISK_LEVELS = ["safe", "guarded", "destructive", "prohibited"] as const;
export type ExecutionRiskLevel = (typeof EXECUTION_RISK_LEVELS)[number];

export const EXECUTION_EXTERNAL_EFFECTS = [
  "communication",
  "purchase",
  "account-mutation",
  "data-deletion",
  "permission-change",
  "installation",
  "external-app",
] as const;
export type ExecutionExternalEffect = (typeof EXECUTION_EXTERNAL_EFFECTS)[number];

/** Explicit authored effect declaration. The persistence mutation that saves
 * this value is the review boundary; execution never infers these effects
 * from labels, copy, or coordinates. */
export type ReviewedExternalEffects = {
  schemaVersion: 1;
  effects: readonly ExecutionExternalEffect[];
  reviewedBy: string;
  reviewedAt: number;
  reason: string;
};

export type ExecutionRisk = {
  schemaVersion: 1;
  level: ExecutionRiskLevel;
  reasons: ReadonlyArray<{
    stepId?: string;
    code: string;
    explanation: string;
  }>;
  externalEffects: ReadonlyArray<ExecutionExternalEffect>;
  confirmation: "none" | "once-per-run" | "per-step" | "human-only";
  expectedAppBoundaries: readonly string[];
  maximumActions?: number;
  maximumDurationMs?: number;
  cleanupRequired: boolean;
};

export const APPROVAL_FINDING_CATEGORIES = [
  "crash",
  "path-loss",
  "assertion",
  "security",
  "privacy",
  "localization",
  "visual",
  "accessibility",
  "performance",
  "selector",
  "copy-change",
  "new-route",
  "dynamic-content",
  "policy",
] as const;
export type ApprovalFindingCategory = (typeof APPROVAL_FINDING_CATEGORIES)[number];

/**
 * Durable authority for setting one finding aside. The scope is deliberately
 * nested and exact: a review for another finding, run, or evidence revision
 * must never authorize this finding.
 */
export type ApprovalPolicyFindingReview = {
  schemaVersion: 1;
  decisionId: string;
  reviewedBy: string;
  reviewedAt: number;
  reason: string;
  scope: {
    findingId: string;
    runId: string;
    /** Exact complete evidence set current when the decision was recorded. */
    evidenceRefs: readonly string[];
  };
};

export type ApprovalPolicyFinding = {
  id: string;
  /** The persisted run whose current evidence produced this finding. */
  runId: string;
  category: ApprovalFindingCategory;
  severity: "blocker" | "regression" | "review" | "info";
  summary: string;
  evidenceRefs: readonly string[];
  /** A finding review is usable only when its exact scope is current. */
  review?: ApprovalPolicyFindingReview;
};

export type ApprovalPolicyInput = {
  schemaVersion: 1;
  policy: { id: string; version: number };
  executionRisk: ExecutionRisk;
  confirmationSatisfied: boolean;
  evidence: {
    status: "complete" | "partial";
    requiredChannels: readonly string[];
    missing: readonly string[];
    tracePackDigest?: string;
    tracePackDigests?: readonly string[];
    /** Current run/evidence scope used to validate finding reviews. */
    runIds?: readonly string[];
    evidenceRefs?: readonly string[];
  };
  verification: {
    requiredPaths: "passed" | "failed" | "unproven";
    selectorResolution: "deterministic" | "ambiguous" | "unproven";
    unresolved: readonly string[];
  };
  findings: readonly ApprovalPolicyFinding[];
};

export type ApprovalPolicyDecision = {
  schemaVersion: 1;
  policy: { id: string; version: number };
  execution: "allowed" | "confirmation-required" | "blocked";
  decision: "approve" | "reject" | "ask-human" | "insufficient-evidence";
  ruleIds: readonly string[];
  reasons: readonly string[];
  evidenceRefs: readonly string[];
  unresolvedVerification: readonly string[];
  confidence?: { value: 1; basis: "deterministic-policy" };
};
