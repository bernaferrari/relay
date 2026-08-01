import { InMemoryTransport } from "@modelcontextprotocol/server";
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
import { relayMcpTools } from "./tools.js";

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

async function connectMcp(invoker: OperationInvoker) {
  const server = createMcpServer({ invoker });
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

test("SDK initialization lists every generated Relay tool exactly once", async () => {
  const session = await connectMcp({ async invoke() {} });
  try {
    assert.deepEqual(session.initialized.result?.serverInfo, relayMcpServerInfo);
    assert.equal(session.initialized.result?.instructions, relayMcpInstructions);
    const capabilities = session.initialized.result?.capabilities as Record<string, unknown>;
    assert.ok(capabilities.tools);
    assert.equal(capabilities.resources, undefined);
    assert.equal(capabilities.prompts, undefined);

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
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), ["confirm", "input"]);
      assert.equal(tool.inputSchema.required?.includes("input"), true);
      assert.equal(
        tool.inputSchema.required?.includes("confirm") ?? false,
        descriptor.requiresConfirmation,
      );
    }
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
  const writeInput = { name: "Pixel", metadata: { owner: "qa" } };
  const confirmedInput = { channel: "audio", enabled: true, reason: "test run" };
  try {
    const read = callResult(
      await session.request("tools/call", {
        name: "relay_system_health_get",
        arguments: { input: readInput },
      }),
    );
    const write = callResult(
      await session.request("tools/call", {
        name: "relay_target_create",
        arguments: { input: writeInput },
      }),
    );
    const confirmed = callResult(
      await session.request("tools/call", {
        name: "relay_workspace_evidence_update",
        arguments: { input: confirmedInput, confirm: true },
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

test("rejects invalid Relay input before invoking the operation", async () => {
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
        arguments: { input: {} },
      }),
    );
    assert.equal(result.isError, true);
    assert.match(String(result.content[0]?.text), /Invalid input/);
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
    for (const argumentsValue of [{ input }, { input, confirm: false }]) {
      const result = callResult(
        await session.request("tools/call", {
          name: "relay_workspace_evidence_update",
          arguments: argumentsValue,
        }),
      );
      assert.equal(result.isError, true);
    }
    assert.deepEqual(calls, []);
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
        arguments: { input: {} },
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
        arguments: { input: {} },
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
        nested: { unsafe: true },
      };
    },
  });
  try {
    const result = callResult(
      await session.request("tools/call", {
        name: "relay_target_screenshot_capture",
        arguments: { input: { serial: "emulator-5554" } },
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
          arguments: { input: { serial: "emulator-5554" } },
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
