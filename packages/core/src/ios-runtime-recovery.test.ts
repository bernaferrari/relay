import assert from "node:assert/strict";
import test from "node:test";
import {
  isRecoverableIosRuntimeError,
  isIosSessionBindingError,
  recoverIosRuntime,
  type IosRuntimeRecoveryDependencies,
} from "./ios-runtime-recovery.js";

const coreDevice =
  "/Library/Developer/PrivateFrameworks/CoreDevice.framework/Versions/A/XPCServices/CoreDeviceService.xpc/Contents/MacOS/CoreDeviceService";

function dependencies(
  overrides: Partial<IosRuntimeRecoveryDependencies> = {},
): IosRuntimeRecoveryDependencies {
  return {
    stateDir: "/state",
    readFile: async () => JSON.stringify({ pid: 41, startTime: "Mon Aug 3 10:00:00 2026" }),
    listDirectory: async () => [],
    removeDirectory: async () => undefined,
    process: async () => ({ alive: false }),
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    restartAgentDevice: async () => false,
    terminate: async () => true,
    ...overrides,
  };
}

test("classifies infrastructure drift without hiding signing or trust failures", () => {
  assert.equal(isIosSessionBindingError(new Error("No active app session")), true);
  assert.equal(isRecoverableIosRuntimeError(new Error("No active app session")), false);
  assert.equal(
    isRecoverableIosRuntimeError(new Error("CoreDevice.ActionError: StreamingAction failed")),
    true,
  );
  assert.equal(isRecoverableIosRuntimeError(new Error("No Account for Team DESXYH8838")), false);
  assert.equal(isRecoverableIosRuntimeError(new Error("Developer Mode disabled")), false);
});

test("removes only locks whose verified owner is no longer alive", async () => {
  const removed: string[] = [];
  const result = await recoverIosRuntime(
    { serial: "ipad" },
    dependencies({
      listDirectory: async (path) =>
        path.endsWith("ios-device") ? ["cache-a.lock", "not-a-lock.txt"] : ["ipad.json.lock"],
      readFile: async (path) =>
        path.includes("cache-a")
          ? JSON.stringify({ pid: 41, startTime: "Mon Aug 3 10:00:00 2026" })
          : JSON.stringify({ pid: 42, startTime: "Mon Aug 3 11:00:00 2026" }),
      process: async (pid) =>
        pid === 42 ? { alive: true, startTime: "Mon Aug 3 11:00:00 2026" } : { alive: false },
      removeDirectory: async (path) => {
        removed.push(path);
      },
      restartAgentDevice: async () => true,
    }),
  );
  assert.deepEqual(removed, ["/state/apple-runner/derived/ios-device/cache-a.lock"]);
  assert.equal(result.ready, true);
  assert.equal(result.recovered, true);
  assert.equal(result.actions.filter((action) => action.kind === "stale-lock").length, 1);
  assert.equal(
    result.actions.some((action) => action.kind === "agent-device"),
    true,
  );
});

test("preserves an unverifiable lock instead of deleting user state", async () => {
  const removed: string[] = [];
  const result = await recoverIosRuntime(
    { serial: "ipad" },
    dependencies({
      listDirectory: async (path) => (path.endsWith("leases") ? ["ipad.json.lock"] : []),
      readFile: async () => "not-json",
      removeDirectory: async (path) => {
        removed.push(path);
      },
    }),
  );
  assert.deepEqual(removed, []);
  assert.equal(result.actions[0]?.status, "skipped");
});

test("an explicit recovery reconciles the Relay daemon even when the device probe is healthy", async () => {
  let restarts = 0;
  const result = await recoverIosRuntime(
    { serial: "ipad", force: true },
    dependencies({
      restartAgentDevice: async () => {
        restarts += 1;
        return true;
      },
    }),
  );
  assert.equal(restarts, 1);
  assert.equal(result.ready, true);
  assert.equal(result.actions[0]?.kind, "agent-device");
});

test("restarts only the exact CoreDeviceService after its characteristic failure", async () => {
  const terminated: number[] = [];
  let probes = 0;
  const result = await recoverIosRuntime(
    { serial: "ipad" },
    dependencies({
      run: async (command) => {
        if (command === "ps") {
          return {
            exitCode: 0,
            stdout: `71 ${coreDevice}\n72 /usr/bin/unrelated CoreDeviceService`,
            stderr: "",
          };
        }
        probes += 1;
        return probes === 1
          ? {
              exitCode: 1,
              stdout: "",
              stderr:
                "CoreDevice.ActionError: StreamingAction: Couldn't get the message from the device.",
            }
          : { exitCode: 0, stdout: "ready", stderr: "" };
      },
      terminate: async (pid) => {
        terminated.push(pid);
        return true;
      },
    }),
  );
  assert.deepEqual(terminated, [71]);
  assert.equal(probes, 2);
  assert.equal(result.ready, true);
  assert.equal(result.actions.at(-1)?.kind, "core-device");
});

test("does not restart CoreDevice for an ordinary device or user-action failure", async () => {
  let psCalls = 0;
  const result = await recoverIosRuntime(
    { serial: "ipad" },
    dependencies({
      run: async (command) => {
        if (command === "ps") psCalls += 1;
        return { exitCode: 1, stdout: "", stderr: "Developer Mode is disabled" };
      },
    }),
  );
  assert.equal(psCalls, 0);
  assert.equal(result.ready, false);
  assert.equal(
    result.actions.some((action) => action.kind === "core-device"),
    false,
  );
});
