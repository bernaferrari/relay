import {
  repeatSpecSchema,
  replayLabReportSchema,
  measureTracePackJson,
  TRACE_PACK_OFFLINE_TRANSPORT_LIMITS,
  tracePackSchema,
  VERIFY_CHANGE_MAX_IDS,
  VERIFY_CHANGE_MAX_TRACE_PACKS,
  type AuthoringInteraction,
  type RepeatSpec,
  type SourceRevision,
  type TracePack,
  browserAuthenticationFixtureReferenceSchema,
} from "@relay/protocol";
import type { RelayOutcomeJobs, WorkflowRef } from "@relay/workflows";
import { createRelayOutcomeJobs } from "@relay/workflows/outcomes";
import * as z from "zod/v4";
import type { OperationInvoker } from "./server.js";
import { proofOutcomeTools } from "./proof-outcome-tools.js";
import {
  createDebugBugInputSchema,
  createDebugBugOutcomeTool,
  invokeDebugBugOutcomeTool,
} from "./debug-bug-outcome-tool.js";
import { dispatchRelayOutcomeTool } from "./outcome-tool-dispatch.js";

type OutcomeInputSchema = z.ZodType<Record<string, unknown>>;

export type RelayOutcomeToolDescriptor = {
  readonly name: `relay_${string}`;
  readonly title: string;
  readonly description: string;
  readonly requiresConfirmation: boolean;
  readonly inputSchema: OutcomeInputSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
};

const identifier = z.string().trim().min(1);
const legacyWorkflowRef = z
  .string()
  .min(1)
  .max(96 * 1024)
  .startsWith("relay-workflow.v1.");
const targetId = identifier.optional().describe("Only needed when more than one device is ready");
const workflowDecision = {
  workflowId: identifier,
  expectedVersion: z.number().int().positive(),
} as const;
const sourceRevision = z
  .object({
    vcs: z.literal("git"),
    sha: z.string().regex(/^[0-9a-f]{7,40}$/u),
    prNumber: z.number().int().positive().optional(),
    branch: identifier.optional(),
    artifactDigest: identifier.optional(),
  })
  .strict();
const replayLabMaxPayloadBytes = 128 * 1024 * 1024;
const tracePackMaxObjects = 2_000;
function tracePackObjectCount(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const objects = (value as { objects?: unknown }).objects;
  return Array.isArray(objects) ? objects.length : undefined;
}
const boundedTracePackTransport = z.unknown().superRefine((pack, context) => {
  const objectCount = tracePackObjectCount(pack);
  if (objectCount !== undefined && objectCount > tracePackMaxObjects) {
    context.addIssue({ code: "custom", message: "TracePack payload exceeds 2000 objects" });
  }
  try {
    measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "TracePack exceeds transport bounds",
    });
  }
});
const boundedOfflineTracePack = tracePackSchema.superRefine((pack, context) => {
  if (pack.objects.length > tracePackMaxObjects) {
    context.addIssue({ code: "custom", message: "TracePack payload exceeds 2000 objects" });
  }
  try {
    measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "TracePack exceeds transport bounds",
    });
  }
});
function boundedTracePackArray(item: z.ZodType) {
  return z
    .array(item)
    .min(1)
    .max(64)
    .superRefine((packs, context) => {
      try {
        const bytes = packs.reduce<number>(
          (total, pack) =>
            total + measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS).serializedBytes,
          0,
        );
        if (bytes > replayLabMaxPayloadBytes) {
          context.addIssue({ code: "custom", message: "Replay Lab payload exceeds 128 MiB" });
        }
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Replay Lab payload exceeds bounds",
        });
      }
    });
}
const replayLabTracePacks = z
  .array(boundedOfflineTracePack)
  .min(2)
  .max(64)
  .superRefine((packs, context) => {
    try {
      const bytes = packs.reduce(
        (total, pack) =>
          total + measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS).serializedBytes,
        0,
      );
      if (bytes > replayLabMaxPayloadBytes) {
        context.addIssue({ code: "custom", message: "Replay Lab payload exceeds 128 MiB" });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Replay Lab payload exceeds bounds",
      });
    }
  });

const replayLabTracePackTransport = boundedTracePackArray(boundedTracePackTransport).min(2);
const verifyChangeSelection = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("runs"),
      runIds: z.array(identifier).min(1).max(VERIFY_CHANGE_MAX_IDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tests"),
      appMapId: identifier,
      testIds: z.array(identifier).min(1).max(VERIFY_CHANGE_MAX_IDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trace-packs"),
      tracePacks: z.array(boundedOfflineTracePack).min(1).max(VERIFY_CHANGE_MAX_TRACE_PACKS),
    })
    .strict(),
  z
    .object({ kind: z.literal("source-revision"), sourceRevision, appMapId: identifier.optional() })
    .strict(),
]);
const verifyChangeSelectionTransport = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("runs"),
      runIds: z.array(identifier).min(1).max(VERIFY_CHANGE_MAX_IDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tests"),
      appMapId: identifier,
      testIds: z.array(identifier).min(1).max(VERIFY_CHANGE_MAX_IDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trace-packs"),
      tracePacks: boundedTracePackArray(boundedTracePackTransport).max(
        VERIFY_CHANGE_MAX_TRACE_PACKS,
      ),
    })
    .strict(),
  z
    .object({ kind: z.literal("source-revision"), sourceRevision, appMapId: identifier.optional() })
    .strict(),
]);

const debugBugInputSchema = createDebugBugInputSchema(verifyChangeSelectionTransport);

function goalValues(raw: unknown): { values?: Record<string, string> } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([, value]) => typeof value === "string",
  );
  return entries.length > 0
    ? { values: Object.fromEntries(entries) as Record<string, string> }
    : {};
}
const goalSessionInputSchema = z
  .object({
    goal: z.string().trim().min(1).max(2_048).optional(),
    startUrl: z.url().optional(),
    targetId,
    laneId: identifier.optional(),
    authenticationFixtureReference: browserAuthenticationFixtureReferenceSchema.optional(),
    model: identifier.optional(),
    maxSteps: z.number().int().min(1).max(40).optional(),
    maxDurationMs: z.number().int().min(1_000).max(900_000).optional(),
    agents: z.number().int().min(1).max(4).optional(),
    values: z.record(z.string().trim().min(1).max(64), z.string().max(2_048)).optional(),
    missions: z.array(z.string().trim().min(1).max(2_048)).max(4).optional(),
    cancelSessionId: identifier.optional(),
    resumeSessionId: identifier.optional(),
    resumeExplorationId: identifier.optional(),
    inspectSessionId: identifier.optional(),
    inspectExplorationId: identifier.optional(),
    reproduceSessionId: identifier.optional(),
    promoteSessionId: identifier.optional(),
    appMapId: identifier.optional(),
    title: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cancelSessionId) {
      if (
        Object.entries(value).some(([key, item]) => item !== undefined && key !== "cancelSessionId")
      ) {
        context.addIssue({
          code: "custom",
          message: "Goal cancellation accepts exactly one session id",
        });
      }
      return;
    }
    if (value.inspectSessionId || value.inspectExplorationId) {
      if (
        (value.inspectSessionId !== undefined && value.inspectExplorationId !== undefined) ||
        Object.entries(value).some(
          ([key, item]) =>
            item !== undefined && key !== "inspectSessionId" && key !== "inspectExplorationId",
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Goal inspection accepts exactly one inspection id",
        });
      }
      return;
    }
    if (value.reproduceSessionId || value.promoteSessionId) {
      if (
        value.goal !== undefined ||
        value.startUrl !== undefined ||
        value.targetId !== undefined ||
        value.laneId !== undefined ||
        value.authenticationFixtureReference !== undefined ||
        value.model !== undefined ||
        value.maxSteps !== undefined ||
        value.maxDurationMs !== undefined ||
        value.agents !== undefined ||
        value.resumeSessionId !== undefined ||
        value.resumeExplorationId !== undefined ||
        (value.reproduceSessionId !== undefined && value.promoteSessionId !== undefined) ||
        (value.reproduceSessionId !== undefined &&
          (value.appMapId !== undefined || value.title !== undefined))
      ) {
        context.addIssue({
          code: "custom",
          message: "Goal reproduction or promotion cannot be combined with start fields",
        });
      }
      return;
    }
    if (value.resumeSessionId || value.resumeExplorationId) {
      if (
        value.goal !== undefined ||
        value.startUrl !== undefined ||
        value.targetId !== undefined ||
        value.laneId !== undefined ||
        value.authenticationFixtureReference !== undefined ||
        value.model !== undefined ||
        value.maxSteps !== undefined ||
        value.maxDurationMs !== undefined ||
        value.agents !== undefined ||
        value.cancelSessionId !== undefined ||
        value.values !== undefined ||
        value.missions !== undefined ||
        value.appMapId !== undefined ||
        value.title !== undefined ||
        value.reproduceSessionId !== undefined ||
        value.promoteSessionId !== undefined ||
        (value.resumeSessionId !== undefined && value.resumeExplorationId !== undefined)
      ) {
        context.addIssue({
          code: "custom",
          message: "resumeSessionId cannot be combined with start fields",
        });
      }
      return;
    }
    if (value.appMapId !== undefined || value.title !== undefined) {
      context.addIssue({
        code: "custom",
        message: "appMapId and title are only valid when promoting a reproduced goal",
      });
    }
    if (!value.goal) context.addIssue({ code: "custom", message: "goal is required" });
    if ((value.startUrl === undefined) === (value.targetId === undefined)) {
      context.addIssue({ code: "custom", message: "provide exactly one of startUrl or targetId" });
    }
  });

function assertRawTracePackPayloads(value: unknown, maxPacks: number): void {
  if (!Array.isArray(value)) return;
  if (value.length > maxPacks) throw new TypeError(`TracePack count exceeds ${maxPacks}`);
  let total = 0;
  for (const pack of value) {
    total += measureTracePackJson(pack, TRACE_PACK_OFFLINE_TRANSPORT_LIMITS).serializedBytes;
    if (total > replayLabMaxPayloadBytes) {
      throw new TypeError("TracePack payload exceeds 128 MiB");
    }
  }
}

function assertRawOutcomeInputBounds(name: string, value: Record<string, unknown>): void {
  if (name === "relay_replay_lab") {
    assertRawTracePackPayloads(value.tracePacks, 64);
    return;
  }
  if (name !== "relay_proof_analyze" && name !== "relay_verify_change") return;
  const selection = value.selection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return;
  const record = selection as Record<string, unknown>;
  if (
    record.kind === "runs" &&
    Array.isArray(record.runIds) &&
    record.runIds.length > VERIFY_CHANGE_MAX_IDS
  ) {
    throw new TypeError(`Run selection exceeds ${VERIFY_CHANGE_MAX_IDS}`);
  }
  if (
    record.kind === "tests" &&
    Array.isArray(record.testIds) &&
    record.testIds.length > VERIFY_CHANGE_MAX_IDS
  ) {
    throw new TypeError(`Test selection exceeds ${VERIFY_CHANGE_MAX_IDS}`);
  }
  if (record.kind === "trace-packs") {
    assertRawTracePackPayloads(record.tracePacks, VERIFY_CHANGE_MAX_TRACE_PACKS);
  }
}
const semanticTarget = z
  .object({
    identifier: identifier.optional(),
    label: identifier.optional(),
    text: identifier.optional(),
    role: identifier.optional(),
    point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  })
  .strict();
const recordedInteraction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap"), target: semanticTarget }).strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string(),
      target: semanticTarget.optional(),
      mode: z.enum(["append", "replace"]).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["back", "home"]) }).strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: z.object({ x: z.number(), y: z.number() }).strict(),
      to: z.object({ x: z.number(), y: z.number() }).strict(),
      durationMs: z.number().min(50).max(5_000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("wait"), ms: z.number().int().nonnegative() }).strict(),
]);

const recordingEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remove"), actionIds: z.array(identifier).min(1) }).strict(),
  z.object({ kind: z.literal("reorder"), actionIds: z.array(identifier).min(1) }).strict(),
  z
    .object({ kind: z.literal("replace"), actionId: identifier, interaction: recordedInteraction })
    .strict(),
  z
    .object({
      kind: z.literal("merge"),
      actionIds: z.array(identifier).min(2),
      intent: z.string().trim().min(1).max(240).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("split"), actionId: identifier, atStep: z.number().int().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("rename"),
      actionId: identifier,
      intent: z.string().trim().min(1).max(240),
    })
    .strict(),
]);

export const relayOutcomeTools = Object.freeze([
  {
    name: "relay_connect_target",
    title: "Connect to a Device",
    description:
      "Discover ready local Devices and select the sole Device automatically. Supply targetId only when several Devices are ready.",
    requiresConfirmation: false,
    inputSchema: z.object({ targetId }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_observe_target",
    title: "Observe a Device",
    description:
      "Capture one bounded pixel and semantic observation without taking control. Pixels remain available when accessibility is stale or unavailable.",
    requiresConfirmation: false,
    inputSchema: z.object({ targetId }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_goal",
    title: "Run a bounded goal",
    description:
      "Interact with one target toward a stated goal using bounded OpenRouter-hosted Typesafe Jev suggestions. Relay validates every candidate, persists intent before mutation, never types secrets or runs code, and stops for review on uncertainty. Inspect retained evidence read-only, start or resume a goal, cancel a running session, reproduce an acknowledged browser path, or promote a fresh reproduction into the existing review-only Authoring workflow. Plain (non-secret) task values may be supplied as a values map; explorations accept distinct missions — one per worker.",
    requiresConfirmation: true,
    inputSchema: goalSessionInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_record_test",
    title: "Record a Test",
    description:
      "Start a control-and-record session in the current Test workspace on the sole ready Device. Interactions are sent through Relay. Relay may reserve available control but never displaces another person or agent.",
    requiresConfirmation: true,
    inputSchema: z
      .object({ appMapId: identifier.optional(), title: identifier, targetId })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_run_test",
    title: "Run a Test",
    description:
      "Compile and run one saved Test on the sole ready Device. Safe Tests need no confirmation. If preflight reports execution risk, review it and repeat the call with transport confirm: true. Returns a server-owned workflow ID, exact version, and immutable Run evidence references.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        appMapId: identifier.optional(),
        testId: identifier,
        targetId,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_record_action",
    title: "Record one action",
    description:
      "Append one typed tap, type, key, swipe, or wait using its durable workflow id and optimistic version.",
    requiresConfirmation: false,
    inputSchema: z.object({ ...workflowDecision, interaction: recordedInteraction }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_add_checkpoint",
    title: "Add a recording checkpoint",
    description: "Capture an immutable named checkpoint in the active recording.",
    requiresConfirmation: false,
    inputSchema: z.object({ ...workflowDecision, label: identifier.optional() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_stop_recording",
    title: "Stop and compile a recording",
    description: "Stop raw capture and prepare the recorded Test for review.",
    requiresConfirmation: false,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_edit_recording",
    title: "Edit a recording",
    description:
      "Transform the reviewed recording with one typed remove, reorder, replace, merge, split, or rename command. Every successful edit creates a new revision that must replay before approval.",
    requiresConfirmation: false,
    inputSchema: z.object({ ...workflowDecision, edit: recordingEdit }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_replay_recording",
    title: "Replay a recording",
    description: "Replay the exact reviewed recording revision and return its proof state.",
    requiresConfirmation: false,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_approve_recording",
    title: "Approve a recorded Test",
    description: "After a passing replay, explicitly approve the recording as the named Test.",
    requiresConfirmation: true,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_repeat_test",
    title: "Repeat a Test",
    description:
      "Run one representative pilot over selected values. Safe Tests need no confirmation. If preflight reports execution risk, review it and repeat the call with transport confirm: true. Inspect the returned workflow, then explicitly call relay_continue_repeat for the remaining values.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        appMapId: identifier.optional(),
        testId: identifier,
        repeat: repeatSpecSchema,
        evidence: z.enum(["visual", "smoke"]).optional(),
        targetId,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_inspect_workflow",
    title: "Inspect a workflow",
    description:
      "Read a server-owned Run by workflow ID, or inspect one bounded legacy v1 continuation reference read-only.",
    requiresConfirmation: false,
    inputSchema: z
      .object({ workflowId: identifier.optional(), legacyRef: legacyWorkflowRef.optional() })
      .strict()
      .superRefine((value, context) => {
        if ((value.workflowId === undefined) === (value.legacyRef === undefined)) {
          context.addIssue({
            code: "custom",
            message: "Provide exactly one workflowId or legacyRef",
          });
        }
      }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_cancel_run",
    title: "Cancel a Run",
    description:
      "Cancel one server-owned Run using its workflow ID and exact numeric version. Uncertain outcomes are inspection-only and are never retried automatically.",
    requiresConfirmation: true,
    inputSchema: z
      .object({ workflowId: identifier, expectedVersion: z.number().int().positive() })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_continue_repeat",
    title: "Continue a Repeat",
    description:
      "After reviewing a successful representative pilot, explicitly run the untouched selected values. Uses optimistic workflow versioning.",
    requiresConfirmation: true,
    inputSchema: z.object(workflowDecision).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "relay_inspect_failure",
    title: "Inspect a failure",
    description:
      "Read one failed Run together with its immutable evidence and existing repair proposals.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_propose_repair",
    title: "Propose a repair",
    description:
      "Create a reviewable accept-current or disable proposal for one failed check. This never approves or rewrites a Test.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        runId: identifier,
        checkId: identifier,
        proposal: z.enum(["accept-current", "disable"]),
        reason: identifier,
      })
      .strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  createDebugBugOutcomeTool(debugBugInputSchema),
  {
    name: "relay_replay_lab",
    title: "Compare TracePacks offline",
    description:
      "Compare 2-64 ordered TracePack payloads and optionally recompute visual/localization findings. This read-only tool does not read local files, contact the Relay server, inspect a Device, or mutate evidence.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        analysis: z.enum(["compare", "visual-localization", "all"]),
        tracePacks: replayLabTracePackTransport,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  ...proofOutcomeTools,
  {
    name: "relay_proof_analyze",
    title: "Analyze a Proof",
    description:
      "Analyze explicit frozen Tests, Runs, evidence packs, or source revision metadata offline. Returns one bounded pass, regression, review, or insufficient summary with exact policy rules, evidence completeness, first causal failure, unresolved uncertainty, and the smallest required live verification. Never changes Tests, controls a Device, creates a live Proof, or posts a check.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        selection: verifyChangeSelectionTransport,
        confirmationSatisfied: z.boolean().optional(),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_verify_change",
    title: "Verify a change (deprecated)",
    description:
      "Deprecated compatibility alias for relay_proof_analyze. Analyze explicit frozen Tests, Runs, evidence packs, or source revision metadata offline; never controls a Device, creates a live Proof, or posts a check. Use relay_proof_analyze instead.",
    requiresConfirmation: false,
    inputSchema: z
      .object({
        selection: verifyChangeSelectionTransport,
        confirmationSatisfied: z.boolean().optional(),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "relay_export_evidence",
    title: "Export evidence",
    description:
      "Export the portable content-addressed TracePack for one persisted Run. Advanced batch export remains available in raw operation profiles.",
    requiresConfirmation: false,
    inputSchema: z.object({ runId: identifier }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const satisfies readonly RelayOutcomeToolDescriptor[]);

function short(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 239)}…`;
}

/** MCP text stays useful when the complete comparison is larger than the
 * transport envelope. Full details remain available from the same CLI input. */
export function compactReplayLabOutcome(value: unknown): unknown {
  const parsed = replayLabReportSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const report = parsed.data;
  return {
    truncated: true,
    message: "Replay Lab details were compacted to its decision-relevant offline summary.",
    replayLab: {
      schemaVersion: report.schemaVersion,
      analysis: report.analysis,
      tracePackCount: report.tracePackCount,
      futureTransitionVerdict: report.futureTransitionVerdict,
      repairPolicy: report.repairPolicy,
      hypotheses: report.hypotheses.slice(0, 8).map((hypothesis) => ({
        rank: hypothesis.rank,
        priority: hypothesis.priority,
        kind: hypothesis.kind,
        classification: hypothesis.classification,
        statement: short(hypothesis.statement),
        evidence: hypothesis.evidence.slice(0, 4),
        requiresLiveVerification: true,
      })),
      remainingHypotheses: Math.max(0, report.hypotheses.length - 8),
      smallestLiveExperiment: {
        ...report.smallestLiveExperiment,
        reason: short(report.smallestLiveExperiment.reason),
      },
      comparison: report.comparison
        ? {
            testIdentity: report.comparison.testIdentity.status,
            nonProvedRequiredPaths: report.comparison.requiredPaths.filter(
              (item) => item.reachability.status !== "unchanged-proved",
            ).length,
            matcherChanges: report.comparison.matcherDeltas.filter(
              (item) => item.status === "changed",
            ).length,
            completenessGaps: report.comparison.completenessGaps.length,
          }
        : undefined,
      visualLocalization: report.visualLocalization
        ? {
            visual: report.visualLocalization.sufficiency.visual,
            localization: report.visualLocalization.sufficiency.localization,
            findings: report.visualLocalization.localization.findings.length,
          }
        : undefined,
    },
  };
}

export async function invokeRelayOutcomeTool(input: {
  name: RelayOutcomeToolDescriptor["name"];
  argumentsValue: Record<string, unknown>;
  confirmed: boolean;
  invoker: OperationInvoker;
  actorId: string;
  signal: AbortSignal;
}): Promise<unknown> {
  const jobs = createRelayOutcomeJobs(
    {
      invoke: (operationId, operationInput) =>
        input.invoker.invoke(operationId, operationInput as never, { signal: input.signal }),
    },
    { actorId: input.actorId },
  );
  return invokeRelayOutcomeToolWithJobs({
    name: input.name,
    argumentsValue: input.argumentsValue,
    confirmed: input.confirmed,
    jobs,
  });
}

/**
 * Validate and translate the public MCP boundary into the outcome façade.
 * Kept separate from transport construction so every public tool can be
 * contract-tested without reproducing canonical workflow behavior in MCP.
 */
export async function invokeRelayOutcomeToolWithJobs(input: {
  name: RelayOutcomeToolDescriptor["name"];
  argumentsValue: Record<string, unknown>;
  confirmed: boolean;
  jobs: RelayOutcomeJobs;
}): Promise<unknown> {
  return dispatchRelayOutcomeTool(input, {
    descriptors: relayOutcomeTools,
    assertRawOutcomeInputBounds,
    debugBugInputSchema,
    replayLabTracePacks,
    verifyChangeSelection,
    invokeDebugBugOutcomeTool,
  });
}
