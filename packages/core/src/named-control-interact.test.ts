import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device.js";
import { pressNamedControl } from "./device.js";
import { interactOnDevice, resolveInteractPreview } from "./workspace.js";
import { runWithTargetContext } from "./target-context.js";

function stubDevice(nodes: unknown[]): Device {
  const presses: unknown[] = [];
  return {
    presses,
    interactions: {
      find: () => Promise.resolve({}),
      press: (options: unknown) => {
        presses.push(options);
        return Promise.resolve({});
      },
      longPress: () => Promise.resolve({}),
      fill: () => Promise.resolve({}),
      type: () => Promise.resolve({}),
      swipe: () => Promise.resolve({}),
      pan: () => Promise.resolve({}),
    },
    command: { wait: () => Promise.resolve({}) },
    capture: { snapshot: () => Promise.resolve({ nodes }) },
  } as unknown as Device & { presses: unknown[] };
}

test("mouse/CLI interactOnDevice records Home label method and bounds", async () => {
  const home = {
    type: "Button",
    label: "Home",
    enabled: true,
    hittable: true,
    rect: { x: 10, y: 700, width: 80, height: 40 },
  };
  const device = stubDevice([home]);
  const result = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "named-control-test" },
    () => interactOnDevice(device, { kind: "label", label: "Home" }),
  );
  assert.equal(result.resolution?.method, "label");
  assert.deepEqual(result.resolution?.bounds, home.rect);
  assert.deepEqual(result.resolution?.point, { x: 50, y: 720 });
});

test("mouse/CLI interactOnDevice uses explicit point when Home labels collide", async () => {
  const leftHome = {
    type: "Button",
    label: "Home",
    enabled: true,
    hittable: true,
    rect: { x: 10, y: 700, width: 80, height: 40 },
  };
  const rightHome = {
    type: "Button",
    label: "Home",
    enabled: true,
    hittable: true,
    rect: { x: 200, y: 700, width: 80, height: 40 },
  };
  const device = stubDevice([leftHome, rightHome]) as Device & { presses: unknown[] };
  const result = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "named-control-collide" },
    () =>
      interactOnDevice(device, {
        kind: "label",
        label: "Home",
        point: { x: 240, y: 720 },
      }),
  );
  assert.equal(result.resolution?.method, "point");
  assert.deepEqual(result.resolution?.point, { x: 240, y: 720 });
  assert.deepEqual(result.resolution?.bounds, { x: 240, y: 720, width: 1, height: 1 });
  assert.deepEqual(device.presses, [
    { platform: "android", serial: "named-control-collide", x: 240, y: 720 },
  ]);
});

test("a uniquely resolved Android label falls back to its exact point", async () => {
  const presses: unknown[] = [];
  const language = {
    type: "android.widget.TextView",
    label: "English (United States)",
    enabled: true,
    hittable: false,
    rect: { x: 180, y: 1260, width: 590, height: 102 },
  };
  const device = {
    interactions: {
      press: (options: unknown) => {
        presses.push(options);
        if ((options as { selector?: string }).selector) {
          return Promise.reject(new Error("Selector did not match an element"));
        }
        return Promise.resolve({});
      },
    },
    capture: { snapshot: () => Promise.resolve({ nodes: [language] }) },
  } as unknown as Device;

  const result = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "android-label-point" },
    () => pressNamedControl(device, { label: language.label }),
  );

  assert.equal(result.method, "label");
  assert.deepEqual(result.point, { x: 475, y: 1311 });
  assert.deepEqual(presses, [
    {
      platform: "android",
      serial: "android-label-point",
      selector: 'label="English (United States)"',
    },
    { platform: "android", serial: "android-label-point", x: 475, y: 1311 },
  ]);
});

test("point-only pressNamedControl does not snapshot", async () => {
  const presses: unknown[] = [];
  const device = {
    interactions: {
      press: (options: unknown) => {
        presses.push(options);
        return Promise.resolve({});
      },
    },
    capture: {
      snapshot: async () => {
        throw new Error("AX snapshot wedged");
      },
    },
  } as unknown as Device;
  const result = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "point-only" },
    () => pressNamedControl(device, { point: { x: 33, y: 45 } }),
  );
  assert.equal(result.method, "point");
  assert.deepEqual(result.point, { x: 33, y: 45 });
  assert.equal(presses.length, 1);
  assert.equal((presses[0] as { x: number; y: number }).x, 33);
  assert.equal((presses[0] as { y: number }).y, 45);
});

test("a named Android control may intentionally hand off to system Settings", async () => {
  const device = {
    interactions: {
      press: () =>
        Promise.reject(
          new Error(
            "press coordinate tap left ai.x.grok and foregrounded com.android.settings. The tap likely escaped the app.",
          ),
        ),
    },
    capture: {
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              type: "android.widget.TextView",
              label: "App Language",
              rect: { x: 200, y: 1600, width: 300, height: 80 },
            },
          ],
        }),
    },
  } as unknown as Device;

  const result = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "named-handoff" },
    () => pressNamedControl(device, { label: "App Language" }),
  );
  assert.equal(result.method, "label");
});

test("a named Android control still rejects a launcher escape", async () => {
  const device = {
    interactions: {
      press: () =>
        Promise.reject(
          new Error(
            "press coordinate tap left com.google.android.googlequicksearchbox and foregrounded bitpit.launcher. The tap likely escaped the app.",
          ),
        ),
    },
    capture: {
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              type: "android.widget.TextView",
              label: "Maps",
              rect: { x: 200, y: 1600, width: 300, height: 80 },
            },
          ],
        }),
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "named-launcher-escape" },
      () => pressNamedControl(device, { label: "Maps" }),
    ),
    /foregrounded bitpit\.launcher/,
  );
});

test("a named Android control rejects an undeclared third-party handoff", async () => {
  const device = {
    interactions: {
      press: () =>
        Promise.reject(
          new Error(
            "press coordinate tap left ai.x.grok and foregrounded com.example.other. The tap likely escaped the app.",
          ),
        ),
    },
    capture: {
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              type: "android.widget.TextView",
              label: "Open other app",
              rect: { x: 200, y: 1600, width: 300, height: 80 },
            },
          ],
        }),
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "named-third-party-escape" },
      () => pressNamedControl(device, { label: "Open other app" }),
    ),
    /foregrounded com\.example\.other/,
  );
});

test("preview resolves a labeled control without tapping", () => {
  const back = {
    type: "Button",
    label: "Back",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 70, width: 60, height: 36 },
  };
  const resolution = resolveInteractPreview([back], { kind: "label", label: "Back" });
  assert.equal(resolution?.method, "label");
  assert.deepEqual(resolution?.point, { x: 50, y: 88 });
  assert.deepEqual(resolution?.bounds, back.rect);
});

test("preview falls back to an explicit point when the tree is empty", () => {
  const resolution = resolveInteractPreview([], {
    kind: "label",
    label: "Back",
    point: { x: 78, y: 88 },
  });
  assert.equal(resolution?.method, "point");
  assert.deepEqual(resolution?.point, { x: 78, y: 88 });
});

test("interactOnDevice fails closed when identifier matches nothing", async () => {
  const device = stubDevice([
    {
      type: "Button",
      label: "Home",
      enabled: true,
      hittable: true,
      rect: { x: 10, y: 700, width: 80, height: 40 },
    },
  ]);
  const result = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "named-miss" },
    () => interactOnDevice(device, { kind: "identifier", identifier: "sidebar.settings.button" }),
  );
  assert.equal(result.resolution, undefined);
});
