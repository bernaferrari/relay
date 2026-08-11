import { For, Show, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import type { RecordingTake } from "../context/recorder";
import { useServer } from "../context/server";
import {
  ACCESSIBILITY_OVERLAY_MODES,
  ACCESSIBILITY_OVERLAY_MODE_DESCRIPTIONS,
  ACCESSIBILITY_OVERLAY_MODE_LABELS,
  type AccessibilityOverlayMode,
} from "../lib/accessibility-overlay-mode";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { TakeCaptureBar } from "./app-map-capture-review";
import { DeviceStatusLabel, type AppMapDeviceStatus } from "./device-status-label";
import { DeviceCompanionStage, type DeviceCompanionOrientation } from "./device-companion-stage";

export function AppMapDeviceCompanion(props: {
  closing: boolean;
  deviceSelected: boolean;
  deviceLabel?: string;
  status: AppMapDeviceStatus;
  recording: boolean;
  take: RecordingTake | null;
  unmapped: boolean;
  outsideMapApp: boolean;
  mappedScreenName?: string;
  captureBusy: boolean;
  canRecord: boolean;
  mapName?: string;
  captureContextLabel: string | undefined;
  onClose: () => void;
  onOpenTargets: () => void;
  onSaveScreen: () => void;
  onRecord: () => void;
  onStop: () => void;
  onOrientation?: (orientation: DeviceCompanionOrientation) => void;
}) {
  const server = useServer();
  const [renderedOrientation, setRenderedOrientation] =
    createSignal<DeviceCompanionOrientation>("unknown");
  return (
    <aside
      class={cn(
        "ui-device-companion absolute top-4 right-4 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--map-control-surface)] shadow-[var(--map-elevation-panel)]",
        props.closing && "ui-device-companion--closing",
        props.deviceSelected
          ? cn(
              "bottom-4 rounded-[14px] max-[900px]:top-auto max-[900px]:right-2 max-[900px]:bottom-2 max-[900px]:left-2 max-[900px]:h-[min(72vh,680px)] max-[900px]:w-auto",
              "w-[min(var(--app-map-device-panel-width),calc(100%-32px))]",
            )
          : "h-[276px] w-[min(344px,calc(100%-32px))] rounded-[14px] max-[900px]:right-2 max-[900px]:left-2 max-[900px]:w-auto",
      )}
      data-frame-orientation={renderedOrientation()}
      aria-label="Device"
    >
      <header class="relative z-[100] flex min-h-10 shrink-0 items-center justify-between border-b border-[var(--map-divider)] px-3">
        <DeviceStatusLabel
          status={props.status}
          label={props.deviceLabel ?? "Device"}
          identityOnly
        />
        <div class="flex items-center gap-1">
          <label
            class="relative inline-flex h-7 items-center rounded-md pl-2 text-[11px] text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-base)]"
            data-tip={ACCESSIBILITY_OVERLAY_MODE_DESCRIPTIONS[server.accessibilityMode()]}
          >
            <span class="pointer-events-none font-medium text-[var(--text-base)]">Elements</span>
            <span class="pointer-events-none px-1 text-[var(--text-weaker)]">·</span>
            <select
              class="h-full max-w-[76px] cursor-pointer appearance-none rounded-md bg-transparent pr-5 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong-focus)]"
              aria-label="Elements overlay"
              data-focus-contained
              value={server.accessibilityMode()}
              onChange={(event) =>
                server.setAccessibilityMode(event.currentTarget.value as AccessibilityOverlayMode)
              }
            >
              <For each={ACCESSIBILITY_OVERLAY_MODES}>
                {(mode) => <option value={mode}>{ACCESSIBILITY_OVERLAY_MODE_LABELS[mode]}</option>}
              </For>
            </select>
            <Icon name="chevron-down" size={10} class="pointer-events-none absolute right-1.5" />
          </label>
          <Show when={!props.recording}>
            <button
              type="button"
              class="app-map-icon-button"
              aria-label="Close device"
              data-tip="Close device · D"
              onClick={props.onClose}
            >
              <Icon name="x" size={13} />
            </button>
          </Show>
        </div>
      </header>
      <DeviceCompanionStage
        onOpenTargets={props.onOpenTargets}
        preparing={props.status.kind === "progress"}
        onOrientation={(orientation) => {
          setRenderedOrientation(orientation);
          props.onOrientation?.(orientation);
        }}
      />
      <Show
        when={props.recording ? props.take : null}
        fallback={
          <Show when={props.outsideMapApp || props.unmapped || props.mappedScreenName}>
            <footer class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-[var(--map-divider)] bg-[var(--map-control-surface)] px-3">
              <span class="min-w-0 text-[11px] text-[var(--text-weak)]">
                {props.outsideMapApp
                  ? `Return to ${props.mapName?.trim() || "the mapped app"} to capture a screen`
                  : props.unmapped
                    ? `Add this screen to ${props.mapName?.trim() || "the map"}`
                    : `Continue from ${props.mappedScreenName}`}
              </span>
              <Show
                when={props.unmapped && !props.outsideMapApp}
                fallback={
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      size="lg"
                      disabled={props.captureBusy}
                      aria-busy={props.captureBusy}
                      data-tip="Refresh this screen's saved screenshot"
                      onClick={props.onSaveScreen}
                    >
                      <Icon
                        name={props.captureBusy ? "refresh" : "camera"}
                        size={13}
                        class={
                          props.captureBusy ? "ui-refresh-spin motion-reduce:opacity-70" : undefined
                        }
                      />
                      Screenshot
                    </Button>
                    <Button
                      variant="primary"
                      size="lg"
                      class="shrink-0"
                      disabled={!props.canRecord}
                      onClick={props.onRecord}
                    >
                      Start recording
                    </Button>
                  </div>
                }
              >
                <Button
                  variant="primary"
                  size="lg"
                  class="shrink-0"
                  disabled={props.captureBusy}
                  aria-busy={props.captureBusy}
                  onClick={props.onSaveScreen}
                >
                  <Icon
                    name={props.captureBusy ? "refresh" : "camera"}
                    size={13}
                    class={
                      props.captureBusy ? "ui-refresh-spin motion-reduce:opacity-70" : undefined
                    }
                  />
                  {props.captureBusy ? "Saving…" : "Save screen"}
                </Button>
              </Show>
            </footer>
          </Show>
        }
      >
        {(take) => (
          <TakeCaptureBar
            take={take()}
            {...(props.captureContextLabel ? { contextLabel: props.captureContextLabel } : {})}
            onStop={props.onStop}
          />
        )}
      </Show>
    </aside>
  );
}
