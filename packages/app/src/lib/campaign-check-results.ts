import type { JobInfo } from "./api-types";

export type CampaignCheckStatus = "passed" | "failed" | "skipped" | "blocked";

export type CampaignCheckRepairAttempt = {
  method: string;
  target: string;
  outcome: "rejected" | "used";
  detail?: string;
  note?: string;
  bounds?: string;
  point?: string;
};

export type CampaignCheckRepairSummary = {
  observed: {
    app?: string;
    header?: string;
    identity?: string;
    accessibilityAvailable?: boolean;
    nodeCount?: number;
  };
  attempts: CampaignCheckRepairAttempt[];
  attemptsTruncated: boolean;
  failureReason?: string;
  nextStep: string;
};

export type CampaignCheckResult = {
  id: string;
  title: string;
  status: CampaignCheckStatus;
  durationMs?: number;
  error?: string;
  dependencyReason?: string;
  evidence: NonNullable<JobInfo["artifacts"]>;
  repair?: CampaignCheckRepairSummary;
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

const MAX_REPAIR_TEXT_LENGTH = 240;
const MAX_REPAIR_TARGET_LENGTH = 180;
const MAX_REPAIR_ATTEMPTS = 8;
const MAX_REPAIR_SOURCE_ATTEMPTS = 24;

function bounded(value: unknown, maxLength = MAX_REPAIR_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatPoint(value: unknown): string | undefined {
  const point = object(value);
  const x = finiteNumber(point?.x);
  const y = finiteNumber(point?.y);
  return x === undefined || y === undefined ? undefined : `(${x}, ${y})`;
}

function formatBounds(value: unknown): string | undefined {
  const bounds = object(value);
  const x = finiteNumber(bounds?.x);
  const y = finiteNumber(bounds?.y);
  const width = finiteNumber(bounds?.width);
  const height = finiteNumber(bounds?.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : `x ${x}, y ${y}, ${width} × ${height}`;
}

function targetMethod(value: unknown): string | undefined {
  const target = object(value);
  return ["identifier", "ref", "label", "text", "point"].find((key) => target?.[key] !== undefined);
}

function formatTarget(value: unknown): string {
  const target = object(value);
  if (!target) return "Unrecorded target";
  const parts = (["identifier", "ref", "label", "text"] as const).flatMap((key) => {
    const value = bounded(target[key], 96);
    return value ? [`${key} “${value}”`] : [];
  });
  const point = formatPoint(target.point);
  if (point) parts.push(`point ${point}`);
  if (parts.length === 0) return "Unrecorded target";
  return bounded(parts.join(" · "), MAX_REPAIR_TARGET_LENGTH) ?? "Unrecorded target";
}

function locatorAttempts(value: unknown): {
  attempts: CampaignCheckRepairAttempt[];
  truncated: boolean;
} {
  if (!Array.isArray(value)) return { attempts: [], truncated: false };
  const attempts: CampaignCheckRepairAttempt[] = [];
  const source = value.slice(0, MAX_REPAIR_SOURCE_ATTEMPTS);
  let truncated = value.length > source.length;
  for (const item of source) {
    const record = object(item);
    const data = object(record?.data);
    const kind = bounded(record?.kind, 64);
    if (!data || !kind) continue;
    if (kind === "locator-fallback" || kind === "locator-heal") {
      const replacement = formatTarget(data.replacement);
      const used = attempts.findLast(
        (attempt) => attempt.outcome === "used" && attempt.target === replacement,
      );
      const note =
        kind === "locator-fallback"
          ? "Used configured fallback; saved map unchanged."
          : "Used recorded locator; saved map unchanged.";
      if (used) used.note = note;
      continue;
    }
    if (kind !== "target-resolution" && kind !== "target-resolution-attempt") continue;
    if (attempts.length >= MAX_REPAIR_ATTEMPTS) {
      truncated = true;
      continue;
    }
    const target = data.target;
    const outcome = kind === "target-resolution" ? "used" : "rejected";
    const detail = outcome === "rejected" ? bounded(data.error) : undefined;
    const bounds = formatBounds(data.bounds);
    const point = formatPoint(data.point);
    attempts.push({
      method:
        bounded(data.method, 48) ?? bounded(data.strategy, 48) ?? targetMethod(target) ?? "unknown",
      target: formatTarget(target),
      outcome,
      ...(detail ? { detail } : {}),
      ...(bounds ? { bounds } : {}),
      ...(point ? { point } : {}),
    });
  }
  return { attempts, truncated };
}

function repairSummary(
  evidence: NonNullable<JobInfo["artifacts"]>,
  fallbackError: string | undefined,
  hasScreenshot: boolean,
): CampaignCheckRepairSummary | undefined {
  const artifact = evidence.reduce<(typeof evidence)[number] | undefined>((latest, candidate) => {
    if (candidate.kind !== "campaign-check-evidence" || !object(candidate.data)) return latest;
    return !latest || candidate.capturedAt >= latest.capturedAt ? candidate : latest;
  }, undefined);
  const data = object(artifact?.data);
  if (!data) return undefined;
  const chrome = object(data.chrome);
  const identity = object(data.screenIdentity);
  const accessibility = object(data.accessibility);
  const nodes = Array.isArray(data.nodes) ? data.nodes : undefined;
  const explicitNodeCount = finiteNumber(accessibility?.nodeCount);
  const explicitAvailability = accessibility?.available;
  const accessibilityAvailable =
    typeof explicitAvailability === "boolean"
      ? explicitAvailability
      : nodes && nodes.length > 0
        ? true
        : undefined;
  const nodeCount =
    explicitNodeCount !== undefined && explicitNodeCount >= 0
      ? Math.floor(explicitNodeCount)
      : nodes?.length;
  const normalizedAttempts = locatorAttempts(data.attempts);
  const inspectionSources = [
    hasScreenshot ? "the failure screenshot" : undefined,
    accessibilityAvailable === true ? "the accessibility tree" : undefined,
  ].filter((source): source is string => Boolean(source));
  const inspection =
    inspectionSources.length === 0
      ? "the raw evidence"
      : inspectionSources.length === 1
        ? inspectionSources[0]!
        : `${inspectionSources[0]} and ${inspectionSources[1]}`;
  const nextStep = normalizedAttempts.attempts.length
    ? `Inspect ${inspection}, manually locate the missing control, then repair its mapped locator.`
    : `Inspect ${inspection}, identify where the saved path diverged, then repair the mapped step.`;
  const app = bounded(chrome?.app, 96);
  const header = bounded(chrome?.header, 96);
  const fingerprint = bounded(identity?.fingerprint, 96);
  const failureReason = bounded(data.error) ?? bounded(fallbackError);
  return {
    observed: {
      ...(app ? { app } : {}),
      ...(header ? { header } : {}),
      ...(fingerprint ? { identity: fingerprint } : {}),
      ...(accessibilityAvailable !== undefined ? { accessibilityAvailable } : {}),
      ...(nodeCount !== undefined ? { nodeCount } : {}),
    },
    attempts: normalizedAttempts.attempts,
    attemptsTruncated: normalizedAttempts.truncated,
    ...(failureReason ? { failureReason } : {}),
    nextStep,
  };
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

  const checks = ids.flatMap((id): CampaignCheckResult[] => {
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
        frames: [],
      },
    ];
  });
  const stableIds = new Set(checks.map((check) => check.id.toLocaleLowerCase()));
  const legacyTitleCounts = new Map<string, number>();
  for (const check of checks) {
    const title = check.title.toLocaleLowerCase();
    legacyTitleCounts.set(title, (legacyTitleCounts.get(title) ?? 0) + 1);
  }
  return checks.map((check) => {
    const normalizedId = check.id.toLocaleLowerCase();
    const normalizedTitle = check.title.toLocaleLowerCase();
    const frames = (job.frames ?? []).flatMap((frame, index) => {
      const caption = frame.caption?.trim().toLocaleLowerCase() ?? "";
      const stable = caption === `check:${normalizedId}` || caption === `failed:${normalizedId}`;
      const unambiguousLegacy =
        caption === `failed:${normalizedTitle}` &&
        !stableIds.has(normalizedTitle) &&
        legacyTitleCounts.get(normalizedTitle) === 1;
      return stable || unambiguousLegacy ? [{ index, frame }] : [];
    });
    const repair = repairSummary(check.evidence, check.error, frames.length > 0);
    return {
      ...check,
      frames,
      ...(repair ? { repair } : {}),
    };
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
