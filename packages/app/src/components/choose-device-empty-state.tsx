import { Show } from "solid-js";
import { Button } from "@relay/ui/button";
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
            ? "Looking for devices…"
            : props.purpose === "record"
              ? "Connect a device to record"
              : "Connect a device to begin"}
      </h2>
      <p class="m-0 mt-1.5 max-w-[34ch] text-[12px]/[1.5] text-[var(--text-weak)]">
        {props.offline
          ? "Start the local Relay service again. Your maps stay safe."
          : props.scanning
            ? "Checking USB, Wi‑Fi, and simulators for Android and iOS."
            : props.purpose === "record"
              ? "Plug in a phone, start a simulator, or pick a browser target — then record the path."
              : "Plug in a phone, start a simulator, or open a browser target to see the live screen."}
      </p>
      <Show when={!props.scanning && !props.offline}>
        <Button variant="primary" size="lg" class="mt-4" onClick={props.onChooseDevice}>
          <Icon name="smartphone" size={13} />
          {props.purpose === "record" ? "Choose device to record" : "Choose device"}
        </Button>
      </Show>
    </section>
  );
}
