/** @jsxImportSource react */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { DeviceFrame, shapeForSize } from "../components/device-frame";
import { useRecordingLivePreview } from "./recording-live-preview";

export type NativeRunPreviewTarget = { platform: "ios" | "android"; targetId: string };

/** Observe the device while the Run owns its controls. */
export function LiveNativeRunPreview({
  target,
  targetName,
  fallback,
  fallbackCaption,
}: {
  target: NativeRunPreviewTarget;
  targetName?: string;
  /** The Run's latest retained screenshot, without review or input controls. */
  fallback?: ReactNode;
  fallbackCaption?: string;
}) {
  return (
    <NativeRunPreview
      key={`${target.platform}:${target.targetId}`}
      target={target}
      targetName={targetName}
      fallback={fallback}
      fallbackCaption={fallbackCaption}
    />
  );
}

function unavailableDetail(issue?: string): { title: string; detail: string } {
  if (/403|forbidden|unauthorized|not authorized|denied|permission|not allowed/iu.test(issue ?? ""))
    return {
      title: "Live view blocked",
      detail: "Relay cannot observe this device with the current access.",
    };
  if (/producer|ios-preview:build/iu.test(issue ?? ""))
    return {
      title: "Live view unavailable",
      detail: "The safe iOS preview producer is unavailable on this Relay host.",
    };
  return {
    title: "Live view unavailable",
    detail: /has not sent.*preview/iu.test(issue ?? "")
      ? "The device has not sent live pixels yet."
      : "The live pixel stream is unavailable.",
  };
}

function NativeRunPreview({
  target,
  targetName,
  fallback,
  fallbackCaption = "Latest captured screenshot · not live",
}: {
  target: NativeRunPreviewTarget;
  targetName?: string;
  fallback?: ReactNode;
  fallbackCaption?: string;
}) {
  const { productService } = useRouteContext({ from: "__root__" });
  const selectedTarget = useMemo(
    () => ({ kind: "device" as const, ...target }),
    [target.platform, target.targetId],
  );
  const { liveCanvas, liveCanvasSize, liveStatus, previewIssue } = useRecordingLivePreview({
    enabled: true,
    selectedTarget,
    createLiveTarget: productService.previewTarget,
    inspectAccessibility: false,
  });
  const streaming = liveStatus === "streaming";
  const unavailable =
    !productService.previewTarget || ["degraded", "offline", "closed"].includes(liveStatus);
  const issue = unavailableDetail(previewIssue);
  const width = streaming ? (liveCanvasSize?.width ?? 9) : 9;
  const height = streaming ? (liveCanvasSize?.height ?? 19) : 19;
  const shape = streaming ? shapeForSize(width, height, target.platform) : "phone";

  return (
    <section
      aria-label="Live device preview"
      data-slot="live-native-run-preview"
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3"
    >
      <div className={unavailable ? "hidden" : "@container-size relative min-h-0 w-full flex-1"}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative aspect-(--native-preview-ratio) h-auto w-[min(100cqw,calc(100cqh*var(--native-preview-ratio)))]"
            style={{ "--native-preview-ratio": width / height } as CSSProperties}
          >
            <DeviceFrame
              alt={`Live device: ${targetName ?? target.platform}`}
              shape={shape}
              platform={target.platform}
              className="[&]:absolute [&]:inset-0 [&]:h-full [&]:w-full [&]:max-w-full [&>[data-slot=device-frame-screen]]:h-full [&_[data-slot=device-frame-content]]:h-full [&_[data-slot=device-frame-content]]:w-full [&_[data-slot=device-frame-content]]:aspect-auto [&_[data-slot=device-frame-content]]:px-0"
              placeholder={
                <div className="relative h-full w-full overflow-hidden bg-card">
                  <canvas
                    ref={liveCanvas}
                    aria-label={`Live device: ${targetName ?? target.platform}`}
                    data-slot="live-native-run-canvas"
                    className="pointer-events-none block h-full max-h-full w-full max-w-full object-contain"
                  />
                  {!streaming ? (
                    <div
                      role="status"
                      aria-label="Connecting to live device preview"
                      aria-busy="true"
                      className="absolute inset-0 flex flex-col justify-center gap-6 bg-card px-6 text-center text-sm text-muted-foreground"
                    >
                      <div aria-hidden="true" className="grid gap-3">
                        <div className="h-5 w-2/3 rounded bg-muted/40" />
                        <div className="h-24 rounded-lg bg-muted/25" />
                        <div className="h-3 rounded bg-muted/30" />
                        <div className="h-3 w-4/5 rounded bg-muted/30" />
                      </div>
                      <span>Connecting to live view…</span>
                    </div>
                  ) : null}
                </div>
              }
            />
          </div>
        </div>
      </div>
      {unavailable ? (
        <>
          <div role="status" className="shrink-0 text-center text-sm">
            <p className="font-medium">{issue.title}</p>
            <p className="mt-1 text-muted-foreground">{issue.detail}</p>
          </div>
          {fallback ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex min-h-0 flex-1 items-center justify-center">{fallback}</div>
              <p className="shrink-0 text-center text-xs text-muted-foreground">
                {fallbackCaption}
              </p>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Captured screenshots will appear as the Test reaches them.
            </p>
          )}
        </>
      ) : (
        <p className="shrink-0 text-center text-xs text-muted-foreground">
          {streaming ? "Live device · read only" : "Waiting for live pixels"}
        </p>
      )}
    </section>
  );
}
