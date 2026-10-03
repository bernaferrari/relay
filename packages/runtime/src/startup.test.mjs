import assert from "node:assert/strict";
import test from "node:test";
import { hostname } from "node:os";
import {
  assertCompatibleRuntime,
  waitForRuntimeBootstrap,
  ensureRelayRuntime,
} from "./startup.mjs";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const observed = {
  ok: true,
  product: "relay",
  version: "0.1.0",
  pid: process.pid,
  runsDir: "/chosen/workspace/runs",
  access: { organizationId: "local", projectId: "default" },
};
const owner = { schemaVersion: 1, pid: process.pid, host: hostname() };
test("package child named ..cache cannot hold workspace or state; reject before writes", async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const forbidden = resolve(packageRoot, "..cache");
  const temporary = await mkdtemp(resolve(tmpdir(), "relay-runtime-boundary-"));
  const workspaceRoot = resolve(temporary, "not-created");
  try {
    await assert.rejects(
      ensureRelayRuntime({ workspaceRoot: forbidden }),
      /outside the installed Relay package/u,
    );
    await assert.rejects(
      ensureRelayRuntime({ workspaceRoot, stateDirectory: forbidden }),
      /outside the installed Relay package/u,
    );
    await assert.rejects(stat(forbidden), { code: "ENOENT" });
    await assert.rejects(stat(workspaceRoot), { code: "ENOENT" });
  } finally {
    await rm(temporary, { recursive: true });
  }
});
test("attach requires matching version, workspace and canonical state owner", () => {
  assert.doesNotThrow(() =>
    assertCompatibleRuntime({
      observed,
      owner,
      workspaceRoot: "/chosen/workspace",
      version: "0.1.0",
    }),
  );
  for (const mismatch of [
    { observed: { ...observed, version: "future" } },
    { observed: { ...observed, runsDir: "/other/workspace/runs" } },
    { owner: { ...owner, pid: process.pid + 1 } },
    { owner: { ...owner, host: "another-host" } },
    { owner: undefined },
  ]) {
    assert.throws(
      () =>
        assertCompatibleRuntime({
          observed,
          owner,
          workspaceRoot: "/chosen/workspace",
          version: "0.1.0",
          ...mismatch,
        }),
      /no process was stopped/u,
    );
  }
});

test("authenticated health redacts paths: matching packaged descriptor still proves workspace", () => {
  const redacted = { ...observed, runsDir: "runs" };
  const options = {
    observed: redacted,
    owner,
    workspaceRoot: "/chosen/workspace",
    version: "0.1.0",
  };
  assert.throws(() => assertCompatibleRuntime(options), /no process was stopped/u);
  assert.doesNotThrow(() =>
    assertCompatibleRuntime({
      ...options,
      descriptor: { workspaceRoot: "/chosen/workspace", pid: owner.pid },
    }),
  );
  assert.throws(
    () =>
      assertCompatibleRuntime({
        ...options,
        descriptor: { workspaceRoot: "/other/workspace", pid: owner.pid },
      }),
    /no process was stopped/u,
  );
});

test("contending startup waits for the canonical lock; operation failures never retry", async () => {
  let attempts = 0;
  const options = { path: "/chosen/workspace/bootstrap", operation: async () => "attached" };
  const result = await waitForRuntimeBootstrap(options, {
    bootstrap: async (received) => {
      assert.equal(received, options);
      if (attempts++ === 0)
        throw Object.assign(new Error("locked"), { code: "RELAY_SERVER_BOOTSTRAP_LOCKED" });
      return received.operation();
    },
    delay: async () => {},
  });
  assert.equal(result, "attached");
  assert.equal(attempts, 2);
  let time = 0;
  await assert.rejects(
    waitForRuntimeBootstrap(options, {
      bootstrap: async () => {
        throw Object.assign(new Error("locked"), { code: "RELAY_SERVER_BOOTSTRAP_LOCKED" });
      },
      now: () => time,
      delay: async () => {
        time += 35_000;
      },
    }),
    /locked/u,
  );
  attempts = 0;
  await assert.rejects(
    waitForRuntimeBootstrap(options, {
      bootstrap: async () => {
        attempts++;
        throw new Error("uncertain launch");
      },
    }),
    /uncertain launch/u,
  );
  assert.equal(attempts, 1);
});
