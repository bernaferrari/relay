import { Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

/**
 * Slim device-readiness strip docked under the stage. The stage keeps the
 * phone frame (and the planned step inside it) as the hero; this strip only
 * carries the plumbing needed to bring the device online.
 */
export function DeviceEvidenceEmptyState(props: {
  deviceName?: string;
  refreshing: boolean;
  starting?: boolean;
  onStartDevice?: () => void;
  onChooseDevice: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      class="z-[2] mt-3 flex h-9 max-w-full items-center justify-center gap-1 text-12-medium text-text-base"
      role="status"
      aria-label="Device unavailable"
    >
      <span class="inline-flex min-w-0 items-center gap-1.5 px-1.5 text-text-weak">
        <Icon name="smartphone" size={13} class="shrink-0" />
        <span class="max-w-40 truncate">{props.deviceName ?? "No device"}</span>
      </span>
      <span class="mx-0.5 h-4 w-px bg-border-weak-base" aria-hidden="true" />
      <span class="flex shrink-0 items-center gap-0.5">
        <Show when={props.onStartDevice}>
          <button
            type="button"
            class="h-8 rounded-lg px-2.5 text-text-strong transition-colors hover:bg-surface-base-hover disabled:cursor-not-allowed disabled:text-text-weaker"
            disabled={props.starting}
            aria-busy={props.starting}
            onClick={props.onStartDevice}
          >
            {props.starting ? "Starting…" : "Start"}
          </button>
        </Show>
        <button
          type="button"
          class="h-8 rounded-lg px-2.5 text-text-strong transition-colors hover:bg-surface-base-hover"
          onClick={props.onChooseDevice}
        >
          Choose device
        </button>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-lg text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40"
          disabled={props.refreshing}
          aria-busy={props.refreshing}
          aria-label="Refresh device status"
          data-tip="Refresh device status"
          onClick={props.onRefresh}
        >
          <Icon
            name="refresh"
            size={12}
            class={cn(
              props.refreshing &&
                "animate-spin origin-center motion-reduce:animate-none motion-reduce:opacity-70",
            )}
          />
        </button>
      </span>
    </div>
  );
}
