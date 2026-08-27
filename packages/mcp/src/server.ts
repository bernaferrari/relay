import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RelayClient } from "@relay/client";
import {
  operationDefinition,
  parseAuthoringSessionResponse,
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  appMapGetListFromInput,
  summarizeAppMapOperationResult,
  summarizeAuthoringSession,
  summarizeAuthoringOperationResult,
  summarizeExecutionOperationResult,
  summarizeTargetOperationResult,
  wantsFullSnapshotTree,
  type OperationId,
} from "@relay/protocol";
import * as z from "zod/v4";
import type { McpConfig } from "./config.js";
import { invalidRelayMcpInput, relayMcpError, type RelayMcpStructuredError } from "./errors.js";
import { registerRelayPrompts } from "./prompts.js";
import { registerRelayResources, type RelayResourceScope } from "./resources.js";
import { compactOfflineReplayToolResult } from "./offline-replay-result.js";
import {
  invokeRelayOutcomeTool,
  relayOutcomeTools,
  type RelayOutcomeToolDescriptor,
} from "./outcome-tools.js";
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
  "Prefer outcome tools: connect, record, run, repeat, inspect, repair, and export evidence.",
  "Omit appMapId and targetId when exactly one App Map and one ready device exist.",
  "Never retry an outcome whose snapshot says the mutation outcome is unknown; inspect its opaque workflow reference.",
  "Repeat runs one representative pilot first and requires explicit confirmation before remaining values.",
  "Repair tools create reviewable proposals; they never silently rewrite an approved Test.",
  "For advanced target control, capture a screenshot before interacting and prefer identifier, then label, text, and point.",
  "A missing accessibility tree is not a failed session; pixels and point control remain usable.",
  "Never take over a lease implicitly, and wait or cancel an active reserved Run before sending input.",
  "Read relay://control/gotchas before advanced interact, recover, snapshot, or launch operations.",
].join(" ");

export const relayMcpTextLimit = 8_192;
export const relayMcpErrorLimit = 1_024;

const reviewedOriginConfirmationOperationIds = new Set<OperationId>([
  "app-map.scroll-surface.origin.review",
  "app-map.scroll-surface.origin.revoke",
]);

/** `confirm: true` is the MCP-facing consent affordance. After the generic
 * confirmation guard accepts it, preserve it for the canonical lease-takeover
 * protocol field and translate it into the signed field required by the two
 * durable reviewed-origin authority operations. */
function confirmedInput(
  operationId: OperationId,
  input: Record<string, unknown>,
  confirmed: boolean,
): Record<string, unknown> {
  if (operationId === "lease.takeover") {
    return confirmed ? { ...input, confirm: true } : input;
  }
  return reviewedOriginConfirmationOperationIds.has(operationId)
    ? { ...input, confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION }
    : input;
}

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
  actorId?: string;
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
        terminal: z.literal("review-needed").optional(),
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
        iosReview: z
          .object({
            iosMutation: z.record(z.string(), z.unknown()).optional(),
          })
          .strict()
          .optional(),
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

function boundedResult(
  value: unknown,
  fallback?: unknown,
): {
  text: string;
  structuredContent: { result: unknown };
} {
  const text = JSON.stringify(value);
  if (text === undefined) return { text: "null", structuredContent: { result: null } };
  if (text.length <= relayMcpTextLimit) return { text, structuredContent: { result: value } };
  const result = fallback ?? {
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

function normalResult(result: unknown, fallback?: unknown): CallToolResult {
  const bounded = boundedResult(result, fallback);
  return {
    content: [{ type: "text", text: bounded.text }],
    structuredContent: bounded.structuredContent,
  } as CallToolResult;
}

/** A complete Authoring Session can contain many immutable screenshots and
 * trees. Keep the MCP tool response small while giving an agent a stable
 * resource URI for the full offline record instead of an opaque truncation. */
function compactAuthoringSessionToolResult(result: unknown): unknown {
  try {
    const session = parseAuthoringSessionResponse(result).session;
    const summary = summarizeAuthoringSession(session);
    const take = summary.take;
    return {
      truncated: true,
      resourceUri: `relay://authoring-sessions/${encodeURIComponent(session.id)}`,
      message: "Read resourceUri for the complete Authoring Session and immutable evidence links.",
      session: {
        id: summary.id,
        appMapId: summary.appMapId,
        state: summary.state,
        target: summary.target,
        ...(take
          ? {
              take: {
                id: take.id,
                state: take.state,
                revision: take.revision,
                actionCount: take.actionCount,
                evidenceCount: take.evidenceCount,
                actions: take.actions.slice(0, 40).map((action) => ({
                  id: action.id,
                  stepCount: action.stepCount,
                  ...(action.proofStatus ? { proofStatus: action.proofStatus } : {}),
                })),
                ...(take.actionCount > 40 ? { remainingActionCount: take.actionCount - 40 } : {}),
                ...(take.latestReplay
                  ? {
                      latestReplay: {
                        id: take.latestReplay.id,
                        outcome: take.latestReplay.outcome,
                        takeRevision: take.latestReplay.takeRevision,
                        durationMs: take.latestReplay.durationMs,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
    };
  } catch {
    return undefined;
  }
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

  const presented = confirmedInput(descriptor.operationId, input, confirmed);
  const list = appMapGetListFromInput(presented);
  const operationInput =
    descriptor.operationId === "app-map.get" && list
      ? Object.fromEntries(Object.entries(presented).filter(([key]) => key !== "list"))
      : presented;

  try {
    operationDefinition(descriptor.operationId).input.parse(operationInput);
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
    result = await invoker.invoke(descriptor.operationId, operationInput, { signal });
  } catch (error) {
    return errorResult(relayMcpError(descriptor.operationId, error));
  }

  if (descriptor.operationId === "target.screenshot.capture") return screenshotResult(result);
  try {
    const inner = summarizeExecutionOperationResult(
      descriptor.operationId,
      summarizeAppMapOperationResult(
        descriptor.operationId,
        summarizeAuthoringOperationResult(descriptor.operationId, result),
        { list, input: presented },
      ),
    );
    const summarized =
      descriptor.operationId === "target.snapshot.capture" && wantsFullSnapshotTree(operationInput)
        ? inner
        : summarizeTargetOperationResult(descriptor.operationId, inner);
    const fallback =
      descriptor.operationId === "run.replay.offline"
        ? compactOfflineReplayToolResult(summarized)
        : descriptor.operationId === "authoring.session.get"
          ? compactAuthoringSessionToolResult(summarized)
          : undefined;
    return normalResult(summarized, fallback);
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

function registerRelayOutcomeTool(
  server: McpServer,
  descriptor: RelayOutcomeToolDescriptor,
  invoker: OperationInvoker,
  actorId: string,
): void {
  const schema = descriptor.inputSchema as z.ZodObject;
  server.registerTool(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      outputSchema: relayToolOutputSchema,
      annotations: descriptor.annotations,
      inputSchema: schema.extend({
        confirm: descriptor.requiresConfirmation
          ? z.literal(true).describe("Explicit approval for this protected outcome")
          : z.literal(true).optional().describe("Optional explicit approval"),
      }),
    },
    async (argumentsValue, context) => {
      const { confirm, ...argumentsWithoutConfirmation } = argumentsValue as Record<
        string,
        unknown
      >;
      try {
        const result = await invokeRelayOutcomeTool({
          name: descriptor.name,
          argumentsValue: argumentsWithoutConfirmation,
          confirmed: confirm === true,
          invoker,
          actorId,
          signal: context.mcpReq.signal,
        });
        return normalResult(result);
      } catch (error) {
        return errorResult(relayMcpError(descriptor.name, error));
      }
    },
  );
}

export function createMcpServer({
  invoker,
  scope,
  profile = defaultRelayMcpProfile,
  actorId = "agent:mcp",
}: McpServerDependencies): McpServer {
  const server = new McpServer(relayMcpServerInfo, {
    instructions: relayMcpInstructions,
  });

  const tools = relayMcpToolsForProfile(profile);
  if (profile === "outcome") {
    for (const descriptor of relayOutcomeTools) {
      registerRelayOutcomeTool(server, descriptor, invoker, actorId);
    }
  } else {
    for (const descriptor of tools) {
      registerRelayTool(server, descriptor, invoker);
    }
  }
  registerRelayResources(server, { invoker, scope, profile, tools });
  registerRelayPrompts(server, scope, tools);

  return server;
}
