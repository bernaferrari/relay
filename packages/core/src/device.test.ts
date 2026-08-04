import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseAndroidAppBuild,
  rememberedTargetApplication,
  rememberTargetApplication,
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
