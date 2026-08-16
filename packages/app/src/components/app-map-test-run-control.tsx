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
  hasSurfaceBindings?: boolean;
  freshSurfaceEvidence?: boolean;
  onFreshSurfaceEvidenceChange?: (checked: boolean) => void;
  onResolveBlocked?: () => void;
  onRun: () => void;
  onCancel: () => void;
  onOpenResult: () => void;
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

  return (
    <div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
      {props.hasSurfaceBindings ? (
        <label class="flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-lg px-2 text-[11px] font-medium text-text-weak focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-border-strong-focus">
          <input
            type="checkbox"
            class="size-4 shrink-0 accent-[var(--text-interactive-base)]"
            checked={props.freshSurfaceEvidence}
            disabled={busy() || active()}
            onChange={(event) => props.onFreshSurfaceEvidenceChange?.(event.currentTarget.checked)}
          />
          <span title="Bypass cached comparisons and capture every bound scroll surface again for this run only.">
            Capture fresh evidence
          </span>
        </label>
      ) : null}
      <Button
        size="sm"
        class="min-h-11 min-w-[122px]"
        variant={active() ? "danger" : "primary"}
        disabled={busy() || (Boolean(props.blockedReason) && !props.onResolveBlocked)}
        aria-busy={busy()}
        aria-describedby={status() ? "test-run-control-status" : undefined}
        title={props.blockedReason || undefined}
        onClick={activate}
      >
        <Icon name={active() ? "square" : finished() ? "arrow-right" : "play"} size={13} />
        {label()}
      </Button>
      {status() ? (
        <span
          id="test-run-control-status"
          class="basis-full text-right text-[10px]/[1.35] text-text-weaker"
          role="status"
          aria-live="polite"
        >
          {status()}
        </span>
      ) : null}
    </div>
  );
}
