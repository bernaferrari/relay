import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { afterEach, test } from "node:test";
import {
  defineIosMutationTerminalityRegistry,
  verifyIosMutationTerminalityRegistry,
  type IosMutationTerminalityTrace,
} from "@relay/protocol";
import {
  IosMutationOutcomeUnknownError,
  pressMatchingText,
  pressNamedControl,
  resetDeviceClients,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { clearControl, JobCancelledError, requestCancel, runWithJobControl } from "./control.js";
import { captureFullSurfaceEvidence } from "./discovery-surface.js";
import { dismissTowardParent } from "./explore.js";
import { postLoginNotifications } from "./grok.js";
import { InputNotDispatchedError } from "./input-not-dispatched.js";
import { openPhysicalIosApp } from "./ios-app-open.js";
import { runWithIosSupervisionMode } from "./ios-mutation-policy.js";
import { runRecipeStep } from "./recipe-runner.js";
import { captureScrollableSurvey } from "./scrollable-survey.js";
import { runWithTargetContext } from "./target-context.js";

const ios = (serial: string) => ({ kind: "device" as const, platform: "ios" as const, serial });
const iosCloud = (sessionId: string) => ({
  kind: "cloud" as const,
  provider: "test",
  sessionId,
  platform: "ios" as const,
});
const roots: string[] = [];
afterEach(async () => {
  resetDeviceClients();
  delete process.env.RELAY_WORKSPACE_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function unknownIosMutation(operation: "press" | "scroll" = "press") {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation,
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("lost native acknowledgement"),
  );
}

async function cancellationAfterDispatchTrace(
  nativeDispatches: string[],
): Promise<IosMutationTerminalityTrace> {
  const serial = "terminal-cancel-after-dispatch";
  const jobId = "terminality-cancel-after-dispatch";
  const device = {
    capture: { snapshot: async () => ({ nodes: [button("Continue")] }) },
    interactions: {
      press: async () => {
        nativeDispatches.push("semantic-press");
        // This happens after the native intent began, but before XCTest can
        // confirm its outcome. It must become a review stop, not cleanup.
        requestCancel(jobId);
        // Leave the simulated native acknowledgement in flight so cancellation
        // wins at the real race boundary rather than creating an unobserved
        // rejected promise in the fake transport.
        await Promise.resolve();
      },
    },
  } as unknown as Device;
  const context = { log: () => undefined, job: { id: jobId, artifacts: [] } as never };
  try {
    await runWithTargetContext(ios(serial), () =>
      runWithJobControl(jobId, () =>
        runRecipeStep(
          device,
          { kind: "tap", target: { label: "Continue" }, optional: true },
          context,
        ),
      ),
    );
    return { nativeDispatches, status: "handled" };
  } catch (error) {
    assert.ok(error instanceof IosMutationOutcomeUnknownError);
    assert.equal(error.iosMutation.operation, "press");
    assert.equal(error.iosMutation.cancellation?.observedAfterAttemptStarted, true);
    return { nativeDispatches, status: "terminal", error };
  } finally {
    clearControl(jobId);
  }
}

async function cancellationBeforeDispatchTrace(
  nativeDispatches: string[],
): Promise<IosMutationTerminalityTrace> {
  const serial = "recovery-cancel-before-dispatch";
  const jobId = "terminality-cancel-before-dispatch";
  const device = {
    capture: { snapshot: async () => ({ nodes: [button("Continue")] }) },
    interactions: {
      press: async () => {
        nativeDispatches.push("semantic-press");
      },
    },
  } as unknown as Device;
  try {
    requestCancel(jobId);
    await runWithTargetContext(ios(serial), () =>
      runWithJobControl(jobId, () =>
        runRecipeStep(
          device,
          { kind: "tap", target: { label: "Continue" }, optional: true },
          { log: () => undefined, job: { id: jobId, artifacts: [] } as never },
        ),
      ),
    );
    return { nativeDispatches, status: "terminal" };
  } catch (error) {
    assert.ok(error instanceof JobCancelledError);
    assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
    return { nativeDispatches, status: "handled" };
  } finally {
    clearControl(jobId);
  }
}

async function appOpenTrace(
  nativeDispatches: string[],
  outcome: "unknown" | "completed",
): Promise<IosMutationTerminalityTrace> {
  const serial = `terminal-app-open-${outcome}`;
  const remembered: string[] = [];
  const open = () =>
    openPhysicalIosApp(
      {
        context: ios(serial),
        app: "Grok",
        relaunch: false,
        rememberApplication: async (app) => {
          remembered.push(app);
        },
      },
      {
        resolveBundleId: (app) => {
          assert.equal(app, "Grok");
          return "ai.x.GrokApp";
        },
        launch: async (launchSerial, bundleId, options) => {
          nativeDispatches.push("sidecar-app-open");
          assert.equal(launchSerial, serial);
          assert.equal(bundleId, "ai.x.GrokApp");
          assert.deepEqual(options, { relaunch: false });
          if (outcome === "unknown") {
            throw new Error("sidecar transport ended after app-open dispatch");
          }
          return { bundleId, method: "devicectl" as const };
        },
      },
    );

  if (outcome === "unknown") {
    try {
      await runWithIosSupervisionMode("test-optional", () =>
        runWithTargetContext(ios(serial), open),
      );
      throw new Error("Expected app-open to retain an unknown sidecar outcome");
    } catch (error) {
      assert.ok(error instanceof IosMutationOutcomeUnknownError);
      assert.equal(error.iosMutation.operation, "app-open");
      assert.equal(error.iosMutation.nativeAttempts, 1);
      assert.deepEqual(remembered, []);
      return { nativeDispatches, status: "terminal", error };
    }
  }

  await runWithIosSupervisionMode("test-optional", () => runWithTargetContext(ios(serial), open));
  assert.deepEqual(remembered, ["ai.x.GrokApp"]);
  return { nativeDispatches, status: "handled" };
}

async function terminalTrace(
  nativeDispatches: string[],
  run: () => Promise<unknown>,
): Promise<IosMutationTerminalityTrace> {
  try {
    await run();
    return { nativeDispatches, status: "handled" };
  } catch (error) {
    return { nativeDispatches, status: "terminal", error };
  }
}

async function ordinaryTrace(
  nativeDispatches: string[],
  status: "recovered" | "handled",
  run: () => Promise<unknown>,
): Promise<IosMutationTerminalityTrace> {
  try {
    await run();
    return { nativeDispatches, status };
  } catch (error) {
    return { nativeDispatches, status, error };
  }
}

async function withoutConsoleError<T>(run: () => Promise<T>): Promise<T> {
  const previous = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = previous;
  }
}

function button(label: string): SnapshotNode {
  return {
    type: "Button",
    role: "button",
    label,
    enabled: true,
    hittable: true,
    visibleToUser: true,
    rect: { x: 20, y: 80, width: 240, height: 44 },
  };
}

function selectorDevice(
  nativeDispatches: string[],
  label: string,
  outcome: "unknown" | "selector-miss",
): Device {
  return {
    capture: { snapshot: async () => ({ nodes: [button(label)] }) },
    interactions: {
      press: async (input: { selector?: string; x?: number; y?: number }) => {
        nativeDispatches.push(input.selector ? "semantic-press" : "point-press");
        if (input.selector) {
          throw new Error(
            outcome === "unknown" ? "XCTest transport ended" : "Selector did not match an element",
          );
        }
      },
      // `pressMatchingText` asks whether an older text finder is available
      // before using the current snapshot point. A known miss is safe.
      find: async () => {
        throw new Error("element not found");
      },
    },
  } as unknown as Device;
}

function exploreDismissDevice(
  nativeDispatches: string[],
  outcome: "unknown" | "selector-miss",
): Device {
  return {
    capture: { snapshot: async () => ({ nodes: [button("Back")] }) },
    interactions: {
      find: async (input: { query?: string; action?: string }) => {
        if (input.action === "exists" && input.query === "Back") return {};
        if (input.action === "click") {
          nativeDispatches.push("find-click");
          return {};
        }
        throw new Error("element not found");
      },
      press: async (input: { selector?: string }) => {
        nativeDispatches.push(input.selector ? "semantic-back" : "point-back");
        if (input.selector) {
          throw new Error(
            outcome === "unknown" ? "XCTest transport ended" : "Selector did not match an element",
          );
        }
      },
    },
    command: {
      back: async () => {
        nativeDispatches.push("key-back");
      },
      wait: async () => undefined,
    },
  } as unknown as Device;
}

function surveyCapture() {
  return {
    screenshot: { base64: "AA==", width: 64, height: 160, capturedAt: 1 },
    snapshot: {
      capturedAt: 1,
      nodes: [
        {
          identifier: "settings-root",
          type: "NavigationBar",
          visibleToUser: true,
          rect: { x: 0, y: 0, width: 64, height: 20 },
        },
      ],
      interactive: [],
      bounds: { width: 64, height: 160 },
      inspectable: true,
      source: "sdk" as const,
      screenIdentity: { fingerprint: "settings", nodes: [], volatileSignals: [] },
    },
  };
}

function grokNotificationDevice(
  nativeDispatches: string[],
  outcome: "unknown" | "ordinary",
): Device {
  const labels = [button("Enable notifications"), button("Allow")];
  return {
    capture: { snapshot: async () => ({ nodes: labels }) },
    interactions: {
      press: async (input: { selector?: string }) => {
        nativeDispatches.push(
          input.selector === 'label="Allow"' ? "allow" : "enable-notifications",
        );
        if (input.selector === 'label="Enable notifications"') {
          if (outcome === "unknown") throw unknownIosMutation("press");
          throw new InputNotDispatchedError("semantic label unavailable");
        }
      },
      find: async (input: { query?: string; action?: string }) => {
        if (input.action === "exists") {
          if (input.query === "Enable notifications" || input.query === "Allow") return {};
          throw new Error("element not found");
        }
        if (input.action === "click") {
          nativeDispatches.push("find-click");
          return {};
        }
        throw new Error("element not found");
      },
    },
    command: { wait: async () => undefined },
  } as unknown as Device;
}

async function runGrokNotificationSurface(
  nativeDispatches: string[],
  outcome: "unknown" | "ordinary",
): Promise<void> {
  await runWithTargetContext(iosCloud(`grok-notifications-${outcome}`), () =>
    postLoginNotifications(grokNotificationDevice(nativeDispatches, outcome), 100),
  );
}

test("registered public recovery boundaries preserve iOS exact-once terminality", async () => {
  const registry = defineIosMutationTerminalityRegistry([
    {
      id: "core.device.press-named-control",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          runWithTargetContext(ios("terminal-named"), () =>
            pressNamedControl(selectorDevice(nativeDispatches, "Settings", "unknown"), {
              label: "Settings",
            }),
          ),
        );
      },
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await ordinaryTrace(nativeDispatches, "recovered", () =>
            runWithTargetContext(ios("recovery-named"), () =>
              pressNamedControl(selectorDevice(nativeDispatches, "Settings", "selector-miss"), {
                label: "Settings",
              }),
            ),
          );
        },
      },
    },
    {
      id: "core.device.press-matching-text",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          runWithTargetContext(ios("terminal-text"), () =>
            pressMatchingText(selectorDevice(nativeDispatches, "Settings", "unknown"), "Settings"),
          ),
        );
      },
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await ordinaryTrace(nativeDispatches, "recovered", () =>
            runWithTargetContext(ios("recovery-text"), () =>
              pressMatchingText(
                selectorDevice(nativeDispatches, "Settings", "selector-miss"),
                "Settings",
              ),
            ),
          );
        },
      },
    },
    {
      id: "core.recipe.optional-step",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          runWithTargetContext(ios("terminal-recipe"), () =>
            runRecipeStep(
              selectorDevice(nativeDispatches, "Continue", "unknown"),
              { kind: "tap", target: { label: "Continue" }, optional: true },
              { log: () => undefined, job: { artifacts: [] } as never },
            ),
          ),
        );
      },
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await ordinaryTrace(nativeDispatches, "recovered", () =>
            runWithTargetContext(ios("recovery-recipe"), () =>
              runRecipeStep(
                selectorDevice(nativeDispatches, "Continue", "selector-miss"),
                { kind: "tap", target: { label: "Continue" }, optional: true },
                { log: () => undefined, job: { artifacts: [] } as never },
              ),
            ),
          );
        },
      },
    },
    {
      id: "core.recipe.cancellation-after-dispatch",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await cancellationAfterDispatchTrace(nativeDispatches);
      },
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 0,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await cancellationBeforeDispatchTrace(nativeDispatches);
        },
      },
    },
    {
      id: "core.ios-app-open.sidecar",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await appOpenTrace(nativeDispatches, "unknown");
      },
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 1,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await appOpenTrace(nativeDispatches, "completed");
        },
      },
    },
    {
      id: "core.grok.notification-fallback",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          runGrokNotificationSurface(nativeDispatches, "unknown"),
        );
      },
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 3,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await ordinaryTrace(nativeDispatches, "recovered", () =>
            runGrokNotificationSurface(nativeDispatches, "ordinary"),
          );
        },
      },
    },
    {
      id: "core.explore.dismiss",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          dismissTowardParent({
            serial: "terminal-explore-dismiss",
            platform: "ios",
            device: exploreDismissDevice(nativeDispatches, "unknown"),
          }),
        );
      },
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await ordinaryTrace(nativeDispatches, "recovered", () =>
            dismissTowardParent({
              serial: "recovery-explore-dismiss",
              platform: "ios",
              device: exploreDismissDevice(nativeDispatches, "selector-miss"),
            }),
          );
        },
      },
    },
    {
      id: "core.scrollable-survey.capture",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          captureScrollableSurvey({
            capture: async () => surveyCapture(),
            scrollDown: async () => {
              nativeDispatches.push("scroll-down");
              throw unknownIosMutation("scroll");
            },
            scrollUp: async () => {
              nativeDispatches.push("inverse-scroll");
            },
            settle: async () => undefined,
          }),
        );
      },
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 1,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await ordinaryTrace(nativeDispatches, "handled", () =>
            captureScrollableSurvey({
              capture: async () => surveyCapture(),
              scrollDown: async () => {
                nativeDispatches.push("scroll-down");
                throw new Error("scroll unavailable");
              },
              scrollUp: async () => {
                nativeDispatches.push("inverse-scroll");
              },
              settle: async () => undefined,
            }),
          );
        },
      },
    },
    {
      id: "core.discovery.full-surface",
      unknown: async () => {
        const nativeDispatches: string[] = [];
        return await terminalTrace(nativeDispatches, () =>
          captureFullSurfaceEvidence("terminal-full-surface", "Settings", [], {
            captureSurvey: async () => {
              nativeDispatches.push("scroll-survey");
              throw unknownIosMutation("scroll");
            },
          }),
        );
      },
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 1,
        run: async () => {
          const nativeDispatches: string[] = [];
          return await withoutConsoleError(() =>
            ordinaryTrace(nativeDispatches, "handled", () =>
              captureFullSurfaceEvidence("recovery-full-surface", "Settings", [], {
                captureSurvey: async () => {
                  nativeDispatches.push("scroll-survey");
                  throw new Error("surface unavailable");
                },
              }),
            ),
          );
        },
      },
    },
  ]);

  await verifyIosMutationTerminalityRegistry(registry, {
    isOutcomeUnknown: (error) => error instanceof IosMutationOutcomeUnknownError,
  });
});
