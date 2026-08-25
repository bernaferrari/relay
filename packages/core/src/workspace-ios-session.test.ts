import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { PNG } from "pngjs";
import { resetDeviceClients } from "./device.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IosSnapshotTimedOutError, type Device } from "./device.js";
import {
  IosDeviceAttentionError,
  IosXCTestSessionUnavailableError,
} from "./ios-device-adapter.js";
import {
  ensureIosRunnerPrepared,
  lastIosSessionOperationDiagnostic,
  recoverTargetRuntime,
  resetIosRunnerState,
  setIosSessionHostRuntimeForTests,
  withSession,
} from "./workspace-ios-session.js";
import { runWithTargetContext } from "./target-context.js";
import { recoverIosRuntimeSession } from "./ios-runtime-recovery.js";
import { resetIosSnapshotFlights } from "./ios-snapshot-flight.js";

test("a snapshot failure remains one read-only attempt with no hidden repair", async () => {
  let attempts = 0;
  // A bare phrase without the concrete class no longer proves XCTest state.
  const failure = new Error("No active XCTest session");

  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial: "read-only-ipad" }, () =>
      withSession(
        {} as Device,
        async () => {
          attempts += 1;
          throw failure;
        },
        "snapshot",
      ),
    ),
    (error: unknown) => error === failure,
  );

  assert.equal(attempts, 1);
  const diagnostic = lastIosSessionOperationDiagnostic("read-only-ipad");
  assert.ok(diagnostic);
  assert.ok(diagnostic.durationMs >= 0);
  assert.deepEqual(
    { ...diagnostic, durationMs: 0 },
    {
      operation: "snapshot",
      outcome: "unavailable",
      code: "IOS_SESSION_OPERATION_UNAVAILABLE",
      attempts: 1,
      repairAttempted: false,
      durationMs: 0,
      stages: [
        { stage: "preview", outcome: "skipped" },
        { stage: "xctest-availability", outcome: "skipped" },
        { stage: "accessibility-query", outcome: "skipped" },
        { stage: "repair", outcome: "skipped" },
      ],
    },
  );
  assert.equal(
    (failure as Error & { iosSessionLifecycle?: { repairAttempted: boolean } }).iosSessionLifecycle
      ?.repairAttempted,
    false,
  );
});

test("a proven session-unavailable class marks xctest availability failed", async () => {
  const failure = new IosXCTestSessionUnavailableError("probe did not attach");
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial: "unavailable-ipad" }, () =>
      withSession({} as Device, async () => {
        throw failure;
      }, "snapshot"),
    ),
    (error: unknown) => error === failure,
  );
  const diagnostic = lastIosSessionOperationDiagnostic("unavailable-ipad");
  assert.ok(diagnostic);
  assert.equal(diagnostic.outcome, "unavailable");
  assert.equal(
    diagnostic.stages.find((stage) => stage.stage === "xctest-availability")?.outcome,
    "failed",
  );
});

test("an unproven failure keeps session stages skipped instead of claiming Xcode work", async () => {
  const failure = new Error("already in use by session \"someone-else\"");
  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial: "binding-conflict-ipad" }, () =>
      withSession({} as Device, async () => {
        throw failure;
      }, "snapshot"),
    ),
    (error: unknown) => error === failure,
  );
  const diagnostic = lastIosSessionOperationDiagnostic("binding-conflict-ipad");
  assert.ok(diagnostic);
  assert.equal(diagnostic.outcome, "unavailable");
  assert.deepEqual(
    diagnostic.stages.filter((stage) => stage.stage !== "preview").map(({ outcome }) => outcome),
    ["skipped", "skipped", "skipped"],
  );
});

test("preview and interaction report their explicit bounded operation outcome", async () => {
  for (const operation of ["preview", "interaction"] as const) {
    const serial = `${operation}-ipad`;
    const value = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      withSession({} as Device, async () => operation, operation),
    );
    assert.equal(value, operation);
    const diagnostic = lastIosSessionOperationDiagnostic(serial);
    assert.equal(diagnostic?.operation, operation);
    assert.equal(diagnostic?.outcome, "passed");
    assert.equal(diagnostic?.attempts, 1);
    assert.equal(diagnostic?.repairAttempted, false);
    assert.equal(diagnostic?.stages.at(-1)?.outcome, "skipped");
  }
});

test("runner preparation makes one proof attempt and never repairs the host", async () => {
  const failure = new Error("CoreDevice.ActionError: StreamingAction failed");
  let preparations = 0;
  let repairs = 0;
  const restore = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => {
      preparations += 1;
      throw failure;
    },
    recoverIosRuntime: async () => {
      repairs += 1;
      throw new Error("unexpected hidden host repair");
    },
  });
  try {
    await assert.rejects(ensureIosRunnerPrepared({} as Device, "proof-only-ipad"), (error) => {
      return error === failure;
    });
    assert.equal(preparations, 1);
    assert.equal(repairs, 0);
  } finally {
    restore();
    resetIosRunnerState();
  }
});

test("recorded evidence uses its own truthful session diagnostic", async () => {
  const value = await runWithTargetContext(
    { kind: "device", platform: "ios", serial: "evidence-ipad" },
    () => withSession({} as Device, async () => "recording", "evidence"),
  );
  assert.equal(value, "recording");
  const diagnostic = lastIosSessionOperationDiagnostic("evidence-ipad");
  assert.equal(diagnostic?.operation, "evidence");
  assert.equal(diagnostic?.attempts, 1);
  assert.equal(diagnostic?.repairAttempted, false);
  assert.equal(
    diagnostic?.stages.find((stage) => stage.stage === "accessibility-query")?.outcome,
    "skipped",
  );
});

test("only explicit recovery owns its one host-repair attempt", async () => {
  let inspections = 0;
  let repairs = 0;
  const result = await recoverIosRuntimeSession(
    "reconnect-ipad",
    async () => {
      inspections += 1;
      if (inspections === 1) throw new Error("No active XCTest session");
      return { app: "Grok" };
    },
    async () => {
      repairs += 1;
      return {
        serial: "reconnect-ipad",
        recovered: true,
        ready: true,
        actions: [],
        summary: "Relay repaired the explicit Reconnect request.",
      };
    },
    async () => "Reconnect failed.",
  );
  assert.equal(repairs, 1);
  assert.equal(inspections, 2);
  assert.equal(result.lifecycle.repairAttempts, 1);
  assert.equal(result.lifecycle.proofAttempts, 1);
  assert.equal(result.ready, true);
});

test("a slow accessibility query stays in-flight without claiming XCTest is unavailable", async () => {
  const failure = new IosSnapshotTimedOutError(8_000, 8_000);

  await assert.rejects(
    runWithTargetContext({ kind: "device", platform: "ios", serial: "slow-ax-ipad" }, () =>
      withSession(
        {} as Device,
        async () => {
          throw failure;
        },
        "snapshot",
      ),
    ),
    (error: unknown) => error === failure,
  );

  const diagnostic = lastIosSessionOperationDiagnostic("slow-ax-ipad");
  assert.ok(diagnostic);
  assert.deepEqual(
    { ...diagnostic, durationMs: 0 },
    {
      operation: "snapshot",
      outcome: "in-flight",
      code: "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT",
      attempts: 1,
      repairAttempted: false,
      durationMs: 0,
      stages: [
        { stage: "preview", outcome: "skipped" },
        { stage: "xctest-availability", outcome: "skipped" },
        { stage: "accessibility-query", outcome: "in-flight" },
        { stage: "repair", outcome: "skipped" },
      ],
    },
  );
  assert.equal(
    (failure as Error & { iosSessionLifecycle?: { repairAttempted: boolean } }).iosSessionLifecycle
      ?.repairAttempted,
    false,
  );
});


/**
 * A minimal loopback stand-in for the agent-device daemon. `recoverTargetRuntime`
 * resolves its own Device through the SDK client, which always reaches a
 * daemon, so a hermetic reconnect test needs this transport seam. It speaks
 * just enough of the wire contract: GET /health advertises rpcProtocolVersion
 * 2 and POST /rpc answers `agent_device.command` snapshot/screenshot requests.
 */
async function startFakeAgentDeviceDaemon(input: {
  nodes: Array<Record<string, unknown>>;
  raster: Buffer;
  serial?: string;
}): Promise<Server> {
  const writePngAtPath = async (request: Record<string, unknown>): Promise<void> => {
    const match = /"path":"((?:[^"\\]|\\.)*)"/u.exec(JSON.stringify(request));
    if (!match?.[1]) return;
    let path: string | undefined;
    try {
      path = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return;
    }
    if (!path) return;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, input.raster);
  };
  const respondJson = (response: ServerResponse, body: unknown): void => {
    const payload = JSON.stringify(body);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  };
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      respondJson(response, {
        status: "ok",
        service: "agent-device-daemon",
        version: "0.0.0-workspace-ios-session-test",
        rpcProtocolVersion: 2,
      });
      return;
    }
    if (request.method !== "POST" || request.url !== "/rpc") {
      response.writeHead(404);
      response.end();
      return;
    }
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => {
      let parsed: { id?: unknown; params?: { command?: unknown; positionals?: unknown[] } };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        parsed = {};
      }
      const command = String(parsed.params?.command ?? "");
      let data: Record<string, unknown> = {};
      if (command === "screenshot") {
        void writePngAtPath(parsed as Record<string, unknown>);
      } else if (command === "devices") {
        data = {
          devices: [
            {
              id: input.serial,
              serial: input.serial,
              platform: "ios",
              kind: "emulator",
              name: "Test iPad Simulator",
            },
          ],
        };
      } else if (command === "snapshot") {
        data = { nodes: structuredClone(input.nodes) };
      }
      respondJson(response, { id: parsed.id, result: { ok: true, data } });
    });
  });
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  return server;
}

function listeningBaseUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address === "object", "daemon bound a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

function semanticNodes(): Array<Record<string, unknown>> {
  return [
    {
      type: "Button",
      label: "Continue",
      enabled: true,
      visibleToUser: true,
      rect: { x: 20, y: 40, width: 240, height: 44 },
    },
  ];
}

test("recovery re-probes a slow tree once instead of authorizing runner kills", async () => {
  // The SDK client inside recovery always reaches a daemon; serve the wire
  // contract on a loopback port so no real daemon or device is touched. The
  // fake daemon's tree carries named controls, so inspect()'s bounded probe
  // must prove the live session healthy without authorizing any repair.
  const root = await mkdtemp(join(tmpdir(), "relay-recovery-in-flight-"));
  const raster = PNG.sync.write(new PNG({ width: 32, height: 48 }));
  // A simulator-shaped serial resolves through listDevices on macOS hosts
  // (CoreDevice inventory) so recoverTargetRuntime can route to the iOS path.
  const serial = "FD3C9BDB-9307-4755-B9DC-AA3889340D0F";
  const daemon = await startFakeAgentDeviceDaemon({
    nodes: semanticNodes(),
    raster,
    serial,
  });
  const previousDaemonUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousGoIos = process.env.RELAY_GO_IOS_BIN;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = listeningBaseUrl(daemon);
  // The vendored go-ios binary must never run during this test.
  process.env.RELAY_GO_IOS_BIN = join(root, "missing-go-ios");
  let hostRepairs = 0;
  const restoreRuntime = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => undefined,
    recoverIosRuntime: async () => {
      hostRepairs += 1;
      throw new Error("unexpected host repair");
    },
  });
  setLocalDeviceProvider({ kind: "device", create: () => ({}) as Device });
  resetIosSnapshotFlights();
  resetIosRunnerState();
  resetDeviceClients();
  try {
    const result = await runWithTargetContext(
      { kind: "device", platform: "ios", serial } as const,
      () => recoverTargetRuntime(serial),
    );
    assert.equal(result.ready, true, "the live session probe proves control is ready");
    assert.match(result.summary, /already ready/i);
    assert.ok("lifecycle" in result && result.lifecycle.repairAttempts === 0);
    assert.equal(hostRepairs, 0);
  } finally {
    restoreRuntime();
    setLocalDeviceProvider(undefined);
    resetDeviceClients();
    resetIosSnapshotFlights();
    resetIosRunnerState();
    if (previousDaemonUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousDaemonUrl;
    if (previousGoIos === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousGoIos;
    await rm(root, { recursive: true, force: true });
    await new Promise<void>((resolveClose) => {
      daemon.close(() => resolveClose());
    });
  }
});

test("a mid-run locked screen surfaces attention with unlock guidance, not generic unavailability", async () => {
  // The daemon answers every accessibility probe with an empty tree, so
  // inspect() falls through to the CoreDevice lock check. That check shells
  // out to `xcrun devicectl ... lockState`; on a host without the matching
  // hardware it fails and stays undefined (non-fatal), so recovery reports
  // plain session unavailability. This pins that wiring: an empty-tree probe
  // never reports ready, repair runs, and — because the probe could not prove
  // a lock — the summary stays generic instead of demanding an unlock.
  const root = await mkdtemp(join(tmpdir(), "relay-recovery-locked-"));
  const raster = PNG.sync.write(new PNG({ width: 32, height: 48 }));
  const serial = "021AC16E-552B-421C-A9E4-C835D2265F10";
  const daemon = await startFakeAgentDeviceDaemon({ nodes: [], raster, serial });
  const previousDaemonUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousGoIos = process.env.RELAY_GO_IOS_BIN;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = listeningBaseUrl(daemon);
  process.env.RELAY_GO_IOS_BIN = join(root, "missing-go-ios");
  let hostRepairs = 0;
  const restoreRuntime = setIosSessionHostRuntimeForTests({
    prepareIosRunner: async () => undefined,
    recoverIosRuntime: async () => {
      hostRepairs += 1;
      throw new Error("host repair must not run for a locked device");
    },
  });
  setLocalDeviceProvider({ kind: "device", create: () => ({}) as Device });
  resetIosSnapshotFlights();
  resetIosRunnerState();
  resetDeviceClients();
  try {
    const result = await runWithTargetContext(
      { kind: "device", platform: "ios", serial } as const,
      () => recoverTargetRuntime(serial),
    );
    assert.equal(result.ready, false);
    assert.match(result.summary, /unavailable/i);
    assert.doesNotMatch(result.summary, /locked mid-session/i);
    assert.ok(result.session.status === "unavailable");
    assert.ok("lifecycle" in result && result.lifecycle.repairAttempts >= 1);
  } finally {
    restoreRuntime();
    setLocalDeviceProvider(undefined);
    resetDeviceClients();
    resetIosSnapshotFlights();
    resetIosRunnerState();
    if (previousDaemonUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousDaemonUrl;
    if (previousGoIos === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousGoIos;
    await rm(root, { recursive: true, force: true });
    await new Promise<void>((resolveClose) => {
      daemon.close(() => resolveClose());
    });
  }
});
