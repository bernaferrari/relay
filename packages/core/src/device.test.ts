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
  resolveNamedControlOutcome,
  resolveSnapshotTargetPoint,
} from "./device.js";
import { resolveSnapshotTargetRevealDirection } from "./device-target-resolution.js";

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

test("never uses a hittable iOS application container as a child control's tap target", () => {
  assert.deepEqual(
    resolveSnapshotTargetPoint(
      [
        {
          index: 0,
          type: "Application",
          hittable: true,
          enabled: true,
          rect: { x: 0, y: 0, width: 834, height: 1112 },
        },
        {
          index: 1,
          parentIndex: 0,
          type: "Button",
          identifier: "sidebar.settings.button",
          hittable: false,
          enabled: true,
          rect: { x: 130, y: 1046, width: 44, height: 44 },
        },
      ],
      { identifier: "sidebar.settings.button" },
    ),
    { x: 152, y: 1068 },
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

test("prefers a Compose row over an identically named section heading", () => {
  assert.deepEqual(
    resolveSnapshotTargetPoint(
      [
        {
          index: 1,
          type: "android.widget.TextView",
          label: "Voice",
          enabled: true,
          rect: { x: 90, y: 804, width: 102, height: 49 },
        },
        {
          index: 2,
          type: "android.view.View",
          hittable: true,
          rect: { x: 45, y: 922, width: 990, height: 158 },
        },
        {
          index: 3,
          parentIndex: 2,
          type: "android.widget.TextView",
          label: "Voice",
          enabled: true,
          rect: { x: 203, y: 943, width: 110, height: 53 },
        },
      ],
      { label: "Voice" },
    ),
    { x: 540, y: 1001 },
  );
});

test("does not resolve an off-screen Compose row exposed by the accessibility tree", () => {
  assert.equal(
    resolveSnapshotTargetPoint(
      [
        {
          index: 0,
          type: "android.widget.FrameLayout",
          enabled: true,
          rect: { x: 0, y: 0, width: 1080, height: 2340 },
        },
        {
          index: 1,
          parentIndex: 0,
          type: "android.view.View",
          hittable: true,
          visibleToUser: true,
          rect: { x: 45, y: -150, width: 990, height: 158 },
        },
        {
          index: 2,
          parentIndex: 1,
          type: "android.widget.TextView",
          label: "Customize Grok",
          enabled: true,
          visibleToUser: true,
          rect: { x: 203, y: -105, width: 320, height: 53 },
        },
      ],
      { label: "Customize Grok" },
    ),
    undefined,
  );
});

test("does not resolve a Compose row hidden beneath fixed app chrome", () => {
  const nodes = [
    {
      index: 0,
      type: "android.widget.FrameLayout",
      rect: { x: 0, y: 0, width: 1080, height: 2340 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: "android.view.View",
      rect: { x: 0, y: 0, width: 1080, height: 283 },
    },
    {
      index: 2,
      parentIndex: 0,
      type: "android.view.View",
      hittable: true,
      rect: { x: 45, y: 70, width: 990, height: 158 },
    },
    {
      index: 3,
      parentIndex: 2,
      type: "android.widget.TextView",
      label: "Customize Grok",
      enabled: true,
      rect: { x: 203, y: 123, width: 320, height: 53 },
    },
  ];
  assert.equal(resolveSnapshotTargetPoint(nodes, { label: "Customize Grok" }), undefined);
  assert.equal(resolveSnapshotTargetRevealDirection(nodes, { label: "Customize Grok" }), "up");
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

test("named control resolver uses current bounds for a unique non-hittable child", () => {
  const row = {
    index: 1,
    type: "Cell",
    enabled: true,
    hittable: true,
    rect: { x: 680, y: 1024, width: 100, height: 72 },
  };
  const gear = {
    index: 2,
    parentIndex: 1,
    type: "Button",
    identifier: "sidebar.settings.button",
    label: "grok-gear",
    enabled: true,
    hittable: false,
    rect: { x: 714, y: 1046, width: 44, height: 44 },
  };
  const byId = resolveNamedControl([row, gear], { identifier: "sidebar.settings.button" });
  assert.equal(byId?.method, "identifier");
  assert.equal(byId?.activation, "snapshot-point");
  assert.deepEqual(byId?.point, { x: 730, y: 1060 });
  assert.deepEqual(byId?.bounds, row.rect);
  const withStalePoint = resolveNamedControl([row, gear], {
    identifier: "sidebar.settings.button",
    point: { x: 10, y: 10 },
  });
  assert.equal(withStalePoint?.method, "identifier");
  assert.equal(withStalePoint?.activation, "snapshot-point");
  assert.deepEqual(withStalePoint?.point, { x: 730, y: 1060 });
  const mixedCase = resolveNamedControl([row, gear], {
    identifier: "Sidebar.Settings.Button",
    point: { x: 10, y: 10 },
  });
  assert.equal(mixedCase?.method, "identifier");
  assert.equal(mixedCase?.activation, "snapshot-point");
  assert.deepEqual(mixedCase?.point, { x: 730, y: 1060 });
  const missingId = resolveNamedControl([row, gear], {
    identifier: "navigation.tab.ask",
    point: { x: 353, y: 41 },
  });
  assert.equal(missingId?.method, "point");
  assert.equal(resolveNamedControl([row, gear], { identifier: "navigation.tab.ask" }), undefined);
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

test("named control resolver coalesces duplicate Compose nodes for one fixed-chrome control", () => {
  const application = {
    type: "Application",
    rect: { x: 0, y: 0, width: 900, height: 2200 },
  };
  const bottomBar = {
    index: 1,
    type: "Cell",
    rect: { x: 0, y: 2080, width: 900, height: 120 },
  };
  const settings = {
    index: 2,
    parentIndex: 1,
    role: "button",
    identifier: "settings_button",
    label: "Settings",
    enabled: true,
    hittable: true,
    rect: { x: 770, y: 2088, width: 80, height: 80 },
  };
  const duplicate = { ...settings, index: 3, hittable: false };

  const outcome = resolveNamedControlOutcome([application, bottomBar, settings, duplicate], {
    identifier: "settings_button",
  });
  assert.equal(outcome.status, "resolved");
  if (outcome.status === "resolved") {
    assert.equal(outcome.resolution.method, "identifier");
    assert.deepEqual(outcome.resolution.point, { x: 810, y: 2128 });
  }
});

test("named control resolver preserves true different-location ambiguity", () => {
  const controls = [
    {
      role: "button",
      identifier: "settings_button",
      enabled: true,
      hittable: true,
      rect: { x: 20, y: 100, width: 80, height: 80 },
    },
    {
      role: "button",
      identifier: "settings_button",
      enabled: true,
      hittable: true,
      rect: { x: 700, y: 100, width: 80, height: 80 },
    },
  ];
  const outcome = resolveNamedControlOutcome(controls, { identifier: "settings_button" });
  if (outcome.status === "resolved") assert.fail("different control locations must not resolve");
  assert.equal(outcome.status, "ambiguous");
  assert.equal(outcome.matches, 2);
  assert.match(outcome.detail, /2 different control locations/u);
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
