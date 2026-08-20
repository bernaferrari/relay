import { For } from "solid-js";
import type { AppMapTestStartup } from "@relay/protocol";
import type { JobInfo } from "../lib/api-types";
import {
  appMapTestStartupCopy,
  coldAppMapTestStartup,
  type AppMapTestCheckpointOption,
} from "../lib/app-map-test-startup-policy";
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
  /** A run-scoped starting contract. It is intentionally kept beside Run,
   * rather than written into the Test document. */
  startup?: AppMapTestStartup;
  checkpointOptions?: readonly AppMapTestCheckpointOption[];
  onStartupChange?: (startup: AppMapTestStartup) => void;
  /** A read-only frozen-evidence scope. It never changes the Test or device. */
  targetProfileOptions?: ReadonlyArray<{ id: string; label: string }>;
  targetProfileId?: string;
  onTargetProfileChange?: (targetProfileId: string | undefined) => void;
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
  const startup = () => props.startup ?? coldAppMapTestStartup;
  const startupCopy = () => appMapTestStartupCopy({ startup: startup() });
  const checkpointOptions = () => props.checkpointOptions ?? [];
  const canChooseStartup = () => Boolean(props.onStartupChange && checkpointOptions().length);
  const targetProfileOptions = () => props.targetProfileOptions ?? [];
  const canChooseTargetProfile = () =>
    Boolean(props.onTargetProfileChange && targetProfileOptions().length > 1);
  const startupValue = () => {
    const selected = startup();
    return selected.mode === "verified-checkpoint" ? `checkpoint:${selected.screenId}` : "cold";
  };
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

  function selectStartup(event: Event & { currentTarget: HTMLSelectElement }): void {
    const value = event.currentTarget.value;
    if (value === "cold") {
      props.onStartupChange?.(coldAppMapTestStartup);
      return;
    }
    const screenId = value.startsWith("checkpoint:") ? value.slice("checkpoint:".length) : "";
    if (!checkpointOptions().some((option) => option.screenId === screenId)) return;
    props.onStartupChange?.({ mode: "verified-checkpoint", screenId });
  }

  function selectTargetProfile(event: Event & { currentTarget: HTMLSelectElement }): void {
    props.onTargetProfileChange?.(event.currentTarget.value || undefined);
  }

  // One row, so the primary action can live in the single workspace bar instead of
  // the status strip the old screen stacked under it.
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
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
      {canChooseTargetProfile() ? (
        <label
          class="flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-border-weak-base bg-surface-base px-2 text-caption text-text-base"
          title="Scope the next offline proof to one saved target profile. This does not change the Test or device."
        >
          <span class="text-text-weak">Evidence</span>
          <select
            id="test-runtime-profile"
            data-test-runtime-profile
            aria-label="Runtime target profile for offline evidence"
            class="min-w-0 max-w-52 cursor-pointer bg-transparent text-base font-medium text-text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
            value={props.targetProfileId ?? ""}
            disabled={busy() || active() || finished()}
            onChange={selectTargetProfile}
          >
            <option value="">Choose profile…</option>
            <For each={targetProfileOptions()}>
              {(profile) => <option value={profile.id}>{profile.label}</option>}
            </For>
          </select>
        </label>
      ) : null}
      {props.startup ? (
        canChooseStartup() ? (
          <label
            class="flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-border-weak-base bg-surface-base px-2 text-caption text-text-base"
            title={startupCopy().detail}
          >
            <span class="text-text-weak">Start</span>
            <select
              aria-label="Test startup policy"
              data-test-startup-policy
              class="min-w-0 max-w-40 cursor-pointer bg-transparent text-caption font-medium text-text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
              value={startupValue()}
              disabled={busy() || active() || finished()}
              onChange={selectStartup}
            >
              <option value="cold">Cold baseline</option>
              <optgroup label="Verified checkpoint">
                <For each={checkpointOptions()}>
                  {(option) => (
                    <option value={`checkpoint:${option.screenId}`}>
                      Verified · {option.label}
                    </option>
                  )}
                </For>
              </optgroup>
            </select>
          </label>
        ) : (
          <span
            data-test-startup-policy
            class="shrink-0 text-caption text-text-weak"
            title={startupCopy().detail}
          >
            Start · {startupCopy().label}
          </span>
        )
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
