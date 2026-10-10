import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RelayClient } from "@relay/client";
import {
  compactExecutionDestIdentityFallback,
  operationDefinition,
  operationDefinitions,
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
import {
  invalidRelayMcpInput,
  relayMcpError,
  type RelayMcpErrorOptions,
  type RelayMcpStructuredError,
} from "./errors.js";
import { registerRelayPrompts } from "./prompts.js";
import {
  registerRelayResources,
  tracePackResourceManifest,
  type RelayResourceScope,
} from "./resources.js";
import { compactOfflineReplayToolResult } from "./offline-replay-result.js";
import { pngScreenshotRecord } from "./png-result.js";
import {
  compactReplayLabOutcome,
  invokeRelayOutcomeTool,
  relayFullOutcomeTools,
  relayOutcomeTools,
  type RelayOutcomeToolDescriptor,
} from "./outcome-tools.js";
import { invokeRelayOperatorTool, operatorResultIsPng } from "./operator-tool-dispatch.js";
import { relayOperatorTools, type RelayOperatorToolDescriptor } from "./operator-tools.js";
import { registerRelayPanel } from "./panel-resources.js";
import { relayEverydayTools } from "./everyday-tools.js";
import { relayRequiredOperationIds } from "./registered-tools.js";
import {
  defaultRelayMcpProfile,
  relayMcpProfiles,
  relayMcpTools,
  relayMcpToolsForProfile,
  relayQaOperationTools,
  type RelayMcpProfile,
  type RelayMcpToolDescriptor,
} from "./tools.js";

export const relayMcpServerInfo = {
  name: "relay",
  title: "Relay MCP",
  version: "0.1.0",
  description: "Scoped access to Relay operations for MCP agents.",
} as const;

/**
 * System guidance names only tools the selected profile registers. Each
 * profile adds to the one before it, so the guidance does too.
 */
export function relayMcpInstructionsForProfile(profile: RelayMcpProfile): string {
  const instructions = [
    "Use Relay tools only within the configured organization and project scope, and treat their results as the source of truth.",
    "Call relay_get_guide for a how-to guide before a task; guides ship with this version and need no server or model.",
    "Describe first: relay_create_test saves a Test from a plain-English sentence, relay_run_test runs it and waits for one verdict (passed or failed, with the failing step's expected vs. saw), and relay_get_verdict reads a verdict later.",
    "Call relay_health first. Use relay_list_apps and relay_list_tests before writing a Test that may already exist, relay_get_test to read one, and relay_list_devices to pick a device or browser (pass its targetId when several are ready). Omit appMapId when exactly one App exists.",
    "For a requested saved Test, run it directly with relay_run_test. After a code change, relay_check_change runs the relevant ready Tests: a quick signal, not a merge decision. relay_inspect_failure explains a failed Run.",
    "Plain-English steps need a model key; record a Test when a step must be exact and model-free.",
    "Never retry a call whose result says the outcome is unknown; read its state first.",
  ];
  if (profile === "qa") return instructions.join(" ");
  instructions.push(
    "To drive a device or browser by hand: relay_screenshot, then one relay_tap, relay_type, relay_swipe or relay_press_key, then relay_screenshot again. Prefer identifier, then label, text and point; relay_preview shows a tap without doing it.",
    "A missing control list is not a failure; screenshots and point taps still work. Use relay_recover only when the device stops responding, and never take a device another person or agent is using.",
    "To record an exact Test: relay_record_test, relay_record_action for each step, relay_stop_recording, relay_replay_recording, then relay_approve_recording. relay_repeat_test runs one value first and needs relay_continue_repeat for the rest.",
    "relay_propose_repair suggests a fix for a person to review; it never changes a Test by itself.",
  );
  if (profile === "device") return instructions.join(" ");
  instructions.push(
    "relay_<operation> tools expose every other Relay operation. Prefer the named tools and use these only for what the named tools cannot do; pass confirm: true where a tool requires it.",
    "For a gated, human-reviewed check of a code change, use relay_prove_change and relay_inspect_proof; the proof.* operations cover plan review, recovery, cancellation, publication and reruns with the returned Proof id and exact version. Only a person may approve a Proof plan.",
    "Proof publication recovery is bounded: inspect first, retry one exhausted publication at most once with its exact Proof version, inspect again, and stop on a new failure.",
  );
  return instructions.join(" ");
}

/** Full-profile compatibility export for clients that used the old constant. */
export const relayMcpInstructions = relayMcpInstructionsForProfile("full");

export const relayMcpTextLimit = 8_192;
export const relayMcpErrorLimit = 1_024;

const reviewedOriginConfirmationOperationIds = new Set<OperationId>([
  "app-map.scroll-surface.origin.review",
  "app-map.scroll-surface.origin.revoke",
]);

// Keep the MCP consent adapter derived from the canonical operation registry.
// A newly-added confirmation-protected operation must not silently lose the
// user's `confirm: true` when the transport strips its adapter-only field.
// Reviewed-document authority is the one intentional exception: its protocol
// contract uses a signed `confirmation` value and is translated below.
const canonicalConfirmOperationIds = new Set<OperationId>(
  operationDefinitions
    .filter(
      (definition) =>
        definition.confirmation !== "none" &&
        Object.hasOwn(definition.input.presentation.shape, "confirm") &&
        !Object.hasOwn(definition.input.presentation.shape, "confirmation"),
    )
    .map(({ id }) => id),
);

function recoveryOptionsForProfile(profile: RelayMcpProfile): RelayMcpErrorOptions {
  const availableOperationIds = new Set<string>(
    profile === "full"
      ? relayMcpTools.map(({ operationId }) => operationId)
      : relayRequiredOperationIds(profile),
  );
  return {
    availableOperationIds,
    profile,
    availableProfilesForOperation: (operationId) =>
      relayMcpProfiles.filter(
        (candidate) =>
          candidate === "full" ||
          relayRequiredOperationIds(candidate).some((id) => id === operationId),
      ),
    // The selected tool is always registered. This keeps the generic
    // refresh-and-retry action valid while canonical recoveryAction
    // operations are filtered against availableOperationIds.
    currentOperationAvailable: true,
  };
}

/** `confirm: true` is the MCP-facing consent affordance. After the generic
 * confirmation guard accepts it, preserve it for canonical operations whose
 * protocol input carries that field, and translate it into the signed field
 * required by the two durable reviewed-origin authority operations. */
function confirmedInput(
  operationId: OperationId,
  input: Record<string, unknown>,
  confirmed: boolean,
): Record<string, unknown> {
  if (canonicalConfirmOperationIds.has(operationId)) {
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
        recoveryGuidance: z.string().optional(),
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
    binaryResource: (path, init, maxBytes) => client.binaryResource(path, init, maxBytes),
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

function compactTracePackToolResult(result: unknown, runId: string): unknown {
  return {
    truncated: true,
    resourceUri: `relay://runs/${encodeURIComponent(runId)}/trace-pack`,
    message:
      "The TracePack is larger than the tool response limit. Read resourceUri for its scoped artifact response; Relay returns the complete sanitized pack when bounded and otherwise preserves this digest and manifest.",
    tracePack: tracePackResourceManifest(result),
  };
}

function compactExecutionDestIdentityOperation(operationId: string): boolean {
  return (
    operationId === "run.get" ||
    operationId === "run.list" ||
    operationId === "run.review" ||
    operationId === "run.evidence.get" ||
    operationId === "run.story.get" ||
    operationId === "run.trace-pack.get" ||
    operationId === "run.capture.review" ||
    operationId === "run.replay" ||
    operationId === "run.repair.retry" ||
    operationId === "run.visual.compare" ||
    operationId === "run.visual-baseline.update" ||
    operationId === "run.visual.review" ||
    operationId === "run.visual-policy.update" ||
    operationId.startsWith("job.") ||
    operationId === "app-map.flow.run" ||
    operationId === "app-map.test.run" ||
    operationId === "app-map.connection.run" ||
    operationId.startsWith("workflow.")
  );
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

function resultLooksLikePng(result: unknown): boolean {
  return pngScreenshotRecord(result) !== undefined;
}

function screenshotResult(result: unknown): CallToolResult {
  const screenshot = pngScreenshotRecord(result);
  if (!screenshot) {
    return errorResult(
      localError(
        "target.screenshot.capture",
        "invalid_screenshot_result",
        "Relay returned an invalid PNG screenshot result.",
        502,
      ),
    );
  }
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
    nextHint:
      screenshot.preview === true
        ? "Commit with target.interact (preview:false). Then screenshot again."
        : "Tap with target.interact (preview:true marks only). Do not start with test run.",
  };
  for (const key of [
    "capturedAt",
    "serial",
    "jobId",
    "width",
    "height",
    "preview",
    "inspectable",
  ] as const) {
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
  if (
    screenshot.resolution &&
    typeof screenshot.resolution === "object" &&
    !Array.isArray(screenshot.resolution)
  ) {
    metadata.resolution = screenshot.resolution;
  }
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      { type: "image", data: screenshot.base64 as string, mimeType: "image/png" },
    ],
    structuredContent: { result: metadata },
  };
}

function targetObservationResult(result: unknown): CallToolResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return errorResult(
      localError(
        "target.observation.capture",
        "invalid_target_observation",
        "Relay returned an invalid target observation.",
        502,
      ),
    );
  }
  const observation = result as Record<string, unknown>;
  const pixels =
    observation.pixels &&
    typeof observation.pixels === "object" &&
    !Array.isArray(observation.pixels)
      ? (observation.pixels as Record<string, unknown>)
      : undefined;
  if (pixels?.status !== "captured") return normalResult(result);
  if (pixels.presentationBase64 === undefined) return normalResult(result);
  const bytes = decodePngBase64(pixels.presentationBase64);
  if (pixels.mime !== "image/png" || !bytes) {
    return errorResult(
      localError(
        "target.observation.capture",
        "invalid_target_observation_pixels",
        "Relay returned invalid PNG pixels for the target observation.",
        502,
      ),
    );
  }
  const { presentationBase64: _transientPixels, ...pixelMetadata } = pixels;
  const presented = { ...observation, pixels: pixelMetadata };
  return {
    content: [
      { type: "text", text: JSON.stringify(presented) },
      { type: "image", data: pixels.presentationBase64 as string, mimeType: "image/png" },
    ],
    structuredContent: { result: presented },
  };
}

async function invokeRelayTool(
  descriptor: RelayMcpToolDescriptor,
  input: Record<string, unknown>,
  confirmed: boolean,
  invoker: OperationInvoker,
  signal: AbortSignal,
  recoveryOptions: RelayMcpErrorOptions,
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
    return errorResult(relayMcpError(descriptor.operationId, error, recoveryOptions));
  }

  if (descriptor.operationId === "target.screenshot.capture") return screenshotResult(result);
  if (descriptor.operationId === "target.interact" && resultLooksLikePng(result)) {
    return screenshotResult(result);
  }
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
          : compactExecutionDestIdentityOperation(descriptor.operationId)
            ? compactExecutionDestIdentityFallback(summarized, descriptor.operationId)
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
  recoveryOptions: RelayMcpErrorOptions,
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
    return invokeRelayTool(
      descriptor,
      input,
      confirm === true,
      invoker,
      context.mcpReq.signal,
      recoveryOptions,
    );
  });
}

function registerRelayOutcomeTool(
  server: McpServer,
  descriptor: RelayOutcomeToolDescriptor,
  invoker: OperationInvoker,
  actorId: string,
  recoveryOptions: RelayMcpErrorOptions,
): void {
  const schema = descriptor.inputSchema;
  const confirmation = descriptor.requiresConfirmation
    ? z.literal(true).describe("Explicit approval for this protected outcome")
    : z.literal(true).optional().describe("Optional explicit approval");
  const inputSchema =
    typeof (schema as { safeExtend?: unknown }).safeExtend === "function"
      ? (schema as z.ZodObject).safeExtend({ confirm: confirmation })
      : schema.and(z.object({ confirm: confirmation }).strict());
  server.registerTool(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      outputSchema: relayToolOutputSchema,
      annotations: descriptor.annotations,
      inputSchema,
    },
    async (
      argumentsValue: Record<string, unknown>,
      context: { mcpReq: { signal: AbortSignal } },
    ) => {
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
        if (descriptor.name === "relay_observe_target") return targetObservationResult(result);
        if (descriptor.name === "relay_replay_lab") {
          return normalResult(result, compactReplayLabOutcome(result));
        }
        if (descriptor.name === "relay_export_evidence") {
          const runId = argumentsWithoutConfirmation.runId;
          if (typeof runId === "string") {
            return normalResult(result, compactTracePackToolResult(result, runId));
          }
        }
        return normalResult(result);
      } catch (error) {
        return errorResult(relayMcpError(descriptor.name, error, recoveryOptions));
      }
    },
  );
}

function registerRelayOperatorTool(
  server: McpServer,
  descriptor: RelayOperatorToolDescriptor,
  invoker: OperationInvoker,
  recoveryOptions: RelayMcpErrorOptions,
): void {
  const schema = descriptor.inputSchema;
  const confirmation = z.literal(true).optional().describe("Optional explicit approval");
  const inputSchema =
    typeof (schema as { safeExtend?: unknown }).safeExtend === "function"
      ? (schema as z.ZodObject).safeExtend({ confirm: confirmation })
      : schema.and(z.object({ confirm: confirmation }).strict());
  server.registerTool(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      outputSchema: relayToolOutputSchema,
      annotations: descriptor.annotations,
      inputSchema,
    },
    async (
      argumentsValue: Record<string, unknown>,
      context: { mcpReq: { signal: AbortSignal } },
    ) => {
      const { confirm: _confirm, ...argumentsWithoutConfirmation } = argumentsValue as Record<
        string,
        unknown
      >;
      try {
        const result = await invokeRelayOperatorTool({
          name: descriptor.name,
          argumentsValue: argumentsWithoutConfirmation,
          invoker,
          signal: context.mcpReq.signal,
        });
        if (operatorResultIsPng(descriptor.name, result)) return screenshotResult(result);
        return normalResult(result);
      } catch (error) {
        return errorResult(relayMcpError(descriptor.name, error, recoveryOptions));
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
    instructions: relayMcpInstructionsForProfile(profile),
  });

  const tools = relayMcpToolsForProfile(profile);
  const recoveryOptions = recoveryOptionsForProfile(profile);
  // Order matches relayRegisteredToolNames: qa, then device, then full.
  for (const descriptor of relayEverydayTools) {
    registerRelayOutcomeTool(server, descriptor, invoker, actorId, recoveryOptions);
  }
  for (const descriptor of relayQaOperationTools) {
    registerRelayTool(server, descriptor, invoker, recoveryOptions);
  }
  registerRelayPanel(server, invoker, scope);
  if (profile !== "qa") {
    for (const descriptor of relayOperatorTools) {
      registerRelayOperatorTool(server, descriptor, invoker, recoveryOptions);
    }
    for (const descriptor of relayOutcomeTools) {
      registerRelayOutcomeTool(server, descriptor, invoker, actorId, recoveryOptions);
    }
  }
  if (profile === "full") {
    for (const descriptor of relayFullOutcomeTools) {
      registerRelayOutcomeTool(server, descriptor, invoker, actorId, recoveryOptions);
    }
    for (const descriptor of tools) {
      registerRelayTool(server, descriptor, invoker, recoveryOptions);
    }
  }
  registerRelayResources(server, { invoker, scope, profile, tools });
  registerRelayPrompts(server, scope, tools);

  return server;
}
