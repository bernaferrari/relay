import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isIosRunnerProcessAlive,
  probeLiveIosRunnerListener,
  readIosRunnerLease,
  waitForIosRunnerListenerReady,
} from "./ios-runner-listener.js";

test("a live lease pid is a healthy testCommand listener", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-listener-"));
  const serial = "listener-ipad";
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  try {
    const live = await probeLiveIosRunnerListener(serial, {
      AGENT_DEVICE_IOS_RUNNER_LEASE_DIR: dir,
    });
    assert.deepEqual(live, { serial, runnerPid: process.pid, port: 50937 });
    assert.equal(isIosRunnerProcessAlive(process.pid), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a dead lease pid is a missing runner, not a reboot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-listener-dead-"));
  const serial = "dead-listener-ipad";
  await writeFile(join(dir, `${serial}.json`), JSON.stringify({ runnerPid: 1, port: 1 }));
  try {
    const lease = await readIosRunnerLease(serial, { AGENT_DEVICE_IOS_RUNNER_LEASE_DIR: dir });
    assert.equal(lease?.runnerPid, 1);
    assert.equal(
      await probeLiveIosRunnerListener(serial, { AGENT_DEVICE_IOS_RUNNER_LEASE_DIR: dir }),
      null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("waitForIosRunnerListenerReady adopts the listener once the lease appears", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-listener-wait-"));
  const serial = "wait-listener-ipad";
  const env = { AGENT_DEVICE_IOS_RUNNER_LEASE_DIR: dir };
  const pending = waitForIosRunnerListenerReady(serial, { timeoutMs: 2_000, pollMs: 50, env });
  setTimeout(() => {
    void writeFile(
      join(dir, `${serial}.json`),
      JSON.stringify({ runnerPid: process.pid, port: 41000 }),
    );
  }, 80);
  try {
    const live = await pending;
    assert.equal(live?.port, 41000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
