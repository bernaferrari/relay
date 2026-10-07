import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device.js";
import { resetIosSnapshotFlights } from "./ios-snapshot-flight.js";
import { runWithTargetContext } from "./target-context.js";
import { targetPresent } from "./recipe-runner-support.js";
import { setLiveIosRunnerCommandPostForTests } from "./ios-runner-listener-command.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.afterEach(() => resetIosSnapshotFlights());

test("iOS identifier presence does not queue a snapshot behind RUNNER_BUSY", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-present-busy-"));
  const serial = "present-busy-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  let snapshotCalls = 0;
  let findCalls = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async () => ({
    ok: false,
    error: {
      code: "RUNNER_BUSY",
      message:
        "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
    },
  }));
  const device = {
    capture: {
      snapshot: async () => {
        snapshotCalls += 1;
        return { nodes: [] };
      },
    },
    interactions: {
      find: async () => {
        findCalls += 1;
        throw new Error("No match");
      },
    },
  } as unknown as Device;
  try {
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
          targetPresent(device, { identifier: "ask.toolbar.textfield" }),
        ),
      /still finishing a previous command/u,
    );
    assert.equal(snapshotCalls, 0);
    assert.equal(findCalls, 0);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
