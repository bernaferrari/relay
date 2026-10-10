import type { McpServer } from "@modelcontextprotocol/server";
import type { OperationId } from "./operation-id.js";

/** The connection shape accepted by the bundled Relay client. */
export type ServerConnection = {
  url: string;
  organizationId: string;
  projectId: string;
  actorId: string;
  actorKind: "agent" | "human";
  auth: { type: "none" } | { type: "bearer"; token: string };
};

export const relayMcpServerInfo: {
  readonly name: "relay";
  readonly title: "Relay MCP";
  readonly version: "0.1.0";
  readonly description: string;
};
export const relayMcpInstructions: string;
export declare function relayMcpInstructionsForProfile(
  profile: NonNullable<McpServerDependencies["profile"]>,
): string;
export const relayMcpTextLimit: 8192;
export const relayMcpErrorLimit: 1024;

export type OperationInvokeOptions = { signal?: AbortSignal };
export type OperationInvoker = {
  binaryResource?(
    path: string,
    init?: RequestInit,
    maxBytes?: number,
  ): Promise<{ bytes: Uint8Array; headers: Headers }>;
  invoke(
    operationId: OperationId,
    input: Record<string, unknown>,
    options?: OperationInvokeOptions,
  ): Promise<unknown>;
};
export type McpServerDependencies = {
  invoker: OperationInvoker;
  scope: { projectId: string };
  profile?: "qa" | "device" | "full";
  actorId?: string;
};
export declare function createRelayOperationInvoker(config: {
  connection: ServerConnection;
  timeoutMs: number;
}): OperationInvoker;
export declare function createMcpServer(dependencies: McpServerDependencies): McpServer;
