import { Show, createMemo, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { deviceReadiness } from "../lib/device-readiness";
import {
  DeviceStatusIndicator,
  DeviceStatusLabel,
  appMapDeviceStatus,
} from "./device-status-label";
import { DeviceCompanionStage, type DeviceCompanionOrientation } from "./device-companion-stage";
import { Icon } from "./icon";
import { presentTarget } from "../lib/target-presentation";

/**
 * The first project state is a real canvas, not a creation wizard and not a
 * persisted placeholder. The device can be used freely here; the map is only
 * created when the person captures its first screen.
 */
export function EmptyAppMap(props: {
  deviceOpen: boolean;
  onToggleDevice: () => void;
  onCaptureFirstScreen: () => void;
  onOpenTargets: () => void;
  creating?: boolean;
}) {
  const server = useServer();
  const [deviceOrientation, setDeviceOrientation] =
    createSignal<DeviceCompanionOrientation>("unknown");
  const device = createMemo(() =>
    server.devices().find((candidate) => candidate.serial === server.selectedDevice()),
  );
  const readiness = createMemo(() =>
    deviceReadiness(device(), server.health() === "online", {
      ...(device()?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      requireLiveScreen: true,
      liveScreenAvailable:
        Boolean(server.liveFrame()?.base64) &&
        (!server.liveFrame()?.serial || server.liveFrame()?.serial === device()?.serial),
    }),
  );
  const ready = () =>
    readiness().kind === "ready" && Boolean(server.selectedLeaseId()) && !server.controlIssue();
  const status = () =>
    appMapDeviceStatus({
      readiness: readiness(),
      deviceSelected: Boolean(device()),
      serverOnline: server.health() === "online",
      discovering: server.deviceDiscoveryStatus() === "scanning",
      controlReady: Boolean(server.selectedLeaseId()),
      controlIssue: server.controlIssue(),
      controlTakeoverAvailable: server.canTakeControlOfSelectedDevice(),
    });

  return (
    <section
      class="app-map-canvas relative min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="My map"
    >
      <div class="pointer-events-none absolute inset-0 app-map-grid" aria-hidden="true" />

      <Show when={!props.deviceOpen}>
        <div class="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center">
          <div class="grid max-w-[420px] justify-items-center gap-3">
            <span class="grid size-12 place-items-center rounded-2xl bg-[var(--map-control-surface)] text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)]">
              <Icon name="smartphone" size={20} />
            </span>
            <div class="grid gap-1.5">
              <h1 class="m-0 text-display/[1.2] font-semibold tracking-[-0.025em] text-[var(--text-strong)] text-balance">
                Map this app
              </h1>
              <p class="m-0 max-w-[38ch] text-body/[1.55] text-[var(--text-weak)]">
                Show the live device, then start mapping. Relay taps through screens and files them
                on the canvas.
              </p>
            </div>
            <Show
              when={device()}
              fallback={
                <button
                  type="button"
                  class="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--text-interactive-base)] px-3.5 text-caption font-semibold text-[var(--text-on-brand-base,white)] shadow-[var(--map-elevation-control)] transition-[background-color,transform] duration-hover hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] motion-reduce:active:scale-100"
                  onClick={props.onOpenTargets}
                >
                  <Icon name="smartphone" size={14} />
                  Choose device
                </button>
              }
            >
              <button
                type="button"
                class="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--text-interactive-base)] px-3.5 text-caption font-semibold text-[var(--text-on-brand-base,white)] shadow-[var(--map-elevation-control)] transition-[background-color,transform] duration-hover hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] motion-reduce:active:scale-100"
                onClick={props.onToggleDevice}
              >
                <Icon name="smartphone" size={14} />
                Show live device
                <kbd class="rounded-md bg-[rgb(255_255_255/18%)] px-1.5 py-0.5 font-mono text-micro font-medium">
                  D
                </kbd>
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.deviceOpen}>
        <aside
          class={cn(
            "ui-device-companion app-map-device-panel absolute top-4 right-4 bottom-4 z-40 flex min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--map-control-surface)] shadow-[var(--map-elevation-panel)] max-[720px]:top-2 max-[720px]:right-2 max-[720px]:bottom-2 max-[720px]:left-2 max-[720px]:w-auto",
            deviceOrientation() === "landscape"
              ? "w-[min(620px,calc(100%-32px))]"
              : "w-[min(480px,calc(100%-32px))]",
          )}
          aria-label="Live device"
          data-frame-orientation={deviceOrientation()}
        >
          <header class="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--map-divider)] px-3">
            <DeviceStatusLabel
              status={status()}
              label={device() ? presentTarget(device()!).displayName : "Device"}
              identityOnly
            />
            <div class="flex items-center gap-1.5">
              <DeviceStatusIndicator status={status()} />
              <button
                type="button"
                class="app-map-icon-button"
                aria-label="Close device"
                data-tip="Close device · D"
                onClick={props.onToggleDevice}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          </header>
          <DeviceCompanionStage
            onOpenTargets={props.onOpenTargets}
            preparing={status().kind === "progress"}
            onOrientation={setDeviceOrientation}
          />
          <Show when={ready() || props.creating || server.controlIssue()}>
            <footer class="flex min-h-14 shrink-0 items-center justify-center border-t border-[var(--map-divider)] px-3">
              <Show
                when={server.controlIssue()}
                fallback={
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={props.creating || !ready()}
                    aria-busy={props.creating}
                    onClick={props.onCaptureFirstScreen}
                  >
                    <Show
                      when={props.creating}
                      fallback={<i class="size-2 rounded-full bg-current" aria-hidden="true" />}
                    >
                      <Icon name="refresh" size={14} class="ui-refresh-spin" />
                    </Show>
                    {props.creating ? "Saving…" : "Start mapping"}
                  </Button>
                }
              >
                <div class="flex min-w-0 flex-col items-center gap-2 text-center text-caption text-[var(--text-weak)]">
                  <span class="max-w-[36ch] text-pretty">
                    Another Relay window has control of this device.
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={server.takingControlOfSelectedDevice()}
                    aria-busy={server.takingControlOfSelectedDevice()}
                    onClick={() => void server.takeControlOfSelectedDevice()}
                  >
                    <Show when={server.takingControlOfSelectedDevice()}>
                      <Icon
                        name="refresh"
                        size={12}
                        class="ui-refresh-spin motion-reduce:opacity-70"
                      />
                    </Show>
                    {server.takingControlOfSelectedDevice() ? "Taking control…" : "Take control"}
                  </Button>
                </div>
              </Show>
            </footer>
          </Show>
        </aside>
      </Show>
    </section>
  );
}
