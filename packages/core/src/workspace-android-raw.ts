/**
 * Session-free Android input. Mirroring and point taps must work even when
 * agent-device does not own UiAutomation.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { adbSwipeInputArgs } from "./adb-input.js";
import { resolveAndroidSdkToolSync } from "./android-sdk-tools.js";

/** SurfaceFlinger IDs exceed JavaScript's safe integer range; keep them as strings. */
export function primaryAndroidDisplay(displays: string): string | undefined {
  const primary = displays.match(/^Display (\d+) \(HWC display 0\)/m)?.[1];
  if (primary) return primary;
  const ids = [...displays.matchAll(/^Display (\d+)/gm)].map((match) => match[1]!);
  if (ids.length > 1) throw new Error("Cannot identify the primary Android display");
  return ids[0];
}

export function rawScreenshot(path: string, serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const adb = resolveAndroidSdkToolSync("adb");
  const displays = execFileSync(
    adb,
    ["-s", serial, "shell", "dumpsys", "SurfaceFlinger", "--display-id"],
    { encoding: "utf8", timeout: 5000 },
  );
  const displayId = primaryAndroidDisplay(displays);
  const args = [
    "-s",
    serial,
    "exec-out",
    "screencap",
    "-p",
    ...(displayId ? ["-d", displayId] : []),
  ];
  const buf = execFileSync(resolveAndroidSdkToolSync("adb"), args, {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 10_000,
  });
  writeFileSync(path, buf);
}

/** Raw adb input tap — works without a session, on any app. */
export function rawTap(x: number, y: number, serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const args = ["-s", serial, "shell", "input", "tap", String(x), String(y)];
  execFileSync(resolveAndroidSdkToolSync("adb"), args, { timeout: 5000 });
}

export function androidKeyCode(
  key: "enter" | "backspace" | "back" | "home" | "recents",
): "KEYCODE_ENTER" | "KEYCODE_DEL" | "KEYCODE_BACK" | "KEYCODE_HOME" | "KEYCODE_APP_SWITCH" {
  if (key === "enter") return "KEYCODE_ENTER";
  if (key === "backspace") return "KEYCODE_DEL";
  if (key === "back") return "KEYCODE_BACK";
  if (key === "recents") return "KEYCODE_APP_SWITCH";
  return "KEYCODE_HOME";
}

/** Raw adb key input — keeps navigation and keyboard control available without a live stream. */
export function rawKey(
  key: "enter" | "backspace" | "back" | "home" | "recents",
  serial?: string,
): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const keyCode = androidKeyCode(key);
  execFileSync(
    resolveAndroidSdkToolSync("adb"),
    ["-s", serial, "shell", "input", "keyevent", keyCode],
    {
      timeout: 5000,
    },
  );
}

/** Raw adb input swipe — works without a session, on any app. */
export function rawSwipe(
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
  serial?: string,
): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const inputArgs = adbSwipeInputArgs(from, to, durationMs);
  const args = ["-s", serial, "shell", ...inputArgs];
  execFileSync(resolveAndroidSdkToolSync("adb"), args, { timeout: 8000 });
}
