import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Device } from "./device.js";
import { rememberTargetApplication } from "./device-target-applications.js";
import { runRecipeStep } from "./recipe-runner.js";
import { resolvePointForDevice } from "./recipe-runner-support.js";
import { proveNavigationScreen, type RecipeStepContext } from "./recipe-runner-context.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithIosSupervisionMode } from "./ios-mutation-policy.js";
import { noteConfirmedIosSnapshotInput, resetIosSnapshotFlights } from "./ios-snapshot-flight.js";
import { InputNotDispatchedError } from "./input-not-dispatched.js";
import {
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
  type LiveIosRunnerCommandResult,
} from "./ios-runner-listener-command.js";

const appBundleId = "com.example.pointGeometry";
type WindowResponse = {
  ok: boolean;
  error?: LiveIosRunnerCommandResult["error"];
  data?: Record<string, unknown>;
};
const receipt = (width = 834, height = 1112) => ({
  appBundleId,
  appStateBefore: "runningForeground",
  appStateAfter: "runningForeground",
  source: "current-window",
  coordinateSpace: "application-logical",
  geometrySource: "xcui-window-frame",
  bounds: { x: 0, y: 0, width, height },
});
const point = {
  x: 869,
  y: 395,
  anchor: { horizontal: "right", vertical: "top" },
  referenceBounds: { width: 1112, height: 834 },
} as const;

function pointContext(): RecipeStepContext {
  const context: RecipeStepContext = {
    log: () => {},
    recordingIosAppBundleId: appBundleId,
    runtime: {},
  };
  proveNavigationScreen(context, {
    screenId: "composer",
    screenTitle: "Composer",
    observedAt: Date.now(),
    verifiedAt: Date.now(),
    nodes: [{ depth: 0, type: "Application", rect: receipt().bounds }],
  });
  return context;
}

async function withListener(
  run: (input: {
    device: Device;
    commands: LiveIosRunnerCommand[];
    context: { kind: "device"; platform: "ios"; serial: string };
    setBoundsResponse: (response: () => Promise<WindowResponse>) => void;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "relay-recipe-point-geometry-"));
  const context = {
    kind: "device",
    platform: "ios",
    serial: `point-geometry-${directory.split("/").at(-1)}`,
  } as const;
  const previousLease = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  await writeFile(
    join(directory, `${context.serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const commands: LiveIosRunnerCommand[] = [];
  let boundsResponse = async (): Promise<WindowResponse> => ({
    ok: true,
    data: receipt(),
  });
  const restore = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    commands.push(command);
    // This raw wire receipt is validated by observeIosNativeViewport, including
    // fields outside the general listener's older snapshot-only data type.
    if (command.command === "appWindowBounds")
      return (await boundsResponse()) as LiveIosRunnerCommandResult;
    if (command.command === "querySelector") return { ok: true, data: { found: false, nodes: [] } };
    if (command.command === "snapshot")
      return {
        ok: true,
        data: {
          nodes: [
            { depth: 0, type: "Application", rect: { x: 0, y: 0, width: 2224, height: 1668 } },
          ],
        },
      };
    assert.equal(command.command, "tap");
    return { ok: true };
  });
  const device = {
    capture: { snapshot: async () => assert.fail("must not acquire a catalog tree") },
    interactions: { press: async () => assert.fail("must not dispatch through another session") },
  } as unknown as Device;
  try {
    await rememberTargetApplication(appBundleId, context);
    await runWithTargetContext(context, () =>
      runWithIosSupervisionMode("test-optional", () =>
        run({
          device,
          commands,
          context,
          setBoundsResponse: (response) => (boundsResponse = response),
        }),
      ),
    );
  } finally {
    restore();
    resetIosSnapshotFlights(context);
    if (previousLease === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLease;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
}

test("recorded point uses one current logical window read before its one native dispatch", async () => {
  await withListener(async ({ device, commands }) => {
    await runRecipeStep(device, { kind: "tap", target: { point } }, pointContext());
    assert.deepEqual(
      commands.map((command) => command.command),
      ["appWindowBounds", "tap"],
    );
    assert.equal(commands[0]?.appBundleId, appBundleId);
    assert.equal(commands[1]?.appBundleId, appBundleId);
    assert.equal(commands[1]?.x, 591);
    assert.equal(commands[1]?.y, 395);
  });
});

test("a friendly expected Grok origin resolves to the actual bundle for the window read", async () => {
  await withListener(async ({ device, commands, context, setBoundsResponse }) => {
    await rememberTargetApplication("ai.x.GrokApp", context);
    setBoundsResponse(async () => ({
      ok: true,
      data: { ...receipt(), appBundleId: "ai.x.GrokApp" },
    }));
    await runRecipeStep(
      device,
      { kind: "tap", target: { point } },
      {
        ...pointContext(),
        recordingIosAppBundleId: "Grok",
      },
    );
    assert.deepEqual(
      commands.map((command) => command.appBundleId),
      ["ai.x.GrokApp", "ai.x.GrokApp"],
    );
  });
});

test("unavailable, foreign and nonlogical windows stop the recorded point before any fallback input", async () => {
  for (const response of [
    { ok: false, error: { code: "WINDOW_BOUNDS_UNAVAILABLE" } },
    { ok: false, error: { code: "RUNNER_BUSY" } },
    { ok: true, data: { ...receipt(), appBundleId: "com.example.foreign" } },
    { ok: true, data: { ...receipt(), coordinateSpace: "display-pixels" } },
    { ok: true, data: { ...receipt(), geometrySource: "descendant-union" } },
  ] satisfies WindowResponse[]) {
    await withListener(async ({ device, commands, setBoundsResponse }) => {
      setBoundsResponse(async () => response);
      await assert.rejects(
        runRecipeStep(
          device,
          {
            kind: "tap",
            target: { point },
            fallbackTargets: [{ identifier: "fallback.button" }],
          },
          pointContext(),
        ),
        InputNotDispatchedError,
      );
      assert.deepEqual(
        commands.map((command) => command.command),
        ["appWindowBounds"],
      );
    });
  }
});

test("the next confirmed input fence reads current window dimensions instead of cached orientation", async () => {
  await withListener(async ({ device, commands, setBoundsResponse }) => {
    await runRecipeStep(device, { kind: "tap", target: { point } }, pointContext());
    setBoundsResponse(async () => ({ ok: true, data: receipt(1112, 834) }));
    await runRecipeStep(device, { kind: "tap", target: { point } }, pointContext());
    assert.deepEqual(
      commands.map((command) => command.command),
      ["appWindowBounds", "tap", "appWindowBounds", "tap"],
    );
    assert.equal(commands[1]?.x, 591);
    assert.equal(commands[3]?.x, 869);
  });
});

test("a manual rotation without Relay input still reads current geometry for the next point action", async () => {
  await withListener(async ({ device, commands, setBoundsResponse }) => {
    await resolvePointForDevice(device, point);
    setBoundsResponse(async () => ({ ok: true, data: receipt(1112, 834) }));
    await runRecipeStep(device, { kind: "tap", target: { point } }, pointContext());
    assert.deepEqual(
      commands.map((command) => command.command),
      ["appWindowBounds", "appWindowBounds", "tap"],
    );
    assert.equal(commands[2]?.x, 869);
  });
});

test("a semantic selector does not need geometry for its unused recorded fallback point", async () => {
  await withListener(async ({ device, commands, setBoundsResponse }) => {
    setBoundsResponse(async () => ({ ok: false, error: { code: "WINDOW_BOUNDS_UNAVAILABLE" } }));
    await runRecipeStep(
      device,
      { kind: "tap", target: { identifier: "semantic.button", point } },
      pointContext(),
    );
    assert.deepEqual(
      commands.map((command) => command.command),
      ["tap"],
    );
    assert.equal(commands[0]?.selectorValue, "semantic.button");
  });
});

test("an application or confirmed input change during the window read cannot dispatch a point", async () => {
  for (const change of ["application", "input"] as const) {
    await withListener(async ({ device, commands, context, setBoundsResponse }) => {
      setBoundsResponse(async () => {
        if (change === "application")
          await rememberTargetApplication("com.example.foreign", context);
        else noteConfirmedIosSnapshotInput(context.serial);
        return { ok: true, data: receipt() };
      });
      await assert.rejects(
        runRecipeStep(device, { kind: "tap", target: { point } }, pointContext()),
        InputNotDispatchedError,
      );
      assert.deepEqual(
        commands.map((command) => command.command),
        ["appWindowBounds"],
      );
    });
  }
});

test("a changed application cannot reuse successful bounds from the same input fence", async () => {
  await withListener(async ({ device, commands, context }) => {
    await resolvePointForDevice(device, point);
    await rememberTargetApplication("com.example.foreign", context);
    await assert.rejects(
      runRecipeStep(device, { kind: "tap", target: { point } }, pointContext()),
      InputNotDispatchedError,
    );
    assert.deepEqual(
      commands.map((command) => command.command),
      ["appWindowBounds"],
    );
  });
});

for (const context of [
  { kind: "device", platform: "android", serial: "point-geometry-android" },
  { kind: "browser", platform: "browser", targetId: "point-geometry-browser" },
] as const) {
  test(`${context.platform} recorded points retain snapshot geometry and anchored coordinates`, async () => {
    let snapshots = 0;
    const presses: unknown[] = [];
    const device = {
      capture: {
        snapshot: async () => {
          snapshots += 1;
          return { nodes: [{ depth: 0, type: "Application", rect: receipt().bounds }] };
        },
      },
      interactions: {
        press: async (input: unknown) => {
          presses.push(input);
          return {};
        },
      },
    } as unknown as Device;
    await runWithTargetContext(context, () =>
      runRecipeStep(device, { kind: "tap", target: { point } }, pointContext()),
    );
    assert.equal(snapshots, 1);
    assert.equal(presses.length, 1);
    assert.equal((presses[0] as { x: number }).x, 591);
    assert.equal((presses[0] as { y: number }).y, 395);
  });
}
