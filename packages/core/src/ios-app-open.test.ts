import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openApp, rememberedTargetApplication, type Device } from "./device.js";
import { openPhysicalIosApp, setIosAppOpenRuntimeForTests } from "./ios-app-open.js";
import { lastIosMutationAttemptDiagnostic } from "./ios-mutation-policy.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";

const ios = (serial: string) => ({ kind: "device", platform: "ios", serial }) as const;

test("a successful sidecar app open dispatches once and never primes through SDK apps.open", async () => {
  const serial = "ios-app-open-sidecar-success";
  const context = ios(serial);
  const remembered: string[] = [];
  let sidecarLaunches = 0;
  let sdkAppOpenCalls = 0;
  const input = {
    context,
    app: "Grok",
    relaunch: false,
    rememberApplication: async (app: string) => {
      remembered.push(app);
    },
    // This deliberately remains outside OpenPhysicalIosAppInput. If a
    // future implementation brings back a hidden SDK session prime, the
    // test sees it as a second physical activation.
    device: {
      apps: {
        open: async () => {
          sdkAppOpenCalls += 1;
        },
      },
    },
  };

  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext(context, () =>
        openPhysicalIosApp(input, {
          resolveBundleId: (app) => {
            assert.equal(app, "Grok");
            return "ai.x.GrokApp";
          },
          launch: async (launchSerial, bundleId, options) => {
            sidecarLaunches += 1;
            assert.equal(launchSerial, serial);
            assert.equal(bundleId, "ai.x.GrokApp");
            assert.deepEqual(options, { relaunch: false });
            return { bundleId, method: "devicectl" };
          },
        }),
      ),
    );
    assert.deepEqual(
      supervisors
        .health({ id: serial, kind: "ios" })
        .events.filter((event) => event.code.startsWith("INPUT_"))
        .map((event) => event.code)
        .reverse(),
      ["INPUT_INTENT_PERSISTED", "INPUT_DISPATCHED", "INPUT_COMPLETED"],
    );
  } finally {
    supervisors.close();
  }

  assert.equal(sidecarLaunches, 1);
  assert.equal(sdkAppOpenCalls, 0);
  assert.deepEqual(remembered, ["ai.x.GrokApp"]);
  const diagnostic = lastIosMutationAttemptDiagnostic(serial);
  assert.ok(diagnostic);
  assert.deepEqual(
    { ...diagnostic, at: 0 },
    {
      sequence: 1,
      operation: "app-open",
      nativeAttempts: 1,
      outcome: "completed",
      retry: {
        attempts: 0,
        decision: "not-needed",
        reason: "native-command-completed",
      },
      intervention: { required: false, action: "none" },
      at: 0,
    },
  );
});

test("public physical iOS launch dispatches sidecar once and does not open through the SDK", async () => {
  const serial = "ios-public-launch-no-second-open";
  const context = ios(serial);
  let sidecarLaunches = 0;
  let sdkAppOpenCalls = 0;
  const device = {
    apps: {
      open: async () => {
        sdkAppOpenCalls += 1;
        throw new Error("SDK session conflict");
      },
    },
  } as unknown as Device;
  const root = await mkdtemp(join(tmpdir(), "relay-ios-launch-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  setIosAppOpenRuntimeForTests({
    resolveBundleId: (app) => {
      assert.equal(app, "settings");
      return "com.apple.Preferences";
    },
    launch: async (launchSerial, bundleId) => {
      sidecarLaunches += 1;
      assert.equal(launchSerial, serial);
      assert.equal(bundleId, "com.apple.Preferences");
      return { bundleId, method: "devicectl" };
    },
  });
  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    const result = await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext(context, () => openApp(device, "settings", { relaunch: false })),
    );
    assert.equal(sidecarLaunches, 1);
    assert.equal(sdkAppOpenCalls, 0);
    assert.deepEqual(result, { launch: "completed", semanticSession: "not-requested" });
    assert.equal(await rememberedTargetApplication(context), "com.apple.Preferences");
    assert.deepEqual(
      supervisors
        .health({ id: serial, kind: "ios" })
        .events.filter((event) => event.code.startsWith("INPUT_"))
        .map((event) => event.code)
        .reverse(),
      ["INPUT_INTENT_PERSISTED", "INPUT_DISPATCHED", "INPUT_COMPLETED"],
    );
  } finally {
    setIosAppOpenRuntimeForTests();
    supervisors.close();
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("simulator launch uses the SDK as the one activation path", async () => {
  const serial = "D2625C92-964D-4326-8C83-0A4B9B06431D";
  const context = ios(serial);
  let sidecarLaunches = 0;
  let sdkAppOpenCalls = 0;
  const device = {
    apps: {
      open: async (options: { app: string }) => {
        sdkAppOpenCalls += 1;
        assert.equal(options.app, "settings");
        return { appBundleId: "com.apple.Preferences" };
      },
    },
  } as unknown as Device;
  const root = await mkdtemp(join(tmpdir(), "relay-ios-sim-launch-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  setIosAppOpenRuntimeForTests({
    resolveBundleId: () => "com.apple.Preferences",
    launch: async () => {
      sidecarLaunches += 1;
      return { bundleId: "com.apple.Preferences", method: "devicectl" };
    },
  });
  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    const result = await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext(context, () => openApp(device, "settings", { relaunch: false })),
    );
    assert.equal(sidecarLaunches, 0);
    assert.equal(sdkAppOpenCalls, 1);
    assert.deepEqual(result, { launch: "completed", semanticSession: "attached" });
    assert.equal(await rememberedTargetApplication(context), "com.apple.Preferences");
  } finally {
    setIosAppOpenRuntimeForTests();
    supervisors.close();
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
