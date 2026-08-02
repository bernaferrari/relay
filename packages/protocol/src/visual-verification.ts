export const VISUAL_COMPARISON_CODES = [
  "VISUAL_MATCH",
  "VISUAL_CHANGED",
  "VISUAL_BASELINE_MISSING",
  "VISUAL_EXPECTED_VARIATION",
] as const;

export type VisualComparisonCode = (typeof VISUAL_COMPARISON_CODES)[number];

export const VISUAL_REVIEW_ACTIONS = [
  "approve-new-baseline",
  "keep-baseline",
  "fix-connection",
  "retry",
  "mark-expected-variation",
] as const;

export type VisualReviewAction = (typeof VISUAL_REVIEW_ACTIONS)[number];

export type VisualReviewResultCode =
  | "VISUAL_BASELINE_APPROVED"
  | "VISUAL_BASELINE_KEPT"
  | "VISUAL_FIX_REQUESTED"
  | "VISUAL_RETRY_REQUESTED"
  | "VISUAL_EXPECTED_VARIATION_RECORDED";

export type VisualReviewActor = { id: string; kind: "human" | "agent" | "system" };

export type VisualFrameMetadata = {
  index: number;
  path: string;
  artifactPath?: string;
  caption: string;
  capturedAt: number;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
};

export type VisualRunSnapshot = {
  schemaVersion: 1;
  runId: string;
  recipeId: string;
  projectKey: string;
  targetKey: string;
  platform?: string;
  targetProfileId?: string;
  appVersion?: string;
  capturedAt: number;
  frameCount: number;
  aggregateSha256: string;
  frames: VisualFrameMetadata[];
};

export type VisualBaseline = {
  schemaVersion: 2;
  id: string;
  recipeId: string;
  projectKey: string;
  targetKey: string;
  runId: string;
  approvedAt: number;
  approvedBy: VisualReviewActor;
  approved: VisualRunSnapshot;
};

export type VisualFrameDiff = {
  index: number;
  code: "FRAME_MATCH" | "FRAME_CHANGED" | "FRAME_ADDED" | "FRAME_REMOVED";
  approved?: VisualFrameMetadata;
  latest?: VisualFrameMetadata;
};

export type VisualDiffMetadata = {
  algorithm: "exact-png-sha256-v1";
  code: VisualComparisonCode;
  approvedFrameCount: number;
  latestFrameCount: number;
  matchedFrames: number;
  changedFrames: number;
  addedFrames: number;
  removedFrames: number;
  frames: VisualFrameDiff[];
};

export type VisualComparison = {
  schemaVersion: 1;
  id: string;
  recipeId: string;
  projectKey: string;
  targetKey: string;
  comparedAt: number;
  code: VisualComparisonCode;
  baseline: VisualBaseline | null;
  approved: VisualRunSnapshot | null;
  latest: VisualRunSnapshot;
  diff: VisualDiffMetadata;
};

export type VisualReviewDecision = {
  schemaVersion: 1;
  id: string;
  comparisonId: string;
  recipeId: string;
  projectKey: string;
  targetKey: string;
  latestRunId: string;
  baselineId?: string;
  action: VisualReviewAction;
  resultCode: VisualReviewResultCode;
  actor: VisualReviewActor;
  decidedAt: number;
  note?: string;
  approvedBaselineId?: string;
};
