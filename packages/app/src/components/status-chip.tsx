import { type JSX } from "solid-js";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";
import { executionStateForJob, executionStateLabel } from "../lib/execution-moments";
import type { JobInfo } from "../context/server";

export type StatusChipTone = "pass" | "attention" | "fail" | "run" | "idle";

const TONE_CLASS: Record<StatusChipTone, string> = {
  pass: "bg-surface-success-weak text-text-success-base ring-border-success-base/40",
  attention: "bg-surface-warning-weak text-text-warning-base ring-border-warning-base/40",
  fail: "bg-surface-critical-weak text-text-critical-base ring-border-critical-base/40",
  run: "bg-surface-interactive-weak text-text-interactive-base ring-border-interactive-base/40",
  idle: "bg-surface-raised-strong text-text-base ring-border-weak-base",
};

const TONE_ICON: Record<StatusChipTone, IconName> = {
  pass: "check",
  attention: "alert",
  fail: "x",
  run: "play",
  idle: "clock",
};

/**
 * Filled-tint status pill — the one place a run's outcome is stated plainly
 * (green Passed, amber Needs attention, red Failed). Reused by the run
 * history row, the execution review header, and the replay stage's floating
 * chip so the three surfaces never drift into different vocabularies.
 */
export function StatusChip(props: {
  tone: StatusChipTone;
  label: string;
  class?: string;
}): JSX.Element {
  return (
    <span
      class={cn(
        "inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-md px-2",
        "text-caption font-semibold ring-1 ring-inset",
        TONE_CLASS[props.tone],
        props.class,
      )}
    >
      <Icon name={TONE_ICON[props.tone]} size={11} />
      {props.label}
    </span>
  );
}

/** Maps a job's raw status to the chip vocabulary used across the Runs area. */
export function jobStatusChip(status: JobInfo["status"]): { tone: StatusChipTone; label: string } {
  const state = executionStateForJob(status);
  const tone: StatusChipTone =
    state === "passed"
      ? "pass"
      : state === "failed" || state === "cancelled"
        ? "fail"
        : state === "paused"
          ? "attention"
          : state === "running" || state === "queued"
            ? "run"
            : "idle";
  return { tone, label: executionStateLabel(state) };
}

/** Outcome-aware status used by reports and history. Raw `status=ok` only
 * means execution completed; a deferred check must never look green. */
export function runOutcomeChip(job: Pick<JobInfo, "status" | "outcome" | "review">): {
  tone: StatusChipTone;
  label: string;
} {
  if (job.review?.status === "rejected") {
    return { tone: "fail", label: "Review rejected" };
  }
  if (job.review?.status === "pending" || job.outcome === "uncertain") {
    return { tone: "attention", label: "Needs review" };
  }
  if (job.outcome === "passed" || job.status === "ok" || job.status === "healed") {
    return { tone: "pass", label: job.status === "healed" ? "Passed with recovery" : "Passed" };
  }
  if (job.outcome === "product-failure") return { tone: "fail", label: "App issue" };
  if (job.outcome === "harness-failure") return { tone: "fail", label: "Could not run" };
  return jobStatusChip(job.status);
}
