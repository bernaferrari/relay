import { For, Show, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import { cn } from "../lib/cn";
import { checkedTargetsLabel, connectionStatusLabel } from "../lib/connection-presentation";
import { describeConnectionPath } from "../lib/connection-action-presentation";
import { copyDescription, copyStack, copyTitle } from "../lib/ui";
import { Icon } from "./icon";
import { ConnectionCaseStack, type ConnectionCaseStackProps } from "./connection-case-stack";

function RemovePathButton(props: { onClick: () => void }) {
  return (
    <div class="mt-1 border-t border-[var(--border-weak-base)] pt-1">
      <button
        type="button"
        class="flex min-h-10 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] font-medium text-[var(--icon-critical-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_8%,transparent)] active:scale-[0.98] motion-reduce:active:scale-100"
        onClick={props.onClick}
      >
        <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[color-mix(in_srgb,var(--icon-critical-base)_10%,transparent)]">
          <Icon name="trash" size={12} />
        </span>
        <span>Remove path</span>
      </button>
    </div>
  );
}

export function ConnectionInspector(props: {
  connection: CanvasConnection;
  sourceTitle: string;
  targetTitle: string;
  actionCount?: number;
  actions?: Array<{
    id: string;
    actionId: string;
    stepId?: string;
    label: string;
    waitMs?: number;
  }>;
  onChangeWait: (actionId: string, stepId: string | undefined, waitMs: number) => void;
  setup: {
    behaviors: Array<{ id: string; label: string; actionCount: number }>;
    onRecord: () => void;
    onBack: () => void;
    onAutomatic: () => void;
    onAttachBehavior: (recipeId: string) => void;
  };
  replay: {
    state: "idle" | "running" | "passed" | "failed";
    error?: string;
    canEditActions: boolean;
    onRun: () => void;
    onRewrite: () => void;
    onSaveReusable: () => void;
    onSelectStep: () => void;
  };
  cases: ConnectionCaseStackProps;
  onRemove: () => void;
  onClose: () => void;
}) {
  const pending = () => props.connection.state === "needs-recording";
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  const [caseStackOpen, setCaseStackOpen] = createSignal(false);
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const actionCount = () => props.actionCount ?? props.connection.stepIds.length;
  const verified = () => props.connection.review?.status === "verified";
  const failed = () => props.connection.review?.status === "failed";
  return (
    <aside
      data-app-map-connection-inspector
      class="absolute top-16 right-3 z-30 max-h-[calc(100%-144px)] w-[min(304px,calc(100%-24px))] overscroll-contain overflow-y-auto rounded-[13px] border border-[var(--border-weak-base)] bg-[color-mix(in_srgb,var(--background-base)_97%,transparent)] p-3 shadow-[var(--map-elevation-panel)] backdrop-blur-[14px] max-[720px]:top-auto max-[720px]:right-3 max-[720px]:bottom-[calc(72px+env(safe-area-inset-bottom))] max-[720px]:left-3 max-[720px]:max-h-[min(70%,540px)] max-[720px]:w-auto"
      onWheel={(event) => event.stopPropagation()}
    >
      <div class="flex items-center justify-between gap-3">
        <span class="text-[10px] font-medium text-[var(--text-weak)]">Path</span>
        <div class="flex items-center gap-1.5">
          <span
            class={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-medium",
              pending()
                ? "bg-surface-warning-weak text-text-warning-base"
                : verified()
                  ? "bg-surface-success-weak text-text-success-base"
                  : failed()
                    ? "bg-surface-critical-weak text-text-critical-base"
                    : props.connection.takeId || props.connection.videoTakeId
                      ? "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]"
                      : "bg-[var(--surface-base-hover)] text-[var(--text-base)]",
            )}
          >
            {pending() ? "Needs recording" : connectionStatusLabel(props.connection)}
          </span>
          <button
            type="button"
            class="grid size-10 place-items-center rounded-[8px] text-[var(--text-weak)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
            aria-label="Close path details"
            onClick={props.onClose}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      </div>
      <div class={cn(copyStack, "mt-1")}>
        <strong class={cn(copyTitle, "block text-[13px]")}>
          {props.sourceTitle} <span class="text-[var(--text-weak)]">→</span> {props.targetTitle}
        </strong>
        <p class={cn(copyDescription, "m-0 text-[11.5px]")}>
          {pending()
            ? "Record this path on the device, or choose another behavior below."
            : describeConnectionPath({
                sourceTitle: props.sourceTitle,
                targetTitle: props.targetTitle,
                actions: props.actions,
                mode: props.connection.mode,
              })}
        </p>
      </div>
      <Show when={!pending() && (props.actions?.length ?? 0) > 0}>
        <section class="mt-3 border-t border-[var(--border-weak-base)] pt-2">
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-1.5 text-left transition-colors duration-150 hover:bg-[var(--surface-base)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
            aria-expanded={actionsOpen()}
            onClick={() => setActionsOpen((value) => !value)}
          >
            <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--surface-base-hover)] text-[var(--text-base)]">
              <Icon name="command" size={11} />
            </span>
            <span class={cn(copyStack, "flex-1")}>
              <strong class={cn(copyTitle, "block text-[10.5px] font-medium")}>
                {actionCount()} action{actionCount() === 1 ? "" : "s"}
              </strong>
              <span class={cn(copyDescription, "block truncate text-[9.5px]")}>
                {props.actions?.[0]?.label}
              </span>
            </span>
            <span class="text-[9.5px] font-medium text-[var(--text-weak)]">
              {actionsOpen() ? "Hide" : "View"}
            </span>
          </button>
          <Show when={actionsOpen()}>
            <ol class="m-0 mt-1 grid list-none gap-1 rounded-[9px] bg-[var(--surface-base)] p-1.5">
              <For each={props.actions}>
                {(action, index) => (
                  <li class="grid min-h-10 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] px-2 text-[10px] text-[var(--text-base)]">
                    <span class="grid size-5 place-items-center rounded-[6px] bg-[var(--surface-base-hover)] font-mono text-[8.5px] tabular-nums text-[var(--text-weak)]">
                      {index() + 1}
                    </span>
                    <span class="min-w-0 leading-[1.25]">{action.label}</span>
                    <Show when={action.waitMs !== undefined}>
                      <label class="flex h-8 items-center rounded-[7px] bg-[var(--surface-base-hover)] px-2 text-[var(--text-weak)] focus-within:outline-2 focus-within:outline-[var(--border-focus)]">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={Number(((action.waitMs ?? 0) / 1_000).toFixed(2))}
                          aria-label="Pause duration in seconds"
                          class="w-10 border-0 bg-transparent p-0 text-right text-[10px] tabular-nums text-[var(--text-strong)] outline-none"
                          onChange={(event) =>
                            props.onChangeWait(
                              action.actionId,
                              action.stepId,
                              Number(event.currentTarget.value) * 1_000,
                            )
                          }
                        />
                        <span class="ml-1 text-[9px]">s</span>
                      </label>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </section>
      </Show>
      <ConnectionCaseStack
        {...props.cases}
        open={caseStackOpen()}
        onOpenChange={(open) => {
          setCaseStackOpen(open);
          if (open) setOptionsOpen(false);
        }}
      />
      <Show
        when={!pending() && (Boolean(props.connection.review) || props.replay.state !== "idle")}
      >
        <div class="mt-2 grid gap-1 border-t border-[var(--border-weak-base)] pt-2">
          <div class="flex min-h-8 items-center gap-2 px-0.5">
            <span
              class={cn(
                "grid size-6 shrink-0 place-items-center rounded-[7px]",
                failed()
                  ? "bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] text-[var(--icon-critical-base)]"
                  : verified()
                    ? "bg-[color-mix(in_srgb,var(--icon-success-base)_14%,transparent)] text-[var(--icon-success-base)]"
                    : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
              )}
            >
              <Icon name={failed() ? "alert" : verified() ? "check" : "scan"} size={11} />
            </span>
            <span class="min-w-0 flex-1">
              <strong class="block text-[10.5px] font-medium text-[var(--text-strong)]">
                Reach {props.targetTitle}
              </strong>
              <span class="block truncate text-[9.5px] text-[var(--text-weak)]">
                {checkedTargetsLabel(
                  props.connection.review?.targets,
                  props.connection.review?.status,
                )}
              </span>
            </span>
            <span class="text-[9.5px] font-medium text-[var(--text-weak)]">
              {verified() ? "Passed" : failed() ? "Changed" : "Not checked"}
            </span>
          </div>
          <For each={props.connection.review?.targets ?? []}>
            {(target) => (
              <div class="flex min-h-7 items-center gap-2 border-t border-[var(--border-weak-base)] px-1 pt-1 text-[9.5px]">
                <i
                  class={cn(
                    "size-1.5 rounded-full",
                    target.status === "passed"
                      ? "bg-[var(--icon-success-base)]"
                      : target.status === "failed"
                        ? "bg-[var(--icon-critical-base)]"
                        : "bg-[var(--icon-warning-base)]",
                  )}
                />
                <span class="min-w-0 flex-1 truncate text-[var(--text-base)]">
                  {target.targetName ?? target.targetId}
                </span>
                <span class="capitalize text-[var(--text-weak)]">
                  {target.status.replace("-", " ")}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={pending()}
        fallback={
          <div class="mt-3 grid gap-2">
            <Show when={props.replay.state === "failed" || failed()}>
              <div class="rounded-[8px] border border-[color-mix(in_srgb,var(--icon-critical-base)_28%,transparent)] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)] px-2.5 py-2 text-[9.5px]/[1.4] text-[var(--text-base)]">
                {props.replay.error ||
                  props.connection.review?.error ||
                  "The last replay did not reach the next screen."}
              </div>
            </Show>
            <Button
              variant="primary"
              size="lg"
              class="w-full"
              disabled={props.replay.state === "running"}
              onClick={props.replay.onRun}
            >
              <Icon
                name={
                  props.replay.state === "running" ? "refresh" : verified() ? "refresh" : "play"
                }
                size={11}
                class={
                  props.replay.state === "running" ? "animate-spin motion-reduce:animate-none" : ""
                }
              />
              {props.replay.state === "running"
                ? "Trying on device…"
                : verified()
                  ? "Run this path again"
                  : "Run this path"}
            </Button>
            <button
              type="button"
              class="flex min-h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[10.5px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
              aria-expanded={optionsOpen()}
              onClick={() =>
                setOptionsOpen((open) => {
                  const next = !open;
                  if (next) setCaseStackOpen(false);
                  return next;
                })
              }
            >
              <Icon name={optionsOpen() ? "chevron-down" : "chevron-right"} size={10} />
              <span>Path options</span>
            </button>
            <Show when={optionsOpen()}>
              <div class="grid gap-1 border-t border-[var(--border-weak-base)] pt-2">
                <Show when={props.replay.canEditActions}>
                  <button
                    type="button"
                    class="flex min-h-10 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] hover:bg-[var(--surface-base-hover)]"
                    onClick={props.replay.onSelectStep}
                  >
                    <Icon name="arrow-right" size={11} /> Edit steps
                  </button>
                </Show>
                <button
                  type="button"
                  class="flex min-h-10 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] hover:bg-[var(--surface-base-hover)]"
                  title="Throw away this take and capture the path again from the start screen"
                  onClick={props.replay.onRewrite}
                >
                  <Icon name="refresh" size={11} /> Recapture steps
                </button>
                <button
                  type="button"
                  class="flex min-h-10 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] hover:bg-[var(--surface-base-hover)]"
                  title="Reuse these steps from other paths"
                  onClick={props.replay.onSaveReusable}
                >
                  <Icon name="copy" size={11} /> Save for reuse
                </button>
                <Show when={props.connection.source === "authored"}>
                  <RemovePathButton onClick={props.onRemove} />
                </Show>
              </div>
            </Show>
          </div>
        }
      >
        <div class="mt-3 grid gap-2">
          <Button variant="primary" size="lg" class="w-full" onClick={props.setup.onRecord}>
            <Icon name="smartphone" size={12} /> Record on device
          </Button>
          <button
            type="button"
            class="flex min-h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[10.5px] font-medium text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
            aria-expanded={optionsOpen()}
            onClick={() =>
              setOptionsOpen((open) => {
                const next = !open;
                if (next) setCaseStackOpen(false);
                return next;
              })
            }
          >
            <Icon name={optionsOpen() ? "chevron-down" : "chevron-right"} size={10} />
            <span>Set path behavior</span>
          </button>
          <Show when={optionsOpen()}>
            <div class="grid gap-0 border-t border-[var(--border-weak-base)] pt-1.5">
              <button
                type="button"
                class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--surface-base-hover)]"
                onClick={props.setup.onBack}
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-base-hover)] text-[var(--text-interactive-base)]">
                  <Icon name="undo" size={11} />
                </span>
                <span class="grid min-w-0 gap-px">
                  <strong class="font-medium leading-[1.2] text-[var(--text-strong)]">
                    Back button
                  </strong>
                  <span class="text-[9.5px]/[1.25] text-[var(--text-weak)]">
                    Press Android or iOS Back
                  </span>
                </span>
              </button>
              <button
                type="button"
                class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--surface-base-hover)]"
                onClick={props.setup.onAutomatic}
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-base-hover)] text-[var(--text-interactive-base)]">
                  <Icon name="clock" size={11} />
                </span>
                <span class="grid min-w-0 gap-px">
                  <strong class="font-medium leading-[1.2] text-[var(--text-strong)]">
                    Wait for screen change
                  </strong>
                  <span class="text-[9.5px]/[1.25] text-[var(--text-weak)]">
                    For loading or automatic navigation
                  </span>
                </span>
              </button>
              <Show when={props.setup.behaviors.length > 0}>
                <span class="px-2 pt-1 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-weak)] uppercase">
                  Saved behaviors
                </span>
                <For each={props.setup.behaviors}>
                  {(behavior) => (
                    <button
                      type="button"
                      class="flex min-h-9 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] transition-colors hover:bg-[var(--surface-base-hover)]"
                      onClick={() => props.setup.onAttachBehavior(behavior.id)}
                    >
                      <span class="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-base-hover)] text-[var(--text-interactive-base)]">
                        <Icon name="copy" size={11} />
                      </span>
                      <span class="grid min-w-0 flex-1 gap-px">
                        <strong class="truncate font-medium leading-[1.2] text-[var(--text-strong)]">
                          {behavior.label}
                        </strong>
                        <span class="text-[9.5px]/[1.25] text-[var(--text-weak)]">
                          {behavior.actionCount} action{behavior.actionCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
              <Show when={props.connection.source === "authored"}>
                <RemovePathButton onClick={props.onRemove} />
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </aside>
  );
}
