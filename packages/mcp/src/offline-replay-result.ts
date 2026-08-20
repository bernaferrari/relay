type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function compactText(value: unknown, limit = 320): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function compactNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assignText(target: UnknownRecord, key: string, value: unknown, limit?: number): void {
  const normalized = compactText(value, limit);
  if (normalized !== undefined) target[key] = normalized;
}

function assignNumber(target: UnknownRecord, key: string, value: unknown): void {
  const normalized = compactNumber(value);
  if (normalized !== undefined) target[key] = normalized;
}

function compactSummary(value: unknown): UnknownRecord {
  const summary = record(value);
  const result: UnknownRecord = {};
  for (const key of [
    "checks",
    "proved",
    "rootFailures",
    "invalidCascades",
    "independentFailures",
  ]) {
    assignNumber(result, key, summary?.[key]);
  }
  return result;
}

type CompactOptions = {
  maxChecks: number;
  maxCursors: number;
  maxBlockers: number;
  blockerCheckIds: number;
  checkReasonLimit: number;
  rootErrorLimit: number;
};

function compactCheck(value: unknown, reasonLimit: number): UnknownRecord {
  const check = record(value);
  const result: UnknownRecord = {};
  for (const key of [
    "id",
    "title",
    "recordedStatus",
    "replayStatus",
    "warmSourceScreenId",
    "lastProvenScreenId",
    "expectedDestinationScreenId",
  ]) {
    assignText(result, key, check?.[key], key === "id" || key === "title" ? 64 : 48);
  }
  // The root carries the original error. Later checks keep their causal reason
  // instead of repeating a large device error forty times.
  assignText(result, "reason", check?.reason, reasonLimit);
  result.selectorAttemptCount = Array.isArray(check?.selectorAttempts)
    ? check.selectorAttempts.length
    : 0;
  result.evidenceCount = Array.isArray(check?.evidence) ? check.evidence.length : 0;
  return result;
}

function compactCursor(value: unknown): UnknownRecord {
  const cursor = record(value);
  const result: UnknownRecord = {};
  for (const key of ["status", "screenId", "reason", "source", "artifact"]) {
    assignText(result, key, cursor?.[key], key === "reason" ? 80 : 64);
  }
  assignNumber(result, "capturedAt", cursor?.capturedAt);
  return result;
}

function compactBlocker(value: unknown, maxCheckIds: number): UnknownRecord {
  const blocker = record(value);
  const result: UnknownRecord = {};
  assignText(result, "kind", blocker?.kind, 48);
  assignText(result, "message", blocker?.message, 96);
  const checkIds = Array.isArray(blocker?.checkIds)
    ? blocker.checkIds
        .map((checkId) => compactText(checkId, 64))
        .filter((checkId): checkId is string => checkId !== undefined)
        .slice(0, maxCheckIds)
    : [];
  if (checkIds.length) result.checkIds = checkIds;
  return result;
}

/**
 * The interactive MCP tool has an intentionally small text ceiling. Preserve
 * the causal shape of an offline replay when a large campaign must be handed
 * to an agent, while pointing it at the full, bounded resource for details.
 */
function compactOfflineReplayResult(value: unknown, options: CompactOptions): UnknownRecord {
  const response = record(value);
  const source = record(response?.report);
  if (!source) return { report: null, evidenceTruncated: true };

  const report: UnknownRecord = { evidenceTruncated: true };
  assignNumber(report, "schemaVersion", source.schemaVersion);
  for (const key of ["mode", "runId", "sourceRunStatus", "planDigest", "appMapId", "testId"]) {
    assignText(report, key, source[key], key === "planDigest" ? 96 : 64);
  }
  assignNumber(report, "appMapRevision", source.appMapRevision);
  report.summary = compactSummary(source.summary);

  const firstRoot = record(source.firstRootFailure);
  if (firstRoot) {
    const compactRoot: UnknownRecord = {};
    for (const key of ["checkId", "title", "kind"]) {
      assignText(compactRoot, key, firstRoot[key], 80);
    }
    assignText(compactRoot, "error", firstRoot.error, options.rootErrorLimit);
    report.firstRootFailure = compactRoot;
  }

  report.checks = (Array.isArray(source.checks) ? source.checks : [])
    .slice(0, options.maxChecks)
    .map((check) => compactCheck(check, options.checkReasonLimit));
  report.cursorTimeline = (Array.isArray(source.cursorTimeline) ? source.cursorTimeline : [])
    .slice(-options.maxCursors)
    .map(compactCursor);
  report.blockers = (Array.isArray(source.blockers) ? source.blockers : [])
    .slice(0, options.maxBlockers)
    .map((blocker) => compactBlocker(blocker, options.blockerCheckIds));

  const runId = compactText(source.runId, 64);
  return {
    truncated: true,
    report,
    ...(runId
      ? {
          resource: {
            uri: `relay://runs/${encodeURIComponent(runId)}/offline-replay`,
            description: "Read the full offline replay report from frozen run evidence.",
          },
        }
      : {}),
  };
}

/** A bounded resource still preserves a campaign-sized causal outline. */
export function compactOfflineReplayResource(value: unknown): UnknownRecord {
  return compactOfflineReplayResult(value, {
    maxChecks: 40,
    maxCursors: 12,
    maxBlockers: 5,
    blockerCheckIds: 8,
    checkReasonLimit: 80,
    rootErrorLimit: 160,
  });
}

/** A tool result must fit MCP's smaller text budget and point to the resource. */
export function compactOfflineReplayToolResult(value: unknown): UnknownRecord {
  return compactOfflineReplayResult(value, {
    maxChecks: 8,
    maxCursors: 5,
    maxBlockers: 3,
    blockerCheckIds: 5,
    checkReasonLimit: 72,
    rootErrorLimit: 120,
  });
}
