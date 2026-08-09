import { Show } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { DeviceStage } from "./stage";

export type DeviceCompanionOrientation = "portrait" | "landscape" | "square" | "unknown";

/**
 * The one live-device presentation used by both saved and unsaved App Maps.
 * iOS physical devices can expose a portrait pixel buffer while XCTest reports
 * a landscape logical viewport; presentation is corrected here without
 * changing the canonical screenshot or the interaction transport.
 */
export function DeviceCompanionStage(props: {
  preparing: boolean;
  onOpenTargets: () => void;
  onOrientation?: (orientation: DeviceCompanionOrientation) => void;
}) {
  const server = useServer();

  return (
    <div
      class={cn(
        "relative z-0 min-h-0 flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--background-base)_76%,var(--map-canvas))]",
        "[&>section]:!p-2",
        "[&_[data-device-chrome]]:!bg-transparent [&_[data-device-chrome]]:!p-0 [&_[data-device-chrome]]:!shadow-none",
        "[&_.phone-screen]:!rounded-[8px] [&_.phone-screen]:shadow-[0_1px_2px_rgb(0_0_0/10%),0_16px_42px_-24px_rgb(0_0_0/34%)]",
      )}
    >
      <DeviceStage
        onOpenTargets={props.onOpenTargets}
        recordingControls="embedded"
        preparing={props.preparing}
        onOrientation={props.onOrientation}
      />
      <Show when={server.health() !== "online" && server.liveFrame()?.base64}>
        <div class="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
          <span class="rounded-full bg-black/72 px-2.5 py-1 text-[10.5px] font-medium text-white shadow-sm backdrop-blur-sm">
            Last frame · reconnect to control
          </span>
        </div>
      </Show>
    </div>
  );
}
