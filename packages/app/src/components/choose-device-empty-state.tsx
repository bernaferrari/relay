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
        <Icon name="smartphone" size={19} />
      </span>
      <h2
        id="choose-device-title"
        class="m-0 mt-3 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]"
      >
        Connect a device
      </h2>
      <p class="m-0 mt-1.5 max-w-[32ch] text-[12px]/[1.5] text-[var(--text-weak)]">
        Pick a phone, simulator, or browser. You can explore it freely before recording anything.
      </p>
      <button
        type="button"
        class="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-[10px] bg-[var(--v2-background-bg-accent)] px-4 text-[11px] font-semibold text-white shadow-[0_8px_24px_color-mix(in_srgb,var(--v2-background-bg-accent)_24%,transparent)] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-strong-focus)]"
        onClick={props.onChooseDevice}
      >
        <Icon name="smartphone" size={13} />
        Choose device
      </button>
    </section>
  );
}
