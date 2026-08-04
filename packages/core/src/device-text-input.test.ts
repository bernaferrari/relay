import assert from "node:assert/strict";
import test from "node:test";
import {
  androidKeyboardShifted,
  escapeAndroidShellText,
  isAndroidClipboardTransportFailure,
  pasteAndroidText,
  replaceTextValue,
  type AndroidTextPasteAdapter,
} from "./device.js";

test("Android keyboard state comes from owned visible key semantics", () => {
  assert.equal(
    androidKeyboardShifted([
      { bundleId: "com.touchtype.swiftkey", label: "capital Q" },
      { bundleId: "ai.x.grok", label: "capital A" },
    ]),
    true,
  );
  assert.equal(
    androidKeyboardShifted(
      "qwertyuiop".split("").map((label) => ({
        bundleId: "com.google.android.inputmethod.latin",
        label,
      })),
    ),
    false,
  );
  assert.equal(androidKeyboardShifted([{ bundleId: "ai.x.grok", label: "capital Q" }]), undefined);
});

test("Android shell text escapes punctuation without changing spaces or lines", () => {
  assert.equal(
    escapeAndroidShellText('hello, don\'t answer "hello"\nprice is $5 & safe!'),
    'hello, don\\\'t answer \\"hello\\"\nprice is \\$5 \\& safe\\!',
  );
});

test("Android clipboard transport failures use the input fallback", () => {
  assert.equal(isAndroidClipboardTransportFailure("Failed to write Android clipboard text"), true);
  assert.equal(
    isAndroidClipboardTransportFailure("Android shell clipboard is not supported on this device"),
    true,
  );
  assert.equal(isAndroidClipboardTransportFailure("device disconnected"), false);
});

function adapterThatRecords(
  calls: string[],
  options: { initial?: string; pasteError?: Error; readError?: Error } = {},
): AndroidTextPasteAdapter {
  return {
    readClipboard: async () => {
      calls.push("read");
      if (options.readError) throw options.readError;
      return options.initial ?? "existing clipboard";
    },
    writeClipboard: async (text) => {
      calls.push(`write:${text}`);
    },
    paste: async () => {
      calls.push("paste");
      if (options.pasteError) throw options.pasteError;
    },
  };
}

test("Android text paste preserves punctuation, Unicode, and newlines", async () => {
  const calls: string[] = [];
  const text = 'hello, don\'t answer anything else but a "hello"\na\nab\nOlá 👋';

  await pasteAndroidText(text, adapterThatRecords(calls));

  assert.deepEqual(calls, ["read", `write:${text}`, "paste", "write:existing clipboard"]);
});

test("Android text paste still works when clipboard reads are restricted", async () => {
  const calls: string[] = [];

  await pasteAndroidText(
    "hello",
    adapterThatRecords(calls, { readError: new Error("clipboard read unavailable") }),
  );

  assert.deepEqual(calls, ["read", "write:hello", "paste"]);
});

test("Android text paste restores the clipboard after a failed paste", async () => {
  const calls: string[] = [];
  const pasteError = new Error("paste failed");

  await assert.rejects(
    pasteAndroidText("hello", adapterThatRecords(calls, { pasteError })),
    pasteError,
  );

  assert.deepEqual(calls, ["read", "write:hello", "paste", "write:existing clipboard"]);
});

test("empty replacement uses native replacement followed by one backspace", async () => {
  const calls: string[] = [];
  await replaceTextValue("", {
    fill: async (text) => {
      calls.push(`fill:${text}`);
    },
    type: async (text) => {
      calls.push(`type:${JSON.stringify(text)}`);
    },
  });
  assert.deepEqual(calls, ["fill:x", 'type:"\\b"']);
});

test("non-empty replacement remains one deterministic fill", async () => {
  const calls: string[] = [];
  await replaceTextValue("hello", {
    fill: async (text) => {
      calls.push(`fill:${text}`);
    },
    type: async (text) => {
      calls.push(`type:${text}`);
    },
  });
  assert.deepEqual(calls, ["fill:hello"]);
});
