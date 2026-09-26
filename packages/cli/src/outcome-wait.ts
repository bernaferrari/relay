/** Waiting on outcome workflows (relay run / repeat) with a live view for people. */
import type { RelayOutcomeJobs, WorkflowSnapshot } from "@relay/workflows";
import { CliError, ExitCode } from "./errors.js";
import { liveRowFromWorkflow } from "./live-run-view.js";
import type { CliOutput } from "./output.js";

export function abortError(): DOMException {
  return new DOMException("cancelled", "AbortError");
}

export function waitForPoll(intervalMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, intervalMs);
    signal.addEventListener("abort", cancel, { once: true });

    function finish(): void {
      signal.removeEventListener("abort", cancel);
      resolve();
    }

    function cancel(): void {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

export function assertOutcomeSucceeded(snapshot: WorkflowSnapshot): void {
  if (snapshot.phase === "cancelled") {
    throw new CliError(snapshot.progress.label, ExitCode.cancellation, snapshot);
  }
  if (
    snapshot.phase === "blocked" ||
    snapshot.phase === "failed" ||
    snapshot.phase === "needs-attention"
  ) {
    throw new CliError(
      snapshot.problems[0]?.title ?? snapshot.progress.label,
      ExitCode.operationFailure,
      snapshot,
    );
  }
  // Collection success is not acceptance: a terminal run with undecided
  // captures exits 10 so no caller reads a generic zero as verification
  // complete (delivery plan §10.1).
  if (snapshot.kind === "run-test" && snapshot.review && snapshot.review.pending > 0) {
    const pending = snapshot.review.pending;
    throw new CliError(
      `${pending} screenshot${pending === 1 ? "" : "s"} awaiting review`,
      ExitCode.verificationIncomplete,
      snapshot,
    );
  }
}

export async function waitForOutcome(
  jobs: RelayOutcomeJobs,
  snapshot: WorkflowSnapshot,
  signal: AbortSignal,
  output: CliOutput,
  operationId: string,
  pollIntervalMs: number,
): Promise<WorkflowSnapshot> {
  let current = snapshot;
  const view =
    current.kind !== "author-test" && (current.phase === "queued" || current.phase === "running")
      ? output.liveView?.({ title: snapshot.title })
      : undefined;
  const emit = (next: WorkflowSnapshot) => {
    const row = view ? liveRowFromWorkflow(next) : undefined;
    if (row) view!.update([row]);
    else output.snapshot(operationId, next);
  };
  if (
    current.workflow &&
    current.kind !== "author-test" &&
    (current.phase === "queued" || current.phase === "running") &&
    typeof jobs.watchWorkflow === "function"
  ) {
    emit(current);
    const settled = await jobs.watchWorkflow({
      workflowId: current.workflow.workflowId,
      initial: current,
      signal,
      disconnectedRefreshMs: Math.max(15_000, pollIntervalMs * 60),
      onSnapshot: emit,
    });
    if (view) {
      emit(settled);
      view.finish();
    }
    return settled;
  }
  while (
    (current.ref || current.workflow) &&
    (current.phase === "queued" || current.phase === "running") &&
    current.kind !== "author-test"
  ) {
    emit(current);
    await waitForPoll(pollIntervalMs, signal);
    current = await jobs.inspect(
      current.workflow ? { workflowId: current.workflow.workflowId } : { legacyRef: current.ref! },
    );
  }
  if (view) {
    emit(current);
    view.finish();
  }
  return current;
}
