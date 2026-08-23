import { InMemoryTransport } from "@modelcontextprotocol/server";
import { ApiError } from "@relay/client";
import {
  defineIosMutationTerminalityRegistry,
  verifyIosMutationTerminalityRegistry,
  type IosMutationTerminalityTrace,
} from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpServer,
  relayMcpErrorLimit,
  relayMcpInstructions,
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
    assert.deepEqual(
      tools.map(({ name }) => name),
      relayMcpTools.map(({ name }) => name),
    );
    assert.equal(new Set(tools.map(({ name }) => name)).size, relayMcpTools.length);
    assert.equal(
      tools.some(({ name }) => name === "relay_health"),
      false,
    );

    for (const descriptor of relayMcpTools) {
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
      "confirm",
      "previewX",
      "previewY",
      "serial",
    ]);
    assert.deepEqual(screenshot.inputSchema.required, ["serial"]);
    const snapshot = tools.find(({ name }) => name === "relay_target_snapshot_capture");
    assert.ok(snapshot);
    assert.deepEqual(Object.keys(snapshot.inputSchema.properties ?? {}).sort(), [
      "confirm",
      "full",
      "serial",
      "visual",
    ]);
    assert.match(snapshot.description ?? "", /digest/i);
    assert.match(snapshot.description ?? "", /full/);
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
    "review",
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

test("profile selection exposes deterministic least-privilege tool sets", async () => {
  for (const profile of [
    "control",
    "map",
    "observe",
    "author",
    "run",
    "execute",
    "review",
    "admin",
    "full",
  ] as const) {
    const session = await connectMcp({ async invoke() {} }, profile);
    try {
      const listed = await session.request("tools/list", {});
      assert.equal(listed.error, undefined);
      const names = ((listed.result?.tools as ListedTool[] | undefined) ?? []).map(
        ({ name }) => name,
      );
      assert.deepEqual(
        names,
        relayMcpToolsForProfile(profile).map(({ name }) => name),
      );
      assert.equal(new Set(names).size, names.length);
    } finally {
      await session.close();
    }
  }

  const compact = relayMcpToolsForProfile(defaultRelayMcpProfile);
  assert.ok(compact.length < relayMcpTools.length / 2);
  assert.ok(compact.some(({ operationId }) => operationId === "target.interact"));
  assert.ok(compact.some(({ operationId }) => operationId === "target.recover"));
  assert.ok(compact.some(({ operationId }) => operationId === "lease.create"));
  assert.equal(
    compact.some(({ operationId }) => operationId === "app-map.proposal.submit"),
    false,
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "app-map.proposal.submit",
    ),
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "workspace.variables.update",
    ),
  );
  assert.ok(
    relayMcpToolsForProfile("author").some(
      ({ operationId }) => operationId === "authoring.session.commit",
    ),
  );
  assert.equal(
    relayMcpToolsForProfile("observe").every(({ annotations }) => annotations.readOnlyHint),
    true,
  );
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

type McpSwitcherOperation = "switcher-profile.scan" | "language-profile.scan";
type McpSwitcherOutcome = "unknown" | "code-only-terminal" | "validation";

function isMcpSwitcherOutcomeUnknown(error: unknown): boolean {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const result = error as {
    code?: unknown;
    status?: unknown;
    terminal?: unknown;
    recovery?: { action?: unknown; retryable?: unknown };
  };
  return (
    result.code === "IOS_MUTATION_OUTCOME_UNKNOWN" &&
    result.status === 409 &&
    result.terminal === "review-needed" &&
    result.recovery?.action === "none" &&
    result.recovery?.retryable === false
  );
}

async function mcpSwitcherTransportTrace(
  operationId: McpSwitcherOperation,
  outcome: McpSwitcherOutcome,
): Promise<IosMutationTerminalityTrace> {
  const nativeDispatches: string[] = [];
  const iosMutation = {
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
  };
  const switcherScan = {
    status: "interrupted",
    phase: "entry-path",
    repair: {
      terminal: true,
      nextAction: "capture-current-screen-before-any-retry",
      blocked: ["fallback-target", "retry-launch", "path-step"],
    },
  };
  const session = await connectMcp({
    async invoke() {
      // A schema rejection stops before any device action. The terminal
      // outcomes below represent the one transport call that owns an already
      // dispatched physical action, so only those belong in this trace.
      if (outcome !== "validation") nativeDispatches.push("mcp-operation-invoke");
      if (outcome === "unknown") {
        throw new ApiError(409, "The iOS press may already have reached the device.", {
          code: "IOS_MUTATION_OUTCOME_UNKNOWN",
          error: "The iOS press may already have reached the device.",
          iosMutation,
          switcherScan,
        });
      }
      if (outcome === "code-only-terminal") {
        throw new ApiError(409, "Refresh and retry", {
          code: "IOS_MUTATION_OUTCOME_UNKNOWN",
          error: "Refresh and retry the picker scan.",
          iosMutation: "malformed native diagnostic",
          recovery: { action: "refresh-and-retry", retryable: true },
          recoveryAction: {
            operationId: "switcher-profile.scan",
            input: { serial: "ipad-1" },
          },
        });
      }
      throw new ApiError(400, "kind is required", {
        code: "invalid_request",
        error: "kind is required",
      });
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name:
          operationId === "switcher-profile.scan"
            ? "relay_switcher_profile_scan"
            : "relay_language_profile_scan",
        arguments:
          operationId === "switcher-profile.scan"
            ? { serial: "ipad-1", app: "Grok", kind: "language" }
            : { serial: "ipad-1", app: "Grok" },
      }),
    );
    assert.equal(result.isError, true);
    if (outcome === "unknown") {
      const error = result.structuredContent?.error;
      assert.deepEqual(error, {
        operationId,
        status: 409,
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        message:
          "Review needed: Relay cannot confirm whether the iOS command reached the device. Capture the current screen before any explicit retry or repair.",
        terminal: "review-needed",
        recovery: { action: "none", retryable: false },
        iosReview: { iosMutation, switcherScan },
      });
      return { nativeDispatches, status: "terminal", error };
    }
    if (outcome === "code-only-terminal") {
      const error = result.structuredContent?.error;
      assert.deepEqual(error, {
        operationId,
        status: 409,
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        message:
          "Review needed: Relay cannot confirm whether the iOS command reached the device. Capture the current screen before any explicit retry or repair.",
        terminal: "review-needed",
        recovery: { action: "none", retryable: false },
      });
      return { nativeDispatches, status: "terminal", error };
    }
    const error = result.structuredContent?.error as
      | {
          code?: unknown;
          recovery?: { action?: unknown; retryable?: unknown };
          iosReview?: unknown;
        }
      | undefined;
    assert.equal(error?.code, "invalid_request");
    assert.deepEqual(error?.recovery, { action: "fix-input", retryable: false });
    assert.equal(error?.iosReview, undefined);
    return { nativeDispatches, status: "handled" };
  } finally {
    await session.close();
  }
}

test("registered switcher MCP tools preserve terminal review evidence", async () => {
  const registry = defineIosMutationTerminalityRegistry([
    {
      id: "mcp.switcher-profile.scan",
      unknown: async () => await mcpSwitcherTransportTrace("switcher-profile.scan", "unknown"),
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 0,
        run: async () => await mcpSwitcherTransportTrace("switcher-profile.scan", "validation"),
      },
    },
    {
      id: "mcp.language-profile.scan",
      unknown: async () => await mcpSwitcherTransportTrace("language-profile.scan", "unknown"),
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 0,
        run: async () => await mcpSwitcherTransportTrace("language-profile.scan", "validation"),
      },
    },
    {
      id: "mcp.switcher-profile.scan.code-only-terminal",
      unknown: async () =>
        await mcpSwitcherTransportTrace("switcher-profile.scan", "code-only-terminal"),
      recovery: {
        expectedStatus: "handled",
        expectedNativeDispatches: 0,
        run: async () => await mcpSwitcherTransportTrace("switcher-profile.scan", "validation"),
      },
    },
  ]);

  await verifyIosMutationTerminalityRegistry(registry, {
    isOutcomeUnknown: isMcpSwitcherOutcomeUnknown,
  });
});

test("fails closed for a malformed iOS terminal payload while retaining valid review evidence", async () => {
  const switcherScan = { status: "interrupted", phase: "entry-path" };
  const session = await connectMcp({
    async invoke() {
      throw new ApiError(409, "Refresh and retry", {
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        error: "Refresh and retry the tap.",
        iosMutation: "not-a-structured-diagnostic",
        switcherScan,
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
        iosReview: { switcherScan },
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
        name: "relay_system_doctor_get",
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
