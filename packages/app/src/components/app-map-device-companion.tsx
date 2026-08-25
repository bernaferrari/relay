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
  liveRun?: {
    title: string;
    state: "queued" | "running" | "paused";
    completedSteps: number;
    totalSteps?: number;
    caseLabel?: string;
  };
  onOpenRun?: () => void;
  onClose: () => void;
  onOpenTargets: () => void;
  onSaveScreen: () => void;
  onSurveyPage: () => void;
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
              "bottom-4 rounded-2xl max-[900px]:top-auto max-[900px]:right-2 max-[900px]:bottom-2 max-[900px]:left-2 max-[900px]:h-[min(72vh,680px)] max-[900px]:w-auto",
              "w-[min(var(--app-map-device-panel-width),calc(100%-32px))]",
            )
          : "h-[276px] w-[min(344px,calc(100%-32px))] rounded-2xl max-[900px]:right-2 max-[900px]:left-2 max-[900px]:w-auto",
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
          <Show when={!props.recording}>
            <button
              type="button"
              class="app-map-icon-button"
              aria-label="Capture full scrollable page"
              data-tip="Capture full page · preserves every viewport and stops if a seam is uncertain"
              disabled={props.captureBusy}
              onClick={props.onSurveyPage}
            >
              <Icon name="scan" size={13} />
            </button>
          </Show>
          <label
            class="relative inline-flex h-7 items-center rounded-md pl-2 text-caption text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-base)]"
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
      <Show when={props.liveRun}>
        {(run) => (
          <button
            type="button"
            class="group relative flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--map-divider)] bg-[var(--surface-base)] px-3 text-left hover:bg-[var(--surface-base-hover)]"
            aria-label={`Open run details for ${run().title}`}
            onClick={props.onOpenRun}
          >
            <span
              class={cn(
                "size-2 shrink-0 rounded-full bg-[var(--border-selected)]",
                run().state === "running" && "motion-safe:animate-pulse",
              )}
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-caption font-medium text-[var(--text-strong)]">
                {run().state === "queued"
                  ? "Queued"
                  : run().state === "paused"
                    ? "Paused"
                    : "Running"}
                <span class="font-normal text-[var(--text-weak)]"> · {run().title}</span>
              </span>
              <Show when={run().caseLabel}>
                {(label) => (
                  <span class="block truncate text-micro text-[var(--text-weak)]">{label()}</span>
                )}
              </Show>
            </span>
            <span class="shrink-0 text-micro tabular-nums text-[var(--text-weak)]">
              {run().totalSteps
                ? `${Math.min(run().completedSteps, run().totalSteps!)} / ${run().totalSteps}`
                : run().completedSteps
                  ? `${run().completedSteps} done`
                  : "Starting…"}
            </span>
            <Icon
              name="chevron-right"
              size={11}
              class="shrink-0 text-[var(--icon-neutral-muted)] group-hover:text-[var(--icon-neutral-base)]"
            />
            <Show when={run().totalSteps && run().totalSteps! > 0}>
              <span
                class="absolute inset-x-0 bottom-0 h-px origin-left bg-[var(--border-selected)] transition-transform duration-200 ease-out"
                style={{
                  transform: `scaleX(${Math.min(1, run().completedSteps / run().totalSteps!)})`,
                }}
                aria-hidden="true"
              />
            </Show>
          </button>
        )}
      </Show>
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
            <footer class="flex min-h-14 shrink-0 items-center gap-3 border-t border-[var(--map-divider)] bg-[var(--map-control-surface)] px-3">
              <span
                class="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-[var(--text-weak)]"
                data-tip={
                  props.outsideMapApp
                    ? `Return to ${props.mapName?.trim() || "the mapped app"} before capturing.`
                    : props.unmapped
                      ? `Add this screen to ${props.mapName?.trim() || "the map"}.`
                      : `Continue from ${props.mappedScreenName}.`
                }
              >
                <Icon
                  name={props.outsideMapApp ? "map" : props.unmapped ? "plus" : "arrow-right"}
                  size={13}
                  class="shrink-0 text-[var(--icon-neutral-muted)]"
                  aria-hidden={true}
                />
                <span class="truncate">
                  {props.outsideMapApp
                    ? "Return to map"
                    : props.unmapped
                      ? "New screen"
                      : `From ${props.mappedScreenName}`}
                </span>
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
                  {props.captureBusy ? "Saving…" : "Save first screen"}
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
