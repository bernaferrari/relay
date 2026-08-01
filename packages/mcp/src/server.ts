import { McpServer } from "@modelcontextprotocol/server";
import { RelayClient } from "@relay/client";
import * as z from "zod/v4";
import type { McpConfig } from "./config.js";

const healthOperationId = "system.health.get" as const;

export const relayMcpServerInfo = {
  name: "relay",
  title: "Relay MCP",
  version: "0.1.0",
  description: "Scoped access to Relay operations for MCP agents.",
} as const;

export const relayMcpInstructions = [
  "Use Relay tools only within the configured organization and project scope.",
  "Treat tool results as server-authoritative and preserve Relay actor identity.",
  "relay_health is read-only and checks the configured Relay server.",
].join(" ");

export type OperationInvoker = {
  invoke(operationId: typeof healthOperationId, input: Record<string, never>): Promise<unknown>;
};

export type McpServerDependencies = {
  invoker: OperationInvoker;
};

export function createRelayOperationInvoker(config: McpConfig): OperationInvoker {
  const client = new RelayClient(config.connection, { timeoutMs: config.timeoutMs });
  return {
    invoke: (operationId, input) => client.invoke(operationId, input),
  };
}

export function createMcpServer({ invoker }: McpServerDependencies): McpServer {
  const server = new McpServer(relayMcpServerInfo, {
    instructions: relayMcpInstructions,
  });

  server.registerTool(
    "relay_health",
    {
      title: "Relay health",
      description: "Check the health of the configured Relay server.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const health = await invoker.invoke(healthOperationId, {});
      return {
        content: [{ type: "text", text: JSON.stringify(health) }],
      };
    },
  );

  return server;
}
