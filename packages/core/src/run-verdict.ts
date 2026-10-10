/**
 * One answer for "did it work?", shared by the CLI, `relay ci`, and agents:
 * passed, failed (the product misbehaved), or blocked (Relay could not finish:
 * a device, sign-in, or harness problem), with each authored step's result
 * and, for the step that stopped the run, what was expected and what Relay saw.
 */
import { join } from "node:path";
import type { AppMapScenarioTestStep } from "@relay/protocol";
import type { PersistedRun } from "./runs.js";

export type RunVerdictStatus = "passed" | "failed" | "blocked" | "cancelled" | "running";

export type RunVerdictStep = {
  /** Authored step id; stable across runs. */
  id: string;
  title: string;
  kind?: "action" | "check";
  status: "passed" | "failed" | "not-run";
  expected?: string;
  saw?: string;
  /** Absolute path of the most useful screenshot for this step. */
  screenshot?: string;
};

export type RunVerdict = {
  runId: string;
  title: string;
  status: RunVerdictStatus;
  /** One line a person or agent can repeat as-is. */
  summary: string;
  /** Why the run did not pass, in Relay's words. */
  reason?: string;
  durationMs?: number;
  device?: string;
  steps: RunVerdictStep[];
};

const CAPTION_STEP = /^(?:Capture for review · )?step:([^:]+):(.*)$/u;
const RUNNER_PREFIX =
  /^(?:✗\s*)?(?:judge uncertain: )?(?:visual assertion|semantic assertion|content assertion|expect): /iu;

function statusFor(run: Pick<PersistedRun, "outcome" | "status">): RunVerdictStatus {
  switch (run.outcome) {
    case "passed":
      return "passed";
    case "product-failure":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "harness-failure":
    case "uncertain":
      return "blocked";
    default:
      return /^(?:queued|running|paused)$/u.test(run.status) ? "running" : "blocked";
  }
}

function seconds(ms: string): string {
  const value = Number(ms) / 1000;
  return value >= 60 ? `${Math.round(value / 60)} min` : `${Math.round(value)} s`;
}

/** Runner phrasings people should never have to decode. */
function humanize(line: string): string {
  const screen = /expect-screen: on “(.+?)”, not “(.+?)”(?: after (\d+)ms)?/u.exec(line);
  if (screen) {
    const [, observed, expected, ms] = screen;
    const where =
      observed === "unknown"
        ? "Relay didn’t recognize the screen it was on"
        : `it was on “${observed}”`;
    return `Expected the “${expected}” screen${ms ? ` within ${seconds(ms)}` : ""}, but ${where}.`;
  }
  const waited = /^(?:wait-for|expect): timed out waiting for (.+?) \((\d+)ms\)/u.exec(line);
  if (waited) {
    const what = waited[1]!.replace(/^(?:text|label|identifier) "(.+)"$/u, "“$1”");
    return `${what[0]!.toUpperCase()}${what.slice(1)} didn’t appear within ${seconds(waited[2]!)}.`;
  }
  return line;
}

/** Plain words from a runner message: drop prefixes and the cleanup chatter. */
export function plainReason(message: string | undefined): string | undefined {
  if (!message?.trim()) return undefined;
  const lines = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^check cleanup skipped|^Run saved Test/iu.test(line));
  const best = lines.find((line) => line.startsWith("✗")) ?? lines.at(-1) ?? message.trim();
  const cleaned = best
    .replace(/^\d+ campaign checks? failed: [^:]+: /u, "")
    .replace(RUNNER_PREFIX, "")
    .replace(/^✗\s*/u, "")
    .trim();
  return humanize(cleaned);
}

function testIdFor(run: PersistedRun): string | undefined {
  const plan = run.artifacts.find((artifact) => artifact.kind === "app-map-test-plan")?.data as
    | { test?: { id?: unknown; name?: unknown } }
    | undefined;
  return typeof plan?.test?.id === "string" ? plan.test.id : undefined;
}

export function buildRunVerdict(
  run: PersistedRun,
  authored?: { name?: string; steps: readonly AppMapScenarioTestStep[] },
): RunVerdict {
  const status = statusFor(run);
  const intents = new Map<string, { title: string; kind?: "action" | "check" }>();
  for (const step of authored?.steps ?? []) {
    intents.set(step.id, {
      title: step.intent,
      ...(step.kind === "validation"
        ? { kind: "check" as const }
        : step.kind === "instruction"
          ? { kind: "action" as const }
          : {}),
    });
  }
  // Titles the run itself recorded, for tests that changed or were removed.
  for (const artifact of run.artifacts) {
    const data = artifact.data as { id?: unknown; title?: unknown } | undefined;
    if (
      artifact.kind === "campaign-check-result" &&
      typeof data?.id === "string" &&
      typeof data.title === "string" &&
      !intents.has(data.id)
    )
      intents.set(data.id, { title: data.title });
  }
  for (const frame of run.frames) {
    const match = CAPTION_STEP.exec(frame.caption);
    if (match && !intents.has(match[1]!)) intents.set(match[1]!, { title: match[2]!.trim() });
  }

  // Each authored step's own result, when the run kept one.
  const checkErrors = new Map<string, string>();
  for (const artifact of run.artifacts) {
    const data = artifact.data as { id?: unknown; error?: unknown } | undefined;
    if (
      artifact.kind === "campaign-check-result" &&
      typeof data?.id === "string" &&
      typeof data.error === "string" &&
      !checkErrors.has(data.id)
    )
      checkErrors.set(data.id, data.error);
  }
  const traceById = new Map(run.steps.map((step) => [step.id, step]));
  const order: string[] = [];
  const byStep = new Map<string, { failed: boolean; frames: string[]; log?: string }>();
  for (const join_ of [...(run.testStepEvidence ?? [])].sort(
    (a, b) => a.traceStepIndex - b.traceStepIndex,
  )) {
    if (!byStep.has(join_.testStepId)) {
      order.push(join_.testStepId);
      byStep.set(join_.testStepId, { failed: false, frames: [] });
    }
    const entry = byStep.get(join_.testStepId)!;
    const trace = traceById.get(join_.traceStepId);
    if (trace?.status === "error") {
      entry.failed = true;
      entry.log = trace.log;
    }
    entry.frames.push(...join_.evidence.framePaths, ...(trace?.frames.map((f) => f.path) ?? []));
  }
  for (const id of intents.keys()) if (!byStep.has(id)) order.push(id);

  const judged = run.artifacts
    .filter((artifact) => artifact.kind === "visual-evaluation")
    .map((artifact) => (artifact.data as { summary?: unknown; status?: unknown }) ?? {});
  const failedJudgement = judged.find((item) => item.status !== "pass");
  const runReason = plainReason(run.error);
  let reachedFailure = false;
  const steps: RunVerdictStep[] = order.map((id) => {
    const entry = byStep.get(id);
    const meta = intents.get(id);
    const title = meta?.title ?? id;
    const screenshot = entry?.frames.at(-1);
    const base = {
      id,
      title,
      ...(meta?.kind ? { kind: meta.kind } : {}),
      ...(screenshot && run.dir ? { screenshot: join(run.dir, screenshot) } : {}),
    };
    if (!entry || reachedFailure) return { ...base, status: "not-run" as const };
    if (!entry.failed) return { ...base, status: "passed" as const };
    reachedFailure = true;
    const saw =
      (meta?.kind === "check" && typeof failedJudgement?.summary === "string"
        ? failedJudgement.summary
        : undefined) ??
      plainReason(checkErrors.get(id)) ??
      runReason ??
      plainReason(entry.log);
    return { ...base, status: "failed" as const, expected: title, ...(saw ? { saw } : {}) };
  });
  // A run that stopped outside any authored step still blames the next one.
  if (status !== "passed" && status !== "running" && !steps.some((s) => s.status === "failed")) {
    const next = steps.find((step) => step.status === "not-run");
    if (next) {
      next.status = "failed";
      next.expected = next.title;
      if (runReason) next.saw = runReason;
    }
  }

  const passedCount = steps.filter((step) => step.status === "passed").length;
  // Steps after a failure that the runner marked blocked simply did not run.
  const failedStep = steps.find((step) => step.status === "failed");
  const title = authored?.name ?? run.title ?? testIdFor(run) ?? run.action;
  const summary =
    status === "passed"
      ? `Passed · ${passedCount} of ${steps.length} steps`
      : status === "running"
        ? `Running · ${passedCount} of ${steps.length} steps so far`
        : status === "cancelled"
          ? "Cancelled"
          : `${status === "failed" ? "Failed" : "Blocked"}${failedStep ? ` at “${failedStep.title}”` : ""}${(failedStep?.saw ?? runReason) ? `: ${failedStep?.saw ?? runReason}` : ""}`;
  return {
    runId: run.id,
    title,
    status,
    summary,
    ...(status !== "passed" && (failedStep?.saw ?? runReason)
      ? { reason: failedStep?.saw ?? runReason }
      : {}),
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    ...(run.deviceName || run.serial ? { device: run.deviceName ?? run.serial } : {}),
    steps,
  };
}

export { testIdFor as runTestId };
