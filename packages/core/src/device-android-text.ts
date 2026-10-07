import {
  readAndroidClipboardWithAdb,
  writeAndroidClipboardWithAdb,
  type AndroidAdbExecutor,
} from "agent-device/android-adb";
import type { Device, SnapshotNode } from "./device-capabilities.js";
import { controlledMutation, nativeDevice, base } from "./device-dispatch.js";
import { execAndroidAdb } from "./android-adb-host.js";
import { JobCancelledError, raceCancel } from "./control.js";
import { currentTargetContext, selectedPlatform, targetIdentity } from "./target-context.js";
import {
  androidTextEntryField,
  verifyAndroidTextEntry,
  type AndroidTextEntryReceipt,
} from "./android-text-entry-verification.js";
import { InputNotDispatchedError } from "./input-not-dispatched.js";

export type AndroidTextPasteAdapter = {
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  paste: () => Promise<void>;
};

export type DeviceTextInputDependencies = {
  snapshot: (device: Device) => Promise<SnapshotNode[]>;
  mutateCurrentTarget: <T>(operation: () => Promise<T>) => Promise<T>;
  typeViaLiveIosListener: (text: string) => Promise<boolean>;
  execAndroidAdb?: typeof execAndroidAdb;
};

const ANDROID_IME_PACKAGES = new Set([
  "com.google.android.inputmethod.latin",
  "com.samsung.android.honeyboard",
  "com.touchtype.swiftkey",
  "com.microsoft.swiftkey",
]);

const ANDROID_SHELL_META = /[\\'"`$&;|<>()[\]{}*?!#~]/g;

/** Escape one logical line for Android's remote-shell input text command. */
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

  try {
    await adapter.writeClipboard(text);
  } catch (error) {
    if (error instanceof JobCancelledError) throw error;
    throw new InputNotDispatchedError(
      `Clipboard write did not dispatch typing: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
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
  const adb = dependencies.execAndroidAdb ?? execAndroidAdb;
  if (text.length > 4096 || /[^\x20-\x7e]/u.test(text) || text.includes("%s"))
    throw new InputNotDispatchedError(
      "The Android clipboard fallback supports one bounded ASCII line only; no text was dispatched.",
    );
  const firstCased = firstCasedCharacter(text);
  if (firstCased && firstCased === firstCased.toLocaleLowerCase()) {
    const shifted = await dependencies
      .snapshot(device)
      .then(androidKeyboardShifted)
      .catch(() => undefined);
    if (shifted) {
      await dependencies.mutateCurrentTarget(() =>
        raceCancel(adb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_SHIFT_LEFT"])),
      );
    }
  }
  if (text) {
    // One bounded logical line avoids SDK chunk boundaries that let the IME
    // replace an in-progress token. Readback remains the acceptance proof.
    await dependencies.mutateCurrentTarget(() =>
      raceCancel(
        adb(
          [
            "-s",
            serial,
            "shell",
            "input",
            "text",
            escapeAndroidShellText(text).replaceAll(" ", "%s"),
          ],
          { timeout: 10_000 },
        ),
      ),
    );
  }
}

export async function typeDeviceText(
  device: Device,
  text: string,
  dependencies: DeviceTextInputDependencies,
): Promise<AndroidTextEntryReceipt | undefined> {
  const android = currentTargetContext().kind !== "browser" && selectedPlatform() === "android";
  let before: SnapshotNode | undefined;
  if (android) {
    try {
      before = androidTextEntryField(await dependencies.snapshot(device));
    } catch (error) {
      if (error instanceof JobCancelledError) throw error;
    }
  }
  const transport = await dispatchDeviceText(device, text, dependencies);
  if (!transport) return undefined;
  if (!before)
    return {
      platform: "android",
      transport,
      verification: "unverified",
      reason: "focused-field-unavailable",
    };
  return verifyAndroidTextEntry({
    before,
    text,
    transport,
    snapshot: () => dependencies.snapshot(device),
  });
}

async function dispatchDeviceText(
  device: Device,
  text: string,
  dependencies: DeviceTextInputDependencies,
): Promise<AndroidTextEntryReceipt["transport"] | undefined> {
  if (currentTargetContext().kind !== "browser" && selectedPlatform() === "android") {
    // Prefer whole-payload paste. If writing is unsupported before paste begins,
    // use one bounded shell command per line and retain the readback outcome.
    if (typeof nativeDevice(device).command.clipboard !== "function") {
      const serial = targetIdentity();
      try {
        await controlledMutation("type", () =>
          dependencies.mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, serial)),
        );
        return "clipboard";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !(error instanceof InputNotDispatchedError) ||
          !isAndroidClipboardTransportFailure(message)
        )
          throw error;
        await controlledMutation("type", () =>
          typeAndroidShellTextExactly(device, serial, text, dependencies),
        );
        return "adb-shell";
      }
    }
    const serial = targetIdentity();
    try {
      await controlledMutation("type", () =>
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
                (dependencies.execAndroidAdb ?? execAndroidAdb)([
                  "-s",
                  serial,
                  "shell",
                  "input",
                  "keyevent",
                  "KEYCODE_PASTE",
                ]),
              ),
            );
          },
        }),
      );
      return "clipboard";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Physical Android devices commonly expose the clipboard command but
      // reject writes from an external uid (especially while a secure IME or
      // work profile is active). That is a transport limitation, not a reason
      // to make the whole interaction unusable. Fall back to the platform's
      // input channel for clipboard command failures while still surfacing
      // cancellation and unrelated session errors.
      if (
        error instanceof InputNotDispatchedError &&
        isAndroidProviderTextInjectionUnavailable(message)
      ) {
        try {
          await controlledMutation("type", () =>
            dependencies.mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, serial)),
          );
          return "clipboard";
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          if (
            !(fallbackError instanceof InputNotDispatchedError) ||
            !isAndroidClipboardTransportFailure(fallbackMessage)
          )
            throw fallbackError;
        }
      }
      if (
        !(error instanceof InputNotDispatchedError) ||
        !isAndroidClipboardTransportFailure(message)
      )
        throw error;
      await controlledMutation("type", () =>
        typeAndroidShellTextExactly(device, serial, text, dependencies),
      );
      return "adb-shell";
    }
  }
  if (await dependencies.typeViaLiveIosListener(text)) return;
  await controlledMutation("type", () =>
    nativeDevice(device).interactions.type({ ...base(), text }),
  );
}
