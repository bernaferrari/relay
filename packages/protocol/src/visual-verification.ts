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

export type VisualRegionMode = "compare" | "ignore";

/** A device-independent rectangle. Coordinates are normalized to the captured frame. */
export type VisualRegion = {
  id: string;
  name: string;
  mode: VisualRegionMode;
  frameIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualComparisonPolicy = {
  schemaVersion: 1;
  id: string;
  recipeId: string;
  projectKey: string;
  targetKey: string;
  revision: number;
  /** Fraction of considered pixels that may change before review is required. */
  changeThreshold: number;
  /** Per-channel difference required before one pixel is considered changed. */
  pixelThreshold: number;
  regions: VisualRegion[];
  updatedAt: number;
  updatedBy: VisualReviewActor;
};

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
  consideredPixels?: number;
  changedPixels?: number;
  changeRatio?: number;
  /** Normalized bounds of changed pixels within the complete frame. */
  changedBounds?: { x: number; y: number; width: number; height: number };
};

export type VisualDiffMetadata = {
  algorithm: "pixel-rgba-regions-v1";
  code: VisualComparisonCode;
  approvedFrameCount: number;
  latestFrameCount: number;
  matchedFrames: number;
  changedFrames: number;
  addedFrames: number;
  removedFrames: number;
  frames: VisualFrameDiff[];
  policyRevision: number;
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
  policy: VisualComparisonPolicy;
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
