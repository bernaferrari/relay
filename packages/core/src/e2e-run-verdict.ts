import { join } from "node:path";
import type { PersistedRun } from "./runs.js";
import type { RunVerdict, RunVerdictStatus, RunVerdictStep } from "./run-verdict.js";

/** Imported traces are already upstream executions. Keep their final attempt's
 * steps rather than inventing native authored-step joins or collapsing retries. */
export function e2eRunVerdict(run: PersistedRun, status: RunVerdictStatus): RunVerdict | undefined {
  const source = run.artifacts.find((artifact) => artifact.kind === "e2e-execution");
  if (!source) return;
  const metadata = source.data as { finalAttempt?: number } | undefined;
  const attempt =
    metadata?.finalAttempt ??
    run.steps.reduce((latest, step) => Math.max(latest, step.attempt ?? 0), 0);
  const steps: RunVerdictStep[] = run.steps
    .filter((step) => (step.attempt ?? 0) === attempt)
    .map((step) => {
      let detail: {
        api?: string;
        label?: string;
        error?: { message?: string; details?: { expected?: string; observed?: string } };
      } = {};
      try {
        const parsed = JSON.parse(step.log);
        if (parsed && typeof parsed === "object") detail = parsed;
      } catch {
        /* Historical traces may have plain logs. */
      }
      const failed = step.status === "error";
      const screenshot = step.frames.at(-1)?.path;
      return {
        id: step.id,
        title: detail.label ?? step.title,
        kind: /^(?:expect|agent\.assert)/u.test(detail.api ?? "") ? "check" : "action",
        status: failed
          ? "failed"
          : step.status === "ok" || step.status === "healed"
            ? "passed"
            : "not-run",
        ...(failed
          ? {
              expected: detail.error?.details?.expected ?? detail.label ?? step.title,
              saw:
                detail.error?.details?.observed ?? detail.error?.message ?? run.error ?? step.log,
            }
          : {}),
        ...(screenshot ? { screenshot: join(run.dir, screenshot) } : {}),
      };
    });
  const failure = steps.find((step) => step.status === "failed");
  const reason = failure?.saw ?? run.error;
  const title = run.title ?? run.action;
  const summary =
    status === "passed"
      ? `Passed · ${steps.filter((step) => step.status === "passed").length} of ${steps.length} steps`
      : `${status === "failed" ? "Failed" : status === "cancelled" ? "Cancelled" : "Blocked"}${failure ? ` at “${failure.title}”` : ""}${reason ? `: ${reason}` : ""}`;
  return {
    runId: run.id,
    title,
    status,
    summary,
    steps,
    ...(status !== "passed" && reason ? { reason } : {}),
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    ...(run.deviceName || run.serial ? { device: run.deviceName ?? run.serial } : {}),
  };
}
