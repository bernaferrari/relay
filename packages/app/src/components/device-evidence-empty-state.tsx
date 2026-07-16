import { Show } from "solid-js";
import { cn } from "../lib/cn";
import { eyebrow, productPrimary, productSecondary } from "../lib/ui";
import { Icon } from "./icon";

export function DeviceEvidenceEmptyState(props: {
  deviceName?: string;
  ready: boolean;
  step?: { index: number; title: string } | null;
  refreshing: boolean;
  onChooseDevice: () => void;
  onRefresh: () => void;
}) {
  return (
    <section
      class="relative z-[2] w-full max-w-[360px] overflow-hidden rounded-[18px] bg-[var(--v2-background-bg-base)] p-5 text-left shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]"
      aria-label="Device evidence"
    >
      <div class="flex items-start gap-3.5">
        <span class="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
          <Icon name={props.ready ? "camera" : "smartphone"} size={17} />
        </span>
        <div class="min-w-0 flex-1">
          <span class={eyebrow}>Device evidence</span>
          <h2 class="mt-1.5 text-[16px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
            {props.ready ? "No capture yet" : "Device unavailable"}
          </h2>
          <p class="mt-1.5 text-[11.5px]/[1.55] text-[var(--text-base)]">
            {props.ready
              ? props.step
                ? "Run or record this test to attach the real screen for this step."
                : "Select a step, then run or record the test to capture its real screen."
              : "Start this target or choose another device before capturing evidence."}
          </p>
        </div>
      </div>

      <Show when={props.step}>
        {(step) => (
          <div class="mt-4 flex min-w-0 items-center gap-2.5 rounded-[11px] bg-[var(--v2-background-bg-layer-01)] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
            <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_12%,transparent)] font-mono text-[10px] tabular-nums text-[var(--text-interactive-base)]">
              {String(step().index + 1).padStart(2, "0")}
            </span>
            <strong class="min-w-0 truncate text-[11.5px] font-medium text-[var(--text-strong)]">
              {step().title}
            </strong>
          </div>
        )}
      </Show>

      <footer class="mt-4 flex min-h-9 items-center justify-between gap-3 border-t border-[var(--v2-border-border-muted)] pt-3">
        <span class="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] text-[var(--text-weak)]">
          <i
            class={cn(
              "size-1.5 shrink-0 rounded-full",
              props.ready ? "bg-[var(--icon-success-base)]" : "bg-[var(--icon-warning-base)]",
            )}
          />
          <span class="truncate">{props.deviceName ?? "No device selected"}</span>
        </span>
        <Show when={!props.ready}>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class={cn(productSecondary, "min-h-8 px-2.5 text-[10.5px]")}
              disabled={props.refreshing}
              aria-busy={props.refreshing}
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
              Refresh
            </button>
            <button
              type="button"
              class={cn(productPrimary, "min-h-8 px-2.5 text-[10.5px]")}
              onClick={props.onChooseDevice}
            >
              Choose
            </button>
          </div>
        </Show>
      </footer>
    </section>
  );
}
