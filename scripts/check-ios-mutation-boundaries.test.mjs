import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateIosMutationBoundaries,
  rawDeviceMutationBoundaryPaths,
} from "./check-ios-mutation-boundaries.mjs";

test("workflow modules cannot bypass the canonical physical mutation dispatcher", () => {
  const source = [
    "export async function unsafe(device) {",
    '  await device.interactions.press({ platform: "ios", selector: \'label="Continue"\' });',
    "}",
  ].join("\n");

  assert.deepEqual(evaluateIosMutationBoundaries([{ path: "packages/core/src/tour.ts", source }]), [
    "packages/core/src/tour.ts:2 directly invokes device.interactions.press(; route physical input through packages/core/src/device.ts instead.",
  ]);
});

test("only the canonical dispatcher and native adapter own the raw transport", () => {
  const source = 'await target.device.apps.open({ platform: "android", app: "com.example.app" });';
  assert.equal(rawDeviceMutationBoundaryPaths.has("packages/core/src/device.ts"), true);
  assert.equal(
    rawDeviceMutationBoundaryPaths.has("packages/core/src/device-mutation-adapter.ts"),
    true,
  );
  assert.equal(rawDeviceMutationBoundaryPaths.has("packages/core/src/workspace-capture.ts"), false);
  assert.deepEqual(
    evaluateIosMutationBoundaries([
      { path: "packages/core/src/device.ts", source },
      { path: "packages/core/src/device-mutation-adapter.ts", source },
    ]),
    [],
  );
});

test("workflow modules cannot import a native transport or test-double escape hatch", () => {
  const source = [
    'import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";',
    'import { nativeDevice, type DeviceTransport } from "./device-capabilities.js";',
    'import { deviceTestDouble } from "./device.js";',
  ].join("\n");
  assert.deepEqual(
    evaluateIosMutationBoundaries([{ path: "packages/core/src/recipe-runner.ts", source }]),
    [
      "packages/core/src/recipe-runner.ts:1 accesses bindNativeDeviceMutations; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:2 accesses nativeDevice; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:2 accesses DeviceTransport; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:3 accesses deviceTestDouble; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
    ],
  );
});

test("read-only device inspection stays available to workflow modules", () => {
  assert.deepEqual(
    evaluateIosMutationBoundaries([
      {
        path: "packages/core/src/recipe-runner-support.ts",
        source: 'await device.interactions.find({ action: "exists", query: "Settings" });',
      },
    ]),
    [],
  );
});

test("direct find clicks and clipboard writes are also physical mutation bypasses", () => {
  const source = [
    'await device.interactions.find({ action: "click", query: "Continue" });',
    'await device.command.clipboard({ action: "write", text: "1234" });',
  ].join("\n");
  assert.deepEqual(
    evaluateIosMutationBoundaries([{ path: "packages/core/src/recipe-runner-tour.ts", source }]),
    [
      "packages/core/src/recipe-runner-tour.ts:1 directly invokes device.interactions.find(; route physical input through packages/core/src/device.ts instead.",
      "packages/core/src/recipe-runner-tour.ts:2 directly invokes device.command.clipboard(; route physical input through packages/core/src/device.ts instead.",
    ],
  );
});
