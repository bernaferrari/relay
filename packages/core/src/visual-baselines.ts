import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import {
  VISUAL_COMPARISON_CODES,
  VISUAL_REVIEW_ACTIONS,
  type VisualBaseline,
  type VisualComparison,
  type VisualComparisonCode,
  type VisualComparisonPolicy,
  type VisualDiffMetadata,
  type VisualFrameDiff,
  type VisualFrameMetadata,
  type VisualRegion,
  type VisualReviewAction,
  type VisualReviewActor,
  type VisualReviewDecision,
  type VisualReviewResultCode,
  type VisualRunSnapshot,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { withIdentityIgnoreRegions } from "./visual-identity-ignore-regions.js";

export { VISUAL_COMPARISON_CODES, VISUAL_REVIEW_ACTIONS } from "@relay/protocol";
export type {
  VisualBaseline,
  VisualComparison,
  VisualComparisonCode,
  VisualComparisonPolicy,
  VisualDiffMetadata,
  VisualFrameDiff,
  VisualFrameMetadata,
  VisualRegion,
  VisualReviewAction,
  VisualReviewActor,
  VisualReviewDecision,
  VisualReviewResultCode,
  VisualRunSnapshot,
} from "@relay/protocol";

export type VisualVerificationErrorCode =
  | "VISUAL_RUN_HAS_NO_FRAMES"
  | "VISUAL_FRAME_UNREADABLE"
  | "VISUAL_FRAME_INVALID_PNG"
  | "VISUAL_COMPARISON_NOT_FOUND"
  | "VISUAL_COMPARISON_RUN_MISMATCH"
  | "VISUAL_REVIEW_AGENT_FORBIDDEN"
  | "VISUAL_POLICY_INVALID"
  | "VISUAL_POLICY_REVISION_CONFLICT";

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
const POLICIES_FILE = ".visual-policies.json";
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

function isFiniteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRegion(value: unknown): value is VisualRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  return (
    typeof region.id === "string" &&
    typeof region.name === "string" &&
    (region.mode === "compare" || region.mode === "ignore") &&
    Number.isInteger(region.frameIndex) &&
    (region.frameIndex as number) >= 0 &&
    isFiniteUnit(region.x) &&
    isFiniteUnit(region.y) &&
    isFiniteUnit(region.width) &&
    isFiniteUnit(region.height) &&
    (region.width as number) > 0 &&
    (region.height as number) > 0 &&
    (region.x as number) + (region.width as number) <= 1.000_001 &&
    (region.y as number) + (region.height as number) <= 1.000_001
  );
}

function isPolicy(value: unknown): value is VisualComparisonPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as Record<string, unknown>;
  return (
    policy.schemaVersion === 1 &&
    typeof policy.id === "string" &&
    typeof policy.recipeId === "string" &&
    typeof policy.projectKey === "string" &&
    typeof policy.targetKey === "string" &&
    Number.isInteger(policy.revision) &&
    (policy.revision as number) >= 0 &&
    isFiniteUnit(policy.changeThreshold) &&
    typeof policy.pixelThreshold === "number" &&
    Number.isInteger(policy.pixelThreshold) &&
    (policy.pixelThreshold as number) >= 0 &&
    (policy.pixelThreshold as number) <= 255 &&
    Array.isArray(policy.regions) &&
    policy.regions.every(isRegion) &&
    typeof policy.updatedAt === "number" &&
    isActor(policy.updatedBy)
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
    isPolicy(item.policy) &&
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
  item: Pick<
    VisualBaseline | VisualComparison | VisualComparisonPolicy,
    "recipeId" | "projectKey" | "targetKey"
  >,
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

function policyId(recipeId: string, targetKey: string, expectedProjectKey: string): string {
  return `visual-policy-${createHash("sha256")
    .update(`${expectedProjectKey}:${recipeId}:${targetKey}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function defaultPolicy(
  recipeId: string,
  targetKey: string,
  expectedProjectKey: string,
): VisualComparisonPolicy {
  return {
    schemaVersion: 1,
    id: policyId(recipeId, targetKey, expectedProjectKey),
    recipeId,
    projectKey: expectedProjectKey,
    targetKey,
    revision: 0,
    changeThreshold: 0.0035,
    pixelThreshold: 16,
    regions: [],
    updatedAt: 0,
    updatedBy: { id: "relay-default", kind: "system" },
  };
}

export async function getVisualComparisonPolicy(
  root: string,
  run: Pick<PersistedRun, "action" | "projectId" | "targetProfile" | "serial" | "platform">,
): Promise<VisualComparisonPolicy> {
  const expectedProjectKey = projectKey(run);
  const targetKey = visualTargetKey(run);
  const policies = await readArray(storePath(root, POLICIES_FILE), isPolicy);
  return (
    policies.find((policy) => sameScope(policy, run.action, targetKey, expectedProjectKey)) ??
    defaultPolicy(run.action, targetKey, expectedProjectKey)
  );
}

function validateRegions(regions: VisualRegion[]): void {
  if (regions.length > 100 || !regions.every(isRegion)) {
    throw new VisualVerificationError(
      "VISUAL_POLICY_INVALID",
      "Visual regions must be valid normalized rectangles and are limited to 100",
      "Draw smaller compare or ignore regions inside the screenshot, then save again.",
    );
  }
  if (new Set(regions.map((region) => region.id)).size !== regions.length) {
    throw new VisualVerificationError(
      "VISUAL_POLICY_INVALID",
      "Visual region IDs must be unique",
      "Remove the duplicate region and save the visual policy again.",
    );
  }
}

export async function updateVisualComparisonPolicy(
  root: string,
  run: Pick<PersistedRun, "action" | "projectId" | "targetProfile" | "serial" | "platform">,
  input: {
    expectedRevision: number;
    changeThreshold: number;
    pixelThreshold: number;
    regions: VisualRegion[];
    actor: VisualReviewActor;
  },
): Promise<VisualComparisonPolicy> {
  validateRegions(input.regions);
  if (
    !isFiniteUnit(input.changeThreshold) ||
    !Number.isInteger(input.pixelThreshold) ||
    input.pixelThreshold < 0 ||
    input.pixelThreshold > 255
  ) {
    throw new VisualVerificationError(
      "VISUAL_POLICY_INVALID",
      "Visual comparison thresholds are outside their supported range",
      "Use a change threshold from 0 to 1 and a pixel threshold from 0 to 255.",
    );
  }
  return serializeWrite(root, async () => {
    const policies = await readArray(storePath(root, POLICIES_FILE), isPolicy);
    const current =
      policies.find((policy) =>
        sameScope(policy, run.action, visualTargetKey(run), projectKey(run)),
      ) ?? defaultPolicy(run.action, visualTargetKey(run), projectKey(run));
    if (current.revision !== input.expectedRevision) {
      throw new VisualVerificationError(
        "VISUAL_POLICY_REVISION_CONFLICT",
        `Visual policy changed from revision ${input.expectedRevision} to ${current.revision}`,
        "Reload the comparison policy, review the other changes, and save again.",
      );
    }
    const next: VisualComparisonPolicy = {
      ...current,
      revision: current.revision + 1,
      changeThreshold: input.changeThreshold,
      pixelThreshold: input.pixelThreshold,
      regions: input.regions.map((region) => ({ ...region })),
      updatedAt: Date.now(),
      updatedBy: input.actor,
    };
    await writeArray(root, POLICIES_FILE, [
      ...policies.filter(
        (policy) => !sameScope(policy, next.recipeId, next.targetKey, next.projectKey),
      ),
      next,
    ]);
    return next;
  });
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

export async function readVisualBaselineFrame(
  root: string,
  baselineId: string,
  frameIndex: number,
): Promise<Buffer | null> {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) return null;
  const baselines = await readArray(storePath(root, BASELINES_FILE), isBaseline);
  const baseline = baselines.find((item) => item.id === baselineId);
  const artifactPath = baseline?.approved.frames[frameIndex]?.artifactPath;
  if (!baseline || !artifactPath) return null;
  const expectedPrefix = `${BASELINE_ARTIFACTS}/${baseline.id}/`;
  if (!artifactPath.startsWith(expectedPrefix) || artifactPath.includes("..")) return null;
  try {
    return await readFile(join(root, artifactPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
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

type DecodedPng = { width: number; height: number; data: Buffer };

function regionContains(region: VisualRegion, x: number, y: number): boolean {
  return (
    x >= region.x && y >= region.y && x <= region.x + region.width && y <= region.y + region.height
  );
}

function compareDecodedFrames(
  approved: DecodedPng,
  latest: DecodedPng,
  policy: VisualComparisonPolicy,
  frameIndex: number,
): Pick<
  VisualFrameDiff,
  "code" | "consideredPixels" | "changedPixels" | "changeRatio" | "changedBounds"
> {
  if (approved.width !== latest.width || approved.height !== latest.height) {
    return {
      code: "FRAME_CHANGED",
      consideredPixels: latest.width * latest.height,
      changedPixels: latest.width * latest.height,
      changeRatio: 1,
      changedBounds: { x: 0, y: 0, width: 1, height: 1 },
    };
  }
  const frameRegions = policy.regions.filter((region) => region.frameIndex === frameIndex);
  const compareRegions = frameRegions.filter((region) => region.mode === "compare");
  const ignoredRegions = frameRegions.filter((region) => region.mode === "ignore");
  let consideredPixels = 0;
  let changedPixels = 0;
  let minX = latest.width;
  let minY = latest.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < latest.height; y += 1) {
    const normalizedY = (y + 0.5) / latest.height;
    for (let x = 0; x < latest.width; x += 1) {
      const normalizedX = (x + 0.5) / latest.width;
      if (
        (compareRegions.length > 0 &&
          !compareRegions.some((region) => regionContains(region, normalizedX, normalizedY))) ||
        ignoredRegions.some((region) => regionContains(region, normalizedX, normalizedY))
      ) {
        continue;
      }
      consideredPixels += 1;
      const offset = (y * latest.width + x) * 4;
      let pixelChanged = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (
          Math.abs(latest.data[offset + channel]! - approved.data[offset + channel]!) >
          policy.pixelThreshold
        ) {
          pixelChanged = true;
          break;
        }
      }
      if (!pixelChanged) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const changeRatio = consideredPixels === 0 ? 0 : changedPixels / consideredPixels;
  return {
    code: changeRatio > policy.changeThreshold ? "FRAME_CHANGED" : "FRAME_MATCH",
    consideredPixels,
    changedPixels,
    changeRatio,
    ...(changedPixels > 0
      ? {
          changedBounds: {
            x: minX / latest.width,
            y: minY / latest.height,
            width: (maxX - minX + 1) / latest.width,
            height: (maxY - minY + 1) / latest.height,
          },
        }
      : {}),
  };
}

async function readDecodedPng(path: string): Promise<DecodedPng> {
  return PNG.sync.read(await readFile(path));
}

async function buildDiff(
  root: string,
  run: PersistedRun,
  approved: VisualRunSnapshot | null,
  latest: VisualRunSnapshot,
  policy: VisualComparisonPolicy,
  expectedVariation: boolean,
): Promise<VisualDiffMetadata> {
  if (!approved) {
    return {
      algorithm: "pixel-rgba-regions-v1",
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
      policyRevision: policy.revision,
    };
  }
  const frameCount = Math.max(approved.frames.length, latest.frames.length);
  const frames: VisualFrameDiff[] = [];
  for (let index = 0; index < frameCount; index++) {
    const prior = approved.frames[index];
    const current = latest.frames[index];
    if (prior && current) {
      const approvedPath = prior.artifactPath
        ? join(root, prior.artifactPath)
        : join(run.dir, "frames", safeFrameName(prior.path, index));
      const latestPath = join(run.dir, "frames", safeFrameName(current.path, index));
      const pixelDiff =
        prior.sha256 === current.sha256
          ? {
              code: "FRAME_MATCH" as const,
              consideredPixels: (current.width ?? 0) * (current.height ?? 0),
              changedPixels: 0,
              changeRatio: 0,
            }
          : compareDecodedFrames(
              await readDecodedPng(approvedPath),
              await readDecodedPng(latestPath),
              policy,
              index,
            );
      frames.push({ index, approved: prior, latest: current, ...pixelDiff });
    } else {
      frames.push(
        prior
          ? { index, code: "FRAME_REMOVED", approved: prior }
          : { index, code: "FRAME_ADDED", latest: current! },
      );
    }
  }
  const count = (code: VisualFrameDiff["code"]) =>
    frames.filter((frame) => frame.code === code).length;
  const changed = frames.some((frame) => frame.code !== "FRAME_MATCH");
  return {
    algorithm: "pixel-rgba-regions-v1",
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
    policyRevision: policy.revision,
  };
}

function deterministicComparisonId(
  baseline: VisualBaseline | null,
  latest: VisualRunSnapshot,
  policy: VisualComparisonPolicy,
): string {
  return `visual-comparison-${createHash("sha256")
    .update(
      `${baseline?.id ?? "none"}:${latest.runId}:${latest.aggregateSha256}:${policy.id}:${policy.revision}`,
    )
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
  const policy = withIdentityIgnoreRegions(
    await getVisualComparisonPolicy(root, run),
    run.artifacts ?? [],
    latest.frames,
  );
  const expectedVariation = await hasExpectedVariation(root, baseline, latest);
  const diff = await buildDiff(
    root,
    run,
    baseline?.approved ?? null,
    latest,
    policy,
    expectedVariation,
  );
  const comparison: VisualComparison = {
    schemaVersion: 1,
    id: deterministicComparisonId(baseline, latest, policy),
    recipeId: run.action,
    projectKey: latest.projectKey,
    targetKey: latest.targetKey,
    comparedAt: Date.now(),
    code: diff.code,
    baseline,
    approved: baseline?.approved ?? null,
    latest,
    policy,
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

function assertHumanVisualReviewActor(actor: VisualReviewActor): void {
  if (actor.kind === "agent" || actor.id.startsWith("agent:")) {
    throw new VisualVerificationError(
      "VISUAL_REVIEW_AGENT_FORBIDDEN",
      "Visual review requires a human actor; agent:* cannot approve or reject visual comparisons.",
      "Retry as human:local-cli, or approve from Report → Compare screenshots.",
    );
  }
}

/** Records an explicit human review decision. Only approval mutates a baseline. */
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
  assertHumanVisualReviewActor(input.actor);
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
