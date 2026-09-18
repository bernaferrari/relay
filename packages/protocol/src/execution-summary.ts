import {
  captureReviewIdentityFramePaths,
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  destIdentityReviewItems,
  destIdentitySourceFrames,
  enrichCaptureReviewObservedSession,
  isCaptureReviewLeftoverCaption,
  liveCaptureReviewAccount,
  projectCaptureReviewDestIdentity,
  CAPTURE_REVIEW_DEST_PHASE,
  resolveCaptureReviewQueue,
  type CaptureReviewConfiguration,
  type CaptureReviewItem,
  type CaptureReviewObservedSession,
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
  return projectCaptureReviewDestIdentity(frames, artifacts);
}

/** Leftover Close captions cannot fill dest identity. Unphased dest-wait still
 * keeps leftover rasters on the comparison; destIdentity stays empty. */
function destIdentityVisualFrames(
  frames: readonly { path: string; caption?: string }[],
): { path: string; caption?: string }[] {
  return projectCaptureReviewDestIdentity([], [], frames);
}

function listedFramePath(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = object(value);
  const path = typeof record?.path === "string" ? record.path.trim() : "";
  return path || undefined;
}

/** Keep live/fixture account identity on compact CLI/MCP capture-review.
 * SuperGrok* / Lane-name stand-ins stay dropped (same as stamp). Device-observed
 * historical `signed-out` (browser scheduler on an iPad Lane) is also dropped. */
function compactCaptureReviewConfiguration(
  configuration?: CaptureReviewConfiguration,
  observed?: CaptureReviewObservedSession,
): CaptureReviewConfiguration | undefined {
  if (!configuration) return undefined;
  const account = liveCaptureReviewAccount(configuration.account, observed);
  const next: CaptureReviewConfiguration = {
    ...(configuration.app?.trim() ? { app: configuration.app.trim() } : {}),
    ...(account ? { account } : {}),
    ...(configuration.browser?.trim() ? { browser: configuration.browser.trim() } : {}),
    ...(configuration.viewport?.trim() ? { viewport: configuration.viewport.trim() } : {}),
    ...(configuration.locale?.trim() ? { locale: configuration.locale.trim() } : {}),
    ...(configuration.build?.trim() ? { build: configuration.build.trim() } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}

function compactCaptureReviewObserved(
  observed?: CaptureReviewObservedSession,
  appName?: string,
): CaptureReviewObservedSession | undefined {
  if (!observed) return undefined;
  const enriched = enrichCaptureReviewObservedSession(
    {
      ...(observed.laneId?.trim() ? { laneId: observed.laneId.trim() } : {}),
      ...(observed.profileId?.trim() ? { profileId: observed.profileId.trim() } : {}),
      ...(observed.sessionStore ? { sessionStore: observed.sessionStore } : {}),
      ...(observed.iosHardwareClass ? { iosHardwareClass: observed.iosHardwareClass } : {}),
    },
    appName,
  );
  return Object.keys(enriched).length ? enriched : undefined;
}

function compactCaptureReviewItem(
  item: CaptureReviewItem & { runId?: string; attempt?: number },
): Record<string, unknown> {
  const observed = compactCaptureReviewObserved(item.observed, item.configuration?.app);
  const configuration = compactCaptureReviewConfiguration(item.configuration, observed);
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
    ...(configuration ? { configuration } : {}),
    ...(observed ? { observed } : {}),
  };
}

function listedDestIdentity(value: unknown): { path: string; caption?: string }[] {
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

function visibleDestCaptureReviewItems(
  items: CaptureReviewItem[],
  destPaths: Set<string>,
  leftover: Set<string>,
): CaptureReviewItem[] {
  return destIdentityReviewItems(items).filter((item) => {
    if (!item.framePath) return true;
    if (destPaths.size) return destPaths.has(item.framePath);
    return !leftover.has(item.framePath);
  });
}

function destIdentityProjection(record: Record<string, unknown>): {
  destIdentity?: { path: string; caption?: string }[];
  captureReview?: Record<string, unknown>[];
} {
  const artifacts = artifactRecords(record.artifacts);
  const frames = listedFrames(record.frames);
  const computed = compactDestIdentity(frames, artifacts);
  const destIdentity = computed.length
    ? computed
    : destIdentityVisualFrames(listedDestIdentity(record.destIdentity));
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(captureReviewLeftoverLastFramePaths(frames, artifacts));
  const queue = resolveCaptureReviewQueue({
    artifacts,
    decisions: Array.isArray(record.captureReviews) ? record.captureReviews : undefined,
  });
  // Listed destIdentity already falls back without artifacts; listed captureReview
  // must too — otherwise run.list/job.list drop Observe account while Close-drop
  // assertions still pass on an empty queue (MCP runs collection already keeps it).
  let visible = visibleDestCaptureReviewItems(queue.items, destPaths, leftover);
  if (!visible.length && Array.isArray(record.captureReview)) {
    visible = visibleDestCaptureReviewItems(
      record.captureReview as CaptureReviewItem[],
      destPaths,
      leftover,
    );
  }
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
function analysisCaseFrames(value: unknown): { path: string; caption?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const frame = object(entry);
    const path =
      listedFramePath(frame?.framePath) ?? listedFramePath(frame?.path) ?? listedFramePath(entry);
    if (!path) return [];
    const caption = typeof frame?.caption === "string" ? frame.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

function summarizeLocaleAnalysis(response: Record<string, unknown>): unknown {
  const analysis = object(response.analysis);
  if (!analysis) return response;
  const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
  const cases = Array.isArray(response.cases) ? response.cases : [];
  const listed = cases.flatMap((value) => analysisCaseFrames(object(value)?.frames));
  const destIdentity = destIdentityVisualFrames(listed);
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(
    destPaths.size
      ? listed.filter((frame) => !destPaths.has(frame.path)).map((frame) => frame.path)
      : [],
  );
  const originalFramePaths = new Map<string, unknown>();
  const framePaths = new Map<string, unknown>();
  const summarized = cases.map((value) => {
    const item = object(value);
    const frames = Array.isArray(item?.frames) ? item.frames : [];
    const visible = destPaths.size
      ? frames.filter((entry) => {
          const path = listedFramePath(object(entry)?.framePath) ?? listedFramePath(entry);
          return !path || destPaths.has(path);
        })
      : frames;
    for (const entry of frames) {
      const frame = object(entry);
      if (frame)
        originalFramePaths.set(
          `${String(item?.locale)}\n${String(frame.canonicalKey)}`,
          frame.framePath,
        );
    }
    for (const entry of visible) {
      const frame = object(entry);
      if (frame)
        framePaths.set(`${String(item?.locale)}\n${String(frame.canonicalKey)}`, frame.framePath);
    }
    return {
      jobId: item?.jobId,
      locale: item?.locale,
      status: item?.status,
      frameCount: visible.length,
      inspectedFrames: visible.filter((entry) => object(entry)?.inspected === true).length,
    };
  });
  const projectedFindings = findings
    .slice(0, MAX_SUMMARIZED_FINDINGS)
    .filter((value) => {
      const finding = object(value);
      const source = originalFramePaths.get(
        `${String(finding?.locale)}\n${String(finding?.canonicalKey)}`,
      );
      return typeof source !== "string" || !leftover.has(source);
    })
    .map((value) =>
      projectFinding(
        value,
        framePaths.get(`${String(object(value)?.locale)}\n${String(object(value)?.canonicalKey)}`),
      ),
    );
  return {
    batchId: response.batchId,
    locales: response.locales,
    coverage: response.coverage,
    ...(destIdentity.length ? { destIdentity } : {}),
    cases: summarized,
    analysis: {
      baselineLocale: analysis.baselineLocale,
      critical: analysis.critical,
      warnings: analysis.warnings,
      affectedScreens: analysis.affectedScreens,
      findingCount: findings.length,
      findings: projectedFindings,
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
  const listed = cases.flatMap((value) => analysisCaseFrames(object(value)?.frames));
  const destIdentity = destIdentityVisualFrames(listed);
  const destPaths = new Set(destIdentity.map((frame) => frame.path));
  const leftover = new Set(
    destPaths.size
      ? listed.filter((frame) => !destPaths.has(frame.path)).map((frame) => frame.path)
      : [],
  );
  return {
    ...(typeof response.rootDir === "string" ? { rootDir: response.rootDir } : {}),
    ...(Array.isArray(response.jobIds) ? { jobIds: response.jobIds } : {}),
    ...(destIdentity.length ? { destIdentity } : {}),
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
        const frames = Array.isArray(item?.frames) ? item.frames : [];
        const visible = destPaths.size
          ? frames.filter((entry) => {
              const path = listedFramePath(object(entry)?.framePath) ?? listedFramePath(entry);
              return !path || destPaths.has(path);
            })
          : frames;
        return {
          locale: item?.locale,
          status: item?.status,
          frameCount: visible.length,
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
              findings: findings
                .slice(0, MAX_SUMMARIZED_FINDINGS)
                .filter((value) => {
                  const finding = object(value);
                  const source = object(byCanonicalKey?.[String(finding?.canonicalKey)])?.[
                    String(finding?.locale)
                  ];
                  return typeof source !== "string" || !leftover.has(source);
                })
                .map((value) => {
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
  const destIdentity = destItems ? destIdentityVisualFrames(listedReviewFrames(destItems)) : [];
  return {
    ...(destIdentity.length ? { destIdentity } : {}),
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

function projectVisualSnapshot(value: unknown): Record<string, unknown> | undefined {
  const snapshot = object(value);
  if (!snapshot) return undefined;
  const frames = destIdentitySourceFrames(listedFrames(snapshot.frames));
  return {
    ...snapshot,
    ...(frames.length || snapshot.frameCount !== undefined ? { frameCount: frames.length } : {}),
    ...(snapshot.frames !== undefined ? { frames } : {}),
  };
}

function visualDestPaths(snapshot: Record<string, unknown> | undefined): Set<string> {
  return new Set(listedFrames(snapshot?.frames).map((frame) => frame.path));
}

function projectVisualDiff(value: unknown, destPaths: Set<string>): unknown {
  const diff = object(value);
  if (!diff || !destPaths.size || !Array.isArray(diff.frames)) return value;
  const frames = diff.frames.filter((entry) => {
    const item = object(entry);
    const latest = listedFramePath(object(item?.latest)?.path);
    const approved = listedFramePath(object(item?.approved)?.path);
    if (latest && destPaths.has(latest)) return true;
    if (approved && destPaths.has(approved)) return true;
    if (latest && !destPaths.has(latest)) return false;
    if (approved && !destPaths.has(approved)) return false;
    return true;
  });
  return { ...diff, latestFrameCount: destPaths.size, frames };
}

/** Visual compare / baseline JSON never treats leftover Close 004 as dest. */
function summarizeVisualComparison(response: Record<string, unknown>): unknown {
  const comparison = object(response.comparison);
  const latest = projectVisualSnapshot(comparison?.latest);
  const approved = projectVisualSnapshot(comparison?.approved);
  const baselineRecord = object(comparison?.baseline) ?? object(response.baseline);
  const baselineApproved = projectVisualSnapshot(baselineRecord?.approved);
  const destIdentity = destIdentityVisualFrames([
    ...listedFrames(latest?.frames),
    ...listedFrames(baselineApproved?.frames),
  ]);
  const destPaths = visualDestPaths(latest);
  const comparisonBaseline = object(comparison?.baseline);
  return {
    ...response,
    ...(destIdentity.length ? { destIdentity } : {}),
    ...(comparison
      ? {
          comparison: {
            ...comparison,
            ...(latest ? { latest } : {}),
            ...(approved ? { approved } : {}),
            ...(comparisonBaseline
              ? {
                  baseline: {
                    ...comparisonBaseline,
                    ...(baselineApproved ? { approved: baselineApproved } : {}),
                  },
                }
              : {}),
            ...(comparison.diff !== undefined
              ? { diff: projectVisualDiff(comparison.diff, destPaths) }
              : {}),
          },
        }
      : {}),
    ...(object(response.baseline)
      ? {
          baseline: {
            ...object(response.baseline),
            ...(baselineApproved ? { approved: baselineApproved } : {}),
          },
        }
      : {}),
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

/** Deferred run review keeps the decision. Leftover Close last-frame cannot fill dest. */
function summarizeRunReview(response: Record<string, unknown>): unknown {
  const run = object(response.run);
  return {
    ...response,
    ...(run ? { run: summarizePersistedRun(run) } : {}),
  };
}

/** Offline replay keeps the frozen report. Leftover Close last-frame cannot fill dest. */
function summarizeOfflineReplay(response: Record<string, unknown>): unknown {
  const report = object(response.report);
  const projected = destIdentityProjection(report ?? response);
  return {
    ...response,
    ...(projected.destIdentity ? { destIdentity: projected.destIdentity } : {}),
    ...(report
      ? {
          report: {
            ...report,
            ...(projected.destIdentity ? { destIdentity: projected.destIdentity } : {}),
            ...(projected.captureReview ? { captureReview: projected.captureReview } : {}),
          },
        }
      : {}),
  };
}

function summarizeRunCaptureReview(response: Record<string, unknown>): unknown {
  const run = object(response.run);
  const queue = object(response.queue);
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const destItems = destIdentityReviewItems(items as CaptureReviewItem[]).map(
    compactCaptureReviewItem,
  );
  const fromRun = run ? destIdentityProjection(run).destIdentity : undefined;
  const fromQueue = destIdentityVisualFrames(listedReviewFrames(destItems));
  const destIdentity = fromRun?.length ? fromRun : fromQueue;
  return {
    ...(destIdentity.length ? { destIdentity } : {}),
    queue: {
      ...queue,
      items: destItems,
    },
    ...(response.decision !== undefined ? { decision: response.decision } : {}),
  };
}

function compactStoryBeat(value: unknown): Record<string, unknown> {
  const beat = object(value);
  if (!beat) return {};
  return {
    ...(typeof beat.kind === "string" ? { kind: beat.kind } : {}),
    ...(typeof beat.text === "string" ? { text: boundedText(beat.text, 400) } : {}),
    ...(typeof beat.evidence === "string" ? { evidence: boundedText(beat.evidence, 400) } : {}),
    ...(typeof beat.at === "number" ? { at: beat.at } : {}),
  };
}

function summarizeRunStory(response: Record<string, unknown>): unknown {
  const story = object(response.story) ?? response;
  const beats = Array.isArray(story.beats) ? story.beats : [];
  const destIdentity = beats.flatMap((item) => {
    const beat = object(item);
    if (beat?.kind !== "dest-identity") return [];
    const evidence = typeof beat.evidence === "string" ? beat.evidence.trim() : "";
    return evidence ? [{ path: evidence }] : [];
  });
  const destPaths = new Set(destIdentity.map((item) => item.path));
  const visible = destPaths.size
    ? beats.filter((item) => {
        const beat = object(item);
        const evidence = typeof beat?.evidence === "string" ? beat.evidence : undefined;
        if (beat?.kind === "dest-identity") return true;
        if (evidence && destPaths.has(evidence)) return true;
        if (evidence && /(?:^|\/)frames\/\d+\.png$/u.test(evidence)) return false;
        return true;
      })
    : beats;
  return {
    story: {
      ...(typeof story.runId === "string" ? { runId: story.runId } : {}),
      ...(typeof story.title === "string" ? { title: boundedText(story.title) } : {}),
      ...(typeof story.summary === "string" ? { summary: boundedText(story.summary) } : {}),
      ...(typeof story.outcome === "string" ? { outcome: story.outcome } : {}),
      ...(destIdentity.length ? { destIdentity } : {}),
      beats: visible.slice(0, 80).map(compactStoryBeat),
    },
  };
}

function summarizeTracePackEnvelope(response: Record<string, unknown>): unknown {
  const pack = object(response.tracePack);
  const objects = Array.isArray(pack?.objects) ? pack.objects : [];
  const frozen = objects.map(object).find((item) => item?.kind === "frozen-run");
  const content = object(frozen?.content);
  const projected = destIdentityProjection({
    ...content,
    destIdentity: content?.destIdentity ?? response.destIdentity,
  });
  return projected.destIdentity?.length
    ? { ...response, destIdentity: projected.destIdentity }
    : response;
}

/** run.list keeps dest wait-for Fast and compact captureReview account/observed.
 * Leftover Close / Run saved Test last-frame cannot fill dest or the review queue. */
function summarizeRunList(response: Record<string, unknown>): unknown {
  if (!Array.isArray(response.runs)) return response;
  return {
    ...response,
    runs: response.runs.map((item) => {
      const run = object(item);
      if (!run) return item;
      const projected = destIdentityProjection(run);
      const { destIdentity: _listed, captureReview: _listedReview, ...rest } = run;
      return {
        ...rest,
        ...(projected.destIdentity ? { destIdentity: projected.destIdentity } : {}),
        ...(projected.captureReview ? { captureReview: projected.captureReview } : {}),
      };
    }),
  };
}

function comparisonListedFrames(value: unknown): { path: string; caption?: string }[] {
  const comparison = object(value);
  const latest = object(comparison?.latest);
  const approved = object(comparison?.approved);
  const baselineApproved = object(object(comparison?.baseline)?.approved);
  return [
    ...listedFrames(latest?.frames),
    ...listedFrames(approved?.frames),
    ...listedFrames(baselineApproved?.frames),
  ];
}

function analysisListedFrames(value: unknown): { path: string; caption?: string }[] {
  return Array.isArray(value)
    ? value.flatMap((item) => analysisCaseFrames(object(item)?.frames))
    : [];
}

function listedReviewFrames(value: unknown): { path: string; caption?: string }[] {
  const queue = object(value);
  const items = Array.isArray(queue?.items) ? queue.items : Array.isArray(value) ? value : [];
  return destIdentityReviewItems(
    items.flatMap((item) => {
      const record = object(item);
      return record ? [record as CaptureReviewItem] : [];
    }),
  ).flatMap((item) => {
    const path = listedFramePath(item.framePath) ?? listedFramePath(object(item)?.path);
    if (!path) return [];
    const caption = typeof item.caption === "string" ? item.caption : undefined;
    return [{ path, ...(caption ? { caption } : {}) }];
  });
}

function findingsListedFrames(value: unknown): { path: string; caption?: string }[] {
  const findings = object(value);
  if (!findings) return [];
  const analysis = object(findings.analysis);
  return [
    ...listedDestIdentity(findings.destIdentity),
    ...analysisListedFrames(findings.cases),
    ...listedDestIdentity(analysis?.destIdentity),
    ...analysisListedFrames(analysis?.cases),
  ];
}

function exportListedFrames(value: unknown): { path: string; caption?: string }[] {
  const exported = object(value);
  if (!exported) return [];
  const manifest = object(exported.manifest);
  return [
    ...listedDestIdentity(exported.destIdentity),
    ...listedDestIdentity(manifest?.destIdentity),
    ...analysisListedFrames(exported.cases),
    ...analysisListedFrames(manifest?.cases),
  ];
}

function destIdentityFromEnvelope(
  record: Record<string, unknown>,
): { path: string; caption?: string }[] {
  const inner = object(record.result);
  const visual = destIdentityVisualFrames([
    ...listedDestIdentity(record.destIdentity),
    ...listedDestIdentity(object(record.job)?.destIdentity),
    ...listedDestIdentity(object(record.run)?.destIdentity),
    ...listedDestIdentity(object(record.evidence)?.destIdentity),
    ...listedDestIdentity(object(record.report)?.destIdentity),
    ...listedDestIdentity(object(record.story)?.destIdentity),
    ...listedDestIdentity(inner?.destIdentity),
    ...listedDestIdentity(object(inner?.job)?.destIdentity),
    ...listedDestIdentity(object(inner?.run)?.destIdentity),
    ...listedDestIdentity(object(inner?.evidence)?.destIdentity),
    ...listedDestIdentity(object(inner?.report)?.destIdentity),
    ...listedDestIdentity(object(inner?.story)?.destIdentity),
    ...comparisonListedFrames(record.comparison),
    ...comparisonListedFrames(inner?.comparison),
    ...analysisListedFrames(record.cases),
    ...analysisListedFrames(inner?.cases),
    ...findingsListedFrames(record.findings),
    ...findingsListedFrames(inner?.findings),
    ...exportListedFrames(record.export),
    ...exportListedFrames(inner?.export),
    ...listedReviewFrames(record.queue),
    ...listedReviewFrames(inner?.queue),
  ]);
  if (visual.length) return visual;
  const nested =
    object(record.job) ??
    object(record.run) ??
    object(record.report) ??
    object(record.evidence) ??
    object(inner?.job) ??
    object(inner?.run) ??
    object(inner?.report) ??
    object(inner?.evidence) ??
    inner;
  return nested ? (destIdentityProjection(nested).destIdentity ?? []) : [];
}

function compactIdStatus(
  record: Record<string, unknown>,
  destIdentity: { path: string; caption?: string }[],
): Record<string, unknown> {
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.status === "string" ? { status: record.status } : {}),
    ...(typeof record.outcome === "string" ? { outcome: record.outcome } : {}),
    ...(destIdentity.length ? { destIdentity } : {}),
  };
}

function compactListedRecords(
  items: unknown,
  destIdentity: { path: string; caption?: string }[],
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(items)) return undefined;
  const listed = items.slice(0, 8).flatMap((item) => {
    const nested = object(item);
    if (!nested) return [];
    const nestedDest = destIdentityFromEnvelope(nested);
    return [compactIdStatus(nested, nestedDest.length ? nestedDest : destIdentity)];
  });
  return listed.length ? listed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

/** MCP text-limit fallback. Dest wait-for Fast stays; leftover Close cannot fill dest,
 * including oversized visual compare/review/baseline, nested plan_run findings/export,
 * and capture-review queue envelopes. */
export function compactExecutionDestIdentityFallback(
  result: unknown,
  operationId?: string,
): unknown {
  const summarized = operationId ? summarizeExecutionOperationResult(operationId, result) : result;
  const record = object(summarized) ?? object(result);
  if (!record) {
    return {
      truncated: true,
      message: "Relay result omitted from text because it exceeds the MCP text limit.",
    };
  }
  const inner = object(record.result);
  const destIdentity = destIdentityFromEnvelope(record);
  const run = object(record.run) ?? object(inner?.run);
  const job = object(record.job) ?? object(inner?.job);
  const evidence = object(record.evidence) ?? object(inner?.evidence);
  const report = object(record.report) ?? object(inner?.report);
  const story = object(record.story) ?? object(inner?.story);
  const findings = object(record.findings) ?? object(inner?.findings);
  const exported = object(record.export) ?? object(inner?.export);
  const findingsDest = findings ? destIdentityFromEnvelope(findings) : [];
  const exportDest = exported ? destIdentityFromEnvelope(exported) : [];
  const id = firstString(
    run?.id,
    job?.id,
    evidence?.runId,
    report?.runId,
    story?.runId,
    record.id,
    inner?.id,
  );
  const jobs =
    compactListedRecords(record.jobs, destIdentity) ??
    compactListedRecords(inner?.jobs, destIdentity);
  const runs =
    compactListedRecords(record.runs, destIdentity) ??
    compactListedRecords(inner?.runs, destIdentity);
  return {
    truncated: true,
    message: "Relay result omitted from text because it exceeds the MCP text limit.",
    ...(destIdentity.length ? { destIdentity } : {}),
    ...(id ? { resource: { uri: `relay://runs/${encodeURIComponent(id)}` } } : {}),
    ...(job ? { job: compactIdStatus(job, destIdentity) } : {}),
    ...(jobs ? { jobs } : {}),
    ...(runs ? { runs } : {}),
    ...(run ? { run: compactIdStatus(run, destIdentity) } : {}),
    ...(report
      ? {
          report: {
            ...(typeof report.mode === "string" ? { mode: report.mode } : {}),
            ...(destIdentity.length ? { destIdentity } : {}),
          },
        }
      : {}),
    ...(evidence
      ? {
          evidence: {
            ...(typeof evidence.runId === "string" ? { runId: evidence.runId } : {}),
            ...(destIdentity.length ? { destIdentity } : {}),
          },
        }
      : {}),
    ...(story
      ? {
          story: {
            ...(typeof story.runId === "string" ? { runId: story.runId } : {}),
            ...(destIdentity.length ? { destIdentity } : {}),
          },
        }
      : {}),
    ...(findings
      ? {
          findings: {
            ...(typeof findings.batchId === "string" ? { batchId: findings.batchId } : {}),
            ...(findingsDest.length || destIdentity.length
              ? { destIdentity: findingsDest.length ? findingsDest : destIdentity }
              : {}),
          },
        }
      : {}),
    ...(exported
      ? {
          export: {
            ...(typeof exported.rootDir === "string" ? { rootDir: exported.rootDir } : {}),
            ...(exportDest.length || destIdentity.length
              ? { destIdentity: exportDest.length ? exportDest : destIdentity }
              : {}),
          },
        }
      : {}),
  };
}

/** Keep logs/network on MCP evidence resources. Hoist dest wait-for; leftover
 * Close / Transition executed / Inspect setup skipped cannot fill dest.
 * Path+caption frames stay internal to the filter — not re-listed beside Observe. */
export function projectDestIdentityOnEvidence(evidence: unknown): unknown {
  const record = object(evidence);
  if (!record) return evidence;
  const projected = summarizeRunEvidence({ evidence: record }) as {
    evidence?: { destIdentity?: unknown; testStepEvidence?: unknown };
  };
  const dest = projected.evidence;
  const { frames: _framesForDestFilter, ...rest } = record;
  return {
    ...rest,
    ...(dest?.destIdentity ? { destIdentity: dest.destIdentity } : {}),
    ...(dest?.testStepEvidence !== undefined ? { testStepEvidence: dest.testStepEvidence } : {}),
  };
}

/** Missing dest-phase is not every step frame on compact evidence: leftover
 * Transition executed / Inspect setup skipped cannot sit beside Observe.
 * Opener before · Tap cannot fill testStepEvidence beside those leftovers either
 * (parity with destIdentityCheckpointFramePaths / persisted step evidence).
 * Unphased Android dest-wait with no leftover caption keeps every frame and
 * omits destIdentity (callers keep every PNG elsewhere). */
function summarizeRunEvidence(response: Record<string, unknown>): unknown {
  const evidence = object(response.evidence) ?? response;
  if (!evidence) return response;
  const artifacts = artifactRecords(evidence.artifacts);
  const frames = listedFrames(evidence.frames);
  const phased = captureReviewIdentityFramePaths(artifacts);
  const destPaths = destIdentityCheckpointFramePaths(frames, artifacts);
  const leftoverPaths = new Set([
    ...captureReviewLeftoverLastFramePaths(frames, artifacts),
    ...frames.filter((frame) => isCaptureReviewLeftoverCaption(frame.caption)).map((f) => f.path),
  ]);
  const destWaitFor = new Set(destPaths.filter((path) => !leftoverPaths.has(path)));
  const testStepEvidence = Array.isArray(evidence.testStepEvidence)
    ? evidence.testStepEvidence.flatMap((item) => {
        const record = object(item);
        if (!record) return [];
        const nested = object(record.evidence);
        const framePaths = (
          Array.isArray(nested?.framePaths)
            ? nested.framePaths
            : Array.isArray(record.framePaths)
              ? record.framePaths
              : []
        ).filter((path): path is string => typeof path === "string" && path.trim().length > 0);
        if (!framePaths.length) return [item];
        if (phased.length) {
          return framePaths.some((path) => phased.includes(path)) ? [item] : [];
        }
        if (!leftoverPaths.size || !destWaitFor.size) return [item];
        /** Keep dest wait-for only — not “everything except leftover”, which still
         * left opener before · Tap beside Observe. */
        const kept = framePaths.filter((path) => destWaitFor.has(path));
        if (!kept.length) return [];
        if (kept.length === framePaths.length) return [item];
        return [
          {
            ...record,
            evidence: {
              ...(nested ?? {}),
              framePaths: kept,
            },
          },
        ];
      })
    : undefined;
  const byPath = new Map(frames.map((frame) => [frame.path, frame]));
  const destIdentity =
    phased.length || frames.some((frame) => isCaptureReviewLeftoverCaption(frame.caption))
      ? destPaths.map((path) => {
          const frame = byPath.get(path);
          return frame?.caption ? { path, caption: frame.caption } : { path };
        })
      : [];
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

/** Workflow / test-run / replay envelopes keep their other fields; leftover Close
 * last-frame cannot fill dest on the attached job. Top-level destIdentity /
 * captureReview also stay dest wait-for Fast — leftover Close cannot fill dest. */
function projectAttachedJobResult(response: Record<string, unknown>): Record<string, unknown> {
  const {
    destIdentity: listedDest,
    captureReview: listedReview,
    job: _job,
    jobs: _jobs,
    ...rest
  } = response;
  const job = response.job === undefined ? undefined : summarizeJob(response.job);
  const jobs = Array.isArray(response.jobs) ? response.jobs.map(summarizeJob) : undefined;
  const destIdentity = destIdentityVisualFrames(listedDestIdentity(listedDest));
  const captureReview = Array.isArray(listedReview)
    ? destIdentityReviewItems(listedReview as CaptureReviewItem[]).map(compactCaptureReviewItem)
    : undefined;
  return {
    ...rest,
    ...(job !== undefined ? { job } : {}),
    ...(jobs !== undefined ? { jobs } : {}),
    ...(destIdentity.length ? { destIdentity } : {}),
    ...(captureReview?.length ? { captureReview } : {}),
  };
}

function isAttachedJobOperation(operationId: string): boolean {
  return (
    operationId === "app-map.test.run" ||
    operationId === "app-map.connection.run" ||
    operationId === "run.replay" ||
    operationId === "run.repair.retry" ||
    operationId.startsWith("workflow.")
  );
}

/** Combine start/campaign JSON keeps campaign/cells/admission. Matrix/soak keep
 * the matrix. Resume jobs keep dest wait-for Fast; leftover Close last-frame
 * cannot fill dest. */
function summarizeJobEnvelope(response: Record<string, unknown>): unknown {
  return projectAttachedJobResult(response);
}

function isJobEnvelopeOperation(operationId: string): boolean {
  return (
    operationId === "job.combine.start" ||
    operationId.startsWith("job.combine.campaign.") ||
    operationId === "job.matrix.start" ||
    operationId === "job.soak.start" ||
    operationId === "job.compatibility-matrix.start" ||
    operationId === "job.retry" ||
    operationId === "job.active.cancel"
  );
}

/** Bounded command/MCP projection for execution jobs. Full traces remain in
 * run resources and TracePacks where they can be queried deliberately. */
export function summarizeExecutionOperationResult(operationId: string, result: unknown): unknown {
  const response = object(result);
  if (!response) return result;
  if (operationId === "step.run") return summarizeStandaloneStep(response);
  if (operationId === "run.get") return summarizeRunGet(response);
  if (operationId === "run.list") return summarizeRunList(response);
  if (operationId === "run.review") return summarizeRunReview(response);
  if (operationId === "run.replay.offline") return summarizeOfflineReplay(response);
  if (operationId === "run.evidence.get") return summarizeRunEvidence(response);
  if (operationId === "run.capture.review") return summarizeRunCaptureReview(response);
  if (operationId === "run.story.get") return summarizeRunStory(response);
  if (operationId === "run.trace-pack.get") return summarizeTracePackEnvelope(response);
  if (
    operationId === "run.visual.compare" ||
    operationId === "run.visual-baseline.update" ||
    operationId === "run.visual.review" ||
    operationId === "run.visual-policy.update"
  ) {
    return summarizeVisualComparison(response);
  }
  if (isAttachedJobOperation(operationId)) {
    return response.job === undefined && !Array.isArray(response.jobs)
      ? result
      : projectAttachedJobResult(response);
  }
  if (operationId !== "app-map.flow.run" && !operationId.startsWith("job.")) return result;
  if (isJobEnvelopeOperation(operationId)) return summarizeJobEnvelope(response);
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
