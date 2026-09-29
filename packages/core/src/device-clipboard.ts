/** Clipboard policy below the public Device facade. Physical writes remain single-attempt. */
import {
  readAndroidClipboardWithAdb,
  writeAndroidClipboardWithAdb,
} from "agent-device/android-adb";
import { getExecutingJobId } from "./control.js";
import type { Device } from "./device-capabilities.js";
import { base, controlled, controlledMutation, nativeDevice } from "./device-dispatch.js";
import {
  androidAdbExecutor,
  isAndroidClipboardTransportFailure,
  pasteAndroidTextWithAdb,
} from "./device-android-text.js";
import { runTargetMutation } from "./target-control.js";
import { selectedPlatform, targetIdentity } from "./target-context.js";

export type ClipboardTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  text?: string;
  point?: { x: number; y: number };
};

export type FocusTarget = (device: Device, target: ClipboardTarget) => Promise<void>;

function mutateCurrentTarget<T>(operation: () => Promise<T>): Promise<T> {
  return runTargetMutation(targetIdentity(), getExecutingJobId(), operation);
}

export async function clipboardWrite(device: Device, text: string): Promise<void> {
  try {
    await controlledMutation("clipboard-write", () =>
      nativeDevice(device).command.clipboard({ ...base(), action: "write", text }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    await controlled(() =>
      mutateCurrentTarget(() =>
        writeAndroidClipboardWithAdb(androidAdbExecutor(targetIdentity()), text),
      ),
    );
  }
}

export async function clipboardRead(device: Device): Promise<string> {
  try {
    const result = await controlled(() =>
      nativeDevice(device).command.clipboard({ ...base(), action: "read" }),
    );
    if (result.action !== "read") throw new Error("clipboard read returned an unexpected result");
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    return controlled(() => readAndroidClipboardWithAdb(androidAdbExecutor(targetIdentity())));
  }
}

function atomicClipboardSelector(target: ClipboardTarget): {
  selectorKey: "id" | "label" | "text";
  selectorValue: string;
} {
  if (target.identifier) return { selectorKey: "id", selectorValue: target.identifier };
  if (target.label) return { selectorKey: "label", selectorValue: target.label };
  if (target.text) return { selectorKey: "text", selectorValue: target.text };
  throw new Error("clipboard copy/paste requires an identifier, label, or text target");
}

/** Replace the target field through the iOS system Paste action before XCTest
 * exits. Write and Paste are one verified runner command (empty text clears
 * the field). Intermediate probe-app foreground and pasteboard writes can
 * occur before an error; a lost response after Paste must not be replayed. */
export async function clipboardPaste(
  device: Device,
  text: string,
  target: ClipboardTarget,
  focusTarget: FocusTarget,
): Promise<string> {
  const selector = atomicClipboardSelector(target);
  try {
    const result = await controlledMutation("clipboard-paste", () =>
      nativeDevice(device).command.clipboard({
        ...base(),
        action: "paste",
        text,
        ...selector,
      }),
    );
    if (result.action !== "paste") throw new Error("clipboard paste returned an unexpected result");
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    await focusTarget(device, target);
    await mutateCurrentTarget(() => pasteAndroidTextWithAdb(text, targetIdentity()));
    return text;
  }
}

/** Select and copy editable text through the real iOS edit menu, then read and
 * optionally verify it before XCTest exits. */
export async function clipboardCopy(
  device: Device,
  target: ClipboardTarget,
  expectedText: string | undefined,
  focusTarget: FocusTarget,
): Promise<string> {
  const selector = atomicClipboardSelector(target);
  try {
    const result = await controlledMutation("clipboard-copy", () =>
      nativeDevice(device).command.clipboard({
        ...base(),
        action: "copy",
        ...selector,
        ...(expectedText !== undefined ? { expectedText } : {}),
      }),
    );
    if (result.action !== "copy") throw new Error("clipboard copy returned an unexpected result");
    return result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (selectedPlatform() !== "android" || !isAndroidClipboardTransportFailure(message)) {
      throw error;
    }
    await focusTarget(device, target);
    const adb = androidAdbExecutor(targetIdentity());
    const selectAll = await adb([
      "shell",
      "input",
      "keycombination",
      "KEYCODE_CTRL_LEFT",
      "KEYCODE_A",
    ]);
    if (selectAll.exitCode !== 0) {
      throw new Error(selectAll.stderr || "Android could not select the target text");
    }
    const copy = await adb(["shell", "input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_C"]);
    if (copy.exitCode !== 0) {
      throw new Error(copy.stderr || "Android could not copy the target text");
    }
    const copiedText = await readAndroidClipboardWithAdb(adb);
    if (expectedText !== undefined && copiedText !== expectedText) {
      throw new Error(
        `Android clipboard text did not match the expected value (received ${copiedText.length} characters)`,
      );
    }
    return copiedText;
  }
}
