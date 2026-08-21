import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { createMcpServer, type OperationInvoker } from "@relay/mcp";
import type { OperationId } from "@relay/protocol";
import { startServer, type StartedServer } from "./index.js";

const projectId = "project-mcp-lease-takeover";

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

  const request = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const id = ++nextId;
    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    await clientTransport.send({ jsonrpc: "2.0", id, method, params });
    return response;
  };

  await server.connect(serverTransport as never);
  await clientTransport.start();
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "relay-mcp-lease-takeover-test", version: "0.1.0" },
  });
  assert.equal(initialized.error, undefined);
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  return {
    request,
    async close() {
      await Promise.allSettled([server.close(), clientTransport.close()]);
    },
  };
}

test("MCP forwards only explicit lease-takeover consent to the canonical server operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-mcp-lease-takeover-"));
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  let relayServer: StartedServer | undefined;
  let mcp: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    relayServer = await startServer({ host: "127.0.0.1", port: 0 });
    const connection = {
      url: `http://127.0.0.1:${relayServer.port}`,
      auth: { type: "none" as const },
      organizationId: "local",
      projectId,
    };
    const owner = new RelayClient({
      ...connection,
      actorId: "human:lease-owner",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:mcp-lease-takeover",
      actorKind: "agent",
    });
    const original = await owner.lease({
      poolId: "local",
      deviceSerial: "mcp-lease-device",
      expiresAt: Date.now() + 60_000,
    });
    const calls: Array<{ operationId: OperationId; input: Record<string, unknown> }> = [];
    const invoker: OperationInvoker = {
      async invoke(operationId, input, options) {
        calls.push({ operationId, input });
        return agent.invoke(operationId, input as never, options);
      },
    };
    mcp = await connectMcp(invoker);
    const takeoverInput = {
      leaseId: original.lease.id,
      expiresAt: Date.now() + 120_000,
      reason: "The user approved the MCP lease handoff",
    };

    const unconfirmed = callResult(
      await mcp.request("tools/call", {
        name: "relay_lease_takeover",
        arguments: takeoverInput,
      }),
    );
    assert.equal(unconfirmed.isError, true);
    assert.match(String(unconfirmed.content[0]?.text), /confirm/i);
    assert.deepEqual(calls, []);

    const confirmed = relayResult<{
      lease: { id: string; handoffFromLeaseId?: string; handoffReason?: string };
    }>(
      await mcp.request("tools/call", {
        name: "relay_lease_takeover",
        arguments: { ...takeoverInput, confirm: true },
      }),
    );
    assert.equal(confirmed.lease.handoffFromLeaseId, original.lease.id);
    assert.equal(confirmed.lease.handoffReason, takeoverInput.reason);
    assert.deepEqual(calls, [
      {
        operationId: "lease.takeover",
        input: { ...takeoverInput, confirm: true },
      },
    ]);

    const history = await agent.invoke("lease.list", { status: "all" });
    assert.equal(
      history.leases.find((lease) => lease.id === original.lease.id)?.status,
      "released",
    );
  } finally {
    await mcp?.close();
    await relayServer?.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});
