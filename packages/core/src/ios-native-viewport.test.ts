import assert from "node:assert/strict";
import test from "node:test";
import {
  IosNativeViewportUnavailableError,
  observeIosNativeViewport,
} from "./ios-native-viewport.js";
import type { LiveIosRunnerCommandResult } from "./ios-runner-listener-command.js";
import {
  nativeViewportForTarget,
  NATIVE_VIEWPORT_FACT_TTL_MS,
  recordNativeViewport,
} from "./native-target-profile.js";

const serial = "viewport-test-ipad";
const originApplication = "com.example.product";
const receipt = (width = 1112, height = 834) => ({
  appBundleId: originApplication,
  appStateBefore: "runningForeground",
  appStateAfter: "runningForeground",
  source: "current-window",
  coordinateSpace: "application-logical",
  geometrySource: "xcui-window-frame",
  bounds: { x: 0, y: 0, width, height },
});
const listener = { serial, port: 1234, runnerPid: 123 };

test("expired capture facts use one current logical window receipt, including rotation", async () => {
  const target = { targetId: serial, platform: "ios" as const };
  recordNativeViewport(target, { width: 834, height: 1112 }, 1);
  assert.equal(nativeViewportForTarget(target, NATIVE_VIEWPORT_FACT_TTL_MS + 2), undefined);
  const commands: unknown[] = [];
  let portrait = false;
  const runtime = {
    probeListener: async () => listener,
    post: async (
      _listener: typeof listener,
      command: Record<string, unknown>,
      timeoutMs: number,
    ) => {
      commands.push(command);
      assert.equal(timeoutMs, 20_000);
      assert.equal(command.timeoutMs, 15_000);
      return { ok: true, data: portrait ? receipt(834, 1112) : receipt() };
    },
  };
  assert.deepEqual(await observeIosNativeViewport(serial, originApplication, runtime), {
    width: 1112,
    height: 834,
  });
  portrait = true;
  assert.deepEqual(await observeIosNativeViewport(serial, originApplication, runtime), {
    width: 834,
    height: 1112,
  });
  assert.deepEqual(commands, [
    { command: "appWindowBounds", appBundleId: originApplication, timeoutMs: 15_000 },
    { command: "appWindowBounds", appBundleId: originApplication, timeoutMs: 15_000 },
  ]);
  assert.equal(
    nativeViewportForTarget(target, NATIVE_VIEWPORT_FACT_TTL_MS + 2),
    undefined,
    "an admission read does not refresh passive capture evidence or semantic readiness",
  );
});

test("missing, host-only, background, foreign or unproven geometry never proves a viewport", async () => {
  for (const data of [
    undefined,
    {},
    { nodes: [{ depth: 0, type: "Application", rect: receipt().bounds }] },
    { ...receipt(), appBundleId: "com.example.AgentDeviceRunner" },
    { ...receipt(), appStateBefore: "runningBackground" },
    { ...receipt(), appStateAfter: "runningBackground" },
    { ...receipt(), source: "app-frame" },
    { ...receipt(), geometrySource: "descendant-union" },
    { ...receipt(), coordinateSpace: "display-pixels" },
    { ...receipt(), bounds: undefined },
    { ...receipt(), bounds: { ...receipt().bounds, width: 0 } },
    { ...receipt(), bounds: { ...receipt().bounds, width: 1112.5 } },
    { ...receipt(), bounds: { ...receipt().bounds, y: NaN } },
  ]) {
    await assert.rejects(
      observeIosNativeViewport(serial, originApplication, {
        probeListener: async () => listener,
        post: async () => ({ ok: true, data }),
      }),
      (error: unknown) =>
        error instanceof IosNativeViewportUnavailableError && error.reason === "bounds-unavailable",
    );
  }
});

test("busy or absent listener stops without reconnect, input or another inspection", async () => {
  for (const result of [
    { ok: false, error: { code: "RUNNER_BUSY", message: "still finishing a previous command" } },
    { ok: false, error: { code: "RUNNER_WEDGED" } },
  ] satisfies LiveIosRunnerCommandResult[]) {
    let reads = 0;
    await assert.rejects(
      observeIosNativeViewport(serial, originApplication, {
        probeListener: async () => listener,
        post: async () => {
          reads++;
          return result;
        },
      }),
      (error: unknown) =>
        error instanceof IosNativeViewportUnavailableError && error.reason === "runner-busy",
    );
    assert.equal(reads, 1);
  }
  await assert.rejects(
    observeIosNativeViewport(serial, originApplication, {
      probeListener: async () => null,
      post: async () => {
        throw new Error("no listener must never send a command");
      },
    }),
    (error: unknown) =>
      error instanceof IosNativeViewportUnavailableError && error.reason === "runner-unavailable",
  );
});

test("saved origin uses canonical launch resolution without launching or guessing an unknown app", async () => {
  const commands: unknown[] = [];
  const runtime = {
    probeListener: async () => listener,
    post: async (_listener: typeof listener, command: Record<string, unknown>) => {
      commands.push(command);
      return { ok: true, data: { ...receipt(), appBundleId: "ai.x.GrokApp" } };
    },
  };
  await observeIosNativeViewport(serial, "Grok", runtime);
  assert.deepEqual(commands, [
    { command: "appWindowBounds", appBundleId: "ai.x.GrokApp", timeoutMs: 15_000 },
  ]);
  for (const origin of ["", "Unknown app"]) {
    await assert.rejects(
      observeIosNativeViewport(serial, origin, runtime),
      (error: unknown) =>
        error instanceof IosNativeViewportUnavailableError && error.reason === "origin-unavailable",
    );
  }
  assert.equal(commands.length, 1);
});

test("an older runner refuses the new read without falling back to snapshots or input", async () => {
  const commands: unknown[] = [];
  await assert.rejects(
    observeIosNativeViewport(serial, originApplication, {
      probeListener: async () => listener,
      post: async (_listener, command) => {
        commands.push(command);
        return { ok: false, error: { code: "UNSUPPORTED_OPERATION" } };
      },
    }),
    (error: unknown) =>
      error instanceof IosNativeViewportUnavailableError && error.reason === "bounds-unavailable",
  );
  assert.deepEqual(commands, [
    { command: "appWindowBounds", appBundleId: originApplication, timeoutMs: 15_000 },
  ]);
});

test("native watchdog and transport deadlines terminate after one bounded window command", async () => {
  const target = { targetId: serial, platform: "ios" as const };
  const transportTimeout = new DOMException("deadline expired", "TimeoutError");
  for (const outcome of ["native", "transport"] as const) {
    let sends = 0;
    await assert.rejects(
      observeIosNativeViewport(serial, originApplication, {
        probeListener: async () => listener,
        post: async (_listener, command, transportBudget) => {
          sends += 1;
          assert.deepEqual(command, {
            command: "appWindowBounds",
            appBundleId: originApplication,
            timeoutMs: 15_000,
          });
          assert.equal(transportBudget, 20_000);
          if (outcome === "transport") throw transportTimeout;
          return { ok: false, error: { code: "MAIN_THREAD_TIMEOUT" } };
        },
      }),
      (error: unknown) =>
        outcome === "transport"
          ? error === transportTimeout
          : error instanceof IosNativeViewportUnavailableError &&
            error.reason === "bounds-unavailable",
    );
    assert.equal(sends, 1);
    assert.equal(nativeViewportForTarget(target, NATIVE_VIEWPORT_FACT_TTL_MS + 2), undefined);
  }
});
