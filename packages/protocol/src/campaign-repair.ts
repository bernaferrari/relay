export type CampaignRepairActionKind =
  | "continue-and-report"
  | "retry-check"
  | "retarget-proposal"
  | "accept-current-proposal"
  | "repair-test-proposal"
  | "defer-check-proposal";

export type CampaignRepairProposalKind = "retarget" | "accept-current" | "disable";

export type CampaignRepairProposalInput = {
  runId: string;
  checkId: string;
  kind: CampaignRepairProposalKind;
  reason: string;
  /** Required only for retarget. The server accepts this selector only when it
   * exactly matches a successful runtime healing candidate from the source
   * check; arbitrary client-authored locators are rejected. */
  selector?: import("./recipes.js").StepTarget;
  /** Optional same-diff failures to review as one branch. Every target keeps
   * its own immutable evidence and must derive the same document mutation. */
  equivalentTargets?: Array<{ runId: string; checkId: string }>;
};

/** Server-derived lineage and inverse for one reviewed repair branch. */
export type CampaignRepairProposalMetadata = {
  kind: CampaignRepairProposalKind;
  testId: string;
  repairTargetIds: string[];
  sourceRunIds: string[];
  sourceCheckIds: string[];
  evidenceFramePaths: string[];
  equivalentDiffKey: string;
  inverseChanges: import("./app-map.js").ProposalChange[];
  approvedRevision?: number;
  reverted?: import("./app-map.js").ProposalDecision;
};

export type CampaignRepairAction = {
  kind: CampaignRepairActionKind;
  label: string;
  available: boolean;
  mutation: "none" | "new-run" | "reviewed-proposal";
  description: string;
  operationId?: string;
  fixedInput?: Record<string, unknown>;
  requiredInput?: string[];
  unavailableReason?: string;
  /** Guardrails a proposal implementation must retain before this action may
   * become available. They are data, not permission to mutate a baseline. */
  proposalRequirements?: {
    actorAttribution: true;
    priorRevision: true;
    reviewRequired: true;
    inverseEditsForRevert: true;
    equivalentDiffGrouping?: true;
  };
};

/** An immutable failed-check package assembled from one persisted source run.
 * Its stable id is addressable by humans and agents without loading a whole
 * campaign or reconstructing selector attempts from logs. */
export type CampaignRepairTarget = {
  schemaVersion: 1;
  id: string;
  status: "pending";
  defaultAction: "continue-and-report";
  source: {
    runId: string;
    runInputDigest: string;
    checkId: string;
    checkTitle: string;
    action: string;
    capturedAt: number;
    appMapId?: string;
    appMapRevision?: number;
    testId?: string;
  };
  expected: {
    recipeId?: string;
    screenId?: string;
    groupId?: string;
    originScreenId?: string;
    transitionId?: string;
  };
  observed: {
    error: string;
    screenIdentity?: unknown;
    chrome?: unknown;
    accessibility?: unknown;
    navigationRepair?: {
      connectionId: string;
      beforeSelector: import("./recipes.js").StepTarget;
      currentSelector: import("./recipes.js").StepTarget;
      attempts: unknown[];
    };
  };
  evidence: {
    result: unknown;
    failure?: unknown;
    frames: Array<{ index: number; path: string; caption: string; capturedAt: number }>;
  };
  lineage: {
    sourceRunId: string;
    retryOf?: string;
    priorAttempts: Array<{ runId: string; jobId?: string; status?: string; createdAt?: number }>;
  };
  actions: CampaignRepairAction[];
};

/** Compact queue row. Load the exact target only after choosing one check, so
 * an agent never receives every screenshot and accessibility tree at once. */
export type CampaignRepairTargetSummary = Pick<
  CampaignRepairTarget,
  "schemaVersion" | "id" | "status" | "defaultAction" | "source"
> & {
  error: string;
  priorAttemptCount: number;
};
