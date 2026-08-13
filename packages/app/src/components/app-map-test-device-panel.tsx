import { Show } from "solid-js";
import { Button } from "@relay/ui/button";
import { deviceReadiness } from "../lib/device-readiness";
import { TestContextEmpty, formatTestContextTime } from "./app-map-test-context-primitives";
import { Icon } from "./icon";

export function AppMapTestDevicePanel(props: {
  frame?: { base64: string; mime: string; caption: string; capturedAt: number };
  deviceSelected: boolean;
  deviceName?: string;
  readiness: ReturnType<typeof deviceReadiness>;
  offline: boolean;
  refreshing: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const message = () =>
    props.readiness.kind === "ready"
      ? undefined
      : props.readiness.kind === "choose-device"
        ? {
            title: "Choose a device",
            detail: "Select a target to see its latest directly observed pixels here.",
          }
        : props.readiness;
  return (
    <div class="grid gap-3">
      <header class="flex min-h-11 items-center justify-between gap-3">
        <div class="min-w-0">
          <strong class="block truncate text-[12px] font-semibold text-text-strong">
            {props.deviceName ?? "No device selected"}
          </strong>
          <span class="mt-0.5 block text-[10.5px] text-text-weak" role="status" aria-live="polite">
            {props.refreshing
              ? "Requesting fresh pixels…"
              : props.frame
                ? `${props.offline ? "Last frame" : "Observed"} · ${formatTestContextTime(props.frame.capturedAt)}`
                : (message()?.title ?? "Live pixels available")}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          class="min-h-11 shrink-0"
          disabled={!props.deviceSelected || props.offline || props.refreshing}
          aria-busy={props.refreshing}
          onClick={props.onRefresh}
        >
          <Icon name="refresh" size={13} class={props.refreshing ? "ui-refresh-spin" : undefined} />
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <Show
        when={props.frame}
        fallback={
          <TestContextEmpty
            icon="smartphone"
            title={message()?.title ?? "Waiting for pixels"}
            detail={message()?.detail ?? "Relay has not observed a frame from this device yet."}
          />
        }
      >
        {(frame) => (
          <figure class="m-0 grid min-h-[220px] place-items-center overflow-hidden rounded-xl border border-border-weak-base bg-[var(--map-canvas)] p-2">
            <img
              src={`data:${frame().mime || "image/png"};base64,${frame().base64}`}
              alt={`${props.deviceName ?? "Selected device"}: ${frame().caption || "observed screen"}`}
              class="max-h-[360px] max-w-full rounded-lg object-contain shadow-[0_1px_2px_rgb(0_0_0/10%),0_16px_42px_-24px_rgb(0_0_0/34%)]"
            />
          </figure>
        )}
      </Show>
      <Show when={props.error}>
        <p
          class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[11px]/[1.5] text-text-critical-base"
          role="alert"
        >
          Pixels were not refreshed. {props.error}
        </p>
      </Show>
    </div>
  );
}
