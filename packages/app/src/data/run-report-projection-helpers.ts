/**
 * Public-label and evidence identity helpers for the Run report projection.
 *
 * These pure formatters stay separate from the channel/timeline assembly so
 * the report façade can remain small without changing its product vocabulary.
 */
import type { EvidenceChannel } from "@relay/protocol";
import { isCaptureReviewLeftoverCaption } from "@relay/protocol";

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
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export const channelLabels: Partial<Record<EvidenceChannel, string>> = {
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
export const channelSummaries: Partial<Record<EvidenceChannel, string>> = {
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
export function publicNetworkUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`.slice(0, 180);
  } catch {
    return raw.split("?", 1)[0]?.slice(0, 180);
  }
}
export function humanNetworkResult(value: string | undefined): string | undefined {
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
export function formatTransferredBytes(
  sentValue: unknown,
  receivedValue: unknown,
): string | undefined {
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
export function formatEvidenceDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}
export function formatEvidenceTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}
export function humanMetricName(value: string): string {
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
export function sentenceCase(value: string): string {
  return value ? value[0]!.toLocaleUpperCase() + value.slice(1) : value;
}
export function artifactEvidenceChannel(kind: string): EvidenceChannel | undefined {
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
export function leftoverWrapperStepTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  if (!value) return false;
  return leftoverSavedTestTitle(value) || isCaptureReviewLeftoverCaption(value);
}

/** Prelude lane checks / home origin / dest settle waits that used to lead
 * dest-end Run report before Fast dest Capture for review / Observe —
 * Expected screen content was visible, check "Sign in" gone, Reach Signed-in
 * home, Land on signed-in home, Wait for … (label / text / identifier), and
 * Sleep Nms (live `4b93702b` / attach / Imagine / logo dropped Wait for label
 * / Sleep; private-chat dest still kept Wait for text beside the dest
 * Capture for review). */
export function preludeLaneCheckStepTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  if (!value) return false;
  if (/^check identifier .+ visible$/iu.test(value)) return true;
  if (/^check\s+".+"\s+gone$/iu.test(value)) return true;
  if (/^Wait for\b/iu.test(value)) return true;
  if (/^Sleep \d+ms$/iu.test(value)) return true;
  const human = humanStepTitle(value) ?? value;
  if (human === "Expected screen content was visible") return true;
  if (/^Reach\b/u.test(human)) return true;
  if (/^Land on\b/iu.test(human)) return true;
  if (/^Wait for\b/iu.test(human)) return true;
  if (/^Sleep \d+ms$/iu.test(human)) return true;
  return false;
}

export function destEndCaptureReviewTitle(title: string | undefined): boolean {
  return /^Capture for review · step:[^:]+:/u.test(title ?? "");
}

export function authoredCaptureStepId(title: string | undefined): string | undefined {
  const raw = title?.trim();
  if (!raw) return undefined;
  return (
    /^Screenshot · step:([^:]+):/u.exec(raw)?.[1] ??
    /^Capture for review · step:([^:]+):/u.exec(raw)?.[1]
  );
}

export function humanStepTitle(value: unknown): string | undefined {
  const rawTitle = text(value);
  if (!rawTitle) return undefined;
  /** Authored Capture for review / Screenshot · step: / bare step: product
   * labels — keep even when they contain "selector" (iOS models dest "Model
   * selector SuperGrok" used to collapse to Captured result on the timeline,
   * and Screenshots fell back to "Screenshot 1" because the frame caption is
   * only `step:step-action:Model selector SuperGrok`). */
  const authoredCaptureLabel =
    /^Screenshot · (?:step:)?[^:]+:(.+)$/u.exec(rawTitle)?.[1]?.trim() ??
    /^Capture for review · step:[^:]+:(.+)$/u.exec(rawTitle)?.[1]?.trim() ??
    /^step:[^:]+:(.+)$/u.exec(rawTitle)?.[1]?.trim();
  const title = authoredCaptureLabel ?? rawTitle;
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
    !authoredCaptureLabel &&
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
export function publicRunCause(value: string | undefined): string | undefined {
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
export function publicFailureCategory(value: unknown): string | undefined {
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
export function humanTargetName(value: unknown): string | undefined {
  const name = text(value);
  if (!name) return undefined;
  if (/^emulator-\d+$/iu.test(name) || /^[0-9a-f]{24,}$/iu.test(name)) return undefined;
  return name;
}
export function sourceTestId(rawRun: unknown): string | undefined {
  return sourceTestIdentity(rawRun).testId;
}
export function sourceTestIdentity(rawRun: unknown): { appMapId?: string; testId?: string } {
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
/** Dest wait-for Capture for review / Observe label when dest is already
 * visible — prelude check identifier / Sign in gone / Wait for cannot fill
 * first evidence beside Fast dest (logo leftover inspect used to lead with
 * Expected screen; failed Android models led with Wait for label Heavy). */
export function destWaitForEvidenceLabel(rawRun: unknown): string | undefined {
  for (const value of array(record(rawRun)?.steps)) {
    const step = record(value);
    const title = text(step?.title);
    if (!destEndCaptureReviewTitle(title)) continue;
    const label = humanStepTitle(title);
    if (label && !leftoverWrapperStepTitle(title)) return label;
  }
  for (const value of array(record(rawRun)?.artifacts)) {
    const artifact = record(value);
    if (artifact?.kind !== "capture-review") continue;
    const data = record(artifact.data);
    if (text(data?.phase) !== "dest") continue;
    const label = humanStepTitle(text(data?.caption));
    if (label && !leftoverWrapperStepTitle(text(data?.caption))) return label;
  }
  return undefined;
}
