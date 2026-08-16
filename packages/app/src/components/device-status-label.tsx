import { Show } from "solid-js";
import { cn } from "../lib/cn";
import type { DeviceReadiness } from "../lib/device-readiness";
import { Icon } from "./icon";

export type AppMapDeviceStatus = {
  label: string;
  kind: "idle" | "progress" | "ready" | "recording" | "info" | "view-only" | "attention";
  detail?: string;
};

/** Convert readiness into one mutually exclusive status. Keeping this here
 * prevents the empty map and an authored map from describing the same target
 * differently. */
export function appMapDeviceStatus(input: {
  readiness: DeviceReadiness;
  deviceSelected: boolean;
  serverOnline: boolean;
  discovering?: boolean;
  recording?: boolean;
  controlReady?: boolean;
  controlIssue?: string | null;
  controlTakeoverAvailable?: boolean;
}): AppMapDeviceStatus {
  if (input.recording) return { label: "Recording", kind: "recording" };
  if (!input.deviceSelected && input.serverOnline && input.discovering) {
    return { label: "Looking for devices", kind: "progress" };
  }
  if (!input.deviceSelected) return { label: "Device", kind: "idle" };
  if (!input.serverOnline) return { label: "Relay offline", kind: "attention" };
  switch (input.readiness.kind) {
    case "ready":
      if (input.controlIssue)
        return {
          label: "View only",
          kind: input.controlTakeoverAvailable ? "view-only" : "attention",
          detail: input.controlIssue,
        };
      if (input.controlReady === false) return { label: "Connecting control", kind: "progress" };
      return { label: "Live", kind: "ready" };
    case "checking-ios":
      return { label: "Checking device", kind: "progress" };
    case "ios-preparing":
      return { label: "Preparing device", kind: "progress" };
    case "screen-preparing":
      return { label: "Starting live view", kind: "progress" };
    case "device-unavailable":
      return { label: "Device unavailable", kind: "attention" };
    case "capture-error":
      return { label: "Screen unavailable", kind: "attention" };
    case "ios-developer-mode-disabled":
    case "setup-ios":
      return { label: "Device setup needed", kind: "attention" };
    case "choose-device":
      return { label: "Device", kind: "idle" };
  }
}

/** One visual language for device state: neutral progress, semantic attention,
 * and a dot only when the live state is definitive. */
export function DeviceStatusLabel(props: {
  status: AppMapDeviceStatus;
  label?: string;
  identityOnly?: boolean;
}) {
  const showState = () => Boolean(props.label) && props.status.kind !== "ready";
  if (props.identityOnly) {
    return (
      <span
        class="inline-flex min-w-0 items-center gap-2 text-caption font-medium text-[var(--text-base)]"
        data-tip={props.status.detail ?? props.status.label}
      >
        <Icon name="smartphone" size={13} class="shrink-0 text-[var(--text-weak)]" />
        <span class="min-w-0 truncate">{props.label ?? "Device"}</span>
      </span>
    );
  }
  return (
    <span
      class="inline-flex min-w-0 items-center gap-2 text-caption font-medium text-[var(--text-base)]"
      role="status"
      aria-live="polite"
      aria-label={props.label ? `${props.label}: ${props.status.label}` : undefined}
      data-tip={props.status.detail}
    >
      <Show
        when={props.status.kind === "progress"}
        fallback={
          <Show
            when={
              props.status.kind === "idle" ||
              props.status.kind === "info" ||
              props.status.kind === "view-only" ||
              props.status.kind === "attention"
            }
            fallback={
              <i
                class={cn(
                  "size-1.5 shrink-0 rounded-full",
                  props.status.kind === "ready"
                    ? "bg-[var(--icon-success-base)]"
                    : "bg-[var(--text-interactive-base)] motion-safe:animate-pulse",
                )}
                aria-hidden="true"
              />
            }
          >
            <Icon
              name={
                props.status.kind === "attention"
                  ? "alert"
                  : props.status.kind === "info"
                    ? "map"
                    : "smartphone"
              }
              size={13}
              class={cn(
                props.status.kind === "attention"
                  ? "text-[var(--icon-warning-base)]"
                  : props.status.kind === "info"
                    ? "text-[var(--text-interactive-base)]"
                    : "text-[var(--text-weak)]",
              )}
            />
          </Show>
        }
      >
        <span
          class="size-3.5 animate-spin rounded-full border-[1.5px] border-[var(--text-weak)] border-t-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
      </Show>
      <span class="min-w-0 truncate">{props.label ?? props.status.label}</span>
      <Show when={showState()}>
        <span class="shrink-0 text-micro font-medium text-[var(--text-weak)]">
          {props.status.label}
        </span>
      </Show>
    </span>
  );
}

/** Keep transient readiness separate from the device's identity. The live
 * stage already explains longer states; this compact indicator only answers
 * whether the panel needs attention right now. */
export function DeviceStatusIndicator(props: { status: AppMapDeviceStatus }) {
  return (
    <Show
      when={
        props.status.kind !== "ready" &&
        props.status.kind !== "idle" &&
        props.status.kind !== "view-only"
      }
    >
      <span
        class={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
          props.status.kind === "attention"
            ? "text-[var(--icon-warning-base)]"
            : "text-[var(--text-weak)]",
        )}
        role="status"
        aria-live="polite"
        aria-label={props.status.label}
        data-tip={props.status.detail ?? props.status.label}
      >
        <Icon
          name={props.status.kind === "attention" ? "alert" : "refresh"}
          size={12}
          class={cn(
            props.status.kind === "progress" &&
              "ui-refresh-spin motion-reduce:animate-none motion-reduce:opacity-70",
          )}
        />
      </span>
    </Show>
  );
}
