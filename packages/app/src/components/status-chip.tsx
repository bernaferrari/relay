import { type JSX } from "solid-js";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";

export type StatusChipTone = "pass" | "attention" | "fail" | "run" | "idle";

const TONE_CLASS: Record<StatusChipTone, string> = {
  pass: "bg-surface-success-weak text-icon-success-base ring-border-success-base/40",
  attention: "bg-surface-warning-weak text-icon-warning-base ring-border-warning-base/40",
  fail: "bg-surface-critical-weak text-icon-critical-base ring-border-critical-base/40",
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
        "text-[11px] font-semibold ring-1 ring-inset",
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
export function jobStatusChip(status: string): { tone: StatusChipTone; label: string } {
  if (status === "ok" || status === "healed") return { tone: "pass", label: "Passed" };
  if (status === "error") return { tone: "fail", label: "Failed" };
  if (status === "cancelled") return { tone: "fail", label: "Stopped" };
  if (status === "paused") return { tone: "attention", label: "Needs attention" };
  if (status === "running") return { tone: "run", label: "Running" };
  if (status === "queued") return { tone: "run", label: "Queued" };
  return { tone: "idle", label: status };
}
