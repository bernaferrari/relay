import { Show } from "solid-js";
import { cn } from "../lib/cn";
import type { DeviceReadiness } from "../lib/device-readiness";
import { Icon } from "./icon";

export type AppMapDeviceStatus = {
  label: string;
  kind: "idle" | "progress" | "ready" | "recording" | "attention";
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
        return { label: "View only", kind: "attention", detail: input.controlIssue };
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
export function DeviceStatusLabel(props: { status: AppMapDeviceStatus }) {
  return (
    <span
      class="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium text-[var(--text-base)]"
      role="status"
      aria-live="polite"
      data-tip={props.status.detail}
    >
      <Show
        when={props.status.kind === "progress"}
        fallback={
          <Show
            when={props.status.kind === "idle" || props.status.kind === "attention"}
            fallback={
              <i
                class={cn(
                  "size-1.5 shrink-0 rounded-full",
                  props.status.kind === "ready"
                    ? "bg-[var(--icon-success-base)]"
                    : "bg-[var(--icon-critical-base)]",
                )}
                aria-hidden="true"
              />
            }
          >
            <Icon
              name={props.status.kind === "attention" ? "alert" : "smartphone"}
              size={13}
              class={cn(
                props.status.kind === "attention"
                  ? "text-[var(--icon-warning-base)]"
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
      {props.status.label}
    </span>
  );
}
