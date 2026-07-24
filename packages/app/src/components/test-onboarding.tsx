import { Show } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { presentTarget } from "../lib/target-presentation";
import { Icon } from "./icon";

export function TestWelcome(props: { onRecord: () => void; onOpenTargets: () => void }) {
  const server = useServer();
  const target = () =>
    server.devices().find((device) => device.serial === server.selectedDevice()) ?? null;
  const targetCopy = () => (target() ? presentTarget(target()!) : null);
  const targetReady = () =>
    Boolean(target()) && server.health() === "online" && target()!.booted !== false;

  return (
    <section
      class="col-span-full flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10"
      aria-labelledby="test-welcome-title"
    >
      <div class="my-auto grid w-[min(100%,452px)] gap-5 self-center">
        <header class="text-center">
          <h2
            id="test-welcome-title"
            class="text-[23px] font-semibold tracking-[-0.035em] text-[var(--text-strong)]"
          >
            Show Relay what to test
          </h2>
          <p class="mx-auto mt-1.5 max-w-[368px] text-[12.5px]/[1.55] text-[var(--text-base)]">
            Start on your device. Relay turns the screens and actions you record into a journey map.
          </p>
        </header>

        {/* Primary — record on device */}
        <button
          type="button"
          class={cn(
            "group/rec relative grid w-full grid-cols-[46px_minmax(0,1fr)_38px] items-center gap-3.5 rounded-[18px] p-4 text-left",
            "border transition-[background-color,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "active:scale-[0.99]",
            targetReady()
              ? "border-transparent bg-gradient-to-b from-[#7c6cf6] to-[#6957ee] shadow-[0_10px_28px_-10px_rgb(89_69_214/55%)] hover:shadow-[0_14px_34px_-10px_rgb(89_69_214/60%)]"
              : "border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha shadow-xs-border-base hover:border-[var(--text-interactive-base)]",
          )}
          onClick={() => (targetReady() ? props.onRecord() : props.onOpenTargets())}
        >
          <span
            class={cn(
              "grid size-[46px] place-items-center rounded-[13px]",
              targetReady()
                ? "bg-white/15 text-white"
                : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
            )}
          >
            <Show when={target()} fallback={<Icon name="smartphone" size={21} />}>
              <Icon name={target()!.platform === "browser" ? "server" : "smartphone"} size={21} />
            </Show>
          </span>

          <span class="min-w-0 text-left">
            <strong
              class={cn(
                "block truncate text-[14.5px] font-semibold tracking-[-0.015em]",
                targetReady() ? "text-white" : "text-[var(--text-strong)]",
              )}
            >
              {targetReady() ? `Record on ${targetCopy()!.displayName}` : "Record from device"}
            </strong>
            <small
              class={cn(
                "mt-0.5 flex items-center justify-start gap-1.5 truncate text-left text-[11.5px]/[1.4]",
                targetReady() ? "text-white/75" : "text-[var(--text-weak)]",
              )}
            >
              <Show when={!targetReady()}>
                <i class="size-1.5 shrink-0 rounded-full bg-[var(--icon-warning-base)]" />
              </Show>
              {targetReady()
                ? "Use the app normally; every tap becomes a step."
                : target()
                  ? "Boot the device, then start recording."
                  : "Pick a simulator, phone, or browser to record on."}
            </small>
          </span>

          <span
            class={cn(
              "grid size-[34px] place-items-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/rec:translate-x-0.5",
              targetReady()
                ? "bg-white/18 text-white"
                : "bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]",
            )}
          >
            <Icon name="arrow-right" size={16} />
          </span>
        </button>

        <p class="m-0 text-center text-[11.5px]/[1.5] text-[var(--text-weak)]">
          Record a screen, its actions, and the next screen. You can name and refine the path as you
          go.
        </p>
      </div>
    </section>
  );
}
