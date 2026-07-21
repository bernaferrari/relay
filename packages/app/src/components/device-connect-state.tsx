import { createSignal, type JSX } from "solid-js";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { withRefreshFeedback } from "../lib/refresh-feedback";

/**
 * Compact, calm "no device" note — deliberately the same size whether the
 * stage is waiting for a device, waiting for capture, or showing content.
 * A big hollow phone silhouette here would dominate the layout for a
 * one-line message, which is the thing this replaces.
 */
export function DeviceConnectState(props: {
  offline: boolean;
  onRefresh: () => void | Promise<void>;
  onSetup: () => void;
}): JSX.Element {
  const [refreshing, setRefreshing] = createSignal(false);
  async function refresh(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await withRefreshFeedback(() => props.onRefresh());
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      class="z-[2] mt-3 flex h-9 max-w-full items-center justify-center gap-1 text-12-medium text-text-base"
      role="status"
      aria-label={props.offline ? "Connection unavailable" : "No device connected"}
    >
      <span class="inline-flex min-w-0 items-center gap-1.5 px-1.5 text-text-weak">
        <Icon name={props.offline ? "server" : "smartphone"} size={13} class="shrink-0" />
        <span class="truncate">{props.offline ? "Relay offline" : "No device"}</span>
      </span>
      <span class="mx-0.5 h-4 w-px bg-border-weak-base" aria-hidden="true" />
      <span class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-text-strong transition-colors hover:bg-surface-base-hover disabled:cursor-not-allowed disabled:text-text-weaker"
          disabled={refreshing()}
          aria-busy={refreshing()}
          onClick={() => void refresh()}
        >
          <Icon
            name="refresh"
            size={12}
            class={cn(
              refreshing() &&
                "animate-spin origin-center motion-reduce:animate-none motion-reduce:opacity-70",
            )}
          />
          {props.offline ? "Retry" : "Refresh"}
        </button>
        <button
          type="button"
          class="h-8 rounded-lg px-2.5 text-text-base transition-colors hover:bg-surface-base-hover hover:text-text-strong"
          onClick={props.onSetup}
        >
          Set up
        </button>
      </span>
    </div>
  );
}
