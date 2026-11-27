/**
 * Ephemeral in-memory screenshot capture. Model-input frames are transient
 * observation, never evidence: the browser raster travels straight from
 * Playwright/CDP into memory with no temporary file, no job attachment, and
 * a payload that carries no path at all, so it can never leak into artifact
 * retention. Evidence capture keeps using captureScreenshot in
 * workspace-capture.ts — its disk artifact is the retention contract, and
 * nothing here changes it.
 */
import { type Device } from "../device/device.js";
import { now, publish } from "../collaboration/events.js";
import { pngDimensions } from "../ios/ios-geometry.js";
import { runWithTargetContext, targetIdentity } from "../target/target-context.js";
import { captureScreenshot, cleanupScreenshot } from "./workspace-capture.js";
import { resolveRuntimeTarget, type RuntimeTargetOverlay } from "./workspace-devices.js";
import { withSession } from "./workspace-ios-session.js";

export type InMemoryScreenshot = {
  mime: "image/png";
  base64: string;
  bytes: number;
  capturedAt: number;
  width?: number;
  height?: number;
};

/**
 * Capture one ephemeral frame without a disk roundtrip. Browser targets go
 * straight to memory; native transports are file-based end to end, so they
 * keep their existing capture and simply clean the temporary file inside the
 * call — the frame still never becomes an artifact.
 */
export async function captureScreenshotInMemory(opts?: {
  serial?: string;
  device?: Device;
  overlay?: RuntimeTargetOverlay;
}): Promise<InMemoryScreenshot> {
  const target = await resolveRuntimeTarget(opts?.serial, opts?.device, opts?.overlay);
  if (target.context.kind !== "browser") {
    const shot = await captureScreenshot({
      ...(opts?.serial ? { serial: opts.serial } : {}),
      ...(opts?.device ? { device: opts.device } : {}),
      ...(opts?.overlay ? { overlay: opts.overlay } : {}),
      ephemeral: true,
      includeScreenMatch: false,
    });
    try {
      return {
        mime: "image/png",
        base64: shot.base64,
        bytes: shot.bytes,
        capturedAt: shot.capturedAt,
        ...(shot.width !== undefined ? { width: shot.width } : {}),
        ...(shot.height !== undefined ? { height: shot.height } : {}),
      };
    } finally {
      await cleanupScreenshot(shot.path).catch(() => undefined);
    }
  }
  return runWithTargetContext(target.context, async () => {
    // No path is the whole point: the browser device facade answers with the
    // raster itself instead of writing it, the exact bytes CDP produced.
    // No targeting fields either: the facade is already bound to its browser
    // session, so there is no daemon routing for base() to steer.
    const captured = await withSession(
      target.device,
      () => target.device.capture.screenshot(),
      "screenshot",
    );
    if (!captured.base64) {
      throw new Error("browser capture did not return in-memory pixels");
    }
    const bytes = Buffer.from(captured.base64, "base64");
    const dimensions = pngDimensions(bytes);
    const capturedAt = now();
    publish({
      type: "screenshot.captured",
      at: capturedAt,
      serial: targetIdentity(),
      bytes: bytes.byteLength,
    });
    return {
      mime: "image/png",
      base64: captured.base64,
      bytes: bytes.byteLength,
      capturedAt,
      ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    };
  });
}
