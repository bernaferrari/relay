import type { JobInfo } from "../lib/api-types";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";

export type TestRunLaunchState = "idle" | "preparing" | "canceling" | "error";

export type TestRunControlProps = {
  launchState: TestRunLaunchState;
  job?: JobInfo;
  blockedReason?: string;
  error?: string;
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
    return "Run test";
  };
  const status = () => {
    if (props.launchState === "preparing") return "Saving and compiling the latest Test…";
    if (props.launchState === "canceling") return "Cancellation requested. Waiting for Relay…";
    if (props.error) return props.error;
    if (props.blockedReason) return props.blockedReason;
    if (props.job?.status === "queued") return "Queued on the selected target.";
    if (props.job?.status === "running") return "Running on the selected target.";
    if (props.job?.status === "paused") return "Paused at a human checkpoint.";
    if (finished()) return `Run finished: ${props.job!.status}.`;
    return "Runs the saved Test once on the selected target.";
  };

  function activate(): void {
    if (active()) props.onCancel();
    else if (props.launchState === "error") props.onRun();
    else if (finished()) props.onOpenResult();
    else props.onRun();
  }

  return (
    <div class="grid justify-items-end gap-0.5">
      <Button
        size="sm"
        class="min-h-11 min-w-[122px]"
        variant={active() ? "danger" : "primary"}
        disabled={busy() || (!active() && !finished() && Boolean(props.blockedReason))}
        aria-busy={busy()}
        aria-describedby="test-run-control-status"
        title={props.blockedReason || undefined}
        onClick={activate}
      >
        <Icon name={active() ? "square" : finished() ? "arrow-right" : "play"} size={13} />
        {label()}
      </Button>
      <span
        id="test-run-control-status"
        class="max-w-[32ch] truncate text-[10px] text-text-weaker"
        role="status"
        aria-live="polite"
      >
        {status()}
      </span>
    </div>
  );
}
