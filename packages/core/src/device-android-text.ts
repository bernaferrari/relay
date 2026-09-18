import {
  readAndroidClipboardWithAdb,
  writeAndroidClipboardWithAdb,
  type AndroidAdbExecutor,
} from "agent-device/android-adb";
import type { Device, SnapshotNode } from "./device-capabilities.js";
import { controlled, controlledMutation, nativeDevice, base } from "./device-dispatch.js";
import { execAndroidAdb } from "./android-adb-host.js";
import { raceCancel } from "./control.js";
import { currentTargetContext, selectedPlatform, targetIdentity } from "./target-context.js";

export type AndroidTextPasteAdapter = {
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  paste: () => Promise<void>;
};

export type DeviceTextInputDependencies = {
  snapshot: (device: Device) => Promise<SnapshotNode[]>;
  mutateCurrentTarget: <T>(operation: () => Promise<T>) => Promise<T>;
  typeViaLiveIosListener: (text: string) => Promise<boolean>;
};

const ANDROID_IME_PACKAGES = new Set([
  "com.google.android.inputmethod.latin",
  "com.samsung.android.honeyboard",
  "com.touchtype.swiftkey",
  "com.microsoft.swiftkey",
]);

const ANDROID_SHELL_META = /[\\'"`$&;|<>()[\]{}*?!#~]/g;

/** Escape one logical text payload for agent-device's adb-shell fallback.
 * Spaces and line breaks remain logical here: agent-device owns their Android
 * `%s` and Enter translation after this remote-shell safety layer. */
export function escapeAndroidShellText(text: string): string {
  return text.replace(ANDROID_SHELL_META, "\\$&");
}

export function isAndroidClipboardTransportFailure(message: string): boolean {
  return /(?:Android clipboard|clipboard).*(?:not supported|unsupported|unavailable|failed|permission|security)|failed to .*Android clipboard/i.test(
    message,
  );
}

export function isAndroidProviderTextInjectionUnavailable(message: string): boolean {
  return /provider-native text injection|adb-shell fallback supports ASCII text only/i.test(
    message,
  );
}

/**
 * Build the small ADB contract needed by agent-device's clipboard helpers.
 *
 * This deliberately targets the serial explicitly instead of depending on an
 * agent-device session. A physical Android device can remain controllable
 * through ADB while its video/session transport is unavailable.
 */
export function androidAdbExecutor(serial: string): AndroidAdbExecutor {
  return async (args, options = {}) => {
    try {
      const result = await execAndroidAdb(["-s", serial, ...args], {
        timeout: options.timeoutMs,
        signal: options.signal,
        maxBuffer: 20 * 1024 * 1024,
      });
      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        stdoutBuffer: Buffer.from(result.stdout),
      };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      const stdout = String(failure.stdout ?? "");
      const stderr = String(failure.stderr ?? failure.message ?? "adb failed");
      return {
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout,
        stderr,
        stdoutBuffer: Buffer.from(stdout),
      };
    }
  };
}

export async function pasteAndroidTextWithAdb(text: string, serial: string): Promise<void> {
  const adb = androidAdbExecutor(serial);
  await pasteAndroidText(text, {
    readClipboard: () => readAndroidClipboardWithAdb(adb),
    writeClipboard: (value) => writeAndroidClipboardWithAdb(adb, value),
    paste: async () => {
      await raceCancel(
        execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_PASTE"]),
      );
    },
  });
}

/**
 * Paste exact Android text without routing it through `adb shell input text`.
 *
 * Android's shell command cannot reliably represent quotes, Unicode, or newlines.
 * The clipboard channel preserves the payload byte-for-byte; restoring the previous
 * value keeps a Relay action from unexpectedly replacing the person's clipboard.
 */
export async function pasteAndroidText(
  text: string,
  adapter: AndroidTextPasteAdapter,
): Promise<void> {
  let previousClipboard: string | undefined;
  try {
    previousClipboard = await adapter.readClipboard();
  } catch {
    // Clipboard reads can be restricted while writes and paste remain available.
  }

  await adapter.writeClipboard(text);
  try {
    await adapter.paste();
  } finally {
    if (previousClipboard !== undefined) {
      await adapter.writeClipboard(previousClipboard).catch(() => undefined);
    }
  }
}

/** Read the visible IME keys rather than guessing whether auto-capitalization
 * is active. SwiftKey exposes shifted letter keys as "capital A", while
 * common Android keyboards expose unshifted keys as one lowercase letter. */
export function androidKeyboardShifted(nodes: SnapshotNode[]): boolean | undefined {
  const labels = nodes
    .filter((node) => {
      const owner = node.bundleId?.toLowerCase();
      const identifierOwner = node.identifier?.split(":id/")[0]?.toLowerCase();
      return Boolean(
        (owner && ANDROID_IME_PACKAGES.has(owner)) ||
        (identifierOwner && ANDROID_IME_PACKAGES.has(identifierOwner)),
      );
    })
    .map((node) => node.label?.trim())
    .filter((label): label is string => Boolean(label));
  if (labels.some((label) => /^capital [a-z]$/i.test(label))) return true;
  if (labels.filter((label) => /^[a-z]$/.test(label)).length >= 8) return false;
  return undefined;
}

function firstCasedCharacter(text: string): string | undefined {
  return Array.from(text).find(
    (character) => character.toLocaleLowerCase() !== character.toLocaleUpperCase(),
  );
}

async function typeAndroidShellTextExactly(
  device: Device,
  serial: string,
  text: string,
  dependencies: DeviceTextInputDependencies,
): Promise<void> {
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const firstCased = firstCasedCharacter(line);
    if (firstCased && firstCased === firstCased.toLocaleLowerCase()) {
      const shifted = await dependencies
        .snapshot(device)
        .then(androidKeyboardShifted)
        .catch(() => undefined);
      if (shifted) {
        await dependencies.mutateCurrentTarget(() =>
          raceCancel(
            execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_SHIFT_LEFT"]),
          ),
        );
      }
    }
    if (line) {
      await nativeDevice(device).interactions.type({
        ...base(),
        text: escapeAndroidShellText(line),
      });
    }
    if (index < lines.length - 1) {
      await dependencies.mutateCurrentTarget(() =>
        raceCancel(execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_ENTER"])),
      );
    }
  }
}

export async function typeDeviceText(
  device: Device,
  text: string,
  dependencies: DeviceTextInputDependencies,
): Promise<void> {
  if (currentTargetContext().kind !== "browser" && selectedPlatform() === "android") {
    // Test doubles and older agent-device clients may not expose clipboard
    // control. Keep their deterministic fallback while production Android
    // clients use paste so the IME cannot autocorrect or capitalize input.
    if (typeof nativeDevice(device).command.clipboard !== "function") {
      const serial = targetIdentity();
      try {
        await controlledMutation("type", () =>
          dependencies.mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, serial)),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isAndroidClipboardTransportFailure(message)) throw error;
        await controlled(() =>
          nativeDevice(device).interactions.type({ ...base(), text: escapeAndroidShellText(text) }),
        );
      }
      return;
    }
    const serial = targetIdentity();
    try {
      await controlled(() =>
        pasteAndroidText(text, {
          readClipboard: async () => {
            const result = await nativeDevice(device).command.clipboard({
              ...base(),
              action: "read",
            });
            if (result.action !== "read") {
              throw new Error("clipboard read returned an unexpected result");
            }
            return result.text;
          },
          writeClipboard: async (value) => {
            await nativeDevice(device).command.clipboard({
              ...base(),
              action: "write",
              text: value,
            });
          },
          paste: async () => {
            await dependencies.mutateCurrentTarget(() =>
              raceCancel(
                execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_PASTE"]),
              ),
            );
          },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Physical Android devices commonly expose the clipboard command but
      // reject writes from an external uid (especially while a secure IME or
      // work profile is active). That is a transport limitation, not a reason
      // to make the whole interaction unusable. Fall back to the platform's
      // input channel for clipboard command failures while still surfacing
      // cancellation and unrelated session errors.
      if (isAndroidProviderTextInjectionUnavailable(message)) {
        try {
          await controlledMutation("type", () =>
            dependencies.mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, serial)),
          );
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          if (!isAndroidClipboardTransportFailure(fallbackMessage)) throw fallbackError;
        }
      }
      if (!isAndroidClipboardTransportFailure(message)) throw error;
      await controlledMutation("type", () =>
        typeAndroidShellTextExactly(device, serial, text, dependencies),
      );
    }
    return;
  }
  if (await dependencies.typeViaLiveIosListener(text)) return;
  await controlledMutation("type", () =>
    nativeDevice(device).interactions.type({ ...base(), text }),
  );
}
