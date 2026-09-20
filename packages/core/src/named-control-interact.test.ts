import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { Device } from "./device.js";
import { pressNamedControl } from "./device.js";
import {
  canVerifyIosScreenChange,
  interact,
  interactOnDevice,
  resolveInteractPreview,
} from "./workspace.js";
import { runWithTargetContext } from "./target-context.js";
import { IosXCTestSessionUnavailableError } from "./ios-device-adapter.js";
import { setIosSessionHostRuntimeForTests } from "./workspace-ios-session.js";

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

test("device swipe rejects missing coordinates with actionable syntax", async () => {
  await assert.rejects(
    interact({ kind: "swipe" } as never, { serial: "unused" }),
    /Swipe requires "from" and "to" points/u,
  );
});

test("only named iOS actions opt into visual transition verification", () => {
  assert.equal(canVerifyIosScreenChange({ kind: "identifier", identifier: "settings" }), true);
  assert.equal(canVerifyIosScreenChange({ kind: "label", label: "Settings" }), true);
  assert.equal(canVerifyIosScreenChange({ kind: "find", query: "Settings" }), true);
  assert.equal(canVerifyIosScreenChange({ kind: "text-match", match: "Settings" }), true);
  assert.equal(canVerifyIosScreenChange({ kind: "point", x: 1, y: 2 }), false);
  assert.equal(
    canVerifyIosScreenChange({ kind: "swipe", from: { x: 1, y: 2 }, to: { x: 1, y: 8 } }),
    false,
  );
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

test("iOS identifier taps verify pixels changed by default without any opt-in", async () => {
  const presses: Array<Record<string, unknown>> = [];
  const stubDevice = {
    interactions: {
      find: async () => ({}),
      press: async (options: Record<string, unknown>) => {
        presses.push(options);
        return {};
      },
    },
    command: { wait: async () => ({}) },
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "Button",
            identifier: "settings",
            label: "Settings",
            enabled: true,
            hittable: true,
            rect: { x: 20, y: 40, width: 240, height: 44 },
          },
        ],
      }),
    },
  } as unknown as Device;
  // A shell shim stands in for go-ios so the now-default visual proof runs
  // identically on hosts with and without the vendored binary: it writes the
  // same frame to every --output path, so the proof must conclude the pixels
  // never changed and fail closed after dispatching exactly one tap — the old
  // opt-in gate would have returned success without capturing a single frame.
  const root = await mkdtemp(join(tmpdir(), "relay-verify-default-on-"));
  await mkdir(join(root, "bin"), { recursive: true });
  const bin = join(root, "bin", "ios");
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      'OUTPUT_PATH=""',
      'for arg in "$@"; do',
      '  case "$arg" in --output=*) OUTPUT_PATH="${arg#--output=}" ;; esac;',
      "done",
      'printf "%s" "$FAKE_PNG_B64" | base64 -d > "$OUTPUT_PATH"',
      "",
    ].join("\n"),
  );
  await chmod(bin, 0o755);
  const frame = PNG.sync.write(new PNG({ width: 32, height: 48 }));
  const previousGoIos = process.env.RELAY_GO_IOS_BIN;
  const previousImage = process.env.FAKE_PNG_B64;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_GO_IOS_BIN = bin;
  process.env.FAKE_PNG_B64 = frame.toString("base64");
  process.env.RELAY_STATE_DIR = join(root, "state");
  const restoreRuntime = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => undefined,
  });
  try {
    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "ios", serial: "verify-default-on" } as const,
        () => interact({ kind: "identifier", identifier: "settings" }, { device: stubDevice }),
      ),
      /Tap did not change the screen/u,
    );
    assert.equal(presses.length, 1, "the tap itself was dispatched exactly once");
  } finally {
    restoreRuntime();
    if (previousGoIos === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousGoIos;
    if (previousImage === undefined) delete process.env.FAKE_PNG_B64;
    else process.env.FAKE_PNG_B64 = previousImage;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("a bare no-active-session failure on iOS is classified as an XCTest session loss", async () => {
  const device = {
    interactions: {
      type: () => Promise.reject(new Error("no active session for this device")),
    },
  } as unknown as Device;
  const previousGoIos = process.env.RELAY_GO_IOS_BIN;
  process.env.RELAY_GO_IOS_BIN = "/nonexistent/relay-test-missing-go-ios";
  const restoreRuntime = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => undefined,
  });
  try {
    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "ios", serial: "bare-session-loss" } as const,
        () => interact({ kind: "type", text: "hello" }, { device }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof IosXCTestSessionUnavailableError);
        assert.match(error.message, /Press Reconnect/i);
        return true;
      },
    );
  } finally {
    restoreRuntime();
    if (previousGoIos === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousGoIos;
  }
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

test("a mapped Android row uses the current accessibility point, not its saved fallback", async () => {
  const presses: unknown[] = [];
  const skills = {
    type: "android.widget.TextView",
    label: "Skills",
    enabled: true,
    rect: { x: 203, y: 943, width: 110, height: 53 },
  };
  const device = {
    interactions: {
      press: (options: unknown) => {
        presses.push(options);
        return Promise.resolve({});
      },
    },
    capture: { snapshot: () => Promise.resolve({ nodes: [skills] }) },
  } as unknown as Device;

  await runWithTargetContext(
    { kind: "device", platform: "android", serial: "android-live-map-row" },
    () => pressNamedControl(device, { label: "Skills", point: { x: 253, y: 773 } }),
  );

  assert.deepEqual(presses, [
    { platform: "android", serial: "android-live-map-row", x: 258, y: 970 },
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

test("a named Android control may intentionally hand off to an exact declared app", async () => {
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
    () =>
      pressNamedControl(device, {
        label: "App Language",
        expectedApp: "com.android.settings",
      }),
  );
  assert.equal(result.method, "label");
});

test("a named Android control rejects even system Settings when the handoff is undeclared", async () => {
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

  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "undeclared-settings-handoff" },
      () => pressNamedControl(device, { label: "App Language" }),
    ),
    /foregrounded com\.android\.settings/,
  );
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

test("preview errors for an off-screen labeled control", () => {
  const nodes = [
    {
      type: "Application",
      hittable: true,
      rect: { x: 0, y: 0, width: 400, height: 800 },
    },
    {
      type: "Button",
      label: "Privacy",
      enabled: true,
      hittable: true,
      rect: { x: 20, y: 1200, width: 200, height: 44 },
    },
  ];
  assert.throws(
    () => resolveInteractPreview(nodes, { kind: "label", label: "Privacy" }),
    /off-screen.*will not tap/u,
  );
});

test("preview errors for a non-hittable labeled control", () => {
  const about = {
    type: "Button",
    label: "About",
    enabled: true,
    hittable: false,
    rect: { x: 20, y: 70, width: 200, height: 44 },
  };
  assert.throws(
    () => resolveInteractPreview([about], { kind: "label", label: "About" }),
    /not hittable.*will not tap/u,
  );
});

test("preview prefers the rect-equal node over a substring sibling", () => {
  const caption = {
    type: "StaticText",
    label: "About Grok",
    enabled: true,
    hittable: false,
    rect: { x: 20, y: 20, width: 200, height: 20 },
  };
  const about = {
    type: "Button",
    label: "About",
    enabled: true,
    hittable: true,
    rect: { x: 20, y: 70, width: 200, height: 44 },
  };
  const resolution = resolveInteractPreview([caption, about], { kind: "label", label: "About" });
  assert.equal(resolution?.method, "label");
  assert.deepEqual(resolution?.bounds, about.rect);
});

test("preview of an on-screen hittable label still succeeds", () => {
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
});

test("preview of an explicit point still succeeds", () => {
  const resolution = resolveInteractPreview([], { kind: "point", x: 78, y: 88 });
  assert.equal(resolution?.method, "point");
  assert.deepEqual(resolution?.point, { x: 78, y: 88 });
});

test("preview uses a caller point when the labeled control is not hittable", () => {
  const about = {
    type: "Button",
    label: "About",
    enabled: true,
    hittable: false,
    rect: { x: 20, y: 70, width: 200, height: 44 },
  };
  const resolution = resolveInteractPreview([about], {
    kind: "label",
    label: "About",
    point: { x: 78, y: 88 },
  });
  assert.equal(resolution?.method, "point");
  assert.deepEqual(resolution?.point, { x: 78, y: 88 });
});

test("pressNamedControl resolves a unique id omitted from chrome-bounded snapshot", async () => {
  const { setLiveIosRunnerCommandPostForTests } = await import("./ios-runner-listener-command.js");
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-named-model-"));
  const serial = "named-model-selector";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const account = {
    identifier: "sidebar.accountSwitcher.button",
    label: "Account",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 40, y: 120, width: 160, height: 36 },
  };
  const taps: Array<Record<string, unknown>> = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorValue === "ask.toolbar.textfield") {
        return {
          ok: true,
          data: { nodes: [{ identifier: "ask.toolbar.textfield", label: "Ask Anything" }] },
        };
      }
      if (command.selectorValue === "sidebar.accountSwitcher.button") {
        return { ok: true, data: { found: true, nodes: [account] } };
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
    if (command.command === "tap") {
      taps.push(command);
      return { ok: true, data: { message: "tapped" } };
    }
    throw new Error(`unexpected ${String(command.command)}`);
  });
  try {
    const result = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      pressNamedControl(stubDevice([]), {
        identifier: "sidebar.accountSwitcher.button",
      }),
    );
    assert.equal(result.method, "identifier");
    assert.deepEqual(result.point, { x: 120, y: 138 });
    assert.equal(taps.length, 1);
    assert.equal(taps[0]?.selectorKey, "id");
    assert.equal(taps[0]?.selectorValue, "sidebar.accountSwitcher.button");
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("pressNamedControl resolves a unique label omitted from chrome-bounded snapshot", async () => {
  const { setLiveIosRunnerCommandPostForTests } = await import("./ios-runner-listener-command.js");
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-named-compose-"));
  const serial = "named-compose-label";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const compose = {
    label: "grok-compose",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 980, y: 760, width: 44, height: 44 },
  };
  const taps: Array<Record<string, unknown>> = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "label" && command.selectorValue === "grok-compose") {
        return { ok: true, data: { found: true, nodes: [compose] } };
      }
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
    if (command.command === "tap") {
      taps.push(command);
      return { ok: true, data: { message: "tapped" } };
    }
    throw new Error(`unexpected ${String(command.command)}`);
  });
  try {
    const result = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      pressNamedControl(stubDevice([]), { label: "grok-compose" }),
    );
    assert.equal(result.method, "label");
    assert.deepEqual(result.point, { x: 1002, y: 782 });
    assert.equal(taps.length, 1);
    assert.equal(taps[0]?.selectorKey, "label");
    assert.equal(taps[0]?.selectorValue, "grok-compose");
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
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
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial: "named-miss" }, () =>
      interactOnDevice(device, { kind: "identifier", identifier: "sidebar.settings.button" }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "GroundingError");
      assert.match(error.message, /identifier "sidebar\.settings\.button"/u);
      return true;
    },
  );
});

test("a named tap that matches nothing reports a grounding failure, never ok", async () => {
  const device = stubDevice([]);
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "android", serial: "named-miss-test" }, () =>
      interactOnDevice(device, { kind: "label", label: "Settings" }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "GroundingError");
      assert.match(error.message, /label "Settings"/u);
      assert.match(error.message, /Nothing was tapped/u);
      return true;
    },
  );
  assert.deepEqual((device as unknown as { presses: unknown[] }).presses, []);
});

test("a fresh browser page that is not semantic-ready yet still gets its tap", async () => {
  const settings = {
    type: "Link",
    label: "Settings",
    enabled: true,
    hittable: true,
    rect: { x: 24, y: 150, width: 82, height: 60 },
  };
  let reads = 0;
  const device = {
    presses: [] as unknown[],
    interactions: {
      find: () => Promise.resolve({}),
      press: (options: unknown) => {
        (device as unknown as { presses: unknown[] }).presses.push(options);
        return Promise.resolve({});
      },
      longPress: () => Promise.resolve({}),
      fill: () => Promise.resolve({}),
      type: () => Promise.resolve({}),
      swipe: () => Promise.resolve({}),
      pan: () => Promise.resolve({}),
    },
    command: { wait: () => Promise.resolve({}) },
    capture: {
      snapshot: () => {
        reads += 1;
        // First read: the accessibility tree of a just-opened proof context
        // has not rendered the control yet. Second read: present.
        return Promise.resolve({ nodes: reads === 1 ? [] : [settings] });
      },
    },
  } as unknown as Device;
  const result = await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "fresh-proof-page" },
    () => interactOnDevice(device, { kind: "label", label: "Settings" }),
  );
  assert.equal(result.resolution?.method, "label");
  assert.equal(reads >= 2, true);
  assert.equal((device as unknown as { presses: unknown[] }).presses.length, 1);
});
