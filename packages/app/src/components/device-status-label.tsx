import { Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type AppMapDeviceStatus = {
  label: string;
  kind: "idle" | "progress" | "ready" | "recording" | "attention";
};

/** One visual language for device state: neutral progress, semantic attention,
 * and a dot only when the live state is definitive. */
export function DeviceStatusLabel(props: { status: AppMapDeviceStatus }) {
  return (
    <span
      class="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium text-[var(--text-base)]"
      role="status"
      aria-live="polite"
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
