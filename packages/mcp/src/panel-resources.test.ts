import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "./server.js";
import { relayPanelMetadata, relayPanelResourceUri } from "./panel-resources.js";

async function connect(apps: boolean) {
  const server = createMcpServer({
    profile: "device",
    scope: { projectId: "project" },
    invoker: {
      async invoke(id) {
        if (id === "app-map.list") return { appMaps: [] };
        if (id === "run.list") return { runs: [] };
        if (id === "target.devices.list") return { devices: [] };
        if (id === "target.list") return { targets: [] };
        if (id === "authoring.session.list") return { sessions: [] };
        if (id === "run.repair.list") return { proposals: [] };
        throw new Error(`Panel unexpectedly invoked ${id}`);
      },
    },
  });
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  let next = 0;
  client.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number")
      pending.get(message.id)?.(message as Record<string, unknown>);
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = ++next;
    const result = new Promise<Record<string, unknown>>((resolve) => pending.set(id, resolve));
    await client.send({ jsonrpc: "2.0", id, method, params } as never);
    return result;
  };
  await server.connect(transport);
  await client.start();
  await request("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "panel-contract-test", version: "1" },
    capabilities: apps
      ? {
          extensions: {
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
          },
        }
      : {},
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" } as never);
  return {
    request,
    close: async () => {
      await server.close();
      await client.close();
    },
  };
}

test("MCP Apps 2.0.3 negotiates the Relay panel with server SDK 2.1.0", async () => {
  const session = await connect(true);
  try {
    const tools = (await session.request("tools/list", {})).result as {
      tools: { name: string; _meta?: unknown }[];
    };
    assert.deepEqual(
      tools.tools.find(({ name }) => name === "relay_panel")?._meta,
      relayPanelMetadata,
    );
    const resources = (await session.request("resources/list", {})).result as {
      resources: { uri: string; mimeType?: string; _meta?: Record<string, unknown> }[];
    };
    const resource = resources.resources.find(({ uri }) => uri === relayPanelResourceUri);
    assert.equal(resource?.mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(resource?._meta?.["openai/ui"], {
      preferredDisplayMode: "fullscreen",
      availableDisplayModes: ["fullscreen"],
    });
  } finally {
    await session.close();
  }
});

test("without UI negotiation the same panel tool returns useful read-only text", async () => {
  const session = await connect(false);
  try {
    const tools = (await session.request("tools/list", {})).result as {
      tools: { name: string; _meta?: unknown }[];
    };
    assert.equal(tools.tools.find(({ name }) => name === "relay_panel")?._meta, undefined);
    const resources = (await session.request("resources/list", {})).result as {
      resources: { uri: string }[];
    };
    assert.equal(
      resources.resources.some(({ uri }) => uri === relayPanelResourceUri),
      false,
    );
    const call = (await session.request("tools/call", { name: "relay_panel", arguments: {} }))
      .result as { structuredContent: { readOnly: boolean; projectId: string } };
    assert.equal(call.structuredContent.readOnly, true);
    assert.equal(call.structuredContent.projectId, "project");
  } finally {
    await session.close();
  }
});
