import type { JobInfo } from "./api-types";

export type CampaignCheckStatus = "passed" | "failed" | "skipped" | "blocked";

export type CampaignCheckResult = {
  id: string;
  title: string;
  status: CampaignCheckStatus;
  durationMs?: number;
  error?: string;
  dependencyReason?: string;
  evidence: NonNullable<JobInfo["artifacts"]>;
  frames: Array<{
    index: number;
    frame: NonNullable<JobInfo["frames"]>[number];
  }>;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function status(value: unknown): CampaignCheckStatus | undefined {
  return ["passed", "failed", "skipped", "blocked"].includes(String(value))
    ? (value as CampaignCheckStatus)
    : undefined;
}

function text(...values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
}

/**
 * Join the bounded job summary with detailed run artifacts. Detailed artifacts
 * are authoritative because persisted run detail can include dependency and
 * evidence fields intentionally omitted from the list projection.
 */
export function campaignCheckResults(job: JobInfo): CampaignCheckResult[] {
  const resultArtifacts = (job.artifacts ?? []).flatMap((artifact) => {
    const data = object(artifact.data);
    const checkStatus = status(data?.status);
    if (
      artifact.kind !== "campaign-check-result" ||
      !data ||
      typeof data.id !== "string" ||
      typeof data.title !== "string" ||
      !checkStatus
    ) {
      return [];
    }
    return [{ artifact, data, status: checkStatus }];
  });
  const summaryById = new Map((job.checks ?? []).map((check) => [check.id, check]));
  const authoredIds =
    job.recipeSnapshot?.steps.flatMap((step) => (step.check ? [step.check.id] : [])) ?? [];
  const ids = [
    ...new Set([
      ...authoredIds,
      ...resultArtifacts.map(({ data }) => String(data.id)),
      ...summaryById.keys(),
    ]),
  ];
  const latestResultById = new Map<string, (typeof resultArtifacts)[number]>();
  for (const result of resultArtifacts) latestResultById.set(String(result.data.id), result);

  return ids.flatMap((id): CampaignCheckResult[] => {
    const detailed = latestResultById.get(id);
    const summary = summaryById.get(id);
    const checkStatus = detailed?.status ?? status(summary?.status);
    const title = text(detailed?.data.title, summary?.title);
    if (!checkStatus || !title) return [];
    const startedAt = detailed?.data.startedAt ?? summary?.startedAt;
    const finishedAt = detailed?.data.finishedAt ?? summary?.finishedAt;
    const durationMs =
      typeof detailed?.data.durationMs === "number"
        ? detailed.data.durationMs
        : typeof summary?.durationMs === "number"
          ? summary.durationMs
          : typeof startedAt === "number" && typeof finishedAt === "number"
            ? Math.max(0, finishedAt - startedAt)
            : undefined;
    const evidence = (job.artifacts ?? []).filter((artifact) => {
      if (artifact.kind === "campaign-check-result") return false;
      const data = object(artifact.data);
      return data?.checkId === id;
    });
    const normalizedTitle = title.toLocaleLowerCase();
    const frames = (job.frames ?? []).flatMap((frame, index) => {
      const caption = frame.caption?.toLocaleLowerCase() ?? "";
      return caption === `failed:${normalizedTitle}` ||
        caption === `check:${id.toLocaleLowerCase()}` ||
        caption === `failed:${id.toLocaleLowerCase()}`
        ? [{ index, frame }]
        : [];
    });
    return [
      {
        id,
        title,
        status: checkStatus,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(text(detailed?.data.error, summary?.error)
          ? { error: text(detailed?.data.error, summary?.error) }
          : {}),
        ...(text(detailed?.data.dependencyReason, detailed?.data.reason)
          ? { dependencyReason: text(detailed?.data.dependencyReason, detailed?.data.reason) }
          : {}),
        evidence,
        frames,
      },
    ];
  });
}

export function campaignCheckCounts(
  checks: CampaignCheckResult[],
): Record<CampaignCheckStatus, number> {
  return checks.reduce(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { passed: 0, failed: 0, skipped: 0, blocked: 0 },
  );
}
