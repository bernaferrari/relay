import { Show } from "solid-js";
import type { RecordingTake } from "../context/recorder";
import { cn } from "../lib/cn";
import { DeviceStage } from "./stage";
import { Icon } from "./icon";
import { TakeCaptureBar } from "./journey-capture-review";

export type AppMapDeviceStatus = {
  label: string;
  tone: "success" | "critical" | "weak" | "warning";
};

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
  captureContextLabel: string | undefined;
  onClose: () => void;
  onOpenTargets: () => void;
  onRecord: () => void;
  onStop: () => void;
}) {
  return (
    <aside
      class={cn(
        "ui-device-companion absolute top-4 right-4 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--map-control-surface)] shadow-[var(--map-elevation-panel)]",
        props.closing && "ui-device-companion--closing",
        props.deviceSelected
          ? "bottom-4 w-[min(388px,calc(100%-32px))] rounded-[18px] max-[720px]:top-auto max-[720px]:right-2 max-[720px]:bottom-2 max-[720px]:left-2 max-[720px]:h-[min(72vh,680px)] max-[720px]:w-auto"
          : "h-[276px] w-[min(344px,calc(100%-32px))] rounded-[18px] max-[720px]:right-2 max-[720px]:left-2 max-[720px]:w-auto",
      )}
      aria-label="Device"
    >
      <header class="relative z-[100] flex min-h-12 shrink-0 items-center justify-between border-b border-[var(--map-divider)] px-4">
        <span
          class="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium text-[var(--text-base)]"
          role="status"
          aria-live="polite"
        >
          <i
            class={cn(
              "size-1.5 shrink-0 rounded-full",
              props.status.tone === "success"
                ? "bg-[var(--icon-success-base)]"
                : props.status.tone === "critical"
                  ? "bg-[var(--icon-critical-base)]"
                  : props.status.tone === "weak"
                    ? "bg-[var(--icon-weak)]"
                    : "bg-[var(--icon-warning-base)]",
            )}
            aria-hidden="true"
          />
          {props.status.label}
        </span>
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
      <div class="relative z-0 min-h-0 flex-1 overflow-visible">
        <DeviceStage onOpenTargets={props.onOpenTargets} recordingControls="embedded" />
      </div>
      <Show
        when={props.recording ? props.take : null}
        fallback={
          <Show when={props.deviceSelected}>
            <footer class="flex min-h-16 shrink-0 items-center justify-center border-t border-[var(--map-divider)] px-4">
              <button
                type="button"
                class="app-map-record-button min-w-[148px]"
                disabled={!props.canRecord || props.arming || props.captureBusy}
                aria-busy={props.arming || props.captureBusy}
                onClick={props.onRecord}
              >
                <Show
                  when={props.arming || props.captureBusy}
                  fallback={<i class="size-2 rounded-full bg-white/90" />}
                >
                  <Icon name="refresh" size={13} class="ui-refresh-spin motion-reduce:opacity-70" />
                </Show>
                {props.recordLabel}
              </button>
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
