import { Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

/**
 * The single empty state for work that needs a recording target. Keeping this
 * separate from the device stage prevents the app from inventing a phone
 * preview before a person has selected one.
 */
export function ChooseDeviceEmptyState(props: {
  onChooseDevice: () => void;
  purpose?: "live" | "record";
  scanning?: boolean;
  offline?: boolean;
  class?: string;
}) {
  return (
    <section
      class={cn(
        "relative z-[2] grid max-w-[29rem] justify-items-center px-6 text-center",
        props.class,
      )}
      aria-labelledby="choose-device-title"
    >
      <span class="grid size-11 place-items-center rounded-[14px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)]">
        <Icon
          name={props.offline ? "alert" : props.scanning ? "refresh" : "smartphone"}
          size={19}
          class={props.scanning ? "ui-refresh-spin motion-reduce:opacity-70" : ""}
        />
      </span>
      <h2
        id="choose-device-title"
        class="m-0 mt-3 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]"
      >
        {props.offline
          ? "Relay is offline"
          : props.scanning
            ? "Looking for devices"
            : "No device connected"}
      </h2>
      <p class="m-0 mt-1.5 max-w-[32ch] text-[12px]/[1.5] text-[var(--text-weak)]">
        {props.offline
          ? "Restart the local Relay service. Devices will appear when it reconnects."
          : props.scanning
            ? "Relay is checking connected Android and iOS devices."
            : "Connect a phone or start a simulator, then choose it here."}
      </p>
      <Show when={!props.scanning && !props.offline}>
        <button
          type="button"
          class="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-transparent bg-[var(--v2-background-bg-accent)] px-4 text-[11.5px] font-semibold text-[var(--text-on-brand-base)] shadow-[0_8px_24px_color-mix(in_srgb,var(--v2-background-bg-accent)_24%,transparent)] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.96] motion-reduce:active:scale-100"
          onClick={props.onChooseDevice}
        >
          <Icon name="smartphone" size={13} />
          Choose device
        </button>
      </Show>
    </section>
  );
}
