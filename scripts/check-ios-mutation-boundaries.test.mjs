import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCoreDevicePackageExports,
  evaluateIosMutationBoundaries,
  evaluateRuntimeObservationFacadeBindings,
  privateDeviceCapabilityPaths,
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
  assert.equal(rawDeviceMutationBoundaryPaths.has("packages/core/src/device-dispatch.ts"), true);
  assert.equal(rawDeviceMutationBoundaryPaths.has("packages/core/src/device-text-entry.ts"), true);
  assert.equal(
    rawDeviceMutationBoundaryPaths.has("packages/core/src/device-capabilities.ts"),
    false,
  );
  assert.equal(
    privateDeviceCapabilityPaths.has("packages/core/src/device-observation-membrane.ts"),
    true,
  );
  assert.equal(privateDeviceCapabilityPaths.has("packages/core/src/testing.ts"), true);
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
    'import { createDeviceObservationFacade } from "./device-observation-membrane.js";',
  ].join("\n");
  assert.deepEqual(
    evaluateIosMutationBoundaries([{ path: "packages/core/src/recipe-runner.ts", source }]),
    [
      "packages/core/src/recipe-runner.ts:1 accesses bindNativeDeviceMutations; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:2 accesses nativeDevice; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:2 accesses DeviceTransport; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:3 accesses deviceTestDouble; workflow code receives the safe Device facade and must use packages/core/src/device.ts helpers.",
      "packages/core/src/recipe-runner.ts:1 imports ./device-mutation-adapter.js; internal device capability modules are private—use the public device helpers instead.",
      "packages/core/src/recipe-runner.ts:2 imports ./device-capabilities.js; internal device capability modules are private—use the public device helpers instead.",
      "packages/core/src/recipe-runner.ts:4 imports ./device-observation-membrane.js; internal device capability modules are private—use the public device helpers instead.",
    ],
  );
});

test("production code cannot reach private device seams through literal dynamic imports", () => {
  const source = [
    'import { createAgentDeviceClient } from "agent-device";',
    'await import("./device-mutation-adapter.js");',
    'await import("@relay/core/testing");',
    'await import("agent-device");',
  ].join("\n");
  assert.deepEqual(
    evaluateIosMutationBoundaries([{ path: "packages/server/src/run-route.ts", source }]),
    [
      "packages/server/src/run-route.ts:1 imports agent-device; raw agent-device access belongs only to the canonical device/control boundary.",
      "packages/server/src/run-route.ts:2 imports ./device-mutation-adapter.js; internal device capability modules are private—use the public device helpers instead.",
      "packages/server/src/run-route.ts:3 imports @relay/core/testing; test doubles may only be imported from test files.",
      "packages/server/src/run-route.ts:4 imports agent-device; raw agent-device access belongs only to the canonical device/control boundary.",
    ],
  );
});

test("the core package gives test injection an explicit public entrypoint only", () => {
  assert.deepEqual(
    evaluateCoreDevicePackageExports({
      exports: { ".": "./src/index.ts", "./device": "./src/device.ts" },
    }),
    ["packages/core/package.json must export ./testing."],
  );
  assert.deepEqual(
    evaluateCoreDevicePackageExports({
      exports: {
        ".": "./src/index.ts",
        "./device": "./src/device.ts",
        "./testing": "./src/testing.ts",
        "./device-mutation-adapter": "./src/device-mutation-adapter.ts",
        "./device-observation-membrane": "./src/device-observation-membrane.ts",
      },
    }),
    [
      "packages/core/package.json must not export private ./device-mutation-adapter.",
      "packages/core/package.json must not export private ./device-observation-membrane.",
    ],
  );
  assert.deepEqual(
    evaluateCoreDevicePackageExports({
      exports: {
        ".": "./src/index.ts",
        "./device": "./src/device.ts",
        "./testing": "./src/testing.ts",
      },
    }),
    [],
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

test("supported adapters must all create the shared runtime observation facade", () => {
  const ownerSources = [
    "packages/core/src/browser-target.ts",
    "packages/core/src/device-client-bindings.ts",
    "packages/core/src/device-factory.ts",
    "packages/core/src/testing.ts",
  ].map((path) => ({
    path,
    source:
      'import { createDeviceObservationFacade } from "./device-observation-membrane.js";\ncreateDeviceObservationFacade({});',
  }));
  assert.deepEqual(evaluateRuntimeObservationFacadeBindings(ownerSources), []);
  assert.deepEqual(
    evaluateRuntimeObservationFacadeBindings(
      ownerSources.filter((entry) => entry.path !== "packages/core/src/browser-target.ts"),
    ),
    [
      "packages/core/src/browser-target.ts is missing its required runtime Device observation facade binding.",
    ],
  );
  assert.deepEqual(
    evaluateRuntimeObservationFacadeBindings(
      ownerSources.map((entry) =>
        entry.path === "packages/core/src/testing.ts" ? { ...entry, source: "export {};" } : entry,
      ),
    ),
    [
      "packages/core/src/testing.ts must create public Device values through the runtime observation facade.",
    ],
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
