import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RelayClient } from "@relay/client";
import {
  operationDefinition,
  summarizeAppMapOperationResult,
  summarizeAuthoringOperationResult,
  summarizeExecutionOperationResult,
  summarizeTargetOperationResult,
  type OperationId,
} from "@relay/protocol";
import * as z from "zod/v4";
import type { McpConfig } from "./config.js";
import { invalidRelayMcpInput, relayMcpError, type RelayMcpStructuredError } from "./errors.js";
import { registerRelayPrompts } from "./prompts.js";
import { registerRelayResources, type RelayResourceScope } from "./resources.js";
import {
  defaultRelayMcpProfile,
  relayMcpToolsForProfile,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";

export const relayMcpServerInfo = {
  name: "relay",
  title: "Relay MCP",
  version: "0.1.0",
  description: "Scoped access to Relay operations for MCP agents.",
} as const;

export const relayMcpInstructions = [
  "Use Relay tools only within the configured organization and project scope.",
  "Treat tool results as server-authoritative and preserve Relay actor identity.",
  "Pass operation fields directly as tool arguments; do not infer target or session identifiers.",
  "Take a screenshot before interacting. Prefer identifier, then label, then text, then point.",
  "If a tap does not change pixels, it missed; try the label, not a cell center.",
  "A missing accessibility tree is not a failed session — screenshot plus point still works.",
  "On TARGET_CONTROL_LEASE_REQUIRED, call lease.create with this actor, then retry.",
  "On TARGET_CONTROL_RUN_RESERVED, wait or cancel the active job before sending input.",
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
  profile?: RelayMcpProfile;
};

const relayToolOutputSchema = z
  .object({
    result: z.unknown().optional(),
    error: z
      .object({
        operationId: z.string(),
        status: z.number().int().optional(),
        code: z.string(),
        message: z.string(),
        recovery: z.object({ action: z.string(), retryable: z.boolean() }).strict(),
        recoveryAction: z
          .object({
            operationId: z.string(),
            input: z.record(z.string(), z.unknown()).optional(),
            cli: z
              .object({ argv: z.array(z.string()) })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        currentRevision: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
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

function errorResult(error: RelayMcpStructuredError): CallToolResult {
  const text = boundedError(JSON.stringify(error));
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: { error },
  } as CallToolResult;
}

function localError(
  operationId: OperationId,
  code: string,
  message: string,
  status = 400,
): RelayMcpStructuredError {
  return {
    operationId,
    status,
    code,
    message,
    recovery: {
      action: status >= 500 ? "retry-later" : "fix-input",
      retryable: status >= 500,
    },
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
    return errorResult(
      localError(
        "target.screenshot.capture",
        "invalid_screenshot_result",
        "Relay returned an invalid PNG screenshot result.",
        502,
      ),
    );
  }
  const screenshot = result as Record<string, unknown>;
  const bytes = decodePngBase64(screenshot.base64);
  if (screenshot.mime !== "image/png" || !bytes) {
    return errorResult(
      localError(
        "target.screenshot.capture",
        "invalid_screenshot_result",
        "Relay returned an invalid PNG screenshot result.",
        502,
      ),
    );
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
    return errorResult(
      localError(
        descriptor.operationId,
        "confirmation_required",
        `Tool ${descriptor.name} requires confirm: true.`,
      ),
    );
  }

  try {
    operationDefinition(descriptor.operationId).input.parse(input);
  } catch (error) {
    return errorResult(
      invalidRelayMcpInput(
        descriptor.operationId,
        error instanceof Error ? error.message : undefined,
      ),
    );
  }

  let result: unknown;
  try {
    result = await invoker.invoke(descriptor.operationId, input, { signal });
  } catch (error) {
    return errorResult(relayMcpError(descriptor.operationId, error));
  }

  if (descriptor.operationId === "target.screenshot.capture") return screenshotResult(result);
  try {
    return normalResult(
      summarizeTargetOperationResult(
        descriptor.operationId,
        summarizeExecutionOperationResult(
          descriptor.operationId,
          summarizeAppMapOperationResult(
            descriptor.operationId,
            summarizeAuthoringOperationResult(descriptor.operationId, result),
          ),
        ),
      ),
    );
  } catch {
    return errorResult(
      localError(
        descriptor.operationId,
        "invalid_operation_result",
        `Relay operation ${descriptor.operationId} returned an invalid result.`,
        502,
      ),
    );
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
    inputSchema: descriptor.inputSchema,
  };

  server.registerTool(descriptor.name, config, (argumentsValue, context) => {
    const { confirm, ...input } = argumentsValue as Record<string, unknown>;
    return invokeRelayTool(descriptor, input, confirm === true, invoker, context.mcpReq.signal);
  });
}

export function createMcpServer({
  invoker,
  scope,
  profile = defaultRelayMcpProfile,
}: McpServerDependencies): McpServer {
  const server = new McpServer(relayMcpServerInfo, {
    instructions: relayMcpInstructions,
  });

  const tools = relayMcpToolsForProfile(profile);
  for (const descriptor of tools) {
    registerRelayTool(server, descriptor, invoker);
  }
  registerRelayResources(server, { invoker, scope, profile, tools });
  registerRelayPrompts(server, scope, tools);

  return server;
}
