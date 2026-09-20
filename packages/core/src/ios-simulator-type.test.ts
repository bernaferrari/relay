import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { typeText, type Device } from "./device.js";
import { setLiveIosRunnerCommandPostForTests } from "./ios-runner-listener-command.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";

test("simulator typing never posts through the physical usbmux listener", async () => {
  const serial = "D2625C92-964D-4326-8C83-0A4B9B06431D";
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-sim-type-"));
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937, ownerPid: process.pid }),
  );
  const typed: string[] = [];
  let listenerPosts = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async () => {
    listenerPosts += 1;
    throw new Error("physical usbmux must not run for a simulator");
  });
  const device = {
    interactions: {
      type: async (options: { text: string }) => {
        typed.push(options.text);
        return {};
      },
    },
  } as unknown as Device;
  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
        typeText(device, "café 日本語"),
      ),
    );
    assert.deepEqual(typed, ["café 日本語"]);
    assert.equal(listenerPosts, 0);
  } finally {
    restore();
    supervisors.close();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
