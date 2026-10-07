import {
  liveIosRunnerCommandIsBusy,
  postLiveIosRunnerCommand,
  type LiveIosRunnerCommandPost,
} from "./ios-runner-listener-command.js";
import { probeLiveIosRunnerListener } from "./ios-runner-listener.js";
import { resolveIosLaunchBundleId } from "./ios-app-launch.js";

export class IosNativeViewportUnavailableError extends Error {
  constructor(
    readonly reason:
      | "runner-unavailable"
      | "runner-busy"
      | "bounds-unavailable"
      | "origin-unavailable",
  ) {
    super(
      reason === "runner-busy"
        ? "The device is still finishing an inspection."
        : "Relay could not read the device’s current application bounds.",
    );
  }
}

/** Explicit admission observation, never passive inventory. The producer proves
 * this saved app is foreground before and after a current window-only read in
 * logical application coordinates. No snapshot, activation or input is sent. */
export async function observeIosNativeViewport(
  serial: string,
  originApplication: string,
  runtime: {
    probeListener: typeof probeLiveIosRunnerListener;
    post: (...args: Parameters<LiveIosRunnerCommandPost>) => Promise<unknown>;
  } = { probeListener: probeLiveIosRunnerListener, post: postLiveIosRunnerCommand },
): Promise<{ width: number; height: number }> {
  let appBundleId: string;
  try {
    appBundleId = resolveIosLaunchBundleId(originApplication);
  } catch {
    throw new IosNativeViewportUnavailableError("origin-unavailable");
  }
  const listener = await runtime.probeListener(serial);
  if (!listener || listener.serial !== serial)
    throw new IosNativeViewportUnavailableError("runner-unavailable");
  const response = await runtime.post(
    listener,
    { command: "appWindowBounds", appBundleId, timeoutMs: 15_000 },
    20_000,
  );
  const result =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : undefined;
  if (!result) throw new IosNativeViewportUnavailableError("bounds-unavailable");
  if (liveIosRunnerCommandIsBusy(result))
    throw new IosNativeViewportUnavailableError("runner-busy");
  const data =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : undefined;
  if (
    result.ok !== true ||
    data?.appBundleId !== appBundleId ||
    data.appStateBefore !== "runningForeground" ||
    data.appStateAfter !== "runningForeground" ||
    data.source !== "current-window" ||
    data.coordinateSpace !== "application-logical" ||
    data.geometrySource !== "xcui-window-frame"
  )
    throw new IosNativeViewportUnavailableError("bounds-unavailable");
  const rect =
    data.bounds && typeof data.bounds === "object" && !Array.isArray(data.bounds)
      ? (data.bounds as Record<string, unknown>)
      : undefined;
  if (
    !rect ||
    typeof rect.x !== "number" ||
    typeof rect.y !== "number" ||
    typeof rect.width !== "number" ||
    typeof rect.height !== "number" ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isSafeInteger(rect.width) ||
    !Number.isSafeInteger(rect.height) ||
    rect.width < 100 ||
    rect.height < 100
  )
    throw new IosNativeViewportUnavailableError("bounds-unavailable");
  return { width: rect.width, height: rect.height };
}
