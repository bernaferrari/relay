import { For, createSignal } from "solid-js";
import type { AppMapTestStartup } from "@relay/protocol";
import type { JobInfo } from "../lib/api-types";
import {
  isActiveTestRun,
  isFinishedTestRun,
  type TestRunLaunchState,
} from "../lib/app-map-test-run-state";
import {
  appMapTestStartupCopy,
  coldAppMapTestStartup,
  type AppMapTestCheckpointOption,
} from "../lib/app-map-test-startup-policy";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";

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
  targetProfileNotice?: string;
  onTargetProfileChange?: (targetProfileId: string | undefined) => void;
};

export {
  isActiveTestRun,
  isFinishedTestRun,
  type TestRunLaunchState,
} from "../lib/app-map-test-run-state";

export function AppMapTestRunControl(props: TestRunControlProps) {
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  let optionsSummary: HTMLElement | undefined;
  const active = () => isActiveTestRun(props.job);
  const finished = () => isFinishedTestRun(props.job);
  const busy = () => props.launchState === "preparing" || props.launchState === "canceling";
  const startup = () => props.startup ?? coldAppMapTestStartup;
  const startupCopy = () => appMapTestStartupCopy({ startup: startup() });
  const checkpointOptions = () => props.checkpointOptions ?? [];
  const canChooseStartup = () => Boolean(props.onStartupChange && checkpointOptions().length);
  const targetProfileOptions = () => props.targetProfileOptions ?? [];
  const canChooseTargetProfile = () =>
    Boolean(props.onTargetProfileChange && targetProfileOptions().length);
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

  function closeOptions(): void {
    setOptionsOpen(false);
    queueMicrotask(() => optionsSummary?.focus());
  }

  // Status and the one primary action stay in the workspace bar. Everything that
  // scopes or inspects a run is progressive disclosure: useful to an expert, but
  // not a second prerequisite checklist for a first run. The run action itself
  // still performs the same automatic offline preflight before device control.
  return (
    <div
      class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 max-[900px]:flex max-[900px]:w-auto"
      data-test-run-actions
    >
      <span
        id="test-run-control-status"
        data-test-run-status
        class="min-h-[2.6em] min-w-0 text-right text-caption/[1.3] text-text-weak [overflow-wrap:anywhere] max-[900px]:sr-only"
        role="status"
        aria-atomic="true"
      >
        {status()}
      </span>
      <div class="flex shrink-0 items-center justify-self-end gap-2">
        <details
          class="group relative shrink-0"
          data-test-run-options
          open={optionsOpen()}
          onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeOptions();
          }}
        >
          <summary
            ref={(element) => (optionsSummary = element)}
            tabindex={0}
            class="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-caption font-medium text-text-base transition-[color,background-color,transform] duration-hover marker:hidden hover:bg-surface-base-hover hover:text-text-strong active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus motion-reduce:transition-none [&::-webkit-details-marker]:hidden"
            aria-controls="test-run-options-panel"
            aria-expanded={optionsOpen()}
          >
            <Icon name="sliders" size={14} />
            Run options
            <Icon
              name="chevron-down"
              size={13}
              class="text-icon-weak transition-transform duration-hover group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div
            id="test-run-options-panel"
            class="absolute top-[calc(100%+6px)] right-0 z-50 grid max-h-[min(70dvh,32rem)] w-[min(22rem,calc(100vw-1rem))] gap-3 overflow-y-auto rounded-lg bg-surface-raised-stronger-non-alpha p-3 text-left shadow-md"
            aria-label="Run options"
          >
            {props.onCheckOffline ? (
              <div class="grid gap-1.5 border-b border-border-weak-base pb-3">
                <Button
                  size="md"
                  variant="secondary"
                  class="w-full"
                  disabled={busy() || active() || props.checkingOffline}
                  aria-busy={props.checkingOffline}
                  onClick={props.onCheckOffline}
                >
                  <Icon name="check" size={13} />
                  {props.checkingOffline ? "Checking…" : "Check offline"}
                </Button>
                <p class="m-0 text-caption/[1.4] text-text-weak">
                  Inspect the frozen plan without controlling the selected target. Run performs this
                  check automatically.
                </p>
              </div>
            ) : null}
            {props.freshEvidenceAvailable ? (
              <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-body text-text-base">
                <input
                  type="checkbox"
                  class="size-4 accent-icon-interactive-base"
                  checked={Boolean(props.freshEvidence)}
                  disabled={busy() || active() || props.checkingOffline}
                  onChange={(event) => props.onFreshEvidenceChange?.(event.currentTarget.checked)}
                />
                <span class="grid gap-0.5">
                  <span class="font-medium text-text-strong">Capture fresh evidence</span>
                  <span class="text-caption/[1.35] text-text-weak">
                    Refresh full-page evidence during this run.
                  </span>
                </span>
              </label>
            ) : null}
            {canChooseTargetProfile() ? (
              <label
                class="grid min-h-11 min-w-0 gap-1.5 text-caption text-text-base"
                title="Scope the next offline proof to one saved target profile. This does not change the Test or device."
              >
                <span class="font-medium text-text-strong">Evidence profile</span>
                <select
                  id="test-runtime-profile"
                  data-test-runtime-profile
                  class="min-h-11 min-w-0 w-full cursor-pointer rounded-md border border-border-weak-base bg-surface-base px-2 text-base font-medium text-text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                  value={props.targetProfileId ?? ""}
                  disabled={busy() || active() || finished() || props.checkingOffline}
                  onChange={selectTargetProfile}
                >
                  <option value="">Choose profile…</option>
                  <For each={targetProfileOptions()}>
                    {(profile) => <option value={profile.id}>{profile.label}</option>}
                  </For>
                </select>
              </label>
            ) : null}
            {props.targetProfileNotice ? (
              <p
                data-test-runtime-profile-notice
                class="m-0 text-caption/[1.4] text-text-weak"
                title={props.targetProfileNotice}
              >
                {props.targetProfileNotice}
              </p>
            ) : null}
            {props.startup ? (
              canChooseStartup() ? (
                <label class="grid min-h-11 min-w-0 gap-1.5 text-caption text-text-base">
                  <span class="font-medium text-text-strong">Start from</span>
                  <select
                    aria-label="Test startup policy"
                    data-test-startup-policy
                    class="min-h-11 min-w-0 w-full cursor-pointer rounded-md border border-border-weak-base bg-surface-base px-2 text-base font-medium text-text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
                    value={startupValue()}
                    disabled={busy() || active() || finished() || props.checkingOffline}
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
                  <span data-test-startup-policy-detail class="text-caption/[1.4] text-text-weak">
                    {startup().mode === "verified-checkpoint"
                      ? "Mismatch stops for review. Relay never falls back to a cold relaunch."
                      : "Cold baseline runs the saved beginning. A new run must choose this policy again."}
                  </span>
                </label>
              ) : (
                <p
                  data-test-startup-policy
                  class="m-0 text-caption/[1.4] text-text-weak"
                  title={startupCopy().detail}
                >
                  Start from{" "}
                  <strong class="font-medium text-text-strong">{startupCopy().label}</strong>
                </p>
              )
            ) : null}
          </div>
        </details>
        <Button
          data-test-run-primary
          size="md"
          class="min-w-[11.5rem] shrink-0 justify-center"
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
    </div>
  );
}
