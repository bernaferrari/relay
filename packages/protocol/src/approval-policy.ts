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

export type ApprovalPolicyFinding = {
  id: string;
  category: ApprovalFindingCategory;
  severity: "blocker" | "regression" | "review" | "info";
  summary: string;
  evidenceRefs: readonly string[];
  /** A reviewed finding is still reported, but no longer blocks this exact decision. */
  reviewed?: boolean;
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
