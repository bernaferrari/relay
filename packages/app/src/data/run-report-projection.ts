import type { ProductRunReport } from "@relay/product/run-journey";
import { reportTraceSteps } from "./run-story";
import type {
  CaptureReviewDecision,
  CaptureReviewPlannedSlot,
  EvidenceChannel,
  EvidenceChannelRecord,
  RunOutcome,
} from "@relay/protocol";
import {
  captureReviewIdentityFramePaths,
  isCaptureReviewLeftoverCaption,
  isCaptureReviewOpenerCaption,
  liveCaptureReviewAccount,
  parseOptionalRunTestStepEvidence,
  resolveCaptureReviewQueue,
} from "@relay/protocol";
import type { CaptureReferenceComparison, RunTestStepEvidence } from "@relay/protocol";
import { runOutcome } from "./run-outcome";
import {
  frameImageMedia,
  mapDiagnosticEventsToVideo,
  reportDiagnosticEvents,
  reportVideoMedia,
} from "./run-report-media";
import type {
  ReportEvidenceSection,
  ReportEvidenceItem,
  ReportTimelineItem,
  ProductRunReportOverview,
} from "./run-report-model";
import {
  artifactEvidenceChannel,
  channelLabels,
  channelSummaries,
  authoredCaptureStepId,
  destEndCaptureReviewTitle,
  destWaitForEvidenceLabel,
  formatEvidenceDuration,
  formatEvidenceTime,
  formatTransferredBytes,
  humanMetricName,
  humanNetworkResult,
  humanStepTitle,
  humanTargetName,
  leftoverWrapperStepTitle,
  preludeLaneCheckStepTitle,
  publicFailureCategory,
  publicNetworkUrl,
  publicRunCause,
  resolvedTestTitle,
  sentenceCase,
  sourceTestId,
} from "./run-report-projection-helpers";
export { resolvedTestTitle } from "./run-report-projection-helpers";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): string | undefined {
  const bounded = typeof value === "string" ? value.trim().slice(0, 8_192) : "";
  return bounded || undefined;
}
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function channelSections(
  channels: unknown,
  rawRun: unknown,
  rawEvidence: unknown,
): ReportEvidenceSection[] {
  const source = record(channels);
  if (!source) return [];
  const items = evidenceItems(rawRun, rawEvidence);
  const sections: ReportEvidenceSection[] = [];
  for (const [id, label] of Object.entries(channelLabels) as [EvidenceChannel, string][]) {
    const channel = record(source[id]) as EvidenceChannelRecord | undefined;
    const count = finite(channel?.entries) ?? 0;
    if (!channel || count === 0) continue;
    const sectionItems = items[id] ?? [];
    const presentation = evidenceCountPresentation(id, count, rawEvidence);
    sections.push({
      id,
      label: id === "network" ? "Network activity" : label,
      count,
      detail: presentation.detail,
      summary:
        presentation.summary ??
        channelSummaries[id] ??
        "Inspect the evidence Relay captured during this Run.",
      inspectable: sectionItems.length > 0,
      items: sectionItems,
    });
  }
  return sections;
}
function evidenceCountPresentation(
  id: EvidenceChannel,
  fallbackCount: number,
  rawEvidence: unknown,
): { detail: string; summary?: string } {
  const evidence = record(rawEvidence);
  if (id === "network") {
    const requests = array(evidence?.network).length;
    const connections = array(record(evidence?.androidNetwork)?.flows).length;
    const detail = [
      requests ? `${requests} ${plural(requests, "request")}` : undefined,
      connections ? `${connections} ${plural(connections, "connection")}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      detail: detail || "Available",
      summary: networkEvidenceSummary(evidence, requests, connections),
    };
  }
  const noun: Partial<Record<EvidenceChannel, string>> = {
    screenshot: "screenshot",
    "ui-tree": "interface snapshot",
    logs: "log message",
    performance: "performance sample",
    crash: "crash record",
    video: "video",
    audio: "audio capture",
    input: "interaction",
  };
  const value = noun[id] ?? "item";
  return { detail: `${fallbackCount} ${plural(fallbackCount, value)}` };
}

/** Name the collector. Packet metadata must not be read as an HTTP body. */
function networkEvidenceSummary(
  evidence: Record<string, unknown> | undefined,
  requests: number,
  connections: number,
): string {
  const capture = record(evidence?.networkCapture);
  const stated = [text(capture?.label), text(capture?.detail)].filter(Boolean).join(". ");
  if (stated) return stated.endsWith(".") ? stated : `${stated}.`;
  if (requests && connections) {
    return "HTTP rows are observed requests. An encrypted connection does not establish an HTTP body that was not observed.";
  }
  if (requests) return "Review the HTTP requests Relay observed during this Run.";
  if (connections) {
    return "Transport connections observed on the device. Encrypted traffic does not establish an HTTP body that was not observed.";
  }
  return "Relay captured network activity, but request-level details are not available.";
}
function evidenceItems(
  rawRun: unknown,
  rawEvidence: unknown,
): Partial<Record<EvidenceChannel, ReportEvidenceItem[]>> {
  const run = record(rawRun);
  const evidence = record(rawEvidence);
  const output: Partial<Record<EvidenceChannel, ReportEvidenceItem[]>> = {};
  const frames = destWaitForEvidenceFrames(
    uniqueRecords([
      ...array(run?.frames),
      ...array(run?.steps).flatMap((value) => array(record(value)?.frames)),
    ]),
    leftoverBesideDestVisible(rawRun),
    array(run?.artifacts) as Array<{ kind?: string; data?: unknown }>,
    destCaptureStepFramePaths(rawRun),
  );
  if (frames.length) {
    output.screenshot = frames.map((value, index) => {
      const frame = record(value) ?? {};
      const media = frameImageMedia(frame);
      return {
        id: text(frame.path) ?? `screenshot-${index}`,
        title: publicFrameCaption(frame.caption) ?? `Screenshot ${index + 1}`,
        ...((text(frame.caption) ?? "").startsWith("before ·")
          ? { phase: "before" as const }
          : (text(frame.caption) ?? "").startsWith("after ·")
            ? { phase: "after" as const }
            : {}),
        ...(media ? { media } : {}),
        ...(finite(frame.capturedAt) === undefined
          ? {}
          : { meta: formatEvidenceTime(finite(frame.capturedAt)!) }),
      };
    });
  }
  const logs = array(evidence?.logs).flatMap((value, index) => {
    const entry = record(value);
    const message = publicEvidenceText(entry?.message);
    if (!entry || !message) return [];
    const level = text(entry.level)?.toLocaleLowerCase();
    const status = /server responded with a status of (\d{3})/u.exec(message)?.[1];
    const at = finite(entry.at);
    const nearbyRequests =
      status && at !== undefined
        ? array(evidence?.network)
            .map(record)
            .filter(
              (request) =>
                request &&
                request.status === Number(status) &&
                finite(request.at) !== undefined &&
                Math.abs(at - Number(request.at)) <= 1000,
            )
        : [];
    const nearbyRequest = nearbyRequests.length === 1 ? nearbyRequests[0] : undefined;
    const detail = nearbyRequest
      ? `Request recorded at the same time: ${text(nearbyRequest.method) ?? "GET"} ${publicEvidenceText(nearbyRequest.url) ?? ""}`
      : status
        ? "A resource returned an HTTP error during this run. Check Network for the request URL."
        : undefined;
    return [
      {
        id: text(entry.id) ?? `log-${index}`,
        title: message,
        ...(detail ? { detail } : {}),
        meta:
          [
            text(entry.source),
            finite(entry.at) === undefined ? undefined : formatEvidenceTime(finite(entry.at)!),
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        tone: level === "error" ? "critical" : level === "warn" ? "warning" : "neutral",
      } satisfies ReportEvidenceItem,
    ];
  });
  if (logs.length) output.logs = logs;
  const requests = array(evidence?.network).flatMap((value, index) => {
    const entry = record(value);
    if (!entry) return [];
    const method = text(entry.method)?.toLocaleUpperCase();
    const url = publicNetworkUrl(entry.url);
    const status = finite(entry.status);
    const result = text(entry.result);
    const duration = finite(entry.durationMs);
    return [
      {
        id: text(entry.id) ?? `request-${index}`,
        title: [method, url].filter(Boolean).join(" ") || `Request ${index + 1}`,
        detail:
          [
            status ? `Status ${status}` : humanNetworkResult(result),
            duration === undefined ? undefined : formatEvidenceDuration(duration),
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        meta: finite(entry.at) === undefined ? undefined : formatEvidenceTime(finite(entry.at)!),
        tone:
          result === "failure" || (status !== undefined && status >= 400) ? "critical" : "neutral",
      } satisfies ReportEvidenceItem,
    ];
  });
  const connections = array(record(evidence?.androidNetwork)?.flows).flatMap((value, index) => {
    const flow = record(value);
    if (!flow) return [];
    const host = publicEvidenceText(flow.host) ?? publicEvidenceText(flow.remoteAddress);
    const protocol = text(flow.protocol)?.toLocaleUpperCase();
    const outcome = humanNetworkResult(text(flow.outcome));
    return [
      {
        id: `connection-${index}`,
        title: [protocol, host].filter(Boolean).join(" · ") || `Connection ${index + 1}`,
        detail:
          [outcome, formatTransferredBytes(flow.sentBytes, flow.receivedBytes)]
            .filter(Boolean)
            .join(" · ") || undefined,
        meta:
          finite(flow.startedAtMs) === undefined
            ? undefined
            : `+${formatEvidenceDuration(finite(flow.startedAtMs)!)}`,
        tone: ["refused", "reset", "timed-out", "dns-nxdomain"].includes(String(flow.outcome))
          ? "warning"
          : "neutral",
      } satisfies ReportEvidenceItem,
    ];
  });
  if (requests.length || connections.length) output.network = [...requests, ...connections];
  const performance = array(evidence?.performance).flatMap((value, index) => {
    const sample = record(value);
    if (!sample) return [];
    const metrics = record(sample.metrics);
    const summary = metrics
      ? Object.entries(metrics)
          .slice(0, 4)
          .map(([name, metric]) => `${humanMetricName(name)} ${String(metric)}`)
          .join(" · ")
      : undefined;
    return [
      {
        id: text(sample.id) ?? `performance-${index}`,
        title: `${sentenceCase(text(sample.phase) ?? "Performance")} sample`,
        ...(summary ? { detail: summary } : {}),
        meta: finite(sample.at) === undefined ? undefined : formatEvidenceTime(finite(sample.at)!),
      } satisfies ReportEvidenceItem,
    ];
  });
  if (performance.length) output.performance = performance;
  const crashes = array(evidence?.crashes).map((value, index) => {
    const crash = record(value);
    return {
      id: text(crash?.id) ?? `crash-${index}`,
      title:
        publicEvidenceText(crash?.message) ??
        publicEvidenceText(crash?.title) ??
        `Crash record ${index + 1}`,
      tone: "critical" as const,
    };
  });
  if (crashes.length) output.crash = crashes;
  const artifactItems = array(evidence?.artifacts).flatMap((value, index) => {
    const artifact = record(value);
    const kind = text(artifact?.kind);
    if (!artifact || !kind) return [];
    const channel = artifactEvidenceChannel(kind);
    if (!channel || channel === "screenshot") return [];
    return [
      {
        channel,
        item: {
          id: `artifact-${index}`,
          title: publicEvidenceText(artifact.summary) ?? sentenceCase(kind.replace(/[-_]+/gu, "")),
          meta:
            finite(artifact.capturedAt) === undefined
              ? undefined
              : formatEvidenceTime(finite(artifact.capturedAt)!),
        } satisfies ReportEvidenceItem,
      },
    ];
  });
  for (const { channel, item } of artifactItems) {
    (output[channel] ??= []).push(item);
  }
  return output;
}
function reportTimeline(
  rawRun: unknown,
  stepEvidence?: readonly RunTestStepEvidence[],
): ReportTimelineItem[] {
  const combine = array(record(rawRun)?.artifacts)
    .map(record)
    .find((item) => item?.kind === "app-map-combine-cell-execution-intent");
  const childGraph = record(record(record(combine?.data)?.child)?.recipeGraph);
  const authoredRecipes = childGraph ? new Set(Object.keys(childGraph)) : undefined;
  const recipe = record(record(rawRun)?.recipeSnapshot);
  const recipeSteps = array(recipe?.steps);
  const checkTimes = new Map<string, { start: number; end: number }>();
  const checkStatuses = new Map<string, string>();
  for (const value of array(record(rawRun)?.artifacts)) {
    const artifact = record(value);
    if (artifact?.kind !== "campaign-check-result") continue;
    const data = record(artifact.data);
    const id = text(data?.id);
    const status = text(data?.status);
    if (id && status) checkStatuses.set(id, status);
    if (id && finite(data?.startedAt) !== undefined && finite(data?.finishedAt) !== undefined)
      checkTimes.set(id, { start: finite(data?.startedAt)!, end: finite(data?.finishedAt)! });
  }
  const destCaptureVisible = destCaptureVisibleInRun(rawRun);
  /** Leftover Transition / Close captions or wrapper titles beside dest. */
  const leftoverBesideDest = leftoverBesideDestVisible(rawRun);
  const traces = array(record(rawRun)?.steps);
  return traces.flatMap((value, fallbackIndex) => {
    const step = record(value);
    if (!step) return [];
    // Final captures remain in evidence; they are not another authored action.
    if (checkStatuses.size > 0 && text(step.title)?.startsWith("Screenshot · final:")) return [];
    const failed = step.status === "error" || step.tone === "fail";
    if (!failed && text(step.log)?.startsWith("conditional tap: skipped")) return [];
    const generatedBranch = (text(step.title) ?? "").startsWith("Branch when");
    const stepFrames = array(step.frames);
    const hasCapture = stepFrames.some((frame) => text(record(frame)?.path));
    if (generatedBranch && !failed && !hasCapture) return [];
    const authoredStep = stepEvidence?.find((item) => item.traceStepId === text(step.id));
    // A successful nested check is represented by its following authored row.
    // Join by persisted provenance; failed or unmapped traces stay inspectable.
    if (
      !failed &&
      step.status === "ok" &&
      authoredStep &&
      !authoredCaptureStepId(text(step.title)) &&
      traces.slice(fallbackIndex + 1).some((other) => {
        const candidate = record(other);
        return (
          authoredCaptureStepId(text(candidate?.title)) === authoredStep.testStepId &&
          Boolean(humanStepTitle(candidate?.title))
        );
      })
    ) {
      return [];
    }
    /** Leftover Transition / Inspect setup skipped / Close wrappers cannot fill
     * the timeline beside dest — including empty-frame siblings that only carry
     * the leftover title (logo leftover inspect used to keep those rows). */
    if (leftoverWrapperStepTitle(text(step.title)) && destCaptureVisible) return [];
    /** Prelude Expected screen / Sign in gone / Reach / Land / Wait for … /
     * Sleep cannot lead the timeline beside Fast dest Capture for review —
     * they hide the firstEvidence banner and were the live logo leftover /
     * home Observe mismatch (shots already drop Reach / Land when dest-phase
     * is stamped; Wait for label / Sleep dropped; Wait for text still sat
     * beside private-chat dest). Do not apply this to the dest Capture for
     * review row itself. */
    if (
      !destEndCaptureReviewTitle(text(step.title)) &&
      preludeLaneCheckStepTitle(text(step.title)) &&
      destCaptureVisible
    ) {
      return [];
    }
    /** Opener before · Tap cannot fill the timeline as Captured result beside
     * leftover Transition when dest wait-for Observe is also listed. */
    const openerOnlyCapture =
      hasCapture &&
      stepFrames.length > 0 &&
      stepFrames.every((frame) => {
        const path = text(record(frame)?.path);
        if (!path) return true;
        return isCaptureReviewOpenerCaption(text(record(frame)?.caption));
      });
    if (openerOnlyCapture && leftoverBesideDest) return [];
    const hasVisibleCapture =
      authoredStep &&
      array(record(rawRun)?.steps).some((other) => {
        const candidate = record(other);
        const candidateId = text(candidate?.id);
        if (candidateId === authoredStep.traceStepId || !humanStepTitle(candidate?.title))
          return false;
        const captureStepId = authoredCaptureStepId(text(candidate?.title));
        return (
          captureStepId === authoredStep.testStepId ||
          stepEvidence?.some(
            (item) =>
              item.testStepId === authoredStep.testStepId &&
              item.traceStepId === candidateId &&
              item.evidence.framePaths.length > 0,
          )
        );
      });
    const title =
      humanStepTitle(step.title) ??
      (failed
        ? "Step could not finish"
        : hasCapture && !hasVisibleCapture
          ? "Captured result"
          : undefined);
    if (!title) return [];
    // Authored-step screenshot traces measure evidence capture, not whether
    // the preceding interaction passed. Use its retained check verdict.
    const checkId = authoredCaptureStepId(text(step.title));
    const checkStatus = checkId ? checkStatuses.get(checkId) : undefined;
    const status = checkStatus ? (checkStatus === "passed" ? "ok" : "error") : text(step.status);
    const tone = text(step.tone);
    const recipeStep = text(step.recipeStepId)
      ? recipeSteps.find((candidate) => {
          const item = record(candidate);
          return text(item?.id) === text(step.recipeStepId);
        })
      : undefined;
    const recipeStepRecord = record(recipeStep);
    const expected =
      recipeStepRecord?.kind === "assert-content"
        ? text(recipeStepRecord.expected)
        : recipeStepRecord?.kind === "expect-screen"
          ? text(recipeStepRecord.screenTitle)
          : undefined;
    const state: ReportTimelineItem["state"] =
      checkStatus === "blocked"
        ? "blocked"
        : status === "error" || tone === "fail"
          ? "failed"
          : status === "healed" || tone === "heal"
            ? "recovered"
            : status === "ok" || tone === "pass"
              ? "passed"
              : status === "running"
                ? "running"
                : "pending";
    const exactFramePaths = stepEvidence?.find((item) => item.traceStepId === text(step.id))
      ?.evidence.framePaths;
    const authoredFramePaths =
      exactFramePaths && exactFramePaths.length > 0
        ? exactFramePaths
        : checkId
          ? stepEvidence
              ?.filter((item) => item.testStepId === checkId)
              .flatMap((item) => item.evidence.framePaths)
          : exactFramePaths;
    /** Capture for review owns its dest raster. Persisted testStepEvidence can
     * still map the same testStepId to leftover Run saved Test `004` (live
     * home Observe `4b93702b`) — do not let that replace the Capture frame. */
    const ownedFramePaths = array(step.frames).flatMap((frame) => {
      const path = text(record(frame)?.path);
      return path ? [path] : [];
    });
    const preferOwnedDestCapture =
      destEndCaptureReviewTitle(text(step.title)) && ownedFramePaths.length > 0;
    const times = checkId ? checkTimes.get(checkId) : undefined;
    const resolutions = array(record(rawRun)?.artifacts)
      .map(record)
      .filter(
        (item) =>
          item?.kind === "target-resolution" &&
          times &&
          finite(item.capturedAt)! >= times.start &&
          finite(item.capturedAt)! <= times.end,
      );
    const resolution = resolutions.length === 1 ? resolutions[0] : undefined;
    const bounds = record(record(resolution?.data)?.bounds);
    const validBounds =
      bounds &&
      ["x", "y", "width", "height"].every((key) => finite(bounds[key]) !== undefined) &&
      Number(bounds.width) > 0 &&
      Number(bounds.height) > 0;
    const before = resolution
      ? actionBeforeFrame(resolution, step, array(record(rawRun)?.frames))
      : undefined;
    return [
      {
        ...(validBounds && text(before?.path)
          ? {
              actionBounds: {
                x: Number(bounds.x),
                y: Number(bounds.y),
                width: Number(bounds.width),
                height: Number(bounds.height),
              },
              beforeFramePath: text(before?.path),
            }
          : {}),
        ...(authoredRecipes
          ? {
              phase: authoredRecipes.has(text(step.recipeId) ?? "")
                ? ("test" as const)
                : ("setup" as const),
            }
          : {}),
        id: text(step.id) ?? `step-${fallbackIndex}`,
        index: finite(step.index) ?? fallbackIndex,
        title,
        state,
        ...(times
          ? { durationMs: Math.max(0, times.end - times.start) }
          : finite(step.durationMs) === undefined
            ? {}
            : { durationMs: finite(step.durationMs) }),
        ...(finite(step.attempt) === undefined ? {} : { attempt: finite(step.attempt) }),
        ...(times
          ? { startedAt: times.start }
          : finite(step.startedAt) === undefined
            ? {}
            : { startedAt: finite(step.startedAt) }),
        ...(times
          ? { finishedAt: times.end }
          : finite(step.finishedAt) === undefined
            ? {}
            : { finishedAt: finite(step.finishedAt) }),
        evidenceCount: array(step.frames).length,
        framePaths: preferOwnedDestCapture
          ? ownedFramePaths
          : (authoredFramePaths ?? ownedFramePaths),
        ...(text(step.log) ? { observed: text(step.log) } : {}),
        ...(text(step.log) ? { log: text(step.log) } : {}),
        ...(expected ? { expected } : {}),
      },
    ];
  });
}

/**
 * Resolve the raster on which a target was found without guessing from the
 * global frame timeline. A target-resolution timestamp only says when the
 * resolver finished; it does not identify which screen was visible then.
 */
function actionBeforeFrame(
  resolution: Record<string, unknown>,
  step: Record<string, unknown>,
  rawFrames: readonly unknown[],
): Record<string, unknown> | undefined {
  const data = record(resolution.data);
  const explicitPaths = [
    text(data?.beforeFramePath),
    text(data?.sourceFramePath),
    text(data?.framePath),
    text(record(data?.beforeFrame)?.path),
    text(record(data?.sourceFrame)?.path),
  ].filter((path): path is string => Boolean(path));
  const frames = rawFrames
    .map(record)
    .filter((frame): frame is Record<string, unknown> => Boolean(frame));
  const phaseBefore = (frame: Record<string, unknown> | undefined) =>
    Boolean(frame && /^before\s+·/iu.test(text(frame.caption) ?? ""));
  for (const path of explicitPaths) {
    const frame = frames.find((candidate) => text(candidate.path) === path);
    if (phaseBefore(frame)) return frame;
  }

  // New captures retain before/after frames directly on the trace step. This
  // is an exact ownership relation; do not cross to a neighboring step.
  const ownedBefore = array(step.frames)
    .map(record)
    .find((frame): frame is Record<string, unknown> => phaseBefore(frame));
  return ownedBefore;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function uniqueRecords(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value, index) => {
    const item = record(value);
    const identity =
      text(item?.path) ?? `${text(item?.caption) ?? "frame"}:${finite(item?.capturedAt) ?? index}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
function publicEvidenceText(value: unknown): string | undefined {
  const result = text(value);
  if (!result) return undefined;
  return result.replace(/\s+/gu, " ").slice(0, 320);
}
function publicFrameCaption(value: unknown): string | undefined {
  const caption = publicEvidenceText(value);
  if (!caption || isCaptureReviewLeftoverCaption(caption)) return undefined;
  return humanStepTitle(caption);
}

/** Dest wait-for evidence when leftover Close / Transition executed last-frame
 * captions are also listed — or when empty-frame leftover wrapper titles sit
 * beside dest (logo leftover inspect). Opener before · Tap cannot fill dest
 * beside those leftovers. Stamped dest-phase paths win over prelude Reach /
 * Land frames (home Observe used to keep those beside Fast dest). Capture for
 * review step frames win over prelude Wait for / failed:primary when dest-phase
 * is absent (failed Android models `78e87393` still listed Wait for Heavy in
 * shots after firstEvidence already preferred Fast Capture). Unphased
 * dest-wait (no leftover beside dest, no dest-phase, no Capture step) keeps
 * every frame. */
function destWaitForEvidenceFrames(
  frames: unknown[],
  leftoverBesideDest = false,
  artifacts: Array<{ kind?: string; data?: unknown }> = [],
  captureStepPaths: ReadonlySet<string> = new Set(),
): unknown[] {
  const destPhasePaths = new Set(captureReviewIdentityFramePaths(artifacts));
  if (destPhasePaths.size) {
    const phased = frames.filter((frame) => destPhasePaths.has(text(record(frame)?.path) ?? ""));
    if (phased.length) return phased;
  }
  if (captureStepPaths.size) {
    const captured = frames.filter((frame) =>
      captureStepPaths.has(text(record(frame)?.path) ?? ""),
    );
    if (captured.length) return captured;
  }
  const dest = frames.filter(
    (frame) => !isCaptureReviewLeftoverCaption(text(record(frame)?.caption)),
  );
  const leftover = frames.filter((frame) =>
    isCaptureReviewLeftoverCaption(text(record(frame)?.caption)),
  );
  if (!(dest.length && (leftover.length || leftoverBesideDest))) return frames;
  const withoutOpeners = dest.filter(
    (frame) => !isCaptureReviewOpenerCaption(text(record(frame)?.caption)),
  );
  return withoutOpeners.length ? withoutOpeners : dest;
}

/** Paths owned by Capture for review · step:… rows — Fast dest rasters even
 * when capture-review artifacts lack a stamped dest phase. */
function destCaptureStepFramePaths(rawRun: unknown): Set<string> {
  const paths = new Set<string>();
  for (const value of array(record(rawRun)?.steps)) {
    const step = record(value);
    if (!destEndCaptureReviewTitle(text(step?.title))) continue;
    for (const frame of array(step?.frames)) {
      const path = text(record(frame)?.path);
      if (path) paths.add(path);
    }
  }
  return paths;
}

function destCaptureVisibleInRun(rawRun: unknown): boolean {
  const destIdentityFrames = new Set(
    captureReviewIdentityFramePaths(
      array(record(rawRun)?.artifacts) as Array<{ kind?: string; data?: unknown }>,
    ),
  );
  return array(record(rawRun)?.steps).some((other) => {
    const candidate = record(other);
    const candidateTitle = text(candidate?.title) ?? "";
    const frames = array(candidate?.frames).flatMap((frame) => {
      const path = text(record(frame)?.path);
      return path ? [path] : [];
    });
    if (frames.length === 0) return false;
    if (destEndCaptureReviewTitle(candidateTitle)) return true;
    return frames.some((path) => destIdentityFrames.has(path));
  });
}

/** Leftover Transition / Inspect / Close captions or empty-frame wrapper titles
 * beside dest wait-for — same signal timeline uses to drop opener Tap. */
function leftoverBesideDestVisible(rawRun: unknown): boolean {
  if (!destCaptureVisibleInRun(rawRun)) return false;
  return (
    array(record(rawRun)?.frames).some((frame) =>
      isCaptureReviewLeftoverCaption(text(record(frame)?.caption)),
    ) ||
    array(record(rawRun)?.steps).some((other) => {
      const candidate = record(other);
      if (leftoverWrapperStepTitle(text(candidate?.title))) return true;
      return array(candidate?.frames).some((frame) =>
        isCaptureReviewLeftoverCaption(text(record(frame)?.caption)),
      );
    })
  );
}

function firstTraceEvidence(rawRun: unknown, outcome: RunOutcome | undefined) {
  /** Dest Capture for review / Observe wins for passed and failed dest-ends —
   * failed Android models still stamped Capture frames but firstEvidence led
   * with prelude Wait for label Heavy. */
  const hasDestCapture = destCaptureVisibleInRun(rawRun);
  if (hasDestCapture) {
    const destLabel = destWaitForEvidenceLabel(rawRun);
    if (destLabel) return { label: destLabel };
  }
  const steps = record(rawRun)?.steps;
  if (!Array.isArray(steps)) return undefined;
  const candidates: { label: string; score: number; index: number }[] = [];
  for (const value of steps) {
    const step = record(value);
    const status = text(step?.status);
    const isFailure = status === "error" || step?.tone === "fail";
    const actions = Array.isArray(step?.actions) ? step.actions : [];
    const isSuccess =
      status === "ok" &&
      actions.some((action) => ["ok", "shot"].includes(String(record(action)?.kind)));
    if (outcome === "passed" ? !isSuccess : !isFailure) continue;
    const rawTitle = text(step?.title);
    // Prelude checks are only machinery when a later dest-end capture proves
    // the meaningful destination. For an ordinary Test, the same check is
    // the first product evidence and should remain visible in the summary.
    if (hasDestCapture && preludeLaneCheckStepTitle(rawTitle)) continue;
    const label = humanStepTitle(step?.title);
    if (!label || leftoverWrapperStepTitle(rawTitle)) continue;
    const checkpoint = /check|expect|assert|verify|visible|screen|page|content|layout/iu.test(
      rawTitle ?? "",
    );
    candidates.push({ label, score: checkpoint ? 2 : 1, index: candidates.length });
  }
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0] ? { label: candidates[0].label } : undefined;
}
export function projectRunReport(
  runId: string,
  rawRun: unknown,
  rawEvidence: unknown,
  canonical?: ProductRunReport,
  evidenceUnavailable = false,
  resolvedTitle?: string,
): ProductRunReportOverview {
  const run = record(rawRun) ?? {};
  const evidence = record(rawEvidence);
  const sections = channelSections(
    evidence?.channels ?? record(run.evidence)?.channels,
    rawRun,
    rawEvidence,
  );
  const outcome = runOutcome(run.outcome);
  const technicalCause = text(canonical?.problems[0]?.detail) ?? text(run.error);
  const cause = publicRunCause(technicalCause);
  const category = publicFailureCategory(run.failureCategory);
  const traceEvidence = firstTraceEvidence(run, outcome);
  const targetName = humanTargetName(run.deviceName);
  const testId = sourceTestId(run);
  const stepEvidence = parseOptionalRunTestStepEvidence(run.testStepEvidence);
  const sourceRevision = record(run.sourceRevision);
  const browserProfile = record(run.browserCaseProfile);
  const targetProfile = record(run.targetProfile);
  const viewport = record(browserProfile?.viewport);
  const resolvedInputs = record(run.resolvedInputs);
  const account = record(run.account);
  const authenticationHealth = record(run.authenticationHealth);
  const accountUnusable =
    authenticationHealth?.status === "needs-relogin" ||
    authenticationHealth?.status === "expired" ||
    authenticationHealth?.status === "revoked" ||
    authenticationHealth?.status === "error";
  const platform = text(run.platform)?.toLowerCase();
  const deviceObserved =
    platform === "ios" || platform === "android"
      ? { profileId: `device:${text(run.serial) ?? "run"}` }
      : undefined;
  const liveAccount = (value: unknown) => liveCaptureReviewAccount(text(value), deviceObserved);
  const runtimeAccount = accountUnusable
    ? undefined
    : (liveAccount(authenticationHealth?.identity) ??
      liveAccount(account?.name) ??
      liveAccount(resolvedInputs?.account));
  const executionContext = {
    ...(text(sourceRevision?.sha) ? { sourceRevision: text(sourceRevision?.sha) } : {}),
    ...(text(sourceRevision?.buildId) ? { buildId: text(sourceRevision?.buildId) } : {}),
    ...(text(browserProfile?.engine) ? { browser: text(browserProfile?.engine) } : {}),
    ...(text(targetProfile?.id) ? { targetProfileId: text(targetProfile?.id) } : {}),
    ...(text(run.appVersion) ? { appVersion: text(run.appVersion) } : {}),
    ...(runtimeAccount ? { account: runtimeAccount } : {}),
    ...(finite(viewport?.width) !== undefined && finite(viewport?.height) !== undefined
      ? { viewport: `${viewport?.width}×${viewport?.height}` }
      : {}),
    ...(text(browserProfile?.locale) ||
    text(resolvedInputs?.locale) ||
    text(resolvedInputs?.language)
      ? {
          locale:
            text(browserProfile?.locale) ??
            text(resolvedInputs?.locale) ??
            text(resolvedInputs?.language),
        }
      : {}),
  };
  const video = reportVideoMedia(runId, rawRun);
  const metricSeries = new Map<string, { at: number; value: number }[]>();
  for (const raw of array(evidence?.performance)) {
    const sample = record(raw);
    const at = finite(sample?.at);
    const metrics = record(sample?.metrics);
    if (at === undefined || !metrics) continue;
    for (const [name, value] of Object.entries(metrics)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const points = metricSeries.get(name) ?? [];
      points.push({ at, value });
      metricSeries.set(name, points);
    }
  }
  const performance = [...metricSeries].map(([name, points]) => ({
    name: humanMetricName(name),
    points: points.sort((a, b) => a.at - b.at),
  }));
  const diagnostics = mapDiagnosticEventsToVideo(
    reportDiagnosticEvents(rawEvidence),
    video?.clock ?? {},
  );
  const runArtifacts = array(run.artifacts) as Array<{ kind?: string; data?: unknown }>;
  const execution = runArtifacts.find((item) => item.kind === "app-map-test-execution-intent");
  const cellExecution = runArtifacts.find(
    (item) => item.kind === "app-map-combine-cell-execution-intent",
  );
  const frozenPlan =
    record(record(execution?.data)?.plan) ??
    record(record(record(cellExecution?.data)?.child)?.plan);
  const captureReview = resolveCaptureReviewQueue({
    artifacts: runArtifacts,
    decisions: Array.isArray(run.captureReviews)
      ? (run.captureReviews as CaptureReviewDecision[])
      : [],
    ...(record(run.captureComparisons)
      ? {
          comparisons: record(run.captureComparisons) as Record<string, CaptureReferenceComparison>,
        }
      : {}),
    recipeSteps: array(record(run.recipeSnapshot)?.steps),
    recipes: (record(run.recipeGraph) ?? record(record(run.recipeSnapshot)?.recipes)) as
      | Record<string, { steps?: readonly unknown[] }>
      | undefined,
    plannedSlots: Array.isArray(frozenPlan?.plannedSlots)
      ? (frozenPlan.plannedSlots as CaptureReviewPlannedSlot[])
      : undefined,
  });
  return {
    runId,
    ...(testId ? { testId } : {}),
    title: resolvedTitle ?? canonical?.title ?? text(run.title) ?? "Test Run",
    ...(outcome ? { outcome } : {}),
    ...(targetName ? { targetName } : {}),
    ...(finite(run.durationMs) === undefined ? {} : { durationMs: finite(run.durationMs) }),
    ...(cause ? { cause } : {}),
    ...(technicalCause ? { technicalCause } : {}),
    ...(category ? { category } : {}),
    ...(traceEvidence
      ? { firstEvidence: traceEvidence }
      : outcome !== "passed" && cause
        ? { firstEvidence: { label: cause } }
        : {}),
    timeline: reportTimeline(rawRun, stepEvidence),
    traceSteps: reportTraceSteps(rawRun),
    evidence: sections,
    ...(video ? { video } : {}),
    diagnostics,
    performance,
    ...(stepEvidence === undefined ? {} : { stepEvidence }),
    ...(Object.keys(executionContext).length ? { executionContext } : {}),
    ...(evidenceUnavailable ? { evidenceUnavailable: true as const } : {}),
    ...(captureReview.items.length ? { captureReview } : {}),
  };
}
