import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { TargetSupervisorStore, runWithTargetSupervisorStore } from "./target-supervisor-store.js";
import { setLiveIosRunnerCommandPostForTests } from "./ios-runner-listener-command.js";
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
  recordTargetSemanticSnapshot,
  resetTargetRuntimeReadiness,
  targetRuntimeReadiness,
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

test("a quarantined iPad snapshot retains fresh pixels without reading AX or clearing quarantine", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-quarantined-snapshot-"));
  const previousBinary = process.env.RELAY_GO_IOS_BIN;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  const binary = join(root, "pixels-only.cjs");
  const pixels = new PNG({ width: 80, height: 160 });
  pixels.data.fill(255);
  pixels.data[0] = 0;
  const png = PNG.sync.write(pixels).toString("base64");
  await writeFile(
    binary,
    `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst output = process.argv.find(arg => arg.startsWith('--output='));\nif (!output) process.exit(2);\nfs.writeFileSync(output.slice(9), Buffer.from(${JSON.stringify(png)}, 'base64'));\n`,
  );
  await chmod(binary, 0o700);
  process.env.RELAY_GO_IOS_BIN = binary;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const store = new TargetSupervisorStore(":memory:");
  const serial = "quarantined-pixels-ipad";
  const target = { id: serial, kind: "ios" } as const;
  store.transition(target, {
    kind: "operator.quarantined",
    reason: "Repeated bounded recovery failures.",
  });
  let semanticCalls = 0;
  try {
    const result = await runWithTargetSupervisorStore(store, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
        captureSnapshot({
          includeVisual: true,
          device: {
            capture: {
              snapshot: async () => {
                semanticCalls += 1;
                return { nodes: [] };
              },
            },
          } as unknown as Device,
        }),
      ),
    );
    assert.equal(semanticCalls, 0);
    assert.equal(result.inspectable, false);
    assert.equal(result.source, "pixels-only");
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.interactive, []);
    assert.match(result.inspectionError ?? "", /quarantined/i);
    assert.ok(result.visualFingerprint);
    assert.equal(result.readiness?.previewPixels.state, "proven");
    assert.notEqual(result.readiness?.semanticControl.state, "proven");
    const health = store.health(target);
    assert.equal(health.overall, "quarantined");
    assert.equal(health.counters.semanticTraversals, 0);
    assert.equal(health.counters.pixelCaptures, 1);
  } finally {
    store.close();
    if (previousBinary === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousBinary;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("a semantics-only quarantined iPad snapshot is a typed policy refusal before AX", async () => {
  const store = new TargetSupervisorStore(":memory:");
  const serial = "quarantined-semantics-ipad";
  const target = { id: serial, kind: "ios" } as const;
  store.transition(target, {
    kind: "operator.quarantined",
    reason: "Repeated bounded recovery failures.",
  });
  let semanticCalls = 0;
  try {
    await assert.rejects(
      runWithTargetSupervisorStore(store, () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
          captureSnapshot({
            includeVisual: false,
            device: {
              capture: {
                snapshot: async () => {
                  semanticCalls += 1;
                  return { nodes: [] };
                },
              },
            } as unknown as Device,
          }),
        ),
      ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "TARGET_SEMANTICS_QUARANTINED");
        return true;
      },
    );
    assert.equal(semanticCalls, 0);
    assert.equal(store.health(target).overall, "quarantined");
    assert.equal(store.health(target).counters.semanticTraversals, 0);
  } finally {
    store.close();
  }
});

test("logical-bounds-only quarantined iPad snapshot masks retained semantic proof without changing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-logical-window-snapshot-"));
  const previousLeaseDir = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const serial = "logical-window-quarantined-ipad";
  await writeFile(
    join(root, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 57766 }),
  );
  const store = new TargetSupervisorStore(":memory:");
  const target = { id: serial, kind: "ios" } as const;
  const runtimeTarget = { serial, platform: "ios" } as const;
  runWithTargetSupervisorStore(store, () =>
    recordTargetSemanticSnapshot(runtimeTarget, {
      inspectable: true,
      at: Date.now(),
      nodes: [
        {
          label: "Ask Grok",
          bundleId: "ai.x.GrokApp",
          enabled: true,
          visibleToUser: true,
          rect: { x: 1, y: 1, width: 20, height: 20 },
        },
      ],
    }),
  );
  assert.equal(targetRuntimeReadiness(runtimeTarget).semanticControl.state, "proven");
  store.transition(target, {
    kind: "operator.quarantined",
    reason: "Repeated bounded recovery failures.",
  });
  store.transition(target, { kind: "context.updated", context: { foregroundApp: "ai.x.GrokApp" } });
  const healthBefore = store.health(target);
  const readinessBefore = targetRuntimeReadiness(runtimeTarget);
  const commands: string[] = [];
  const restorePost = setLiveIosRunnerCommandPostForTests(async (_listener, command) => {
    commands.push(String(command.command));
    assert.equal(command.appBundleId, "ai.x.GrokApp");
    return {
      ok: true,
      data: {
        appBundleId: "ai.x.GrokApp",
        appStateBefore: "runningForeground",
        appStateAfter: "runningForeground",
        source: "current-window",
        coordinateSpace: "application-logical",
        geometrySource: "xcui-window-frame",
        bounds: { x: 0, y: 0, width: 834, height: 1112 },
      },
    };
  });
  let semanticCalls = 0;
  try {
    const result = await runWithTargetSupervisorStore(store, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
        captureSnapshot({
          logicalBoundsOnly: true,
          includeVisual: false,
          device: {
            capture: {
              snapshot: async () => {
                semanticCalls += 1;
                return { nodes: [] };
              },
            },
          } as unknown as Device,
        }),
      ),
    );
    assert.deepEqual(commands, ["appWindowBounds"]);
    assert.equal(semanticCalls, 0);
    assert.deepEqual(result.bounds, { width: 834, height: 1112 });
    assert.equal(result.boundsSource, "current-window");
    assert.equal(result.inspectable, false);
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.interactive, []);
    assert.match(result.inspectionError ?? "", /geometry.*accessibility/i);
    const health = store.health(target);
    assert.equal(health.overall, "quarantined");
    assert.deepEqual(health.semantics, healthBefore.semantics);
    assert.deepEqual(health.counters, healthBefore.counters);
    assert.equal(health.counters.pixelCaptures, 0);
    assert.equal(result.readiness?.semanticControl.state, "unavailable");
    assert.equal(result.readiness?.semanticControl.freshness, "unproven");
    assert.equal(result.readiness?.semanticControl.proof, undefined);
    assert.match(result.readiness?.semanticControl.lastError?.message ?? "", /quarantined/i);
    assert.deepEqual(targetRuntimeReadiness(runtimeTarget), readinessBefore);
    assert.notEqual(result.readiness?.previewPixels.state, "proven");
    const restoreInvalid = setLiveIosRunnerCommandPostForTests(async () => ({
      ok: true,
      data: {
        appBundleId: "com.example.another-app",
        appStateBefore: "runningForeground",
        appStateAfter: "runningForeground",
        source: "current-window",
        coordinateSpace: "application-logical",
        geometrySource: "xcui-window-frame",
        bounds: { x: 0, y: 0, width: 834, height: 1112 },
      },
    }));
    try {
      await assert.rejects(
        runWithTargetSupervisorStore(store, () =>
          runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
            captureSnapshot({ logicalBoundsOnly: true, device: iosSnapshotDevice([]) }),
          ),
        ),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "TARGET_IOS_LOGICAL_BOUNDS_UNAVAILABLE");
          assert.equal((error as { reason?: string }).reason, "bounds-unavailable");
          return true;
        },
      );
      assert.deepEqual(store.health(target).counters, healthBefore.counters);
    } finally {
      restoreInvalid();
    }
  } finally {
    restorePost();
    store.close();
    if (previousLeaseDir === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLeaseDir;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("logical-bounds-only snapshot refuses an unknown origin and unsupported platforms", async () => {
  for (const [context, reason] of [
    [
      { kind: "device", platform: "ios", serial: "unknown-logical-origin-ipad" } as const,
      "origin-unavailable",
    ],
    [
      { kind: "browser", platform: "browser", targetId: "logical-bounds-browser" } as const,
      "unsupported-platform",
    ],
  ] as const) {
    await assert.rejects(
      runWithTargetContext(context, () =>
        captureSnapshot({
          logicalBoundsOnly: true,
          device: iosSnapshotDevice([]),
        }),
      ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "TARGET_IOS_LOGICAL_BOUNDS_UNAVAILABLE");
        assert.equal((error as { reason?: string }).reason, reason);
        return true;
      },
    );
  }
});

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
