/**
 * Pluggable live-preview transports for physical Apple devices.
 *
 * Control (tap/AX/crawl) is agent-device XCTest. Preview:
 * - go-ios-auto / go-ios-mjpeg: Instruments screenshot MJPEG (default)
 * - agent-device-png: PNG polling fallback
 *
 * Android H.264/scrcpy is unchanged.
 */

export const IOS_LIVE_PREVIEW_BACKENDS = [
  "agent-device-png",
  "go-ios-auto",
  "go-ios-mjpeg",
] as const;

export type IosLivePreviewBackend = (typeof IOS_LIVE_PREVIEW_BACKENDS)[number];

export type IosLivePreviewSettings = {
  backend: IosLivePreviewBackend;
};

export const DEFAULT_IOS_LIVE_PREVIEW: IosLivePreviewSettings = {
  backend: "go-ios-auto",
};

/** Older settings persisted during the first experiment. */
const LEGACY_BACKEND_ALIASES: Record<string, IosLivePreviewBackend> = {
  "go-ios": "go-ios-auto",
  "go-ios-stream": "go-ios-auto",
  "go-ios-devicekit": "go-ios-mjpeg",
};

export function isIosLivePreviewBackend(value: unknown): value is IosLivePreviewBackend {
  return (
    typeof value === "string" && (IOS_LIVE_PREVIEW_BACKENDS as readonly string[]).includes(value)
  );
}

export function parseIosLivePreviewSettings(value: unknown): IosLivePreviewSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_IOS_LIVE_PREVIEW };
  const record = value as Record<string, unknown>;
  const raw = typeof record.backend === "string" ? record.backend : "";
  const aliased = LEGACY_BACKEND_ALIASES[raw] ?? raw;
  const backend = isIosLivePreviewBackend(aliased) ? aliased : DEFAULT_IOS_LIVE_PREVIEW.backend;
  return { backend };
}

export function iosLivePreviewUsesStream(backend: IosLivePreviewBackend): boolean {
  return backend !== "agent-device-png";
}

/**
 * What the product UI can paint today. DeviceVideoStream draws JPEG (kind 2)
 * and Android scrcpy H.264.
 */
export function iosLivePreviewUiFormat(backend: IosLivePreviewBackend): "jpeg" | "png" {
  return backend === "agent-device-png" ? "png" : "jpeg";
}

export function iosLivePreviewLabel(backend: IosLivePreviewBackend): string {
  switch (backend) {
    case "go-ios-auto":
      return "go-ios live stream (Instruments MJPEG)";
    case "go-ios-mjpeg":
      return "go-ios Instruments MJPEG";
    case "agent-device-png":
    default:
      return "PNG preview fallback (agent-device)";
  }
}

export function iosLivePreviewDescription(backend: IosLivePreviewBackend): string {
  switch (backend) {
    case "go-ios-auto":
      return "Default live preview: go-ios Instruments MJPEG. Screenshots stay evidence-only. Taps use the XCTest runner.";
    case "go-ios-mjpeg":
      return "go-ios Instruments screenshot service as MJPEG. Needs ios tunnel on iOS 17+.";
    case "agent-device-png":
    default:
      return "Explicit PNG polling through the XCTest runner. Use only when the live stream is unavailable.";
  }
}
