import { For, Show, createEffect, createSignal } from "solid-js";
import { confirmAction } from "./confirm-dialog";
import type { AuthoringInteraction, CanvasScreen } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import type { TakeDestination } from "../lib/app-map-canvas-graph";
import type { RecordingTake } from "../context/recorder";
import { Icon } from "./icon";
import { AppMapToolbar } from "./app-map-toolbar";
import { TakeActionEditor } from "./take-action-editor";
import { TakeActionList } from "./take-action-list";

const primaryButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--product-accent-soft)] px-3 text-caption font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-hover hover:bg-[color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)] active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-35";
const secondaryButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-caption font-medium text-[var(--text-base)] transition-colors duration-press hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]";

/** Compact live status; stopped review moves into TakeReviewWorkspace. */
export function TakeCaptureBar(props: {
  take: RecordingTake;
  contextLabel?: string;
  onStop: () => void;
}) {
  const count = () => props.take.actions.length;
  const actionLabel = () =>
    count() === 0 ? "No actions yet" : `${count()} action${count() === 1 ? "" : "s"}`;
  return (
    <section class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-[var(--border-weak-base)] bg-[var(--surface-base)] px-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <i class="size-2 shrink-0 rounded-full bg-[var(--text-interactive-base)] motion-safe:animate-pulse" />
        <div class="min-w-0 text-micro/[1.35]">
          <strong class="block font-semibold text-[var(--text-strong)]">
            {props.contextLabel ? "Recording path" : "Recording"}
          </strong>
          <span class="block truncate text-[var(--text-weak)]">
            {props.contextLabel ? `${props.contextLabel} · ${actionLabel()}` : actionLabel()}
          </span>
        </div>
      </div>
      <button
        type="button"
        class="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] px-3 text-caption font-semibold text-[var(--icon-critical-base)] transition-[background-color,transform] duration-hover hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_20%,transparent)] active:scale-[0.96]"
        onClick={props.onStop}
      >
        <Icon name="square" size={10} /> Stop
      </button>
    </section>
  );
}

/** A stopped take is a decision, not a live-control state. The list decides
 * what survives and the player provides the immutable recorded frame. */
export type TakeReviewSidebarProps = {
  take: RecordingTake;
  selectedIndex: number;
  sourceTitle: string;
  screens: CanvasScreen[];
  destination: TakeDestination;
  onSelect: (index: number) => void;
  onDestination: (destination: TakeDestination) => void;
  onKeep: () => void;
  onDiscard: () => void;
  onReplay: () => void;
  onRewrite: () => void;
  onRemove: (index: number) => void | Promise<void>;
  onReorderActions?: (actionIds: string[]) => void | Promise<void>;
  onReplaceAction?: (actionId: string, interaction: AuthoringInteraction) => void | Promise<void>;
  onRemoveAction?: (actionId: string) => void | Promise<void>;
  onReviewInvalidated?: () => void;
  replayState: "idle" | "running" | "passed" | "failed";
  replayError?: string;
};

export function TakeReviewSidebar(props: TakeReviewSidebarProps) {
  const count = () => props.take.actions.length;
  const actionLabel = () => `${count()} timeline item${count() === 1 ? "" : "s"}`;
  const hasRecordedTiming = () =>
    props.take.actions.some((action) => action.label === "Recorded pause");
  const [selectedActionId, setSelectedActionId] = createSignal(
    props.take.actionIds[props.selectedIndex] ?? props.take.actions[0]?.id,
  );
  const [editingActionId, setEditingActionId] = createSignal<string>();
  const [pendingMutation, setPendingMutation] = createSignal(false);
  const [reviewInvalidated, setReviewInvalidated] = createSignal(false);
  const [replayStartedAfterMutation, setReplayStartedAfterMutation] = createSignal(false);
  const [mutationError, setMutationError] = createSignal<string>();
  let currentTakeId = props.take.id;
  let currentSelectedIndex = props.selectedIndex;
  let editTrigger: HTMLButtonElement | undefined;

  createEffect(() => {
    if (props.take.id !== currentTakeId) {
      currentTakeId = props.take.id;
      setEditingActionId(undefined);
      setPendingMutation(false);
      setReviewInvalidated(false);
      setReplayStartedAfterMutation(false);
      setMutationError(undefined);
      setSelectedActionId(props.take.actionIds[props.selectedIndex] ?? props.take.actions[0]?.id);
      currentSelectedIndex = props.selectedIndex;
      return;
    }
    if (props.selectedIndex === currentSelectedIndex) return;
    currentSelectedIndex = props.selectedIndex;
    const actionId = props.take.actionIds[props.selectedIndex];
    if (actionId) setSelectedActionId(actionId);
  });

  createEffect(() => {
    if (!reviewInvalidated()) return;
    if (props.replayState === "running") setReplayStartedAfterMutation(true);
    if (props.replayState === "passed" && replayStartedAfterMutation()) {
      setReviewInvalidated(false);
      setReplayStartedAfterMutation(false);
    }
  });

  const selectedAction = () => props.take.actions.find((action) => action.id === editingActionId());
  const canApprove = () =>
    props.replayState === "passed" && !reviewInvalidated() && !pendingMutation();
  const controlsDisabled = () => props.replayState === "running" || pendingMutation();

  function invalidateReview(): void {
    setReviewInvalidated(true);
    setReplayStartedAfterMutation(false);
    props.onReviewInvalidated?.();
  }

  async function mutate(work: () => void | Promise<void>): Promise<boolean> {
    if (controlsDisabled()) return false;
    setPendingMutation(true);
    setMutationError(undefined);
    try {
      await work();
      invalidateReview();
      return true;
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setPendingMutation(false);
    }
  }

  function selectAction(actionId: string): void {
    const action = props.take.actions.find((candidate) => candidate.id === actionId);
    if (!action) return;
    setSelectedActionId(action.id);
    if (action.steps.length > 0) props.onSelect(action.stepStartIndex);
  }

  function focusAction(actionId: string): void {
    const item = [...document.querySelectorAll<HTMLElement>("[data-action-id]")].find(
      (candidate) => candidate.dataset.actionId === actionId,
    );
    item?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }

  return (
    <aside
      class="flex min-h-0 min-w-0 flex-col border-r border-[var(--border-weak-base)] bg-[var(--background-base)] max-[760px]:border-r-0 max-[760px]:border-b"
      aria-label="Review captured actions"
    >
      <header class="shrink-0 border-b border-[var(--border-weak-base)] px-4 py-3.5">
        <span class="text-micro font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
          Path
        </span>
        <strong class="mt-1 block text-title font-semibold tracking-[-0.018em] text-[var(--text-strong)]">
          Review recording
        </strong>
        <p class="m-0 mt-1 text-caption/[1.45] text-[var(--text-weak)]">
          {actionLabel()} from {props.sourceTitle}. Edit the steps, replay them on the device, then
          approve what worked.
        </p>
      </header>

      <div class="min-h-0 flex-1 overflow-auto px-2.5 py-2.5">
        <Show
          when={count() > 0}
          fallback={
            <div class="grid gap-2 rounded-xl bg-[var(--surface-base)] px-4 py-3">
              <p class="m-0 text-caption leading-relaxed font-medium text-[var(--text-strong)]">
                Nothing was tapped
              </p>
              <p class="m-0 text-caption leading-relaxed text-[var(--text-weak)]">
                Only the screen change was kept. Recapture steps if this path needs taps, swipes, or
                typing.
              </p>
            </div>
          }
        >
          <TakeActionList
            actions={props.take.actions}
            selectedActionId={selectedActionId()}
            editingActionId={editingActionId()}
            disabled={controlsDisabled()}
            onSelect={(action) => selectAction(action.id)}
            {...(props.onReplaceAction
              ? {
                  onEdit: (
                    action: (typeof props.take.actions)[number],
                    trigger: HTMLButtonElement,
                  ) => {
                    editTrigger = trigger;
                    selectAction(action.id);
                    setEditingActionId((current) =>
                      current === action.id ? undefined : action.id,
                    );
                  },
                }
              : {})}
            {...(props.onReorderActions
              ? {
                  onReorder: async (actionIds: string[]) => {
                    await mutate(() => props.onReorderActions?.(actionIds));
                  },
                }
              : {})}
            {...(props.onRemoveAction ||
            props.take.actions.every((action) => action.steps.length === 1)
              ? {
                  onRemove: async (action: (typeof props.take.actions)[number]) => {
                    const actionIndex = props.take.actions.findIndex(
                      (candidate) => candidate.id === action.id,
                    );
                    const remaining = props.take.actions.filter(
                      (candidate) => candidate.id !== action.id,
                    );
                    const nextAction = remaining[Math.min(actionIndex, remaining.length - 1)];
                    const removed = await mutate(() =>
                      props.onRemoveAction
                        ? props.onRemoveAction(action.id)
                        : props.onRemove(action.stepStartIndex),
                    );
                    if (!removed) return;
                    setEditingActionId(undefined);
                    if (nextAction) {
                      selectAction(nextAction.id);
                      queueMicrotask(() => focusAction(nextAction.id));
                    }
                  },
                }
              : {})}
          />
          <Show when={hasRecordedTiming()}>
            <div class="mt-2 flex items-start gap-2 rounded-lg bg-[var(--surface-base)] px-3 py-2.5 text-micro/[1.45] text-[var(--text-weak)]">
              <Icon name="clock" size={12} class="mt-0.5 shrink-0" />
              <span>
                Pauses are saved as Wait steps. Shorten or remove any pause that makes replay feel
                slow.
              </span>
            </div>
          </Show>
          <Show when={props.onReplaceAction ? selectedAction() : undefined}>
            {(action) => (
              <TakeActionEditor
                action={action()}
                pending={pendingMutation()}
                onCancel={() => {
                  setEditingActionId(undefined);
                  queueMicrotask(() => editTrigger?.focus({ preventScroll: true }));
                }}
                onSave={async (interaction) => {
                  const saved = await mutate(() =>
                    props.onReplaceAction?.(action().id, interaction),
                  );
                  if (!saved) return;
                  setEditingActionId(undefined);
                  queueMicrotask(() => editTrigger?.focus({ preventScroll: true }));
                }}
              />
            )}
          </Show>
        </Show>
        <section class="mt-4 border-t border-[var(--border-weak-base)] px-1 pt-3">
          <span class="block text-micro font-semibold tracking-[0.11em] text-[var(--text-weak)] uppercase">
            Where it goes
          </span>
          <span class="mt-1 block text-micro text-[var(--text-weak)]">
            Starts on <span class="font-medium text-[var(--text-base)]">{props.sourceTitle}</span>
          </span>
          <label class="mt-2 grid gap-1.5 text-caption font-medium text-[var(--text-base)]">
            Ends on
            <select
              class="h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2 text-caption text-[var(--text-strong)] outline-none transition-colors focus:border-[var(--text-interactive-base)]"
              value={
                props.destination.kind === "new-screen"
                  ? "new"
                  : props.destination.kind === "end"
                    ? "end"
                    : `screen:${props.destination.screenId}`
              }
              disabled={controlsDisabled()}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "new") props.onDestination({ kind: "new-screen" });
                else if (value === "end") props.onDestination({ kind: "end" });
                else
                  props.onDestination({
                    kind: "screen",
                    screenId: value.slice("screen:".length),
                  });
                invalidateReview();
              }}
            >
              <option value="new">Create a screen from this capture</option>
              <For each={props.screens}>
                {(screen) => <option value={`screen:${screen.id}`}>{screen.title}</option>}
              </For>
              <option value="end">Finish here · no next screen</option>
            </select>
          </label>
        </section>
        <Show when={mutationError()}>
          {(message) => (
            <section
              class="mt-3 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--icon-critical-base)_35%,transparent)] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)] px-3 py-2.5 text-micro/[1.45] text-[var(--icon-critical-base)]"
              role="alert"
            >
              <Icon name="alert" size={12} class="mt-0.5 shrink-0" />
              <span>That change was not saved. {message()}</span>
            </section>
          )}
        </Show>
        <section
          class={cn(
            "mt-3 rounded-xl border px-3 py-2.5",
            canApprove()
              ? "border-[color-mix(in_srgb,var(--icon-success-base)_35%,transparent)] bg-[color-mix(in_srgb,var(--icon-success-base)_8%,transparent)]"
              : props.replayState === "failed"
                ? "border-[color-mix(in_srgb,var(--icon-critical-base)_35%,transparent)] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)]"
                : "border-[var(--border-weak-base)] bg-[var(--surface-base)]",
          )}
        >
          <div class="flex items-center gap-2">
            <Icon
              name={canApprove() ? "check" : props.replayState === "failed" ? "alert" : "play"}
              size={12}
              class={
                canApprove()
                  ? "text-[var(--icon-success-base)]"
                  : props.replayState === "failed"
                    ? "text-[var(--icon-critical-base)]"
                    : "text-[var(--text-interactive-base)]"
              }
            />
            <strong class="text-micro font-semibold text-[var(--text-strong)]">
              {pendingMutation()
                ? "Saving change…"
                : canApprove()
                  ? "Looks good on device"
                  : props.replayState === "failed"
                    ? "Couldn’t finish the replay"
                    : reviewInvalidated()
                      ? "Check your edits on device"
                      : props.replayState === "running"
                        ? "Playing on the device…"
                        : "Ready when you are"}
            </strong>
          </div>
          <p class="m-0 mt-1 text-micro/[1.45] text-[var(--text-weak)]">
            {pendingMutation()
              ? "Saving your edit before Relay can try it on the device."
              : canApprove()
                ? "If the device reached the right place, approve this path as a Test."
                : props.replayState === "failed"
                  ? props.replayError ||
                    `Put the device back on “${props.sourceTitle}”, then try the steps again.`
                  : reviewInvalidated()
                    ? "You changed the timeline. Try it once on the device so Relay can confirm the new steps before you keep them."
                    : `These steps already ran while you recorded. Replay them from “${props.sourceTitle}” before approving the path.`}
          </p>
        </section>
      </div>

      <footer class="grid shrink-0 gap-2 border-t border-[var(--border-weak-base)] p-3">
        <button
          type="button"
          class={cn(primaryButton, "justify-center")}
          disabled={props.replayState === "running" || pendingMutation()}
          onClick={() => (canApprove() ? props.onKeep() : props.onReplay())}
        >
          <Icon
            name={canApprove() ? "check" : props.replayState === "running" ? "refresh" : "play"}
            size={12}
            class={
              props.replayState === "running"
                ? "animate-[spin_900ms_linear_infinite] motion-reduce:animate-none"
                : ""
            }
          />
          {canApprove()
            ? "Approve path"
            : props.replayState === "running"
              ? "Replaying…"
              : props.replayState === "failed"
                ? "Replay again"
                : reviewInvalidated()
                  ? "Replay edited path"
                  : "Replay path"}
        </button>
        <div class="flex items-center justify-between gap-2">
          <button
            type="button"
            class={secondaryButton}
            title="Leave review without saving this recording"
            onClick={() =>
              confirmAction({
                title: "Leave this recording?",
                body: "Your captured steps will be discarded. The rest of the map stays as it is.",
                confirmLabel: "Leave without saving",
                tone: "destructive",
                onConfirm: props.onDiscard,
              })
            }
          >
            <Icon name="chevron-left" size={12} /> Back
          </button>
          <button
            type="button"
            class={secondaryButton}
            title="Throw away these steps and capture the path again from the start screen"
            onClick={() =>
              confirmAction({
                title: "Recapture from the start?",
                body: `This throws away the current timeline and starts a fresh recording from “${props.sourceTitle}”. Nothing is added to the map until you approve a new take.`,
                confirmLabel: "Recapture steps",
                tone: "destructive",
                onConfirm: props.onRewrite,
              })
            }
          >
            <Icon name="refresh" size={11} /> Recapture steps
          </button>
        </div>
      </footer>
    </aside>
  );
}

export function AppMapEmptyState(props: {
  take: RecordingTake | null;
  recordState:
    | "ready"
    | "choose-device"
    | "checking-ios"
    | "preparing-ios"
    | "preparing-screen"
    | "setup-ios"
    | "enable-developer-mode"
    | "capture-error"
    | "device-unavailable";
  selectedDeviceName?: string;
  deviceOpen: boolean;
  deviceSelected: boolean;
  liveScreenSrc?: string;
  captureBusy: boolean;
  onStartRecording: () => void;
  onAddNote: () => void;
  onToggleDevice: () => void;
}) {
  const isRecording = () => props.take?.state === "recording";
  const count = () => props.take?.steps.length ?? 0;
  const guidance = () => {
    if (isRecording()) {
      return {
        title: "Do the steps on the device",
        detail: `${count()} step${count() === 1 ? "" : "s"} so far. Stop when you reach the screen you want to keep.`,
      };
    }
    if (props.take) {
      return {
        title: "Review what you captured",
        detail: "Edit the timeline, try it once on the device, then keep it on the map.",
      };
    }
    if (!props.deviceOpen) {
      return {
        title: "Show the live device",
        detail:
          "Show the live device, go to a starting screen, then record the path — or save a screenshot to the map.",
      };
    }
    switch (props.recordState) {
      case "choose-device":
        return {
          title: "Choose a device first",
          detail: "Pick a phone or simulator, then open the screen where this path should start.",
        };
      case "setup-ios":
      case "enable-developer-mode":
      case "capture-error":
        return {
          title: "Finish setup in the device panel",
          detail: "Once the iPad is ready, you can record steps or capture screenshots from here.",
        };
      case "checking-ios":
      case "preparing-ios":
      case "preparing-screen":
        return {
          title: "Getting the device ready",
          detail: `Keep ${props.selectedDeviceName ?? "the device"} unlocked. Recording unlocks when the screen is live.`,
        };
      case "device-unavailable":
        return {
          title: "Reconnect the device",
          detail: "Plug it back in or wake it. Relay continues as soon as it is available.",
        };
      default:
        return {
          title: "Record the next path",
          detail: `Navigate ${props.selectedDeviceName ?? "the device"} to the start, then record taps — or save a screenshot to the map.`,
        };
    }
  };
  return (
    <>
      <Show when={!props.deviceOpen || isRecording() || props.take}>
        <div
          class={cn(
            "absolute inset-y-0 left-0 z-[1] grid place-items-center px-6 max-[760px]:right-0",
            props.deviceOpen && "max-[900px]:hidden",
          )}
          style={{ right: props.deviceOpen && props.deviceSelected ? "min(420px, 50vw)" : "0" }}
        >
          <section class="grid w-[min(390px,calc(100vw-48px))] justify-items-center text-center">
            <h2 class="m-0 text-balance text-display/[1.25] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
              {guidance().title}
            </h2>
            <p class="m-0 mt-1.5 max-w-[40ch] text-pretty text-body/[1.5] text-[var(--text-weak)]">
              {guidance().detail}
            </p>
            <Show when={!props.take}>
              <div class="mt-4 flex min-h-11 flex-wrap items-center justify-center gap-2">
                <Show when={props.recordState !== "ready"}>
                  <span class="inline-flex items-center gap-2 text-caption text-[var(--text-weak)]">
                    <i class="size-1.5 rounded-full bg-[var(--icon-warning-base)] motion-safe:animate-pulse" />
                    {props.recordState === "choose-device"
                      ? "Waiting for a device"
                      : props.recordState === "device-unavailable"
                        ? "Device unavailable"
                        : props.recordState === "setup-ios" ||
                            props.recordState === "enable-developer-mode"
                          ? "Setup needed"
                          : props.deviceOpen
                            ? "Connecting…"
                            : "Press D to show the device"}
                  </span>
                </Show>
                <Show when={props.recordState === "ready"}>
                  <Button
                    variant="primary"
                    size="lg"
                    class="min-w-[148px] shrink-0"
                    disabled={props.captureBusy}
                    aria-busy={props.captureBusy}
                    onClick={props.onStartRecording}
                  >
                    <Icon
                      name={props.captureBusy ? "refresh" : "circle"}
                      size={13}
                      class={props.captureBusy ? "ui-refresh-spin motion-reduce:opacity-70" : ""}
                    />
                    {props.captureBusy ? "Preparing…" : "Record path"}
                  </Button>
                </Show>
              </div>
            </Show>
          </section>
        </div>
      </Show>
      <AppMapToolbar
        mode="blank"
        tool="select"
        deviceOpen={props.deviceOpen}
        shiftForDevice={Boolean(props.deviceOpen && props.deviceSelected)}
        wideDevice={false}
        explorationState="idle"
        explorationCount={0}
        onToolChange={() => undefined}
        onAddNote={props.onAddNote}
        onExplore={() => undefined}
        onToggleDevice={props.onToggleDevice}
      />
    </>
  );
}
