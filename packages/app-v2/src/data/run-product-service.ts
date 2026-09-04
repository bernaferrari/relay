import type {
  ProductRunReport,
  ProductRunStartInput,
  ProductRunState,
  ProductRunWatchInput,
} from "@relay/product/run-journey";
import type {
  AuthoringTarget,
  EvidenceChannel,
  EvidenceChannelRecord,
  RunTestStepEvidence,
  RunOutcome,
} from "@relay/protocol";
import { parseOptionalRunTestStepEvidence } from "@relay/protocol";
import type { ProductRunSummary, ProductTestStep } from "@relay/product/catalog";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import { presentReadyTargets, type ProductTargetOption } from "./target-presentation";

export type ProductTestSummary = {
  id: string;
  name: string;
  appMapId: string;
  appName: string;
  stepCount: number;
  steps?: readonly ProductTestStep[];
};

export type ReportEvidenceSection = {
  id: EvidenceChannel;
  label: string;
  count: number;
  detail: string;
  summary: string;
  inspectable: boolean;
  items: readonly ReportEvidenceItem[];
};

export type ReportEvidenceItem = {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  tone?: "neutral" | "success" | "warning" | "critical";
  media?: {
    kind: "image";
    src: string;
    width?: number;
    height?: number;
  };
};

export type ReportTimelineItem = {
  id: string;
  index: number;
  title: string;
  state: "passed" | "failed" | "running" | "recovered" | "pending";
  durationMs?: number;
  evidenceCount: number;
};

export type ProductRunReportOverview = {
  runId: string;
  testId?: string;
  title: string;
  outcome?: RunOutcome;
  targetName?: string;
  durationMs?: number;
  cause?: string;
  category?: string;
  firstEvidence?: { label: string; detail?: string };
  timeline: readonly ReportTimelineItem[];
  evidence: readonly ReportEvidenceSection[];
  /** Undefined for legacy Runs that predate authored-step provenance. */
  stepEvidence?: readonly RunTestStepEvidence[];
  evidenceUnavailable?: true;
};

export type RunProductService = {
  getTest(testId: string): Promise<ProductTestSummary | undefined>;
  listTestRuns?(testId: string): Promise<readonly ProductRunSummary[]>;
  listTargets(): Promise<readonly ProductTargetOption[]>;
  presentTargets(targets: readonly AuthoringTarget[]): Promise<readonly ProductTargetOption[]>;
  start(input: ProductRunStartInput): Promise<ProductRunState>;
  inspect(workflowId: string): Promise<ProductRunState>;
  watch(input?: ProductRunWatchInput): Promise<ProductRunState>;
  cancel(): Promise<ProductRunState>;
  getReport(runId: string, canonical?: ProductRunReport): Promise<ProductRunReportOverview>;
  getRawEvidence(runId: string): Promise<unknown>;
};

type ProductRuntime = {
  client: Awaited<ReturnType<typeof productClientForPlatform>>["client"];
  journey: ReturnType<
    (typeof import("@relay/product/run-journey"))["createProductRunJourneyFromClient"]
  >;
  targetJourney: ReturnType<
    (typeof import("@relay/product/recording-journey"))["createProductRecordingJourneyFromClient"]
  >;
};

function projectTestStep(step: import("@relay/protocol").AppMapScenarioTestStep): ProductTestStep {
  const children =
    step.kind === "decision"
      ? [...step.thenSteps, ...(step.elseSteps ?? [])]
      : step.kind === "loop"
        ? step.steps
        : [];
  const needsReview =
    step.execution?.status === "disabled" ||
    step.binding.status === "unresolved" ||
    children.some(
      (child) => child.execution?.status === "disabled" || child.binding.status === "unresolved",
    );
  return {
    id: step.id,
    kind: step.kind,
    intent: step.intent,
    ...(step.note ? { note: step.note } : {}),
    capture: step.capture === true,
    status: needsReview ? "needs-review" : "ready",
    ...(children.length ? { children: children.map(projectTestStep) } : {}),
  };
}

export function createRunProductService(platform: Platform): RunProductService {
  let runtimePromise: Promise<ProductRuntime> | undefined;
  function runtime() {
    runtimePromise ??= Promise.all([
      productClientForPlatform(platform),
      import("@relay/product/run-journey"),
      import("@relay/product/recording-journey"),
    ]).then(
      ([
        { client, actorId },
        { createProductRunJourneyFromClient },
        { createProductRecordingJourneyFromClient },
      ]) => ({
        client,
        journey: createProductRunJourneyFromClient({ client, actorId }),
        targetJourney: createProductRecordingJourneyFromClient({ client, actorId }),
      }),
    );
    return runtimePromise;
  }

  return {
    async getTest(testId) {
      const { client } = await runtime();
      const { appMaps } = await client.invoke("app-map.list", {});
      const matches = appMaps.flatMap((app) => {
        const test = app.tests[testId];
        return test ? [{ app, test }] : [];
      });
      if (matches.length > 1) {
        throw new TypeError("This Test appears in more than one app and cannot be opened safely.");
      }
      const match = matches[0];
      if (!match) return undefined;
      return {
        id: match.test.id,
        name: match.test.name,
        appMapId: match.app.id,
        appName: match.app.name,
        stepCount: match.test.steps.length,
        steps: match.test.steps.map(projectTestStep),
      };
    },
    async listTestRuns(testId) {
      const { client } = await runtime();
      const { createProductCatalog } = await import("@relay/product/catalog");
      return createProductCatalog(client).listRuns({ testId });
    },
    async listTargets() {
      const { client, targetJourney } = await runtime();
      const state = await targetJourney.connect();
      if (state.recovery) {
        throw new Error(`${state.recovery.detail} ${state.recovery.recovery}`.trim());
      }
      return presentReadyTargets(client, state.targets);
    },
    async presentTargets(targets) {
      return presentReadyTargets((await runtime()).client, targets);
    },
    async start(input) {
      return (await runtime()).journey.start(input);
    },
    async inspect(workflowId) {
      return (await runtime()).journey.inspect(workflowId);
    },
    async watch(input) {
      return (await runtime()).journey.watch(input);
    },
    async cancel() {
      return (await runtime()).journey.cancel();
    },
    async getReport(runId, canonical) {
      const { client } = await runtime();
      const [{ run }, evidenceResult, appsResult] = await Promise.all([
        client.invoke("run.get", { runId }),
        client.invoke("run.evidence.get", { runId, includeBodies: false }).catch(() => undefined),
        client.invoke("app-map.list", {}).catch(() => undefined),
      ]);
      return projectRunReport(
        runId,
        run,
        evidenceResult?.evidence,
        canonical,
        evidenceResult === undefined,
        resolvedTestTitle(run, appsResult?.appMaps),
      );
    },
    async getRawEvidence(runId) {
      const { client } = await runtime();
      return (await client.invoke("run.evidence.get", { runId, includeBodies: true })).evidence;
    },
  };
}

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

const MAX_INLINE_EVIDENCE_BASE64_CHARS = 24 * 1_024 * 1_024;

function frameImageMedia(frame: Record<string, unknown>): ReportEvidenceItem["media"] {
  const mime = text(frame.mime)?.toLocaleLowerCase();
  const base64 =
    typeof frame.base64 === "string" && frame.base64.length <= MAX_INLINE_EVIDENCE_BASE64_CHARS
      ? frame.base64.replace(/\s+/gu, "")
      : undefined;
  if (!mime || !["image/jpeg", "image/png", "image/webp"].includes(mime) || !base64) {
    return undefined;
  }
  if (!/^[a-zA-Z0-9+/]+={0,2}$/u.test(base64)) return undefined;
  const width = finite(frame.width);
  const height = finite(frame.height);
  return {
    kind: "image",
    src: `data:${mime};base64,${base64}`,
    ...(width && width > 0 ? { width } : {}),
    ...(height && height > 0 ? { height } : {}),
  };
}

function runOutcome(value: unknown): RunOutcome | undefined {
  return ["passed", "product-failure", "harness-failure", "uncertain", "cancelled"].includes(
    String(value),
  )
    ? (value as RunOutcome)
    : undefined;
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

  const frames = uniqueRecords([
    ...array(run?.frames),
    ...array(run?.steps).flatMap((value) => array(record(value)?.frames)),
  ]);
  if (frames.length) {
    output.screenshot = frames.map((value, index) => {
      const frame = record(value) ?? {};
      const media = frameImageMedia(frame);
      return {
        id: text(frame.path) ?? `screenshot-${index}`,
        title: publicFrameCaption(frame.caption) ?? `Screenshot ${index + 1}`,
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
          title: publicEvidenceText(artifact.summary) ?? sentenceCase(kind.replace(/[-_]+/gu, " ")),
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

function reportTimeline(rawRun: unknown): ReportTimelineItem[] {
  return array(record(rawRun)?.steps).flatMap((value, fallbackIndex) => {
    const step = record(value);
    if (!step) return [];
    const title = humanStepTitle(step.title);
    if (!title) return [];
    const status = text(step.status);
    const tone = text(step.tone);
    const state: ReportTimelineItem["state"] =
      status === "error" || tone === "fail"
        ? "failed"
        : status === "healed" || tone === "heal"
          ? "recovered"
          : status === "ok" || tone === "pass"
            ? "passed"
            : status === "running"
              ? "running"
              : "pending";
    return [
      {
        id: text(step.id) ?? `step-${fallbackIndex}`,
        index: finite(step.index) ?? fallbackIndex,
        title,
        state,
        ...(finite(step.durationMs) === undefined ? {} : { durationMs: finite(step.durationMs) }),
        evidenceCount: array(step.frames).length,
      },
    ];
  });
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
  if (!caption) return undefined;
  return humanStepTitle(caption);
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
  return sentenceCase(value.replace(/[._-]+/gu, " "));
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

function humanStepTitle(value: unknown): string | undefined {
  const rawTitle = text(value);
  if (!rawTitle) return undefined;
  const title = /^Screenshot · (?:step:)?[^:]+:(.+)$/u.exec(rawTitle)?.[1]?.trim() ?? rawTitle;
  if (isTautologicalNavigationTitle(title)) return undefined;
  if (/^check identifier .+ visible$/iu.test(title)) return "Expected screen content was visible";
  if (/^check layout: identifier .+ does not overlap identifier .+$/iu.test(title)) {
    return "Expected content did not overlap";
  }
  if (
    /^(?:run|execute|start|open|load)(?: (?:the|this))?(?: saved)? test\b/iu.test(title) ||
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
      .replace(/[\s._-]+/gu, " ")
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
    if (artifact?.kind !== "app-map-test-execution-intent") continue;
    const data = record(artifact.data);
    const sourcePlan = record(data?.sourcePlan);
    const appMapId = text(sourcePlan?.appMapId);
    const testId = text(sourcePlan?.testId);
    if (appMapId || testId)
      return { ...(appMapId ? { appMapId } : {}), ...(testId ? { testId } : {}) };
  }
  return {};
}

function resolvedTestTitle(rawRun: unknown, rawApps: unknown): string | undefined {
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
    if (!label) continue;
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
    timeline: reportTimeline(rawRun),
    evidence: sections,
    ...(stepEvidence === undefined ? {} : { stepEvidence }),
    ...(evidenceUnavailable ? { evidenceUnavailable: true as const } : {}),
  };
}

export type { ProductRunRecovery, ProductRunState } from "@relay/product/run-journey";
