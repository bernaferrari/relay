import { InMemoryTransport } from "@modelcontextprotocol/server";
import { ApiError } from "@relay/client";
import { operationDefinitions, type OperationId } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpServer,
  relayMcpErrorLimit,
  relayMcpInstructions,
  relayMcpInstructionsForProfile,
  relayMcpServerInfo,
  relayMcpTextLimit,
  type OperationInvoker,
} from "./server.js";
import {
  defaultRelayMcpProfile,
  relayMcpTools,
  relayMcpToolsForProfile,
  type RelayMcpProfile,
} from "./tools.js";
import { relayOutcomeTools } from "./outcome-tools.js";
import { relayRegisteredToolNames } from "./registered-tools.js";

type RpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

type ListedTool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

function jsonSchemaHasKey(schema: unknown, key: string, seen = new Set<unknown>()): boolean {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return false;
  seen.add(schema);
  if (Array.isArray(schema)) return schema.some((item) => jsonSchemaHasKey(item, key, seen));
  const rec = schema as Record<string, unknown>;
  const properties = rec.properties;
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    Object.hasOwn(properties, key)
  ) {
    return true;
  }
  return Object.values(rec).some((value) => jsonSchemaHasKey(value, key, seen));
}

function testPatchPropertyKeys(schema: unknown): string[] {
  const walk = (value: unknown, seen = new Set<unknown>()): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, seen);
        if (found) return found;
      }
      return undefined;
    }
    const rec = value as Record<string, unknown>;
    const properties =
      rec.properties && typeof rec.properties === "object" && !Array.isArray(rec.properties)
        ? (rec.properties as Record<string, unknown>)
        : undefined;
    const kindNode =
      properties?.kind && typeof properties.kind === "object" && !Array.isArray(properties.kind)
        ? (properties.kind as { const?: unknown; enum?: unknown[] })
        : undefined;
    const kindConst = kindNode?.const;
    const kindEnum = Array.isArray(kindNode?.enum) ? kindNode.enum : [];
    if (kindConst === "test.patch" || kindEnum.includes("test.patch")) {
      const patch = properties?.patch;
      const patchProps =
        patch && typeof patch === "object" && !Array.isArray(patch)
          ? (patch as { properties?: Record<string, unknown> }).properties
          : undefined;
      if (patchProps) return patchProps;
    }
    for (const nested of Object.values(rec)) {
      const found = walk(nested, seen);
      if (found) return found;
    }
    return undefined;
  };
  return Object.keys(walk(schema) ?? {});
}

type ToolCallResult = {
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function connectMcp(invoker: OperationInvoker, profile: RelayMcpProfile = "full") {
  const server = createMcpServer({ invoker, scope: { projectId: "project-a" }, profile });
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

  const request = async (method: string, params: Record<string, unknown>): Promise<RpcResponse> => {
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
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "relay-mcp-test", version: "0.1.0" },
  });
  assert.equal(initialized.error, undefined);
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  } as never);

  return {
    initialized,
    request,
    async close() {
      await Promise.allSettled([server.close(), clientTransport.close()]);
    },
  };
}

function callResult(response: RpcResponse): ToolCallResult {
  assert.equal(response.error, undefined);
  assert.ok(response.result);
  return response.result as ToolCallResult;
}

test("full-profile SDK initialization lists every generated Relay tool exactly once", async () => {
  const session = await connectMcp({ async invoke() {} });
  try {
    assert.deepEqual(session.initialized.result?.serverInfo, relayMcpServerInfo);
    assert.equal(session.initialized.result?.instructions, relayMcpInstructions);
    const capabilities = session.initialized.result?.capabilities as Record<string, unknown>;
    assert.ok(capabilities.tools);
    assert.ok(capabilities.resources);
    assert.ok(capabilities.prompts);

    const listed = await session.request("tools/list", {});
    assert.equal(listed.error, undefined);
    const tools = listed.result?.tools as ListedTool[];
    const fullTools = relayMcpToolsForProfile("full");
    assert.deepEqual(
      tools.map(({ name }) => name),
      relayRegisteredToolNames("full"),
    );
    assert.equal(new Set(tools.map(({ name }) => name)).size, tools.length);
    // Named qa tools already wrap these; full never lists them twice.
    for (const duplicate of [
      "relay_test_create_from_goal",
      "relay_test_apply_yaml",
      "relay_run_verdict_get",
      "relay_app_map_list",
      "relay_run_list",
      "relay_test_yaml_get",
      "relay_system_doctor_get",
    ]) {
      assert.equal(
        tools.some(({ name }) => name === duplicate),
        false,
        duplicate,
      );
    }
    assert.equal(fullTools.length, relayMcpTools.length - 7);

    for (const descriptor of fullTools) {
      const tool = tools.find(({ name }) => name === descriptor.name);
      assert.ok(tool, descriptor.name);
      assert.equal(tool.title, descriptor.title);
      assert.equal(tool.description, descriptor.description);
      assert.deepEqual(tool.annotations, descriptor.annotations);
      assert.equal(typeof tool.inputSchema.properties, "object");
      assert.equal(
        tool.inputSchema.required?.includes("confirm") ?? false,
        descriptor.requiresConfirmation,
      );
    }
    const screenshot = tools.find(({ name }) => name === "relay_target_screenshot_capture");
    assert.ok(screenshot);
    assert.deepEqual(Object.keys(screenshot.inputSchema.properties ?? {}).sort(), [
      "caption",
      "confirm",
      "ephemeral",
      "jobId",
      "laneId",
      "previewX",
      "previewY",
      "serial",
    ]);
    assert.equal(screenshot.inputSchema.required, undefined);
    const snapshot = tools.find(({ name }) => name === "relay_target_snapshot_capture");
    assert.ok(snapshot);
    assert.deepEqual(Object.keys(snapshot.inputSchema.properties ?? {}).sort(), [
      "confirm",
      "full",
      "interactiveOnly",
      "laneId",
      "serial",
      "visual",
    ]);
    assert.match(snapshot.description ?? "", /digest/i);
    assert.match(snapshot.description ?? "", /full/);
  } finally {
    await session.close();
  }
});

test("tools/list JSON schema for app-map.test.edit includes requirementAction", async () => {
  const session = await connectMcp({ async invoke() {} });
  try {
    const listed = await session.request("tools/list", {});
    assert.equal(listed.error, undefined);
    const tools = listed.result?.tools as ListedTool[];
    const edit = tools.find(({ name }) => name === "relay_app_map_test_edit");
    assert.ok(edit);
    assert.match(edit.description ?? "", /requirementAction/);
    assert.ok(jsonSchemaHasKey(edit.inputSchema, "requirementAction"));
    const patchKeys = testPatchPropertyKeys(edit.inputSchema);
    assert.ok(patchKeys.includes("requirementAction"), JSON.stringify(patchKeys));
    assert.ok(patchKeys.includes("startingState"), JSON.stringify(patchKeys));
    assert.ok(patchKeys.includes("executionQueue"), JSON.stringify(patchKeys));
  } finally {
    await session.close();
  }
});

test("server instructions only name tools registered by the selected profile", async () => {
  for (const profile of ["qa", "device", "full"] as const) {
    const session = await connectMcp({ async invoke() {} }, profile);
    try {
      const instructions = String(session.initialized.result?.instructions);
      assert.equal(instructions, relayMcpInstructionsForProfile(profile));
      const registered = new Set(relayRegisteredToolNames(profile));
      for (const named of instructions.match(/\brelay_[a-z_]+\b/gu) ?? []) {
        if (named === "relay_") continue;
        assert.ok(registered.has(named), `${profile} instructions name ${named}`);
      }
      assert.equal(/relay_prove_change|proof\./u.test(instructions), profile === "full");
      assert.equal(/relay_tap/u.test(instructions), profile !== "qa");
    } finally {
      await session.close();
    }
  }
  assert.match(relayMcpInstructionsForProfile("full"), /bounded.*retry one exhausted publication/i);
});

test("every canonical confirmation contract is surfaced as MCP confirm consent", () => {
  for (const definition of operationDefinitions) {
    if (
      definition.confirmation !== "none" &&
      Object.hasOwn(definition.input.presentation.shape, "confirm") &&
      !Object.hasOwn(definition.input.presentation.shape, "confirmation")
    ) {
      const descriptor = relayMcpTools.find(
        (tool) => (tool.operationId as string) === definition.id,
      );
      assert.ok(descriptor, `${definition.id} must be MCP-eligible`);
      assert.equal(descriptor.requiresConfirmation, true, definition.id);
      assert.ok(
        Object.hasOwn(
          (descriptor.inputSchema as unknown as { shape: Record<string, unknown> }).shape,
          "confirm",
        ),
        `${definition.id} must expose confirm`,
      );
    }
  }
});

test("device profile registers the qa loop plus live control and recording", async () => {
  const calls: Array<{ operationId: OperationId; input: unknown }> = [];
  const session = await connectMcp(
    {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        if (operationId === "target.devices.list") {
          return {
            devices: [
              {
                id: "pixel-9",
                serial: "pixel-9",
                name: "Pixel 9",
                kind: "emulator",
                booted: true,
                platform: "android",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          };
        }
        throw new Error(`unexpected ${operationId}`);
      },
    },
    "device",
  );
  try {
    const listed = await session.request("tools/list", {});
    const names: string[] = ((listed.result?.tools as ListedTool[] | undefined) ?? []).map(
      ({ name }) => name,
    );
    const nameSet = new Set<string>(names);
    assert.deepEqual(names, relayRegisteredToolNames("device"));
    assert.equal(nameSet.has("relay_lease_create"), false);
    assert.equal(nameSet.has("relay_app_map_test_run"), false);
    for (const name of [
      "relay_observe_target",
      "relay_record_test",
      "relay_record_action",
      "relay_add_checkpoint",
      "relay_stop_recording",
      "relay_replay_recording",
      "relay_approve_recording",
      "relay_run_test",
      "relay_repeat_test",
      "relay_continue_repeat",
      "relay_export_evidence",
      "relay_tap",
      "relay_panel",
    ]) {
      assert.ok(nameSet.has(name), `device profile is missing ${name}`);
    }
    assert.equal(nameSet.has("relay_prove_change"), false);
    assert.equal(nameSet.has("relay_proof_analyze"), false);
    assert.equal(nameSet.has("relay_debug_bug"), false);
    assert.equal(names.length, nameSet.size, "no tool is registered twice");
    const approve = ((listed.result?.tools as ListedTool[] | undefined) ?? []).find(
      ({ name }) => name === "relay_approve_recording",
    );
    assert.deepEqual(approve?.inputSchema.required?.sort(), [
      "confirm",
      "expectedVersion",
      "workflowId",
    ]);

    const connected = callResult(
      await session.request("tools/call", {
        name: "relay_list_devices",
        arguments: {},
      }),
    );
    assert.deepEqual(connected.structuredContent?.result, {
      targets: [{ kind: "device", platform: "android", targetId: "pixel-9" }],
      current: { kind: "device", platform: "android", targetId: "pixel-9" },
    });
    assert.deepEqual(calls, [{ operationId: "target.devices.list", input: {} }]);
  } finally {
    await session.close();
  }
});

test("outcome observation returns native pixels and bounded structured semantics", async () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const calls: Array<{ operationId: OperationId; input: Record<string, unknown> }> = [];
  const session = await connectMcp(
    {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        if (operationId === "target.devices.list") {
          return {
            devices: [
              {
                id: "pixel-9",
                serial: "pixel-9",
                name: "Pixel 9",
                kind: "emulator",
                booted: true,
                platform: "android",
              },
            ],
          };
        }
        if (operationId === "target.observation.capture") {
          const imageDigest = "a".repeat(64);
          const semanticsDigest = "b".repeat(64);
          const artifact = (sha256: string, kind: "image" | "structured-data", mime: string) => ({
            status: "available",
            artifact: {
              schemaVersion: 1,
              id: `sha256:${sha256}`,
              integrity: {
                algorithm: "sha256",
                sha256,
                bytes: Buffer.from(png, "base64").byteLength,
              },
              media: { kind, mime },
              capturedAt: 10,
              provenance: { source: "authoring-evidence", capture: "recorded" },
              retention: {
                scope: "workspace-content-addressed",
                recoverability: "content-addressed",
              },
              locations: [
                { store: "authoring-evidence", opaque: `evidence-${sha256.slice(0, 8)}` },
              ],
            },
          });
          return {
            schemaVersion: 1,
            target: { kind: "device", platform: "android", targetId: "pixel-9" },
            capturedAt: 11,
            pixels: {
              status: "captured",
              capturedAt: 10,
              mime: "image/png",
              bytes: Buffer.from(png, "base64").byteLength,
              artifact: artifact(imageDigest, "image", "image/png"),
              presentationBase64: png,
              width: 1,
              height: 1,
              fingerprint: "visual-1",
            },
            semantics: {
              status: "current",
              capturedAt: 11,
              artifact: artifact(semanticsDigest, "structured-data", "application/json"),
              source: "android-system",
              fingerprint: "semantic-1",
              nodeCount: 1,
              controls: [{ label: "Settings", role: "button" }],
            },
            screenCandidate: { fingerprint: "visual-1", confidence: "observed" },
          };
        }
        throw new Error(`unexpected ${operationId}`);
      },
    },
    "device",
  );
  try {
    const observed = callResult(
      await session.request("tools/call", {
        name: "relay_observe_target",
        arguments: {},
      }),
    );
    assert.equal(observed.isError, undefined);
    assert.equal(observed.content[1]?.type, "image");
    assert.equal(observed.content[1]?.data, png);
    const structured = observed.structuredContent?.result as Record<string, unknown>;
    const pixels = structured.pixels as Record<string, unknown>;
    assert.equal(pixels.status, "captured");
    assert.equal("base64" in pixels, false);
    assert.equal("presentationBase64" in pixels, false);
    assert.equal((pixels.artifact as Record<string, unknown>).status, "available");
    assert.doesNotMatch(JSON.stringify(structured), /private\/temporary|capture\.png/u);
    assert.deepEqual(calls, [
      { operationId: "target.devices.list", input: {} },
      {
        operationId: "target.observation.capture",
        input: { serial: "pixel-9" },
      },
    ]);
  } finally {
    await session.close();
  }
});

test("outcome errors hand off canonical recovery operations outside the public façade", async () => {
  const session = await connectMcp(
    {
      async invoke() {
        throw new ApiError(503, "Apple device communication stalled", {
          code: "target_unavailable",
          recovery: { action: "retry-later", retryable: true },
          recoveryAction: {
            operationId: "target.recover",
            input: { serial: "ipad-1", reason: "observe" },
          },
        });
      },
    },
    "qa",
  );
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_list_devices",
        arguments: {},
      }),
    );
    assert.equal(result.isError, true);
    const error = result.structuredContent?.error as Record<string, unknown>;
    assert.equal(error.recoveryAction, undefined);
    assert.match(String(error.recoveryGuidance), /target\.recover/u);
    assert.match(String(error.recoveryGuidance), /selected MCP profile "qa"/u);
  } finally {
    await session.close();
  }
});

test("snapshot capture returns a digest unless full is requested", async () => {
  const snapshot = {
    serial: "ipad-1",
    bounds: { width: 834, height: 1112 },
    inspectable: true,
    interactive: [],
    tree: "Button · Ask",
    screenIdentity: { fingerprint: "abcdef0123456789deadbeef" },
    nodes: [
      {
        type: "Button",
        identifier: "navigation.tab.ask",
        label: "Ask",
        hittable: false,
        rect: { x: 331, y: 22, width: 44, height: 38 },
      },
    ],
  };
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return snapshot;
    },
  });
  try {
    const digest = callResult(
      await session.request("tools/call", {
        name: "relay_target_snapshot_capture",
        arguments: { serial: "ipad-1" },
      }),
    );
    const digestResult = digest.structuredContent?.result as {
      nodes?: unknown;
      nodeCount?: number;
    };
    assert.equal(digestResult.nodes, undefined);
    assert.equal(digestResult.nodeCount, 1);

    const full = callResult(
      await session.request("tools/call", {
        name: "relay_target_snapshot_capture",
        arguments: { serial: "ipad-1", full: true },
      }),
    );
    const fullResult = full.structuredContent?.result as { nodes?: unknown[]; nodeCount?: number };
    assert.deepEqual(fullResult.nodes, snapshot.nodes);
    assert.equal(fullResult.nodeCount, undefined);
    assert.deepEqual(calls, [
      { operationId: "target.snapshot.capture", input: { serial: "ipad-1" } },
      { operationId: "target.snapshot.capture", input: { serial: "ipad-1", full: true } },
    ]);
  } finally {
    await session.close();
  }
});

test("app-map.get list returns only that catalog and does not send list to the server", async () => {
  const appMap = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "local",
    projectId: "project-1",
    name: "Grok",
    revision: 4,
    notes: {},
    groups: {},
    screens: {
      home: {
        organizationId: "local",
        projectId: "project-1",
        appMapId: "map-1",
        id: "home",
        title: "Home",
        variantIds: [],
        createdAt: 1,
        updatedAt: 2,
      },
    },
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {
      language: {
        organizationId: "local",
        projectId: "project-1",
        appMapId: "map-1",
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "ai.x.grok" },
        options: [{ id: "en-US", label: "English" }],
        createdAt: 1,
        updatedAt: 2,
      },
    },
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 2,
  };
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return { appMap };
    },
  });
  try {
    const listed = callResult(
      await session.request("tools/call", {
        name: "relay_app_map_get",
        arguments: { appMapId: "map-1", list: "variables" },
      }),
    );
    const listedResult = listed.structuredContent?.result as Record<string, unknown>;
    assert.equal("screens" in listedResult, false);
    assert.ok(Array.isArray(listedResult.variables));
    assert.deepEqual(calls, [{ operationId: "app-map.get", input: { appMapId: "map-1" } }]);

    const full = callResult(
      await session.request("tools/call", {
        name: "relay_app_map_get",
        arguments: { appMapId: "map-1" },
      }),
    );
    const fullResult = full.structuredContent?.result as {
      appMap?: { screens?: unknown[] };
    };
    assert.ok(Array.isArray(fullResult.appMap?.screens));
  } finally {
    await session.close();
  }
});

test("invokes representative read, write, and confirmed operations with exact input", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const signals: AbortSignal[] = [];
  const results: Record<string, Record<string, unknown>> = {
    "system.health.get": { status: "ok" },
    "target.create": { targetId: "target-1" },
    "workspace.evidence.update": { updated: true },
  };
  const invoker: OperationInvoker = {
    async invoke(operationId, input, options) {
      calls.push({ operationId, input });
      assert.ok(options?.signal);
      signals.push(options.signal);
      return results[operationId];
    },
  };
  const session = await connectMcp(invoker);
  const readInput = {};
  const writeInput = { name: "Web app", startUrl: "https://example.test" };
  const confirmedInput = { channel: "audio", enabled: true, reason: "test run" };
  try {
    const read = callResult(
      await session.request("tools/call", {
        name: "relay_system_health_get",
        arguments: readInput,
      }),
    );
    const write = callResult(
      await session.request("tools/call", {
        name: "relay_target_create",
        arguments: writeInput,
      }),
    );
    const confirmed = callResult(
      await session.request("tools/call", {
        name: "relay_workspace_evidence_update",
        arguments: { ...confirmedInput, confirm: true },
      }),
    );

    assert.deepEqual(calls, [
      { operationId: "system.health.get", input: readInput },
      { operationId: "target.create", input: writeInput },
      { operationId: "workspace.evidence.update", input: confirmedInput },
    ]);
    assert.equal(signals.length, 3);
    assert.equal(
      signals.every((signal) => signal instanceof AbortSignal),
      true,
    );
    assert.deepEqual(read.content, [{ type: "text", text: '{"status":"ok"}' }]);
    assert.deepEqual(read.structuredContent, { result: results["system.health.get"] });
    assert.deepEqual(write.structuredContent, { result: results["target.create"] });
    assert.deepEqual(confirmed.structuredContent, {
      result: results["workspace.evidence.update"],
    });
  } finally {
    await session.close();
  }
});

test("forwards one frozen Test evidence scope without accepting unknown controls", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return {};
    },
  });
  const compileInput = {
    appMapId: "checkout",
    testId: "smoke",
    targetProfileId: "ipad-pt-BR",
  };
  const runInput = {
    ...compileInput,
    expectedRevision: 7,
    target: { kind: "device" as const, platform: "ios" as const, targetId: "ipad-1" },
    surfaceCapture: { forceRecaptureScreenIds: ["voice-library"] },
  };
  try {
    assert.equal(
      callResult(
        await session.request("tools/call", {
          name: "relay_app_map_test_compile",
          arguments: compileInput,
        }),
      ).isError,
      undefined,
    );
    assert.equal(
      callResult(
        await session.request("tools/call", {
          name: "relay_app_map_test_run",
          arguments: runInput,
        }),
      ).isError,
      undefined,
    );
    const rejected = callResult(
      await session.request("tools/call", {
        name: "relay_app_map_test_run",
        arguments: { ...runInput, ignoredProfileControl: true },
      }),
    );
    assert.equal(rejected.isError, true);
    assert.deepEqual(calls, [
      { operationId: "app-map.test.compile", input: compileInput },
      { operationId: "app-map.test.run", input: runInput },
    ]);
  } finally {
    await session.close();
  }
});

test("surfaces a standalone iOS step as terminal review-needed without a second action", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return {
        ok: false,
        terminal: "review-needed",
        error: "The iOS press may already have reached the device.",
        durationMs: 12,
        logs: ["native command issued once"],
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        iosMutation: {
          sequence: 1,
          operation: "press",
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
        stepReview: {
          captureCurrent: {
            operationId: "target.screenshot.capture",
            input: { serial: "ipad-1" },
          },
        },
      };
    },
  });
  const input = { serial: "ipad-1", step: { kind: "sleep", ms: 1 } };
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_step_run",
        arguments: input,
      }),
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [{ operationId: "step.run", input }]);
    assert.deepEqual(result.structuredContent, {
      result: {
        ok: false,
        terminal: "review-needed",
        error: "The iOS press may already have reached the device.",
        durationMs: 12,
        logs: ["native command issued once"],
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        iosMutation: {
          sequence: 1,
          operation: "press",
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
        stepReview: {
          captureCurrent: {
            operationId: "target.screenshot.capture",
            input: { serial: "ipad-1" },
          },
        },
      },
    });
  } finally {
    await session.close();
  }
});

test("publishes operation-shaped schemas and rejects invalid arguments before invocation", async () => {
  const calls: string[] = [];
  const session = await connectMcp({
    async invoke(operationId) {
      calls.push(operationId);
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_screenshot_capture",
        arguments: {},
      }),
    );
    assert.equal(result.isError, true);
    assert.match(String(result.content[0]?.text), /serial/i);
    assert.deepEqual(calls, []);
  } finally {
    await session.close();
  }
});

test("rejects wrapped input so agents use the one advertised operation schema", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return { lease: { id: "lease-1" } };
    },
  });
  const wrappedInput = {
    poolId: "pool-1",
    deviceSerial: "device-1",
    expiresAt: Date.now() + 60_000,
  };
  try {
    const listed = await session.request("tools/list", {});
    const leaseTool = ((listed.result?.tools as ListedTool[] | undefined) ?? []).find(
      ({ name }) => name === "relay_lease_create",
    );
    assert.ok(leaseTool);
    assert.deepEqual(Object.keys(leaseTool.inputSchema.properties ?? {}).sort(), [
      "confirm",
      "deviceSerial",
      "expiresAt",
      "poolId",
    ]);
    assert.equal("input" in (leaseTool.inputSchema.properties ?? {}), false);

    const result = callResult(
      await session.request("tools/call", {
        name: "relay_lease_create",
        arguments: { input: wrappedInput, confirm: true },
      }),
    );

    assert.equal(result.isError, true);
    assert.deepEqual(calls, []);
  } finally {
    await session.close();
  }
});

test("requires literal confirmation for confirmation-protected operations", async () => {
  const calls: string[] = [];
  const session = await connectMcp({
    async invoke(operationId) {
      calls.push(operationId);
    },
  });
  const input = { channel: "audio", enabled: true };
  try {
    for (const argumentsValue of [input, { ...input, confirm: false }]) {
      const result = callResult(
        await session.request("tools/call", {
          name: "relay_workspace_evidence_update",
          arguments: argumentsValue,
        }),
      );
      assert.equal(result.isError, true);
      assert.match(String(result.content[0]?.text), /confirm/i);
    }
    assert.deepEqual(calls, []);
  } finally {
    await session.close();
  }
});

test("preserves confirmed lease takeover consent for the canonical protocol operation", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp({
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return { lease: { id: "lease-2" } };
    },
  });
  const input = {
    leaseId: "lease-1",
    expiresAt: Date.now() + 60_000,
    reason: "User approved the control handoff",
  };
  try {
    const unconfirmed = callResult(
      await session.request("tools/call", {
        name: "relay_lease_takeover",
        arguments: input,
      }),
    );
    assert.equal(unconfirmed.isError, true);
    assert.match(String(unconfirmed.content[0]?.text), /confirm/i);
    assert.deepEqual(calls, []);

    const confirmed = callResult(
      await session.request("tools/call", {
        name: "relay_lease_takeover",
        arguments: { ...input, confirm: true },
      }),
    );
    assert.notEqual(confirmed.isError, true, JSON.stringify(confirmed.content));
    assert.deepEqual(calls, [
      {
        operationId: "lease.takeover",
        input: { ...input, confirm: true },
      },
    ]);
  } finally {
    await session.close();
  }
});

test("preserves confirmed Proof lifecycle consent for canonical protocol operations", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp(
    {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        return {};
      },
    },
    "full",
  );
  try {
    const approve = callResult(
      await session.request("tools/call", {
        name: "relay_proof_plan_approve",
        arguments: {
          proofId: "proof-1",
          expectedVersion: 1,
          decisionId: "decision-1",
          reason: "Human reviewer approved the frozen plan.",
          confirm: true,
        },
      }),
    );
    const cancel = callResult(
      await session.request("tools/call", {
        name: "relay_proof_cancel",
        arguments: {
          proofId: "proof-1",
          expectedVersion: 1,
          reason: "Human reviewer requested cancellation.",
          confirm: true,
        },
      }),
    );
    const retryPublication = callResult(
      await session.request("tools/call", {
        name: "relay_proof_publication_retry",
        arguments: {
          proofId: "proof-1",
          publicationId: "publication-1",
          expectedProofVersion: 1,
          reason: "Provider connectivity is restored.",
          confirm: true,
        },
      }),
    );
    assert.notEqual(approve.isError, true, JSON.stringify(approve.content));
    assert.notEqual(cancel.isError, true, JSON.stringify(cancel.content));
    assert.notEqual(retryPublication.isError, true, JSON.stringify(retryPublication.content));
    assert.deepEqual(calls, [
      {
        operationId: "proof.plan.approve",
        input: {
          proofId: "proof-1",
          expectedVersion: 1,
          decisionId: "decision-1",
          reason: "Human reviewer approved the frozen plan.",
          confirm: true,
        },
      },
      {
        operationId: "proof.cancel",
        input: {
          proofId: "proof-1",
          expectedVersion: 1,
          reason: "Human reviewer requested cancellation.",
          confirm: true,
        },
      },
      {
        operationId: "proof.publication.retry",
        input: {
          proofId: "proof-1",
          publicationId: "publication-1",
          expectedProofVersion: 1,
          reason: "Provider connectivity is restored.",
          confirm: true,
        },
      },
    ]);
  } finally {
    await session.close();
  }
});

test("preserves confirmed guarded Proof execution consent for canonical operations", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp(
    {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        return {};
      },
    },
    "full",
  );
  const previewDigest = `sha256:${"a".repeat(64)}`;
  const evidenceDigest = `sha256:${"b".repeat(64)}`;
  const receiptInput = {
    proofId: "proof-1",
    expectedVersion: 2,
    cellId: "cell-1",
    previewDigest,
  };
  const evidenceInput = {
    proofId: "proof-1",
    executionId: "execution-1",
    cellId: "cell-1",
    stepId: "step-1",
    evidenceDigest,
  };
  try {
    for (const [name, input] of [
      ["relay_proof_run_confirm", receiptInput],
      ["relay_proof_run_human_evidence", evidenceInput],
    ] as const) {
      const unconfirmed = callResult(
        await session.request("tools/call", { name, arguments: input }),
      );
      assert.equal(unconfirmed.isError, true);
      assert.match(String(unconfirmed.content[0]?.text), /confirm/i);
    }
    assert.deepEqual(calls, []);

    const confirmedReceipt = callResult(
      await session.request("tools/call", {
        name: "relay_proof_run_confirm",
        arguments: { ...receiptInput, confirm: true },
      }),
    );
    const confirmedEvidence = callResult(
      await session.request("tools/call", {
        name: "relay_proof_run_human_evidence",
        arguments: { ...evidenceInput, confirm: true },
      }),
    );
    assert.notEqual(confirmedReceipt.isError, true, JSON.stringify(confirmedReceipt.content));
    assert.notEqual(confirmedEvidence.isError, true, JSON.stringify(confirmedEvidence.content));
    assert.deepEqual(calls, [
      {
        operationId: "proof.run.confirm",
        input: { ...receiptInput, confirm: true },
      },
      {
        operationId: "proof.run.human-evidence",
        input: { ...evidenceInput, confirm: true },
      },
    ]);
  } finally {
    await session.close();
  }
});

test("preserves confirmed browser authentication consent for canonical operations", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp(
    {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        return {};
      },
    },
    "full",
  );
  try {
    const save = callResult(
      await session.request("tools/call", {
        name: "relay_target_browser_auth_save",
        arguments: { targetId: "web", name: "Signed-in account", confirm: true },
      }),
    );
    const reference = "authfx:123e4567-e89b-42d3-a456-426614174000:2";
    const revoke = callResult(
      await session.request("tools/call", {
        name: "relay_target_browser_auth_revoke",
        arguments: { targetId: "web", reference, confirm: true },
      }),
    );
    assert.notEqual(save.isError, true, JSON.stringify(save.content));
    assert.notEqual(revoke.isError, true, JSON.stringify(revoke.content));
    assert.deepEqual(calls, [
      {
        operationId: "target.browser-auth.save",
        input: { targetId: "web", name: "Signed-in account", confirm: true },
      },
      {
        operationId: "target.browser-auth.revoke",
        input: { targetId: "web", reference, confirm: true },
      },
    ]);
  } finally {
    await session.close();
  }
});

test("translates confirmed reviewed-origin MCP consent into the signed protocol confirmation", async () => {
  const calls: Array<{ operationId: string; input: Record<string, unknown> }> = [];
  const session = await connectMcp(
    {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        // The test only verifies the authority boundary; an incomplete result
        // is intentionally allowed to fail the later presentation summary.
        return {};
      },
    },
    "full",
  );
  try {
    await session.request("tools/call", {
      name: "relay_app_map_scroll_surface_origin_review",
      arguments: {
        appMapId: "map-1",
        screenId: "settings",
        variantId: "settings-en",
        captureId: "capture-1",
        expectedRevision: 7,
        reason: "Reviewed immutable first viewport.",
        assertion: "reviewed-document-top",
        confirm: true,
      },
    });
    assert.deepEqual(calls, [
      {
        operationId: "app-map.scroll-surface.origin.review",
        input: {
          appMapId: "map-1",
          screenId: "settings",
          variantId: "settings-en",
          captureId: "capture-1",
          expectedRevision: 7,
          reason: "Reviewed immutable first viewport.",
          assertion: "reviewed-document-top",
          confirmation: "confirm",
        },
      },
    ]);
  } finally {
    await session.close();
  }
});

test("profile selection exposes three nested tool sets", async () => {
  for (const profile of ["qa", "device", "full"] as const) {
    const session = await connectMcp({ async invoke() {} }, profile);
    try {
      const listed = await session.request("tools/list", {});
      assert.equal(listed.error, undefined);
      const tools = (listed.result?.tools as ListedTool[] | undefined) ?? [];
      const names = tools.map(({ name }) => name);
      assert.deepEqual(names, relayRegisteredToolNames(profile));
      assert.equal(new Set(names).size, names.length);
      for (const tool of tools) {
        if (/^relay_(?:list|get|inspect)_/u.test(tool.name)) {
          assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
        }
      }
      if (profile !== "qa") {
        const cancel = tools.find(({ name }) => name === "relay_cancel_run");
        assert.equal(cancel?.annotations?.destructiveHint, true);
      }
    } finally {
      await session.close();
    }
  }
  assert.deepEqual(relayMcpToolsForProfile(defaultRelayMcpProfile), []);
  assert.ok(relayOutcomeTools.length < relayMcpTools.length / 2);
});

test("returns sanitized structured ApiError recovery without losing revision state", async () => {
  const session = await connectMcp({
    async invoke() {
      throw new ApiError(409, "Revision conflict", {
        code: "revision_conflict",
        error: "Refresh after /Users/example/private/map.json with Bearer private-credential",
        current: { revision: 17, privateState: "not-public" },
        recovery: { action: "refresh-and-retry", retryable: true },
        recoveryAction: {
          operationId: "lease.takeover",
          input: { leaseId: "lease-1" },
          cli: { argv: ["lease", "takeover", "lease-1"] },
        },
      });
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_list",
        arguments: {},
      }),
    );
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      error: {
        operationId: "target.list",
        status: 409,
        code: "revision_conflict",
        message: "Refresh after [local path redacted] with Bearer [redacted]",
        recovery: { action: "refresh-and-retry", retryable: true },
        currentRevision: 17,
        recoveryAction: {
          operationId: "lease.takeover",
          input: { leaseId: "lease-1" },
          cli: { argv: ["lease", "takeover", "lease-1"] },
        },
      },
    });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /private-credential|privateState|Users\/example/);
  } finally {
    await session.close();
  }
});

test("does not emit a hidden recovery command from a least-privilege profile", async () => {
  const session = await connectMcp(
    {
      async invoke() {
        throw new ApiError(403, "This target is currently controlled by another actor", {
          code: "TARGET_CONTROL_LEASE_CONFLICT",
          recovery: { action: "request-access", retryable: false },
          recoveryAction: {
            operationId: "lease.takeover",
            input: { leaseId: "lease-1" },
            cli: { argv: ["lease", "takeover", "lease-1"] },
          },
        });
      },
    },
    "device",
  );
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_tap",
        arguments: { targetId: "ipad-1", label: "Settings" },
      }),
    );
    assert.equal(result.isError, true);
    const error = result.structuredContent?.error as Record<string, unknown>;
    assert.equal(error.recoveryAction, undefined);
    assert.match(String(error.recoveryGuidance), /lease\.takeover/u);
    assert.match(String(error.recoveryGuidance), /selected MCP profile "device"/u);
  } finally {
    await session.close();
  }
});

test("fails closed for a malformed iOS terminal payload while retaining valid review evidence", async () => {
  const iosMutation = { operation: "press", outcome: "outcome-unknown" };
  const session = await connectMcp({
    async invoke() {
      throw new ApiError(409, "Refresh and retry", {
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        error: "Refresh and retry the tap.",
        iosMutation,
        recovery: { action: "refresh-and-retry", retryable: true },
        recoveryAction: {
          operationId: "target.interact",
          input: { serial: "ipad-1", kind: "label", label: "Settings" },
        },
      });
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_interact",
        arguments: { serial: "ipad-1", kind: "label", label: "Settings" },
      }),
    );
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      error: {
        operationId: "target.interact",
        status: 409,
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        message:
          "Review needed: Relay cannot confirm whether the iOS command reached the device. Capture the current screen before any explicit retry or repair.",
        terminal: "review-needed",
        recovery: { action: "none", retryable: false },
        iosReview: { iosMutation },
      },
    });
  } finally {
    await session.close();
  }
});

test("large Authoring Sessions point MCP callers at their full offline resource", async () => {
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "authoring.session.get");
      return {
        session: {
          schemaVersion: 1,
          id: "session-large",
          organizationId: "local",
          projectId: "project-a",
          actorId: "agent:relay",
          actorKind: "agent",
          appMapId: "map-a",
          state: "reviewing",
          target: { kind: "device", platform: "android", targetId: "device-a" },
          leaseId: "lease-a",
          expectedAppMapRevision: 1,
          createdAt: 1,
          updatedAt: 2,
          immutableCapture: "x".repeat(relayMcpTextLimit * 2),
        },
      };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_authoring_session_get",
        arguments: { sessionId: "session-large" },
      }),
    );
    assert.equal(result.isError, undefined);
    const compact = result.structuredContent?.result as Record<string, unknown>;
    assert.deepEqual(compact, {
      truncated: true,
      resourceUri: "relay://authoring-sessions/session-large",
      message: "Read resourceUri for the complete Authoring Session and immutable evidence links.",
      session: {
        id: "session-large",
        appMapId: "map-a",
        state: "reviewing",
        target: { kind: "device", platform: "android", targetId: "device-a" },
      },
    });
    assert.ok(String(result.content[0]?.text).length <= relayMcpTextLimit);
    assert.doesNotMatch(String(result.content[0]?.text), /immutableCapture/);
  } finally {
    await session.close();
  }
});

test("large evidence exports return a stable TracePack resource and bounded manifest", async () => {
  const digest = `sha256:${"e".repeat(64)}`;
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
      inputDigest: "f".repeat(64),
      writtenAt: 123,
    },
    redaction: { status: "applied-at-persistence", redactedChannels: [] },
    completeness: { status: "complete", channels: {}, missing: [] },
    objects: Array.from({ length: 24 }, (_, index) => ({
      path: `frames/${index}.json`,
      kind: "frame",
      mediaType: "application/json",
      encoding: "json",
      digest: `sha256:${String(index % 10).repeat(64)}`,
      bytes: 2_048,
      content: { payload: "x".repeat(600) },
    })),
  };
  const analysis = {
    schemaVersion: 1,
    mode: "trace-pack-offline-analysis",
    tracePackDigest: digest,
    sourceRunId: "run-large",
    historicalVerdict: "proved",
    futureTransitionVerdict: "unknown",
    proved: [],
    unknown: [{ code: "future", statement: "future is unknown", resolution: "live run" }],
    smallestLiveVerification: { kind: "replay-check", reason: "live", requiresTarget: true },
  };
  const session = await connectMcp(
    {
      async invoke(operationId) {
        assert.equal(operationId, "run.trace-pack.get");
        return { tracePack, analysis };
      },
    },
    "device",
  );
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_export_evidence",
        arguments: { runId: "run-large" },
      }),
    );
    assert.equal(result.isError, undefined);
    assert.ok(String(result.content[0]?.text).length <= relayMcpTextLimit);
    const compact = result.structuredContent?.result as {
      truncated: boolean;
      resourceUri: string;
      message: string;
      tracePack: {
        digest: string;
        createdAt: number;
        serializedBytes: number;
        objectCount: number;
        objectBytes: number;
        objects: Array<{ relativeName: string; bytes: number; content?: unknown }>;
        source: { runId: string; status: string; action: string };
        completeness: { status: string; channelCount: number; missing: string[] };
        analysis: {
          historicalVerdict: string;
          futureTransitionVerdict: string;
          provedCount: number;
          unknownCount: number;
          tracePackDigest: string;
          sourceRunId: string;
        };
      };
    };
    assert.equal(compact.truncated, true);
    assert.equal(compact.resourceUri, "relay://runs/run-large/trace-pack");
    assert.match(compact.message, /scoped artifact response/u);
    assert.match(compact.message, /complete sanitized pack when bounded/u);
    assert.equal(compact.tracePack.digest, digest);
    assert.equal(compact.tracePack.createdAt, 123);
    assert.ok(compact.tracePack.serializedBytes > relayMcpTextLimit);
    assert.equal(compact.tracePack.objectCount, 24);
    assert.equal(compact.tracePack.objectBytes, 49_152);
    assert.equal(compact.tracePack.objects.length, 24);
    assert.equal(compact.tracePack.objects[0]?.relativeName, "frames/0.json");
    assert.equal(compact.tracePack.objects[0]?.bytes, 2_048);
    assert.equal("content" in (compact.tracePack.objects[0] ?? {}), false);
    assert.deepEqual(compact.tracePack.source, {
      runId: "run-large",
      status: "passed",
      action: "test",
    });
    assert.deepEqual(compact.tracePack.completeness, {
      status: "complete",
      channelCount: 0,
      missing: [],
    });
    assert.deepEqual(compact.tracePack.analysis, {
      historicalVerdict: "proved",
      futureTransitionVerdict: "unknown",
      provedCount: 0,
      unknownCount: 1,
      tracePackDigest: digest,
      sourceRunId: "run-large",
    });
  } finally {
    await session.close();
  }
});

test("bounds normal text and errors without exposing truncated paths or credentials", async () => {
  const path = "/Users/example/private/results/secret.json";
  const credential = "super-secret-bearer-token";
  const session = await connectMcp({
    async invoke(operationId) {
      if (operationId === "system.doctor.get") {
        return { path, payload: "x".repeat(relayMcpTextLimit * 2) };
      }
      throw new Error(`Authorization: Bearer ${credential} at ${path} ${"x".repeat(2_000)}`);
    },
  });
  try {
    const success = callResult(
      await session.request("tools/call", {
        name: "relay_health",
        arguments: {},
      }),
    );
    const text = String(success.content[0]?.text);
    assert.ok(text.length <= relayMcpTextLimit);
    assert.deepEqual(JSON.parse(text), {
      truncated: true,
      serializedCharacters: JSON.stringify({
        path,
        payload: "x".repeat(relayMcpTextLimit * 2),
      }).length,
      message: "Relay result omitted from text because it exceeds the MCP text limit.",
    });
    assert.doesNotMatch(text, /Users\/example|secret\.json/);
    assert.deepEqual(success.structuredContent, {
      result: JSON.parse(text),
    });
    assert.doesNotMatch(JSON.stringify(success.structuredContent), /Users\/example|secret\.json/);

    const failure = callResult(
      await session.request("tools/call", {
        name: "relay_target_list",
        arguments: {},
      }),
    );
    const errorText = String(failure.content[0]?.text);
    assert.equal(failure.isError, true);
    assert.ok(errorText.length <= relayMcpErrorLimit);
    assert.doesNotMatch(errorText, new RegExp(credential));
    assert.doesNotMatch(errorText, /Users\/example|secret\.json/);
  } finally {
    await session.close();
  }
});

test("returns an actionable compact replay and a durable resource when an offline diagnosis is large", async () => {
  const report = {
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
    firstRootFailure: { checkId: "birth-year", title: "Birth Year", kind: "action-no-op" },
    cursorTimeline: [],
    checks: Array.from({ length: 80 }, (_, index) => ({
      id: `check-${index}`,
      title: `Check ${index}`,
      replayStatus: "invalid-cascade",
      reason: "x".repeat(1_000),
      selectorAttempts: [],
      evidence: [],
    })),
    blockers: [],
  };
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "run.replay.offline");
      return { report };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_run_replay_offline",
        arguments: { runId: "run-1" },
      }),
    );
    const compact = result.structuredContent?.result as {
      report: { evidenceTruncated: boolean; firstRootFailure: { checkId: string } };
      resource: { uri: string };
    };
    assert.equal(compact.report.evidenceTruncated, true);
    assert.equal(compact.report.firstRootFailure.checkId, "birth-year");
    assert.equal(compact.resource.uri, "relay://runs/run-1/offline-replay");
    assert.ok(String(result.content[0]?.text).length <= relayMcpTextLimit);
  } finally {
    await session.close();
  }
});

test("compact offline replay tool dest identity is dest wait-for 003, not leftover Close 004", async () => {
  const leftoverFrames = [
    { path: "frames/003.png", caption: "Observe" },
    { path: "frames/004.png", caption: "after · Run saved Test" },
  ];
  const leftoverArtifacts = [
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
  ];
  const report = {
    schemaVersion: 1,
    mode: "offline-evidence-replay",
    runId: "run-1",
    sourceRunStatus: "error",
    planDigest: "a".repeat(64),
    frames: leftoverFrames,
    artifacts: leftoverArtifacts,
    summary: {
      checks: 80,
      proved: 2,
      rootFailures: 1,
      invalidCascades: 77,
      independentFailures: 0,
    },
    firstRootFailure: { checkId: "birth-year", title: "Birth Year", kind: "action-no-op" },
    cursorTimeline: [],
    checks: Array.from({ length: 80 }, (_, index) => ({
      id: `check-${index}`,
      title: `Check ${index}`,
      replayStatus: "invalid-cascade",
      reason: "x".repeat(1_000),
      selectorAttempts: [],
      evidence: [],
    })),
    blockers: [],
  };
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "run.replay.offline");
      return { report };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_run_replay_offline",
        arguments: { runId: "run-1" },
      }),
    );
    const compact = result.structuredContent?.result as {
      destIdentity?: Array<{ path?: string; caption?: string }>;
      report?: {
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      };
    };
    assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
  } finally {
    await session.close();
  }
});

const leftoverDestEndJob = {
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
      },
    },
    {
      kind: "capture-review",
      data: { caption: "Close", framePath: "frames/004.png" },
    },
  ],
};

test("compact job.get dest identity is dest wait-for 003, not leftover Close 004", async () => {
  const logs = Array.from({ length: 24 }, () => "x".repeat(500));
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "job.get");
      return { job: { ...leftoverDestEndJob, logs } };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_job_get",
        arguments: { jobId: leftoverDestEndJob.id },
      }),
    );
    const compact = result.structuredContent?.result as {
      truncated?: boolean;
      destIdentity?: Array<{ path?: string; caption?: string }>;
      job?: { destIdentity?: Array<{ path?: string }> };
    };
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.deepEqual(compact.job?.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
    assert.ok(String(result.content[0]?.text ?? "").length <= relayMcpTextLimit);
  } finally {
    await session.close();
  }
});

const leftoverVisualComparison = {
  padding: "x".repeat(relayMcpTextLimit),
  comparison: {
    latest: {
      frames: leftoverDestEndJob.frames,
      frameCount: leftoverDestEndJob.frames.length,
    },
  },
};

test("compact visual compare dest identity is dest wait-for 003, not leftover Close 004", async () => {
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "run.visual.compare");
      return leftoverVisualComparison;
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_run_visual_compare",
        arguments: { runId: leftoverDestEndJob.id },
      }),
    );
    const compact = result.structuredContent?.result as {
      truncated?: boolean;
      destIdentity?: Array<{ path?: string; caption?: string }>;
    };
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
    assert.ok(String(result.content[0]?.text ?? "").length <= relayMcpTextLimit);
  } finally {
    await session.close();
  }
});

test("compact visual review leftover Close 004 cannot fill dest", async () => {
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "run.visual.review");
      return leftoverVisualComparison;
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_run_visual_review",
        arguments: {
          runId: leftoverDestEndJob.id,
          comparisonId: "visual-comparison-leftover",
          action: "keep-baseline",
          confirm: true,
        },
      }),
    );
    const compact = result.structuredContent?.result as {
      truncated?: boolean;
      destIdentity?: Array<{ path?: string; caption?: string }>;
    };
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
    assert.ok(String(result.content[0]?.text ?? "").length <= relayMcpTextLimit);
  } finally {
    await session.close();
  }
});

test("compact visual-baseline update leftover Close 004 cannot fill dest", async () => {
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "run.visual-baseline.update");
      return leftoverVisualComparison;
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_run_visual_baseline_update",
        arguments: {
          runId: leftoverDestEndJob.id,
          action: "approve-new-baseline",
          confirm: true,
        },
      }),
    );
    const compact = result.structuredContent?.result as {
      truncated?: boolean;
      destIdentity?: Array<{ path?: string; caption?: string }>;
    };
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
    assert.ok(String(result.content[0]?.text ?? "").length <= relayMcpTextLimit);
  } finally {
    await session.close();
  }
});

test("compact capture-review leftover Close 004 cannot fill dest", async () => {
  const leftoverCaptureReview = {
    queue: {
      padding: "x".repeat(relayMcpTextLimit),
      items: [
        {
          captureId: "frames/003.png::dest",
          caption: "Observe",
          status: "pending",
          framePath: "frames/003.png",
          phase: "dest",
        },
        {
          captureId: "frames/004.png::close-leftover",
          caption: "Close",
          status: "pending",
          framePath: "frames/004.png",
        },
      ],
      summary: { planned: 1, pending: 2 },
    },
  };
  const session = await connectMcp({
    async invoke(operationId) {
      assert.equal(operationId, "job.combine.capture.review");
      return leftoverCaptureReview;
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_job_combine_capture_review",
        arguments: { batchId: leftoverDestEndJob.id },
      }),
    );
    const compact = result.structuredContent?.result as {
      truncated?: boolean;
      destIdentity?: Array<{ path?: string; caption?: string }>;
    };
    assert.equal(compact.truncated, true);
    assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
    assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
    assert.ok(String(result.content[0]?.text ?? "").length <= relayMcpTextLimit);
  } finally {
    await session.close();
  }
});

test("returns screenshots as native PNG content without path or base64 metadata leaks", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const base64 = png.toString("base64");
  const hostPath = "/private/var/folders/relay/screenshot.png";
  const framePath = "/private/var/folders/relay/frame.png";
  const capturedAt = 1_754_009_600_000;
  const session = await connectMcp({
    async invoke() {
      return {
        mime: "image/png",
        base64,
        bytes: png.byteLength,
        path: hostPath,
        framePath,
        capturedAt,
        serial: "emulator-5554",
        jobId: "job-1",
        width: 1,
        height: 1,
        screenMatch: {
          fingerprint: "screen-fingerprint",
          matchedScreenId: "screen-home",
          status: "observed",
        },
        nested: { unsafe: true },
      };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_screenshot_capture",
        arguments: { serial: "emulator-5554" },
      }),
    );
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.content, [
      {
        type: "text",
        text: JSON.stringify({
          mimeType: "image/png",
          bytes: png.byteLength,
          nextHint:
            "Tap with target.interact (preview:true marks only). Do not start with test run.",
          capturedAt,
          serial: "emulator-5554",
          jobId: "job-1",
          width: 1,
          height: 1,
          screenMatch: {
            fingerprint: "screen-fingerprint",
            matchedScreenId: "screen-home",
            status: "observed",
          },
        }),
      },
      { type: "image", data: base64, mimeType: "image/png" },
    ]);
    assert.deepEqual(result.structuredContent, {
      result: {
        mimeType: "image/png",
        bytes: png.byteLength,
        nextHint: "Tap with target.interact (preview:true marks only). Do not start with test run.",
        capturedAt,
        serial: "emulator-5554",
        jobId: "job-1",
        width: 1,
        height: 1,
        screenMatch: {
          fingerprint: "screen-fingerprint",
          matchedScreenId: "screen-home",
          status: "observed",
        },
      },
    });
    const metadata = JSON.stringify({
      text: result.content.filter(({ type }) => type === "text"),
      structuredContent: result.structuredContent,
    });
    assert.doesNotMatch(metadata, /private\/var|screenshot\.png|frame\.png/);
    assert.doesNotMatch(metadata, new RegExp(base64));
    assert.doesNotMatch(metadata, /framePath|base64|"path"/);
  } finally {
    await session.close();
  }
});

test("interact preview without HTTP base64 stays a small digest", async () => {
  const session = await connectMcp({
    async invoke() {
      return {
        ok: true,
        preview: true,
        mime: "image/png",
        bytes: 700_000,
        inspectable: false,
        path: "/tmp/preview.png",
        nodes: [{ label: "huge leftover tree" }],
      };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_interact",
        arguments: { serial: "ipad-1", kind: "point", x: 10, y: 20, preview: true },
      }),
    );
    assert.equal(result.isError, undefined);
    const text = String(result.content[0]?.text ?? "");
    assert.doesNotMatch(text, /huge leftover tree|base64|\/tmp\/preview\.png/);
    assert.match(text, /--preview --file/);
    assert.ok(text.length < 2_000);
  } finally {
    await session.close();
  }
});

test("interact preview unwraps an invoke envelope into a native PNG", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const base64 = png.toString("base64");
  const session = await connectMcp({
    async invoke() {
      return {
        ok: true,
        result: {
          mime: "image/png",
          base64,
          bytes: png.byteLength,
          preview: true,
          inspectable: false,
          capturedAt: 1,
          serial: "ipad-1",
          width: 1,
          height: 1,
        },
      };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_interact",
        arguments: { serial: "ipad-1", kind: "point", x: 10, y: 20, preview: true },
      }),
    );
    assert.equal(result.isError, undefined);
    assert.equal(result.content[1]?.type, "image");
    const text = String(result.content[0]?.text ?? "");
    assert.doesNotMatch(text, new RegExp(base64));
    assert.match(text, /"preview":true/);
    assert.ok(text.length < 2_000);
  } finally {
    await session.close();
  }
});

test("interact preview returns a PNG image instead of inlined base64 JSON", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const base64 = png.toString("base64");
  const session = await connectMcp({
    async invoke() {
      return {
        mime: "image/png",
        base64,
        bytes: png.byteLength,
        preview: true,
        inspectable: false,
        capturedAt: 1,
        serial: "ipad-1",
        width: 1,
        height: 1,
      };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_interact",
        arguments: { serial: "ipad-1", kind: "point", x: 10, y: 20, preview: true },
      }),
    );
    assert.equal(result.isError, undefined);
    assert.equal(result.content[1]?.type, "image");
    const text = String(result.content[0]?.text ?? "");
    assert.doesNotMatch(text, new RegExp(base64));
    assert.match(text, /"preview":true/);
    assert.match(text, /"inspectable":false/);
    assert.match(text, /Commit with target.interact/);
  } finally {
    await session.close();
  }
});

test("rejects screenshot results without canonical PNG base64", async () => {
  for (const screenshot of [
    { mime: "image/jpeg", base64: pngSignatureBase64() },
    { mime: "image/png", base64: "not-base64" },
  ]) {
    const session = await connectMcp({
      async invoke() {
        return screenshot;
      },
    });
    try {
      const result = callResult(
        await session.request("tools/call", {
          name: "relay_target_screenshot_capture",
          arguments: { serial: "emulator-5554" },
        }),
      );
      assert.equal(result.isError, true);
      assert.match(String(result.content[0]?.text), /invalid PNG screenshot result/);
    } finally {
      await session.close();
    }
  }
});

function pngSignatureBase64(): string {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
}

test("profile instructions distinguish saved Test execution from manual exploration", () => {
  for (const profile of ["qa", "device", "full"] as const) {
    const instructions = relayMcpInstructionsForProfile(profile);
    assert.match(instructions, /For a requested saved Test, run it directly/);
    assert.match(instructions, /Omit appMapId when exactly one App exists/);
    assert.match(instructions, /relay_list_devices/);
    assert.doesNotMatch(instructions, /Do not start with test run/);
  }
});

test("qa exposes the describe, run, verdict loop and accurate discovery", async () => {
  const invoked: string[] = [];
  const session = await connectMcp(
    {
      async invoke(operationId) {
        invoked.push(operationId);
        if (operationId === "system.doctor.get") return { ok: true, checks: [] };
        throw new Error(`unexpected ${operationId}`);
      },
    },
    "qa",
  );
  try {
    const listed = await session.request("tools/list", {});
    const tools = listed.result?.tools as ListedTool[];
    const names = tools.map(({ name }) => name);
    assert.deepEqual(names, [
      "relay_create_test",
      "relay_run_test",
      "relay_get_verdict",
      "relay_inspect_failure",
      "relay_check_change",
      "relay_list_tests",
      "relay_list_devices",
      "relay_get_guide",
      "relay_list_apps",
      "relay_list_runs",
      "relay_get_test",
      "relay_health",
    ]);
    for (const absent of [
      "relay_app_map_get",
      "relay_panel",
      "relay_tap",
      "relay_record_test",
      "relay_prove_change",
      "relay_proof_plan_approve",
    ]) {
      assert.equal(names.includes(absent), false, absent);
    }
    for (const name of ["relay_list_apps", "relay_list_runs", "relay_get_test", "relay_health"]) {
      const tool = tools.find((item) => item.name === name)!;
      assert.equal(tool.annotations?.readOnlyHint, true, name);
      assert.equal(tool.inputSchema.required?.includes("confirm") ?? false, false, name);
    }
    const health = callResult(
      await session.request("tools/call", { name: "relay_health", arguments: {} }),
    );
    assert.notEqual(health.isError, true);
    assert.deepEqual(invoked, ["system.doctor.get"]);
    const discovery = callResult(
      await session.request("resources/read", { uri: "relay://operations" }),
    );
    const data = JSON.parse(
      (discovery as unknown as { contents: { text: string }[] }).contents[0]!.text,
    ).data;
    assert.equal(data.activeToolCount, names.length);
    assert.deepEqual(data.activeOperations, names);
    assert.match(relayMcpInstructionsForProfile("qa"), /model-free/u);
    assert.doesNotMatch(relayMcpInstructionsForProfile("qa"), /relay_prove_change/u);
  } finally {
    await session.close();
  }
});
