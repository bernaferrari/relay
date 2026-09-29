import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device-capabilities.js";
import {
  clipboardCopy,
  clipboardPaste,
  clipboardRead,
  clipboardWrite,
} from "./device-clipboard.js";
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

test("clipboard write and read each dispatch once and preserve the result", async () => {
  const calls: Record<string, unknown>[] = [];
  const device = fakeDevice(async (input) => {
    calls.push(input);
    return input.action === "read" ? { action: "read", text: "from device" } : { action: "write" };
  });

  await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "test-device" },
    async () => {
      await clipboardWrite(device, "to device");
      assert.equal(await clipboardRead(device), "from device");
    },
  );

  assert.deepEqual(
    calls.map(({ action, text }) => ({ action, text })),
    [
      { action: "write", text: "to device" },
      { action: "read", text: undefined },
    ],
  );
});

test("copy and paste use the best available selector and forward expected text", async () => {
  const calls: Record<string, unknown>[] = [];
  const device = fakeDevice(async (input) => {
    calls.push(input);
    return { action: input.action, text: "copied" };
  });
  const focus = async () => {
    assert.fail("native clipboard operation must not focus separately");
  };

  await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "test-device" },
    async () => {
      assert.equal(
        await clipboardCopy(device, { label: "Name", text: "lower" }, "copied", focus),
        "copied",
      );
      assert.equal(await clipboardPaste(device, "copied", { text: "lower" }, focus), "copied");
    },
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ selectorKey, selectorValue, expectedText }) => ({
      selectorKey,
      selectorValue,
      expectedText,
    })),
    [
      { selectorKey: "label", selectorValue: "Name", expectedText: "copied" },
      { selectorKey: "text", selectorValue: "lower", expectedText: undefined },
    ],
  );
});

test("clipboard operations reject missing selectors and mismatched native replies", async () => {
  let calls = 0;
  const device = fakeDevice(async () => {
    calls++;
    return { action: "write", text: "unexpected" };
  });
  const focus = async () => {
    assert.fail("failed native clipboard operation must not focus separately");
  };

  await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "test-device" },
    async () => {
      await assert.rejects(clipboardCopy(device, {}, undefined, focus), /requires an identifier/u);
      await assert.rejects(clipboardPaste(device, "x", {}, focus), /requires an identifier/u);
      await assert.rejects(clipboardRead(device), /unexpected result/u);
      await assert.rejects(
        clipboardCopy(device, { label: "Name" }, undefined, focus),
        /unexpected result/u,
      );
      await assert.rejects(
        clipboardPaste(device, "x", { label: "Name" }, focus),
        /unexpected result/u,
      );
    },
  );

  assert.equal(calls, 3);
});
