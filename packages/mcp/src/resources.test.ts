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
    "lane.list": { lanes: [{ id: "grok-daily", appMapId: "grok-web" }] },
    "app-map.get": { appMap: { id: "map-1", name: "Sign in", screens: {} } },
    "workspace.variables.get": {
      revision: 2,
      updatedAt: 200,
      value: [{ id: "thinking-level", name: "thinking_level", kind: "list" }],
    },
    "run.list": { runs: [{ id: "run-1", status: "passed" }] },
    "run.get": { run: { id: "run-1", status: "passed", artifacts: [] } },
    "run.replay.offline": {
      report: {
        schemaVersion: 1,
        mode: "offline-evidence-replay",
        runId: "run-1",
        sourceRunStatus: "error",
        planDigest: "a".repeat(64),
        summary: {
          checks: 40,
          proved: 38,
          rootFailures: 1,
          invalidCascades: 1,
          independentFailures: 0,
        },
        cursorTimeline: [],
        checks: [],
        blockers: [],
      },
    },
    "run.evidence.get": { evidence: { runId: "run-1", logs: [], network: [] } },
    "run.trace-pack.get": {
      tracePack: {
        schemaVersion: 1,
        kind: "relay-trace-pack",
        digest: `sha256:${"a".repeat(64)}`,
        createdAt: 123,
        source: {
          runId: "run-1",
          runSchemaVersion: 5,
          status: "passed",
          action: "test",
          inputDigest: "b".repeat(64),
          writtenAt: 123,
        },
        redaction: { status: "applied-at-persistence", redactedChannels: [] },
        completeness: { status: "complete", channels: {}, missing: [], artifacts: [] },
        objects: [
          {
            path: "run.json",
            kind: "frozen-run",
            mediaType: "application/json",
            encoding: "json",
            digest: `sha256:${"a".repeat(64)}`,
            bytes: 2,
            content: {},
          },
        ],
      },
      analysis: {
        schemaVersion: 1,
        mode: "trace-pack-offline-analysis",
        tracePackDigest: `sha256:${"a".repeat(64)}`,
        sourceRunId: "run-1",
        historicalVerdict: "proved",
        futureTransitionVerdict: "unknown",
        proved: [],
        unknown: [{ code: "future", statement: "future is unknown", resolution: "live run" }],
        smallestLiveVerification: { kind: "replay-check", reason: "live", requiresTarget: true },
      },
    },
    "run.repair.list": {
      repairs: [{ id: "run-1:usage", source: { runId: "run-1", checkId: "usage" } }],
    },
    "run.repair.get": {
      repair: {
        id: "run-1:usage",
        source: { runId: "run-1", checkId: "usage" },
        actions: [{ kind: "continue-and-report" }],
      },
    },
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
      relayMcpResourceUris.repairs,
      relayMcpResourceUris.authoringSessions,
      relayMcpResourceUris.targets,
      relayMcpResourceUris.controlGotchas,
      relayMcpResourceUris.lanes,
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
        `${relayMcpResourceUris.runEvidence}{?cursor}`,
        relayMcpResourceUris.runTracePack,
        relayMcpResourceUris.runRepairProposals,
        "relay://app-maps/{appMapId}/impact",
        relayMcpResourceUris.runOfflineReplay,
        relayMcpResourceUris.repair,
        `${relayMcpResourceUris.appMaps}{?cursor}`,
        `${relayMcpResourceUris.runs}{?cursor}`,
        `${relayMcpResourceUris.authoringSessions}{?cursor}`,
        relayMcpResourceUris.appMap,
        relayMcpResourceUris.tests,
        relayMcpResourceUris.test,
        `${relayMcpResourceUris.testOutline}{?cursor}`,
        relayMcpResourceUris.testOutline,
        `${relayMcpResourceUris.testOutlinePage}{?cursor}`,
        relayMcpResourceUris.testOutlinePage,
        relayMcpResourceUris.authoringSession,
        relayMcpResourceUris.targetObservation,
      ],
    );
  } finally {
    await session.close();
  }
});

test("publishes device-control gotchas as a mandatory JSON resource", async () => {
  const session = await connectMcp(fixtureInvoker(), "outcome");
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.controlGotchas }),
    );
    const envelope = JSON.parse(content.text) as {
      data: { mandatory: boolean; rules: string[]; readBefore: string[] };
    };
    assert.equal(envelope.data.mandatory, true);
    assert.ok(envelope.data.readBefore.includes("target.interact"));
    assert.ok(envelope.data.rules.some((rule) => rule.includes("identifier")));
    assert.ok(
      envelope.data.rules.some(
        (rule) =>
          rule.includes("unique chrome labels") &&
          rule.includes("grok-compose") &&
          rule.includes("Do not walk conversation lists"),
      ),
    );
    assert.ok(
      envelope.data.rules.some(
        (rule) =>
          rule.includes("laneId") && rule.includes("unsigned profile") && rule.includes("grok-com"),
      ),
    );
    assert.ok(envelope.data.rules.some((rule) => rule.includes("screenshot → preview/tap")));
    assert.ok(envelope.data.rules.some((rule) => rule.includes("wait-for/expect-screen")));
    assert.ok(
      envelope.data.rules.some(
        (rule) =>
          rule.includes('lease.create is not exposed in selected MCP profile "outcome"') &&
          rule.includes("operator"),
      ),
    );
    assert.ok(
      envelope.data.rules.some(
        (rule) =>
          rule.includes('target.recover is not exposed in selected MCP profile "outcome"') &&
          rule.includes("operator"),
      ),
    );
  } finally {
    await session.close();
  }
});

test("operator profile publishes relay://lanes from lane.list", async () => {
  const session = await connectMcp(fixtureInvoker(), "operator");
  try {
    const listed = await session.request("resources/list", {});
    const uris = ((listed.result?.resources as Array<{ uri: string }>) ?? []).map(({ uri }) => uri);
    assert.ok(uris.includes(relayMcpResourceUris.lanes));
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.lanes }),
    );
    const envelope = JSON.parse(content.text) as { data: { lanes: Array<{ id: string }> } };
    assert.equal(envelope.data.lanes[0]?.id, "grok-daily");
    const gotchas = JSON.parse(
      resourceContent(
        await session.request("resources/read", { uri: relayMcpResourceUris.controlGotchas }),
      ).text,
    ) as { data: { rules: string[] } };
    assert.ok(gotchas.data.rules.some((rule) => rule.includes("auto-create a lease")));
    assert.ok(gotchas.data.rules.some((rule) => rule.includes("relay_recover")));
    assert.ok(
      gotchas.data.rules.some((rule) => rule.includes("adopts a healthy live XCTest runner")),
    );
    assert.ok(gotchas.data.rules.some((rule) => rule.includes("target.open")));
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
        availablePrompts: Array<{
          name: string;
          title: string;
          description: string;
          unlockedByProfiles: string[];
        }>;
      };
    };
    assert.ok(
      envelope.data.availablePrompts.length >= 1,
      "operations resource lists the prompt registry",
    );
    for (const available of envelope.data.availablePrompts) {
      assert.ok(available.name.length > 0);
      assert.ok(available.title.length > 0);
      assert.ok(available.description.length > 0);
      assert.ok(
        available.unlockedByProfiles.includes("full"),
        `${available.name} unlocks under the full profile`,
      );
    }
    assert.ok(
      envelope.data.availablePrompts.some(({ unlockedByProfiles }) =>
        unlockedByProfiles.includes("map"),
      ),
      "at least one prompt is reachable from the map profile",
    );
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
    const repairs = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.repairs }),
    );
    assert.equal(
      (JSON.parse(repairs.text) as { data: { repairs: Array<{ id: string }> } }).data.repairs[0]
        ?.id,
      "run-1:usage",
    );
    const repair = resourceContent(
      await session.request("resources/read", {
        uri: "relay://runs/run-1/checks/usage/repair",
      }),
    );
    assert.equal(
      (JSON.parse(repair.text) as { data: { repair: { id: string } } }).data.repair.id,
      "run-1:usage",
    );
    const offlineReplay = resourceContent(
      await session.request("resources/read", { uri: "relay://runs/run-1/offline-replay" }),
    );
    assert.deepEqual(
      (JSON.parse(offlineReplay.text) as { data: { report: { runId: string } } }).data,
      {
        report: {
          schemaVersion: 1,
          mode: "offline-evidence-replay",
          runId: "run-1",
          sourceRunStatus: "error",
          planDigest: "a".repeat(64),
          summary: {
            checks: 40,
            proved: 38,
            rootFailures: 1,
            invalidCascades: 1,
            independentFailures: 0,
          },
          cursorTimeline: [],
          checks: [],
          blockers: [],
        },
      },
    );
    const tracePack = resourceContent(
      await session.request("resources/read", { uri: "relay://runs/run-1/trace-pack" }),
    );
    const tracePackEnvelope = JSON.parse(tracePack.text) as {
      truncated: boolean;
      data: { tracePack: { digest: string; source: { runId: string } } };
    };
    assert.equal(tracePackEnvelope.truncated, false);
    assert.equal(tracePackEnvelope.data.tracePack.digest, `sha256:${"a".repeat(64)}`);
    assert.equal(tracePackEnvelope.data.tracePack.source.runId, "run-1");
    assert.deepEqual(calls, [
      { operationId: "project.list", input: {} },
      { operationId: "app-map.get", input: { appMapId: "map-1" } },
      { operationId: "workspace.variables.get", input: {} },
      { operationId: "run.repair.list", input: {} },
      { operationId: "run.repair.get", input: { runId: "run-1", checkId: "usage" } },
      { operationId: "run.replay.offline", input: { runId: "run-1" } },
      { operationId: "run.trace-pack.get", input: { runId: "run-1" } },
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

test("bounds deterministic JSON with explicit pagination metadata", async () => {
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
    assert.equal(envelope.truncated, false);
    const data = envelope.data as {
      appMaps: Array<{ id: string }>;
      pagination: { totalCount: number; returnedCount: number; nextResourceUri?: string };
    };
    assert.equal(data.appMaps.length, 100);
    assert.deepEqual(data.appMaps[0], { id: "map-0", name: "Map 0" });
    assert.equal(data.pagination.totalCount, 200);
    assert.equal(data.pagination.returnedCount, 100);
    assert.equal(typeof data.pagination.nextResourceUri, "string");
  } finally {
    await session.close();
  }
});

test("paginates large map, run, and authoring-session resource collections", async () => {
  const maps = Array.from({ length: 205 }, (_, index) => ({
    id: `map-${index}`,
    name: `Map ${index}`,
    description: "x".repeat(2_000),
  }));
  const runs = Array.from({ length: 205 }, (_, index) => ({
    id: `run-${index}`,
    title: `Run ${index}`,
    status: "passed",
    privatePayload: "x".repeat(2_000),
  }));
  const sessions = Array.from({ length: 205 }, (_, index) => ({
    id: `session-${index}`,
    appMapId: "map-1",
    state: "reviewing",
    target: { targetId: `device-${index}` },
    privatePayload: "x".repeat(2_000),
  }));
  const session = await connectMcp(
    fixtureInvoker({
      "app-map.list": { appMaps: maps },
      "run.list": { runs },
      "authoring.session.list": { sessions },
    }),
  );
  try {
    for (const [uri, field, expected] of [
      [relayMcpResourceUris.appMaps, "appMaps", maps],
      [relayMcpResourceUris.runs, "runs", runs],
      [relayMcpResourceUris.authoringSessions, "sessions", sessions],
    ] as const) {
      const ids: string[] = [];
      let nextUri: string | undefined = uri;
      let pageCount = 0;
      while (nextUri) {
        const envelope = JSON.parse(
          resourceContent(await session.request("resources/read", { uri: nextUri })).text,
        ) as {
          data: Record<string, unknown>;
        };
        const page = envelope.data[field] as Array<{ id: string }>;
        const pagination = envelope.data.pagination as {
          pageSize: number;
          totalCount: number;
          returnedCount: number;
          nextResourceUri?: string;
        };
        assert.ok(page.length <= 100);
        assert.equal(pagination.pageSize, 100);
        assert.equal(pagination.totalCount, expected.length);
        assert.equal(pagination.returnedCount, page.length);
        ids.push(...page.map(({ id }) => id));
        nextUri = pagination.nextResourceUri;
        pageCount += 1;
        assert.ok(pageCount <= 3);
      }
      assert.equal(pageCount, 3);
      assert.deepEqual(
        ids,
        expected.map(({ id }) => id),
      );
    }

    const listed = await session.request("resources/list", {});
    const listedResources = listed.result?.resources;
    assert.ok(Array.isArray(listedResources));
    const listedUris = (listedResources as Array<{ uri: string }>).map(({ uri }) => uri);
    assert.ok(listedUris.some((uri) => uri.startsWith(`${relayMcpResourceUris.appMaps}?cursor=`)));
  } finally {
    await session.close();
  }
});

test("run resource follows the backend run.list continuation cursor", async () => {
  const runs = Array.from({ length: 205 }, (_, index) => ({
    id: `backend-run-${index}`,
    title: `Run ${index}`,
    status: "passed",
  }));
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const invoker: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId !== "run.list") return fixtureResult(operationId);
      const cursor =
        typeof input.cursor === "string" ? Number(input.cursor.replace("page-", "")) : 0;
      const page = runs.slice(cursor, cursor + 100);
      return {
        runs: page,
        totalCount: runs.length,
        ...(cursor + page.length < runs.length
          ? { nextCursor: `page-${cursor + page.length}` }
          : {}),
      };
    },
  };
  const session = await connectMcp(invoker);
  try {
    const ids: string[] = [];
    let nextUri: string | undefined = relayMcpResourceUris.runs;
    let secondPageCursor: string | undefined;
    while (nextUri) {
      const envelope = JSON.parse(
        resourceContent(await session.request("resources/read", { uri: nextUri })).text,
      ) as {
        data: {
          runs: Array<{ id: string }>;
          pagination: { cursor?: string; nextResourceUri?: string };
        };
      };
      ids.push(...envelope.data.runs.map(({ id }) => id));
      if (ids.length === 200) secondPageCursor = envelope.data.pagination.cursor;
      nextUri = envelope.data.pagination.nextResourceUri;
    }
    assert.deepEqual(
      ids,
      runs.map(({ id }) => id),
    );
    assert.deepEqual(
      calls.filter(({ operationId }) => operationId === "run.list").map(({ input }) => input),
      [{ limit: 100 }, { limit: 100, cursor: "page-100" }, { limit: 100, cursor: "page-200" }],
    );
    assert.ok(secondPageCursor);
    const replayedSecondPage = JSON.parse(
      resourceContent(
        await session.request("resources/read", {
          uri: `${relayMcpResourceUris.runs}?cursor=${secondPageCursor}`,
        }),
      ).text,
    ) as { data: { runs: Array<{ id: string }> } };
    assert.deepEqual(
      replayedSecondPage.data.runs.map(({ id }) => id),
      runs.slice(100, 200).map(({ id }) => id),
    );
  } finally {
    await session.close();
  }
});

test("paginates all evidence items and keeps evidence reads bounded", async () => {
  const evidenceItems = Array.from({ length: 650 }, (_, index) => ({
    id: `event-${index}`,
    message: `event ${index}`,
  }));
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId === "run.evidence.get") {
        return { evidence: { runId: "run-1", logs: evidenceItems } };
      }
      return fixtureResult(operationId);
    },
  });
  try {
    const ids: string[] = [];
    let nextUri: string | undefined = "relay://runs/run-1/evidence";
    let pageCount = 0;
    while (nextUri) {
      const envelope = JSON.parse(
        resourceContent(await session.request("resources/read", { uri: nextUri })).text,
      ) as {
        data: {
          evidence: {
            logs?: Array<{ id: string }>;
            pagination: {
              pageSize: number;
              totalCount: number;
              returnedCount: number;
              nextResourceUri?: string;
            };
          };
        };
      };
      const page = envelope.data.evidence.logs ?? [];
      const pagination = envelope.data.evidence.pagination;
      assert.ok(page.length <= 100);
      assert.equal(pagination.pageSize, 100);
      assert.equal(pagination.totalCount, evidenceItems.length);
      assert.equal(pagination.returnedCount, page.length);
      ids.push(...page.map(({ id }) => id));
      nextUri = pagination.nextResourceUri;
      pageCount += 1;
      assert.ok(pageCount <= 7);
    }
    assert.equal(pageCount, 7);
    assert.deepEqual(
      ids,
      evidenceItems.map(({ id }) => id),
    );
    assert.ok(
      calls
        .filter(({ operationId }) => operationId === "run.evidence.get")
        .every(({ input }) => input.limit === 2_000),
    );
  } finally {
    await session.close();
  }
});

test("paginates a Test outline beyond 200 steps and follows its continuation URI", async () => {
  const steps = Array.from({ length: 275 }, (_, index) => ({
    id: `step-${index}`,
    kind: "script",
    intent: `Check ${index}`,
    binding: { status: "resolved", kind: "script" },
  }));
  const session = await connectMcp(
    fixtureInvoker({
      "app-map.get": {
        appMap: { id: "map-1", revision: 3, tests: { huge: { id: "huge", steps } } },
      },
    }),
    "test",
  );
  try {
    const ids: string[] = [];
    let nextUri: string | undefined = "relay://app-maps/map-1/tests/huge/outline";
    let pageCount = 0;
    while (nextUri) {
      const envelope = JSON.parse(
        resourceContent(await session.request("resources/read", { uri: nextUri })).text,
      ) as {
        data: {
          steps: Array<{ id: string }>;
          stepCount: number;
          page: number;
          returnedStepCount: number;
          remainingStepCount: number;
          nextResourceUri?: string;
        };
      };
      assert.ok(envelope.data.steps.length <= 50);
      assert.equal(envelope.data.stepCount, steps.length);
      assert.equal(envelope.data.returnedStepCount, envelope.data.steps.length);
      ids.push(...envelope.data.steps.map(({ id }) => id));
      nextUri = envelope.data.nextResourceUri;
      pageCount += 1;
      assert.ok(pageCount <= 6);
    }
    assert.equal(pageCount, 6);
    assert.deepEqual(
      ids,
      steps.map(({ id }) => id),
    );
  } finally {
    await session.close();
  }
});

test("registers resources only when the selected profile exposes their reads", async () => {
  const control = await connectMcp(fixtureInvoker(), "control");
  try {
    const listed = await control.request("resources/list", {});
    const resources = listed.result?.resources;
    assert.ok(Array.isArray(resources));
    const uris = (resources as Array<{ uri: string }>).map(({ uri }) => uri);
    assert.ok(uris.includes(relayMcpResourceUris.targets));
    assert.ok(!uris.includes(relayMcpResourceUris.appMaps));
    assert.ok(!uris.includes(relayMcpResourceUris.runs));
    assert.ok(!uris.includes(relayMcpResourceUris.authoringSessions));
    const templates = await control.request("resources/templates/list", {});
    const resourceTemplates = templates.result?.resourceTemplates;
    assert.ok(Array.isArray(resourceTemplates));
    const templateUris = (resourceTemplates as Array<{ uriTemplate: string }>).map(
      ({ uriTemplate }) => uriTemplate,
    );
    assert.equal(templateUris.length, 0);
  } finally {
    await control.close();
  }

  const map = await connectMcp(fixtureInvoker(), "map");
  try {
    const listed = await map.request("resources/list", {});
    const resources = listed.result?.resources;
    assert.ok(Array.isArray(resources));
    const uris = (resources as Array<{ uri: string }>).map(({ uri }) => uri);
    assert.ok(uris.includes(relayMcpResourceUris.appMaps));
    assert.ok(!uris.includes(relayMcpResourceUris.runs));
    const templates = await map.request("resources/templates/list", {});
    const resourceTemplates = templates.result?.resourceTemplates;
    assert.ok(Array.isArray(resourceTemplates));
    const templateUris = (resourceTemplates as Array<{ uriTemplate: string }>).map(
      ({ uriTemplate }) => uriTemplate,
    );
    assert.ok(templateUris.includes(relayMcpResourceUris.appMap));
    assert.ok(!templateUris.includes(relayMcpResourceUris.run));
  } finally {
    await map.close();
  }
});

test("keeps a large offline replay causally actionable instead of dropping it at the MCP limit", async () => {
  const hugeReport = {
    report: {
      schemaVersion: 1,
      mode: "offline-evidence-replay",
      runId: "run-1",
      sourceRunStatus: "error",
      planDigest: "a".repeat(64),
      summary: {
        checks: 80,
        proved: 2,
        rootFailures: 1,
        invalidCascades: 77,
        independentFailures: 0,
      },
      firstRootFailure: {
        checkId: "birth-year",
        title: "Visit Birth Year",
        kind: "action-no-op",
        error: "The selector resolved but the screen did not change.",
      },
      cursorTimeline: Array.from({ length: 80 }, (_, index) => ({
        status: "unknown",
        screenId: `screen-${index}`,
        reason: "x".repeat(1_000),
      })),
      checks: Array.from({ length: 80 }, (_, index) => ({
        id: `check-${index}`,
        title: `Check ${index}`,
        recordedStatus: "failed",
        replayStatus: index === 2 ? "root-failure" : "invalid-cascade",
        error: "x".repeat(1_000),
        reason: "x".repeat(1_000),
        selectorAttempts: [{ strategy: "label" }],
        evidence: ["artifact"],
        currentMatcher: {
          status: "resolved",
          comparison: "changed",
          inputDigest: "b".repeat(64),
          selectors: [{ status: "resolved" }],
          evidence: ["failure-tree"],
        },
      })),
      repairProposals: [
        {
          id: "offline:run-1:birth-year:review-current-matcher",
          checkId: "birth-year",
          kind: "review-current-matcher",
          reason: "Review the frozen target before creating any repair.",
          mutation: "none",
          requiresReview: true,
          evidence: ["failure-tree"],
        },
      ],
      blockers: [{ kind: "root-failure", checkIds: ["birth-year"], message: "x".repeat(1_000) }],
    },
  };
  const session = await connectMcp(fixtureInvoker({ "run.replay.offline": hugeReport }));
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: "relay://runs/run-1/offline-replay" }),
    );
    assert.ok(Buffer.byteLength(content.text, "utf8") <= relayMcpResourceByteLimit);
    const envelope = JSON.parse(content.text) as {
      truncated: boolean;
      data: {
        report: {
          evidenceTruncated: boolean;
          summary: { invalidCascades: number };
          firstRootFailure: { checkId: string };
          checks: Array<{
            selectorAttemptCount: number;
            evidenceCount: number;
            currentMatcher: { status: string; comparison: string; selectorCount: number };
          }>;
          repairProposals: Array<{ kind: string; requiresReview: boolean; evidenceCount: number }>;
        };
        resource: { uri: string };
      };
    };
    assert.equal(envelope.truncated, true);
    assert.equal(envelope.data.report.evidenceTruncated, true);
    assert.equal(envelope.data.report.summary.invalidCascades, 77);
    assert.equal(envelope.data.report.firstRootFailure.checkId, "birth-year");
    assert.equal(envelope.data.report.checks[0]?.selectorAttemptCount, 1);
    assert.equal(envelope.data.report.checks[0]?.evidenceCount, 1);
    assert.deepEqual(envelope.data.report.checks[0]?.currentMatcher, {
      status: "resolved",
      comparison: "changed",
      inputDigest: `${"b".repeat(23)}…`,
      selectorCount: 1,
      evidenceCount: 1,
    });
    assert.deepEqual(envelope.data.report.repairProposals, [
      {
        id: "offline:run-1:birth-year:review-current-matcher",
        checkId: "birth-year",
        kind: "review-current-matcher",
        mutation: "none",
        requiresReview: true,
        reason: "Review the frozen target before creating any repair.",
        evidenceCount: 1,
      },
    ]);
    assert.equal(envelope.data.resource.uri, "relay://runs/run-1/offline-replay");
  } finally {
    await session.close();
  }
});

test("reads compact Test lists, details, and stable-ID outlines", async () => {
  const graphTest = {
    id: "smoke",
    name: "Checkout smoke",
    kind: "scenario",
    intentSchemaVersion: 1,
    updatedAt: 200,
    steps: [
      {
        id: "submit",
        kind: "instruction",
        intent: "Submit the order",
        binding: {
          status: "resolved",
          kind: "connections",
          connectionIds: ["submit-order"],
        },
      },
      {
        id: "decision",
        kind: "decision",
        intent: "Check total",
        binding: { status: "unresolved", reason: "Choose an extracted value" },
        thenSteps: [
          {
            id: "check-total",
            kind: "validation",
            intent: "Total is visible",
            binding: { status: "unresolved", reason: "Choose a target" },
          },
        ],
      },
    ],
  };
  const session = await connectMcp(
    fixtureInvoker({
      "app-map.get": {
        appMap: { id: "map-1", revision: 7, tests: { smoke: graphTest } },
      },
    }),
    "test",
  );
  try {
    const list = JSON.parse(
      resourceContent(
        await session.request("resources/read", { uri: "relay://app-maps/map-1/tests" }),
      ).text,
    ) as { data: { appMapRevision: number; tests: Array<{ id: string }> } };
    assert.equal(list.data.appMapRevision, 7);
    assert.deepEqual(
      list.data.tests.map(({ id }) => id),
      ["smoke"],
    );

    const detail = JSON.parse(
      resourceContent(
        await session.request("resources/read", {
          uri: "relay://app-maps/map-1/tests/smoke",
        }),
      ).text,
    ) as { truncated: boolean; data: { test: { id: string } } };
    assert.equal(detail.truncated, false);
    assert.equal(detail.data.test.id, "smoke");

    const outline = JSON.parse(
      resourceContent(
        await session.request("resources/read", {
          uri: "relay://app-maps/map-1/tests/smoke/outline",
        }),
      ).text,
    ) as {
      data: {
        stepCount: number;
        page: number;
        unresolvedCount: number;
        steps: Array<{ id: string; parentStepId?: string; branch: string }>;
      };
    };
    assert.equal(outline.data.stepCount, 3);
    assert.equal(outline.data.page, 0);
    assert.equal(outline.data.unresolvedCount, 2);
    assert.deepEqual(outline.data.steps[2], {
      binding: { reason: "Choose a target", status: "unresolved" },
      branch: "then",
      id: "check-total",
      index: 0,
      intent: "Total is visible",
      kind: "validation",
      parentStepId: "decision",
    });
  } finally {
    await session.close();
  }
});

test("oversized Test details retain a bounded outline instead of null data", async () => {
  const hugeTest = {
    id: "huge",
    name: "Huge Test",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: Array.from({ length: 200 }, (_, index) => ({
      id: `step-${index}`,
      kind: "script",
      intent: `Check ${index} ${"x".repeat(500)}`,
      binding: { status: "resolved", kind: "script", source: "return true" },
    })),
  };
  const session = await connectMcp(
    fixtureInvoker({
      "app-map.get": { appMap: { id: "map-1", revision: 9, tests: { huge: hugeTest } } },
    }),
    "test",
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: "relay://app-maps/map-1/tests/huge",
      }),
    );
    assert.ok(Buffer.byteLength(content.text, "utf8") <= relayMcpResourceByteLimit);
    const envelope = JSON.parse(content.text) as {
      truncated: boolean;
      data: { stepCount: number; returnedStepCount: number; remainingStepCount: number } | null;
    };
    assert.equal(envelope.truncated, true);
    assert.ok(envelope.data);
    assert.equal(envelope.data.stepCount, 200);
    assert.equal(envelope.data.returnedStepCount, 50);
    assert.equal(envelope.data.remainingStepCount, 150);

    const page = JSON.parse(
      resourceContent(
        await session.request("resources/read", {
          uri: "relay://app-maps/map-1/tests/huge/outline/3",
        }),
      ).text,
    ) as { data: { page: number; returnedStepCount: number; remainingStepCount: number } };
    assert.equal(page.data.page, 3);
    assert.equal(page.data.returnedStepCount, 50);
    assert.equal(page.data.remainingStepCount, 0);
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

test("keeps oversized TracePacks addressable with a bounded digest manifest", async () => {
  const digest = `sha256:${"c".repeat(64)}`;
  const tracePack = {
    schemaVersion: 1,
    kind: "relay-trace-pack",
    digest,
    createdAt: 123,
    source: {
      runId: "run-large",
      runSchemaVersion: 5,
      status: "passed",
      action: "test",
      inputDigest: "d".repeat(64),
      writtenAt: 123,
    },
    redaction: { status: "applied-at-persistence", redactedChannels: [] },
    completeness: {
      status: "partial",
      channels: { screenshot: "captured", tree: "missing" },
      missing: ["tree"],
    },
    objects: Array.from({ length: 160 }, (_, index) => ({
      path: `frames/${index}.json`,
      kind: "frame",
      mediaType: "application/json",
      encoding: "json",
      digest: `sha256:${String(index % 10).repeat(64)}`,
      bytes: 2_048,
      content: { payload: "x".repeat(512) },
    })),
  };
  const analysis = {
    schemaVersion: 1,
    mode: "trace-pack-offline-analysis",
    tracePackDigest: digest,
    sourceRunId: "run-large",
    historicalVerdict: "proved",
    futureTransitionVerdict: "unknown",
    proved: [{ code: "pass", statement: "passed", evidence: [digest] }],
    unknown: [{ code: "future", statement: "future is unknown", resolution: "live run" }],
    smallestLiveVerification: { kind: "replay-check", reason: "live", requiresTarget: true },
  };
  const session = await connectMcp(
    fixtureInvoker({ "run.trace-pack.get": { tracePack, analysis } }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: "relay://runs/run-large/trace-pack" }),
    );
    assert.ok(Buffer.byteLength(content.text, "utf8") <= relayMcpResourceByteLimit);
    const envelope = JSON.parse(content.text) as {
      truncated: boolean;
      data: {
        resourceUri: string;
        tracePack: {
          digest: string;
          objectCount: number;
          remainingObjectCount: number;
          objects: Array<{ relativeName: string; bytes: number }>;
          completeness: { status: string; missing: string[] };
          analysis: { historicalVerdict: string; futureTransitionVerdict: string };
        };
      };
    };
    assert.equal(envelope.truncated, true);
    assert.equal(envelope.data.resourceUri, "relay://runs/run-large/trace-pack");
    assert.equal(envelope.data.tracePack.digest, digest);
    assert.equal(envelope.data.tracePack.objectCount, 160);
    assert.equal(envelope.data.tracePack.remainingObjectCount, 60);
    assert.equal(envelope.data.tracePack.objects[0]?.relativeName, "frames/0.json");
    assert.equal(envelope.data.tracePack.objects[0]?.bytes, 2_048);
    assert.deepEqual(envelope.data.tracePack.completeness, {
      status: "partial",
      channelCount: 2,
      missing: ["tree"],
    });
    assert.deepEqual(envelope.data.tracePack.analysis, {
      historicalVerdict: "proved",
      futureTransitionVerdict: "unknown",
      provedCount: 1,
      unknownCount: 1,
      tracePackDigest: digest,
      sourceRunId: "run-large",
    });
    assert.doesNotMatch(content.text, /payload/);
  } finally {
    await session.close();
  }
});

test("reads the typed destination-repair-proposals artifact for one run", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.get": {
        run: {
          id: "run-1",
          status: "product-failure",
          artifacts: [
            {
              kind: "destination-repair-proposals",
              capturedAt: 123,
              data: {
                available: true,
                proposals: [
                  {
                    candidateScreenId: "settings",
                    confidence: 0.92,
                    rationale: "fingerprint matches an alias of the reviewed screen",
                    method: "fingerprint",
                  },
                ],
              },
            },
          ],
        },
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: relayMcpResourceUris.runRepairProposals.replace("{runId}", "run-1"),
      }),
    );
    const envelope = JSON.parse(content.text) as {
      truncated: boolean;
      data: Record<string, unknown>;
    };
    assert.equal(envelope.truncated, false);
    assert.deepEqual(envelope.data, {
      runId: "run-1",
      available: true,
      proposals: [
        {
          candidateScreenId: "settings",
          confidence: 0.92,
          rationale: "fingerprint matches an alias of the reviewed screen",
          method: "fingerprint",
        },
      ],
    });
  } finally {
    await session.close();
  }
});

test("degrades unavailable grounding to an explicit zero-proposal resource", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.get": {
        run: {
          id: "run-1",
          status: "error",
          artifacts: [
            {
              kind: "destination-repair-proposals",
              capturedAt: 123,
              data: { available: false, proposals: [], reason: "grounding-unavailable" },
            },
          ],
        },
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: relayMcpResourceUris.runRepairProposals.replace("{runId}", "run-1"),
      }),
    );
    const envelope = JSON.parse(content.text) as {
      data: { available: boolean; proposals: unknown[]; reason?: string };
    };
    assert.equal(envelope.data.available, false);
    assert.deepEqual(envelope.data.proposals, []);
    assert.equal(envelope.data.reason, "grounding-unavailable");
  } finally {
    await session.close();
  }
});

test("runs without a repair-proposals artifact yield ResourceNotFound", async () => {
  const session = await connectMcp();
  try {
    const response = await session.request("resources/read", {
      uri: relayMcpResourceUris.runRepairProposals.replace("{runId}", "run-1"),
    });
    assert.ok(response.error);
  } finally {
    await session.close();
  }
});

test("run resource dest identity is dest wait-for 003, not leftover Close 004 last-frame", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.get": {
        run: {
          id: "4b93702b",
          status: "ok",
          frames: [
            { path: "frames/003.png", caption: "Observe" },
            { path: "frames/004.png", caption: "after · Run saved Test" },
          ],
          artifacts: [
            {
              kind: "capture-review",
              data: {
                caption: "Observe",
                framePath: "frames/003.png",
                phase: "dest",
                policy: "fast",
                status: "pending",
              },
            },
            {
              kind: "capture-review",
              data: { caption: "Close", framePath: "frames/004.png" },
            },
          ],
        },
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: relayMcpResourceUris.run.replace("{runId}", "4b93702b"),
      }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        run?: {
          destIdentity?: Array<{ relativeName?: string; caption?: string; path?: string }>;
          captureReview?: Array<{ framePath?: string }>;
        };
      };
    };
    assert.deepEqual(envelope.data.run?.destIdentity, [
      { relativeName: "frames/003.png", caption: "Observe" },
    ]);
    assert.equal(
      envelope.data.run?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
    );
    assert.doesNotMatch(content.text, /frames\/004\.png/);
  } finally {
    await session.close();
  }
});

test("runs collection dest identity is dest wait-for 003, not leftover Close 004", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.list": {
        runs: [
          {
            id: "4b93702b",
            action: "observe",
            destIdentity: [
              { path: "frames/003.png", caption: "Observe" },
              { path: "frames/004.png", caption: "Close" },
            ],
            captureReview: [
              {
                captureId: "frames/003.png::observe",
                caption: "Observe",
                status: "pending",
                framePath: "frames/003.png",
                phase: "dest",
                configuration: { account: "Bernardo Ferrari", app: "Grok.com" },
                observed: { laneId: "grok-lab" },
              },
              {
                captureId: "frames/004.png::close-leftover",
                caption: "Close",
                status: "pending",
                framePath: "frames/004.png",
                configuration: { account: "SuperGrok lab signed-in" },
              },
            ],
          },
        ],
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.runs }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        runs?: Array<{
          destIdentity?: Array<{ relativeName?: string; caption?: string }>;
          captureReview?: Array<{
            relativeName?: string;
            framePath?: string;
            configuration?: { account?: string };
            observed?: { laneId?: string };
          }>;
        }>;
      };
    };
    assert.deepEqual(envelope.data.runs?.[0]?.destIdentity, [
      { relativeName: "frames/003.png", caption: "Observe" },
    ]);
    assert.doesNotMatch(content.text, /frames\/004\.png/);
    assert.equal(envelope.data.runs?.[0]?.captureReview?.[0]?.relativeName, "frames/003.png");
    assert.equal(
      envelope.data.runs?.[0]?.captureReview?.[0]?.configuration?.account,
      "Bernardo Ferrari",
    );
    assert.equal(envelope.data.runs?.[0]?.captureReview?.[0]?.observed?.laneId, "grok-lab");
    assert.ok(
      !envelope.data.runs?.[0]?.captureReview?.some(
        (item) => item.relativeName === "frames/004.png" || item.framePath === "frames/004.png",
      ),
    );
  } finally {
    await session.close();
  }
});

test("paged runs collection keeps dest capture-review account and drops leftover Close 004", async () => {
  const stamped = {
    id: "4b93702b",
    action: "observe",
    destIdentity: [
      { path: "frames/003.png", caption: "Observe" },
      { path: "frames/004.png", caption: "Close" },
    ],
    captureReview: [
      {
        captureId: "frames/003.png::observe",
        caption: "Observe",
        status: "pending",
        framePath: "frames/003.png",
        phase: "dest",
        configuration: { account: "Bernardo Ferrari", app: "Grok.com" },
        observed: { laneId: "grok-lab" },
      },
      {
        captureId: "frames/004.png::close-leftover",
        caption: "Close",
        status: "pending",
        framePath: "frames/004.png",
        configuration: { account: "SuperGrok lab signed-in" },
      },
    ],
  };
  // Force the bounded/paged path (projectRunListDestIdentity is skipped when paged).
  const runs = Array.from({ length: 101 }, (_, index) =>
    index === 0 ? stamped : { id: `filler-${index}`, action: "observe", status: "passed" },
  );
  const session = await connectMcp(
    fixtureInvoker({
      "run.list": { runs },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.runs }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        runs?: Array<{
          id?: string;
          destIdentity?: Array<{ relativeName?: string; caption?: string }>;
          captureReview?: Array<{
            relativeName?: string;
            framePath?: string;
            configuration?: { account?: string };
            observed?: { laneId?: string };
          }>;
        }>;
        pagination?: { nextResourceUri?: string };
      };
    };
    assert.ok(envelope.data.pagination?.nextResourceUri);
    const first = envelope.data.runs?.find((run) => run.id === "4b93702b");
    assert.deepEqual(first?.destIdentity, [{ relativeName: "frames/003.png", caption: "Observe" }]);
    assert.doesNotMatch(content.text, /frames\/004\.png/);
    assert.equal(first?.captureReview?.[0]?.relativeName, "frames/003.png");
    assert.equal(first?.captureReview?.[0]?.configuration?.account, "Bernardo Ferrari");
    assert.equal(first?.captureReview?.[0]?.observed?.laneId, "grok-lab");
    assert.ok(
      !first?.captureReview?.some(
        (item) => item.relativeName === "frames/004.png" || item.framePath === "frames/004.png",
      ),
    );
  } finally {
    await session.close();
  }
});

test("runs collection strips SuperGrok fixture display name from dest capture-review account", async () => {
  const labFixture = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";
  const session = await connectMcp(
    fixtureInvoker({
      "run.list": {
        runs: [
          {
            id: "spoofed-supergrok",
            action: "observe",
            destIdentity: [{ path: "frames/003.png", caption: "Observe" }],
            captureReview: [
              {
                captureId: "frames/003.png::observe",
                caption: "Observe",
                status: "pending",
                framePath: "frames/003.png",
                phase: "dest",
                configuration: { account: "SuperGrok lab signed-in", app: "Grok.com" },
                observed: { laneId: "grok-lab" },
              },
            ],
          },
          {
            id: "fixture-account",
            action: "observe",
            destIdentity: [{ path: "frames/003.png", caption: "Observe" }],
            captureReview: [
              {
                captureId: "frames/003.png::observe",
                caption: "Observe",
                status: "pending",
                framePath: "frames/003.png",
                phase: "dest",
                configuration: { account: labFixture, app: "Grok.com" },
                observed: { laneId: "grok-lab" },
              },
            ],
          },
        ],
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.runs }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        runs?: Array<{
          id?: string;
          captureReview?: Array<{
            configuration?: { account?: string; app?: string };
            observed?: { laneId?: string };
          }>;
        }>;
      };
    };
    const spoofed = envelope.data.runs?.find((run) => run.id === "spoofed-supergrok");
    const fixture = envelope.data.runs?.find((run) => run.id === "fixture-account");
    assert.equal(spoofed?.captureReview?.[0]?.configuration?.account, undefined);
    assert.equal(spoofed?.captureReview?.[0]?.configuration?.app, "Grok.com");
    assert.equal(spoofed?.captureReview?.[0]?.observed?.laneId, "grok-lab");
    assert.equal(fixture?.captureReview?.[0]?.configuration?.account, labFixture);
    assert.doesNotMatch(content.text, /SuperGrok lab signed-in/);
  } finally {
    await session.close();
  }
});

test("paged runs collection strips SuperGrok fixture display name from dest capture-review account", async () => {
  const stamped = {
    id: "spoofed-supergrok-paged",
    action: "observe",
    destIdentity: [{ path: "frames/003.png", caption: "Observe" }],
    captureReview: [
      {
        captureId: "frames/003.png::observe",
        caption: "Observe",
        status: "pending",
        framePath: "frames/003.png",
        phase: "dest",
        configuration: { account: "SuperGrok lab signed-in", app: "Grok.com" },
        observed: { laneId: "grok-lab" },
      },
    ],
  };
  const runs = Array.from({ length: 101 }, (_, index) =>
    index === 0 ? stamped : { id: `filler-${index}`, action: "observe", status: "passed" },
  );
  const session = await connectMcp(
    fixtureInvoker({
      "run.list": { runs },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.runs }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        runs?: Array<{
          id?: string;
          captureReview?: Array<{ configuration?: { account?: string; app?: string } }>;
        }>;
        pagination?: { nextResourceUri?: string };
      };
    };
    assert.ok(envelope.data.pagination?.nextResourceUri);
    const first = envelope.data.runs?.find((run) => run.id === "spoofed-supergrok-paged");
    assert.equal(first?.captureReview?.[0]?.configuration?.account, undefined);
    assert.equal(first?.captureReview?.[0]?.configuration?.app, "Grok.com");
    assert.doesNotMatch(content.text, /SuperGrok lab signed-in/);
  } finally {
    await session.close();
  }
});

test("runs collection strips device-observed signed-out from dest capture-review account", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.list": {
        runs: [
          {
            id: "5e2dca45-ece2-46f5-a8b1-cb4de7526338",
            action: "observe",
            destIdentity: [{ path: "frames/003.png", caption: "Observe" }],
            captureReview: [
              {
                captureId: "frames/003.png::observe",
                caption: "Observe",
                status: "pending",
                framePath: "frames/003.png",
                phase: "dest",
                configuration: { account: "signed-out", app: "iPad Pro 10.5" },
                observed: {
                  laneId: "grok-ios-daily",
                  profileId: "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
                },
              },
            ],
          },
          {
            id: "unsigned-browser",
            action: "observe",
            destIdentity: [{ path: "frames/003.png", caption: "Observe" }],
            captureReview: [
              {
                captureId: "frames/003.png::observe",
                caption: "Observe",
                status: "pending",
                framePath: "frames/003.png",
                phase: "dest",
                configuration: { account: "signed-out", app: "Grok.com" },
                observed: {
                  laneId: "grok-daily",
                  profileId: "browser:grok-com-1280x800-339a5a430a41",
                },
              },
            ],
          },
        ],
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", { uri: relayMcpResourceUris.runs }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        runs?: Array<{
          id?: string;
          captureReview?: Array<{
            configuration?: { account?: string; app?: string };
            observed?: { laneId?: string; profileId?: string };
          }>;
        }>;
      };
    };
    const ios = envelope.data.runs?.find((run) => run.id?.startsWith("5e2dca45"));
    const browser = envelope.data.runs?.find((run) => run.id === "unsigned-browser");
    assert.equal(ios?.captureReview?.[0]?.configuration?.account, undefined);
    assert.equal(ios?.captureReview?.[0]?.configuration?.app, "iPad Pro 10.5");
    assert.equal(ios?.captureReview?.[0]?.observed?.laneId, "grok-ios-daily");
    assert.equal(browser?.captureReview?.[0]?.configuration?.account, "signed-out");
  } finally {
    await session.close();
  }
});

test("trace-pack resource pre-listed destIdentity leftover Close 004 cannot fill dest", async () => {
  const destIdentity = [
    { path: "frames/003.png", caption: "Observe" },
    { path: "frames/004.png", caption: "Close" },
  ];
  const session = await connectMcp(
    fixtureInvoker({
      "run.trace-pack.get": {
        destIdentity,
        tracePack: {
          schemaVersion: 1,
          kind: "relay-trace-pack",
          digest: `sha256:${"a".repeat(64)}`,
          createdAt: 123,
          source: {
            runId: "4b93702b",
            runSchemaVersion: 5,
            status: "ok",
            action: "observe",
            inputDigest: "b".repeat(64),
            writtenAt: 123,
          },
          redaction: { status: "applied-at-persistence", redactedChannels: [] },
          completeness: { status: "complete", channels: {}, missing: [], artifacts: [] },
          objects: [
            {
              path: "run.json",
              kind: "frozen-run",
              mediaType: "application/json",
              encoding: "json",
              digest: `sha256:${"a".repeat(64)}`,
              bytes: 2,
              content: { destIdentity },
            },
          ],
        },
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: relayMcpResourceUris.runTracePack.replace("{runId}", "4b93702b"),
      }),
    );
    const envelope = JSON.parse(content.text) as {
      data: { destIdentity?: Array<{ relativeName?: string; caption?: string }> };
    };
    assert.deepEqual(envelope.data.destIdentity, [
      { relativeName: "frames/003.png", caption: "Observe" },
    ]);
    assert.doesNotMatch(content.text, /frames\/004\.png/);
  } finally {
    await session.close();
  }
});

test("run evidence resource dest identity is dest wait-for, not leftover Close 004", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.evidence.get": {
        evidence: {
          runId: "4b93702b",
          schemaVersion: 1,
          logs: [{ id: "log-1", message: "ok" }],
          artifacts: [
            {
              kind: "capture-review",
              data: { framePath: "frames/003.png", phase: "dest" },
            },
          ],
          testStepEvidence: [
            { testStepId: "step-observe", evidence: { framePaths: ["frames/003.png"] } },
            { testStepId: "step-observe", evidence: { framePaths: ["frames/004.png"] } },
          ],
        },
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: relayMcpResourceUris.runEvidence.replace("{runId}", "4b93702b"),
      }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        evidence?: {
          destIdentity?: Array<{ relativeName?: string; path?: string }>;
          testStepEvidence?: Array<{ evidence?: { framePaths?: string[] } }>;
          logs?: Array<{ id?: string }>;
        };
      };
    };
    assert.deepEqual(envelope.data.evidence?.destIdentity, [{ relativeName: "frames/003.png" }]);
    assert.equal(
      envelope.data.evidence?.testStepEvidence?.some((item) =>
        item.evidence?.framePaths?.includes("frames/004.png"),
      ),
      false,
    );
    assert.equal(envelope.data.evidence?.logs?.[0]?.id, "log-1");
  } finally {
    await session.close();
  }
});

test("offline-replay resource dest identity is dest wait-for 003, not leftover Close 004 last-frame", async () => {
  const session = await connectMcp(
    fixtureInvoker({
      "run.replay.offline": {
        report: {
          schemaVersion: 1,
          mode: "offline-evidence-replay",
          runId: "4b93702b",
          frames: [
            { path: "frames/003.png", caption: "Observe" },
            { path: "frames/004.png", caption: "after · Run saved Test" },
          ],
          artifacts: [
            {
              kind: "capture-review",
              data: {
                caption: "Observe",
                framePath: "frames/003.png",
                phase: "dest",
                policy: "fast",
              },
            },
            {
              kind: "capture-review",
              data: { caption: "Close", framePath: "frames/004.png" },
            },
          ],
        },
      },
    }),
  );
  try {
    const content = resourceContent(
      await session.request("resources/read", {
        uri: relayMcpResourceUris.runOfflineReplay.replace("{runId}", "4b93702b"),
      }),
    );
    const envelope = JSON.parse(content.text) as {
      data: {
        destIdentity?: Array<{ relativeName?: string; caption?: string; path?: string }>;
        report?: {
          mode?: string;
          destIdentity?: Array<{ relativeName?: string; path?: string }>;
          captureReview?: Array<{ framePath?: string }>;
        };
      };
    };
    assert.equal(envelope.data.report?.mode, "offline-evidence-replay");
    assert.deepEqual(envelope.data.destIdentity, [
      { relativeName: "frames/003.png", caption: "Observe" },
    ]);
    assert.deepEqual(envelope.data.report?.destIdentity, [
      { relativeName: "frames/003.png", caption: "Observe" },
    ]);
    assert.equal(
      envelope.data.report?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
    );
    assert.doesNotMatch(content.text, /frames\/004\.png/);
  } finally {
    await session.close();
  }
});
