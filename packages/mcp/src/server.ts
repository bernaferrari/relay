import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RelayClient } from "@relay/client";
import { operationDefinition, type OperationId } from "@relay/protocol";
import * as z from "zod/v4";
import type { McpConfig } from "./config.js";
import { registerRelayPrompts } from "./prompts.js";
import { registerRelayResources, type RelayResourceScope } from "./resources.js";
import { relayMcpTools, type RelayMcpToolDescriptor } from "./tools.js";

export const relayMcpServerInfo = {
  name: "relay",
  title: "Relay MCP",
  version: "0.1.0",
  description: "Scoped access to Relay operations for MCP agents.",
} as const;

export const relayMcpInstructions = [
  "Use Relay tools only within the configured organization and project scope.",
  "Treat tool results as server-authoritative and preserve Relay actor identity.",
  "Pass the complete Relay operation input in the input object; do not infer target or session identifiers.",
].join(" ");

export const relayMcpTextLimit = 8_192;
export const relayMcpErrorLimit = 1_024;

export type OperationInvokeOptions = {
  signal?: AbortSignal;
};

export type OperationInvoker = {
  invoke(
    operationId: OperationId,
    input: Record<string, unknown>,
    options?: OperationInvokeOptions,
  ): Promise<unknown>;
};

export type McpServerDependencies = {
  invoker: OperationInvoker;
  scope: RelayResourceScope;
};

const relayToolOutputSchema = z.object({ result: z.unknown() }).strict();
const relayToolInputSchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
    confirm: z.literal(true).optional(),
  })
  .strict();
const confirmedRelayToolInputSchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
    confirm: z.literal(true),
  })
  .strict();

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function createRelayOperationInvoker(config: McpConfig): OperationInvoker {
  const client = new RelayClient(config.connection, { timeoutMs: config.timeoutMs });
  return {
    invoke: (operationId, input, options) => client.invoke(operationId, input as never, options),
  };
}

function boundedResult(value: unknown): {
  text: string;
  structuredContent: { result: unknown };
} {
  const text = JSON.stringify(value);
  if (text === undefined) return { text: "null", structuredContent: { result: null } };
  if (text.length <= relayMcpTextLimit) return { text, structuredContent: { result: value } };
  const result = {
    truncated: true,
    serializedCharacters: text.length,
    message: "Relay result omitted from text because it exceeds the MCP text limit.",
  };
  return { text: JSON.stringify(result), structuredContent: { result } };
}

function boundedError(message: string): string {
  if (message.length <= relayMcpErrorLimit) return message;
  return `${message.slice(0, relayMcpErrorLimit - 14)}… [truncated]`;
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: boundedError(message) }],
  };
}

function normalResult(result: unknown): CallToolResult {
  const bounded = boundedResult(result);
  return {
    content: [{ type: "text", text: bounded.text }],
    structuredContent: bounded.structuredContent,
  } as CallToolResult;
}

function decodePngBase64(value: unknown): Buffer | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !canonicalBase64.test(value)
  ) {
    return undefined;
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.toString("base64") !== value ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature)
  ) {
    return undefined;
  }
  return bytes;
}

function screenshotResult(result: unknown): CallToolResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return errorResult("Relay returned an invalid PNG screenshot result.");
  }
  const screenshot = result as Record<string, unknown>;
  const bytes = decodePngBase64(screenshot.base64);
  if (screenshot.mime !== "image/png" || !bytes) {
    return errorResult("Relay returned an invalid PNG screenshot result.");
  }

  const metadata: Record<string, unknown> = {
    mimeType: "image/png",
    bytes: bytes.byteLength,
  };
  for (const key of ["capturedAt", "serial", "jobId", "width", "height"] as const) {
    const value = screenshot[key];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      metadata[key] = value;
    }
  }
  if (
    screenshot.screenMatch &&
    typeof screenshot.screenMatch === "object" &&
    !Array.isArray(screenshot.screenMatch)
  ) {
    const match = screenshot.screenMatch as Record<string, unknown>;
    if (
      typeof match.fingerprint === "string" &&
      (match.matchedScreenId === null || typeof match.matchedScreenId === "string") &&
      (match.status === "observed" || match.status === "unavailable")
    ) {
      metadata.screenMatch = {
        fingerprint: match.fingerprint,
        matchedScreenId: match.matchedScreenId,
        status: match.status,
      };
    }
  }
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      { type: "image", data: screenshot.base64 as string, mimeType: "image/png" },
    ],
    structuredContent: { result: metadata },
  };
}

async function invokeRelayTool(
  descriptor: RelayMcpToolDescriptor,
  input: Record<string, unknown>,
  confirmed: boolean,
  invoker: OperationInvoker,
  signal: AbortSignal,
): Promise<CallToolResult> {
  if (descriptor.requiresConfirmation && !confirmed) {
    return errorResult(`Tool ${descriptor.name} requires confirm: true.`);
  }

  try {
    operationDefinition(descriptor.operationId).input.parse(input);
  } catch {
    return errorResult(`Invalid input for Relay operation ${descriptor.operationId}.`);
  }

  let result: unknown;
  try {
    result = await invoker.invoke(descriptor.operationId, input, { signal });
  } catch {
    return errorResult(`Relay operation ${descriptor.operationId} failed.`);
  }

  if (descriptor.operationId === "target.screenshot.capture") return screenshotResult(result);
  try {
    return normalResult(result);
  } catch {
    return errorResult(`Relay operation ${descriptor.operationId} returned an invalid result.`);
  }
}

function registerRelayTool(
  server: McpServer,
  descriptor: RelayMcpToolDescriptor,
  invoker: OperationInvoker,
): void {
  const config = {
    title: descriptor.title,
    description: descriptor.description,
    outputSchema: relayToolOutputSchema,
    annotations: descriptor.annotations,
  };

  if (descriptor.requiresConfirmation) {
    server.registerTool(
      descriptor.name,
      { ...config, inputSchema: confirmedRelayToolInputSchema },
      ({ input, confirm }, context) =>
        invokeRelayTool(descriptor, input, confirm === true, invoker, context.mcpReq.signal),
    );
    return;
  }

  server.registerTool(
    descriptor.name,
    { ...config, inputSchema: relayToolInputSchema },
    ({ input, confirm }, context) =>
      invokeRelayTool(descriptor, input, confirm === true, invoker, context.mcpReq.signal),
  );
}

export function createMcpServer({ invoker, scope }: McpServerDependencies): McpServer {
  const server = new McpServer(relayMcpServerInfo, {
    instructions: relayMcpInstructions,
  });

  for (const descriptor of relayMcpTools) registerRelayTool(server, descriptor, invoker);
  registerRelayResources(server, { invoker, scope });
  registerRelayPrompts(server, scope);

  return server;
}
