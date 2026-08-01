import { InMemoryTransport } from "@modelcontextprotocol/server";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpServer,
  relayMcpInstructions,
  relayMcpServerInfo,
  type OperationInvoker,
} from "./server.js";

type RpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

test("SDK initialization lists and invokes relay_health", async () => {
  const calls: Array<{ operationId: string; input: unknown }> = [];
  const invoker: OperationInvoker = {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      return { status: "ok" };
    },
  };
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

  try {
    await server.connect(serverTransport);
    await clientTransport.start();

    const initialized = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "relay-mcp-test", version: "0.1.0" },
    });
    assert.equal(initialized.error, undefined);
    assert.deepEqual(initialized.result?.serverInfo, relayMcpServerInfo);
    assert.equal(initialized.result?.instructions, relayMcpInstructions);
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    } as never);

    const listed = await request("tools/list", {});
    assert.equal(listed.error, undefined);
    const tools = listed.result?.tools as Array<{ name: string }>;
    assert.deepEqual(
      tools.map(({ name }) => name),
      ["relay_health"],
    );

    const called = await request("tools/call", { name: "relay_health", arguments: {} });
    assert.equal(called.error, undefined);
    assert.deepEqual(calls, [{ operationId: "system.health.get", input: {} }]);
    assert.deepEqual(called.result?.content, [{ type: "text", text: '{"status":"ok"}' }]);
  } finally {
    await Promise.allSettled([server.close(), clientTransport.close()]);
  }
});
