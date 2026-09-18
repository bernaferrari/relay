import {
  canonicalAppMapCombineCellValues,
  captureReviewIdentityFramePaths,
  destIdentityCheckpointFramePaths,
  isCaptureReviewLeftoverCaption,
  parseAppMapTestTupleIdentity,
  describeCoverageStepReasons,
  type CampaignCheckSummary,
  type CoverageStepReason,
  type JobSummary,
} from "@relay/protocol";
import type { TestJob } from "./session-contract.js";

/** Dest wait-for for job.list / campaign envelopes. Missing dest-phase is not
 * "omit destIdentity so callers fall back to every frame": leftover Transition
 * executed / Inspect setup skipped cannot sit beside Observe. Unphased Android
 * dest-wait with no leftover caption still omits destIdentity (keeps every
 * frame elsewhere). */
function jobDestIdentity(job: TestJob): JobSummary["destIdentity"] {
  const frames = job.frames.map((frame) => ({
    path: frame.path,
    ...(frame.caption ? { caption: frame.caption } : {}),
  }));
  const phased = captureReviewIdentityFramePaths(job.artifacts);
  const paths = destIdentityCheckpointFramePaths(frames, job.artifacts);
  if (!paths.length) return undefined;
  if (!phased.length && !frames.some((frame) => isCaptureReviewLeftoverCaption(frame.caption))) {
    return undefined;
  }
  const byPath = new Map(frames.map((frame) => [frame.path, frame]));
  return paths.map((path) => {
    const frame = byPath.get(path);
    return frame?.caption ? { path, caption: frame.caption } : { path };
  });
}

function summarizeMatrixCase(data: unknown): JobSummary["matrixCase"] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const candidate = data as Record<string, unknown>;
  if (
    (candidate.kind !== "combine" && candidate.kind !== "combine-cell") ||
    typeof candidate.world !== "string"
  )
    return undefined;
  if (
    !candidate.values ||
    typeof candidate.values !== "object" ||
    Array.isArray(candidate.values)
  ) {
    return undefined;
  }
  const values = canonicalAppMapCombineCellValues(
    Object.fromEntries(
      Object.entries(candidate.values).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  const identity = parseAppMapTestTupleIdentity(candidate);
  return {
    kind: "combine",
    ...(identity ? { ...identity } : { values }),
    ...(typeof candidate.combineId === "string" && candidate.combineId.trim()
      ? { combineId: candidate.combineId.trim() }
      : {}),
    world: candidate.world,
    ...(typeof candidate.expectedScreenshots === "number" &&
    Number.isFinite(candidate.expectedScreenshots)
      ? { expectedScreenshots: candidate.expectedScreenshots }
      : {}),
  };
}

export function summarizeJob(job: TestJob): JobSummary {
  const lastLogs = job.logs.slice(-12);
  const frozenInputs = job.artifacts.find((artifact) => artifact.kind === "frozen-inputs")?.data;
  const matrixCase = summarizeMatrixCase(frozenInputs);
  const checks = job.artifacts.flatMap((artifact): CampaignCheckSummary[] => {
    if (
      artifact.kind !== "campaign-check-result" ||
      !artifact.data ||
      typeof artifact.data !== "object"
    ) {
      return [];
    }
    const data = artifact.data as Record<string, unknown>;
    if (
      typeof data.id !== "string" ||
      typeof data.title !== "string" ||
      (data.status !== "passed" && data.status !== "failed" && data.status !== "blocked") ||
      typeof data.startedAt !== "number" ||
      typeof data.finishedAt !== "number"
    ) {
      return [];
    }
    const coverageOutcomes = Array.isArray(data.coverageOutcomes)
      ? data.coverageOutcomes.filter(
          (reason): reason is CoverageStepReason =>
            reason === "inspect-setup-skipped" || reason === "transition-executed",
        )
      : [];
    const coverageNote =
      typeof data.coverageNote === "string" && data.coverageNote.trim()
        ? data.coverageNote.trim()
        : coverageOutcomes.length
          ? describeCoverageStepReasons(coverageOutcomes)
          : undefined;
    return [
      {
        id: data.id,
        title: data.title,
        status: data.status,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        durationMs: Math.max(0, data.finishedAt - data.startedAt),
        ...(typeof data.error === "string" ? { error: data.error } : {}),
        ...(typeof data.dependencyReason === "string"
          ? { dependencyReason: data.dependencyReason }
          : {}),
        ...(coverageOutcomes.length ? { coverageOutcomes } : {}),
        ...(coverageNote ? { coverageNote } : {}),
      },
    ];
  });
  const destIdentity = jobDestIdentity(job);
  return {
    id: job.id,
    action: job.action,
    title: job.title,
    status: job.status,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs:
      job.finishedAt && (job.startedAt ?? job.queuedAt)
        ? job.finishedAt - (job.startedAt ?? job.queuedAt)
        : undefined,
    platform: job.targetKind === "browser" ? "browser" : job.platform,
    serial: job.browserTargetId ?? job.serial,
    ...(job.targetProfile?.id ? { targetProfileId: job.targetProfile.id } : {}),
    outcome: job.outcome,
    review: job.review,
    batchId: job.batchId,
    caseIndex: job.caseIndex,
    caseCount: job.caseCount,
    ...(matrixCase ? { matrixCase } : {}),
    frameCount: job.frames.length,
    ...(destIdentity?.length ? { destIdentity } : {}),
    evidenceComplete: Boolean(job.evidence?.finishedAt),
    ...(checks.length ? { checks } : {}),
    ...(lastLogs.length ? { lastLogs } : {}),
  };
}
