import { Show, createSignal, type Accessor, type JSX } from "solid-js";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import { eyebrow, productPrimary, productSecondary } from "../lib/ui";

type FocusedStep = { index: number; title: string } | null;

export function DeviceConnectState(props: {
  offline: boolean;
  focusedStep: Accessor<FocusedStep>;
  phoneShell: string;
  phoneScreen: string;
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
      class="@container relative z-[2] grid w-[min(100%,500px)] grid-cols-[minmax(176px,210px)_minmax(210px,250px)] items-center justify-center gap-[clamp(24px,6cqw,40px)] @max-[470px]:w-[min(100%,300px)] @max-[470px]:grid-cols-1"
      data-device-chrome
    >
      <div class="grid place-items-center select-none @max-[470px]:hidden" aria-hidden="true">
        <div
          class={cn(
            props.phoneShell,
            "aspect-[9/19.5] w-[min(100%,198px)] rotate-[-1.5deg] rounded-[25px] p-1.5 shadow-[0_28px_72px_color-mix(in_srgb,black_42%,transparent),0_0_0_1px_color-mix(in_srgb,var(--relay-text)_7%,transparent)]",
          )}
        >
          <div
            class={cn(
              props.phoneScreen,
              "relative flex h-full flex-col overflow-hidden rounded-[19px] bg-[radial-gradient(circle_at_50%_28%,color-mix(in_srgb,var(--relay-accent)_17%,transparent),transparent_34%),var(--phone-screen)] px-[18px] pt-[42px] pb-[18px]",
            )}
          >
            <span class="absolute top-3.5 left-1/2 h-[5px] w-[42px] -translate-x-1/2 rounded-full bg-[color-mix(in_srgb,var(--phone-fg)_16%,transparent)]" />
            <span class="mx-auto mt-[54px] grid size-[52px] place-items-center rounded-[17px] bg-[color-mix(in_srgb,var(--relay-accent)_12%,var(--phone-screen))] text-[color-mix(in_srgb,var(--relay-accent)_80%,white)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--relay-accent)_22%,transparent)]">
              <Icon name="smartphone" size={24} />
            </span>
            <div class="mt-[30px] grid gap-[7px]">
              <i class="h-1.5 rounded-full bg-[color-mix(in_srgb,var(--phone-fg)_10%,transparent)]" />
              <i class="h-1.5 w-[76%] rounded-full bg-[color-mix(in_srgb,var(--phone-fg)_10%,transparent)]" />
              <i class="h-1.5 w-[54%] rounded-full bg-[color-mix(in_srgb,var(--phone-fg)_10%,transparent)]" />
            </div>
            <Show when={props.focusedStep()}>
              {(step) => (
                <div class="absolute right-2.5 bottom-2.5 left-2.5 grid grid-cols-[22px_minmax(0,1fr)] items-center gap-[7px] rounded-[10px] bg-[color-mix(in_srgb,var(--phone-bezel)_86%,transparent)] p-2 text-[var(--phone-fg)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--phone-fg)_10%,transparent)] backdrop-blur-[10px]">
                  <span class="grid size-[22px] place-items-center rounded-md bg-[color-mix(in_srgb,var(--phone-fg)_8%,transparent)] font-mono text-[9px]">
                    {step().index + 1}
                  </span>
                  <strong class="overflow-hidden text-[9px] font-medium text-ellipsis whitespace-nowrap">
                    {step().title}
                  </strong>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
      <div class="min-w-0 @max-[470px]:text-center">
        <div
          class="relative mx-auto mb-[18px] hidden size-[72px] place-items-center @max-[470px]:grid"
          aria-hidden="true"
        >
          <span class="relative z-[2] grid size-[54px] place-items-center rounded-[17px] border border-[color-mix(in_srgb,var(--relay-accent)_30%,var(--relay-line))] bg-[color-mix(in_srgb,var(--relay-accent)_10%,var(--relay-surface-raised))] text-[var(--relay-accent-2)] shadow-[0_12px_34px_color-mix(in_srgb,var(--relay-accent)_14%,transparent)]">
            <Icon name="smartphone" size={24} />
          </span>
          <i class="absolute inset-1 rounded-[22px] border border-[color-mix(in_srgb,var(--relay-accent)_18%,transparent)]" />
          <i class="absolute -inset-[5px] rounded-[27px] border border-[color-mix(in_srgb,var(--relay-accent)_8%,transparent)]" />
        </div>
        <span class={eyebrow}>Live device</span>
        <h3 class="mt-[7px] text-[22px] font-semibold tracking-[-0.035em] text-[var(--relay-text)]">
          Connect a device
        </h3>
        <p class="mt-2.5 max-w-[31ch] text-[12px]/[1.55] text-[var(--relay-text-secondary)] @max-[470px]:mx-auto">
          Plug in over USB or join over Wi‑Fi to record, inspect, and replay on the real app.
        </p>
        <p
          class="mt-[15px] inline-flex items-center gap-[7px] p-0 text-[10px] leading-none text-[var(--relay-text-tertiary)]"
          role="status"
        >
          <span
            class={cn(
              "size-1.5 rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,var(--relay-amber)_10%,transparent)]",
              props.offline
                ? "bg-[var(--relay-red)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--relay-red)_10%,transparent)]"
                : "bg-[var(--relay-amber)]",
            )}
            aria-hidden="true"
          />
          {props.offline ? "Connection unavailable" : "Looking for a device"}
        </p>
        <div class="mt-3.5 flex flex-wrap gap-[7px] @max-[470px]:justify-center">
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
        <p class="mt-3 text-[9px]/[1.45] text-[var(--relay-text-tertiary)]">
          Android: enable USB debugging · iOS: trust this computer
        </p>
      </div>
    </div>
  );
}
