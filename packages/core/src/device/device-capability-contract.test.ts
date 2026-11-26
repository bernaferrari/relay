import assert from "node:assert/strict";
import test from "node:test";
import { deviceTestDouble } from "@relay/core/testing";
import type { Device } from "./device.js";

// @ts-expect-error The dispatcher-private transport is not part of the public device entrypoint.
type DispatcherTransport = import("./device.js").DeviceTransport;
void (undefined as unknown as DispatcherTransport);

/**
 * Compile-time contract: a workflow gets observation plus the canonical helper
 * API, never the physical SDK methods themselves. Keep these errors next to a
 * runtime test so `tsc --noEmit` guards the capability split in every package
 * typecheck.
 */
function workflowCannotBypassDispatcher(device: Device): void {
  void device.interactions.find({ action: "exists", query: "Settings" });

  // @ts-expect-error raw physical press is intentionally absent from Device.
  void device.interactions.press({ platform: "ios", x: 10, y: 20 });
  // @ts-expect-error workflow code cannot press system Back directly.
  void device.command.back({ platform: "ios" });
  // @ts-expect-error app launch remains dispatcher-owned.
  void device.apps.open({ platform: "ios", app: "ai.x.grok" });
  // @ts-expect-error `find` is observation-only; find-click is a physical input.
  void device.interactions.find({ action: "click", query: "Settings" });
}

void workflowCannotBypassDispatcher;

test("test doubles expose a separate observation facade and keep their raw spy explicit", () => {
  const nativePress = async () => ({ ok: true });
  const capabilities = {
    interactions: {
      find: async () => ({ found: true }),
      press: nativePress,
    },
  };
  const device = deviceTestDouble(capabilities);

  assert.notEqual(device, capabilities);
  assert.equal("press" in device.interactions, false);
  assert.equal(capabilities.interactions.press, nativePress);
});

test("the public device entrypoint cannot expose the dispatcher-private transport", async () => {
  const device = await import("@relay/core/device");
  const core = await import("@relay/core");
  const testing = await import("@relay/core/testing");

  assert.equal(typeof testing.deviceTestDouble, "function");
  assert.equal("deviceTestDouble" in device, false);
  assert.equal("deviceTestDouble" in core, false);
  assert.equal("nativeDevice" in device, false);
});

async function importPackageSpecifier(specifier: string): Promise<unknown> {
  return await import(specifier);
}

test("package exports reject direct internal transport imports", async () => {
  for (const specifier of [
    "@relay/core/device-capabilities",
    "@relay/core/device-mutation-adapter",
    "@relay/core/device-observation-membrane",
  ]) {
    await assert.rejects(importPackageSpecifier(specifier), (error: unknown) => {
      return (error as NodeJS.ErrnoException | undefined)?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
    });
  }
});
