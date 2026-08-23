import { createHash } from "node:crypto";
import type { RecipeStep } from "./recipes.js";
import type { PersistedRun } from "./runs.js";
import type { TestJob } from "./session-contract.js";

type CaptureSurfaceStep = Extract<RecipeStep, { kind: "capture-surface" }>;

export type SurfaceComparisonCacheIdentity = {
  schemaVersion: 1;
  projectId: string;
  target: {
    profileId: string;
    targetId: string;
    platform: string;
  };
  locale: string;
  appBuild: string;
  surface: {
    screenId: string;
    variantId: string;
    surfaceId: string;
  };
  baseline: {
    captureId: string;
    compositeWidth?: number;
    compositeHeight?: number;
    semanticNodeCount?: number;
  };
};

export type SurfaceComparisonCacheProvenance = {
  schemaVersion: 1;
  status: "hit" | "miss" | "bypassed";
  evaluatedAt: number;
  key?: string;
  identity?: SurfaceComparisonCacheIdentity;
  reason?: string;
  sourceRunId?: string;
  sourceArtifactCapturedAt?: number;
  sourceCaptureId?: string;
  sourceCapturedAt?: number;
};

export type LogicalScrollSurfaceResultData = {
  schemaVersion: 1;
  screenId: string;
  screenTitle: string;
  variantId: string;
  surfaceId: string;
  baselineCaptureId: string;
  capture: {
    captureId: string;
    capturedAt: number;
    status: string;
    viewports: Array<{
      screenshot?: { sha256?: string };
      accessibilityTree?: { sha256?: string };
    }>;
    composite?: { sha256?: string };
    mergedTree?: { sha256?: string };
    manifest?: { sha256?: string };
  };
  comparison: {
    policy: string;
    matches: boolean;
    visualMatches: boolean;
    semanticMatches: boolean;
    heightRatio?: number;
    semanticRatio?: number;
  };
  repair: unknown;
  cache?: SurfaceComparisonCacheProvenance;
};

export type ReusableSurfaceComparison = {
  data: LogicalScrollSurfaceResultData;
  provenance: SurfaceComparisonCacheProvenance & { status: "hit" };
};

/** A rebuildable catalog projection. Its payload is still validated as full
 * immutable evidence before reuse. */
export type IndexedSurfaceComparisonCandidate = {
  runId: string;
  status: string;
  at: number;
  artifactCapturedAt: number;
  data: unknown;
};

export type SurfaceComparisonNeedsRecapture = {
  schemaVersion: 1;
  status: "needs-recapture";
  screenId: string;
  screenTitle: string;
  variantId: string;
  surfaceId: string;
  baselineCaptureId: string;
  reason: string;
  cache: SurfaceComparisonCacheProvenance & { status: "miss" };
  nextAction: {
    kind: "force-recapture";
    screenId: string;
  };
};

export function surfaceComparisonNeedsRecapture(input: {
  step: CaptureSurfaceStep;
  cache: SurfaceComparisonCacheProvenance & { status: "miss" };
}): SurfaceComparisonNeedsRecapture {
  return {
    schemaVersion: 1,
    status: "needs-recapture",
    screenId: input.step.screenId,
    screenTitle: input.step.screenTitle,
    variantId: input.step.variantId,
    surfaceId: input.step.surfaceId,
    baselineCaptureId: input.step.baselineCaptureId,
    reason: input.cache.reason ?? "Fresh device evidence is required.",
    cache: structuredClone(input.cache),
    nextAction: { kind: "force-recapture", screenId: input.step.screenId },
  };
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}

function artifactRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function appBuildFromArtifacts(job: Pick<TestJob, "artifacts">): string | undefined {
  for (let index = job.artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = job.artifacts[index];
    if (artifact?.kind !== "app-build") continue;
    const data = artifactRecord(artifact.data);
    const version = typeof data?.versionName === "string" ? data.versionName.trim() : "";
    if (!version) continue;
    const application = typeof data?.packageName === "string" ? data.packageName.trim() : "";
    return application ? `${application}@${version}` : version;
  }
  return undefined;
}

/** Build a cache identity only from frozen, exact facts. Unknown locale, app
 * build, or target facts deliberately make the step ineligible. */
export function surfaceComparisonCacheIdentity(
  job: Pick<
    TestJob,
    | "projectId"
    | "serial"
    | "browserTargetId"
    | "platform"
    | "targetProfile"
    | "resolvedInputs"
    | "appVersion"
    | "artifacts"
  >,
  step: CaptureSurfaceStep,
): SurfaceComparisonCacheIdentity | null {
  const profile = job.targetProfile;
  const targetId = firstNonEmpty([profile?.targetId, job.serial, job.browserTargetId]);
  const locale = firstNonEmpty([
    job.resolvedInputs.locale,
    job.resolvedInputs.app_locale,
    job.resolvedInputs.language,
  ]);
  const appBuild = firstNonEmpty([
    job.appVersion,
    job.resolvedInputs.app_version,
    job.resolvedInputs.app_build,
    job.resolvedInputs.build_id,
    appBuildFromArtifacts(job),
  ]);
  if (!profile?.id || !targetId || !locale || !appBuild) return null;
  return {
    schemaVersion: 1,
    projectId: job.projectId?.trim() || "local",
    target: { profileId: profile.id, targetId, platform: profile.platform ?? job.platform },
    locale: locale.toLocaleLowerCase(),
    appBuild,
    surface: {
      screenId: step.screenId,
      variantId: step.variantId,
      surfaceId: step.surfaceId,
    },
    baseline: {
      captureId: step.baselineCaptureId,
      ...(step.baseline?.compositeWidth === undefined
        ? {}
        : { compositeWidth: step.baseline.compositeWidth }),
      ...(step.baseline?.compositeHeight === undefined
        ? {}
        : { compositeHeight: step.baseline.compositeHeight }),
      ...(step.baseline?.semanticNodeCount === undefined
        ? {}
        : { semanticNodeCount: step.baseline.semanticNodeCount }),
    },
  };
}

export function surfaceComparisonCacheKey(identity: SurfaceComparisonCacheIdentity): string {
  return `surface-comparison-v1-${createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")}`;
}

function isCompleteResult(data: unknown): data is LogicalScrollSurfaceResultData {
  const result = artifactRecord(data);
  const capture = artifactRecord(result?.capture);
  const comparison = artifactRecord(result?.comparison);
  const viewports = capture?.viewports;
  if (
    result?.schemaVersion !== 1 ||
    typeof result.surfaceId !== "string" ||
    typeof result.baselineCaptureId !== "string" ||
    typeof capture?.captureId !== "string" ||
    typeof capture.capturedAt !== "number" ||
    capture.status !== "completed" ||
    !Array.isArray(viewports) ||
    viewports.length === 0 ||
    typeof artifactRecord(capture.manifest)?.sha256 !== "string" ||
    typeof artifactRecord(capture.mergedTree)?.sha256 !== "string" ||
    typeof comparison?.matches !== "boolean" ||
    typeof comparison.visualMatches !== "boolean" ||
    typeof comparison.semanticMatches !== "boolean"
  ) {
    return false;
  }
  return viewports.every((viewport) => {
    const item = artifactRecord(viewport);
    return (
      typeof artifactRecord(item?.screenshot)?.sha256 === "string" &&
      typeof artifactRecord(item?.accessibilityTree)?.sha256 === "string"
    );
  });
}

function cacheIdentityFromResult(data: LogicalScrollSurfaceResultData) {
  return data.cache?.identity;
}

function sameIdentity(
  left: SurfaceComparisonCacheIdentity | undefined,
  right: SurfaceComparisonCacheIdentity,
): boolean {
  return Boolean(left && surfaceComparisonCacheKey(left) === surfaceComparisonCacheKey(right));
}

/** Find the newest complete immutable evidence with the exact cache identity.
 * A later failure or cancellation does not corrupt an already completed,
 * content-addressed surface artifact. Results without cache identity
 * (including legacy artifacts) still fail closed. */
export function findReusableSurfaceComparison(input: {
  identity: SurfaceComparisonCacheIdentity;
  runs: ReadonlyArray<
    Pick<PersistedRun, "id" | "status" | "finishedAt" | "writtenAt" | "artifacts">
  >;
  currentArtifacts?: TestJob["artifacts"];
  indexedCandidates?: readonly IndexedSurfaceComparisonCandidate[];
  currentRunId?: string;
  at: number;
}): ReusableSurfaceComparison | null {
  const key = surfaceComparisonCacheKey(input.identity);
  const candidates: Array<{
    runId: string;
    status: string;
    at: number;
    artifact: TestJob["artifacts"][number];
  }> = [];
  if (input.currentArtifacts) {
    candidates.push(
      ...input.currentArtifacts.map((artifact) => ({
        runId: input.currentRunId ?? "current",
        status: "ok",
        at: artifact.capturedAt,
        artifact,
      })),
    );
  }
  if (input.indexedCandidates) {
    candidates.push(
      ...input.indexedCandidates.map((candidate) => ({
        runId: candidate.runId,
        status: candidate.status,
        at: candidate.at,
        artifact: {
          kind: "logical-scroll-surface-result",
          capturedAt: candidate.artifactCapturedAt,
          data: candidate.data,
        },
      })),
    );
  }
  for (const run of input.runs) {
    for (const artifact of run.artifacts) {
      candidates.push({
        runId: run.id,
        status: run.status,
        at: run.finishedAt ?? run.writtenAt,
        artifact,
      });
    }
  }
  candidates.sort((left, right) => right.at - left.at);
  for (const candidate of candidates) {
    if (
      candidate.artifact.kind !== "logical-scroll-surface-result" ||
      !isCompleteResult(candidate.artifact.data) ||
      !sameIdentity(cacheIdentityFromResult(candidate.artifact.data), input.identity)
    ) {
      continue;
    }
    const source = candidate.artifact.data;
    const originalSource = source.cache?.status === "hit" ? source.cache : undefined;
    return {
      data: structuredClone(source),
      provenance: {
        schemaVersion: 1,
        status: "hit",
        evaluatedAt: input.at,
        key,
        identity: structuredClone(input.identity),
        sourceRunId: originalSource?.sourceRunId ?? candidate.runId,
        sourceArtifactCapturedAt:
          originalSource?.sourceArtifactCapturedAt ?? candidate.artifact.capturedAt,
        sourceCaptureId: originalSource?.sourceCaptureId ?? source.capture.captureId,
        sourceCapturedAt: originalSource?.sourceCapturedAt ?? source.capture.capturedAt,
      },
    };
  }
  return null;
}
