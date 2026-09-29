import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device-capabilities.js";
import { clipboardCopy, clipboardPaste } from "./device-clipboard.js";
import { runWithTargetContext } from "./target-context.js";

function fakeDevice(clipboard: (input: Record<string, unknown>) => Promise<unknown>): Device {
  return { command: { clipboard } } as unknown as Device;
}

test("clipboard paste keeps the selector priority and dispatches once", async () => {
  const calls: Record<string, unknown>[] = [];
  let focused = false;
  const focus = async () => {
    focused = true;
  };
  const device = fakeDevice(async (input) => {
    calls.push(input);
    return { action: "paste", text: "hello" };
  });

  const result = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "test-device" },
    () => clipboardPaste(device, "hello", { identifier: "field", label: "Name" }, focus),
  );

  assert.equal(result, "hello");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.action, "paste");
  assert.equal(calls[0]?.selectorKey, "id");
  assert.equal(calls[0]?.selectorValue, "field");
  assert.equal(focused, false);
});

test("an unclassified clipboard failure is not retried or converted to a fallback", async () => {
  let attempts = 0;
  let focused = false;
  const focus = async () => {
    focused = true;
  };
  const device = fakeDevice(async () => {
    attempts++;
    throw new Error("transport outcome unknown");
  });

  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "android", serial: "test-device" }, () =>
      clipboardCopy(device, { label: "Name" }, undefined, focus),
    ),
    /transport outcome unknown/u,
  );
  assert.equal(attempts, 1);
  assert.equal(focused, false);
});
