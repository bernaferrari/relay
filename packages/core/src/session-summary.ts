import type { CampaignCheckSummary, JobSummary } from "@relay/protocol";
import type { TestJob } from "./session-contract.js";

function summarizeMatrixCase(data: unknown): JobSummary["matrixCase"] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const candidate = data as Record<string, unknown>;
  if (candidate.kind !== "combine" || typeof candidate.world !== "string") return undefined;
  if (
    !candidate.values ||
    typeof candidate.values !== "object" ||
    Array.isArray(candidate.values)
  ) {
    return undefined;
  }
  const values = Object.fromEntries(
    Object.entries(candidate.values).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    kind: "combine",
    ...(typeof candidate.appMapId === "string" && candidate.appMapId.trim()
      ? { appMapId: candidate.appMapId.trim() }
      : {}),
    ...(typeof candidate.combineId === "string" && candidate.combineId.trim()
      ? { combineId: candidate.combineId.trim() }
      : {}),
    world: candidate.world,
    values,
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
      (data.status !== "passed" && data.status !== "failed") ||
      typeof data.startedAt !== "number" ||
      typeof data.finishedAt !== "number"
    ) {
      return [];
    }
    return [
      {
        id: data.id,
        title: data.title,
        status: data.status,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        durationMs: Math.max(0, data.finishedAt - data.startedAt),
        ...(typeof data.error === "string" ? { error: data.error } : {}),
      },
    ];
  });
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
    outcome: job.outcome,
    review: job.review,
    batchId: job.batchId,
    caseIndex: job.caseIndex,
    caseCount: job.caseCount,
    ...(matrixCase ? { matrixCase } : {}),
    frameCount: job.frames.length,
    evidenceComplete: Boolean(job.evidence?.finishedAt),
    ...(checks.length ? { checks } : {}),
    ...(lastLogs.length ? { lastLogs } : {}),
  };
}
