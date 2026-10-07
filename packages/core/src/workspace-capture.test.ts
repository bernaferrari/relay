import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { catalogAwarePost } from "./ios-snapshot-catalog.fixtures.js";
import {
  IosSnapshotTimedOutError,
  rememberTargetApplication,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import {
  invalidateTargetSemanticControl,
  recordTargetPixelCapture,
  resetTargetRuntimeReadiness,
} from "./target-runtime-readiness.js";
import {
  captureScreenshot,
  captureSnapshot,
  iosPixelsUnavailableMessage,
  isAndroidSnapshotOwnershipUnreleased,
  iosLogicalBoundsForSerial,
  screenshotIncludesFollowOnTree,
} from "./workspace-capture.js";

function iosSnapshotDevice(nodes: SnapshotNode[]): Device {
  return {
    capture: {
      snapshot: async () => ({ nodes }),
    },
  } as unknown as Device;
}

test.afterEach(() => resetTargetRuntimeReadiness());

test("classifies unreleased Android automation ownership as a hard semantic boundary", () => {
  assert.equal(
    isAndroidSnapshotOwnershipUnreleased(
      Object.assign(new Error("Android snapshot helper failed"), {
        details: {
          cause: {
            code: "android_snapshot_helper_retirement_unconfirmed",
          },
        },
      }),
    ),
    true,
  );
  assert.equal(
    isAndroidSnapshotOwnershipUnreleased(
      new Error("Android snapshot helper could not confirm release of device automation ownership"),
    ),
    true,
  );
  assert.equal(isAndroidSnapshotOwnershipUnreleased(new Error("helper APK missing")), false);
});

test("iOS screenshot failures name go-ios tunnel, not target.open", () => {
  assert.match(
    iosPixelsUnavailableMessage(
      new Error("this device runs iOS 17.7.11 and needs an active tunnel"),
      new Error("No active session. Run open first."),
    ),
    /go-ios tunnel/i,
  );
  assert.match(
    iosPixelsUnavailableMessage(
      new Error("this device runs iOS 17.7.11 and needs an active tunnel"),
      new Error("No active session. Run open first."),
    ),
    /target\.open/,
  );
  assert.doesNotMatch(
    iosPixelsUnavailableMessage(
      new Error("instruments service unavailable"),
      new Error("No active session. Run open first."),
    ),
    /Retry the tap/i,
  );
  assert.match(
    iosPixelsUnavailableMessage(
      new Error("go-ios binary not found"),
      new Error("No active session. Run open first."),
    ),
    /not a failed screenshot/,
  );
});

test("pixels-only iOS snapshots still carry the last launched app", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-remembered-app-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const result = await runWithTargetContext(
      { kind: "device", platform: "ios", serial: "remembered-login-ipad" },
      async () => {
        await rememberTargetApplication("ai.x.GrokApp");
        return captureSnapshot({
          device: iosSnapshotDevice([]),
        });
      },
    );
    assert.equal(result.inspectable, false);
    assert.equal(result.foregroundApp, "ai.x.GrokApp");
    assert.equal(result.app, "ai.x.GrokApp");
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("a root-only iOS XCTest response is pixels-only rather than inspectable", async () => {
  const result = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "root-only-ipad" },
    () =>
      captureSnapshot({
        device: iosSnapshotDevice([
          {
            type: "Application",
            label: "Grok",
            rect: { x: 0, y: 0, width: 834, height: 1112 },
          },
        ]),
      }),
  );

  assert.equal(result.inspectable, false);
  assert.equal(result.source, "pixels-only");
  assert.equal(result.inspectionError, "Relay did not observe named accessibility controls.");
  assert.equal(result.readiness?.semanticControl.state, "unavailable");
  assert.equal(result.readiness?.semanticControl.freshness, "unproven");
});

test("a window-only iOS XCTest response is pixels-only rather than inspectable", async () => {
  const result = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "window-only-ipad" },
    () =>
      captureSnapshot({
        device: iosSnapshotDevice([
          {
            type: "Window",
            label: "Grok",
            rect: { x: 0, y: 0, width: 834, height: 1112 },
          },
        ]),
      }),
  );

  assert.equal(result.inspectable, false);
  assert.equal(result.source, "pixels-only");
  assert.equal(result.readiness?.semanticControl.state, "unavailable");
});

test("a slow iOS AX query publishes in-flight semantic readiness without disturbing pixels", async () => {
  const serial = "slow-ax-capture-ipad";
  const error = new IosSnapshotTimedOutError(8_000, 8_000);
  recordTargetPixelCapture({ serial, platform: "ios" }, { at: Date.now(), durationMs: 8 });

  const result = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
    captureSnapshot({
      device: {
        capture: {
          snapshot: async () => {
            throw error;
          },
        },
      } as unknown as Device,
    }),
  );

  assert.equal(result.inspectable, false);
  assert.equal(result.source, "pixels-only");
  assert.match(result.inspectionError ?? "", /still reading this screen/i);
  assert.doesNotMatch(result.inspectionError ?? "", /reconnect|XCTest session/i);
  assert.equal(result.readiness?.previewPixels.state, "proven");
  assert.equal(result.readiness?.evidenceCapture.state, "proven");
  assert.deepEqual(result.readiness?.semanticControl.reason, "probe-in-flight");
  assert.deepEqual(result.readiness?.semanticControl.lastError?.reason, "probe-in-flight");
  assert.equal("nextProbeAt" in (result.readiness?.semanticControl ?? {}), false);
  assert.deepEqual(result.iosSessionLifecycle?.outcome, "in-flight");
  assert.deepEqual(
    result.iosSessionLifecycle?.stages.find((stage) => stage.stage === "xctest-availability")
      ?.outcome,
    "skipped",
  );
});

test("iOS geometry cache follows the exact semantic proof, not the device serial", async () => {
  const serial = "geometry-epoch-ipad";
  const result = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
    captureSnapshot({
      device: iosSnapshotDevice([
        {
          index: 0,
          depth: 0,
          type: "Application",
          rect: { x: 0, y: 0, width: 1112, height: 834 },
        },
        {
          index: 1,
          parentIndex: 0,
          depth: 1,
          type: "Window",
          rect: { x: 0, y: 0, width: 834, height: 1112 },
        },
        {
          index: 2,
          parentIndex: 1,
          depth: 2,
          type: "Button",
          label: "Settings",
          rect: { x: 498, y: 600, width: 88, height: 68 },
        },
      ]),
    }),
  );

  assert.equal(result.readiness?.semanticControl.freshness, "current");
  assert.deepEqual(iosLogicalBoundsForSerial(serial), { width: 1112, height: 834 });

  invalidateTargetSemanticControl(
    { serial, platform: "ios" },
    "input-changed",
    result.capturedAt + 1,
  );

  assert.equal(iosLogicalBoundsForSerial(serial), undefined);
});

test("iOS capture adopts the LISTENER_READY runner instead of the bounded Copy probe", async () => {
  const { setLiveIosRunnerCommandPostForTests } = await import("./ios-runner-listener-command.js");
  const dir = await mkdtemp(join(tmpdir(), "relay-ios-capture-listener-"));
  const serial = "ipad-capture-live-listener";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  process.env.RELAY_WORKSPACE_ROOT = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 57051 }),
  );
  let sdkSnapshots = 0;
  const restore = setLiveIosRunnerCommandPostForTests(
    catalogAwarePost(async (listener, command) => {
      assert.equal(listener.port, 57051);
      if (command.command === "querySelector") {
        if (command.selectorValue === "ask.toolbar.textfield") {
          return {
            ok: true,
            data: {
              nodes: [
                {
                  type: "TextField",
                  identifier: "ask.toolbar.textfield",
                  label: "Ask Anything",
                  rect: { x: 40, y: 980, width: 600, height: 48 },
                },
              ],
            },
          };
        }
        return { ok: true, data: { found: false, nodes: [] } };
      }
      if (command.command === "snapshot") {
        assert.equal(command.depth, 0);
        return {
          ok: true,
          data: {
            nodes: [
              {
                depth: 0,
                type: "Application",
                identifier: "ai.x.GrokApp",
                rect: { x: 0, y: 0, width: 1112, height: 834 },
              },
            ],
          },
        };
      }
      throw new Error("unbounded snapshot must not run when chrome identifiers resolve");
    }),
  );
  try {
    await rememberTargetApplication("ai.x.GrokApp", { kind: "device", platform: "ios", serial });
    const result = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      captureSnapshot({
        device: {
          capture: {
            snapshot: async () => {
              sdkSnapshots += 1;
              throw new Error("Relay’s bounded XCTest session probe could not attach");
            },
          },
        } as unknown as Device,
      }),
    );
    assert.equal(sdkSnapshots, 0);
    assert.equal(result.inspectable, true);
    assert.equal(result.source, "sdk");
    assert.equal(result.inspectionError, undefined);
    assert.ok(result.nodes.some((node) => node.identifier === "ask.toolbar.textfield"));
    assert.doesNotMatch(JSON.stringify(result), /Copy probe|probe could not attach/i);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Android screenshots do not take a follow-on tree unless asked", () => {
  assert.equal(screenshotIncludesFollowOnTree(undefined), false);
  assert.equal(screenshotIncludesFollowOnTree(false), false);
  assert.equal(screenshotIncludesFollowOnTree(true), true);
});

test("a failed screenshot capture removes its private temporary directory before returning", async () => {
  let temporaryPath: string | undefined;
  await assert.rejects(
    runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: "cleanup-browser" },
      () =>
        captureScreenshot({
          ephemeral: true,
          includeScreenMatch: false,
          device: {
            capture: {
              screenshot: async ({ path }: { path: string }) => {
                temporaryPath = path;
                throw new Error("screenshot transport failed");
              },
            },
          } as unknown as Device,
        }),
    ),
    /screenshot transport failed/u,
  );
  assert.ok(temporaryPath);
  assert.equal(existsSync(dirname(temporaryPath)), false);
});
