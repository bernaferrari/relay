import { Show, createMemo, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { deviceReadiness } from "../lib/device-readiness";
import { DeviceStatusLabel, appMapDeviceStatus } from "./device-status-label";
import { DeviceCompanionStage, type DeviceCompanionOrientation } from "./device-companion-stage";
import { Icon } from "./icon";

/**
 * The first project state is a real canvas, not a creation wizard and not a
 * persisted placeholder. The device can be used freely here; the map is only
 * created when the person captures its first screen.
 */
export function EmptyAppMap(props: {
  deviceOpen: boolean;
  onToggleDevice: () => void;
  onCaptureFirstScreen: () => void;
  onAddFirstNote: () => void;
  onOpenTargets: () => void;
  creating?: boolean;
}) {
  const server = useServer();
  const [tool, setTool] = createSignal<"select" | "hand">("select");
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
    });

  return (
    <section
      class="app-map-canvas relative min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="Untitled app map"
    >
      <div class="pointer-events-none absolute inset-0 app-map-grid" aria-hidden="true" />

      <Show when={!props.deviceOpen}>
        <div class="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center">
          <div class="grid max-w-[420px] justify-items-center gap-3">
            <span class="grid size-12 place-items-center rounded-[14px] bg-[var(--map-control-surface)] text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)]">
              <Icon name="smartphone" size={20} />
            </span>
            <div class="grid gap-1.5">
              <h1 class="m-0 text-[20px]/[1.2] font-semibold tracking-[-0.025em] text-[var(--text-strong)] text-balance">
                Start from any screen
              </h1>
              <p class="m-0 max-w-[40ch] text-[13px]/[1.55] text-[var(--text-weak)]">
                Open the live device, navigate where you want to begin, then capture that screen.
                Relay builds the map as you continue.
              </p>
            </div>
            <button
              type="button"
              class="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[var(--map-control-surface)] px-3 text-[12px] font-medium text-[var(--text-base)] shadow-[var(--map-elevation-control)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] motion-reduce:active:scale-100"
              onClick={props.onToggleDevice}
            >
              <kbd class="rounded-[5px] bg-[var(--v2-background-bg-layer-02)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-weak)]">
                D
              </kbd>
              Show device
            </button>
          </div>
        </div>
      </Show>

      <Show when={props.deviceOpen}>
        <aside
          class={cn(
            "ui-device-companion app-map-device-panel absolute top-4 right-4 bottom-4 z-40 flex min-w-0 flex-col overflow-hidden rounded-[14px] bg-[var(--map-control-surface)] shadow-[var(--map-elevation-panel)] max-[720px]:top-2 max-[720px]:right-2 max-[720px]:bottom-2 max-[720px]:left-2 max-[720px]:w-auto",
            deviceOrientation() === "landscape"
              ? "w-[min(548px,calc(100%-32px))]"
              : "w-[min(388px,calc(100%-32px))]",
          )}
          aria-label="Live device"
          data-frame-orientation={deviceOrientation()}
        >
          <header class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--map-divider)] px-4">
            <DeviceStatusLabel status={status()} />
            <button
              type="button"
              class="app-map-icon-button"
              aria-label="Close device"
              data-tip="Close device · D"
              onClick={props.onToggleDevice}
            >
              <Icon name="x" size={13} />
            </button>
          </header>
          <DeviceCompanionStage
            onOpenTargets={props.onOpenTargets}
            preparing={status().kind === "progress"}
            onOrientation={setDeviceOrientation}
          />
          <Show when={ready() || props.creating || server.controlIssue()}>
            <footer class="flex min-h-16 shrink-0 items-center justify-center border-t border-[var(--map-divider)] px-4">
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
                    {props.creating ? "Capturing…" : "Capture first screen"}
                  </Button>
                }
              >
                <div class="flex min-w-0 items-center gap-3 text-[11px] text-[var(--text-weak)]">
                  <span class="truncate">Controlled in another window</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void server.setSelectedDevice(device()?.serial ?? null)}
                  >
                    Check again
                  </Button>
                </div>
              </Show>
            </footer>
          </Show>
        </aside>
      </Show>

      <div
        class={cn(
          "absolute bottom-[calc(16px+env(safe-area-inset-bottom))] z-50 flex -translate-x-1/2 items-center gap-1 rounded-[13px] bg-[var(--map-control-surface)] p-1.5 shadow-[var(--map-elevation-panel)]",
          props.deviceOpen
            ? cn(
                "max-[720px]:left-1/2",
                deviceOrientation() === "landscape"
                  ? "left-[calc((100%-548px)/2)]"
                  : "left-[calc((100%-388px)/2)]",
              )
            : "left-1/2",
        )}
        role="toolbar"
        aria-label="App Map tools"
      >
        <button
          type="button"
          class={cn(emptyMapToolButton, tool() === "select" && emptyMapToolActive)}
          aria-label="Select tool"
          aria-pressed={tool() === "select"}
          data-tip="Select · V"
          onClick={() => setTool("select")}
        >
          <Icon name="pointer" size={14} />
        </button>
        <button
          type="button"
          class={cn(emptyMapToolButton, tool() === "hand" && emptyMapToolActive)}
          aria-label="Hand tool"
          aria-pressed={tool() === "hand"}
          data-tip="Pan canvas · H"
          onClick={() => setTool("hand")}
        >
          <Icon name="move" size={14} />
        </button>
        <span class="mx-0.5 h-6 w-px bg-[var(--map-divider)]" aria-hidden="true" />
        <button
          type="button"
          class={emptyMapToolButton}
          aria-label="Capture screenshot"
          data-tip="Capture screenshot"
          onClick={props.onCaptureFirstScreen}
        >
          <Icon name="smartphone" size={14} />
        </button>
        <button
          type="button"
          class={emptyMapToolButton}
          aria-label="Create connection"
          data-tip="Add a screen before connecting"
          disabled
        >
          <Icon name="arrow-right" size={14} />
        </button>
        <button
          type="button"
          class={emptyMapToolButton}
          aria-label="Add note"
          data-tip="Add note"
          onClick={props.onAddFirstNote}
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          type="button"
          class={emptyMapToolButton}
          aria-label="Create Routine"
          data-tip="Select a connection to create a Routine"
          disabled
        >
          <Icon name="sparkle" size={14} />
        </button>
        <span class="mx-0.5 h-6 w-px bg-[var(--map-divider)]" aria-hidden="true" />
        <button
          type="button"
          class={cn(emptyMapToolButton, props.deviceOpen && emptyMapToolActive)}
          aria-label="Toggle live device"
          aria-pressed={props.deviceOpen}
          data-tip="Live device · D"
          onClick={props.onToggleDevice}
        >
          <Icon name="smartphone" size={14} />
        </button>
      </div>
    </section>
  );
}

const emptyMapToolButton =
  "canvas-tool-control grid h-10 min-w-10 place-items-center rounded-[9px] px-2 text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-150 hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--v2-background-bg-base)] disabled:cursor-not-allowed disabled:opacity-30";
const emptyMapToolActive = "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]";
