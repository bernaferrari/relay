import { Show, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import type {
  FirstTestChecklistState,
  FirstTestStage,
  FirstTestTargetStatus,
} from "../lib/onboarding";
import { Icon } from "./icon";

type TargetCheck = {
  state: "idle" | "checking" | "passed" | "failed";
  detail?: string;
};

export type FirstTestChecklistProps = {
  /** Derived by the shell from the current target, map, Test, and reports. */
  state: FirstTestChecklistState;
  targetCheck: TargetCheck;
  starterAvailable: boolean;
  creatingStarter?: "screen-check" | "blank" | null;
  canSaveStartScreen: boolean;
  onTargetAction: () => void;
  onShowLiveDevice: () => void;
  /** Rail presentation: a narrow column beside the live-device stage, so the
   * capture-stage guidance survives opening the device instead of unmounting. */
  rail?: boolean;
  onSaveStartScreen: () => void;
  onCreateStarter: (kind: "screen-check" | "blank") => void;
  onRecord: () => void;
  onImportYaml: (yaml: string) => Promise<void> | void;
  onOpenTest: () => void;
  onOpenReport: (id: string) => void;
  onExportYaml: () => void;
  onDismiss: (reason: "dismissed" | "completed") => void;
};

function targetCheckTone(check: TargetCheck): string {
  if (check.state === "passed") return "text-[var(--text-success-base)]";
  if (check.state === "failed") return "text-[var(--text-critical-base)]";
  return "text-[var(--text-weak)]";
}

function targetCheckIcon(check: TargetCheck): "check" | "alert" | "refresh" | "info" {
  if (check.state === "passed") return "check";
  if (check.state === "failed") return "alert";
  if (check.state === "checking") return "refresh";
  return "info";
}

function targetActionLabel(target: FirstTestTargetStatus): string {
  return target.kind === "ready" ? "Check Device" : target.actionLabel;
}

const STAGE_NUMBER: Record<Exclude<FirstTestStage, "complete">, number> = {
  target: 1,
  capture: 2,
  author: 3,
  run: 4,
};

function progressLabel(stage: FirstTestStage): string {
  return stage === "complete" ? "Complete" : `Step ${STAGE_NUMBER[stage]} of 4`;
}

function stageTitle(state: FirstTestChecklistState): string {
  if (state.stage === "target") return state.target.title;
  if (state.stage === "capture") return "Capture the starting state";
  if (state.stage === "author") return "Choose a first Test";
  if (state.stage === "complete") return "First Test saved";
  return state.latestRun ? "Review the last run" : "Review your Test";
}

/**
 * A compact, resumable path into the existing App Map/Test workflow. It owns
 * no progress state: callers advance it only when Relay's server-backed data
 * changes. In particular, none of these buttons starts a run implicitly.
 */
export function FirstTestChecklist(props: FirstTestChecklistProps) {
  let importInput: HTMLInputElement | undefined;
  const [importIssue, setImportIssue] = createSignal("");

  async function importSelectedFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setImportIssue("");
    try {
      await props.onImportYaml(await file.text());
    } catch {
      // The shell already gives the product-specific parse failure a toast.
      // This is only a local, accessible fallback for a host file-read issue.
      setImportIssue(
        "Relay could not read that file. Choose an advanced YAML export and try again.",
      );
    }
  }

  const dismiss = () =>
    props.onDismiss(props.state.stage === "complete" ? "completed" : "dismissed");

  return (
    <section
      class={cn(
        "first-test-checklist rounded-xl border border-[var(--map-divider)] bg-[var(--map-control-surface)] p-3.5 text-left shadow-[var(--map-elevation-control)]",
        props.rail ? "w-[min(100%,320px)]" : "min-w-0 w-[min(100%,340px)]",
      )}
      aria-labelledby="first-test-checklist-title"
    >
      <header class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <p
            class="m-0 text-micro font-medium text-[var(--text-weaker)]"
            aria-label={`First useful Test progress: ${progressLabel(props.state.stage)}`}
          >
            First Test · {progressLabel(props.state.stage)}
          </p>
          <h2
            id="first-test-checklist-title"
            class="mt-1 mb-0 text-body/[1.25] font-semibold text-[var(--text-strong)]"
          >
            {stageTitle(props.state)}
          </h2>
        </div>
        <button
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Hide first useful test guide"
          data-tip="Hide guide"
          onClick={dismiss}
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      <div class="mt-3 border-t border-[var(--map-divider)] pt-3">
        <Show when={props.state.stage === "target"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                {props.state.target.detail}
              </p>
            </div>
            <Show when={props.targetCheck.state !== "idle"}>
              <p
                class={`m-0 flex items-start gap-1.5 text-caption/[1.45] ${targetCheckTone(props.targetCheck)}`}
                role="status"
                aria-live="polite"
              >
                <Icon
                  name={targetCheckIcon(props.targetCheck)}
                  size={13}
                  class={props.targetCheck.state === "checking" ? "ui-refresh-spin" : undefined}
                />
                <span>{props.targetCheck.detail ?? "Checking this target…"}</span>
              </p>
            </Show>
            <Button
              variant="primary"
              size="lg"
              class="w-full"
              disabled={props.targetCheck.state === "checking"}
              aria-busy={props.targetCheck.state === "checking"}
              onClick={props.onTargetAction}
            >
              <Icon
                name={props.targetCheck.state === "checking" ? "refresh" : "smartphone"}
                size={14}
                class={props.targetCheck.state === "checking" ? "ui-refresh-spin" : undefined}
              />
              {props.targetCheck.state === "checking"
                ? "Checking target…"
                : targetActionLabel(props.state.target)}
            </Button>
          </div>
        </Show>

        <Show when={props.state.stage === "capture"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                Relay keeps this first frame as visible evidence and can use it as a Checkpoint.
                Nothing is captured until you choose this action.
              </p>
            </div>
            <Show
              when={props.canSaveStartScreen}
              fallback={
                <Button variant="primary" size="lg" class="w-full" onClick={props.onShowLiveDevice}>
                  <Icon name="smartphone" size={14} /> Show live device
                </Button>
              }
            >
              <Button variant="primary" size="lg" class="w-full" onClick={props.onSaveStartScreen}>
                <Icon name="camera" size={14} /> Capture starting state
              </Button>
            </Show>
          </div>
        </Show>

        <Show when={props.state.stage === "author"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                Start with a safe visible-screen check, or bring an existing path. Creating a Test
                never runs it.
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              class="w-full"
              disabled={!props.starterAvailable || Boolean(props.creatingStarter)}
              aria-busy={props.creatingStarter === "screen-check"}
              onClick={() => props.onCreateStarter("screen-check")}
            >
              <Show
                when={props.creatingStarter === "screen-check"}
                fallback={<Icon name="check" size={14} />}
              >
                <Icon name="refresh" size={14} class="ui-refresh-spin" />
              </Show>
              {props.creatingStarter === "screen-check"
                ? "Creating check…"
                : "Check starting state"}
            </Button>
            <Show when={!props.starterAvailable}>
              <p class="-mt-1 mb-0 text-caption/[1.45] text-[var(--text-weaker)]">
                Capture the starting state before creating this safe starter.
              </p>
            </Show>
            <Button
              variant="secondary"
              size="lg"
              class="w-full"
              disabled={Boolean(props.creatingStarter)}
              aria-busy={props.creatingStarter === "blank"}
              onClick={() => props.onCreateStarter("blank")}
            >
              <Icon
                name={props.creatingStarter === "blank" ? "refresh" : "plus"}
                size={14}
                class={props.creatingStarter === "blank" ? "ui-refresh-spin" : undefined}
              />
              {props.creatingStarter === "blank" ? "Creating Test…" : "Start a blank Test"}
            </Button>
            <div class="grid grid-cols-2 gap-2">
              <Button variant="ghost" size="sm" onClick={props.onRecord}>
                <Icon name="video" size={13} /> Record Test
              </Button>
              <Button variant="ghost" size="sm" onClick={() => importInput?.click()}>
                <Icon name="upload" size={13} /> Import advanced YAML
              </Button>
            </div>
            <input
              ref={(element) => {
                importInput = element;
              }}
              class="sr-only"
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml"
              aria-label="Choose advanced YAML export"
              onChange={(event) => void importSelectedFile(event)}
            />
            <Show when={importIssue()}>
              <p class="m-0 text-caption text-[var(--text-critical-base)]" role="alert">
                {importIssue()}
              </p>
            </Show>
          </div>
        </Show>

        <Show when={props.state.stage === "run"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                <Show
                  when={props.state.latestRun}
                  fallback="Open the Test to review its exact screen evidence, then use its Run button when you are ready."
                >
                  Relay saved this report. Review it before changing the Test or choosing another
                  run.
                </Show>
              </p>
            </div>
            <Show
              when={props.state.latestRun}
              fallback={
                <Button variant="primary" size="lg" class="w-full" onClick={props.onOpenTest}>
                  <Icon name="play" size={14} /> Review and run Test
                </Button>
              }
            >
              <Button
                variant="primary"
                size="lg"
                class="w-full"
                onClick={() => props.onOpenReport(props.state.latestRun!.id)}
              >
                <Icon name="folder" size={14} /> Open report
              </Button>
            </Show>
            <Button variant="secondary" size="lg" class="w-full" onClick={props.onOpenTest}>
              <Icon name="edit" size={14} /> Edit Test
            </Button>
          </div>
        </Show>

        <Show when={props.state.stage === "complete"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                This completion comes from the saved report, not from a local checklist. Keep the
                Test, inspect its evidence, or export advanced YAML for review.
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              class="w-full"
              onClick={() => props.onOpenReport(props.state.completedRun!.id)}
            >
              <Icon name="folder" size={14} /> Open saved Report
            </Button>
            <div class="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={props.onOpenTest}>
                <Icon name="edit" size={13} /> Edit Test
              </Button>
              <Button variant="secondary" size="sm" onClick={props.onExportYaml}>
                <Icon name="download" size={13} /> Export YAML
              </Button>
            </div>
          </div>
        </Show>
      </div>

      <footer class="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {props.state.stage === "complete" ? "Hide guide" : "Not now"}
        </Button>
      </footer>
    </section>
  );
}
