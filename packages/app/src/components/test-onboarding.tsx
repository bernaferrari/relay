import { Show } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { shellStageWrap } from "../lib/shell-layout";
import { presentTarget, targetIsReady } from "../lib/target-presentation";
import { productPrimary, productSecondary } from "../lib/ui";
import { DeviceStage } from "./stage";
import { Icon } from "./icon";

/**
 * The launch surface is a live session, not a silently-restored journey.
 * Device control is always available; recording only begins after the user
 * explicitly creates a journey.
 */
export function TestWelcome(props: {
  onChooseDevice: () => void;
  onStartJourney: () => void;
  onOpenTargets: () => void;
}) {
  const server = useServer();
  const target = () =>
    server.devices().find((device) => device.serial === server.selectedDevice()) ?? null;
  const ready = () => targetIsReady(target() ?? undefined, server.health() === "online");
  const targetName = () => (target() ? presentTarget(target()!).displayName : "your device");
  const journeyCount = () => server.recipes().filter((recipe) => recipe.source === "custom").length;

  return (
    <section
      class="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(300px,0.72fr)_minmax(420px,1fr)] bg-[var(--v2-background-bg-deep)] max-[980px]:grid-cols-1"
      aria-labelledby="session-home-title"
    >
      <div class="flex min-h-0 min-w-0 items-center border-r border-[var(--v2-border-border-muted)] px-[clamp(28px,5vw,72px)] py-10 max-[980px]:border-r-0 max-[980px]:border-b">
        <div class="grid w-full max-w-[460px] gap-5">
          <div>
            <span class="text-[10px] font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
              Live session
            </span>
            <h2
              id="session-home-title"
              class="m-0 mt-2 text-[clamp(22px,2.4vw,32px)] leading-[1.04] font-semibold tracking-[-0.035em] text-[var(--text-strong)] text-balance"
            >
              <Show when={ready()} fallback={<>Choose a device to begin</>}>
                Explore {targetName()}
              </Show>
            </h2>
            <p class="m-0 mt-2.5 max-w-[44ch] text-[13px]/[1.6] text-[var(--text-weak)] text-pretty">
              <Show
                when={ready()}
                fallback={
                  <>
                    Connect a phone, emulator, or browser target. Relay keeps the live session
                    separate from journeys until you choose to record.
                  </>
                }
              >
                Tap, swipe, and type freely. Recording is off until you explicitly start a new
                journey.
              </Show>
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class={cn(productPrimary, "min-h-10 gap-2 px-3.5 text-[12px]")}
              onClick={() => (ready() ? props.onStartJourney() : props.onChooseDevice())}
            >
              <Icon name={ready() ? "circle" : "smartphone"} size={13} />
              {ready() ? "Record new journey" : "Choose a device"}
            </button>
            <button
              type="button"
              class={cn(productSecondary, "min-h-10 px-3 text-[12px]")}
              onClick={props.onOpenTargets}
            >
              Manage targets
            </button>
          </div>

          <div class="flex items-center gap-2 border-t border-[var(--v2-border-border-muted)] pt-4 text-[11px] text-[var(--text-weak)]">
            <i
              class={cn(
                "size-1.5 shrink-0 rounded-full",
                ready() ? "bg-[var(--icon-success-base)]" : "bg-[var(--v2-border-border-strong)]",
              )}
              aria-hidden="true"
            />
            <span>
              {ready()
                ? `Live control · recording off · ${journeyCount()} ${
                    journeyCount() === 1 ? "journey" : "journeys"
                  }`
                : "No live target selected"}
            </span>
          </div>
        </div>
      </div>

      <div class={cn(shellStageWrap, "min-h-[420px] min-w-0")}>
        <div class="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-2 rounded-full border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_88%,transparent)] px-2.5 py-1.5 text-[10.5px] text-[var(--text-base)] shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]">
          <i
            class={cn(
              "size-1.5 rounded-full",
              ready() ? "bg-[var(--icon-success-base)]" : "bg-[var(--text-weak)]",
            )}
          />
          {ready() ? targetName() : "Live device"}
        </div>
        <DeviceStage onOpenTargets={props.onOpenTargets} recordingControls="embedded" />
      </div>
    </section>
  );
}
