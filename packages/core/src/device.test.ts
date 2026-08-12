import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseAndroidAppBuild,
  rememberedTargetApplication,
  rememberTargetApplication,
  resolveNamedControl,
  resolveSnapshotTargetPoint,
} from "./device.js";

test("parses immutable Android app build facts from dumpsys output", () => {
  assert.deepEqual(
    parseAndroidAppBuild(
      "com.example.chat",
      "Package [com.example.chat] (abc):\n  versionCode=420 minSdk=24\n  versionName=2.4.0-beta.1\n",
    ),
    {
      packageName: "com.example.chat",
      installed: true,
      versionCode: "420",
      versionName: "2.4.0-beta.1",
    },
  );
});

test("does not invent a build version from unrelated dumpsys output", () => {
  assert.deepEqual(parseAndroidAppBuild("com.example.chat", "Unable to find package"), {
    packageName: "com.example.chat",
    installed: false,
  });
});

test("keeps the intended application isolated per target for session recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-apps-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const ipad = { kind: "device", platform: "ios", serial: "ipad" } as const;
  const iphone = { kind: "device", platform: "ios", serial: "iphone" } as const;
  try {
    await rememberTargetApplication("com.apple.Preferences", ipad);
    await rememberTargetApplication("com.example.app", iphone);
    assert.equal(await rememberedTargetApplication(ipad), "com.apple.Preferences");
    assert.equal(await rememberedTargetApplication(iphone), "com.example.app");
    await rememberTargetApplication(undefined, ipad);
    assert.equal(await rememberedTargetApplication(ipad), undefined);
    assert.equal(await rememberedTargetApplication(iphone), "com.example.app");
    await rememberTargetApplication(undefined, iphone);
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves a unique visible iOS control even when XCTest marks it non-hittable", () => {
  assert.deepEqual(
    resolveSnapshotTargetPoint(
      [
        {
          type: "Button",
          identifier: "grok-compose",
          enabled: true,
          hittable: false,
          rect: { x: 1044, y: 768, width: 44, height: 44 },
        },
      ],
      { identifier: "grok-compose" },
    ),
    { x: 1066, y: 790 },
  );
});

test("ignores status-bar app names when a real row shares the label", () => {
  assert.deepEqual(
    resolveSnapshotTargetPoint(
      [
        {
          type: "StaticText",
          identifier: "ai.x.GrokApp",
          label: "Grok",
          enabled: true,
          hittable: false,
          rect: { x: 0, y: 122, width: 44, height: 20 },
        },
        {
          type: "Cell",
          label: "Grok",
          enabled: true,
          hittable: false,
          rect: { x: 20, y: 898, width: 280, height: 44 },
        },
      ],
      { label: "Grok" },
    ),
    { x: 160, y: 920 },
  );
});

test("a status-bar-only label is not a usable tap target", () => {
  assert.equal(
    resolveSnapshotTargetPoint(
      [
        {
          type: "StaticText",
          identifier: "ai.x.GrokApp",
          label: "Grok",
          enabled: true,
          hittable: false,
          rect: { x: 0, y: 122, width: 44, height: 20 },
        },
      ],
      { label: "Grok" },
    ),
    undefined,
  );
});

test("refuses to guess between distinct controls with the same semantic label", () => {
  assert.equal(
    resolveSnapshotTargetPoint(
      [
        {
          type: "Button",
          label: "Close",
          enabled: true,
          rect: { x: 20, y: 20, width: 44, height: 44 },
        },
        {
          type: "Button",
          label: "Close",
          enabled: true,
          rect: { x: 500, y: 20, width: 44, height: 44 },
        },
      ],
      { label: "Close" },
    ),
    undefined,
  );
});

test("uses an explicit region to disambiguate a visible semantic control", () => {
  const nodes = [
    { type: "Application", rect: { x: 0, y: 0, width: 1000, height: 800 }, enabled: true },
    {
      type: "Button",
      label: "Compose",
      enabled: true,
      rect: { x: 200, y: 300, width: 44, height: 44 },
    },
    {
      type: "Button",
      label: "Compose",
      enabled: true,
      rect: { x: 930, y: 730, width: 44, height: 44 },
    },
  ];
  assert.deepEqual(
    resolveSnapshotTargetPoint(nodes, { label: "Compose" }, { minX: 0.85, minY: 0.85 }),
    { x: 952, y: 752 },
  );
});

test("named control resolver taps Home by identifier then label, and records the method", () => {
  const home = {
    type: "Button",
    identifier: "tab.home",
    label: "Home",
    enabled: true,
    hittable: true,
    rect: { x: 10, y: 700, width: 80, height: 40 },
  };
  const byId = resolveNamedControl([home], { identifier: "tab.home", label: "Home" });
  assert.equal(byId?.method, "identifier");
  assert.deepEqual(byId?.point, { x: 50, y: 720 });
  const byLabel = resolveNamedControl([{ ...home, identifier: undefined }], { label: "Home" });
  assert.equal(byLabel?.method, "label");
  assert.equal(byLabel?.bounds.width, 80);
});

test("named control resolver prefers caller point for a unique non-hittable identifier", () => {
  const gear = {
    type: "Button",
    identifier: "sidebar.settings.button",
    label: "grok-gear",
    enabled: true,
    hittable: false,
    rect: { x: 714, y: 1046, width: 44, height: 44 },
  };
  const byId = resolveNamedControl([gear], { identifier: "sidebar.settings.button" });
  assert.equal(byId?.method, "identifier");
  const withPoint = resolveNamedControl([gear], {
    identifier: "sidebar.settings.button",
    point: { x: 736, y: 1068 },
  });
  assert.equal(withPoint?.method, "point");
  assert.deepEqual(withPoint?.point, { x: 736, y: 1068 });
  const mixedCase = resolveNamedControl([gear], {
    identifier: "Sidebar.Settings.Button",
    point: { x: 736, y: 1068 },
  });
  assert.equal(mixedCase?.method, "point");
  assert.deepEqual(mixedCase?.point, { x: 736, y: 1068 });
  const missingId = resolveNamedControl([gear], {
    identifier: "navigation.tab.ask",
    point: { x: 353, y: 41 },
  });
  assert.equal(missingId?.method, "point");
  assert.equal(resolveNamedControl([gear], { identifier: "navigation.tab.ask" }), undefined);
});

test("named control resolver uses an explicit point when Home labels collide", () => {
  const nodes = [
    {
      type: "Button",
      label: "Home",
      enabled: true,
      rect: { x: 10, y: 700, width: 80, height: 40 },
    },
    {
      type: "Button",
      label: "Home",
      enabled: true,
      rect: { x: 200, y: 700, width: 80, height: 40 },
    },
  ];
  assert.equal(resolveNamedControl(nodes, { label: "Home" }), undefined);
  const fallback = resolveNamedControl(nodes, { label: "Home", point: { x: 240, y: 720 } });
  assert.equal(fallback?.method, "point");
  assert.deepEqual(fallback?.point, { x: 240, y: 720 });
});

test("iOS snapshot fails fast instead of waiting out the 90s daemon budget", async () => {
  const { IosSnapshotInFlightError, snapshot } = await import("./device.js");
  const { runWithTargetContext } = await import("./target-context.js");
  const started = Date.now();
  let calls = 0;
  const device = {
    capture: {
      snapshot: () => {
        calls += 1;
        return new Promise(() => undefined);
      },
    },
  };
  const target = { kind: "device", platform: "ios", serial: "ipad-timeout" } as const;
  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never)),
    /XCTest session|timed out/i,
  );
  assert.ok(Date.now() - started < 9_500);
  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never)),
    (error: unknown) => error instanceof IosSnapshotInFlightError,
  );
  assert.equal(calls, 1);
});

test("shares one in-flight physical-iPad accessibility read", async () => {
  const { snapshot } = await import("./device.js");
  const { runWithTargetContext } = await import("./target-context.js");
  let calls = 0;
  let release!: (value: { nodes: Array<{ label: string }> }) => void;
  const pending = new Promise<{ nodes: Array<{ label: string }> }>((resolve) => {
    release = resolve;
  });
  const device = {
    capture: {
      snapshot: () => {
        calls += 1;
        return pending;
      },
    },
  };
  const target = { kind: "device", platform: "ios", serial: "ipad-single-flight" } as const;
  const first = runWithTargetContext(target, () => snapshot(device as never));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = runWithTargetContext(target, () => snapshot(device as never));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  release({ nodes: [{ label: "Settings" }] });
  assert.deepEqual(await first, [{ label: "Settings" }]);
  assert.deepEqual(await second, [{ label: "Settings" }]);
});

test("does not overlap a full iPad tree read behind an interactive-only read", async () => {
  const { IosSnapshotInFlightError, snapshot } = await import("./device.js");
  const { runWithTargetContext } = await import("./target-context.js");
  let calls = 0;
  let release!: (value: { nodes: Array<{ label: string }> }) => void;
  const pending = new Promise<{ nodes: Array<{ label: string }> }>((resolve) => {
    release = resolve;
  });
  const device = {
    capture: {
      snapshot: () => {
        calls += 1;
        return pending;
      },
    },
  };
  const target = { kind: "device", platform: "ios", serial: "ipad-interactive-flight" } as const;
  const interactive = runWithTargetContext(target, () =>
    snapshot(device as never, { interactiveOnly: true }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never)),
    (error: unknown) => error instanceof IosSnapshotInFlightError,
  );
  assert.equal(calls, 1);

  release({ nodes: [{ label: "Settings" }] });
  assert.deepEqual(await interactive, [{ label: "Settings" }]);
});
