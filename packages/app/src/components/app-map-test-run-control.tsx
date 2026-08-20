import type { JobInfo } from "../lib/api-types";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";

export type TestRunLaunchState = "idle" | "preparing" | "canceling" | "error";

export type TestRunControlProps = {
  launchState: TestRunLaunchState;
  job?: JobInfo;
  blockedReason?: string;
  error?: string;
  blockedActionLabel?: string;
  onResolveBlocked?: () => void;
  onRun: () => void;
  onCancel: () => void;
  onOpenResult: () => void;
  onCheckOffline?: () => void;
  checkingOffline?: boolean;
  freshEvidenceAvailable?: boolean;
  freshEvidence?: boolean;
  onFreshEvidenceChange?: (value: boolean) => void;
};

const activeStatuses = new Set<JobInfo["status"]>(["queued", "running", "paused"]);
const terminalStatuses = new Set<JobInfo["status"]>(["ok", "error", "healed", "cancelled"]);

export function isActiveTestRun(job: JobInfo | undefined): boolean {
  return Boolean(job && activeStatuses.has(job.status));
}

export function isFinishedTestRun(job: JobInfo | undefined): boolean {
  return Boolean(job && terminalStatuses.has(job.status));
}

export function AppMapTestRunControl(props: TestRunControlProps) {
  const active = () => isActiveTestRun(props.job);
  const finished = () => isFinishedTestRun(props.job);
  const busy = () => props.launchState === "preparing" || props.launchState === "canceling";
  const label = () => {
    if (props.launchState === "preparing") return "Preparing run…";
    if (props.launchState === "canceling") return "Requesting cancel…";
    if (active()) return props.job?.status === "queued" ? "Cancel queued run" : "Cancel run";
    if (props.launchState === "error") return "Try run again";
    if (finished()) return "Open result";
    if (props.blockedReason && props.blockedActionLabel) return props.blockedActionLabel;
    return "Run test";
  };
  const status = () => {
    if (props.launchState === "preparing") return "Starting the exact saved Test revision…";
    if (props.launchState === "canceling") return "Cancellation requested. Waiting for Relay…";
    if (props.error) return props.error;
    if (props.blockedReason) return props.blockedReason;
    if (props.job?.status === "queued") return "Queued on the selected target.";
    if (props.job?.status === "running") return "Running on the selected target.";
    if (props.job?.status === "paused") return "Paused at a human checkpoint.";
    if (finished()) return `Run finished: ${props.job!.status}.`;
    return "";
  };

  function activate(): void {
    if (active()) props.onCancel();
    else if (props.launchState === "error") props.onRun();
    else if (finished()) props.onOpenResult();
    else if (props.blockedReason) props.onResolveBlocked?.();
    else props.onRun();
  }

  // One row, so the primary action can live in the single workspace bar instead of
  // the status strip the old screen stacked under it.
  return (
    <div class="flex min-w-0 items-center gap-2">
      {props.onCheckOffline ? (
        <Button
          size="sm"
          variant="secondary"
          class="shrink-0"
          disabled={busy() || active() || props.checkingOffline}
          aria-busy={props.checkingOffline}
          onClick={props.onCheckOffline}
        >
          <Icon name="check" size={13} />
          {props.checkingOffline ? "Checking…" : "Check offline"}
        </Button>
      ) : null}
      {props.freshEvidenceAvailable ? (
        <label class="flex min-h-9 shrink-0 items-center gap-1.5 text-caption text-text-base">
          <input
            type="checkbox"
            class="size-3.5 accent-icon-interactive-base"
            checked={Boolean(props.freshEvidence)}
            disabled={busy() || active()}
            onChange={(event) => props.onFreshEvidenceChange?.(event.currentTarget.checked)}
          />
          Capture fresh evidence
        </label>
      ) : null}
      {status() ? (
        <span
          id="test-run-control-status"
          class="max-w-[26ch] truncate text-right text-caption/[1.3] text-text-weak"
          role="status"
          aria-live="polite"
        >
          {status()}
        </span>
      ) : null}
      <Button
        size="sm"
        class="shrink-0"
        variant={active() ? "danger" : "primary"}
        disabled={busy() || (Boolean(props.blockedReason) && !props.onResolveBlocked)}
        aria-busy={busy()}
        aria-describedby={status() ? "test-run-control-status" : undefined}
        title={status() || undefined}
        onClick={activate}
      >
        <Icon name={active() ? "square" : finished() ? "arrow-right" : "play"} size={13} />
        {label()}
      </Button>
    </div>
  );
}
