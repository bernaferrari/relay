import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import type { AuthoringRuntime } from "@relay/core";
import { createMcpServer, type OperationInvoker } from "@relay/mcp";
import type {
  AuthoringInteraction,
  AuthoringSession,
  AuthoringSessionSummary,
  EventEnvelope,
  OperationId,
  RecipeStep,
} from "@relay/protocol";
import { startServer, type StartedServer } from "./index.js";

const targetId = "device-mcp-authoring";
const projectId = "project-mcp-authoring";
const agentActorId = "agent:mcp-author";
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type JsonRpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

type ToolCallResult = {
  content: Array<Record<string, unknown>>;
  structuredContent?: { result?: unknown };
  isError?: boolean;
};

type TestTransport = {
  onmessage?: (message: Record<string, unknown>) => void;
  onerror?: (error: Error) => void;
  send(message: Record<string, unknown>): Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
};

type InMemoryTransportConstructor = {
  createLinkedPair(): [TestTransport, TestTransport];
};

class FakeRuntime implements AuthoringRuntime {
  screen = "source";
  observations = 0;
  executed: AuthoringInteraction[] = [];
  replayed: RecipeStep[][] = [];

  async observe() {
    this.observations += 1;
    const capturedAt = 1_000 + this.observations;
    return {
      capturedAt,
      targetId,
      fingerprint: createHash("sha256").update(this.screen).digest("hex"),
      bounds: { width: 400, height: 800 },
      nodes: [{ role: "button", label: this.screen }],
      screenshot: { data: Buffer.from(pngBase64, "base64"), mime: "image/png" },
    };
  }

  async execute(_session: AuthoringSession, interaction: AuthoringInteraction) {
    this.executed.push(structuredClone(interaction));
    if (interaction.kind === "key" || interaction.kind === "tap") this.screen = "destination";
  }

  async replay(_session: AuthoringSession, steps: RecipeStep[]) {
    this.replayed.push(structuredClone(steps));
    if (steps.length > 0) this.screen = "destination";
  }

  async startVideo() {}

  async stopVideo() {
    return { data: Buffer.from("fake-video"), mime: "video/mp4" };
  }
}

function callResult(response: JsonRpcResponse): ToolCallResult {
  assert.equal(response.error, undefined);
  assert.ok(response.result);
  return response.result as ToolCallResult;
}

function relayResult<T>(response: JsonRpcResponse): T {
  const result = callResult(response);
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.ok(result.structuredContent);
  return result.structuredContent.result as T;
}

async function connectMcp(invoker: OperationInvoker) {
  const requireFromMcp = createRequire(new URL("../../mcp/package.json", import.meta.url));
  const { InMemoryTransport } = requireFromMcp("@modelcontextprotocol/server") as {
    InMemoryTransport: InMemoryTransportConstructor;
  };
  const server = createMcpServer({ invoker, scope: { projectId }, profile: "full" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<
    number,
    { resolve: (response: JsonRpcResponse) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  clientTransport.onmessage = (message) => {
    if (!("id" in message) || typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message as JsonRpcResponse);
  };
  clientTransport.onerror = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  const startRequest = (method: string, params: Record<string, unknown>) => {
    const id = ++nextId;
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    const sent = clientTransport.send({ jsonrpc: "2.0", id, method, params });
    return { id, response: sent.then(() => response) };
  };
  const request = (method: string, params: Record<string, unknown>) =>
    startRequest(method, params).response;

  await server.connect(serverTransport as never);
  await clientTransport.start();
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "relay-server-integration", version: "0.1.0" },
  });
  assert.equal(initialized.error, undefined);
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  return {
    request,
    startRequest,
    notify: (method: string, params: Record<string, unknown>) =>
      clientTransport.send({ jsonrpc: "2.0", method, params }),
    async close() {
      await Promise.allSettled([server.close(), clientTransport.close()]);
    },
  };
}

function callTool(
  session: Awaited<ReturnType<typeof connectMcp>>,
  name: string,
  input: Record<string, unknown>,
) {
  return session.request("tools/call", { name, arguments: { ...input, confirm: true } });
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function installFakeAdb(root: string): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const executable = join(bin, "adb");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "devices") {
  process.stdout.write("List of devices attached\\n${targetId} device product:relay model:Relay_Fake transport_id:1\\n");
} else if (args.includes("screencap")) {
  process.stdout.write(Buffer.from("${pngBase64}", "base64"));
} else if (args.includes("ro.build.version.release")) {
  process.stdout.write("16\\n");
}
`,
    { mode: 0o755 },
  );
  await chmod(executable, 0o755);
  return bin;
}

test("MCP agent authors a transition observed by an app client", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-mcp-authoring-"));
  const environment = {
    PATH: process.env.PATH,
    AGENT_DEVICE_STATE_DIR: process.env.AGENT_DEVICE_STATE_DIR,
    RELAY_WORKSPACE_ROOT: process.env.RELAY_WORKSPACE_ROOT,
    RELAY_STATE_DIR: process.env.RELAY_STATE_DIR,
    RELAY_RECIPES_DIR: process.env.RELAY_RECIPES_DIR,
    RELAY_TESTS_DIR: process.env.RELAY_TESTS_DIR,
  };
  const fakeAdbBin = await installFakeAdb(root);
  process.env.PATH = `${fakeAdbBin}:${environment.PATH ?? ""}`;
  process.env.AGENT_DEVICE_STATE_DIR = join(root, "agent-device");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");

  const runtime = new FakeRuntime();
  let relayServer: StartedServer | undefined;
  let mcp: Awaited<ReturnType<typeof connectMcp>> | undefined;
  const eventAbort = new AbortController();
  let eventSubscription: Promise<void> | undefined;
  try {
    relayServer = await startServer({
      host: "127.0.0.1",
      port: 0,
      authoringRuntime: runtime,
      captureTargetScreenshot: async (options) => ({
        serial: options?.serial,
        capturedAt: Date.now(),
        mime: "image/png",
        base64: pngBase64,
        path: join(root, "capture.png"),
        bytes: Buffer.from(pngBase64, "base64").byteLength,
        width: 1,
        height: 1,
      }),
    });
    const serverUrl = `http://127.0.0.1:${relayServer.port}`;
    const sharedConnection = {
      url: serverUrl,
      auth: { type: "none" as const },
      organizationId: "local",
      projectId,
    };
    const setup = new RelayClient({
      ...sharedConnection,
      actorId: "human:setup",
      actorKind: "human",
    });
    const observer = new RelayClient({
      ...sharedConnection,
      actorId: "human:app-observer",
      actorKind: "human",
    });

    const hostFetch = globalThis.fetch;
    let cancelNextHealth = false;
    let cancellationFetchEntered = false;
    let cancellationSignalAborted = false;
    const agentFetch: typeof fetch = (input, init) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      if (cancelNextHealth && url.pathname === "/health") {
        cancelNextHealth = false;
        cancellationFetchEntered = true;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          assert.ok(signal);
          const abort = () => {
            cancellationSignalAborted = true;
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      return hostFetch(input, init);
    };
    const agent = new RelayClient(
      {
        ...sharedConnection,
        actorId: agentActorId,
        actorKind: "agent",
      },
      { fetch: agentFetch },
    );
    const invocations: OperationId[] = [];
    const failures: Array<{ operationId: OperationId; status: number }> = [];
    const invoker: OperationInvoker = {
      async invoke(operationId, input, options) {
        invocations.push(operationId);
        try {
          return await agent.invoke(operationId, input as never, options);
        } catch (error) {
          if (error instanceof ApiError) failures.push({ operationId, status: error.status });
          throw error;
        }
      },
    };

    const events: EventEnvelope[] = [];
    let openEvents!: () => void;
    const eventsOpen = new Promise<void>((resolve) => (openEvents = resolve));
    eventSubscription = observer.events((event) => events.push(event), {
      signal: eventAbort.signal,
      onOpen: openEvents,
    });
    await eventsOpen;

    const poolId = "pool-mcp-authoring";
    await setup.saveDevicePool({
      id: poolId,
      name: "MCP authoring fake devices",
      platform: "android",
      deviceSerials: [targetId],
    });
    const created = await setup.invoke("app-map.create", {
      appMapId: "mcp-authoring",
      name: "MCP Authoring Integration",
    });

    mcp = await connectMcp(invoker);
    const listed = await mcp.request("tools/list", {});
    const tools = listed.result?.tools as Array<{ name: string }>;
    assert.ok(tools.some(({ name }) => name === "relay_target_screenshot_capture"));
    assert.ok(tools.some(({ name }) => name === "relay_authoring_session_commit"));

    const leased = relayResult<{ lease: { id: string } }>(
      await callTool(mcp, "relay_lease_create", {
        poolId,
        deviceSerial: targetId,
        expiresAt: Date.now() + 60_000,
      }),
    );
    const leaseId = leased.lease.id;

    const screenshot = callResult(
      await callTool(mcp, "relay_target_screenshot_capture", { serial: targetId }),
    );
    assert.equal(screenshot.isError, undefined, JSON.stringify(screenshot.content));
    const image = screenshot.content.find((item) => item.type === "image");
    assert.ok(image);
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.data, pngBase64);
    const decoded = Buffer.from(String(image.data), "base64");
    assert.ok(decoded.subarray(0, pngSignature.length).equals(pngSignature));
    assert.equal(decoded.toString("base64"), image.data);
    const screenshotPayload = JSON.stringify(screenshot);
    assert.doesNotMatch(screenshotPayload, /path|framePath|capture\.png|relay-mcp-authoring/i);

    cancelNextHealth = true;
    const cancelledCall = mcp.startRequest("tools/call", {
      name: "relay_system_health_get",
      arguments: { confirm: true },
    });
    await waitFor(
      () => cancellationFetchEntered,
      "Timed out waiting for the cancellable Relay request",
    );
    await mcp.notify("notifications/cancelled", {
      requestId: cancelledCall.id,
      reason: "integration cancellation proof",
    });
    void cancelledCall.response.catch(() => undefined);
    await waitFor(
      () => cancellationSignalAborted,
      "MCP cancellation did not reach the RelayClient fetch signal",
    );

    const createInput = {
      appMapId: created.appMap.id,
      target: { kind: "device", platform: "android", targetId },
      leaseId,
      expectedAppMapRevision: created.appMap.revision,
    } as const;

    const leaseConflictCalls = invocations.length;
    const leaseConflict = callResult(
      await callTool(mcp, "relay_authoring_session_create", {
        ...createInput,
        leaseId: "lease-not-owned",
      }),
    );
    assert.equal(leaseConflict.isError, true);
    assert.equal(invocations.length, leaseConflictCalls + 1);
    assert.deepEqual(failures.at(-1), {
      operationId: "authoring.session.create",
      status: 403,
    });

    const revisionConflictCalls = invocations.length;
    const revisionConflict = callResult(
      await callTool(mcp, "relay_authoring_session_create", {
        ...createInput,
        expectedAppMapRevision: created.appMap.revision + 1,
      }),
    );
    assert.equal(revisionConflict.isError, true);
    assert.equal(invocations.length, revisionConflictCalls + 1);
    assert.deepEqual(failures.at(-1), {
      operationId: "authoring.session.create",
      status: 409,
    });
    assert.equal((await observer.invoke("authoring.session.list", {})).sessions.length, 0);
    assert.equal(runtime.observations, 0);

    const createdSession = relayResult<{ session: AuthoringSessionSummary }>(
      await callTool(mcp, "relay_authoring_session_create", createInput),
    );
    const sessionId = createdSession.session.id;
    assert.equal(createdSession.session.actorId, agentActorId);
    assert.equal(createdSession.session.actorKind, "agent");

    const observed = relayResult<{ session: AuthoringSessionSummary }>(
      await callTool(mcp, "relay_authoring_session_observe", { sessionId }),
    );
    assert.equal(observed.session.state, "ready");
    const started = relayResult<{ session: AuthoringSessionSummary }>(
      await callTool(mcp, "relay_authoring_session_start", { sessionId }),
    );
    assert.equal(started.session.state, "recording");
    const interacted = relayResult<{ session: AuthoringSessionSummary }>(
      await callTool(mcp, "relay_authoring_session_interact", {
        sessionId,
        interaction: { kind: "key", key: "back" },
      }),
    );
    assert.equal(interacted.session.take?.actionCount, 1);
    const stopped = relayResult<{ session: AuthoringSessionSummary }>(
      await callTool(mcp, "relay_authoring_session_stop", { sessionId }),
    );
    assert.equal(stopped.session.state, "reviewing");

    const inspected = relayResult<{
      truncated: true;
      resourceUri: string;
      session: { take?: { actionCount: number } };
    }>(await callTool(mcp, "relay_authoring_session_get", { sessionId }));
    assert.equal(inspected.truncated, true);
    assert.equal(inspected.resourceUri, `relay://authoring-sessions/${sessionId}`);
    assert.equal(inspected.session.take?.actionCount, 1);

    runtime.screen = "source";
    const replayResult = callResult(
      await callTool(mcp, "relay_authoring_take_replay", { sessionId }),
    );
    assert.notEqual(replayResult.isError, true, JSON.stringify(replayResult.content));
    const replayed = await observer.authoringSession(sessionId);
    assert.equal(replayed.session.take?.replayAttempts.at(-1)?.outcome, "passed");
    const commitResult = callResult(
      await callTool(mcp, "relay_authoring_session_commit", {
        sessionId,
        destination: { kind: "new-screen", title: "MCP destination" },
      }),
    );
    assert.notEqual(commitResult.isError, true, JSON.stringify(commitResult.content));
    const committed = await observer.authoringSession(sessionId);
    assert.equal(committed.session.state, "committed");
    assert.ok(committed.session.committedConnectionId);

    await waitFor(
      () =>
        events.some(
          (event) =>
            event.payload.type === "authoring.committed" && event.payload.sessionId === sessionId,
        ),
      "Timed out waiting for the app client to observe the MCP commit",
    );
    const resourceEvent = events.find(
      (event) =>
        event.payload.type === "resource.updated" &&
        event.payload.resource === "recording-session" &&
        event.payload.resourceId === sessionId &&
        event.actorId === agentActorId,
    );
    assert.ok(resourceEvent);
    assert.equal(resourceEvent.actorKind, "agent");
    assert.match(resourceEvent.operationId, /^authoring\.session\./);
    const committedEvent = events.find(
      (event) =>
        event.payload.type === "authoring.committed" && event.payload.sessionId === sessionId,
    );
    assert.equal(committedEvent?.actorId, agentActorId);
    assert.equal(committedEvent?.actorKind, "agent");
    assert.equal(committedEvent?.operationId, "authoring.session.commit");

    const visibleSession = await observer.authoringSession(sessionId);
    assert.equal(visibleSession.session.state, "committed");
    const finalMap = (await observer.invoke("app-map.get", { appMapId: created.appMap.id })).appMap;
    assert.equal(finalMap.revision, created.appMap.revision + 1);
    const connection = finalMap.connections[committed.session.committedConnectionId!];
    assert.ok(connection);
    assert.equal(connection.state, "ready");
    assert.equal(connection.destination.kind, "screen");
    const destination =
      connection.destination.kind === "screen"
        ? finalMap.screens[connection.destination.screenId]
        : undefined;
    assert.equal(destination?.title, "MCP destination");
    assert.deepEqual(
      runtime.executed.map((interaction) => interaction.kind),
      ["key"],
    );
    assert.equal(runtime.replayed.length, 1);
    assert.equal(runtime.replayed[0]?.[0]?.kind, "key");
  } finally {
    eventAbort.abort();
    await eventSubscription?.catch(() => undefined);
    await mcp?.close();
    await relayServer?.close();
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
