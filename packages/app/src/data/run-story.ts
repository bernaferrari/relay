/**
 * A Run told as a story: the Test's steps in plain words, each with the
 * actions Relay performed and what it saw. Works for a live job (steps stream
 * in) and for a saved report (steps grouped by the authored Test step).
 */
import type { RunTestStepEvidence } from "@relay/protocol";
import type { ReportTimelineItem } from "./run-report-model";
import { layoutTracePresentation } from "./layout-trace-presentation";

export type StoryActionKind =
  | "tap"
  | "type"
  | "verify"
  | "screenshot"
  | "wait"
  | "scroll"
  | "open"
  | "check"
  | "other";

export type StoryState = "pending" | "running" | "passed" | "failed";

export type StoryAction = {
  id: string;
  kind: StoryActionKind;
  label: string;
  state: StoryState;
  durationMs?: number;
  /** Most useful frame to show for this action (after, else before). */
  framePath?: string;
  detail?: string;
  failure?: ReportTimelineItem["failure"];
};

export type StoryStep = {
  id: string;
  title: string;
  state: StoryState;
  durationMs?: number;
  actions: StoryAction[];
};

const QUOTED = /"([^"]+)"|“([^”]+)”/u;

function quoted(value: string): string | undefined {
  const match = QUOTED.exec(value);
  return match?.[1] ?? match?.[2];
}

/** Turn an engine trace title into what a person would say. */
export function describeTraceTitle(
  title: string,
): { kind: StoryActionKind; label: string } | undefined {
  const text = title.trim();
  if (!text || /^Run saved Test$/iu.test(text)) return undefined;
  const capture = /^Capture for review · (?:step:[^:]+:)?(.+)$/iu.exec(text);
  if (capture) return { kind: "screenshot", label: `Screenshot · ${capture[1]}` };
  if (/^Screenshot · final:/iu.test(text)) return { kind: "screenshot", label: "Final screenshot" };
  const stepShot = /^Screenshot · step:[^:]+:(.+)$/iu.exec(text);
  if (stepShot) return { kind: "screenshot", label: `Screenshot · ${stepShot[1]}` };
  if (/^Screenshot/iu.test(text)) return { kind: "screenshot", label: text };
  if (/^Transition executed$/iu.test(text)) return undefined;
  const sleep = /^(?:Sleep|Wait)\s+(\d+)\s*ms$/iu.exec(text);
  if (sleep) return { kind: "wait", label: `Wait ${formatDuration(Number(sleep[1]))}` };
  const checkId = /^check identifier (.+?) (visible|gone)$/iu.exec(text);
  if (checkId)
    return {
      kind: "check",
      label: `Check ${humanizeIdentifier(checkId[1]!)} is ${checkId[2] === "gone" ? "gone" : "on screen"}`,
    };
  const checkText = /^check\s+(?:label |text )?["“](.+?)["”]\s+(visible|gone)$/iu.exec(text);
  if (checkText)
    return {
      kind: "check",
      label: `Check “${checkText[1]}” is ${checkText[2] === "gone" ? "gone" : "on screen"}`,
    };
  const reach = /^(?:Reach|Wait for|Expect|On)\s+(.+)$/iu.exec(text);
  if (reach) {
    const target = reach[1]!;
    const id = /^identifier\s+(.+)$/iu.exec(target);
    const labelled = /^(?:label|text)\s+["“](.+?)["”]$/iu.exec(target);
    return {
      kind: "verify",
      label: id
        ? `See ${humanizeIdentifier(id[1]!)}`
        : labelled
          ? `See “${labelled[1]}”`
          : `On ${target}`,
    };
  }
  if (/^(?:Tap|Click|Press|Long press)\b/iu.test(text)) {
    const target = quoted(text);
    const verb = /^Long press/iu.test(text) ? "Long press" : "Tap";
    return { kind: "tap", label: target ? `${verb} “${target}”` : text };
  }
  if (/^(?:Type|Fill|Enter)\b/iu.test(text)) {
    const value = quoted(text);
    return { kind: "type", label: value ? `Type “${value}”` : text };
  }
  if (/^(?:Wait|Sleep|Pause)\b/iu.test(text)) return { kind: "wait", label: text };
  if (/^(?:Scroll|Swipe|Drag)\b/iu.test(text)) return { kind: "scroll", label: text };
  if (/^(?:Open|Launch|Navigate|Go to|Start app)\b/iu.test(text))
    return { kind: "open", label: text };
  if (/^Check layout:/iu.test(text))
    return { kind: "check", label: "Check elements do not overlap" };
  if (/^(?:Check|Assert|Verify)\b/iu.test(text)) return { kind: "check", label: text };
  return { kind: "other", label: text };
}

function stateOf(value: string | undefined): StoryState {
  if (!value) return "pending";
  if (/^(?:ok|passed|healed|recovered|succeeded|completed)$/iu.test(value)) return "passed";
  if (/^(?:running|started|in-progress)$/iu.test(value)) return "running";
  if (/^(?:error|failed|fail|blocked|cancelled)$/iu.test(value)) return "failed";
  return "pending";
}

function combine(states: readonly StoryState[]): StoryState {
  if (states.some((state) => state === "failed")) return "failed";
  if (states.some((state) => state === "running")) return "running";
  if (states.length && states.every((state) => state === "passed")) return "passed";
  return states.some((state) => state === "passed") ? "running" : "pending";
}

function lastFrame(paths: readonly string[] | undefined): string | undefined {
  return paths?.length ? paths[paths.length - 1] : undefined;
}

/** Saved report: actions grouped under the authored Test steps. */
export function storyFromReport(input: {
  timeline: readonly ReportTimelineItem[];
  stepEvidence?: readonly RunTestStepEvidence[];
  stepTitles?: Readonly<Record<string, string>>;
}): StoryStep[] {
  const byTraceIndex = new Map<number, string>();
  for (const evidence of input.stepEvidence ?? []) {
    byTraceIndex.set(evidence.traceStepIndex, evidence.testStepId);
  }
  const groups = new Map<string, StoryStep>();
  const order: string[] = [];
  for (const item of input.timeline) {
    if (item.phase === "setup") continue;
    const described = describeTraceTitle(item.title);
    if (!described) continue;
    const groupId = byTraceIndex.get(item.index) ?? "run";
    let group = groups.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        title:
          input.stepTitles?.[groupId] ??
          (groupId === "run" ? "Finish" : humanizeIdentifier(groupId)),
        state: "pending",
        actions: [],
      };
      groups.set(groupId, group);
      order.push(groupId);
    }
    const framePath = lastFrame(item.framePaths) ?? item.beforeFramePath;
    group.actions.push({
      id: item.id,
      kind: described.kind,
      label: described.label,
      state: stateOf(item.state),
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      ...(framePath ? { framePath } : {}),
      ...(item.failure
        ? { failure: item.failure, detail: item.failure.summary }
        : item.observed || item.expected
          ? { detail: item.observed ?? `Expected ${item.expected}` }
          : {}),
    });
  }
  return order.map((id) => {
    const group = groups.get(id)!;
    const durationMs = group.actions.reduce((total, action) => total + (action.durationMs ?? 0), 0);
    return { ...group, state: combine(group.actions.map((action) => action.state)), durationMs };
  });
}

type JobStepLike = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  durationMs?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  frames?: unknown;
  log?: unknown;
};

/** Live job: every action so far, in order, as one running step. */
export function storyFromJob(job: {
  title?: unknown;
  status?: unknown;
  steps?: unknown;
  frames?: unknown;
  artifacts?: unknown;
}): { steps: StoryStep[]; latestFrame?: string } {
  const steps = Array.isArray(job.steps) ? (job.steps as JobStepLike[]) : [];
  const actions: StoryAction[] = [];
  for (const [index, step] of steps.entries()) {
    const rawTitle = typeof step.title === "string" ? step.title : "";
    const layout =
      typeof step.id === "string" ? layoutTracePresentation(job, step.id, rawTitle) : undefined;
    const described = describeTraceTitle(layout?.title ?? rawTitle);
    if (!described) continue;
    const frames = Array.isArray(step.frames)
      ? (step.frames as { path?: unknown }[]).flatMap((frame) =>
          typeof frame?.path === "string" ? [frame.path] : [],
        )
      : [];
    const started = typeof step.startedAt === "number" ? step.startedAt : undefined;
    const finished = typeof step.finishedAt === "number" ? step.finishedAt : undefined;
    const durationMs =
      typeof step.durationMs === "number"
        ? step.durationMs
        : started && finished
          ? finished - started
          : undefined;
    actions.push({
      id: typeof step.id === "string" ? step.id : `step-${index}`,
      kind: described.kind,
      label: described.label,
      state: stateOf(typeof step.status === "string" ? step.status : undefined),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(lastFrame(frames) ? { framePath: lastFrame(frames)! } : {}),
      ...(layout?.failure && step.status === "error"
        ? { failure: layout.failure, detail: layout.failure.summary }
        : {}),
    });
  }
  const allFrames = Array.isArray(job.frames)
    ? (job.frames as { path?: unknown }[]).flatMap((frame) =>
        typeof frame?.path === "string" ? [frame.path] : [],
      )
    : [];
  const status = typeof job.status === "string" ? job.status : undefined;
  return {
    steps: actions.length
      ? [
          {
            id: "live",
            title: typeof job.title === "string" && job.title ? job.title : "Running",
            state: status === "running" || status === "queued" ? "running" : stateOf(status),
            actions,
          },
        ]
      : [],
    ...(lastFrame(allFrames) ? { latestFrame: lastFrame(allFrames)! } : {}),
  };
}

export function humanizeIdentifier(value: string): string {
  const words = value
    .replace(/^relay-(?:test|action)-/u, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+\d+$/u, "")
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : value;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function asFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** All engine steps with their frames, for the step-by-step story. */
export function reportTraceSteps(rawRun: unknown): ReportTimelineItem[] {
  return asArray(asRecord(rawRun)?.steps).flatMap((value, index) => {
    const step = asRecord(value);
    const title = asText(step?.title);
    if (!step || !title) return [];
    // "Go from Start to Start" says nothing; the engine emits it for no-op moves.
    const tautology = /Go from (.+) to (.+)$/u.exec(title);
    if (tautology && tautology[1]!.trim() === tautology[2]!.trim()) return [];
    const status = asText(step.status);
    const layout = layoutTracePresentation(rawRun, asText(step.id) ?? "", title);
    const framePaths = asArray(step.frames).flatMap((frame) => {
      const path = asText(asRecord(frame)?.path);
      return path ? [path] : [];
    });
    return [
      {
        id: asText(step.id) ?? `trace-${index}`,
        index: asFinite(step.index) ?? index,
        title: layout?.title ?? title,
        state:
          status === "error" || step.tone === "fail"
            ? ("failed" as const)
            : status === "running"
              ? ("running" as const)
              : status === "ok" || status === "healed"
                ? ("passed" as const)
                : ("pending" as const),
        ...(asFinite(step.durationMs) !== undefined
          ? { durationMs: asFinite(step.durationMs)! }
          : {}),
        evidenceCount: framePaths.length,
        ...(framePaths.length ? { framePaths } : {}),
        ...(asText(step.log) ? { log: asText(step.log) } : {}),
        ...(layout?.failure && (status === "error" || step.tone === "fail")
          ? { failure: layout.failure }
          : {}),
      },
    ];
  });
}
