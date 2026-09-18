/** Provider-neutral decision contracts for optional, review-only model help. */

export const MODEL_DECISION_SCHEMA_VERSION = 1 as const;

export type ModelDecisionJson =
  | null
  | boolean
  | number
  | string
  | ModelDecisionJson[]
  | { [key: string]: ModelDecisionJson };

export type ModelDecisionQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria?: { true?: string; false?: string };
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

export type ModelDecisionRequest = {
  schemaVersion: typeof MODEL_DECISION_SCHEMA_VERSION;
  provider: string;
  model: string;
  state: ModelDecisionJson;
  questions: Record<string, ModelDecisionQuestion>;
  observationDigest?: string;
  questionDigest?: string;
  evidenceRefs?: string[];
};

export type ModelNoulAnswer = {
  type: "noul";
  noul: number;
};

export type ModelChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ModelScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ModelDecisionAnswer = ModelNoulAnswer | ModelChoiceAnswer | ModelScoreAnswer;

export type ModelDecisionUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ModelDecisionRecord = {
  schemaVersion: typeof MODEL_DECISION_SCHEMA_VERSION;
  status: "ok" | "invalid" | "unavailable";
  provider: string;
  /** The exact model returned by the provider when available. */
  model: string;
  requestId: string;
  observationDigest?: string;
  questionDigest?: string;
  answers?: Record<string, ModelDecisionAnswer>;
  usage?: ModelDecisionUsage;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  evidenceRefs: string[];
  error?: {
    code: "provider-unavailable" | "request-rejected" | "invalid-response";
    message: string;
  };
};

/** Additive, review-only triage attached to an existing evidence result. */
export type JevEvidenceTriage = {
  schemaVersion: typeof MODEL_DECISION_SCHEMA_VERSION;
  status: "suggested" | "invalid" | "unavailable";
  provider: "openrouter";
  batchId: string;
  findingIds: string[];
  rationale: string;
  decision: ModelDecisionRecord;
};
