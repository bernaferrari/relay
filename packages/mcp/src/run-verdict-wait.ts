import type { RelayOutcomeJobs } from "@relay/workflows";
import type { OperationInvoker } from "./server.js";

/** Waiting turns a started Run into the one answer an agent needs: did it
 * pass, and if not, which step failed and what Relay saw instead. */
export type RunWaitContext = {
  invoker: OperationInvoker;
  jobs: RelayOutcomeJobs;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

export const defaultRunWaitSeconds = 600;
const pollMs = 1_500;
const textLimit = 400;
const stepLimit = 40;

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const clip = (value: unknown): unknown =>
  typeof value === "string" && value.length > textLimit
    ? `${value.slice(0, textLimit - 1)}…`
    : value;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Waiting was cancelled."));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Waiting was cancelled."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Agent-facing run snapshot: identity, phase and problems — never the
 * compiled plan, frozen identity, or legacy continuation reference. */
export function compactRunSnapshot(value: unknown): unknown {
  const snapshot = object(value);
  if (snapshot.kind !== "run-test") return value;
  const { compiled: _compiled, frozen: _frozen, ref: _ref, ...rest } = snapshot;
  return rest;
}

/** Bounded verdict: every step's status, details only where a step failed. */
export function agentVerdict(value: unknown): Record<string, unknown> {
  const verdict = object(value);
  const steps = (Array.isArray(verdict.steps) ? verdict.steps : []).map(object);
  return {
    ...Object.fromEntries(Object.entries(verdict).map(([key, item]) => [key, clip(item)])),
    steps: steps.slice(0, stepLimit).map((step) =>
      step.status === "failed"
        ? Object.fromEntries(Object.entries(step).map(([key, item]) => [key, clip(item)]))
        : {
            id: step.id,
            title: clip(step.title),
            ...(step.kind ? { kind: step.kind } : {}),
            status: step.status,
          },
    ),
    ...(steps.length > stepLimit ? { moreSteps: steps.length - stepLimit } : {}),
  };
}

function runIdOf(snapshot: Record<string, unknown>): string | undefined {
  const execution = object(snapshot.execution);
  if (typeof execution.runId === "string") return execution.runId;
  const refs = Array.isArray(snapshot.evidenceRefs) ? snapshot.evidenceRefs.map(object) : [];
  const run = refs.find((ref) => ref.kind === "run" && typeof ref.id === "string");
  return run?.id as string | undefined;
}

const activePhases = new Set(["queued", "running"]);

/**
 * Poll the durable workflow until its Run settles (or the bounded wait ends),
 * then read run.verdict.get. Cancelling the MCP request stops only the wait;
 * the Run keeps going and stays readable through relay_get_verdict.
 */
export async function waitForRunVerdict(
  started: unknown,
  context: RunWaitContext,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const sleep = context.sleep ?? abortableSleep;
  const now = context.now ?? Date.now;
  const deadline = now() + timeoutMs;
  let snapshot = object(started);
  const workflowId = object(snapshot.workflow).workflowId;
  while (activePhases.has(String(snapshot.phase)) && typeof workflowId === "string") {
    if (now() >= deadline) break;
    await sleep(pollMs, context.signal);
    snapshot = object(await context.jobs.inspect({ workflowId }));
  }
  const runId = runIdOf(snapshot);
  const workflow = snapshot.workflow;
  if (!runId) {
    const problems = Array.isArray(snapshot.problems) ? snapshot.problems.map(object) : [];
    const needsConsent = problems.some((problem) => String(problem.code ?? "").includes("confirm"));
    return {
      status: activePhases.has(String(snapshot.phase)) ? "running" : "blocked",
      phase: snapshot.phase,
      ...(problems.length
        ? { reason: clip(problems.map((problem) => problem.message ?? problem.code).join("; ")) }
        : {}),
      ...(workflow ? { workflow } : {}),
      run: compactRunSnapshot(snapshot),
      next: needsConsent
        ? "Review the reported risk, then repeat the call with confirm: true."
        : activePhases.has(String(snapshot.phase))
          ? "Still starting; find its runId with relay_list_runs later, then call relay_get_verdict."
          : "Fix the reported problem, then run again.",
    };
  }
  let verdict = object(
    object(await context.invoker.invoke("run.verdict.get", { runId }, { signal: context.signal }))
      .verdict,
  );
  while (verdict.status === "running" && now() < deadline) {
    await sleep(pollMs, context.signal);
    verdict = object(
      object(await context.invoker.invoke("run.verdict.get", { runId }, { signal: context.signal }))
        .verdict,
    );
  }
  return {
    status: verdict.status,
    runId,
    verdict: agentVerdict(verdict),
    ...(workflow ? { workflow } : {}),
    next:
      verdict.status === "running"
        ? `Still running; call relay_get_verdict {runId:"${runId}"} later.`
        : verdict.status === "failed"
          ? `Call relay_inspect_failure {runId:"${runId}"} for evidence and repair options.`
          : "Done.",
  };
}

/** relay_inspect_failure also answers "which step, expected what, saw what". */
export async function withFailingStep(
  failure: unknown,
  runId: string,
  context: Pick<RunWaitContext, "invoker" | "signal">,
): Promise<unknown> {
  try {
    const result = object(
      await context.invoker.invoke("run.verdict.get", { runId }, { signal: context.signal }),
    );
    const verdict = agentVerdict(result.verdict);
    const steps = (verdict.steps as Record<string, unknown>[]) ?? [];
    return {
      ...object(failure),
      verdict: {
        status: verdict.status,
        summary: verdict.summary,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
        failingStep: steps.find((step) => step.status === "failed") ?? null,
      },
    };
  } catch {
    return failure;
  }
}
