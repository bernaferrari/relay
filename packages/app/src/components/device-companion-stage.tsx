import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import {
  companionFramePresentation,
  companionImageLayout,
  companionLogicalViewport,
  companionOrientationEdge,
} from "./app-map-device-companion-geometry";
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
  let host: HTMLDivElement | undefined;
  const [sourceDimensions, setSourceDimensions] = createSignal<
    { width: number; height: number } | undefined
  >();
  const selectedDevice = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  const presentation = createMemo(() => {
    const frame = sourceDimensions();
    const nodes = server.snapshot()?.nodes;
    const logicalViewport = companionLogicalViewport(nodes);
    const pointScale =
      frame && logicalViewport
        ? Math.max(frame.width, frame.height) /
          Math.max(logicalViewport.width, logicalViewport.height)
        : 1;
    return companionFramePresentation({
      frame,
      logicalViewport:
        logicalViewport && Number.isFinite(pointScale)
          ? {
              width: logicalViewport.width * pointScale,
              height: logicalViewport.height * pointScale,
            }
          : undefined,
      platform: selectedDevice()?.platform,
      edge: companionOrientationEdge(nodes, logicalViewport),
    });
  });

  function present(image: HTMLImageElement): void {
    const displayingLiveFrame = image.dataset.liveFrame === "true";
    if (displayingLiveFrame && image.naturalWidth && image.naturalHeight) {
      const current = sourceDimensions();
      if (current?.width !== image.naturalWidth || current.height !== image.naturalHeight) {
        setSourceDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      }
    }
    const framePresentation = displayingLiveFrame
      ? presentation()
      : companionFramePresentation({
          frame:
            image.naturalWidth && image.naturalHeight
              ? { width: image.naturalWidth, height: image.naturalHeight }
              : undefined,
          logicalViewport: undefined,
          platform: selectedDevice()?.platform,
          edge: undefined,
        });
    props.onOrientation?.(framePresentation?.orientation ?? "unknown");
    const chrome = image.closest<HTMLElement>("[data-device-chrome]");
    if (!framePresentation || !chrome) return;

    const layout = companionImageLayout(framePresentation);
    chrome.style.aspectRatio = layout.aspectRatio;
    if (framePresentation.rotation === "none") {
      for (const property of [
        "position",
        "left",
        "top",
        "width",
        "height",
        "max-width",
        "transform",
        "transform-origin",
      ]) {
        image.style.removeProperty(property);
      }
      return;
    }

    image.style.position = "absolute";
    image.style.left = "50%";
    image.style.top = "50%";
    image.style.width = `${layout.widthPercent}%`;
    image.style.height = `${layout.heightPercent}%`;
    image.style.maxWidth = "none";
    image.style.transformOrigin = "center";
    image.style.transform = `translate(-50%, -50%) rotate(${layout.rotationDegrees}deg)`;
  }

  function normalize(): void {
    const image = host?.querySelector<HTMLImageElement>(
      'img[aria-label="Interactive device screen"]',
    );
    if (image) present(image);
  }

  onMount(() => {
    const onFrameLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) normalize();
    };
    host?.addEventListener("load", onFrameLoad, true);
    normalize();
    onCleanup(() => host?.removeEventListener("load", onFrameLoad, true));
  });
  createEffect(() => {
    const trigger = `${server.liveFrame()?.capturedAt ?? ""}:${server.snapshot()?.capturedAt ?? ""}:${presentation()?.rotation ?? ""}`;
    queueMicrotask(() => {
      if (trigger) normalize();
    });
  });

  return (
    <div
      ref={(element) => {
        host = element;
      }}
      class={cn(
        "relative z-0 min-h-0 flex-1 overflow-hidden bg-[var(--v2-background-bg-layer-01)]",
        "[&>section]:!p-4",
        "[&_[data-device-chrome]]:!bg-transparent [&_[data-device-chrome]]:!p-0 [&_[data-device-chrome]]:!shadow-none",
        "[&_.phone-screen]:!rounded-[12px] [&_.phone-screen]:shadow-[0_1px_2px_rgb(0_0_0/10%),0_16px_42px_-24px_rgb(0_0_0/34%)]",
      )}
    >
      <DeviceStage
        onOpenTargets={props.onOpenTargets}
        recordingControls="embedded"
        preparing={props.preparing}
      />
    </div>
  );
}
