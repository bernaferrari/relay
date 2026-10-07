import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { catalogAwarePost } from "./ios-snapshot-catalog.fixtures.js";
import {
  parseAndroidAppBuild,
  rememberedTargetApplication,
  rememberTargetApplication,
  resolveNamedControl,
  resolveSnapshotTargetPoint,
} from "./device.js";
import {
  headingNodeFamilies,
  preflightSemanticActivation,
  resolveNamedControlOutcome,
  resolveSnapshotTargetRevealDirection,
} from "./device-target-resolution.js";

async function waitForCount(read: () => number, expected: number): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (read() < expected && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

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

test("matches a unique decorated live label without treating a longer name as the same control", () => {
  const viewport = {
    type: "Application",
    rect: { x: 0, y: 0, width: 400, height: 800 },
    enabled: true,
  };
  const superGrok = {
    type: "Button",
    label: "SuperGrok, X Premium",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 400, width: 300, height: 56 },
  };
  const more = {
    type: "Button",
    label: "SuperGrok More",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 470, width: 300, height: 56 },
  };
  assert.deepEqual(resolveSnapshotTargetPoint([viewport, superGrok], { label: "SuperGrok" }), {
    x: 170,
    y: 428,
  });
  assert.equal(resolveSnapshotTargetPoint([viewport, more], { label: "SuperGrok" }), undefined);
  assert.deepEqual(
    resolveSnapshotTargetPoint([viewport, superGrok, more], { label: "SuperGrok" }),
    { x: 170, y: 428 },
  );
});

test("matches a wrapped iOS row label in its logical wide viewport", () => {
  const application = {
    index: 0,
    depth: 0,
    type: "Application",
    enabled: true,
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  };
  const row = {
    index: 1,
    parentIndex: 0,
    depth: 1,
    type: "Cell",
    label: "Langue\u00a0préférée\n",
    enabled: true,
    hittable: false,
    rect: { x: 24, y: 470, width: 512, height: 88 },
  };

  const result = resolveNamedControl([application, row], {
    label: "Langue pre\u0301fe\u0301re\u0301e",
  });

  assert.equal(result?.method, "label");
  assert.deepEqual(result?.point, { x: 280, y: 514 });
  assert.deepEqual(result?.bounds, row.rect);
});

test("does not mistake a wrapped continuation word for a decorated label", () => {
  const control = {
    type: "Button",
    label: "Preferred\nLanguage More",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 100, width: 280, height: 88 },
  };

  assert.equal(resolveNamedControl([control], { label: "Preferred Language" }), undefined);
});

test("matches wrapped Android text and ignores an off-screen duplicate on a narrow landscape viewport", () => {
  // Android can expose only a FrameLayout root. Its 568×320 landscape bounds
  // must still reject the stale/off-screen duplicate rather than treating two
  // otherwise identical wrapped labels as an ambiguity.
  const root = {
    index: 0,
    type: "android.widget.FrameLayout",
    rect: { x: 0, y: 0, width: 568, height: 320 },
  };
  const visibleRow = {
    index: 1,
    parentIndex: 0,
    type: "android.view.View",
    enabled: true,
    hittable: true,
    rect: { x: 0, y: 178, width: 568, height: 80 },
  };
  const visibleText = {
    index: 2,
    parentIndex: 1,
    type: "android.widget.TextView",
    label: "Change\nLanguage",
    enabled: true,
    rect: { x: 24, y: 196, width: 264, height: 44 },
  };
  const staleRow = {
    index: 3,
    parentIndex: 0,
    type: "android.view.View",
    enabled: true,
    hittable: true,
    rect: { x: 0, y: 350, width: 568, height: 80 },
  };
  const staleText = {
    index: 4,
    parentIndex: 3,
    type: "android.widget.TextView",
    label: "Change\nLanguage",
    enabled: true,
    rect: { x: 24, y: 368, width: 264, height: 44 },
  };

  const result = resolveNamedControl([root, visibleRow, visibleText, staleRow, staleText], {
    text: "Change Language",
  });

  assert.equal(result?.method, "text");
  assert.deepEqual(result?.point, { x: 284, y: 218 });
  assert.deepEqual(result?.bounds, visibleRow.rect);
});

test("chooses the same co-located wrapped AX node regardless of traversal order", () => {
  const firstRow = {
    index: 1,
    type: "Cell",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 100, width: 280, height: 80 },
  };
  const firstTitle = {
    index: 3,
    parentIndex: 1,
    depth: 2,
    type: "StaticText",
    label: "Change\nLanguage",
    enabled: true,
    hittable: false,
    rect: { x: 40, y: 120, width: 180, height: 32 },
  };
  const secondRow = { ...firstRow, index: 2 };
  const secondTitle = { ...firstTitle, index: 4, parentIndex: 2, hittable: undefined };
  const target = { label: "Change Language" };

  const first = resolveNamedControl([firstRow, firstTitle, secondRow, secondTitle], target);
  const reordered = resolveNamedControl([secondRow, secondTitle, firstRow, firstTitle], target);

  assert.deepEqual(reordered, first);
  assert.equal(first?.activation, "snapshot-point");
  assert.deepEqual(first?.point, { x: 160, y: 140 });
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

test("named control resolver keeps a hittable Android control inside a hittable scroll view", () => {
  const scroll = {
    index: 1,
    type: "android.widget.ScrollView",
    enabled: true,
    hittable: true,
    rect: { x: 0, y: 0, width: 1080, height: 2400 },
  };
  const button = {
    index: 2,
    parentIndex: 1,
    type: "android.widget.Button",
    identifier: "dev.relay.prooffixture:id/prove_button",
    label: "Prove interaction",
    enabled: true,
    visibleToUser: true,
    hittable: true,
    rect: { x: 126, y: 1315, width: 828, height: 147 },
  };

  const resolved = resolveNamedControl([scroll, button], { identifier: button.identifier });
  assert.equal(resolved?.method, "identifier");
  assert.equal(resolved?.activation, undefined);
  assert.deepEqual(resolved?.bounds, button.rect);
  assert.deepEqual(resolved?.point, { x: 540, y: 1389 });
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

test("a settings row title presses its row when the whole iPad tree denies hittability", () => {
  // Physical iPad Settings: every node reports hittable:false, and the row's
  // accessibility identifier sits on a 37×21 title inside a 335×44 cell.
  const application = {
    index: 0,
    type: "Application",
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  };
  const cell = {
    index: 1,
    parentIndex: 0,
    type: "Cell",
    label: "Grok",
    enabled: true,
    hittable: false,
    rect: { x: 20, y: 585, width: 335, height: 44 },
  };
  const title = {
    index: 2,
    parentIndex: 1,
    type: "StaticText",
    identifier: "ai.x.GrokApp",
    label: "Grok",
    enabled: true,
    hittable: false,
    rect: { x: 80, y: 597, width: 37, height: 21 },
  };

  const outcome = resolveNamedControlOutcome([application, cell, title], {
    identifier: "ai.x.GrokApp",
  });

  assert.equal(outcome.status, "resolved");
  if (outcome.status === "resolved") {
    assert.deepEqual(outcome.resolution.point, { x: 188, y: 607 });
    assert.equal(outcome.resolution.activation, "snapshot-point");
  }
});

test("Edit Profile Birth Year resolves its stable heading to the following value row offline", () => {
  // Frozen shape from persisted Relay40 run 90560436. The account-specific
  // value (1994 here) is deliberately not part of the selector contract.
  const nodes = [
    {
      index: 0,
      type: "android.widget.FrameLayout",
      rect: { x: 0, y: 0, width: 1080, height: 2340 },
    },
    {
      index: 32,
      parentIndex: 0,
      type: "android.widget.ScrollView",
      rect: { x: 0, y: 283, width: 1080, height: 1922 },
    },
    {
      index: 43,
      parentIndex: 32,
      type: "android.widget.TextView",
      label: "Birth Year",
      value: "Birth Year",
      enabled: true,
      visibleToUser: true,
      rect: { x: 79, y: 1110, width: 179, height: 49 },
    },
    {
      index: 44,
      parentIndex: 32,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      rect: { x: 45, y: 1193, width: 990, height: 136 },
    },
    {
      index: 45,
      parentIndex: 44,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      rect: { x: 45, y: 1193, width: 990, height: 136 },
    },
    {
      index: 46,
      parentIndex: 45,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      hittable: true,
      rect: { x: 45, y: 1193, width: 990, height: 136 },
    },
    {
      index: 47,
      parentIndex: 46,
      type: "android.widget.TextView",
      label: "1994",
      value: "1994",
      enabled: true,
      visibleToUser: true,
      rect: { x: 192, y: 1235, width: 90, height: 53 },
    },
  ];

  const unsafe = preflightSemanticActivation(nodes, { label: "Birth Year" });
  assert.deepEqual(unsafe, {
    status: "blocked",
    code: "heading-only-noop",
    detail:
      "selector resolves only to descriptive heading bounds; use a following-row semantic relation",
  });

  const stable = preflightSemanticActivation(nodes, {
    relation: { kind: "following-row", anchor: { label: "Birth Year" } },
  });
  assert.equal(stable.status, "proven");
  if (stable.status === "proven") {
    assert.equal(stable.resolution.method, "relation");
    assert.deepEqual(stable.resolution.bounds, { x: 45, y: 1193, width: 990, height: 136 });
    assert.deepEqual(stable.resolution.point, { x: 540, y: 1261 });
  }
});

test("following-row relation fails closed when its heading is ambiguous", () => {
  const nodes = [
    {
      index: 1,
      parentIndex: 0,
      type: "android.widget.TextView",
      label: "Birth Year",
      enabled: true,
      visibleToUser: true,
      rect: { x: 20, y: 100, width: 120, height: 40 },
    },
    {
      index: 2,
      parentIndex: 0,
      type: "android.widget.TextView",
      label: "Birth Year",
      enabled: true,
      visibleToUser: true,
      rect: { x: 20, y: 500, width: 120, height: 40 },
    },
  ];
  const result = preflightSemanticActivation(nodes, {
    relation: { kind: "following-row", anchor: { label: "Birth Year" } },
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.code, "ambiguous");
});

test("offline semantic preflight rejects historical positional browser refs", () => {
  assert.equal(
    resolveSnapshotTargetPoint(
      [
        {
          ref: "@browser-0",
          type: "button",
          label: "Delete",
          enabled: true,
          hittable: true,
          rect: { x: 10, y: 10, width: 100, height: 40 },
        },
      ],
      { ref: "@browser-0" },
    ),
    undefined,
  );
});

test("a caption with no row of its own still refuses to become a tap", () => {
  const application = {
    index: 0,
    type: "Application",
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  };
  const caption = {
    index: 1,
    parentIndex: 0,
    type: "StaticText",
    identifier: "status.carrier",
    label: "Settings",
    enabled: true,
    hittable: false,
    rect: { x: 4, y: 2, width: 60, height: 18 },
  };

  const outcome = resolveNamedControlOutcome([application, caption], {
    identifier: "status.carrier",
  });

  assert.equal(outcome.status, "unhittable");
});

test("named control resolver coalesces same-frame Settings close wrapper and button", () => {
  const nav = {
    index: 9,
    identifier: "Settings",
    label: "Close",
    type: "NavigationBar",
    enabled: true,
    hittable: false,
    rect: { x: 204, y: 40, width: 704, height: 56 },
  };
  const wrapper = {
    index: 10,
    parentIndex: 9,
    identifier: "toolbar.close.button",
    label: "Close",
    type: "Other",
    enabled: true,
    hittable: false,
    depth: 6,
    rect: { x: 224, y: 49, width: 38, height: 38 },
  };
  const button = {
    index: 12,
    parentIndex: 11,
    identifier: "toolbar.close.button",
    label: "Close",
    type: "Button",
    enabled: true,
    hittable: false,
    depth: 8,
    rect: { x: 224, y: 49, width: 38, height: 38 },
  };
  const resolved = resolveNamedControl([nav, wrapper, button], {
    identifier: "toolbar.close.button",
  });
  assert.equal(resolved?.method, "identifier");
  assert.deepEqual(resolved?.point, { x: 243, y: 68 });
  assert.deepEqual(resolved?.bounds, button.rect);
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

test("a unique ancestor heading scopes one Dismiss without coalescing the other location", () => {
  const finance = {
    index: 1,
    type: "p",
    label: "Finance",
    hittable: false,
    rect: { x: 469, y: 381, width: 308, height: 18 },
  };
  const financeDismiss = {
    index: 2,
    parentIndex: 1,
    type: "button",
    label: "Dismiss",
    hittable: true,
    rect: { x: 991, y: 382, width: 72, height: 32 },
  };
  const dialog = {
    index: 3,
    type: "dialog",
    label: "Introducing Build Mode",
    hittable: true,
    rect: { x: 824, y: 339, width: 320, height: 301 },
  };
  const headingText = {
    index: 4,
    parentIndex: 3,
    type: "text",
    label: "Introducing Build Mode",
    hittable: false,
    rect: { x: 840, y: 511, width: 288, height: 23 },
  };
  const buildDismiss = {
    index: 5,
    parentIndex: 3,
    type: "button",
    label: "Dismiss",
    hittable: true,
    rect: { x: 828, y: 596, width: 72, height: 32 },
  };
  const nodes = [finance, financeDismiss, dialog, headingText, buildDismiss];

  assert.equal(headingNodeFamilies(nodes, "Introducing Build Mode").length, 1);

  const bare = resolveNamedControlOutcome(nodes, { label: "Dismiss" });
  if (bare.status === "resolved") assert.fail("two Dismiss locations must stay ambiguous");
  assert.equal(bare.status, "ambiguous");
  assert.equal(bare.matches, 2);

  const scoped = resolveNamedControlOutcome(nodes, {
    label: "Dismiss",
    heading: "Introducing Build Mode",
  });
  assert.equal(scoped.status, "resolved");
  if (scoped.status === "resolved") {
    assert.equal(scoped.resolution.method, "label");
    assert.equal(scoped.resolution.activation, undefined);
    assert.deepEqual(scoped.resolution.bounds, buildDismiss.rect);
    assert.deepEqual(scoped.resolution.point, { x: 864, y: 612 });
  }

  const sameHeadingBoth = resolveNamedControlOutcome(
    [dialog, { ...financeDismiss, parentIndex: 3 }, headingText, buildDismiss],
    { label: "Dismiss", heading: "Introducing Build Mode" },
  );
  if (sameHeadingBoth.status === "resolved") {
    assert.fail("two Dismiss locations under one heading must not coalesce");
  }
  assert.equal(sameHeadingBoth.status, "ambiguous");

  const twoHeadings = resolveNamedControlOutcome(
    [
      { ...dialog, index: 10, rect: { x: 20, y: 20, width: 200, height: 200 } },
      { ...dialog, index: 11, rect: { x: 600, y: 20, width: 200, height: 200 } },
      { ...buildDismiss, parentIndex: 10 },
    ],
    { label: "Dismiss", heading: "Introducing Build Mode" },
  );
  if (twoHeadings.status === "resolved") {
    assert.fail("two heading locations must not pick a Dismiss");
  }
});

test("a slow iOS accessibility traversal is timed out as in-flight, not a missing XCTest session", async () => {
  const { IosSnapshotInFlightError, IosSnapshotTimedOutError, snapshot } =
    await import("./device.js");
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
        return calls === 1 ? pending : Promise.resolve({ nodes: [{ label: "Settings" }] });
      },
    },
  };
  const target = { kind: "device", platform: "ios", serial: "ipad-timeout" } as const;
  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never, { timeoutMs: 20 })),
    (error: unknown) => {
      assert.ok(error instanceof IosSnapshotTimedOutError);
      assert.equal(error.code, "IOS_SNAPSHOT_ACCESSIBILITY_QUERY_TIMED_OUT");
      assert.equal(error.inFlight, true);
      assert.equal(error.timeoutMs, 20);
      assert.ok(error.elapsedMs >= 20);
      assert.doesNotMatch(error.message, /XCTest session|reconnect/i);
      return true;
    },
  );
  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never)),
    (error: unknown) => {
      assert.ok(error instanceof IosSnapshotInFlightError);
      assert.equal(error.code, "IOS_SNAPSHOT_ACCESSIBILITY_QUERY_IN_FLIGHT");
      assert.equal(error.inFlight, true);
      return true;
    },
  );
  assert.equal(calls, 1);

  // The native XCTest query eventually settles. Only then may a new tree
  // read start; Relay never overlaps it with a retry or repair probe.
  release({ nodes: [{ label: "Settings" }] });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    await runWithTargetContext(target, () => snapshot(device as never, { timeoutMs: 20 })),
    [{ label: "Settings" }],
  );
  assert.equal(calls, 2);
});

test("prefers a LISTENER_READY runner over the bounded SDK Copy probe", async () => {
  const { snapshot } = await import("./device.js");
  const { runWithTargetContext } = await import("./target-context.js");
  const { setLiveIosRunnerCommandPostForTests } = await import("./ios-runner-listener-command.js");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-prefer-listener-"));
  const serial = "ipad-prefer-live-listener";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  process.env.RELAY_WORKSPACE_ROOT = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 57051 }),
  );
  let sdkSnapshots = 0;
  const restore = setLiveIosRunnerCommandPostForTests(
    catalogAwarePost(async (listener, command) => {
      assert.equal(listener.port, 57051);
      if (command.command === "querySelector") {
        if (command.selectorValue === "ask.toolbar.textfield") {
          return {
            ok: true,
            data: { nodes: [{ identifier: "ask.toolbar.textfield", label: "Ask Anything" }] },
          };
        }
        return { ok: true, data: { found: false, nodes: [] } };
      }
      if (command.command === "snapshot") {
        assert.equal(command.depth, 0);
        return {
          ok: true,
          data: {
            nodes: [
              {
                depth: 0,
                type: "Application",
                identifier: "ai.x.GrokApp",
                rect: { x: 0, y: 0, width: 1112, height: 834 },
              },
            ],
          },
        };
      }
      throw new Error("unbounded snapshot must not run when chrome identifiers resolve");
    }),
  );
  const device = {
    capture: {
      snapshot: async () => {
        sdkSnapshots += 1;
        return { nodes: [{ label: "Copy probe" }] };
      },
    },
  };
  try {
    await rememberTargetApplication("ai.x.GrokApp", { kind: "device", platform: "ios", serial });
    const nodes = await runWithTargetContext(
      { kind: "device", platform: "ios", serial } as const,
      () => snapshot(device as never, { timeoutMs: 20 }),
    );
    assert.deepEqual(nodes, [
      {
        depth: 0,
        type: "Application",
        identifier: "ai.x.GrokApp",
        rect: { x: 0, y: 0, width: 1112, height: 834 },
      },
      {
        identifier: "ask.toolbar.textfield",
        label: "Ask Anything",
        logicalCoordinates: true,
        bundleId: "ai.x.GrokApp",
        hittable: true,
        rect: { x: 10, y: 10, width: 44, height: 44 },
      },
    ]);
    assert.equal(sdkSnapshots, 0);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(dir, { recursive: true, force: true });
  }
});

test("adopts a LISTENER_READY runner when the SDK session is missing", async () => {
  const { snapshot } = await import("./device.js");
  const { runWithTargetContext } = await import("./target-context.js");
  const { setLiveIosRunnerCommandPostForTests } = await import("./ios-runner-listener-command.js");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-adopt-snap-"));
  const serial = "ipad-adopt-live-listener";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  process.env.RELAY_WORKSPACE_ROOT = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(
    catalogAwarePost(async (_listener, command) => {
      if (command.command === "querySelector") {
        if (command.selectorValue === "ask.toolbar.textfield") {
          return { ok: true, data: { nodes: [{ label: "Ask Anything" }] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
      }
      if (command.command === "snapshot") {
        assert.equal(command.depth, 0);
        return {
          ok: true,
          data: {
            nodes: [
              {
                depth: 0,
                type: "Application",
                identifier: "ai.x.GrokApp",
                rect: { x: 0, y: 0, width: 1112, height: 834 },
              },
            ],
          },
        };
      }
      throw new Error("unbounded snapshot must not run when chrome identifiers resolve");
    }),
  );
  const device = {
    capture: {
      snapshot: async () => {
        throw new Error("No active session. Run open first.");
      },
    },
  };
  try {
    await rememberTargetApplication("ai.x.GrokApp", { kind: "device", platform: "ios", serial });
    const nodes = await runWithTargetContext(
      { kind: "device", platform: "ios", serial } as const,
      () => snapshot(device as never, { timeoutMs: 20 }),
    );
    assert.deepEqual(nodes, [
      {
        depth: 0,
        type: "Application",
        identifier: "ai.x.GrokApp",
        rect: { x: 0, y: 0, width: 1112, height: 834 },
      },
      {
        label: "Ask Anything",
        identifier: "ask.toolbar.textfield",
        logicalCoordinates: true,
        bundleId: "ai.x.GrokApp",
        hittable: true,
        rect: { x: 10, y: 10, width: 44, height: 44 },
      },
    ]);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a genuine missing iOS XCTest session remains distinct from an accessibility timeout", async () => {
  const { IosSnapshotTimedOutError, snapshot } = await import("./device.js");
  const { runWithTargetContext } = await import("./target-context.js");
  const target = { kind: "device", platform: "ios", serial: "ipad-no-session" } as const;
  const device = {
    capture: {
      snapshot: async () => {
        throw new Error("No active XCTest session");
      },
    },
  };

  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never, { timeoutMs: 20 })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "iOS snapshot needs an active XCTest session");
      assert.equal(error instanceof IosSnapshotTimedOutError, false);
      return true;
    },
  );
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
  await waitForCount(() => calls, 1);
  const second = runWithTargetContext(target, () => snapshot(device as never));
  await waitForCount(() => calls, 1);
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
  await waitForCount(() => calls, 1);

  await assert.rejects(
    runWithTargetContext(target, () => snapshot(device as never)),
    (error: unknown) => error instanceof IosSnapshotInFlightError,
  );
  assert.equal(calls, 1);

  release({ nodes: [{ label: "Settings" }] });
  assert.deepEqual(await interactive, [{ label: "Settings" }]);
});
