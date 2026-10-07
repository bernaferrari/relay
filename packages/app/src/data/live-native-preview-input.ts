import type { RelayClient } from "@relay/client";
import type { AuthoringTarget } from "@relay/protocol";
import { RecordingInputNotSentError } from "./recording-input-outcome";
import type { LiveTargetInput } from "./live-target-session";

/** Android direct touches use normalized scrcpy coordinates. Authored inputs,
 * swipes and iOS point commands use observed native viewport coordinates. */
export function nativePreviewNeedsLogicalCoordinates(
  target: AuthoringTarget,
  value: LiveTargetInput,
  recording: boolean,
): value is Extract<LiveTargetInput, { kind: "touch" | "scroll" }> {
  return (
    target.kind === "device" &&
    (value.kind === "touch" || value.kind === "scroll") &&
    (recording || value.kind === "scroll" || target.platform === "ios")
  );
}

/** PNG dimensions cannot establish iOS's logical XCTest/HID coordinate space. */
export async function nativePreviewDimensions(
  client: Pick<RelayClient, "invoke">,
  serial: string,
  platform: AuthoringTarget["platform"],
): Promise<{ width: number; height: number }> {
  let size: { width?: number; height?: number } | undefined;
  try {
    const snapshot = await client.invoke("target.snapshot.capture", { serial });
    size = snapshot.bounds;
  } catch {
    // Android can use screenshot pixels. iOS requires observed logical bounds.
  }
  if (!validDimensions(size)) {
    if (platform === "ios")
      throw new RecordingInputNotSentError(
        "Couldn’t read the iOS logical screen dimensions. Reconnect the preview and try again.",
      );
    try {
      size = await client.invoke("target.screenshot.capture", { serial, ephemeral: true });
    } catch {
      throw new RecordingInputNotSentError(
        "Couldn’t read the screen dimensions. Reconnect the preview and try again.",
      );
    }
  }
  if (!validDimensions(size))
    throw new RecordingInputNotSentError("Relay couldn’t read the device screen size.");
  return size;
}

function validDimensions(
  size: { width?: number; height?: number } | undefined,
): size is { width: number; height: number } {
  return Boolean(
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width! > 0 &&
    size.height! > 0,
  );
}

/** Dispatch a complete iOS input once through the canonical interaction
 * authority. It must never enter Android's scrcpy down/up or keyboard paths. */
export async function sendIosPreviewInput(
  client: Pick<RelayClient, "invoke">,
  serial: string,
  value: LiveTargetInput,
): Promise<boolean> {
  if (value.kind === "touch") {
    if (value.action !== "up")
      throw new RecordingInputNotSentError(
        "The iOS preview supports complete taps, not individual touch phases.",
      );
    await client.invoke("target.interact", { serial, kind: "point", x: value.x, y: value.y });
    return true;
  }
  if (
    value.kind === "text" ||
    (value.kind === "key" && "text" in value && typeof value.text === "string")
  ) {
    await client.invoke("target.interact", { serial, kind: "type", text: value.text });
    return true;
  }
  if (value.kind === "key") {
    const key =
      value.key === "Enter" ? "enter" : value.key === "Backspace" ? "backspace" : value.key;
    if (key !== "enter" && key !== "backspace" && key !== "back" && key !== "home")
      throw new RecordingInputNotSentError(`The iOS preview does not support ${key}.`);
    await client.invoke("target.interact", { serial, kind: "key", key });
    return true;
  }
  return false;
}
