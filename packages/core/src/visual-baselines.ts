import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PersistedRun } from "./runs.js";

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

export type VisualReviewActor = {
  id: string;
  kind: "human" | "agent" | "system";
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

export type VisualVerificationErrorCode =
  | "VISUAL_RUN_HAS_NO_FRAMES"
  | "VISUAL_FRAME_UNREADABLE"
  | "VISUAL_FRAME_INVALID_PNG"
  | "VISUAL_COMPARISON_NOT_FOUND"
  | "VISUAL_COMPARISON_RUN_MISMATCH";

export class VisualVerificationError extends Error {
  constructor(
    readonly code: VisualVerificationErrorCode,
    message: string,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "VisualVerificationError";
  }
}

const BASELINES_FILE = ".visual-baselines.json";
const COMPARISONS_FILE = ".visual-comparisons.json";
const REVIEWS_FILE = ".visual-reviews.json";
const BASELINE_ARTIFACTS = ".visual-baseline-artifacts";
const writeQueues = new Map<string, Promise<void>>();

function storePath(root: string, file: string): string {
  return join(root, file);
}

function projectKey(run: Pick<PersistedRun, "projectId">): string {
  return run.projectId?.trim() || "local";
}

function isActor(value: unknown): value is VisualReviewActor {
  if (!value || typeof value !== "object") return false;
  const actor = value as Record<string, unknown>;
  return (
    typeof actor.id === "string" &&
    (actor.kind === "human" || actor.kind === "agent" || actor.kind === "system")
  );
}

function isSnapshot(value: unknown): value is VisualRunSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.schemaVersion === 1 &&
    typeof snapshot.runId === "string" &&
    typeof snapshot.recipeId === "string" &&
    typeof snapshot.projectKey === "string" &&
    typeof snapshot.targetKey === "string" &&
    typeof snapshot.aggregateSha256 === "string" &&
    typeof snapshot.frameCount === "number" &&
    Array.isArray(snapshot.frames)
  );
}

function isBaseline(value: unknown): value is VisualBaseline {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 2 &&
    typeof item.id === "string" &&
    typeof item.recipeId === "string" &&
    typeof item.projectKey === "string" &&
    typeof item.targetKey === "string" &&
    typeof item.runId === "string" &&
    typeof item.approvedAt === "number" &&
    isActor(item.approvedBy) &&
    isSnapshot(item.approved)
  );
}

function isComparison(value: unknown): value is VisualComparison {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 1 &&
    typeof item.id === "string" &&
    typeof item.recipeId === "string" &&
    typeof item.projectKey === "string" &&
    typeof item.targetKey === "string" &&
    typeof item.comparedAt === "number" &&
    VISUAL_COMPARISON_CODES.includes(item.code as VisualComparisonCode) &&
    (item.baseline === null || isBaseline(item.baseline)) &&
    (item.approved === null || isSnapshot(item.approved)) &&
    isSnapshot(item.latest) &&
    Boolean(item.diff && typeof item.diff === "object")
  );
}

function isReview(value: unknown): value is VisualReviewDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 1 &&
    typeof item.id === "string" &&
    typeof item.comparisonId === "string" &&
    typeof item.recipeId === "string" &&
    typeof item.projectKey === "string" &&
    typeof item.targetKey === "string" &&
    typeof item.latestRunId === "string" &&
    VISUAL_REVIEW_ACTIONS.includes(item.action as VisualReviewAction) &&
    isActor(item.actor) &&
    typeof item.decidedAt === "number"
  );
}

async function readArray<T>(path: string, guard: (value: unknown) => value is T): Promise<T[]> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(value) ? value.filter(guard) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeArray(root: string, file: string, values: readonly unknown[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = storePath(root, file);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function serializeWrite<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(root) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => next);
  writeQueues.set(root, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (writeQueues.get(root) === queued) writeQueues.delete(root);
  }
}

/** A baseline only compares like-for-like within a project and target profile. */
export function visualTargetKey(
  run: Pick<PersistedRun, "targetProfile" | "serial" | "platform">,
): string {
  return run.targetProfile?.id ?? run.serial ?? run.platform ?? "default";
}

function sameScope(
  item: Pick<VisualBaseline | VisualComparison, "recipeId" | "projectKey" | "targetKey">,
  recipeId: string,
  targetKey: string,
  expectedProjectKey: string,
): boolean {
  return (
    item.recipeId === recipeId &&
    item.targetKey === targetKey &&
    item.projectKey === expectedProjectKey
  );
}

export async function getVisualBaseline(
  root: string,
  recipeId: string,
  targetKey: string,
  expectedProjectKey = "local",
): Promise<VisualBaseline | null> {
  const baselines = await readArray(storePath(root, BASELINES_FILE), isBaseline);
  return (
    baselines.find((baseline) => sameScope(baseline, recipeId, targetKey, expectedProjectKey)) ??
    null
  );
}

export async function getVisualComparison(
  root: string,
  comparisonId: string,
): Promise<VisualComparison | null> {
  const comparisons = await readArray(storePath(root, COMPARISONS_FILE), isComparison);
  return comparisons.find((comparison) => comparison.id === comparisonId) ?? null;
}

export async function listVisualReviews(
  root: string,
  comparisonId: string,
): Promise<VisualReviewDecision[]> {
  const reviews = await readArray(storePath(root, REVIEWS_FILE), isReview);
  return reviews.filter((review) => review.comparisonId === comparisonId);
}

function safeFrameName(path: string, index: number): string {
  const file = basename(path);
  if (!file || !/\.png$/iu.test(file)) return `${String(index + 1).padStart(3, "0")}.png`;
  return file;
}

function pngDimensions(
  bytes: Buffer,
  runId: string,
  frameIndex: number,
): {
  width: number;
  height: number;
} {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const validHeader =
    bytes.length >= 24 &&
    bytes.subarray(0, signature.length).equals(signature) &&
    bytes.toString("ascii", 12, 16) === "IHDR";
  if (!validHeader) {
    throw new VisualVerificationError(
      "VISUAL_FRAME_INVALID_PNG",
      `Frame ${frameIndex + 1} from run ${runId} is not a valid PNG artifact`,
      "Recapture the screenshot as PNG before visual review.",
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new VisualVerificationError(
      "VISUAL_FRAME_INVALID_PNG",
      `Frame ${frameIndex + 1} from run ${runId} has invalid dimensions`,
      "Recapture the screenshot as PNG before visual review.",
    );
  }
  return { width, height };
}

async function snapshotRun(
  run: Pick<
    PersistedRun,
    | "id"
    | "action"
    | "projectId"
    | "targetProfile"
    | "serial"
    | "platform"
    | "appVersion"
    | "finishedAt"
    | "writtenAt"
    | "frames"
    | "dir"
  >,
  artifactDirectory?: { absolute: string; relative: string },
): Promise<VisualRunSnapshot> {
  if (run.frames.length === 0) {
    throw new VisualVerificationError(
      "VISUAL_RUN_HAS_NO_FRAMES",
      `Run ${run.id} has no PNG frames to compare`,
      "Capture at least one screenshot and run the comparison again.",
    );
  }
  if (artifactDirectory) await mkdir(artifactDirectory.absolute, { recursive: true });
  const frames: VisualFrameMetadata[] = [];
  for (const [index, frame] of run.frames.entries()) {
    const file = safeFrameName(frame.path, index);
    let bytes: Buffer;
    try {
      bytes = await readFile(join(run.dir, "frames", file));
    } catch {
      throw new VisualVerificationError(
        "VISUAL_FRAME_UNREADABLE",
        `Frame ${index + 1} from run ${run.id} is unavailable`,
        "Restore or recapture the run evidence before reviewing it.",
      );
    }
    const dimensions = pngDimensions(bytes, run.id, index);
    const artifactPath = artifactDirectory ? join(artifactDirectory.relative, file) : undefined;
    if (artifactDirectory) {
      await copyFile(join(run.dir, "frames", file), join(artifactDirectory.absolute, file));
    }
    frames.push({
      index,
      path: frame.path,
      ...(artifactPath ? { artifactPath } : {}),
      caption: frame.caption,
      capturedAt: frame.capturedAt,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: dimensions.width,
      height: dimensions.height,
    });
  }
  const aggregateSha256 = createHash("sha256")
    .update(frames.map((frame) => `${frame.index}:${frame.sha256}`).join("\n"))
    .digest("hex");
  const profileId = run.targetProfile?.id;
  return {
    schemaVersion: 1,
    runId: run.id,
    recipeId: run.action,
    projectKey: projectKey(run),
    targetKey: visualTargetKey(run),
    ...(run.platform ? { platform: run.platform } : {}),
    ...(profileId ? { targetProfileId: profileId } : {}),
    ...(run.appVersion ? { appVersion: run.appVersion } : {}),
    capturedAt: run.finishedAt ?? run.writtenAt,
    frameCount: frames.length,
    aggregateSha256,
    frames,
  };
}

function buildDiff(
  approved: VisualRunSnapshot | null,
  latest: VisualRunSnapshot,
  expectedVariation: boolean,
): VisualDiffMetadata {
  if (!approved) {
    return {
      algorithm: "exact-png-sha256-v1",
      code: "VISUAL_BASELINE_MISSING",
      approvedFrameCount: 0,
      latestFrameCount: latest.frameCount,
      matchedFrames: 0,
      changedFrames: 0,
      addedFrames: latest.frameCount,
      removedFrames: 0,
      frames: latest.frames.map((frame) => ({
        index: frame.index,
        code: "FRAME_ADDED",
        latest: frame,
      })),
    };
  }
  const frameCount = Math.max(approved.frames.length, latest.frames.length);
  const frames: VisualFrameDiff[] = [];
  for (let index = 0; index < frameCount; index++) {
    const prior = approved.frames[index];
    const current = latest.frames[index];
    frames.push(
      prior && current
        ? {
            index,
            code: prior.sha256 === current.sha256 ? "FRAME_MATCH" : "FRAME_CHANGED",
            approved: prior,
            latest: current,
          }
        : prior
          ? { index, code: "FRAME_REMOVED", approved: prior }
          : { index, code: "FRAME_ADDED", latest: current! },
    );
  }
  const count = (code: VisualFrameDiff["code"]) =>
    frames.filter((frame) => frame.code === code).length;
  const changed = frames.some((frame) => frame.code !== "FRAME_MATCH");
  return {
    algorithm: "exact-png-sha256-v1",
    code: changed
      ? expectedVariation
        ? "VISUAL_EXPECTED_VARIATION"
        : "VISUAL_CHANGED"
      : "VISUAL_MATCH",
    approvedFrameCount: approved.frameCount,
    latestFrameCount: latest.frameCount,
    matchedFrames: count("FRAME_MATCH"),
    changedFrames: count("FRAME_CHANGED"),
    addedFrames: count("FRAME_ADDED"),
    removedFrames: count("FRAME_REMOVED"),
    frames,
  };
}

function deterministicComparisonId(
  baseline: VisualBaseline | null,
  latest: VisualRunSnapshot,
): string {
  return `visual-comparison-${createHash("sha256")
    .update(`${baseline?.id ?? "none"}:${latest.runId}:${latest.aggregateSha256}`)
    .digest("hex")
    .slice(0, 24)}`;
}

async function hasExpectedVariation(
  root: string,
  baseline: VisualBaseline | null,
  latest: VisualRunSnapshot,
): Promise<boolean> {
  if (!baseline) return false;
  const comparisons = await readArray(storePath(root, COMPARISONS_FILE), isComparison);
  const reviews = await readArray(storePath(root, REVIEWS_FILE), isReview);
  const expectedComparisonIds = new Set(
    reviews
      .filter(
        (review) =>
          review.action === "mark-expected-variation" && review.baselineId === baseline.id,
      )
      .map((review) => review.comparisonId),
  );
  return comparisons.some(
    (comparison) =>
      expectedComparisonIds.has(comparison.id) &&
      comparison.latest.aggregateSha256 === latest.aggregateSha256,
  );
}

/**
 * Computes and persists deterministic review evidence. This operation never
 * changes an approved baseline, even when the frames match exactly.
 */
export async function compareVisualBaseline(
  root: string,
  run: PersistedRun,
): Promise<VisualComparison> {
  const latest = await snapshotRun(run);
  const baseline = await getVisualBaseline(root, run.action, latest.targetKey, latest.projectKey);
  const expectedVariation = await hasExpectedVariation(root, baseline, latest);
  const diff = buildDiff(baseline?.approved ?? null, latest, expectedVariation);
  const comparison: VisualComparison = {
    schemaVersion: 1,
    id: deterministicComparisonId(baseline, latest),
    recipeId: run.action,
    projectKey: latest.projectKey,
    targetKey: latest.targetKey,
    comparedAt: Date.now(),
    code: diff.code,
    baseline,
    approved: baseline?.approved ?? null,
    latest,
    diff,
  };
  return serializeWrite(root, async () => {
    const existing = await readArray(storePath(root, COMPARISONS_FILE), isComparison);
    await writeArray(root, COMPARISONS_FILE, [
      ...existing.filter((item) => item.id !== comparison.id),
      comparison,
    ]);
    return comparison;
  });
}

/** Human approval snapshots immutable PNG evidence; it never rewrites a run. */
export async function approveVisualBaseline(
  root: string,
  run: PersistedRun,
  approvedBy: VisualReviewActor = { id: "local-user", kind: "human" },
): Promise<VisualBaseline> {
  return serializeWrite(root, async () => {
    const approvedAt = Date.now();
    const id = `visual-baseline-${createHash("sha256")
      .update(`${projectKey(run)}:${run.action}:${visualTargetKey(run)}:${run.id}:${approvedAt}`)
      .digest("hex")
      .slice(0, 24)}`;
    const artifactDirectory = {
      absolute: join(root, BASELINE_ARTIFACTS, id),
      relative: join(BASELINE_ARTIFACTS, id),
    };
    const approved = await snapshotRun(run, artifactDirectory);
    const next: VisualBaseline = {
      schemaVersion: 2,
      id,
      recipeId: run.action,
      projectKey: approved.projectKey,
      targetKey: approved.targetKey,
      runId: run.id,
      approvedAt,
      approvedBy,
      approved,
    };
    const existing = await readArray(storePath(root, BASELINES_FILE), isBaseline);
    await writeArray(root, BASELINES_FILE, [
      ...existing.filter(
        (item) => !sameScope(item, next.recipeId, next.targetKey, next.projectKey),
      ),
      next,
    ]);
    return next;
  });
}

const REVIEW_RESULT_CODES: Record<VisualReviewAction, VisualReviewResultCode> = {
  "approve-new-baseline": "VISUAL_BASELINE_APPROVED",
  "keep-baseline": "VISUAL_BASELINE_KEPT",
  "fix-connection": "VISUAL_FIX_REQUESTED",
  retry: "VISUAL_RETRY_REQUESTED",
  "mark-expected-variation": "VISUAL_EXPECTED_VARIATION_RECORDED",
};

/** Records an explicit human/agent review decision. Only approval mutates a baseline. */
export async function reviewVisualComparison(
  root: string,
  run: PersistedRun,
  input: {
    comparisonId: string;
    action: VisualReviewAction;
    actor: VisualReviewActor;
    note?: string;
  },
): Promise<{ decision: VisualReviewDecision; baseline: VisualBaseline | null }> {
  const comparison = await getVisualComparison(root, input.comparisonId);
  if (!comparison) {
    throw new VisualVerificationError(
      "VISUAL_COMPARISON_NOT_FOUND",
      `Visual comparison ${input.comparisonId} was not found`,
      "Compare the run again, then review the returned comparison ID.",
    );
  }
  if (
    comparison.latest.runId !== run.id ||
    comparison.projectKey !== projectKey(run) ||
    comparison.targetKey !== visualTargetKey(run)
  ) {
    throw new VisualVerificationError(
      "VISUAL_COMPARISON_RUN_MISMATCH",
      `Visual comparison ${input.comparisonId} does not belong to run ${run.id}`,
      "Use the comparison ID returned for this exact run and target.",
    );
  }
  const baseline =
    input.action === "approve-new-baseline"
      ? await approveVisualBaseline(root, run, input.actor)
      : comparison.baseline;
  const decision: VisualReviewDecision = {
    schemaVersion: 1,
    id: `visual-review-${randomUUID()}`,
    comparisonId: comparison.id,
    recipeId: comparison.recipeId,
    projectKey: comparison.projectKey,
    targetKey: comparison.targetKey,
    latestRunId: run.id,
    ...(comparison.baseline ? { baselineId: comparison.baseline.id } : {}),
    action: input.action,
    resultCode: REVIEW_RESULT_CODES[input.action],
    actor: input.actor,
    decidedAt: Date.now(),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(baseline && input.action === "approve-new-baseline"
      ? { approvedBaselineId: baseline.id }
      : {}),
  };
  await serializeWrite(root, async () => {
    const existing = await readArray(storePath(root, REVIEWS_FILE), isReview);
    await writeArray(root, REVIEWS_FILE, [...existing, decision]);
  });
  return { decision, baseline };
}
