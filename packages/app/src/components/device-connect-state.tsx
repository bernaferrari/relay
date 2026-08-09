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
  onChooseDevice: () => void;
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
    <div class="z-[2] mt-3 flex h-9 max-w-full items-center justify-center text-12-medium">
      <button
        type="button"
        class="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-surface-base px-2.5 text-text-base shadow-[inset_0_0_0_1px_var(--border-weak-base)] transition-colors hover:bg-surface-base-hover hover:text-text-strong disabled:cursor-not-allowed disabled:text-text-weaker"
        disabled={props.offline && refreshing()}
        aria-busy={props.offline && refreshing()}
        aria-label={props.offline ? "Relay offline. Retry connection" : "No device. Choose device"}
        data-tip={props.offline ? "Retry connection" : "Choose device"}
        onClick={() => (props.offline ? void refresh() : props.onChooseDevice())}
      >
        <Icon name={props.offline ? "server" : "smartphone"} size={13} class="shrink-0" />
        <span class="truncate">{props.offline ? "Relay offline" : "No device"}</span>
        <Icon
          name={props.offline ? "refresh" : "chevron-down"}
          size={12}
          class={cn(
            "ml-0.5 text-text-weak",
            props.offline &&
              refreshing() &&
              "animate-spin origin-center motion-reduce:animate-none motion-reduce:opacity-70",
          )}
        />
      </button>
    </div>
  );
}
