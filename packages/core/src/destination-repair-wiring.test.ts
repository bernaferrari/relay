import assert from "node:assert/strict";
import { it } from "node:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { resetDeviceClients, type Device } from "./device.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import { resetDurableWorkerAssignmentStoreForTests } from "./durable-worker-assignments.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { addAppMapScreen } from "./app-map.js";
import { createAppMap, mutateStoredAppMap, resetControlDatabaseCache } from "./collaboration.js";
import { runWithTargetContext } from "./target-context.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

/**
 * A minimal loopback stand-in for the agent-device daemon. The job executor
 * talks to the real SDK client for device discovery, so a hermetic run needs
 * this transport seam in addition to the local observation provider. It speaks
 * just enough of the wire contract: GET /health advertises rpcProtocolVersion
 * 2, POST /rpc answers JSON-RPC `agent_device.command` requests for
 * devices/snapshot/screenshot/close.
 */
async function startFakeAgentDeviceDaemon(input: {
  nodes: Array<{ role: string; label: string; visibleToUser: boolean }>;
  raster: Buffer;
  commands: string[];
}): Promise<Server> {
  const writePngAtPath = (request: Record<string, unknown>): void => {
    const match = /"path":"((?:[^"\\]|\\.)*)"/u.exec(JSON.stringify(request));
    if (!match?.[1]) return;
    let path: string | undefined;
    try {
      path = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return;
    }
    if (!path) return;
    // Screenshot writes are synchronous here: captureScreenshot reads the
    // file immediately after the RPC resolves.
    writeFileSync(path, input.raster);
  };
  const respondJson = (response: import("node:http").ServerResponse, body: unknown): void => {
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
        version: "0.0.0-destination-repair-wiring-test",
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
      let parsed: {
        jsonrpc?: unknown;
        method?: unknown;
        id?: unknown;
        params?: { command?: unknown };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        parsed = {};
      }
      const command = String(parsed.params?.command ?? "");
      input.commands.push(command);
      if (
        parsed.jsonrpc !== "2.0" ||
        parsed.method !== "agent_device.command" ||
        !["devices", "snapshot", "screenshot", "close"].includes(command)
      ) {
        respondJson(response, {
          jsonrpc: "2.0",
          id: parsed.id,
          result: {
            ok: false,
            error: { code: "INVALID_ARGUMENTS", message: "Unsupported test RPC" },
          },
        });
        return;
      }
      let data: Record<string, unknown> = {};
      if (command.includes("screenshot")) {
        writePngAtPath(parsed as Record<string, unknown>);
        data = { base64: input.raster.toString("base64") };
      } else if (command.includes("snapshot")) {
        data = { nodes: structuredClone(input.nodes) };
      } else if (command === "devices") {
        data = {
          devices: [
            {
              platform: "ios",
              id: "SMOKE-1",
              name: "Smoke iPhone",
              kind: "device",
              booted: true,
              target: "mobile",
            },
          ],
        };
      }
      respondJson(response, { jsonrpc: "2.0", id: parsed.id, result: { ok: true, data } });
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  return server;
}

/** A stalled executor must fail this fixture while its owner can still clean up. */
async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  diagnostic: string | (() => string),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(typeof diagnostic === "function" ? diagnostic() : diagnostic)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The base URL the fake daemon bound to on an OS-assigned loopback port. */
function listeningBaseUrl(server: Server): string {
  const address = server.address();
  assert.ok(address && typeof address === "object", "daemon bound a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

/** An opaque raster large enough for the visual differ (>= 17x20) so the
 * failing step upgrades its repair-hint resolution method past bare a11y. */
function testRaster(): Buffer {
  return PNG.sync.write(new PNG({ width: 32, height: 48 }));
}

function stubInteractions(): Record<string, () => Promise<Record<string, never>>> {
  return {
    find: async () => ({}),
    press: async () => ({}),
    longPress: async () => ({}),
    fill: async () => ({}),
    type: async () => ({}),
    swipe: async () => ({}),
    scroll: async () => ({}),
    pan: async () => ({}),
  };
}

it(
  "the repair fixture fails a stuck lifecycle within its own deadline",
  { timeout: 1_000 },
  async () => {
    await assert.rejects(
      withDeadline(new Promise<never>(() => {}), 20, () => "Repair lifecycle is still queued"),
      /Repair lifecycle is still queued/,
    );
    assert.equal(
      await withDeadline(Promise.resolve("completed"), 20, "unexpected timeout"),
      "completed",
    );
  },
);

it("an expect-screen mismatch pushes a destination-repair-hint with expected vs observed identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "destination-repair-wiring-"));
  try {
    const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
    const observed = observeScreenIdentity(nodes);
    // Deliberately different from what the stub's nodes observe, so the step
    // genuinely fails instead of echoing its own fingerprint back.
    const stepFingerprint = "0".repeat(64);
    assert.notEqual(stepFingerprint, observed.fingerprint);

    const raster = testRaster();
    const screenshotPath = join(root, "shot.png");
    const stub = {
      interactions: stubInteractions(),
      command: {
        wait: async () => ({}),
        back: async () => ({}),
        home: async () => ({}),
      },
      capture: {
        snapshot: async () => ({ nodes }),
        screenshot: async (input: { path?: string }) => {
          const path = input.path ?? screenshotPath;
          await writeFile(path, raster);
          return { base64: raster.toString("base64"), path };
        },
      },
    };
    const device = stub as unknown as Device;
    const artifacts: Array<{ kind: string; capturedAt: number; data: unknown }> = [];
    // Injected capture keeps the whole step on the stub adapter: no driver is
    // looked up for the ambient serial and no platform transport runs.
    const dependencies = {
      captureScreenshot: async (): Promise<ScreenshotPayload> => {
        const shot = await stub.capture.screenshot({ path: screenshotPath });
        return {
          capturedAt: Date.now(),
          mime: "image/png",
          base64: shot.base64,
          path: shot.path,
          bytes: raster.byteLength,
        };
      },
    };

    await assert.rejects(
      runWithTargetContext({ kind: "device", platform: "android", serial: "wiring-check" }, () =>
        runExpectScreenStep(
          device,
          {
            kind: "expect-screen",
            screenId: "home",
            screenTitle: "Home",
            fingerprint: stepFingerprint,
            timeoutMs: 0,
          },
          {
            log: () => {},
            job: { id: "hint-job", platform: "android", artifacts } as never,
            artifacts,
            runtime: {},
          },
          dependencies,
        ),
      ),
      /not “Home”/u,
    );

    const hint = artifacts.find((artifact) => artifact.kind === "destination-repair-hint");
    assert.ok(hint, "mismatch pushes a destination-repair-hint artifact");
    const data = hint.data as Record<string, unknown>;
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.expectedScreenId, "home");
    // The runner's hint records what was expected — including the step's
    // own target fingerprint — alongside what the device actually showed.
    assert.equal(data.expectedFingerprint, "0".repeat(64));
    assert.equal(
      data.observedFingerprint,
      observed.fingerprint,
      "hint reports the fingerprint of the stub's nodes",
    );
    assert.equal(
      typeof data.resolutionMethod,
      "string",
      "hint records how the mismatch was resolved",
    );
    assert.ok((data.resolutionMethod as string).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it(
  "a failed expect-screen job carries the repair hint and stub-grounder proposals",
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "destination-repair-wiring-job-"));
    const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
    const raster = testRaster();
    // Device discovery uses the SDK. Observations and pixels use the local
    // provider below. Both paths stay private to this fixture.
    const commands: string[] = [];
    const daemon = await startFakeAgentDeviceDaemon({ nodes, raster, commands });
    const previousState = process.env.RELAY_STATE_DIR;
    const previousRuns = process.env.RELAY_RUNS_DIR;
    const previousGoIos = process.env.RELAY_GO_IOS_BIN;
    const previousOpenRouter = process.env.OPENROUTER_API_KEY;
    const previousDaemonUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    const previousSdkState = process.env.AGENT_DEVICE_STATE_DIR;
    const previousSdkToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    const previousSdkTransport = process.env.AGENT_DEVICE_DAEMON_TRANSPORT;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_RUNS_DIR = join(root, "runs");
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = listeningBaseUrl(daemon);
    process.env.AGENT_DEVICE_STATE_DIR = join(root, "sdk-state");
    process.env.AGENT_DEVICE_DAEMON_TRANSPORT = "http";
    delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    // A missing go-ios binary keeps pixels on the local stub's screenshot
    // method instead of spawning the vendored go-ios binary.
    process.env.RELAY_GO_IOS_BIN = join(root, "missing-go-ios");
    // Force createDefaultGrounder onto StubVisionGrounder regardless of host env.
    delete process.env.OPENROUTER_API_KEY;
    let queuedId: string | undefined;
    try {
      resetDeviceClients();
      const stubDevice = {
        interactions: stubInteractions(),
        command: {
          wait: async () => ({}),
          back: async () => ({}),
          home: async () => ({}),
        },
        capture: {
          snapshot: async () => ({ nodes }),
          screenshot: async (input: { path?: string }) => {
            const path = input.path ?? join(root, "shot.png");
            await writeFile(path, raster);
            return { base64: raster.toString("base64"), path };
          },
        },
      } as unknown as Device;
      setLocalDeviceProvider({ kind: "device", create: () => stubDevice });
      // Seed the frozen plan's App Map with the expected screen so the repair
      // attachment can resolve it and name the exact recovery command.
      const created = await createAppMap({
        organizationId: "org",
        projectId: "project",
        appMapId: "destination-repair-wiring-job",
        name: "Destination repair wiring",
      });
      await mutateStoredAppMap("project", "destination-repair-wiring-job", (map) =>
        addAppMapScreen(
          map,
          {
            screen: {
              organizationId: map.organizationId,
              projectId: map.projectId,
              appMapId: map.id,
              id: "home",
              title: "Home",
              identity: { schemaVersion: 1, fingerprint: "f".repeat(64) },
              variantIds: [],
              createdAt: created.updatedAt,
              updatedAt: created.updatedAt,
            },
          },
          {
            expectedRevision: created.revision,
            eventId: "seed-home-screen",
            actorId: "agent:runner",
            actorKind: "agent",
            at: created.updatedAt,
          },
        ),
      );

      const { enqueueJob, waitForJobCompletion } = await import("./session.js");
      const recipe = {
        id: "destination-repair-wiring-job",
        title: "Destination repair wiring",
        source: "custom" as const,
        steps: [
          {
            id: "expect-wrong",
            kind: "expect-screen" as const,
            screenId: "home",
            screenTitle: "Home",
            // Differs from the stub snapshot's observed fingerprint, so the job
            // fails on this step instead of passing vacuously.
            fingerprint: "f".repeat(64),
            timeoutMs: 0,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      };
      assert.notEqual(recipe.steps[0]?.fingerprint, observeScreenIdentity(nodes).fingerprint);

      const queued = await import("./operation-context.js").then(({ runWithOperationContext }) =>
        runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "agent:runner",
            actorKind: "agent",
            organizationId: "org",
            projectId: "project",
            operationId: "job.start",
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            issuedAt: Date.now(),
          },
          () =>
            enqueueJob({
              recipe: recipe.id,
              serial: "SMOKE-1",
              platform: "ios",
              projectId: "project",
              ownerId: "agent:runner",
              recipeSnapshot: recipe,
              recipeGraph: {},
            }),
        ),
      );
      queuedId = queued.id;
      const job = await withDeadline(
        waitForJobCompletion(queued.id),
        15_000,
        () =>
          `Repair fixture did not complete: ${queued.id} (${queued.status}); fake RPCs: ${commands.join(", ") || "none"}`,
      );

      assert.equal(job.status, "error", "the mismatching expect-screen fails the job");
      assert.match(job.error ?? "", /not “Home”/u);

      const hint = job.artifacts.find((artifact) => artifact.kind === "destination-repair-hint");
      assert.ok(hint, "failed run records a destination-repair-hint artifact");
      const hintData = hint.data as Record<string, unknown>;
      assert.equal(hintData.schemaVersion, 1);
      assert.equal(hintData.expectedScreenId, "home");
      assert.equal(
        hintData.observedFingerprint,
        observeScreenIdentity(nodes).fingerprint,
        "hint reports what the stub device actually showed",
      );

      assert.equal(
        hintData.recovery,
        "relay map screen alias-observe destination-repair-wiring-job home",
        "hint names the exact one-command recovery once the expected screen exists",
      );

      const proposals = job.artifacts.find(
        (artifact) => artifact.kind === "destination-repair-proposals",
      );
      assert.ok(proposals, "failed run records a destination-repair-proposals artifact");
      // createDefaultGrounder without OPENROUTER_API_KEY yields
      // StubVisionGrounder, and proposeRepair degrades that to an explicit
      // unavailable result rather than pretending to ground pixels.
      assert.deepEqual(proposals.data, {
        available: false,
        proposals: [],
        reason: "grounding-unavailable",
      });
      assert.ok(commands.includes("devices"), "job discovery uses the private loopback daemon");
      assert.ok(
        commands.every((command) =>
          ["devices", "snapshot", "screenshot", "close"].includes(command),
        ),
        "fake daemon accepted only observation and teardown RPCs",
      );
    } finally {
      if (queuedId) {
        const { getJob, cancelJob, waitForJobCompletion } = await import("./session.js");
        if (["queued", "running", "paused"].includes(getJob(queuedId)?.status ?? "")) {
          cancelJob(queuedId);
          await withDeadline(
            waitForJobCompletion(queuedId),
            1_000,
            "Repair fixture cancellation timed out",
          ).catch(() => {});
        }
      }
      setLocalDeviceProvider(undefined);
      resetDeviceClients();
      if (previousDaemonUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
      else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousDaemonUrl;
      await withDeadline(
        new Promise<void>((resolveClose) => {
          daemon.close(() => resolveClose());
          daemon.closeAllConnections();
        }),
        1_000,
        "Repair fixture daemon shutdown timed out",
      );
      if (previousSdkState === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
      else process.env.AGENT_DEVICE_STATE_DIR = previousSdkState;
      if (previousSdkToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
      else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousSdkToken;
      if (previousSdkTransport === undefined) delete process.env.AGENT_DEVICE_DAEMON_TRANSPORT;
      else process.env.AGENT_DEVICE_DAEMON_TRANSPORT = previousSdkTransport;
      resetDurableWorkerAssignmentStoreForTests();
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      resetControlDatabaseCache();
      if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
      else process.env.RELAY_RUNS_DIR = previousRuns;
      if (previousGoIos === undefined) delete process.env.RELAY_GO_IOS_BIN;
      else process.env.RELAY_GO_IOS_BIN = previousGoIos;
      if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouter;
      await rm(root, { recursive: true, force: true });
    }
  },
);
