import type { ExecutionMomentState } from "./execution-moments";

export function formatStepDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

export function runStateDot(state: ExecutionMomentState): string {
  if (state === "failed" || state === "cancelled") return "bg-[var(--icon-critical-base)]";
  if (state === "planned") return "bg-[var(--border-strong-base)]";
  if (state === "running")
    return "bg-[var(--text-interactive-base)] shadow-[0_0_8px_var(--text-interactive-base)]";
  return "bg-[var(--icon-success-base)]";
}
