import { createMemo, createSignal, Show, type JSX } from "solid-js";
import {
  companionFramePresentation,
  companionImageLayout,
  type CompanionDimensions,
  type CompanionFramePresentation,
} from "./app-map-device-companion-geometry";

export type ScreenshotOrientationEvidence = {
  logicalViewport?: CompanionDimensions;
  platform?: string;
  edge?: "left" | "right";
};

export type OrientedScreenshotOverlay = (input: {
  rotation: CompanionFramePresentation["rotation"];
}) => JSX.Element;

/** Keep persisted screenshots in the same orientation as the live device. */
export function OrientedScreenshot(props: {
  src: string;
  alt: string;
  evidence?: ScreenshotOrientationEvidence;
  class?: string;
  loading?: JSX.ImgHTMLAttributes<HTMLImageElement>["loading"];
  overlay?: OrientedScreenshotOverlay;
}) {
  const [natural, setNatural] = createSignal<CompanionDimensions>();
  const presentation = createMemo(() =>
    companionFramePresentation({
      frame: natural(),
      logicalViewport: props.evidence?.logicalViewport,
      platform: props.evidence?.platform,
      edge: props.evidence?.edge,
    }),
  );
  const layout = createMemo(() => {
    const value = presentation();
    return value ? companionImageLayout(value) : undefined;
  });

  return (
    <span class="relative block size-full min-h-0 overflow-hidden">
      <img
        src={props.src}
        alt={props.alt}
        loading={props.loading}
        decoding="async"
        draggable={false}
        class={props.class}
        style={
          layout()
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: `${layout()!.widthPercent}%`,
                height: `${layout()!.heightPercent}%`,
                transform: `translate(-50%, -50%) rotate(${layout()!.rotationDegrees}deg)`,
                "transform-origin": "center",
              }
            : undefined
        }
        onLoad={(event) =>
          setNatural({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
      <Show when={props.overlay}>
        {(overlay) => overlay()({ rotation: presentation()?.rotation ?? "none" })}
      </Show>
    </span>
  );
}
