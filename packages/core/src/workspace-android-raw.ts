/**
 * Session-free Android input. Mirroring and point taps must work even when
 * agent-device does not own UiAutomation.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { adbSwipeInputArgs } from "./adb-input.js";

export function rawScreenshot(path: string, serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const args = ["-s", serial, "exec-out", "screencap", "-p"];
  const buf = execFileSync("adb", args, { maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(path, buf);
}

/** Raw adb input tap — works without a session, on any app. */
export function rawTap(x: number, y: number, serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const args = ["-s", serial, "shell", "input", "tap", String(x), String(y)];
  execFileSync("adb", args, { timeout: 5000 });
}

export function androidKeyCode(
  key: "enter" | "backspace" | "back" | "home",
): "KEYCODE_ENTER" | "KEYCODE_DEL" | "KEYCODE_BACK" | "KEYCODE_HOME" {
  if (key === "enter") return "KEYCODE_ENTER";
  if (key === "backspace") return "KEYCODE_DEL";
  if (key === "back") return "KEYCODE_BACK";
  return "KEYCODE_HOME";
}

/** Raw adb key input — keeps navigation and keyboard control available without a live stream. */
export function rawKey(key: "enter" | "backspace" | "back" | "home", serial?: string): void {
  if (!serial) throw new Error("Explicit Android target serial is required");
  const keyCode = androidKeyCode(key);
  execFileSync("adb", ["-s", serial, "shell", "input", "keyevent", keyCode], {
    timeout: 5000,
  });
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
  execFileSync("adb", args, { timeout: 8000 });
}
