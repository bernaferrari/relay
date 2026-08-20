import { For, Show } from "solid-js";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { iosSemanticPlaneCopy, type IosLiveSemanticPlane } from "../lib/ios-live-semantic-plane";
import type { StageInspectionHint } from "../lib/stage-presentation";
import { Icon, type IconName } from "./icon";

type RuntimeTone = "ready" | "progress" | "attention";

type RuntimePlane = {
  id: "pixels" | "labels" | "input";
  label: string;
  value: string;
  detail: string;
  tone: RuntimeTone;
};

export type IosStageRuntimeAction = {
  kind: "take-control" | "open-xcode" | "refresh-labels" | "reconnect";
  /** A reconnect for the input lease deliberately takes a different path
   * from a reconnect for iOS accessibility proof. */
  source: "control" | "labels";
  label: string;
  detail: string;
  emphasis: "primary" | "secondary";
};

export type IosStageRuntimeStatusModel = {
  planes: RuntimePlane[];
  action?: IosStageRuntimeAction;
};

function labelsValue(plane: IosLiveSemanticPlane): string {
  switch (plane.state) {
    case "current":
      return "Verified";
    case "stale":
      return "Refreshing";
    case "unproven":
    case "in-flight":
      return "Reading";
    case "cooldown":
      return "Paused";
    case "unavailable":
      return "Unavailable";
  }
}

function labelsTone(plane: IosLiveSemanticPlane): RuntimeTone {
  if (plane.state === "current") return "ready";
  if (plane.state === "unavailable" || plane.state === "cooldown") return "attention";
  return "progress";
}

function labelsAction(
  hint: StageInspectionHint | null | undefined,
): IosStageRuntimeAction | undefined {
  if (!hint?.actionLabel) return undefined;
  const kind = hint.action ?? "reconnect";
  return {
    kind,
    source: "labels",
    label: hint.actionLabel,
    detail: hint.detail,
    emphasis: kind === "open-xcode" ? "primary" : "secondary",
  };
}

/**
 * Present each iPad runtime plane independently. A useful live picture is
 * never proof that labels or exclusive input are ready, and lack of labels
 * must never erase a view-only warning.
 */
export function iosStageRuntimeStatus(input: {
  pixelsAvailable: boolean;
  semanticPlane: IosLiveSemanticPlane;
  controlActive: boolean;
  controlIssue?: string | null;
  canTakeControl: boolean;
  inspectionHint?: StageInspectionHint | null;
}): IosStageRuntimeStatusModel {
  const semanticCopy = iosSemanticPlaneCopy(input.semanticPlane);
  const labelAction = labelsAction(input.inspectionHint);
  const labelDetail = input.inspectionHint?.detail ?? semanticCopy.detail;
  const controlIssue = input.controlIssue?.trim();
  const inputPlane: RuntimePlane = input.controlActive
    ? {
        id: "input",
        label: "Input",
        value: "Ready",
        detail: "This Relay window holds exclusive device input.",
        tone: "ready",
      }
    : controlIssue && input.canTakeControl
      ? {
          id: "input",
          label: "Input",
          value: "View only",
          detail: controlIssue,
          tone: "attention",
        }
      : controlIssue
        ? {
            id: "input",
            label: "Input",
            value: "Unavailable",
            detail: controlIssue,
            tone: "attention",
          }
        : {
            id: "input",
            label: "Input",
            value: "Not confirmed",
            detail: "Relay has not confirmed exclusive device input in this window.",
            tone: "progress",
          };

  // The primary action always removes the most material blocker. Xcode must
  // win over a lease takeover: a lease cannot make XCTest labels appear.
  const action =
    labelAction?.kind === "open-xcode"
      ? labelAction
      : controlIssue && input.canTakeControl
        ? {
            kind: "take-control" as const,
            source: "control" as const,
            label: "Take control",
            detail: controlIssue,
            emphasis: "primary" as const,
          }
        : controlIssue
          ? {
              kind: "reconnect" as const,
              source: "control" as const,
              label: "Reconnect",
              detail: controlIssue,
              emphasis: "secondary" as const,
            }
          : labelAction;

  return {
    planes: [
      {
        id: "pixels",
        label: "Preview",
        value: input.pixelsAvailable ? "Visible" : "Starting",
        detail: input.pixelsAvailable
          ? "Device pixels are available independently of labels and input."
          : "Relay is waiting for the first device pixels.",
        tone: input.pixelsAvailable ? "ready" : "progress",
      },
      {
        id: "labels",
        label: "Labels",
        value: labelsValue(input.semanticPlane),
        detail: labelDetail,
        tone: labelsTone(input.semanticPlane),
      },
      inputPlane,
    ],
    ...(action ? { action } : {}),
  };
}

function planeIcon(plane: RuntimePlane): IconName {
  if (plane.id === "pixels") return "smartphone";
  if (plane.id === "input") return plane.tone === "ready" ? "pointer" : "hand";
  if (plane.tone === "ready") return "check";
  return plane.tone === "progress" ? "refresh" : "alert";
}

function actionIcon(action: IosStageRuntimeAction): IconName {
  if (action.kind === "open-xcode") return "external";
  if (action.kind === "take-control") return "hand";
  return "refresh";
}

function busyActionLabel(action: IosStageRuntimeAction): string {
  if (action.kind === "take-control") return "Taking control…";
  if (action.kind === "open-xcode") return "Opening Xcode…";
  if (action.kind === "refresh-labels") return "Refreshing…";
  return "Reconnecting…";
}

/**
 * A low-height, fully visible runtime rail for a live physical iPad. It lives
 * below the device frame so information never obscures the app being tested.
 */
export function IosStageRuntimeStatus(props: {
  status: IosStageRuntimeStatusModel;
  busyForAction?: (action: IosStageRuntimeAction) => boolean;
  onAction?: (action: IosStageRuntimeAction) => void;
}) {
  const actionBusy = () => {
    const action = props.status.action;
    return action ? (props.busyForAction?.(action) ?? false) : false;
  };
  return (
    <section
      class="relative z-[2] mt-2 flex max-w-full justify-center px-2"
      data-ios-stage-runtime-status
      aria-label="iPad live status"
    >
      <div class="flex min-h-10 max-w-full flex-wrap items-center justify-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--surface-raised-base)_96%,transparent)] p-1 shadow-[0_1px_2px_rgb(0_0_0/6%),0_8px_18px_-14px_rgb(0_0_0/20%),inset_0_0_0_1px_var(--border-weak-base)]">
        <div
          class="flex min-h-8 max-w-full flex-wrap items-center justify-center gap-0.5"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <For each={props.status.planes}>
            {(plane) => (
              <span
                class={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-caption font-medium",
                  plane.tone === "ready" && "text-[var(--text-base)]",
                  plane.tone === "progress" && "text-[var(--text-weak)]",
                  plane.tone === "attention" && "text-[var(--text-strong)]",
                )}
                data-ios-stage-plane={plane.id}
                data-ios-stage-plane-tone={plane.tone}
                aria-label={`${plane.label}: ${plane.value}. ${plane.detail}`}
                data-tip={plane.detail}
              >
                <Icon
                  name={planeIcon(plane)}
                  size={12}
                  class={cn(
                    "shrink-0",
                    plane.tone === "ready" && "text-[var(--icon-success-base)]",
                    plane.tone === "progress" && "text-[var(--text-weak)]",
                    plane.tone === "attention" && "text-[var(--icon-warning-base)]",
                    plane.id === "labels" &&
                      plane.tone === "progress" &&
                      "ui-refresh-spin motion-reduce:animate-none motion-reduce:opacity-70",
                  )}
                />
                <span class="text-[var(--text-weak)]">{plane.label}</span>
                <span class="text-[var(--text-strong)]">{plane.value}</span>
              </span>
            )}
          </For>
        </div>
        <Show when={props.status.action}>
          {(action) => (
            <div class="flex min-h-8 shrink-0 items-center gap-1">
              <span class="h-5 w-px bg-border-weak-base" aria-hidden="true" />
              <Button
                type="button"
                size="sm"
                variant={action().emphasis}
                disabled={actionBusy()}
                aria-busy={actionBusy()}
                aria-label={`${action().label}. ${action().detail}`}
                data-ios-stage-action={action().kind}
                data-tip={action().detail}
                onClick={() => props.onAction?.(action())}
              >
                <Show when={actionBusy()} fallback={<Icon name={actionIcon(action())} size={12} />}>
                  <Icon
                    name="refresh"
                    size={12}
                    class="ui-refresh-spin motion-reduce:animate-none"
                  />
                </Show>
                {actionBusy() ? busyActionLabel(action()) : action().label}
              </Button>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
