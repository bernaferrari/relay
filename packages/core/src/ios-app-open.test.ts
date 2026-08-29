import assert from "node:assert/strict";
import test from "node:test";
import { openPhysicalIosApp } from "./ios-app-open.js";
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
