/**
 * Trace-step bookkeeping for a running job: open a step, close it, and grow it
 * from live log lines.
 *
 * `glyphs` describes the plan; `actions` is an ordered observation log. A step
 * therefore never presents a plan as a fact — old traces omit `actions` and may
 * fall back to glyphs, new traces do not.
 */
import { randomUUID } from "node:crypto";
import { now, publish } from "./events.js";
import type { TestJob } from "./session-contract.js";
import { glyphsFromLogLine, type Glyph, type TraceFrameRef, type TraceStep } from "./trace.js";

/** How close two inferred actions of the same kind must be to count as one. */
const ACTION_DEDUPE_WINDOW_MS = 250;

export function openStep(
  job: TestJob,
  partial: Omit<TraceStep, "id" | "index" | "startedAt" | "frames" | "log"> & {
    log?: string;
    frames?: TraceFrameRef[];
  },
): TraceStep {
  const step: TraceStep = {
    id: randomUUID(),
    index: job.steps.length,
    kind: partial.kind,
    tone: partial.tone,
    title: partial.title,
    glyphs: partial.glyphs,
    startedAt: now(),
    frames: partial.frames ?? [],
    log: partial.log ?? "",
    heal: partial.heal,
    status: partial.status ?? "running",
    actions: [],
  };
  job.steps.push(step);
  publish({ type: "job.step", at: step.startedAt, jobId: job.id, step });
  return step;
}

export function finishStep(step: TraceStep, status: TraceStep["status"], extraLog?: string): void {
  step.finishedAt = now();
  step.durationMs = step.finishedAt - step.startedAt;
  step.status = status;
  if (extraLog) step.log = step.log ? `${step.log}\n${extraLog}` : extraLog;
}

export function appendStepLog(step: TraceStep | undefined, line: string): void {
  if (!step) return;
  step.log = step.log ? `${step.log}\n${line}` : line;
  const inferred = glyphsFromLogLine(line);
  step.glyphs = [...new Set([...step.glyphs, ...inferred])].slice(0, 6);
  if (inferred.length === 0) return;
  const at = now();
  const actions = step.actions ?? [];
  for (const kind of inferred) {
    const previous = actions.at(-1);
    if (previous?.kind === kind && at - previous.at < ACTION_DEDUPE_WINDOW_MS) continue;
    actions.push({ kind, at, label: line });
  }
  step.actions = actions;
}

export function observeStepActions(step: TraceStep, glyphs: Glyph[]): void {
  const at = now();
  step.actions = [...(step.actions ?? []), ...glyphs.map((kind) => ({ kind, at }))];
}
