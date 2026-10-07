import { execAndroidAdb } from "./android-adb-host.js";
import { recordNativeViewport } from "./native-target-profile.js";

/** Input-manager metadata describes the active full display without reading
 * accessibility, starting a screenshot, changing focus or acquiring input. */
export function parseAndroidNativeViewport(
  metadata: string,
): { width: number; height: number } | undefined {
  const frames = new Map<string, { width: number; height: number }>();
  for (const line of metadata.split("\n")) {
    if (!/Viewport INTERNAL:.*\bdisplayId=0,/.test(line) || !/\bisActive=\[1\]/.test(line))
      continue;
    const orientation = /\borientation=([0-3]),/.exec(line);
    const frame = /\blogicalFrame=\[0,\s*0,\s*(\d+),\s*(\d+)\]/.exec(line);
    if (!orientation || !frame) continue;
    const width = Number(frame[1]),
      height = Number(frame[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
      continue;
    frames.set(`${orientation[1]}:${width}x${height}`, { width, height });
  }
  return frames.size === 1 ? [...frames.values()][0] : undefined;
}

export async function observeAndroidNativeViewport(
  serial: string,
  execute: typeof execAndroidAdb = execAndroidAdb,
): Promise<{ width: number; height: number } | undefined> {
  const result = await execute(["-s", serial, "shell", "dumpsys", "input"], {
    timeout: 1500,
    maxBuffer: 1024 * 1024,
  });
  const viewport = parseAndroidNativeViewport(result.stdout);
  if (viewport) recordNativeViewport({ targetId: serial, platform: "android" }, viewport);
  return viewport;
}
