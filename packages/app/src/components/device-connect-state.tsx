import { createSignal, type JSX } from "solid-js";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import { productPrimary, productSecondary } from "../lib/ui";

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
    <div class="grid max-w-[320px] justify-items-center gap-3 text-center">
      <span class="grid size-10 place-items-center rounded-xl bg-surface-base-active text-text-weaker">
        <Icon name="smartphone" size={18} />
      </span>
      <div>
        <p class="m-0 text-[13px] font-medium text-[var(--text-strong)]">
          {props.offline ? "Connection unavailable" : "No device connected"}
        </p>
        <p class="mt-1 text-[12px]/[1.5] text-[var(--text-weak)]">
          Plug in over USB or join over Wi‑Fi to record and inspect on the real app.
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          class={cn(productPrimary, "min-h-[34px] px-[11px]")}
          disabled={refreshing()}
          aria-busy={refreshing()}
          onClick={() => void refresh()}
        >
          <Icon
            name="refresh"
            size={14}
            class={cn(
              refreshing() &&
                "animate-spin origin-center motion-reduce:animate-none motion-reduce:opacity-70",
            )}
          />
          Refresh
        </button>
        <button
          type="button"
          class={cn(productSecondary, "min-h-[34px] px-[11px]")}
          onClick={props.onSetup}
        >
          <Icon name="sliders" size={14} />
          Device setup
        </button>
      </div>
    </div>
  );
}
