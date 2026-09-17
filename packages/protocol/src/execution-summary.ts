import {
  captureReviewIdentityFramePaths,
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  destIdentityReviewItems,
  CAPTURE_REVIEW_DEST_PHASE,
  resolveCaptureReviewQueue,
  type CaptureReviewItem,
} from "./capture-review.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MAX_SUMMARIZED_CHECKS = 40;
const MAX_SUMMARIZED_FAILED_STEPS = 12;
const MAX_SUMMARY_TEXT = 2_000;

function boundedText(value: unknown, max = MAX_SUMMARY_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function resourceSegment(value: string): string {
  return encodeURIComponent(value);
}

function artifactRecords(value: unknown): { kind?: string; data?: unknown }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = object(item);
    return record ? [record] : [];
  });
}

function listedFrames(value: unknown): { path: string; caption?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ path: item.trim() }];
    const record = object(item);
    if (!record) return [];
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path) return [];
    const caption = typeof record.caption === "string" ? record.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

function compactDestIdentity(
  frames: readonly { path: string; caption?: string }[],
  artifacts: readonly { kind?: string; data?: unknown }[],
): { path: string; caption?: string }[] {
  const destPaths = destIdentityCheckpointFramePaths(frames, artifacts);
  if (!destPaths.length) return [];
  const byPath = new Map(frames.map((frame) => [frame.path, frame]));
  return destPaths.map((path) => {
    const frame = byPath.get(path);
    return frame ?? { path };
  });
}

function compactCaptureReviewItem(
  item: CaptureReviewItem & { runId?: string; attempt?: number },
): Record<string, unknown> {
  return {
    captureId: item.captureId,
    caption: item.caption,
    status: item.status,
    ...(item.framePath ? { framePath: item.framePath } : {}),
    ...(item.phase ? { phase: item.phase } : {}),
    ...(item.policy ? { policy: item.policy } : {}),
    ...(item.lookFor ? { lookFor: item.lookFor } : {}),
    ...(item.attempt !== undefined ? { attempt: item.attempt } : {}),
    ...(typeof item.runId === "string" ? { runId: item.runId } : {}),
  };
}

function destIdentityProjection(record: Record<string, unknown>): {
  destIdentity?: { path: string; caption?: string }[];
  captureReview?: Record<string, unknown>[];
} {
  const artifacts = artifactRecords(record.artifacts);
  const frames = listedFrames(record.frames);
  const destIdentity = compactDestIdentity(frames, artifacts);
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  const queue = resolveCaptureReviewQueue({
    artifacts,
    decisions: Array.isArray(record.captureReviews) ? record.captureReviews : undefined,
  });
  const visible = destIdentityReviewItems(queue.items).filter((item) => {
    if (!item.framePath) return true;
    if (destPaths.size) return destPaths.has(item.framePath);
    return !leftover.has(item.framePath);
  });
  const captureReview = visible.map((item) =>
    compactCaptureReviewItem({
      ...item,
      ...(item.framePath && destPaths.has(item.framePath) && !item.phase
        ? { phase: CAPTURE_REVIEW_DEST_PHASE }
        : {}),
    }),
  );
  return {
    ...(destIdentity.length ? { destIdentity } : {}),
    ...(captureReview.length ? { captureReview } : {}),
  };
}

function summarizeJob(value: unknown): unknown {
  const job = object(value);
  if (!job || typeof job.id !== "string" || typeof job.status !== "string") return value;
  const jobId = job.id;
  const steps = Array.isArray(job.steps) ? job.steps : undefined;
  const frames = Array.isArray(job.frames) ? job.frames : undefined;
  const artifacts = Array.isArray(job.artifacts) ? job.artifacts : undefined;
  const checks = artifacts?.flatMap((value) => {
    const artifact = object(value);
    const data = object(artifact?.data);
    if (
      artifact?.kind !== "campaign-check-result" ||
      typeof data?.id !== "string" ||
      typeof data.title !== "string" ||
      (data.status !== "passed" &&
        data.status !== "failed" &&
        data.status !== "blocked" &&
        data.status !== "interrupted") ||
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
        ...(boundedText(data.error, 512) ? { error: boundedText(data.error, 512) } : {}),
        ...(boundedText(data.dependencyReason, 512)
          ? { dependencyReason: boundedText(data.dependencyReason, 512) }
          : {}),
      },
    ];
  });
  const logs = Array.isArray(job.logs)
    ? job.logs.filter((entry): entry is string => typeof entry === "string").slice(-24)
    : Array.isArray(job.lastLogs)
      ? job.lastLogs.filter((entry): entry is string => typeof entry === "string").slice(-24)
      : [];
  const optional = [
    "title",
    "action",
    "platform",
    "serial",
    "outcome",
    "error",
    "errorCode",
    "failureCategory",
    "queuedAt",
    "startedAt",
    "finishedAt",
    "durationMs",
    "batchId",
    "caseIndex",
    "caseCount",
  ] as const;
  const optionalValues: Record<string, string | number> = {};
  for (const key of optional) {
    const value = job[key];
    if (typeof value === "number") optionalValues[key] = value;
    if (typeof value === "string") {
      const bounded = boundedText(value, key === "error" ? 4_000 : 2_000);
      if (bounded !== undefined) optionalValues[key] = bounded;
    }
  }
  return {
    id: jobId,
    status: job.status,
    ...optionalValues,
    ...(steps
      ? {
          stepCount: steps.length,
          failedSteps: steps
            .map(object)
            .filter((step) => step?.status === "error")
            .slice(0, MAX_SUMMARIZED_FAILED_STEPS)
            .map((step) => ({
              id: step!.id,
              title: boundedText(step!.title, 300),
              log: boundedText(step!.log, 1_000),
            })),
        }
      : {}),
    ...(frames ? { frameCount: frames.length } : {}),
    ...(artifacts ? { artifactCount: artifacts.length } : {}),
    ...destIdentityProjection(job),
    ...(checks?.length
      ? {
          checkCount: checks.length,
          checks: checks.slice(0, MAX_SUMMARIZED_CHECKS),
        }
      : {}),
    ...(logs.length ? { logs: logs.map((entry) => boundedText(entry, 512)) } : {}),
    ...(typeof job.runDir === "string"
      ? {
          resources: {
            job: `/jobs/${resourceSegment(jobId)}`,
            run: `/runs/${resourceSegment(jobId)}`,
            runDir: job.runDir,
            ...(checks?.some((check) => check.status === "failed" || check.status === "blocked")
              ? {
                  repairs: checks
                    .filter((check) => check.status === "failed" || check.status === "blocked")
                    .slice(0, MAX_SUMMARIZED_CHECKS)
                    .map(
                      (check) =>
                        `/runs/${resourceSegment(jobId)}/checks/${resourceSegment(String(check.id))}/repair`,
                    ),
                }
              : {}),
          },
        }
      : {}),
  };
}

/** How many findings a pack export hands a caller before it has to open the pack. */
const MAX_SUMMARIZED_FINDINGS = 40;

/**
 * A pack export is the readable half of a matrix run, so its findings must
 * survive the job projection instead of being dropped with the rest of the
 * response. Each one keeps the frame it came from so a caller can look.
 */
function projectFinding(value: unknown, frame: unknown): unknown {
  const finding = object(value);
  if (!finding) return value;
  return {
    code: finding.code,
    severity: finding.severity,
    confidence: finding.confidence,
    locale: finding.locale,
    screenLabel: finding.screenLabel,
    detail: finding.detail,
    ...(typeof frame === "string" ? { frame } : {}),
  };
}

/**
 * A live analysis carries one entry per frame per case, which is a grid's worth
 * of paths for a caller that asked what broke. Keep the verdicts and the counts
 * that say how much could be read; the frames stay in the runs.
 */
function summarizeLocaleAnalysis(response: Record<string, unknown>): unknown {
  const analysis = object(response.analysis);
  if (!analysis) return response;
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const cases = Array.isArray(response.cases) ? response.cases : [];
  const framePaths = new Map<string, unknown>();
  const summarized = cases.map((value) => {
    const item = object(value);
    const frames = Array.isArray(item?.frames) ? item.frames : [];
    for (const entry of frames) {
      const frame = object(entry);
      if (frame)
        framePaths.set(`${String(item?.locale)}\n${String(frame.canonicalKey)}`, frame.framePath);
    }
    return {
      jobId: item?.jobId,
      locale: item?.locale,
      status: item?.status,
      frameCount: frames.length,
      inspectedFrames: frames.filter((entry) => object(entry)?.inspected === true).length,
    };
  });
  return {
    batchId: response.batchId,
    locales: response.locales,
    coverage: response.coverage,
    cases: summarized,
    analysis: {
      baselineLocale: analysis.baselineLocale,
      critical: analysis.critical,
      warnings: analysis.warnings,
      affectedScreens: analysis.affectedScreens,
      findingCount: findings.length,
      findings: findings
        .slice(0, MAX_SUMMARIZED_FINDINGS)
        .map((value) =>
          projectFinding(
            value,
            framePaths.get(
              `${String(object(value)?.locale)}\n${String(object(value)?.canonicalKey)}`,
            ),
          ),
        ),
    },
  };
}

function summarizePackExport(response: Record<string, unknown>): unknown {
  const manifest = object(response.manifest);
  if (!manifest) return response;
  const analysis = object(manifest.analysis);
  const byCanonicalKey = object(manifest.byCanonicalKey);
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  return {
    ...(typeof response.rootDir === "string" ? { rootDir: response.rootDir } : {}),
    ...(Array.isArray(response.jobIds) ? { jobIds: response.jobIds } : {}),
    manifest: {
      batchId: manifest.batchId,
      title: manifest.title,
      locales: manifest.locales,
      generatedAt: manifest.generatedAt,
      analysisCoverage: manifest.analysisCoverage,
      ...(object(manifest.content)
        ? {
            content: {
              method: object(manifest.content)?.method,
              inspectedPages: object(manifest.content)?.inspectedPages,
              uniquePages: object(manifest.content)?.uniquePages,
              duplicateGroupCount: Array.isArray(object(manifest.content)?.duplicateGroups)
                ? (object(manifest.content)!.duplicateGroups as unknown[]).length
                : 0,
              comparison: "comparison.html",
            },
          }
        : {}),
      cases: cases.map((value) => {
        const item = object(value);
        return {
          locale: item?.locale,
          status: item?.status,
          frameCount: Array.isArray(item?.frames) ? item.frames.length : 0,
          ...(typeof item?.expectedFrames === "number"
            ? { expectedFrames: item.expectedFrames }
            : {}),
        };
      }),
      ...(analysis
        ? {
            analysis: {
              baselineLocale: analysis.baselineLocale,
              critical: analysis.critical,
              warnings: analysis.warnings,
              affectedScreens: analysis.affectedScreens,
              findingCount: findings.length,
              findings: findings.slice(0, MAX_SUMMARIZED_FINDINGS).map((value) => {
                const finding = object(value);
                if (!finding) return value;
                const locales = object(byCanonicalKey?.[String(finding.canonicalKey)]);
                return projectFinding(finding, locales?.[String(finding.locale)]);
              }),
            },
          }
        : {}),
    },
  };
}

function summarizePlanCaptureReview(response: Record<string, unknown>): unknown {
  const queue = object(response.queue);
  const items = Array.isArray(queue?.items) ? queue.items : undefined;
  const destItems = items
    ? destIdentityReviewItems(items as CaptureReviewItem[]).map((item) =>
        compactCaptureReviewItem(item as CaptureReviewItem & { runId?: string }),
      )
    : undefined;
  return {
    ...(queue
      ? {
          queue: {
            ...queue,
            ...(destItems ? { items: destItems } : {}),
          },
        }
      : response.queue !== undefined
        ? { queue: response.queue }
        : {}),
    ...(response.results !== undefined ? { results: response.results } : {}),
  };
}

function summarizePersistedRun(run: Record<string, unknown>): Record<string, unknown> {
  const optional = ["title", "action", "platform", "serial", "outcome", "status"] as const;
  const fields: Record<string, string | number> = {};
  if (typeof run.id === "string") fields.id = run.id;
  if (typeof run.status === "string") fields.status = run.status;
  for (const key of optional) {
    const value = run[key];
    if (typeof value === "string") {
      const bounded = boundedText(value, 2_000);
      if (bounded !== undefined) fields[key] = bounded;
    }
  }
  if (typeof run.durationMs === "number") fields.durationMs = run.durationMs;
  const frames = listedFrames(run.frames);
  return {
    ...fields,
    ...(frames.length ? { frameCount: frames.length } : {}),
    ...destIdentityProjection(run),
  };
}

function summarizeRunGet(response: Record<string, unknown>): unknown {
  const run = object(response.run) ?? response;
  return { run: summarizePersistedRun(run) };
}

function summarizeRunCaptureReview(response: Record<string, unknown>): unknown {
  const run = object(response.run);
  const queue = object(response.queue);
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const destItems = destIdentityReviewItems(items as CaptureReviewItem[]).map(
    compactCaptureReviewItem,
  );
  return {
    ...(run ? { destIdentity: destIdentityProjection(run).destIdentity } : {}),
    queue: {
      ...queue,
      items: destItems,
    },
    ...(response.decision !== undefined ? { decision: response.decision } : {}),
  };
}

function summarizeRunEvidence(response: Record<string, unknown>): unknown {
  const evidence = object(response.evidence) ?? response;
  if (!evidence) return response;
  const artifacts = artifactRecords(evidence.artifacts);
  const destPaths = new Set(captureReviewIdentityFramePaths(artifacts));
  const testStepEvidence = Array.isArray(evidence.testStepEvidence)
    ? evidence.testStepEvidence.filter((item) => {
        if (!destPaths.size) return true;
        const record = object(item);
        const nested = object(record?.evidence);
        const frames = Array.isArray(nested?.framePaths)
          ? nested.framePaths
          : Array.isArray(record?.framePaths)
            ? record.framePaths
            : [];
        if (!frames.length) return true;
        return frames.some((path) => typeof path === "string" && destPaths.has(path));
      })
    : undefined;
  const destIdentity = destPaths.size
    ? [...destPaths].map((path) => ({ path }))
    : compactDestIdentity([], artifacts);
  return {
    evidence: {
      ...(typeof evidence.runId === "string" ? { runId: evidence.runId } : {}),
      ...(typeof evidence.schemaVersion === "number"
        ? { schemaVersion: evidence.schemaVersion }
        : {}),
      ...(destIdentity.length ? { destIdentity } : {}),
      ...(testStepEvidence ? { testStepEvidence } : {}),
      ...(evidence.channels !== undefined ? { channels: evidence.channels } : {}),
    },
  };
}

/**
 * A standalone step is not a job, but an iOS outcome-unknown still needs the
 * exact same terminal/review facts to reach an MCP caller. Keep the repair
 * package intact (it contains durable evidence references, not screen bytes)
 * while bounding incidental logs and error prose.
 */
function summarizeStandaloneStep(response: Record<string, unknown>): unknown {
  const logs = Array.isArray(response.logs)
    ? response.logs
        .filter((entry): entry is string => typeof entry === "string")
        .slice(-24)
        .map((entry) => boundedText(entry, 512) ?? "")
    : [];
  const base = {
    ok: response.ok === true,
    ...(typeof response.error === "string" ? { error: boundedText(response.error, 2_000) } : {}),
    ...(typeof response.durationMs === "number" ? { durationMs: response.durationMs } : {}),
    logs,
  };
  if (response.terminal !== "review-needed") return base;
  return {
    ...base,
    terminal: "review-needed",
    ...(typeof response.code === "string" ? { code: response.code } : {}),
    ...(response.iosMutation !== undefined ? { iosMutation: response.iosMutation } : {}),
    ...(response.iosSessionLifecycle !== undefined
      ? { iosSessionLifecycle: response.iosSessionLifecycle }
      : {}),
    ...(response.iosVisualVerification !== undefined
      ? { iosVisualVerification: response.iosVisualVerification }
      : {}),
    ...(response.stepReview !== undefined ? { stepReview: response.stepReview } : {}),
  };
}

/** Bounded command/MCP projection for execution jobs. Full traces remain in
 * run resources and TracePacks where they can be queried deliberately. */
export function summarizeExecutionOperationResult(operationId: string, result: unknown): unknown {
  const response = object(result);
  if (!response) return result;
  if (operationId === "step.run") return summarizeStandaloneStep(response);
  if (operationId === "run.get") return summarizeRunGet(response);
  if (operationId === "run.evidence.get") return summarizeRunEvidence(response);
  if (operationId === "run.capture.review") return summarizeRunCaptureReview(response);
  if (operationId !== "app-map.flow.run" && !operationId.startsWith("job.")) return result;
  if (operationId.endsWith(".export")) return summarizePackExport(response);
  if (operationId.endsWith(".analysis")) return summarizeLocaleAnalysis(response);
  if (operationId.includes(".capture.review")) return summarizePlanCaptureReview(response);
  const job = response.job === undefined ? undefined : summarizeJob(response.job);
  const jobs = Array.isArray(response.jobs) ? response.jobs.map(summarizeJob) : undefined;
  const plan = object(response.plan);
  const flow = object(plan?.flow);
  const connections = Array.isArray(plan?.connections) ? plan.connections : undefined;
  return {
    ...(job !== undefined ? { job } : {}),
    ...(jobs !== undefined ? { jobs } : {}),
    ...(plan
      ? {
          plan: {
            appMapId: plan.appMapId,
            appMapRevision: plan.appMapRevision,
            ...(flow ? { flow: { id: flow.id, name: flow.name } } : {}),
            connectionCount: connections?.length ?? 0,
            terminal: plan.terminal,
          },
        }
      : {}),
    ...(response.matrix !== undefined ? { matrix: response.matrix } : {}),
  };
}
