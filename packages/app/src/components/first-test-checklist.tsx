import { For, Show, createSignal } from "solid-js";
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

const STEPS: Array<{ id: FirstTestStage; label: string }> = [
  { id: "target", label: "Check target" },
  { id: "capture", label: "Save a screen" },
  { id: "author", label: "Create a Test" },
  { id: "run", label: "Review and run" },
];

function stepIsDone(state: FirstTestChecklistState, step: FirstTestStage): boolean {
  if (step === "target") return state.targetReady;
  if (step === "capture") return state.screenSaved;
  if (step === "author") return state.testCreated && state.testReady;
  return Boolean(state.completedRun);
}

function stepStatus(
  state: FirstTestChecklistState,
  step: FirstTestStage,
): "done" | "current" | "upcoming" {
  if (stepIsDone(state, step)) return "done";
  return state.stage === step ? "current" : "upcoming";
}

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
  return target.kind === "ready" ? "Check target" : target.actionLabel;
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
      setImportIssue("Relay could not read that file. Choose a YAML map and try again.");
    }
  }

  const dismiss = () =>
    props.onDismiss(props.state.stage === "complete" ? "completed" : "dismissed");

  return (
    <section
      class={cn(
        "first-test-checklist rounded-2xl border border-[var(--map-divider)] bg-[var(--map-control-surface)] p-4 text-left shadow-[var(--map-elevation-panel)]",
        props.rail ? "w-[min(100%,320px)]" : "min-w-0 w-[min(100%,390px)]",
      )}
      aria-labelledby="first-test-checklist-title"
    >
      <header class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="m-0 text-micro font-semibold tracking-[0.08em] text-[var(--text-weaker)] uppercase">
            First useful test
          </p>
          <h2
            id="first-test-checklist-title"
            class="mt-1 mb-0 text-body/[1.25] font-semibold text-[var(--text-strong)]"
          >
            Build it from a real screen
          </h2>
        </div>
        <button
          type="button"
          class="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Hide first useful test guide"
          data-tip="Hide guide"
          onClick={dismiss}
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      <ol
        class={cn(
          "mt-4 mb-0 grid list-none gap-1 p-0",
          props.rail ? "grid-cols-1 gap-1.5" : "grid-cols-4",
        )}
        aria-label="First useful test progress"
      >
        <For each={STEPS}>
          {(step) => {
            const status = () => stepStatus(props.state, step.id);
            return (
              <li
                class="min-w-0"
                classList={{ "flex items-center gap-2": props.rail }}
              >
                <div class="flex items-center gap-1">
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded-full border text-micro"
                    classList={{
                      "border-[var(--icon-success-base)] bg-[var(--surface-success-weak)] text-[var(--icon-success-base)]":
                        status() === "done",
                      "border-[var(--border-focus)] bg-[var(--surface-base-hover)] text-[var(--text-strong)]":
                        status() === "current",
                      "border-[var(--map-divider)] text-[var(--text-weaker)]":
                        status() === "upcoming",
                    }}
                    aria-hidden="true"
                  >
                    <Show when={status() === "done"} fallback={STEPS.indexOf(step) + 1}>
                      <Icon name="check" size={12} />
                    </Show>
                  </span>
                  <Show when={STEPS.indexOf(step) < STEPS.length - 1}>
                    <span
                      class="h-px min-w-0 flex-1 bg-[var(--map-divider)]"
                      classList={{ "bg-[var(--icon-success-base)]": status() === "done" }}
                    />
                  </Show>
                </div>
                <span
                  class={cn(
                    "truncate text-micro font-medium",
                    props.rail ? "" : "mt-1.5 block",
                  )}
                  classList={{
                    "text-[var(--text-strong)]": status() !== "upcoming",
                    "text-[var(--text-weaker)]": status() === "upcoming",
                  }}
                >
                  {step.label}
                </span>
              </li>
            );
          }}
        </For>
      </ol>

      <div class="mt-4 border-t border-[var(--map-divider)] pt-4">
        <Show when={props.state.stage === "target"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <h3 class="m-0 text-caption font-semibold text-[var(--text-strong)]">
                {props.state.target.title}
              </h3>
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
              <h3 class="m-0 text-caption font-semibold text-[var(--text-strong)]">
                Save the starting screen
              </h3>
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                Relay uses the screen you save as visible evidence. Nothing is captured until you
                choose this action.
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
                <Icon name="camera" size={14} /> Save start screen
              </Button>
            </Show>
          </div>
        </Show>

        <Show when={props.state.stage === "author"}>
          <div class="grid gap-3">
            <div class="grid gap-1">
              <h3 class="m-0 text-caption font-semibold text-[var(--text-strong)]">
                Choose a first Test
              </h3>
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
              {props.creatingStarter === "screen-check" ? "Creating check…" : "Check saved screen"}
            </Button>
            <Show when={!props.starterAvailable}>
              <p class="-mt-1 mb-0 text-caption/[1.45] text-[var(--text-weaker)]">
                Save a screen with a stable identity to create this safe starter.
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
                <Icon name="video" size={13} /> Record a path
              </Button>
              <Button variant="ghost" size="sm" onClick={() => importInput?.click()}>
                <Icon name="upload" size={13} /> Import map YAML
              </Button>
            </div>
            <input
              ref={(element) => {
                importInput = element;
              }}
              class="sr-only"
              type="file"
              accept=".yaml,.yml,application/yaml,text/yaml"
              aria-label="Choose map YAML file"
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
              <h3 class="m-0 text-caption font-semibold text-[var(--text-strong)]">
                <Show when={props.state.latestRun} fallback="Review your Test">
                  The last run needs attention
                </Show>
              </h3>
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
              <h3 class="m-0 text-caption font-semibold text-[var(--text-strong)]">
                First Test report saved
              </h3>
              <p class="m-0 text-caption/[1.5] text-[var(--text-weak)]">
                This completion comes from the saved report, not from a local checklist. Keep the
                Test, inspect its evidence, or export the map for review.
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              class="w-full"
              onClick={() => props.onOpenReport(props.state.completedRun!.id)}
            >
              <Icon name="folder" size={14} /> Open saved report
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

      <footer class="mt-4 flex justify-end border-t border-[var(--map-divider)] pt-3">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          {props.state.stage === "complete" ? "Hide guide" : "Not now"}
        </Button>
      </footer>
    </section>
  );
}
