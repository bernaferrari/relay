import { Show, createMemo, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import type { RecordingTake } from "../context/recorder";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { TakeCaptureBar } from "./app-map-capture-review";
import { DeviceStatusLabel, type AppMapDeviceStatus } from "./device-status-label";
import { companionFooterMode } from "./app-map-device-companion-geometry";
import { DeviceCompanionStage, type DeviceCompanionOrientation } from "./device-companion-stage";

export function AppMapDeviceCompanion(props: {
  closing: boolean;
  deviceSelected: boolean;
  status: AppMapDeviceStatus;
  recording: boolean;
  take: RecordingTake | null;
  arming: boolean;
  captureBusy: boolean;
  canRecord: boolean;
  recordLabel: string;
  recordContextLabel: string | undefined;
  captureContextLabel: string | undefined;
  onClose: () => void;
  onOpenTargets: () => void;
  onRecord: () => void;
  onStop: () => void;
  onOrientation?: (orientation: DeviceCompanionOrientation) => void;
}) {
  const [renderedOrientation, setRenderedOrientation] =
    createSignal<DeviceCompanionOrientation>("unknown");
  const footerMode = createMemo(() =>
    companionFooterMode({
      deviceSelected: props.deviceSelected,
      canRecord: props.canRecord,
      arming: props.arming,
      captureBusy: props.captureBusy,
    }),
  );
  return (
    <aside
      class={cn(
        "ui-device-companion absolute top-4 right-4 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--map-control-surface)] shadow-[var(--map-elevation-panel)]",
        props.closing && "ui-device-companion--closing",
        props.deviceSelected
          ? cn(
              "bottom-4 rounded-[14px] max-[900px]:top-auto max-[900px]:right-2 max-[900px]:bottom-2 max-[900px]:left-2 max-[900px]:h-[min(72vh,680px)] max-[900px]:w-auto",
              renderedOrientation() === "landscape"
                ? "w-[min(548px,calc(100%-32px))]"
                : "w-[min(388px,calc(100%-32px))]",
            )
          : "h-[276px] w-[min(344px,calc(100%-32px))] rounded-[14px] max-[900px]:right-2 max-[900px]:left-2 max-[900px]:w-auto",
      )}
      data-frame-orientation={renderedOrientation()}
      aria-label="Device"
    >
      <header class="relative z-[100] flex min-h-12 shrink-0 items-center justify-between border-b border-[var(--map-divider)] px-4">
        <DeviceStatusLabel status={props.status} />
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
          <Show when={footerMode() !== "hidden"}>
            <footer
              class={cn(
                "flex min-h-[68px] shrink-0 items-center border-t border-[var(--map-divider)] bg-[var(--map-control-surface)] px-4",
                props.recordContextLabel ? "justify-between gap-3" : "justify-center",
              )}
            >
              <Show when={props.recordContextLabel}>
                <div class="grid min-w-0 gap-0.5">
                  <span class="text-[9.5px] font-medium tracking-[0.04em] text-[var(--text-weak)] uppercase">
                    Next action
                  </span>
                  <strong class="truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                    {props.recordContextLabel}
                  </strong>
                </div>
              </Show>
              <Button
                variant="primary"
                size="lg"
                class={props.recordContextLabel ? "min-w-[116px]" : "min-w-[148px]"}
                disabled={footerMode() === "busy"}
                aria-busy={footerMode() === "busy"}
                onClick={props.onRecord}
              >
                <Show
                  when={footerMode() === "busy"}
                  fallback={<i class="size-2 rounded-full bg-white/90" />}
                >
                  <Icon name="refresh" size={13} class="ui-refresh-spin motion-reduce:opacity-70" />
                </Show>
                {props.recordLabel}
              </Button>
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
