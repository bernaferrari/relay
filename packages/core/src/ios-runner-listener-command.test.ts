import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  identifierNodesViaLiveIosRunnerListener,
  identifierPresentViaLiveIosRunnerListener,
  IOS_BOUNDED_CHROME_IDENTIFIERS,
  isIosRunnerHostProbeTree,
  isIosSessionMissingSnapshotError,
  labelNodesViaLiveIosRunnerListener,
  readUsbmuxDeviceId,
  setLiveIosRunnerCommandPostForTests,
  snapshotViaLiveIosRunnerListener,
  tapViaLiveIosRunnerListener,
  typeViaLiveIosRunnerListener,
  unknownErrorMessage,
} from "./ios-runner-listener-command.js";

test("unknownErrorMessage reads runner {message,code} instead of [object Object]", () => {
  assert.equal(
    unknownErrorMessage({
      message: "find could not read the current accessibility tree",
      code: "COMMAND_FAILED",
    }),
    "find could not read the current accessibility tree",
  );
  assert.equal(
    unknownErrorMessage(new Error("No active session. Run open first.")),
    "No active session. Run open first.",
  );
  assert.equal(unknownErrorMessage("[object Object]") === "[object Object]", true);
  assert.notEqual(unknownErrorMessage({ code: "COMMAND_FAILED" }), "[object Object]");
});

test("session-missing snapshot errors stay distinct from timeouts", () => {
  assert.equal(
    isIosSessionMissingSnapshotError(new Error("No active session. Run open first.")),
    true,
  );
  assert.equal(
    isIosSessionMissingSnapshotError(new Error("iOS snapshot needs an active XCTest session")),
    true,
  );
  assert.equal(
    isIosSessionMissingSnapshotError(new Error("accessibility is still reading")),
    false,
  );
});

test("readUsbmuxDeviceId finds the attached device", () => {
  const xml = `
    <key>DeviceID</key><integer>7</integer>
    <key>Properties</key><dict>
      <key>SerialNumber</key><string>db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5</string>
    </dict>
    <key>DeviceID</key><integer>3</integer>
    <key>Properties</key><dict>
      <key>SerialNumber</key><string>other</string>
    </dict>
  `;
  assert.equal(readUsbmuxDeviceId(xml, "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5"), 7);
  assert.equal(readUsbmuxDeviceId(xml, "missing"), undefined);
});

test("listener snapshot chrome is Grok identifiers, not the runner Copy probe", () => {
  assert.equal(
    isIosRunnerHostProbeTree([
      { identifier: "agent-device.clipboard.probe" },
      { identifier: "agent-device.clipboard.copy", label: "Copy probe" },
    ]),
    true,
  );
  assert.equal(isIosRunnerHostProbeTree([{ label: "AgentDeviceRunner" }]), true);
  assert.equal(
    isIosRunnerHostProbeTree([
      { identifier: "ask.toolbar.textfield", label: "Ask Anything" },
      { identifier: "grok-gear", label: "Settings" },
    ]),
    false,
  );
});

test("a live listener snapshot adopts the testCommand port instead of requiring an SDK session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-snap-"));
  const serial = "live-snap-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const commands: unknown[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (listener, command) => {
    assert.equal(listener.port, 50937);
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    commands.push(command.command);
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
      assert.equal(command.interactiveOnly, false);
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
    throw new Error("conversation-depth snapshot must not run after chrome identifiers resolve");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      interactiveOnly: true,
      appBundleId: "ai.x.GrokApp",
    });
    assert.deepEqual(nodes, [
      {
        depth: 0,
        type: "Application",
        identifier: "ai.x.GrokApp",
        rect: { x: 0, y: 0, width: 1112, height: 834 },
      },
      { identifier: "ask.toolbar.textfield", label: "Ask Anything", logicalCoordinates: true },
    ]);
    assert.equal(isIosRunnerHostProbeTree(nodes), false);
    assert.ok(commands.filter((command) => command === "querySelector").length >= 2);
    assert.equal(commands.filter((command) => command === "snapshot").length, 1);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live listener tap uses label/id on the testCommand port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-tap-"));
  const serial = "live-tap-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (listener, command) => {
    assert.equal(listener.port, 50937);
    assert.equal(command.command, "tap");
    assert.equal(command.selectorKey, "label");
    assert.equal(command.selectorValue, "Open sidebar");
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    return { ok: true, data: { message: "tapped" } };
  });
  try {
    await tapViaLiveIosRunnerListener({
      serial,
      selectorKey: "label",
      selectorValue: "Open sidebar",
      appBundleId: "ai.x.GrokApp",
    });
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live listener type uses the focused field on the testCommand port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-type-"));
  const serial = "live-type-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const commands: unknown[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (listener, command) => {
    assert.equal(listener.port, 50937);
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    commands.push(command.command);
    if (command.command === "querySelector") {
      assert.equal(command.selectorKey, "id");
      assert.equal(command.selectorValue, "ask.toolbar.textfield");
      return {
        ok: true,
        data: { nodes: [{ identifier: "ask.toolbar.textfield", label: "Ask Anything" }] },
      };
    }
    assert.equal(command.command, "type");
    assert.equal(command.text, "hello");
    assert.equal(command.selectorKey, "id");
    assert.equal(command.selectorValue, "ask.toolbar.textfield");
    return { ok: true, data: { message: "typed" } };
  });
  try {
    await typeViaLiveIosRunnerListener({
      serial,
      text: "hello",
      appBundleId: "ai.x.GrokApp",
    });
    assert.deepEqual(commands, ["querySelector", "type"]);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live listener type does not dispatch when the composer identifier is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-type-miss-"));
  const serial = "live-type-miss-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  let typed = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "type") {
      typed += 1;
      return { ok: true, data: { message: "typed" } };
    }
    return { ok: true, data: { found: false, nodes: [] } };
  });
  try {
    await assert.rejects(
      typeViaLiveIosRunnerListener({
        serial,
        text: "hello",
        appBundleId: "ai.x.GrokApp",
      }),
      (error: unknown) => error instanceof Error && error.message === "element not found",
    );
    assert.equal(typed, 0);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed live listener type is not-applied when the composer value is unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-type-unchanged-"));
  const serial = "live-type-unchanged-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      return {
        ok: true,
        data: {
          nodes: [{ identifier: "ask.toolbar.textfield", label: "Ask Anything", value: "" }],
        },
      };
    }
    return {
      ok: false,
      error: {
        message: "find could not read the current accessibility tree",
        code: "COMMAND_FAILED",
      },
    };
  });
  try {
    await assert.rejects(
      typeViaLiveIosRunnerListener({
        serial,
        text: "hello",
        appBundleId: "ai.x.GrokApp",
      }),
      (error: unknown) => error instanceof Error && error.message === "element not found",
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a listener snapshot of Copy probe is rejected so recapture cannot learn the runner UI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-probe-"));
  const serial = "live-probe-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 57051 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (listener, command) => {
    assert.equal(listener.port, 57051);
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    if (command.command === "querySelector") {
      return { ok: true, data: { found: false, nodes: [] } };
    }
    assert.equal(command.command, "snapshot");
    assert.equal(command.depth, 4);
    return {
      ok: true,
      data: {
        nodes: [
          { type: "Application", label: "AgentDeviceRunner" },
          { identifier: "agent-device.clipboard.probe" },
          { identifier: "agent-device.clipboard.copy", label: "Copy probe" },
        ],
      },
    };
  });
  try {
    await assert.rejects(
      snapshotViaLiveIosRunnerListener({ serial, appBundleId: "ai.x.GrokApp" }),
      (error: unknown) =>
        error instanceof Error && /Copy probe, not the product app/i.test(error.message),
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a listener snapshot failure uses the runner message, not [object Object]", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-objerr-"));
  const serial = "live-objerr-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      return { ok: true, data: { found: false, nodes: [] } };
    }
    return {
      ok: false,
      error: {
        message: "find could not read the current accessibility tree",
        code: "COMMAND_FAILED",
      },
    };
  });
  try {
    await assert.rejects(
      snapshotViaLiveIosRunnerListener({ serial, appBundleId: "ai.x.GrokApp" }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "find could not read the current accessibility tree" &&
        !error.message.includes("[object Object]"),
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("identifier presence uses the adopted listener instead of SDK find", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-exists-"));
  const serial = "live-exists-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    assert.equal(command.command, "querySelector");
    assert.equal(command.selectorKey, "id");
    if (command.selectorValue === "ask.toolbar.textfield") {
      return { ok: true, data: { found: true, nodes: [{ identifier: "ask.toolbar.textfield" }] } };
    }
    return { ok: true, data: { found: false, nodes: [] } };
  });
  try {
    assert.equal(
      await identifierPresentViaLiveIosRunnerListener({
        serial,
        identifier: "ask.toolbar.textfield",
        appBundleId: "ai.x.GrokApp",
      }),
      true,
    );
    assert.equal(
      await identifierPresentViaLiveIosRunnerListener({
        serial,
        identifier: "navigation.tab.imagine",
        appBundleId: "ai.x.GrokApp",
      }),
      false,
    );
    assert.equal(
      await identifierPresentViaLiveIosRunnerListener({
        serial: "no-lease-ipad",
        identifier: "ask.toolbar.textfield",
      }),
      undefined,
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a RUNNER_BUSY identifier query fails closed instead of falling through to another XCTest command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-busy-"));
  const serial = "live-busy-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  let snapshotCalls = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "snapshot") snapshotCalls += 1;
    return {
      ok: false,
      error: {
        code: "RUNNER_BUSY",
        message:
          "The iOS runner is still finishing a previous command that exceeded its execution watchdog (usually an accessibility capture on a heavy or animating screen).",
      },
    };
  });
  try {
    await assert.rejects(
      () =>
        identifierPresentViaLiveIosRunnerListener({
          serial,
          identifier: "ask.toolbar.textfield",
          appBundleId: "ai.x.GrokApp",
        }),
      /still finishing a previous command/u,
    );
    assert.equal(snapshotCalls, 0);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

const SETTINGS_CLOSE_TREE = [
  {
    index: 9,
    identifier: "Settings",
    label: "Close",
    type: "NavigationBar",
    enabled: true,
    hittable: false,
    rect: { x: 204, y: 40, width: 704, height: 56 },
  },
  {
    index: 10,
    parentIndex: 9,
    identifier: "toolbar.close.button",
    label: "Close",
    type: "Other",
    enabled: true,
    hittable: false,
    depth: 6,
    rect: { x: 224, y: 49, width: 38, height: 38 },
  },
  {
    index: 11,
    parentIndex: 10,
    label: "Close",
    type: "Other",
    enabled: true,
    hittable: false,
    rect: { x: 224, y: 49, width: 38, height: 38 },
  },
  {
    index: 12,
    parentIndex: 11,
    identifier: "toolbar.close.button",
    label: "Close",
    type: "Button",
    enabled: true,
    hittable: false,
    depth: 8,
    rect: { x: 224, y: 49, width: 38, height: 38 },
  },
];

test("ambiguous same-id listener query ranks the header close as present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-close-present-"));
  const serial = "live-close-present-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      return {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      };
    }
    if (command.command === "snapshot") {
      assert.equal(command.interactiveOnly, false);
      assert.equal(command.depth, 16);
      return { ok: true, data: { nodes: SETTINGS_CLOSE_TREE } };
    }
    throw new Error(`unexpected ${String(command.command)}`);
  });
  try {
    assert.equal(
      await identifierPresentViaLiveIosRunnerListener({
        serial,
        identifier: "toolbar.close.button",
        appBundleId: "ai.x.GrokApp",
      }),
      true,
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ambiguous same-id listener tap ranks then synth-taps the header close", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-close-tap-"));
  const serial = "live-close-tap-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const taps: Array<Record<string, unknown>> = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "tap" && command.selectorKey === "id") {
      taps.push(command);
      return {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      };
    }
    if (command.command === "snapshot") {
      return { ok: true, data: { nodes: SETTINGS_CLOSE_TREE } };
    }
    if (command.command === "tap") {
      taps.push(command);
      return { ok: true, data: { message: "tapped" } };
    }
    throw new Error(`unexpected ${String(command.command)}`);
  });
  try {
    await tapViaLiveIosRunnerListener({
      serial,
      selectorKey: "id",
      selectorValue: "toolbar.close.button",
      appBundleId: "ai.x.GrokApp",
    });
    assert.equal(taps.length, 2);
    assert.equal(taps[1]?.synthesized, true);
    assert.equal(taps[1]?.x, 243);
    assert.equal(taps[1]?.y, 68);
    assert.equal(taps[1]?.selectorKey, undefined);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ambiguous different-location same-id stays unresolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-close-ambig-"));
  const serial = "live-close-ambig-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector" || command.command === "tap") {
      return {
        ok: false,
        error: { code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements" },
      };
    }
    if (command.command === "snapshot") {
      return {
        ok: true,
        data: {
          nodes: [
            {
              identifier: "toolbar.close.button",
              type: "Button",
              enabled: true,
              hittable: true,
              rect: { x: 20, y: 40, width: 40, height: 40 },
            },
            {
              identifier: "toolbar.close.button",
              type: "Button",
              enabled: true,
              hittable: true,
              rect: { x: 700, y: 40, width: 40, height: 40 },
            },
          ],
        },
      };
    }
    throw new Error(`unexpected ${String(command.command)}`);
  });
  try {
    assert.equal(
      await identifierPresentViaLiveIosRunnerListener({
        serial,
        identifier: "toolbar.close.button",
      }),
      false,
    );
    await assert.rejects(
      tapViaLiveIosRunnerListener({
        serial,
        selectorKey: "id",
        selectorValue: "toolbar.close.button",
      }),
      /No unique control matched identifier after ranking/u,
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("identifier query returns unique home chrome omitted from the bounded composer snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-model-id-"));
  const serial = "live-model-id-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const model = {
    identifier: "toolbar.model.selector.button",
    label: "Fast",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 268, y: 784, width: 80, height: 36 },
  };
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorValue === "toolbar.model.selector.button") {
        return { ok: true, data: { found: true, nodes: [model] } };
      }
      return { ok: true, data: { found: false, nodes: [] } };
    }
    throw new Error("full snapshot must not run for a unique identifier query");
  });
  try {
    const nodes = await identifierNodesViaLiveIosRunnerListener({
      serial,
      identifier: "toolbar.model.selector.button",
      appBundleId: "ai.x.GrokApp",
    });
    assert.deepEqual(nodes, [{ ...model, logicalCoordinates: true }]);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listener snapshot chrome includes unique SuperGrok labels omitted from the bounded tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-compose-label-"));
  const serial = "live-compose-label-ipad";
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
  const labelQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "label") {
        labelQueries.push(String(command.selectorValue));
        if (command.selectorValue === "grok-compose") {
          return { ok: true, data: { found: true, nodes: [compose] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run after chrome labels resolve");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
    });
    assert.ok(labelQueries.includes("grok-compose"));
    assert.ok(labelQueries.includes("grok-arrows-right"));
    assert.deepEqual(
      nodes.filter((node) => node.label === "grok-compose"),
      [{ ...compose, logicalCoordinates: true }],
    );
    assert.ok(nodes.some((node) => node.identifier === "ask.toolbar.textfield"));
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listener snapshot chrome queries unique attach-sheet ids omitted from home n=7", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-attach-ids-"));
  const serial = "live-attach-ids-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const camera = {
    identifier: "ask.toolbar.add.menu.camera",
    label: "Camera",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 220, y: 520, width: 180, height: 44 },
  };
  const idQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "id") {
        idQueries.push(String(command.selectorValue));
        if (command.selectorValue === "sidebar.open.button") {
          return {
            ok: true,
            data: {
              found: true,
              nodes: [{ identifier: "sidebar.open.button", label: "Open sidebar" }],
            },
          };
        }
        if (command.selectorValue === "ask.toolbar.add.button") {
          return {
            ok: true,
            data: {
              found: true,
              nodes: [{ identifier: "ask.toolbar.add.button", label: "Attach" }],
            },
          };
        }
        if (command.selectorValue === "ask.toolbar.add.menu.camera") {
          return { ok: true, data: { found: true, nodes: [camera] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run after chrome identifiers resolve");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
      includeIdentifiers: ["ask.toolbar.add.menu.camera"],
    });
    assert.ok(idQueries.includes("ask.toolbar.add.menu.camera"));
    assert.ok(idQueries.includes("sidebar.open.button"));
    for (const identifier of [
      "ask.toolbar.add.menu.photos",
      "ask.toolbar.add.menu.files",
      "ask.toolbar.add.menu.connectors",
      "ask.toolbar.add.menu.skills",
      "sidebar.settings.button",
      "sidebar.search.field",
    ] as const) {
      assert.ok(IOS_BOUNDED_CHROME_IDENTIFIERS.includes(identifier));
      assert.equal(idQueries.includes(identifier), false);
    }
    assert.equal(idQueries.filter((value) => value === "ask.toolbar.add.menu.camera").length, 1);
    assert.deepEqual(
      nodes.filter((node) => node.identifier === "ask.toolbar.add.menu.camera"),
      [{ ...camera, logicalCoordinates: true }],
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listener snapshot chrome queries only requested attach-sheet ids when + is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-attach-requested-"));
  const serial = "live-attach-requested-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const camera = {
    identifier: "ask.toolbar.add.menu.camera",
    label: "Camera",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 220, y: 520, width: 180, height: 44 },
  };
  const idQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "id") {
        idQueries.push(String(command.selectorValue));
        if (command.selectorValue === "ask.toolbar.add.menu.camera") {
          return { ok: true, data: { found: true, nodes: [camera] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run after chrome identifiers resolve");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
      includeIdentifiers: ["ask.toolbar.add.menu.camera"],
    });
    assert.ok(idQueries.includes("ask.toolbar.add.menu.camera"));
    for (const identifier of [
      "ask.toolbar.add.menu.photos",
      "ask.toolbar.add.menu.files",
      "ask.toolbar.add.menu.connectors",
      "ask.toolbar.add.menu.skills",
    ] as const) {
      assert.equal(idQueries.includes(identifier), false);
    }
    assert.deepEqual(
      nodes.filter((node) => node.identifier === "ask.toolbar.add.menu.camera"),
      [{ ...camera, logicalCoordinates: true }],
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listener snapshot chrome skips attach, sidebar, and compose labels on closed home", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-closed-home-skip-"));
  const serial = "live-closed-home-skip-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const idQueries: string[] = [];
  const labelQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "label") {
        labelQueries.push(String(command.selectorValue));
        if (command.selectorValue === "New temporary conversation") {
          return {
            ok: true,
            data: {
              found: true,
              nodes: [
                {
                  label: "New temporary conversation",
                  type: "Button",
                  hittable: true,
                  rect: { x: 1052, y: 20, width: 44, height: 44 },
                },
              ],
            },
          };
        }
        return { ok: true, data: { found: false, nodes: [] } };
      }
      if (command.selectorKey === "id") {
        idQueries.push(String(command.selectorValue));
        if (command.selectorValue === "sidebar.open.button") {
          return {
            ok: true,
            data: {
              found: true,
              nodes: [{ identifier: "sidebar.open.button", label: "Open sidebar" }],
            },
          };
        }
        if (command.selectorValue === "ask.toolbar.add.button") {
          return {
            ok: true,
            data: {
              found: true,
              nodes: [{ identifier: "ask.toolbar.add.button", label: "Attach" }],
            },
          };
        }
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run after chrome identifiers resolve");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
    });
    assert.ok(idQueries.includes("sidebar.open.button"));
    assert.ok(idQueries.includes("ask.toolbar.add.button"));
    assert.ok(labelQueries.includes("New temporary conversation"));
    assert.ok(nodes.some((node) => node.label === "New temporary conversation"));
    for (const identifier of [
      "ask.toolbar.add.menu.camera",
      "ask.toolbar.add.menu.photos",
      "ask.toolbar.add.menu.files",
      "ask.toolbar.add.menu.connectors",
      "ask.toolbar.add.menu.skills",
      "sidebar.settings.button",
      "sidebar.search.field",
    ] as const) {
      assert.equal(idQueries.includes(identifier), false);
    }
    for (const label of [
      "grok-compose",
      "grok-arrows-right",
      "grok-gear",
      "grok-3-dots",
    ] as const) {
      assert.equal(labelQueries.includes(label), false);
    }
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("requested chrome inspect queries only the tap target, not the home catalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-requested-chrome-"));
  const serial = "live-requested-chrome-ipad";
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
  const idQueries: string[] = [];
  const labelQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "label") {
        labelQueries.push(String(command.selectorValue));
        if (command.selectorValue === "grok-compose") {
          return { ok: true, data: { found: true, nodes: [compose] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
      }
      if (command.selectorKey === "id") {
        idQueries.push(String(command.selectorValue));
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run for requested chrome inspect");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
      requestedChromeOnly: true,
      includeLabels: ["grok-compose"],
    });
    assert.deepEqual(labelQueries, ["grok-compose"]);
    assert.deepEqual(idQueries, []);
    assert.deepEqual(
      nodes.filter((node) => node.label === "grok-compose"),
      [{ ...compose, logicalCoordinates: true }],
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listener snapshot chrome queries unique sidebar ids omitted from home n=7", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-sidebar-ids-"));
  const serial = "live-sidebar-ids-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const gear = {
    identifier: "sidebar.settings.button",
    label: "grok-gear",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 24, y: 768, width: 44, height: 44 },
  };
  const idQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "id") {
        idQueries.push(String(command.selectorValue));
        if (command.selectorValue === "sidebar.settings.button") {
          return { ok: true, data: { found: true, nodes: [gear] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run after chrome identifiers resolve");
  });
  try {
    const nodes = await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
      includeIdentifiers: ["sidebar.settings.button"],
    });
    for (const identifier of ["sidebar.settings.button", "sidebar.search.field"] as const) {
      assert.ok(IOS_BOUNDED_CHROME_IDENTIFIERS.includes(identifier));
      assert.ok(idQueries.includes(identifier));
    }
    assert.equal(idQueries.filter((value) => value === "sidebar.settings.button").length, 1);
    assert.deepEqual(
      nodes.filter((node) => node.identifier === "sidebar.settings.button"),
      [{ ...gear, logicalCoordinates: true }],
    );
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("listener snapshot chrome skips attach-sheet ids when unique sidebar gear is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-sidebar-skip-attach-"));
  const serial = "live-sidebar-skip-attach-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  const gear = {
    identifier: "sidebar.settings.button",
    label: "grok-gear",
    type: "Button",
    enabled: true,
    hittable: true,
    rect: { x: 24, y: 768, width: 44, height: 44 },
  };
  const idQueries: string[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      if (command.selectorKey === "id") {
        idQueries.push(String(command.selectorValue));
        if (command.selectorValue === "sidebar.settings.button") {
          return { ok: true, data: { found: true, nodes: [gear] } };
        }
        return { ok: true, data: { found: false, nodes: [] } };
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
    throw new Error("conversation-depth snapshot must not run after chrome identifiers resolve");
  });
  try {
    await snapshotViaLiveIosRunnerListener({
      serial,
      appBundleId: "ai.x.GrokApp",
    });
    assert.ok(idQueries.includes("sidebar.settings.button"));
    assert.ok(idQueries.includes("ask.toolbar.add.button"));
    for (const identifier of [
      "ask.toolbar.add.menu.camera",
      "ask.toolbar.add.menu.photos",
      "ask.toolbar.add.menu.files",
      "ask.toolbar.add.menu.connectors",
      "ask.toolbar.add.menu.skills",
    ] as const) {
      assert.equal(idQueries.includes(identifier), false);
    }
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("label query returns unique chrome omitted from the bounded composer snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-label-nodes-"));
  const serial = "live-label-nodes-ipad";
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
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    if (command.command === "querySelector") {
      assert.equal(command.selectorKey, "label");
      if (command.selectorValue === "grok-compose") {
        return { ok: true, data: { found: true, nodes: [compose] } };
      }
      return { ok: true, data: { found: false, nodes: [] } };
    }
    throw new Error("full snapshot must not run for a unique label query");
  });
  try {
    const nodes = await labelNodesViaLiveIosRunnerListener({
      serial,
      label: "grok-compose",
      appBundleId: "ai.x.GrokApp",
    });
    assert.deepEqual(nodes, [{ ...compose, logicalCoordinates: true }]);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing listener is still a session error, not a reboot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-live-missing-"));
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  try {
    await assert.rejects(
      snapshotViaLiveIosRunnerListener({ serial: "no-lease-ipad" }),
      (error: unknown) =>
        error instanceof Error && error.message === "iOS snapshot needs an active XCTest session",
    );
  } finally {
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
