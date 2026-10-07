import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pressNamedControl, rememberTargetApplication, type Device } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import {
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
} from "./ios-runner-listener-command.js";
import type { SnapshotNode } from "./device-capabilities.js";
import { namedControlObservationOptions } from "./named-control-observation.js";

const application = {
  depth: 0,
  type: "Application",
  identifier: "ai.x.GrokApp",
  rect: { x: 0, y: 0, width: 1112, height: 834 },
};
const sidebar = {
  type: "Button",
  identifier: "sidebar.open.button",
  label: "Open sidebar",
  enabled: true,
  hittable: true,
  rect: { x: 16, y: 20, width: 44, height: 44 },
};

test("mixed named intents and non-iOS identifiers retain their full observation", () => {
  for (const target of [
    { identifier: sidebar.identifier, label: sidebar.label },
    { identifier: sidebar.identifier, text: "Sidebar" },
    { identifier: sidebar.identifier, heading: "Navigation" },
    { identifier: sidebar.identifier, role: "Button" },
    { identifier: sidebar.identifier, point: { x: 38, y: 42 } },
  ]) {
    assert.equal(namedControlObservationOptions(target, "ios").requestedChromeOnly, false);
  }
  assert.equal(
    namedControlObservationOptions(
      {
        identifier: sidebar.identifier,
        relation: { kind: "following-row", anchor: { label: "Navigation" } },
      },
      "ios",
    ).requestedChromeOnly,
    false,
  );
  assert.equal(
    namedControlObservationOptions({ identifier: sidebar.identifier }, "android")
      .requestedChromeOnly,
    false,
  );
});

async function withListener(
  identifierNodes: SnapshotNode[],
  run: (device: Device, commands: LiveIosRunnerCommand[]) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-identifier-observation-"));
  const serial = `identifier-observation-${dir.split("/").at(-1)}`;
  const context = { kind: "device", platform: "ios", serial } as const;
  const previousLeaseDir = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  process.env.RELAY_WORKSPACE_ROOT = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const commands: LiveIosRunnerCommand[] = [];
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    commands.push(command);
    if (command.command === "querySelector") {
      const nodes =
        command.selectorValue === sidebar.identifier || command.selectorValue === sidebar.label
          ? identifierNodes
          : [];
      return { ok: true, data: { found: nodes.length > 0, nodes } };
    }
    if (command.command === "snapshot") {
      assert.equal(command.depth, 0);
      return { ok: true, data: { nodes: [application] } };
    }
    assert.equal(command.command, "tap");
    return { ok: true };
  });
  const device = {
    capture: { snapshot: async () => assert.fail("must use the owned live listener") },
    interactions: { press: async () => assert.fail("must not dispatch a second SDK tap") },
  } as unknown as Device;
  try {
    await rememberTargetApplication("ai.x.GrokApp", context);
    await runWithTargetContext(context, () => run(device, commands));
  } finally {
    restore();
    if (previousLeaseDir === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLeaseDir;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(dir, { recursive: true, force: true });
  }
}

test("a unique iOS identifier tap queries only that identifier and dispatches once", async () => {
  await withListener([sidebar], async (device, commands) => {
    const resolution = await pressNamedControl(device, { identifier: sidebar.identifier });
    assert.equal(resolution.method, "identifier");
    assert.deepEqual(resolution.point, { x: 38, y: 42 });
    assert.deepEqual(
      commands
        .filter((command) => command.command === "querySelector")
        .map((command) => command.selectorValue),
      [sidebar.identifier],
    );
    const taps = commands.filter((command) => command.command === "tap");
    assert.equal(taps.length, 1);
    assert.equal(taps[0]?.selectorKey, "id");
    assert.equal(taps[0]?.selectorValue, sidebar.identifier);
    assert.equal(commands.filter((command) => command.command === "snapshot").length, 1);
  });
});

test("duplicate iOS identifiers refuse the tap", async () => {
  await withListener(
    [sidebar, { ...sidebar, rect: { x: 200, y: 20, width: 44, height: 44 } }],
    async (device, commands) => {
      await assert.rejects(
        pressNamedControl(device, { identifier: sidebar.identifier }),
        /no unique control matched/u,
      );
      assert.equal(
        commands.some((command) => command.command === "tap"),
        false,
      );
    },
  );
});

test("a missing iOS identifier refuses the tap", async () => {
  await withListener([], async (device, commands) => {
    await assert.rejects(
      pressNamedControl(device, { identifier: sidebar.identifier }),
      /no unique control matched/u,
    );
    assert.equal(
      commands.some((command) => command.command === "tap"),
      false,
    );
  });
});

test("label taps retain the existing chrome observation and native label route", async () => {
  await withListener([sidebar], async (device, commands) => {
    const resolution = await pressNamedControl(device, { label: sidebar.label });
    assert.equal(resolution.method, "label");
    assert.ok(commands.some((command) => command.selectorValue === "ask.toolbar.textfield"));
    const taps = commands.filter((command) => command.command === "tap");
    assert.equal(taps.length, 1);
    assert.equal(taps[0]?.selectorKey, "label");
  });
});

test("point-only taps do not introduce accessibility observations", async () => {
  await withListener([], async (device, commands) => {
    const resolution = await pressNamedControl(device, { point: { x: 38, y: 42 } });
    assert.equal(resolution.method, "point");
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.command, "tap");
    assert.equal(commands[0]?.x, 38);
    assert.equal(commands[0]?.y, 42);
  });
});
