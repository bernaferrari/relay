import { InMemoryTransport } from "@modelcontextprotocol/server";
import assert from "node:assert/strict";
import test from "node:test";
import {
  relayMcpResourceByteLimit,
  relayMcpResourceMimeType,
  relayMcpResourceUris,
} from "./resources.js";
import { createMcpServer, type OperationInvoker } from "./server.js";
import {
  defaultRelayMcpProfile,
  relayMcpTools,
  relayMcpToolsForProfile,
  type RelayMcpProfile,
} from "./tools.js";

type RpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

type ResourceContent = { uri: string; mimeType: string; text: string };

const projectId = "project-a";

function fixtureResult(operationId: string): unknown {
  const session = {
    schemaVersion: 1,
    id: "session-1",
    organizationId: "org-a",
    projectId,
    actorId: "agent:mcp:test",
    actorKind: "agent",
    appMapId: "map-1",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-1" },
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    take: {
      id: "take-1",
      currentRevision: 1,
      revisions: [
        {
          revision: 1,
          after: {
            id: "observation-1",
            capturedAt: 123,
            bounds: { width: 1080, height: 2400 },
            screen: { id: "screen-1", fingerprint: "fingerprint-1" },
            nodes: [{ text: "private UI tree" }],
          },
        },
      ],
      evidence: [
        {
          path: "/private/tmp/screenshot.png",
          uri: "file:///private/tmp/screenshot.png",
          base64: "iVBORw0KGgo-private-image",
        },
      ],
    },
    createdAt: 100,
    updatedAt: 200,
  };
  const values: Record<string, unknown> = {
    "project.list": {
      projects: [
        { id: "project-other", name: "Other" },
        { id: projectId, name: "Relay app", organizationId: "org-a" },
      ],
    },
    "app-map.list": { appMaps: [{ id: "map-1", name: "Sign in" }] },
    "app-map.get": { appMap: { id: "map-1", name: "Sign in", screens: {} } },
    "workspace.variables.get": {
      revision: 2,
      updatedAt: 200,
      value: [{ id: "thinking-level", name: "thinking_level", kind: "list" }],
    },
    "run.list": { runs: [{ id: "run-1", status: "passed" }] },
    "run.get": { run: { id: "run-1", status: "passed", artifacts: [] } },
    "run.evidence.get": { evidence: { runId: "run-1", logs: [], network: [] } },
    "authoring.session.list": { sessions: [session] },
    "authoring.session.get": { session },
    "target.devices.list": {
      devices: [{ id: "device-1", serial: "device-1", name: "Pixel" }],
    },
    "target.list": {
      targets: [
        {
          id: "browser-1",
          name: "Web app",
          browser: {
            startUrl: "https://example.test/",
            executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          },
        },
      ],
    },
  };
  return values[operationId];
}

function fixtureInvoker(overrides: Partial<Record<string, unknown>> = {}): OperationInvoker {
  return {
    async invoke(operationId) {
      const value = operationId in overrides ? overrides[operationId] : fixtureResult(operationId);
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error(`unexpected operation ${operationId}`);
      return value;
    },
  };
}

async function connectMcp(
  invoker: OperationInvoker = fixtureInvoker(),
  profile: RelayMcpProfile = defaultRelayMcpProfile,
) {
  const server = createMcpServer({ invoker, scope: { projectId }, profile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<
    number,
    { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  clientTransport.onmessage = (message) => {
    if (!("id" in message) || typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message as RpcResponse);
  };
  clientTransport.onerror = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = ++nextId;
    const response = new Promise<RpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    await clientTransport.send({ jsonrpc: "2.0", id, method, params } as never);
    return response;
  };

  await server.connect(serverTransport);
  await clientTransport.start();
  const initialized = await request("initialize", {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "relay-resource-test", version: "0.1.0" },
  });
  assert.equal(initialized.error, undefined);
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  } as never);

  return {
    request,
    async close() {
      await Promise.allSettled([server.close(), clientTransport.close()]);
    },
  };
}

function resourceContent(response: RpcResponse): ResourceContent {
  assert.equal(response.error, undefined);
  const contents = response.result?.contents as ResourceContent[];
  assert.equal(contents.length, 1);
  return contents[0]!;
}

test("lists stable scoped Relay resources and templates with JSON MIME types", async () => {
  const session = await connectMcp();
  try {
    const listed = await session.request("resources/list", {});
    assert.equal(listed.error, undefined);
    const resources = listed.result?.resources as Array<{
      uri: string;
      name: string;
      mimeType: string;
    }>;
    const uris = resources.map(({ uri }) => uri);
    for (const uri of [
      relayMcpResourceUris.project,
      relayMcpResourceUris.operations,
      relayMcpResourceUris.variables,
      relayMcpResourceUris.appMaps,
      relayMcpResourceUris.runs,
      relayMcpResourceUris.authoringSessions,
      relayMcpResourceUris.targets,
      "relay://app-maps/map-1",
      "relay://authoring-sessions/session-1",
      "relay://runs/run-1",
    ]) {
      assert.ok(uris.includes(uri), uri);
    }
    assert.equal(
      resources.every(({ mimeType }) => mimeType === relayMcpResourceMimeType),
      true,
    );

    const templates = await session.request("resources/templates/list", {});
    assert.equal(templates.error, undefined);
    const resourceTemplates = templates.result?.resourceTemplates as
      | Array<{ uriTemplate: string }>
      | undefined;
    assert.ok(resourceTemplates);
    assert.deepEqual(
      resourceTemplates.map(({ uriTemplate }) => uriTemplate),
      [
        relayMcpResourceUris.run,
        relayMcpResourceUris.runEvidence,
        relayMcpResourceUris.appMap,
        relayMcpResourceUris.authoringSession,
        relayMcpResourceUris.targetObservation,
      ],
    );
  } finally {
    await session.close();
  }
});

test("discovers excluded profile operations without eagerly exposing their tools", async () => {
  const session = await connectMcp(fixtureInvoker(), "map");
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.operations }),
    );
    assert.ok(Buffer.byteLength(content.text, "utf8") <= relayMcpResourceByteLimit);
    const envelope = JSON.parse(content.text) as {
      truncated: boolean;
      data: {
        activeProfile: string;
        activeOperations: string[];
        additionalOperations: Array<{
          operationId: string;
          task: string;
          role: string;
          profiles: string[];
        }>;
      };
    };
    assert.equal(envelope.truncated, false);
    assert.equal(envelope.data.activeProfile, "map");
    assert.deepEqual(
      envelope.data.activeOperations,
      relayMcpToolsForProfile("map").map(({ operationId }) => operationId),
    );
    const discoverable = new Set([
      ...envelope.data.activeOperations,
      ...envelope.data.additionalOperations.map(({ operationId }) => operationId),
    ]);
    assert.deepEqual(discoverable, new Set(relayMcpTools.map(({ operationId }) => operationId)));
    assert.ok(
      envelope.data.additionalOperations.some(
        ({ operationId, task, role }) =>
          operationId === "schedule.create" && task === "workspace" && role === "admin",
      ),
    );
  } finally {
    await session.close();
  }
});

test("reads the configured project and detail resources through Relay queries", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const invoker: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return fixtureInvoker().invoke(operationId, input);
    },
  };
  const session = await connectMcp(invoker);
  try {
    const project = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.project }),
    );
    const projectEnvelope = JSON.parse(project.text) as Record<string, unknown>;
    assert.equal(project.mimeType, relayMcpResourceMimeType);
    assert.equal(projectEnvelope.projectId, projectId);
    assert.equal(projectEnvelope.truncated, false);
    assert.deepEqual(projectEnvelope.data, {
      project: { id: projectId, name: "Relay app", organizationId: "org-a" },
    });

    const appMap = resourceContent(
      await session.request("resources/read", { uri: "relay://app-maps/map-1" }),
    );
    assert.deepEqual((JSON.parse(appMap.text) as Record<string, unknown>).data, {
      appMap: { id: "map-1", name: "Sign in", screens: {} },
    });
    const variables = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.variables }),
    );
    assert.deepEqual((JSON.parse(variables.text) as Record<string, unknown>).data, {
      revision: 2,
      updatedAt: 200,
      value: [{ id: "thinking-level", kind: "list", name: "thinking_level" }],
    });
    assert.deepEqual(calls, [
      { operationId: "project.list", input: {} },
      { operationId: "app-map.get", input: { appMapId: "map-1" } },
      { operationId: "workspace.variables.get", input: {} },
    ]);
  } finally {
    await session.close();
  }
});

test("rejects missing and unsafe template resources before leaking query details", async () => {
  const calls: string[] = [];
  const invoker: OperationInvoker = {
    async invoke(operationId) {
      calls.push(operationId);
      if (operationId === "app-map.get") throw new Error("private backend path");
      return fixtureResult(operationId);
    },
  };
  const session = await connectMcp(invoker);
  try {
    const missing = await session.request("resources/read", {
      uri: "relay://app-maps/missing",
    });
    assert.ok(missing.error);
    assert.equal(missing.error.data?.uri, "relay://app-maps/missing");
    assert.doesNotMatch(missing.error.message, /private backend path/);

    const beforeUnsafe = calls.length;
    for (const uri of [
      "relay://app-maps/%2Fetc",
      "relay://app-maps/..%2Fsecret",
      "relay://app-maps/map-1?escape=../secret",
    ]) {
      const rejected = await session.request("resources/read", { uri });
      assert.ok(rejected.error, uri);
    }
    assert.equal(calls.length, beforeUnsafe);
  } finally {
    await session.close();
  }
});

test("bounds deterministic JSON with explicit truncation metadata", async () => {
  const huge = {
    appMaps: Array.from({ length: 200 }, (_, index) => ({
      id: `map-${index}`,
      name: `Map ${index}`,
      content: "x".repeat(1_000),
    })),
  };
  const session = await connectMcp(fixtureInvoker({ "app-map.list": huge }));
  try {
    const first = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.appMaps }),
    );
    const second = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.appMaps }),
    );
    assert.equal(first.text, second.text);
    assert.ok(Buffer.byteLength(first.text, "utf8") <= relayMcpResourceByteLimit);
    const envelope = JSON.parse(first.text) as Record<string, unknown>;
    assert.equal(envelope.truncated, true);
    assert.equal(envelope.data, null);
    assert.equal(envelope.byteLimit, relayMcpResourceByteLimit);
    assert.ok(Number(envelope.originalBytes) > relayMcpResourceByteLimit);
  } finally {
    await session.close();
  }
});

test("redacts local paths and screenshot payloads from target and session resources", async () => {
  const session = await connectMcp();
  try {
    for (const uri of [relayMcpResourceUris.targets, "relay://authoring-sessions/session-1"]) {
      const content = resourceContent(await session.request("resources/read", { uri }));
      assert.doesNotMatch(content.text, /private\/tmp|Applications\/Google Chrome/);
      assert.doesNotMatch(content.text, /executablePath|base64|iVBORw0KGgo/);
      assert.doesNotMatch(content.text, /file:\/\//);
    }
  } finally {
    await session.close();
  }
});

test("reads current target observation metadata without capture side effects", async () => {
  const calls: string[] = [];
  const invoker: OperationInvoker = {
    async invoke(operationId) {
      calls.push(operationId);
      assert.notEqual(operationId, "target.screenshot.capture");
      assert.notEqual(operationId, "target.snapshot.capture");
      return fixtureResult(operationId);
    },
  };
  const session = await connectMcp(invoker);
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: "relay://targets/device-1/observation",
      }),
    );
    const envelope = JSON.parse(content.text) as { data: Record<string, unknown> };
    assert.deepEqual(envelope.data, {
      current: {
        observation: {
          bounds: { height: 2400, width: 1080 },
          capturedAt: 123,
          id: "observation-1",
          screen: { fingerprint: "fingerprint-1", id: "screen-1" },
        },
        sessionId: "session-1",
        sessionState: "reviewing",
        takeId: "take-1",
        takeRevision: 1,
        updatedAt: 200,
      },
      targetId: "device-1",
    });
    assert.deepEqual(calls, ["target.devices.list", "target.list", "authoring.session.list"]);
  } finally {
    await session.close();
  }
});
