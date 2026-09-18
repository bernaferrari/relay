import type { ProductRunReport } from "@relay/product/run-journey";
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
  parseOptionalRunTestStepEvidence,
  resolveCaptureReviewQueue,
} from "@relay/protocol";
import type { RunTestStepEvidence } from "@relay/protocol";
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
const channelLabels: Partial<Record<EvidenceChannel, string>> = {
  screenshot: "Screenshots",
  "ui-tree": "Interface snapshots",
  logs: "Logs",
  network: "Network",
  performance: "Performance",
  crash: "Crash details",
  video: "Video",
  audio: "Audio",
  input: "Interactions",
};
const channelSummaries: Partial<Record<EvidenceChannel, string>> = {
  screenshot: "See the screens Relay captured while this Test ran.",
  "ui-tree": "Inspect the interface structure Relay used for semantic checks.",
  logs: "Read messages captured from the device and Relay.",
  network: "Review the network observations available for this Run.",
  performance: "Review timing and performance observations from this Run.",
  crash: "Inspect crash evidence captured while this Test ran.",
  video: "Watch the recorded visual evidence from this Run.",
  audio: "Listen to audio evidence captured during this Run.",
  input: "Review the interactions Relay performed during this Run.",
};
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
      summary: requests
        ? "Review the HTTP requests Relay observed during this Run."
        : connections
          ? "Review transport connections observed on the device. Encrypted traffic may not include request details."
          : "Relay captured network activity, but request-level details are not available.",
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
    return [
      {
        id: text(entry.id) ?? `log-${index}`,
        title: message,
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
  const destIdentityFrames = new Set(
    captureReviewIdentityFramePaths(
      array(record(rawRun)?.artifacts) as Array<{ kind?: string; data?: unknown }>,
    ),
  );
  const destCaptureVisible = array(record(rawRun)?.steps).some((other) => {
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
  return array(record(rawRun)?.steps).flatMap((value, fallbackIndex) => {
    const step = record(value);
    if (!step) return [];
    // Final captures remain in evidence; they are not another authored action.
    if (checkStatuses.size > 0 && text(step.title)?.startsWith("Screenshot · final:")) return [];
    const failed = step.status === "error" || step.tone === "fail";
    if (!failed && text(step.log)?.startsWith("conditional tap: skipped")) return [];
    const generatedBranch = (text(step.title) ?? "").startsWith("Branch when");
    const hasCapture = array(step.frames).some((frame) => text(record(frame)?.path));
    if (generatedBranch && !failed && !hasCapture) return [];
    const authoredStep = stepEvidence?.find((item) => item.traceStepId === text(step.id));
    if (leftoverWrapperStepTitle(text(step.title)) && hasCapture && destCaptureVisible) return [];
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
        framePaths:
          authoredFramePaths ??
          array(step.frames).flatMap((frame) => {
            const path = text(record(frame)?.path);
            return path ? [path] : [];
          }),
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
 * captions are also listed. Unphased dest-wait (no dest wait-for caption) keeps
 * every frame. */
function destWaitForEvidenceFrames(frames: unknown[]): unknown[] {
  const dest = frames.filter(
    (frame) => !isCaptureReviewLeftoverCaption(text(record(frame)?.caption)),
  );
  const leftover = frames.filter((frame) =>
    isCaptureReviewLeftoverCaption(text(record(frame)?.caption)),
  );
  return dest.length && leftover.length ? dest : frames;
}
function publicNetworkUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`.slice(0, 180);
  } catch {
    return raw.split("?", 1)[0]?.slice(0, 180);
  }
}
function humanNetworkResult(value: string | undefined): string | undefined {
  if (!value || value === "unknown") return undefined;
  if (value === "success") return "Completed";
  if (value === "failure") return "Failed";
  if (value === "pending") return "Still pending";
  if (value === "connected") return "Connected";
  if (value === "observed") return "Observed";
  if (value === "refused") return "Connection refused";
  if (value === "reset") return "Connection reset";
  if (value === "timed-out") return "Timed out";
  if (value === "dns-nxdomain") return "Domain not found";
  if (value === "incomplete") return "Capture incomplete";
  return sentenceCase(value.replace(/[-_]+/gu, " "));
}
function formatTransferredBytes(sentValue: unknown, receivedValue: unknown): string | undefined {
  const sent = finite(sentValue);
  const received = finite(receivedValue);
  if (sent === undefined && received === undefined) return undefined;
  return `${formatBytes(sent ?? 0)} sent · ${formatBytes(received ?? 0)} received`;
}
function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
function formatEvidenceDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}
function formatEvidenceTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}
function humanMetricName(value: string): string {
  const names: Record<string, string> = {
    "cpu.usagePercent": "CPU (%)",
    "memory.totalPssKb": "Memory · PSS (kB)",
    "memory.totalRssKb": "Memory · RSS (kB)",
    "fps.droppedFramePercent": "Dropped frames (%)",
  };
  return (
    names[value] ??
    sentenceCase(value.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/[._-]+/gu, " "))
  );
}
function sentenceCase(value: string): string {
  return value ? value[0]!.toLocaleUpperCase() + value.slice(1) : value;
}
function artifactEvidenceChannel(kind: string): EvidenceChannel | undefined {
  if (/accessibility|ui[-_ ]?tree/iu.test(kind)) return "ui-tree";
  if (/video/iu.test(kind)) return "video";
  if (/audio/iu.test(kind)) return "audio";
  if (/crash/iu.test(kind)) return "crash";
  if (/performance|metric/iu.test(kind)) return "performance";
  if (/screenshot|image|frame/iu.test(kind)) return "screenshot";
  return undefined;
}
function leftoverSavedTestTitle(title: string | undefined): boolean {
  return /^(?:run|execute|start|open|load)(?: (?:the|this))?(?: saved)? test\b/iu.test(title ?? "");
}

/** Leftover Close / Run saved Test / Transition executed / Inspect setup skipped
 * wrappers. Dest wait-for Observe is not this. */
function leftoverWrapperStepTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  if (!value) return false;
  return leftoverSavedTestTitle(value) || isCaptureReviewLeftoverCaption(value);
}

function destEndCaptureReviewTitle(title: string | undefined): boolean {
  return /^Capture for review · step:[^:]+:/u.test(title ?? "");
}

function authoredCaptureStepId(title: string | undefined): string | undefined {
  const raw = title?.trim();
  if (!raw) return undefined;
  return (
    /^Screenshot · step:([^:]+):/u.exec(raw)?.[1] ??
    /^Capture for review · step:([^:]+):/u.exec(raw)?.[1]
  );
}

function humanStepTitle(value: unknown): string | undefined {
  const rawTitle = text(value);
  if (!rawTitle) return undefined;
  const title =
    /^Screenshot · (?:step:)?[^:]+:(.+)$/u.exec(rawTitle)?.[1]?.trim() ??
    /^Capture for review · step:[^:]+:(.+)$/u.exec(rawTitle)?.[1]?.trim() ??
    rawTitle;
  if (isTautologicalNavigationTitle(title)) return undefined;
  if (/^check identifier .+ visible$/iu.test(title)) return "Expected screen content was visible";
  if (/^check layout: identifier .+ does not overlap identifier .+$/iu.test(title)) {
    return "Expected content did not overlap";
  }
  if (
    leftoverSavedTestTitle(title) ||
    /^(?:prepare|preparing|start|starting|started|run|running|finish|finished|complete|completed|succeeded)$/iu.test(
      title,
    )
  ) {
    return undefined;
  }
  if (
    /identifier|selector|xpath|geometry|accessibility tree|app map|recipe|profile id/iu.test(title)
  ) {
    return undefined;
  }
  return title;
}
function isTautologicalNavigationTitle(title: string): boolean {
  const navigation =
    /^\s*(?:go|navigate|move)?\s*(?:from\s+)?(.+?)\s*(?:→|->|\bto\b)\s*(.+?)\s*$/iu.exec(title);
  if (!navigation) return false;
  const [, from, to] = navigation;
  if (!from || !to) return false;
  const normalize = (value: string) =>
    value
      .replace(/^(?:the|a|an)\s+/iu, "")
      .replace(/[\s._-]+/gu, "")
      .trim()
      .toLocaleLowerCase();
  return normalize(from) === normalize(to);
}
function publicRunCause(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (
    /raw accessibility|immutable raw|offline geometry|raw-evidence-recapture-required/iu.test(value)
  ) {
    return "Relay needs a fresh capture of the starting screen before this Test can run.";
  }
  if (/app map selection is ambiguous/iu.test(value)) {
    return "Relay could not identify which app owns this Test.";
  }
  if (/target selection is ambiguous|choose one by id/iu.test(value)) {
    return "Relay needs one exact device or browser before this Test can run.";
  }
  if (
    /identifier|selector|xpath|geometry|accessibility tree|appmapid|targetid|expectedversion|\bat .+\.ts:\d+/iu.test(
      value,
    )
  ) {
    return "Relay could not complete this Test with the saved recording.";
  }
  return value;
}
function publicFailureCategory(value: unknown): string | undefined {
  const labels: Record<string, string> = {
    environment: "Setup",
    "target-state": "App state",
    locator: "Target not found",
    action: "Action",
    completion: "Response timeout",
    extraction: "Could not read response",
    "deterministic-assertion": "Expected check",
    "semantic-assertion": "Answer check",
    "visual-assertion": "Visual check",
    "judge-uncertainty": "Needs review",
    "review-required": "Needs review",
    "harness-defect": "Test system",
  };
  const category = text(value);
  return category ? labels[category] : undefined;
}
function humanTargetName(value: unknown): string | undefined {
  const name = text(value);
  if (!name) return undefined;
  if (/^emulator-\d+$/iu.test(name) || /^[0-9a-f]{24,}$/iu.test(name)) return undefined;
  return name;
}
function sourceTestId(rawRun: unknown): string | undefined {
  return sourceTestIdentity(rawRun).testId;
}
function sourceTestIdentity(rawRun: unknown): { appMapId?: string; testId?: string } {
  const artifacts = record(rawRun)?.artifacts;
  if (!Array.isArray(artifacts)) return {};
  for (const value of artifacts) {
    const artifact = record(value);
    if (
      artifact?.kind !== "app-map-test-execution-intent" &&
      artifact?.kind !== "app-map-combine-cell-execution-intent"
    )
      continue;
    const parent = record(artifact.data);
    const data =
      artifact.kind === "app-map-combine-cell-execution-intent" ? record(parent?.child) : parent;
    const sourcePlan = record(data?.sourcePlan);
    const appMapId = text(sourcePlan?.appMapId);
    const testId = text(sourcePlan?.testId);
    if (appMapId || testId)
      return { ...(appMapId ? { appMapId } : {}), ...(testId ? { testId } : {}) };
  }
  return {};
}
export function resolvedTestTitle(rawRun: unknown, rawApps: unknown): string | undefined {
  if (!Array.isArray(rawApps)) return undefined;
  const identity = sourceTestIdentity(rawRun);
  if (!identity.testId) return undefined;
  const matches = rawApps.flatMap((value) => {
    const app = record(value);
    if (identity.appMapId && app?.id !== identity.appMapId) return [];
    const test = record(record(app?.tests)?.[identity.testId!]);
    const name = text(test?.name);
    return name ? [name] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}
function firstTraceEvidence(rawRun: unknown, outcome: RunOutcome | undefined) {
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
    const label = humanStepTitle(step?.title);
    if (!label || leftoverWrapperStepTitle(text(step?.title))) continue;
    const checkpoint = /check|expect|assert|verify|visible|screen|page|content|layout/iu.test(
      text(step?.title) ?? "",
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
  const cause = publicRunCause(text(canonical?.problems[0]?.detail) ?? text(run.error));
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
  const executionContext = {
    ...(text(sourceRevision?.sha) ? { sourceRevision: text(sourceRevision?.sha) } : {}),
    ...(text(sourceRevision?.buildId) ? { buildId: text(sourceRevision?.buildId) } : {}),
    ...(text(browserProfile?.engine) ? { browser: text(browserProfile?.engine) } : {}),
    ...(text(targetProfile?.id) ? { targetProfileId: text(targetProfile?.id) } : {}),
    ...(text(run.appVersion) ? { appVersion: text(run.appVersion) } : {}),
    ...(text(account?.name) || text(resolvedInputs?.account)
      ? { account: text(account?.name) ?? text(resolvedInputs?.account) }
      : {}),
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
    ...(category ? { category } : {}),
    ...(traceEvidence
      ? { firstEvidence: traceEvidence }
      : outcome !== "passed" && cause
        ? { firstEvidence: { label: cause } }
        : {}),
    timeline: reportTimeline(rawRun, stepEvidence),
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
