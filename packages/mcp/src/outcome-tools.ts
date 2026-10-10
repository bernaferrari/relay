import {
  repeatSpecSchema,
  replayLabReportSchema,
  measureTracePackJson,
  TRACE_PACK_OFFLINE_TRANSPORT_LIMITS,
  tracePackSchema,
  type AuthoringInteraction,
  type RepeatSpec,
  type TracePack,
  browserAuthenticationFixtureReferenceSchema,
  operationDefinition,
} from "@relay/protocol";
import type { RelayOutcomeJobs, WorkflowRef } from "@relay/workflows";
import { createRelayOutcomeJobs } from "@relay/workflows/outcomes";
import * as z from "zod/v4";
import type { OperationInvoker } from "./server.js";
import { proofOutcomeTools } from "./proof-outcome-tools.js";
import { dispatchRelayOutcomeTool } from "./outcome-tool-dispatch.js";
import { invokeRelayEverydayTool, isRelayEverydayTool } from "./everyday-tools.js";

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
const targetId = identifier
  .optional()
  .describe("Device or browser from relay_list_devices; keep it for the whole recording");
const targetKind = z.enum(["device", "browser"]).optional();
const phase = z.enum(["android", "ios"]).optional();
const workflowDecision = {
  workflowId: identifier,
  expectedVersion: z.number().int().positive(),
} as const;
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
  if (name === "relay_replay_lab") assertRawTracePackPayloads(value.tracePacks, 64);
}
// Recording uses the same interaction and edit contracts as CLI, HTTP, and
// Product. This includes executable expect/wait-for steps and insertion edits.
const recordedInteraction = operationDefinition("authoring.session.interact").input.presentation
  .shape.interaction;
const recordingEdit = operationDefinition("authoring.take.edit").input.presentation.shape.edit;
if (!recordedInteraction || !recordingEdit) {
  throw new Error("Canonical authoring interaction and edit schemas are required.");
}

export const relayOutcomeTools = Object.freeze([
  {
    name: "relay_observe_target",
    title: "Observe a target",
    description:
      "Look at a device or browser without touching it: a screenshot plus the controls on screen. Works even when the control list is unavailable.",
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
    name: "relay_explore_goal",
    title: "Explore toward a goal",
    description:
      "Let a model drive one device or browser toward a stated goal in a limited number of steps; it never types secrets and stops to ask when unsure. The same tool inspects, resumes, cancels, replays or saves a past exploration as a Test to review.",
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
      "Start recording a new Test on a device or browser: every tap and check you send is saved as a step. Set originApplication to the app the Test must reopen.",
    requiresConfirmation: true,
    inputSchema: z
      .object({
        appMapId: identifier.optional(),
        title: identifier,
        targetId,
        targetKind,
        originApplication: identifier.optional(),
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
      "Record one tap, typing or check step into the active recording. Pass the workflowId and expectedVersion from the last recording result.",
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
    description:
      "Save a named screenshot checkpoint in the active recording. For a step that must pass, record a check with relay_record_action instead.",
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
    description: "Stop recording and prepare the recorded Test for review.",
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
      "Change a stopped recording: remove, reorder, replace or insert steps. Replay it again before saving.",
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
    description:
      "Replay the stopped recording exactly as it stands and report whether each step passed.",
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
    title: "Save a recorded Test",
    description:
      "Save the reviewed recording as a Test. An edited recording must pass a replay first.",
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
      "Run one Test over a list of values (for example several languages), starting with one value so you can check it. Then call relay_continue_repeat for the rest.",
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
      "Read the current state of a recording, repeat or Run by its workflowId, including its latest version.",
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
      "Stop a running Run, recording or repeat. Pass its workflowId and expectedVersion; results so far are kept.",
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
    description: "After the first value of a repeat looks right, run the remaining values.",
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
    name: "relay_propose_repair",
    title: "Propose a repair",
    description:
      "Suggest a fix for one failed check (accept what the screen shows now, or turn the check off) for a person to review. It never changes the Test by itself.",
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
  {
    name: "relay_export_evidence",
    title: "Export evidence",
    description:
      "Export one finished Run's evidence (screenshots, steps and results) to hand to a reviewer or another agent.",
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

/** Offline comparison and change-level Proof: full profile only. */
export const relayFullOutcomeTools = Object.freeze([
  {
    name: "relay_replay_lab",
    title: "Compare TracePacks offline",
    description:
      "Compare 2 to 64 saved run recordings offline and list likely causes of the difference. Reads only the data you pass.",
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
  if (isRelayEverydayTool(input.name)) {
    return invokeRelayEverydayTool({ ...input, name: input.name, jobs });
  }
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
    descriptors: [...relayOutcomeTools, ...relayFullOutcomeTools],
    assertRawOutcomeInputBounds,
    replayLabTracePacks,
  });
}
